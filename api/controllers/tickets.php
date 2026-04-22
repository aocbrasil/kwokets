<?php

declare(strict_types=1);

// Valid status transitions
// Full transitions (staff)
const STATUS_TRANSITIONS = [
    'open'             => ['ce_pending', 'close_pending', 'closed'],
    'ce_pending'       => ['open', 'customer_pending', 'monitoring', 'resolved', 'close_pending', 'closed'],
    'customer_pending' => ['ce_pending', 'resolved', 'close_pending', 'closed'],
    'monitoring'       => ['ce_pending', 'resolved', 'close_pending', 'closed'],
    'resolved'         => ['closed', 'open', 'close_pending'],
    'close_pending'    => ['ce_pending', 'closed'],
    'closed'           => [],
];

// Transitions customers are allowed to trigger
const CUSTOMER_STATUS_TRANSITIONS = [
    'open'             => ['close_pending'],
    'ce_pending'       => ['close_pending'],
    'customer_pending' => ['close_pending'],
    'monitoring'       => ['close_pending'],
    'resolved'         => ['close_pending'],
    'close_pending'    => [],
    'closed'           => [],
];

function tickets_list(array $params): void
{
    $user = require_auth();
    $pdo  = db_connect();

    $where  = [];
    $values = [];

    if ($user['role'] === 'customer') {
        $where[]  = 't.tenant_id = ?';
        $values[] = $user['tenant_id'];
    }

    // Optional filters via query string
    $qs = $_GET;

    if (!empty($qs['status'])) {
        $where[]  = 't.status = ?';
        $values[] = $qs['status'];
    }
    if (!empty($qs['priority'])) {
        $where[]  = 't.priority = ?';
        $values[] = $qs['priority'];
    }
    if (!empty($qs['tenant_id']) && is_staff($user)) {
        $where[]  = 't.tenant_id = ?';
        $values[] = (int)$qs['tenant_id'];
    }
    if (!empty($qs['assigned_to_me']) && is_staff($user)) {
        $where[]  = 't.assigned_to_user_id = ?';
        $values[] = $user['id'];
    }
    if (!empty($qs['unassigned']) && is_staff($user)) {
        $where[] = 't.assigned_to_user_id IS NULL';
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $limit  = min((int)($qs['limit'] ?? 50), 200);
    $offset = max((int)($qs['offset'] ?? 0), 0);

    $sql = "SELECT t.id, t.tenant_id, ten.name AS tenant_name,
                   t.subject, t.priority, t.status,
                   t.created_by_user_id, cb.full_name AS created_by_name,
                   t.assigned_to_user_id, ag.full_name AS assigned_to_name,
                   t.source, t.created_at, t.updated_at,
                   t.resolved_at,
                   sla.first_response_due_at, sla.resolution_due_at,
                   sla.first_response_met_at
            FROM tickets t
            JOIN tenants ten ON ten.id = t.tenant_id
            JOIN users cb   ON cb.id  = t.created_by_user_id
            LEFT JOIN users ag ON ag.id = t.assigned_to_user_id
            LEFT JOIN ticket_sla sla ON sla.ticket_id = t.id
            {$whereClause}
            ORDER BY t.created_at DESC
            LIMIT {$limit} OFFSET {$offset}";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($values);
    $tickets = $stmt->fetchAll();

    json_response(['tickets' => $tickets, 'limit' => $limit, 'offset' => $offset]);
}

function tickets_create(array $params): void
{
    $user = require_auth();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $subject     = trim($body['subject'] ?? '');
    $description = trim($body['description'] ?? '');
    $priority    = $body['priority'] ?? '';

    $errors = [];
    if ($subject === '')                               $errors[] = 'subject required';
    if ($description === '')                           $errors[] = 'description required';
    if (!in_array($priority, ['p1','p2','p3','p4'], true)) $errors[] = 'priority must be p1-p4';
    if ($errors) error_response('Validation failed', 400, $errors);

    // Determine tenant_id
    if ($user['role'] === 'customer') {
        $tenantId = (int)$user['tenant_id'];
    } else {
        // Staff must supply tenant_id
        $tenantId = (int)($body['tenant_id'] ?? 0);
        if ($tenantId === 0) error_response('tenant_id required for staff', 400);
    }

    $pdo = db_connect();

    // Verify tenant exists
    $stmt = $pdo->prepare('SELECT id FROM tenants WHERE id = ? AND is_active = TRUE');
    $stmt->execute([$tenantId]);
    if (!$stmt->fetch()) not_found('Tenant not found');

    $pdo->beginTransaction();

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO tickets (tenant_id, subject, description, priority, created_by_user_id, source)
             VALUES (?, ?, ?, ?, ?, 'web')
             RETURNING id, created_at"
        );
        $stmt->execute([$tenantId, $subject, $description, $priority, $user['id']]);
        $ticket = $stmt->fetch();

        // Log initial status
        $pdo->prepare(
            'INSERT INTO ticket_status_log (ticket_id, changed_by_user_id, old_status, new_status)
             VALUES (?, ?, NULL, ?)'
        )->execute([$ticket['id'], $user['id'], 'open']);

        // Initialize SLA
        sla_init((int)$ticket['id'], $tenantId, $priority, $ticket['created_at']);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        server_error('Failed to create ticket');
    }

    $stmt = $pdo->prepare(
        'SELECT t.*, sla.first_response_due_at, sla.resolution_due_at
         FROM tickets t
         LEFT JOIN ticket_sla sla ON sla.ticket_id = t.id
         WHERE t.id = ?'
    );
    $stmt->execute([$ticket['id']]);

    json_response($stmt->fetch(), 201);
}

function tickets_get(array $params): void
{
    $user     = require_auth();
    $ticketId = (int)$params['id'];

    $ticket = fetch_ticket_for_user($ticketId, $user);
    if (!$ticket) not_found('Ticket not found');

    json_response($ticket);
}

function tickets_update(array $params): void
{
    $user     = require_auth();
    $ticketId = (int)$params['id'];

    $ticket = fetch_ticket_for_user($ticketId, $user);
    if (!$ticket) not_found('Ticket not found');

    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $pdo  = db_connect();

    $updates = [];
    $values  = [];

    // Status change
    if (array_key_exists('status', $body)) {
        $newStatus = $body['status'];
        $oldStatus = $ticket['status'];

        if ($user['role'] === 'customer') {
            // Special case: customer can reopen closed ticket within 14 days of closure
            if ($oldStatus === 'closed' && $newStatus === 'open') {
                if (!$ticket['closed_at']) {
                    error_response('Cannot reopen: closure date unknown', 422);
                }
                $daysSinceClosed = (time() - strtotime($ticket['closed_at'])) / 86400;
                if ($daysSinceClosed > 14) {
                    error_response('Reopen window expired (14 days from closure)', 422);
                }
                // Clear assignment so ticket returns to open queue
                // (closed_at = NULL is handled by the general tracking block below)
                $updates[] = 'assigned_to_user_id = NULL';
            } else {
                $allowed = CUSTOMER_STATUS_TRANSITIONS[$oldStatus] ?? [];
                if (!in_array($newStatus, $allowed, true)) {
                    error_response("Cannot transition from {$oldStatus} to {$newStatus}", 422);
                }
            }
        } else {
            $allowed = STATUS_TRANSITIONS[$oldStatus] ?? [];
            if (!in_array($newStatus, $allowed, true)) {
                error_response("Cannot transition from {$oldStatus} to {$newStatus}", 422);
            }
        }

        $updates[] = 'status = ?';
        $values[]  = $newStatus;

        // SLA pause/resume logic
        $pausingStates = sla_pausing_states();
        $wasPaused     = in_array($oldStatus, $pausingStates, true);
        $willPause     = in_array($newStatus, $pausingStates, true);

        if (!$wasPaused && $willPause) {
            sla_pause($ticketId);
        } elseif ($wasPaused && !$willPause) {
            sla_resume($ticketId);
        }

        // Track resolved_at / closed_at
        if ($newStatus === 'resolved') {
            $updates[] = 'resolved_at = NOW()';
        } elseif ($oldStatus === 'resolved' && $newStatus !== 'closed') {
            $updates[] = 'resolved_at = NULL';
        }
        if ($newStatus === 'closed') {
            $updates[] = 'closed_at = NOW()';
        } elseif ($oldStatus === 'closed') {
            $updates[] = 'closed_at = NULL';
        }

        // Log status change
        $pdo->prepare(
            'INSERT INTO ticket_status_log (ticket_id, changed_by_user_id, old_status, new_status)
             VALUES (?, ?, ?, ?)'
        )->execute([$ticketId, $user['id'], $oldStatus, $newStatus]);

        // System message visible in thread
        $statusLabels = [
            'open'             => 'Open',
            'ce_pending'       => 'CE Pending',
            'customer_pending' => 'Customer Pending',
            'monitoring'       => 'Monitoring',
            'resolved'         => 'Resolved',
            'close_pending'    => 'Closure Requested',
            'closed'           => 'Closed',
        ];
        $fromLabel = $statusLabels[$oldStatus] ?? $oldStatus;
        $toLabel   = $statusLabels[$newStatus] ?? $newStatus;
        $pdo->prepare(
            "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
             VALUES (?, ?, ?, FALSE, 'system')"
        )->execute([$ticketId, $user['id'], "{$fromLabel} → {$toLabel}"]);

        // Auto-note when customer requests closure
        if ($newStatus === 'close_pending' && $user['role'] === 'customer') {
            $noteBody = isset($body['closure_reason']) && trim($body['closure_reason']) !== ''
                ? 'Closure requested by customer: ' . trim($body['closure_reason'])
                : 'Customer has requested closure of this ticket.';

            $pdo->prepare(
                "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
                 VALUES (?, ?, ?, FALSE, 'web')"
            )->execute([$ticketId, $user['id'], $noteBody]);
        }
    }

    // Subject (super_admin + supervisor only)
    if (array_key_exists('subject', $body)
        && in_array($user['role'], ['super_admin', 'supervisor'], true)
    ) {
        $newSubject = trim($body['subject']);
        if ($newSubject === '') error_response('subject cannot be empty', 400);
        if (strlen($newSubject) > 500) error_response('subject too long (max 500)', 400);
        $updates[] = 'subject = ?';
        $values[]  = $newSubject;
    }

    // Assignment (staff only)
    if (array_key_exists('assigned_to_user_id', $body) && is_staff($user)) {
        $assignTo = $body['assigned_to_user_id'];
        $newAgentName = null;
        if ($assignTo !== null) {
            // Verify assignee is staff
            $stmt = $pdo->prepare(
                "SELECT id, full_name FROM users WHERE id = ? AND role IN ('agent','supervisor','super_admin') AND is_active = TRUE"
            );
            $stmt->execute([(int)$assignTo]);
            $newAgent = $stmt->fetch();
            if (!$newAgent) error_response('Invalid assignee', 400);
            $newAgentName = $newAgent['full_name'];
        }

        $oldAgentName = null;
        if ($ticket['assigned_to_user_id']) {
            $stmt = $pdo->prepare('SELECT full_name FROM users WHERE id = ?');
            $stmt->execute([$ticket['assigned_to_user_id']]);
            $oldAgent = $stmt->fetch();
            $oldAgentName = $oldAgent ? $oldAgent['full_name'] : null;
        }

        $updates[] = 'assigned_to_user_id = ?';
        $values[]  = $assignTo;

        // System event bar for ownership change
        if ((int)($assignTo ?? 0) !== (int)($ticket['assigned_to_user_id'] ?? 0)) {
            if ($oldAgentName && $newAgentName) {
                $assignBody = "Assigned: {$oldAgentName} → {$newAgentName}";
            } elseif ($newAgentName) {
                $assignBody = "Assigned to: {$newAgentName}";
            } else {
                $assignBody = "Unassigned";
            }
            $pdo->prepare(
                "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
                 VALUES (?, ?, ?, FALSE, 'system')"
            )->execute([$ticketId, $user['id'], $assignBody]);
        }
    }

    // Priority change
    if (array_key_exists('priority', $body)) {
        $newPriority = $body['priority'];
        if (!in_array($newPriority, ['p1','p2','p3','p4'], true)) {
            error_response('Invalid priority', 400);
        }

        $priorityLabels = ['p1' => 'P1 Critical', 'p2' => 'P2 High', 'p3' => 'P3 Medium', 'p4' => 'P4 Low'];
        $fromPriLabel   = $priorityLabels[$ticket['priority']] ?? strtoupper($ticket['priority']);
        $toPriLabel     = $priorityLabels[$newPriority] ?? strtoupper($newPriority);

        if ($user['role'] === 'customer') {
            // Customers must provide justification
            $justification = trim($body['priority_justification'] ?? '');
            if ($justification === '') {
                error_response('priority_justification required when changing priority', 400);
            }

            // Only allow escalation (lower number = higher priority)
            $priorityOrder = ['p1' => 1, 'p2' => 2, 'p3' => 3, 'p4' => 4];
            $currentOrder  = $priorityOrder[$ticket['priority']] ?? 99;
            $newOrder      = $priorityOrder[$newPriority] ?? 99;

            if ($newOrder >= $currentOrder) {
                error_response('Customers can only escalate priority (e.g. P3 → P2)', 422);
            }

            if ($ticket['status'] === 'closed') {
                error_response('Cannot change priority on a closed ticket', 422);
            }

            $updates[] = 'priority = ?';
            $values[]  = $newPriority;

            // Auto-move to ce_pending unless already there or a terminal state
            $oldStatus = $ticket['status'];
            if (!in_array($oldStatus, ['ce_pending', 'closed', 'close_pending'], true)) {
                $updates[] = 'status = ?';
                $values[]  = 'ce_pending';

                // SLA: resume if currently paused, then pause not needed (ce_pending not pausing)
                if (in_array($oldStatus, sla_pausing_states(), true)) {
                    sla_resume($ticketId);
                }

                $pdo->prepare(
                    'INSERT INTO ticket_status_log (ticket_id, changed_by_user_id, old_status, new_status)
                     VALUES (?, ?, ?, ?)'
                )->execute([$ticketId, $user['id'], $oldStatus, 'ce_pending']);
            }

            // Insert justification note (visible to all)
            $noteBody = "Priority escalated to " . strtoupper($newPriority) . " by customer.\nJustification: " . $justification;
            $pdo->prepare(
                "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
                 VALUES (?, ?, ?, FALSE, 'web')"
            )->execute([$ticketId, $user['id'], $noteBody]);

            // System event bar
            $pdo->prepare(
                "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
                 VALUES (?, ?, ?, FALSE, 'system')"
            )->execute([$ticketId, $user['id'], "Priority: {$fromPriLabel} → {$toPriLabel}"]);

        } else {
            // Staff: unrestricted priority change
            $updates[] = 'priority = ?';
            $values[]  = $newPriority;

            // System event bar
            $pdo->prepare(
                "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
                 VALUES (?, ?, ?, FALSE, 'system')"
            )->execute([$ticketId, $user['id'], "Priority: {$fromPriLabel} → {$toPriLabel}"]);
        }
    }

    if (!$updates) {
        error_response('No valid fields to update', 400);
    }

    $values[] = $ticketId;
    $pdo->prepare(
        'UPDATE tickets SET ' . implode(', ', $updates) . ' WHERE id = ?'
    )->execute($values);

    $stmt = $pdo->prepare(
        'SELECT t.*, sla.first_response_due_at, sla.resolution_due_at, sla.first_response_met_at
         FROM tickets t
         LEFT JOIN ticket_sla sla ON sla.ticket_id = t.id
         WHERE t.id = ?'
    );
    $stmt->execute([$ticketId]);

    json_response($stmt->fetch());
}

function tickets_delete(array $params): void
{
    require_role(['super_admin']);

    $ticketId = (int)$params['id'];
    $pdo      = db_connect();

    // Collect attachment paths before cascade delete
    $stmt = $pdo->prepare('SELECT storage_path FROM ticket_attachments WHERE ticket_id = ?');
    $stmt->execute([$ticketId]);
    $paths = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $del = $pdo->prepare('DELETE FROM tickets WHERE id = ?');
    $del->execute([$ticketId]);

    if ($del->rowCount() === 0) not_found('Ticket not found');

    // Remove attachment files from disk
    foreach ($paths as $path) {
        if (is_file($path)) @unlink($path);
    }

    http_response_code(204);
    exit;
}

// ----- Messages -----

function ticket_messages_list(array $params): void
{
    $user     = require_auth();
    $ticketId = (int)$params['id'];

    if (!fetch_ticket_for_user($ticketId, $user)) not_found('Ticket not found');

    $pdo = db_connect();

    // Customers cannot see internal notes
    $internalFilter = $user['role'] === 'customer' ? 'AND m.is_internal = FALSE' : '';

    $stmt = $pdo->prepare(
        "SELECT m.id, m.ticket_id, m.user_id, u.full_name AS user_name, u.role AS user_role,
                m.body, m.is_internal, m.source, m.created_at
         FROM ticket_messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.ticket_id = ? {$internalFilter}
         ORDER BY m.created_at ASC"
    );
    $stmt->execute([$ticketId]);

    json_response(['messages' => $stmt->fetchAll()]);
}

function ticket_messages_create(array $params): void
{
    $user     = require_auth();
    $ticketId = (int)$params['id'];

    $ticket = fetch_ticket_for_user($ticketId, $user);
    if (!$ticket) not_found('Ticket not found');

    if (in_array($ticket['status'], ['closed'], true)) {
        error_response('Cannot add messages to a closed ticket', 422);
    }

    $body       = json_decode(file_get_contents('php://input'), true) ?? [];
    $messageBody = trim($body['body'] ?? '');
    $isInternal  = !empty($body['is_internal']) && is_staff($user);

    if ($messageBody === '') error_response('body required', 400);

    $pdo = db_connect();

    $stmt = $pdo->prepare(
        "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
         VALUES (?, ?, ?, ?, 'web')
         RETURNING id, created_at"
    );
    $stmt->execute([$ticketId, $user['id'], $messageBody, $isInternal ? 'TRUE' : 'FALSE']);
    $message = $stmt->fetch();

    // Mark SLA first response if agent/supervisor/super_admin posting non-internal
    if (is_staff($user) && !$isInternal) {
        sla_mark_first_response($ticketId);
    }

    json_response($message, 201);
}

// ----- Attachments -----

function ticket_attachments_list(array $params): void
{
    $user     = require_auth();
    $ticketId = (int)$params['id'];

    if (!fetch_ticket_for_user($ticketId, $user)) not_found('Ticket not found');

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT id, ticket_id, message_id, original_filename, mime_type, size_bytes, created_at
         FROM ticket_attachments
         WHERE ticket_id = ?
         ORDER BY created_at ASC'
    );
    $stmt->execute([$ticketId]);

    json_response(['attachments' => $stmt->fetchAll()]);
}

function ticket_attachments_upload(array $params): void
{
    $user     = require_auth();
    $ticketId = (int)$params['id'];

    if (!fetch_ticket_for_user($ticketId, $user)) not_found('Ticket not found');

    if (empty($_FILES['file'])) error_response('file required', 400);

    $file      = $_FILES['file'];
    $maxBytes  = (int)(getenv('ATTACHMENT_MAX_BYTES') ?: 104857600); // 100 MB

    if ($file['error'] !== UPLOAD_ERR_OK)        error_response('Upload error', 400);
    if ($file['size'] > $maxBytes)               error_response('File exceeds 100 MB limit', 413);

    $messageId = isset($_POST['message_id']) ? (int)$_POST['message_id'] : null;

    $storagePath = sprintf('%s/%d/%d',
        rtrim(getenv('STORAGE_PATH') ?: __DIR__ . '/../../storage/attachments', '/'),
        $ticketId,
        time()
    );

    if (!is_dir($storagePath) && !mkdir($storagePath, 0750, true)) {
        server_error('Could not create storage directory');
    }

    $safeName  = preg_replace('/[^a-zA-Z0-9._\-]/', '_', basename($file['name']));
    $destPath  = $storagePath . '/' . bin2hex(random_bytes(8)) . '_' . $safeName;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        server_error('Failed to store file');
    }

    $mime = mime_content_type($destPath) ?: 'application/octet-stream';

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'INSERT INTO ticket_attachments
            (ticket_id, message_id, original_filename, mime_type, size_bytes, storage_path)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id, created_at'
    );
    $stmt->execute([$ticketId, $messageId, $file['name'], $mime, $file['size'], $destPath]);
    $attachment = $stmt->fetch();

    json_response($attachment, 201);
}

function ticket_attachments_download(array $params): void
{
    $user         = require_auth();
    $attachmentId = (int)$params['attachment_id'];

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT a.*, t.created_by_user_id, t.tenant_id
         FROM ticket_attachments a
         JOIN tickets t ON t.id = a.ticket_id
         WHERE a.id = ?'
    );
    $stmt->execute([$attachmentId]);
    $att = $stmt->fetch();

    if (!$att) not_found('Attachment not found');

    // Customers can only access attachments on their own tickets
    if ($user['role'] === 'customer'
        && (int)$att['tenant_id'] !== (int)$user['tenant_id']) {
        forbidden();
    }

    if (!is_file($att['storage_path'])) not_found('File not found on disk');

    header('Content-Type: ' . $att['mime_type']);
    header('Content-Disposition: attachment; filename="' . addslashes($att['original_filename']) . '"');
    header('Content-Length: ' . $att['size_bytes']);
    readfile($att['storage_path']);
    exit;
}

// ----- Helper -----

function fetch_ticket_for_user(int $ticketId, array $user): ?array
{
    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT t.*, sla.first_response_due_at, sla.resolution_due_at, sla.first_response_met_at
         FROM tickets t
         LEFT JOIN ticket_sla sla ON sla.ticket_id = t.id
         WHERE t.id = ?'
    );
    $stmt->execute([$ticketId]);
    $ticket = $stmt->fetch(); // closed_at included via t.*

    if (!$ticket) return null;

    // Customers only see their own tenant's tickets they created
    if ($user['role'] === 'customer') {
        if ((int)$ticket['tenant_id'] !== (int)$user['tenant_id']) {
            return null;
        }
    }

    return $ticket;
}

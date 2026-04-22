<?php

declare(strict_types=1);

/**
 * Email poller — run every 2 minutes via cron.
 * Uses socket-based IMAP (no ext/imap needed, works on PHP 8.4+).
 *
 * Crontab: * /2 * * * * php /var/www/ticketing/cron/poll_email.php >> /var/log/ticketing/email.log 2>&1
 */

require_once __DIR__ . '/ImapSocket.php';
require_once __DIR__ . '/MimeParser.php';

require_once dirname(__DIR__) . '/api/lib/env.php';
load_env(dirname(__DIR__) . '/.env');

require_once dirname(__DIR__) . '/api/config/db.php';
require_once dirname(__DIR__) . '/api/config/imap.php';
require_once dirname(__DIR__) . '/api/lib/sla.php';
require_once dirname(__DIR__) . '/api/lib/notify.php';

$cfg = imap_config();

$imap = new ImapSocket();

if (!$imap->connect($cfg['host'], $cfg['port'], $cfg['use_ssl'])) {
    echo date('c') . " ERROR: Cannot connect to IMAP: " . $imap->lastError . "\n";
    exit(1);
}

if (!$imap->login($cfg['username'], $cfg['password'])) {
    echo date('c') . " ERROR: Login failed: " . $imap->lastError . "\n";
    $imap->close();
    exit(1);
}

if (!$imap->selectMailbox($cfg['mailbox'])) {
    echo date('c') . " ERROR: Cannot select mailbox: " . $imap->lastError . "\n";
    $imap->close();
    exit(1);
}

// Use ALL + dedup table — \Seen flag unreliable when shared mailbox is also read in a mail client
$messageNums = $imap->searchAll();

if (empty($messageNums)) {
    echo date('c') . " No messages in mailbox.\n";
    $imap->close();
    exit(0);
}

$pdo       = db_connect();
$processed = 0;
$skipped   = 0;

foreach ($messageNums as $msgNum) {
    $raw = $imap->fetchRfc822($msgNum);

    if ($raw === '') {
        echo date('c') . " WARN: Empty body for message {$msgNum}, skipping.\n";
        continue;
    }

    $parser = new MimeParser($raw);

    // Message-ID for deduplication
    $messageIdHeader = $parser->getMessageId();
    if ($messageIdHeader === '') {
        $messageIdHeader = 'noheader:' . md5($parser->getHeader('date') . $parser->getHeader('subject'));
    }

    // Dedup check
    $dedupStmt = $pdo->prepare('SELECT id FROM email_poll_log WHERE message_id_header = ?');
    $dedupStmt->execute([$messageIdHeader]);
    if ($dedupStmt->fetch()) {
        $skipped++;
        $imap->setFlag($msgNum, '\\Seen');
        continue;
    }

    $subject  = $parser->getHeader('subject');
    $from     = $parser->getFrom();
    $fromAddr = $from['mailbox'] . '@' . $from['host'];
    $fromName = $from['personal'] ?: $fromAddr;

    // Extract 9-digit ticket number starting with 6
    preg_match('/\b(6\d{8})\b/', $subject, $matches);
    $ticketNumber = $matches[1] ?? null;

    if (!$ticketNumber) {
        log_email($pdo, $messageIdHeader, null, 'discarded');
        $imap->setFlag($msgNum, '\\Seen');
        $processed++;
        continue;
    }

    // Find ticket
    $ticketStmt = $pdo->prepare('SELECT * FROM tickets WHERE id = ?');
    $ticketStmt->execute([(int)$ticketNumber]);
    $ticket = $ticketStmt->fetch();

    if (!$ticket) {
        log_email($pdo, $messageIdHeader, null, 'discarded');
        $imap->setFlag($msgNum, '\\Seen');
        $processed++;
        continue;
    }

    // Verify sender is known active user
    $senderStmt = $pdo->prepare(
        "SELECT id, role, tenant_id FROM users WHERE LOWER(email) = LOWER(?) AND is_active = TRUE"
    );
    $senderStmt->execute([$fromAddr]);
    $sender = $senderStmt->fetch();

    if (!$sender) {
        log_email($pdo, $messageIdHeader, (int)$ticketNumber, 'rejected');
        $imap->setFlag($msgNum, '\\Seen');
        $processed++;
        continue;
    }

    // Customer can only reply to their own tenant's ticket
    if ($sender['role'] === 'customer') {
        if ((int)$sender['tenant_id'] !== (int)$ticket['tenant_id']) {
            log_email($pdo, $messageIdHeader, (int)$ticketNumber, 'rejected');
            $imap->setFlag($msgNum, '\\Seen');
            $processed++;
            continue;
        }
    }

    // Closed ticket — reject
    if ($ticket['status'] === 'closed') {
        log_email($pdo, $messageIdHeader, (int)$ticketNumber, 'rejected');
        $imap->setFlag($msgNum, '\\Seen');
        $processed++;
        continue;
    }

    $body = $parser->getTextBody();

    $pdo->beginTransaction();

    try {
        // Insert message
        $msgStmt = $pdo->prepare(
            "INSERT INTO ticket_messages (ticket_id, user_id, body, is_internal, source)
             VALUES (?, ?, ?, FALSE, 'email')
             RETURNING id"
        );
        $msgStmt->execute([$ticket['id'], $sender['id'], $body]);
        $messageId = (int)$msgStmt->fetchColumn();

        // Save attachments
        save_email_attachments($parser, $pdo, (int)$ticket['id'], $messageId);

        // If sender is staff → mark first SLA response
        if (in_array($sender['role'], ['super_admin', 'supervisor', 'agent'], true)) {
            sla_mark_first_response((int)$ticket['id']);
        }

        // Auto-reopen resolved ticket within 14-day window
        if ($ticket['status'] === 'resolved' && $ticket['resolved_at']) {
            $daysSince = (time() - strtotime($ticket['resolved_at'])) / 86400;
            if ($daysSince <= 14) {
                $pdo->prepare(
                    "UPDATE tickets SET status = 'open', resolved_at = NULL,
                     assigned_to_user_id = NULL WHERE id = ?"
                )->execute([$ticket['id']]);

                $pdo->prepare(
                    "INSERT INTO ticket_status_log (ticket_id, changed_by_user_id, old_status, new_status)
                     VALUES (?, ?, 'resolved', 'open')"
                )->execute([$ticket['id'], $sender['id']]);
            }
        }

        log_email($pdo, $messageIdHeader, (int)$ticket['id'], 'replied');
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        echo date('c') . " ERROR processing msg {$msgNum}: " . $e->getMessage() . "\n";
        continue;
    }

    $imap->setFlag($msgNum, '\\Seen');
    $processed++;
}

$imap->close();
echo date('c') . " Poll complete. Processed: {$processed}, Skipped (dup): {$skipped}.\n";

// ---- Helpers ----

function save_email_attachments(
    MimeParser $parser,
    PDO $pdo,
    int $ticketId,
    int $messageId
): void {
    $maxBytes    = (int)(getenv('ATTACHMENT_MAX_BYTES') ?: 104857600);
    $attachments = $parser->getAttachments();

    foreach ($attachments as $att) {
        $data = $att['data'];
        $size = strlen($data);

        if ($size === 0 || $size > $maxBytes) continue;

        $storagePath = sprintf('%s/%d/%d',
            rtrim(getenv('STORAGE_PATH') ?: dirname(__DIR__) . '/storage/attachments', '/'),
            $ticketId,
            time()
        );

        if (!is_dir($storagePath)) mkdir($storagePath, 0750, true);

        $safeName = preg_replace('/[^a-zA-Z0-9._\-]/', '_', basename($att['filename']));
        $destPath = $storagePath . '/' . bin2hex(random_bytes(8)) . '_' . $safeName;

        file_put_contents($destPath, $data);

        $mime = $att['mime'] ?: 'application/octet-stream';

        $pdo->prepare(
            'INSERT INTO ticket_attachments
                (ticket_id, message_id, original_filename, mime_type, size_bytes, storage_path)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$ticketId, $messageId, $att['filename'], $mime, $size, $destPath]);
    }
}

function log_email(PDO $pdo, string $messageIdHeader, ?int $ticketId, string $action): void
{
    $pdo->prepare(
        'INSERT INTO email_poll_log (message_id_header, ticket_id, action)
         VALUES (?, ?, ?)
         ON CONFLICT (message_id_header) DO NOTHING'
    )->execute([$messageIdHeader, $ticketId, $action]);
}

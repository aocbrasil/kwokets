<?php

declare(strict_types=1);

function tenants_list(array $params): void
{
    require_role(['super_admin', 'supervisor', 'agent']);

    $pdo  = db_connect();
    $stmt = $pdo->query(
        'SELECT id, name, is_active, created_at, updated_at
         FROM tenants
         ORDER BY name ASC'
    );

    json_response(['tenants' => $stmt->fetchAll()]);
}

function tenants_create(array $params): void
{
    require_role(['super_admin']);

    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $name = trim($body['name'] ?? '');

    if ($name === '') error_response('name required', 400);

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'INSERT INTO tenants (name) VALUES (?) RETURNING id, name, is_active, created_at, updated_at'
    );
    $stmt->execute([$name]);

    json_response($stmt->fetch(), 201);
}

function tenants_update(array $params): void
{
    require_role(['super_admin']);

    $tenantId = (int)$params['id'];
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];
    $pdo      = db_connect();

    $updates = [];
    $values  = [];

    if (array_key_exists('name', $body)) {
        $name = trim($body['name']);
        if ($name === '') error_response('name cannot be empty', 400);
        $updates[] = 'name = ?';
        $values[]  = $name;
    }

    if (array_key_exists('is_active', $body)) {
        $updates[] = 'is_active = ?';
        $values[]  = $body['is_active'] ? 'TRUE' : 'FALSE';
    }

    if (!$updates) error_response('No valid fields to update', 400);

    $values[] = $tenantId;
    $affected = $pdo->prepare(
        'UPDATE tenants SET ' . implode(', ', $updates) . ' WHERE id = ?'
    );
    $affected->execute($values);

    if ($affected->rowCount() === 0) not_found('Tenant not found');

    $stmt = $pdo->prepare('SELECT id, name, is_active, created_at, updated_at FROM tenants WHERE id = ?');
    $stmt->execute([$tenantId]);

    json_response($stmt->fetch());
}

function tenants_delete(array $params): void
{
    require_role(['super_admin']);

    $tenantId = (int)$params['id'];
    $pdo      = db_connect();

    // Verify tenant exists
    $check = $pdo->prepare('SELECT id FROM tenants WHERE id = ?');
    $check->execute([$tenantId]);
    if (!$check->fetch()) not_found('Tenant not found');

    // Collect attachment paths for all tenant tickets before cascade
    $stmt = $pdo->prepare(
        'SELECT a.storage_path
         FROM ticket_attachments a
         JOIN tickets t ON t.id = a.ticket_id
         WHERE t.tenant_id = ?'
    );
    $stmt->execute([$tenantId]);
    $paths = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $pdo->beginTransaction();
    try {
        // Delete tickets (CASCADE removes messages, attachments rows, sla, status_log, etc.)
        $pdo->prepare('DELETE FROM tickets WHERE tenant_id = ?')->execute([$tenantId]);

        // Delete customer users tied to this tenant
        $pdo->prepare("DELETE FROM users WHERE tenant_id = ? AND role = 'customer'")->execute([$tenantId]);

        // Delete SLA rules
        $pdo->prepare('DELETE FROM sla_rules WHERE tenant_id = ?')->execute([$tenantId]);

        // Delete tenant
        $pdo->prepare('DELETE FROM tenants WHERE id = ?')->execute([$tenantId]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        server_error('Failed to delete tenant: ' . $e->getMessage());
    }

    // Remove attachment files from disk
    foreach ($paths as $path) {
        if (is_file($path)) @unlink($path);
    }

    http_response_code(204);
    exit;
}

function tenants_sla_rules_list(array $params): void
{
    require_role(['super_admin', 'supervisor']);
    $tenantId = (int)$params['id'];

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT id, tenant_id, priority, first_response_minutes, resolution_minutes,
                warn_before_minutes, created_at, updated_at
         FROM sla_rules
         WHERE tenant_id = ?
         ORDER BY priority ASC'
    );
    $stmt->execute([$tenantId]);

    json_response(['sla_rules' => $stmt->fetchAll()]);
}

function tenants_sla_rules_upsert(array $params): void
{
    require_role(['super_admin', 'supervisor']);

    $tenantId = (int)$params['id'];
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];
    $priority = $body['priority'] ?? '';

    $errors = [];
    if (!in_array($priority, ['p1','p2','p3','p4'], true))      $errors[] = 'priority must be p1-p4';
    if (empty($body['first_response_minutes']) || (int)$body['first_response_minutes'] <= 0)
        $errors[] = 'first_response_minutes must be > 0';
    if (empty($body['resolution_minutes']) || (int)$body['resolution_minutes'] <= 0)
        $errors[] = 'resolution_minutes must be > 0';
    if ($errors) error_response('Validation failed', 400, $errors);

    $warnBefore = isset($body['warn_before_minutes']) ? (int)$body['warn_before_minutes'] : 30;
    if ($warnBefore <= 0) $warnBefore = 30;

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'INSERT INTO sla_rules (tenant_id, priority, first_response_minutes, resolution_minutes, warn_before_minutes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, priority) DO UPDATE
         SET first_response_minutes = EXCLUDED.first_response_minutes,
             resolution_minutes     = EXCLUDED.resolution_minutes,
             warn_before_minutes    = EXCLUDED.warn_before_minutes,
             updated_at             = NOW()
         RETURNING *'
    );
    $stmt->execute([
        $tenantId,
        $priority,
        (int)$body['first_response_minutes'],
        (int)$body['resolution_minutes'],
        $warnBefore,
    ]);

    json_response($stmt->fetch(), 200);
}

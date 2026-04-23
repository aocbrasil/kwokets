<?php

declare(strict_types=1);

/* -----------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------- */

function _load_contracts_with_sla(PDO $pdo, int $tenantId): array
{
    $stmt = $pdo->prepare(
        "SELECT c.id, c.tenant_id, c.contract_code, c.tier,
                c.start_date, c.end_date, c.is_active,
                c.notes, c.customer_terms,
                c.created_at, c.updated_at
         FROM tenant_contracts c
         WHERE c.tenant_id = ?
         ORDER BY c.created_at DESC"
    );
    $stmt->execute([$tenantId]);
    $contracts = $stmt->fetchAll();

    if (empty($contracts)) return [];

    $ids       = array_column($contracts, 'id');
    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    $slaStmt = $pdo->prepare(
        "SELECT contract_id, priority,
                first_response_minutes, resolution_minutes, warn_before_minutes
         FROM contract_sla_rules
         WHERE contract_id IN ({$placeholders})
         ORDER BY priority"
    );
    $slaStmt->execute($ids);
    $slaRows = $slaStmt->fetchAll();

    $slaMap = [];
    foreach ($slaRows as $r) {
        $slaMap[$r['contract_id']][] = $r;
    }

    foreach ($contracts as &$c) {
        $c['sla_rules'] = $slaMap[$c['id']] ?? [];
    }

    return $contracts;
}

/* -----------------------------------------------------------------------
 * List contracts for a tenant
 * -------------------------------------------------------------------- */

function contracts_list(array $params): void
{
    require_role(['super_admin', 'supervisor', 'agent']);

    $tenantId = (int)$params['id'];
    $pdo      = db_connect();

    json_response(['contracts' => _load_contracts_with_sla($pdo, $tenantId)]);
}

/* -----------------------------------------------------------------------
 * Create a contract (with optional SLA rules)
 * -------------------------------------------------------------------- */

function contracts_create(array $params): void
{
    require_role(['super_admin', 'supervisor']);

    $tenantId = (int)$params['id'];
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];

    $code      = trim($body['contract_code'] ?? '');
    $tier      = $body['tier']       ?? '';
    $startDate = $body['start_date'] ?? '';
    $endDate   = $body['end_date']   ?: null;
    $notes     = trim($body['notes']          ?? '');
    $terms     = trim($body['customer_terms'] ?? '');
    $slaRules  = $body['sla_rules'] ?? [];

    $errors = [];
    if ($code === '')  $errors[] = 'contract_code required';
    if (!in_array($tier, ['basic', 'standard', 'prime'], true)) $errors[] = 'tier must be basic, standard, or prime';
    if ($startDate === '') $errors[] = 'start_date required';
    if ($errors) error_response('Validation failed', 400, $errors);

    $pdo = db_connect();
    $pdo->beginTransaction();

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO tenant_contracts
                (tenant_id, contract_code, tier, start_date, end_date, notes, customer_terms)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             RETURNING id"
        );
        $stmt->execute([$tenantId, $code, $tier, $startDate, $endDate,
                        $notes ?: null, $terms ?: null]);
        $contractId = (int)$stmt->fetchColumn();

        _upsert_contract_sla($pdo, $contractId, $slaRules);

        $pdo->commit();
    } catch (\PDOException $e) {
        $pdo->rollBack();
        if (str_contains($e->getMessage(), 'unique')) {
            error_response('Contract code already exists for this tenant', 409);
        }
        throw $e;
    }

    json_response(['contracts' => _load_contracts_with_sla($pdo, $tenantId)], 201);
}

/* -----------------------------------------------------------------------
 * Update a contract
 * -------------------------------------------------------------------- */

function contracts_update(array $params): void
{
    require_role(['super_admin', 'supervisor']);

    $contractId = (int)$params['contract_id'];
    $body       = json_decode(file_get_contents('php://input'), true) ?? [];

    $pdo  = db_connect();
    $stmt = $pdo->prepare('SELECT * FROM tenant_contracts WHERE id = ?');
    $stmt->execute([$contractId]);
    $contract = $stmt->fetch();
    if (!$contract) not_found('Contract not found');

    $updates = [];
    $values  = [];

    $fields = ['contract_code', 'tier', 'start_date', 'end_date', 'notes', 'customer_terms'];
    foreach ($fields as $f) {
        if (array_key_exists($f, $body)) {
            if ($f === 'tier' && !in_array($body[$f], ['basic', 'standard', 'prime'], true)) {
                error_response('tier must be basic, standard, or prime', 400);
            }
            $updates[] = "{$f} = ?";
            $values[]  = $body[$f] === '' ? null : $body[$f];
        }
    }

    if ($updates) {
        $values[] = $contractId;
        $pdo->prepare('UPDATE tenant_contracts SET ' . implode(', ', $updates) . ' WHERE id = ?')
            ->execute($values);
    }

    if (isset($body['sla_rules'])) {
        _upsert_contract_sla($pdo, $contractId, $body['sla_rules']);
    }

    json_response(['contracts' => _load_contracts_with_sla($pdo, (int)$contract['tenant_id'])]);
}

/* -----------------------------------------------------------------------
 * Activate a contract
 * Sets this contract active, deactivates others, copies SLAs to tenant
 * -------------------------------------------------------------------- */

function contracts_activate(array $params): void
{
    require_role(['super_admin', 'supervisor']);

    $contractId = (int)$params['contract_id'];
    $pdo        = db_connect();

    $stmt = $pdo->prepare('SELECT * FROM tenant_contracts WHERE id = ?');
    $stmt->execute([$contractId]);
    $contract = $stmt->fetch();
    if (!$contract) not_found('Contract not found');

    $tenantId = (int)$contract['tenant_id'];

    $pdo->beginTransaction();

    // Deactivate all contracts for this tenant
    $pdo->prepare('UPDATE tenant_contracts SET is_active = FALSE WHERE tenant_id = ?')
        ->execute([$tenantId]);

    // Activate this one
    $pdo->prepare('UPDATE tenant_contracts SET is_active = TRUE WHERE id = ?')
        ->execute([$contractId]);

    // Copy contract SLA rules → tenant sla_rules table
    $slaStmt = $pdo->prepare(
        'SELECT priority, first_response_minutes, resolution_minutes, warn_before_minutes
         FROM contract_sla_rules WHERE contract_id = ?'
    );
    $slaStmt->execute([$contractId]);
    $rules = $slaStmt->fetchAll();

    foreach ($rules as $r) {
        $pdo->prepare(
            "INSERT INTO sla_rules
                (tenant_id, priority, first_response_minutes, resolution_minutes, warn_before_minutes)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (tenant_id, priority) DO UPDATE
             SET first_response_minutes = EXCLUDED.first_response_minutes,
                 resolution_minutes     = EXCLUDED.resolution_minutes,
                 warn_before_minutes    = EXCLUDED.warn_before_minutes,
                 updated_at             = NOW()"
        )->execute([
            $tenantId,
            $r['priority'],
            $r['first_response_minutes'],
            $r['resolution_minutes'],
            $r['warn_before_minutes'],
        ]);
    }

    $pdo->commit();

    json_response(['contracts' => _load_contracts_with_sla($pdo, $tenantId)]);
}

/* -----------------------------------------------------------------------
 * Deactivate a contract
 * -------------------------------------------------------------------- */

function contracts_deactivate(array $params): void
{
    require_role(['super_admin', 'supervisor']);

    $contractId = (int)$params['contract_id'];
    $pdo        = db_connect();

    $stmt = $pdo->prepare('SELECT tenant_id FROM tenant_contracts WHERE id = ?');
    $stmt->execute([$contractId]);
    $row = $stmt->fetch();
    if (!$row) not_found('Contract not found');

    $pdo->prepare('UPDATE tenant_contracts SET is_active = FALSE WHERE id = ?')
        ->execute([$contractId]);

    json_response(['contracts' => _load_contracts_with_sla($pdo, (int)$row['tenant_id'])]);
}

/* -----------------------------------------------------------------------
 * Delete a contract
 * -------------------------------------------------------------------- */

function contracts_delete(array $params): void
{
    require_role(['super_admin']);

    $contractId = (int)$params['contract_id'];
    $pdo        = db_connect();

    $stmt = $pdo->prepare('SELECT tenant_id, is_active FROM tenant_contracts WHERE id = ?');
    $stmt->execute([$contractId]);
    $row = $stmt->fetch();
    if (!$row) not_found('Contract not found');
    if ($row['is_active']) error_response('Cannot delete an active contract', 409);

    $tenantId = (int)$row['tenant_id'];
    $pdo->prepare('DELETE FROM tenant_contracts WHERE id = ?')->execute([$contractId]);

    json_response(['contracts' => _load_contracts_with_sla($pdo, $tenantId)]);
}

/* -----------------------------------------------------------------------
 * Internal: upsert SLA rules for a contract
 * -------------------------------------------------------------------- */

function _upsert_contract_sla(PDO $pdo, int $contractId, array $rules): void
{
    foreach ($rules as $r) {
        $priority = $r['priority'] ?? '';
        if (!in_array($priority, ['p1', 'p2', 'p3', 'p4'], true)) continue;

        $pdo->prepare(
            "INSERT INTO contract_sla_rules
                (contract_id, priority, first_response_minutes, resolution_minutes, warn_before_minutes)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (contract_id, priority) DO UPDATE
             SET first_response_minutes = EXCLUDED.first_response_minutes,
                 resolution_minutes     = EXCLUDED.resolution_minutes,
                 warn_before_minutes    = EXCLUDED.warn_before_minutes"
        )->execute([
            $contractId,
            $priority,
            (int)($r['first_response_minutes'] ?? 60),
            (int)($r['resolution_minutes']     ?? 480),
            (int)($r['warn_before_minutes']    ?? 30),
        ]);
    }
}

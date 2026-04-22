<?php

declare(strict_types=1);

function users_list(array $params): void
{
    $user = require_role(['super_admin', 'supervisor', 'agent']);

    $pdo = db_connect();
    $qs  = $_GET;

    $where  = [];
    $values = [];

    if (!empty($qs['role'])) {
        $where[]  = 'u.role = ?';
        $values[] = $qs['role'];
    }
    if (!empty($qs['tenant_id'])) {
        $where[]  = 'u.tenant_id = ?';
        $values[] = (int)$qs['tenant_id'];
    }

    // Agents may only list staff — never customer records
    if ($user['role'] === 'agent') {
        $where[] = "u.role IN ('agent','supervisor','super_admin')";
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $stmt = $pdo->prepare(
        "SELECT u.id, u.tenant_id, t.name AS tenant_name,
                u.email, u.full_name, u.role, u.auth_type,
                u.support_contract_number, u.is_active,
                u.session_timeout_minutes, u.created_at, u.updated_at
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
         {$whereClause}
         ORDER BY u.full_name ASC"
    );
    $stmt->execute($values);

    json_response(['users' => $stmt->fetchAll()]);
}

function users_create(array $params): void
{
    require_role(['super_admin']);

    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $email    = trim($body['email'] ?? '');
    $fullName = trim($body['full_name'] ?? '');
    $role     = $body['role'] ?? '';
    $authType = $body['auth_type'] ?? '';

    $errors = [];
    if ($email === '')                                                    $errors[] = 'email required';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))                       $errors[] = 'invalid email';
    if ($fullName === '')                                                  $errors[] = 'full_name required';
    if (!in_array($role, ['super_admin','supervisor','agent','customer'], true)) $errors[] = 'invalid role';
    if (!in_array($authType, ['ldap','local'], true))                     $errors[] = 'auth_type must be ldap or local';

    // Role-specific validation
    if ($role === 'customer') {
        $contract = trim($body['support_contract_number'] ?? '');
        if ($contract === '') $errors[] = 'support_contract_number required for customers';

        $tenantId = (int)($body['tenant_id'] ?? 0);
        if ($tenantId === 0) $errors[] = 'tenant_id required for customers';
    }

    if ($authType === 'customer' && $authType !== 'local') {
        $errors[] = 'customers must use local auth';
    }

    if ($errors) error_response('Validation failed', 400, $errors);

    $pdo = db_connect();

    // Check email unique
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) error_response('Email already in use', 409);

    $passwordHash = null;
    $ldapDn       = null;

    if ($authType === 'local') {
        $password = $body['password'] ?? '';
        if (strlen($password) < 8) error_response('password must be at least 8 characters', 400);
        $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    } elseif ($authType === 'ldap') {
        $ldapDn = trim($body['ldap_dn'] ?? '');
        if ($ldapDn === '') error_response('ldap_dn required for ldap auth', 400);
    }

    $tenantId        = $role === 'customer' ? (int)$body['tenant_id'] : null;
    $contractNumber  = $role === 'customer' ? trim($body['support_contract_number']) : null;

    $stmt = $pdo->prepare(
        'INSERT INTO users
            (tenant_id, email, full_name, role, auth_type,
             password_hash, ldap_dn, support_contract_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id, tenant_id, email, full_name, role, auth_type,
                   support_contract_number, is_active, created_at'
    );
    $stmt->execute([
        $tenantId, $email, $fullName, $role, $authType,
        $passwordHash, $ldapDn, $contractNumber,
    ]);

    json_response($stmt->fetch(), 201);
}

function users_get(array $params): void
{
    $user   = require_auth();
    $userId = (int)$params['id'];

    // Users can only view themselves unless staff
    if ($user['role'] === 'customer' && (int)$user['id'] !== $userId) {
        forbidden();
    }

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT u.id, u.tenant_id, t.name AS tenant_name,
                u.email, u.full_name, u.role, u.auth_type,
                u.support_contract_number, u.is_active,
                u.session_timeout_minutes, u.created_at, u.updated_at
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
         WHERE u.id = ?'
    );
    $stmt->execute([$userId]);
    $target = $stmt->fetch();

    if (!$target) not_found('User not found');

    json_response($target);
}

function users_update(array $params): void
{
    $caller = require_auth();
    $userId = (int)$params['id'];

    // Only super_admin can update users (or user updating own password)
    $isSelf = (int)$caller['id'] === $userId;
    if ($caller['role'] !== 'super_admin' && !$isSelf) {
        forbidden();
    }

    $pdo  = db_connect();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $target = $stmt->fetch();
    if (!$target) not_found('User not found');

    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $updates = [];
    $values  = [];

    if ($caller['role'] === 'super_admin') {
        if (array_key_exists('full_name', $body)) {
            $n = trim($body['full_name']);
            if ($n === '') error_response('full_name cannot be empty', 400);
            $updates[] = 'full_name = ?';
            $values[]  = $n;
        }
        if (array_key_exists('is_active', $body)) {
            $updates[] = 'is_active = ?';
            $values[]  = $body['is_active'] ? 'TRUE' : 'FALSE';
        }
        if (array_key_exists('support_contract_number', $body) && $target['role'] === 'customer') {
            $c = trim($body['support_contract_number']);
            if ($c === '') error_response('support_contract_number cannot be empty', 400);
            $updates[] = 'support_contract_number = ?';
            $values[]  = $c;
        }
        if (array_key_exists('session_timeout_minutes', $body)) {
            $to = $body['session_timeout_minutes'];
            $updates[] = 'session_timeout_minutes = ?';
            $values[]  = $to === null ? null : (int)$to;
        }
    }

    // Password change (local auth only, allowed by self and super_admin)
    if (array_key_exists('password', $body) && $target['auth_type'] === 'local') {
        $pw = $body['password'] ?? '';
        if (strlen($pw) < 8) error_response('password must be at least 8 characters', 400);
        $updates[] = 'password_hash = ?';
        $values[]  = password_hash($pw, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    if (!$updates) error_response('No valid fields to update', 400);

    $values[] = $userId;
    $pdo->prepare(
        'UPDATE users SET ' . implode(', ', $updates) . ' WHERE id = ?'
    )->execute($values);

    $stmt = $pdo->prepare(
        'SELECT id, tenant_id, email, full_name, role, auth_type,
                support_contract_number, is_active, session_timeout_minutes, updated_at
         FROM users WHERE id = ?'
    );
    $stmt->execute([$userId]);

    json_response($stmt->fetch());
}

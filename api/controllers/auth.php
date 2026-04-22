<?php

declare(strict_types=1);

function auth_login(): void
{
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];
    $email    = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';

    if ($email === '' || $password === '') {
        error_response('email and password required', 400);
    }

    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT id, tenant_id, email, full_name, role, auth_type,
                password_hash, ldap_dn, is_active, session_timeout_minutes
         FROM users
         WHERE email = ? AND is_active = TRUE'
    );
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user) {
        unauthorized('Invalid credentials');
    }

    $authenticated = false;

    if ($user['auth_type'] === 'local') {
        $authenticated = password_verify($password, $user['password_hash']);
    } elseif ($user['auth_type'] === 'ldap') {
        $ldapResult = ldap_authenticate($email, $password);
        // Match by DN stored in DB
        $authenticated = $ldapResult !== null
            && $ldapResult['dn'] === $user['ldap_dn'];
    }

    if (!$authenticated) {
        unauthorized('Invalid credentials');
    }

    // Generate session token
    $token     = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $token);

    $expiresAt = null;
    if ($user['session_timeout_minutes'] !== null) {
        $expiresAt = date('Y-m-d H:i:sO', time() + $user['session_timeout_minutes'] * 60);
    }

    $pdo->prepare(
        'INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES (?, ?, ?)'
    )->execute([$user['id'], $tokenHash, $expiresAt]);

    json_response([
        'token' => $token,
        'user'  => [
            'id'        => $user['id'],
            'tenant_id' => $user['tenant_id'],
            'email'     => $user['email'],
            'full_name' => $user['full_name'],
            'role'      => $user['role'],
        ],
    ]);
}

function auth_logout(): void
{
    $user   = require_auth();
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token  = substr($header, 7);
    $hash   = hash('sha256', $token);

    db_connect()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([$hash]);

    json_response(['message' => 'Logged out']);
}

function auth_me(): void
{
    $user = require_auth();

    json_response([
        'id'        => $user['id'],
        'tenant_id' => $user['tenant_id'],
        'email'     => $user['email'],
        'full_name' => $user['full_name'],
        'role'      => $user['role'],
    ]);
}

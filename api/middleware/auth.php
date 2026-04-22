<?php

declare(strict_types=1);

/**
 * Resolves the current user from the Bearer token in the Authorization header.
 * Returns user row or null if unauthenticated.
 */
function current_user(): ?array
{
    static $user = false;

    if ($user !== false) {
        return $user;
    }

    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    if (str_starts_with($header, 'Bearer ')) {
        $token = substr($header, 7);
    } elseif (!empty($_GET['token'])) {
        // Fallback for direct browser requests (e.g. file downloads)
        $token = $_GET['token'];
    } else {
        $user = null;
        return null;
    }
    $tokenHash = hash('sha256', $token);
    $pdo       = db_connect();

    $stmt = $pdo->prepare(
        'SELECT s.id AS session_id, s.expires_at, s.user_id,
                u.id, u.tenant_id, u.email, u.full_name, u.role,
                u.auth_type, u.is_active, u.session_timeout_minutes
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?
           AND u.is_active = TRUE'
    );
    $stmt->execute([$tokenHash]);
    $row = $stmt->fetch();

    if (!$row) {
        $user = null;
        return null;
    }

    // Check expiry
    if ($row['expires_at'] !== null && strtotime($row['expires_at']) < time()) {
        // Delete expired session
        $pdo->prepare('DELETE FROM sessions WHERE id = ?')->execute([$row['session_id']]);
        $user = null;
        return null;
    }

    // Touch last_active_at
    $pdo->prepare('UPDATE sessions SET last_active_at = NOW() WHERE id = ?')
        ->execute([$row['session_id']]);

    $user = $row;
    return $user;
}

/**
 * Require authentication — aborts with 401 if not authenticated.
 */
function require_auth(): array
{
    $user = current_user();
    if ($user === null) {
        unauthorized();
    }
    return $user;
}

/**
 * Require one of the given roles — aborts with 403 if role not allowed.
 */
function require_role(array $roles): array
{
    $user = require_auth();
    if (!in_array($user['role'], $roles, true)) {
        forbidden();
    }
    return $user;
}

/**
 * Staff roles (can see all tenants).
 */
function is_staff(array $user): bool
{
    return in_array($user['role'], ['super_admin', 'supervisor', 'agent'], true);
}

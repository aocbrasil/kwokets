<?php

declare(strict_types=1);

/**
 * Authenticate a user against LDAP.
 * Returns ['dn' => string, 'email' => string, 'name' => string] on success, null on failure.
 */
function ldap_authenticate(string $username, string $password): ?array
{
    if ($password === '') {
        return null;
    }

    $cfg = ldap_config();

    $conn = ldap_connect($cfg['host'], $cfg['port']);
    if ($conn === false) {
        return null;
    }

    ldap_set_option($conn, LDAP_OPT_PROTOCOL_VERSION, 3);
    ldap_set_option($conn, LDAP_OPT_REFERRALS, 0);

    if ($cfg['use_tls']) {
        if (!@ldap_start_tls($conn)) {
            ldap_unbind($conn);
            return null;
        }
    }

    // Bind with service account to search for user DN
    if ($cfg['bind_dn'] !== '') {
        if (!@ldap_bind($conn, $cfg['bind_dn'], $cfg['bind_password'])) {
            ldap_unbind($conn);
            return null;
        }
    }

    $filter  = '(' . $cfg['uid_attr'] . '=' . ldap_escape($username, '', LDAP_ESCAPE_FILTER) . ')';
    $result  = @ldap_search($conn, $cfg['base_dn'], $filter, [
        'dn',
        $cfg['mail_attr'],
        $cfg['name_attr'],
    ]);

    if ($result === false) {
        ldap_unbind($conn);
        return null;
    }

    $entries = ldap_get_entries($conn, $result);

    if ($entries['count'] !== 1) {
        ldap_unbind($conn);
        return null;
    }

    $entry    = $entries[0];
    $userDn   = $entry['dn'];
    $userMail = $entry[$cfg['mail_attr']][0] ?? '';
    $userName = $entry[$cfg['name_attr']][0] ?? $username;

    // Bind as the user to verify password
    if (!@ldap_bind($conn, $userDn, $password)) {
        ldap_unbind($conn);
        return null;
    }

    ldap_unbind($conn);

    return [
        'dn'    => $userDn,
        'email' => $userMail,
        'name'  => $userName,
    ];
}

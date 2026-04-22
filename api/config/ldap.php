<?php

declare(strict_types=1);

function ldap_config(): array
{
    return [
        'host'         => getenv('LDAP_HOST')         ?: 'localhost',
        'port'         => (int)(getenv('LDAP_PORT')   ?: 389),
        'base_dn'      => getenv('LDAP_BASE_DN')      ?: 'dc=example,dc=com',
        'bind_dn'      => getenv('LDAP_BIND_DN')      ?: '',
        'bind_password'=> getenv('LDAP_BIND_PASSWORD') ?: '',
        'use_tls'      => getenv('LDAP_USE_TLS') === 'true',
        'uid_attr'     => getenv('LDAP_UID_ATTR')     ?: 'uid',
        'mail_attr'    => getenv('LDAP_MAIL_ATTR')    ?: 'mail',
        'name_attr'    => getenv('LDAP_NAME_ATTR')    ?: 'cn',
    ];
}

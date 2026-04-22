<?php

declare(strict_types=1);

function imap_config(): array
{
    return [
        'host'     => getenv('IMAP_HOST')     ?: 'localhost',
        'port'     => (int)(getenv('IMAP_PORT') ?: 993),
        'username' => getenv('IMAP_USER')     ?: '',
        'password' => getenv('IMAP_PASS')     ?: '',
        'mailbox'  => getenv('IMAP_MAILBOX')  ?: 'INBOX',
        'use_ssl'  => getenv('IMAP_SSL') !== 'false',
        'use_tls'  => getenv('IMAP_TLS') === 'true',
    ];
}

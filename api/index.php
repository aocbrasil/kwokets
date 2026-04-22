<?php

declare(strict_types=1);

// Bootstrap
require_once __DIR__ . '/lib/env.php';
load_env(dirname(__DIR__) . '/.env');

require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/ldap.php';
require_once __DIR__ . '/config/imap.php';
require_once __DIR__ . '/lib/router.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/sla.php';
require_once __DIR__ . '/lib/ldap_auth.php';
require_once __DIR__ . '/middleware/auth.php';
require_once __DIR__ . '/controllers/auth.php';
require_once __DIR__ . '/controllers/tickets.php';
require_once __DIR__ . '/controllers/tenants.php';
require_once __DIR__ . '/controllers/users.php';
require_once __DIR__ . '/controllers/notifications.php';
require_once __DIR__ . '/controllers/search.php';

// CORS headers
$allowedOrigin = getenv('ALLOWED_ORIGIN') ?: '*';
header("Access-Control-Allow-Origin: {$allowedOrigin}");
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$router = new Router();

// Auth
$router->post('/api/auth/login',  'auth_login');
$router->post('/api/auth/logout', 'auth_logout');
$router->get('/api/auth/me',      'auth_me');

// Tickets
$router->get('/api/tickets',                            'tickets_list');
$router->post('/api/tickets',                           'tickets_create');
$router->get('/api/tickets/:id',                        'tickets_get');
$router->patch('/api/tickets/:id',                      'tickets_update');
$router->delete('/api/tickets/:id',                     'tickets_delete');

// Messages
$router->get('/api/tickets/:id/messages',               'ticket_messages_list');
$router->post('/api/tickets/:id/messages',              'ticket_messages_create');

// Attachments
$router->get('/api/tickets/:id/attachments',            'ticket_attachments_list');
$router->post('/api/tickets/:id/attachments',           'ticket_attachments_upload');
$router->get('/api/attachments/:attachment_id',         'ticket_attachments_download');

// Tenants
$router->get('/api/tenants',                            'tenants_list');
$router->post('/api/tenants',                           'tenants_create');
$router->patch('/api/tenants/:id',                      'tenants_update');
$router->delete('/api/tenants/:id',                     'tenants_delete');
$router->get('/api/tenants/:id/sla-rules',              'tenants_sla_rules_list');
$router->post('/api/tenants/:id/sla-rules',             'tenants_sla_rules_upsert');

// Users
$router->get('/api/users',                              'users_list');
$router->post('/api/users',                             'users_create');
$router->get('/api/users/:id',                          'users_get');
$router->patch('/api/users/:id',                        'users_update');

// Search
$router->get('/api/search', 'search_tickets');

// Notifications
$router->get('/api/notifications',                      'notifications_list');
$router->patch('/api/notifications/read-all',           'notifications_mark_all_read');
$router->patch('/api/notifications/:id/read',           'notifications_mark_read');

$router->dispatch($_SERVER['REQUEST_METHOD'], $_SERVER['REQUEST_URI']);

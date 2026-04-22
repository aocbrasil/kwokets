<?php

declare(strict_types=1);

function json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function error_response(string $message, int $status = 400, array $errors = []): never
{
    $body = ['error' => $message];
    if ($errors) {
        $body['errors'] = $errors;
    }
    json_response($body, $status);
}

function not_found(string $message = 'Not found'): never
{
    error_response($message, 404);
}

function forbidden(string $message = 'Forbidden'): never
{
    error_response($message, 403);
}

function unauthorized(string $message = 'Unauthorized'): never
{
    error_response($message, 401);
}

function server_error(string $message = 'Internal server error'): never
{
    error_response($message, 500);
}

<?php

declare(strict_types=1);

function db_connect(): PDO
{
    static $pdo = null;

    if ($pdo !== null) {
        return $pdo;
    }

    $host   = getenv('DB_HOST')   ?: ($_ENV['DB_HOST']   ?? $_SERVER['DB_HOST']   ?? 'localhost');
    $port   = getenv('DB_PORT')   ?: ($_ENV['DB_PORT']   ?? $_SERVER['DB_PORT']   ?? '5432');
    $name   = getenv('DB_NAME')   ?: ($_ENV['DB_NAME']   ?? $_SERVER['DB_NAME']   ?? 'ticketing');
    $user   = getenv('DB_USER')   ?: ($_ENV['DB_USER']   ?? $_SERVER['DB_USER']   ?? 'ticketing');
    $pass   = getenv('DB_PASS')   ?: ($_ENV['DB_PASS']   ?? $_SERVER['DB_PASS']   ?? '');

    $dsn = "pgsql:host={$host};port={$port};dbname={$name};sslmode=require";

    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    return $pdo;
}

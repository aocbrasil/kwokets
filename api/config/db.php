<?php

declare(strict_types=1);

function db_connect(): PDO
{
    static $pdo = null;

    if ($pdo !== null) {
        return $pdo;
    }

    $host   = getenv('DB_HOST')   ?: 'localhost';
    $port   = getenv('DB_PORT')   ?: '5432';
    $name   = getenv('DB_NAME')   ?: 'ticketing';
    $user   = getenv('DB_USER')   ?: 'ticketing';
    $pass   = getenv('DB_PASS')   ?: '';

    $dsn = "pgsql:host={$host};port={$port};dbname={$name}";

    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    return $pdo;
}

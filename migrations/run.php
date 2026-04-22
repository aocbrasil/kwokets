#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Migration runner.
 * Usage: php migrations/run.php
 * Runs all *.sql files in migrations/ in filename order, skipping already-applied ones.
 */

require_once dirname(__DIR__) . '/api/lib/env.php';
load_env(dirname(__DIR__) . '/.env');
require_once dirname(__DIR__) . '/api/config/db.php';

$pdo = db_connect();

// Create migrations tracking table if not exists
$pdo->exec("
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
");

$dir   = __DIR__;
$files = glob($dir . '/*.sql');
sort($files);

foreach ($files as $file) {
    $name = basename($file);

    $stmt = $pdo->prepare('SELECT filename FROM schema_migrations WHERE filename = ?');
    $stmt->execute([$name]);

    if ($stmt->fetch()) {
        echo "  skip  {$name}\n";
        continue;
    }

    echo "  apply {$name} ... ";

    $sql = file_get_contents($file);

    try {
        $pdo->exec($sql);
        $pdo->prepare('INSERT INTO schema_migrations (filename) VALUES (?)')->execute([$name]);
        echo "OK\n";
    } catch (PDOException $e) {
        echo "FAILED\n";
        echo "  ERROR: " . $e->getMessage() . "\n";
        exit(1);
    }
}

echo "Done.\n";

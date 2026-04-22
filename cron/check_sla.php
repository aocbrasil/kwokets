<?php

declare(strict_types=1);

/**
 * SLA checker — run every 5 minutes via cron.
 * Sends warn (30 min before breach) and breach notifications (in-app + email).
 *
 * Crontab: * /5 * * * * php /var/www/ticketing/cron/check_sla.php >> /var/log/ticketing/sla.log 2>&1
 */

require_once dirname(__DIR__) . '/api/lib/env.php';
load_env(dirname(__DIR__) . '/.env');

require_once dirname(__DIR__) . '/api/config/db.php';
require_once dirname(__DIR__) . '/api/lib/notify.php';

$pdo = db_connect();

// Find open SLA records for non-terminal tickets
$stmt = $pdo->query(
    "SELECT
        sla.id AS sla_id,
        sla.ticket_id,
        sla.first_response_due_at,
        sla.resolution_due_at,
        sla.first_response_met_at,
        sla.warn_first_response_sent,
        sla.warn_resolution_sent,
        sla.breach_first_response_notified,
        sla.breach_resolution_notified,
        t.assigned_to_user_id,
        t.tenant_id,
        t.priority,
        t.status,
        sr.warn_before_minutes
     FROM ticket_sla sla
     JOIN tickets t ON t.id = sla.ticket_id
     LEFT JOIN sla_rules sr ON sr.tenant_id = t.tenant_id AND sr.priority = t.priority
     WHERE t.status NOT IN ('resolved','closed')"
);
$rows = $stmt->fetchAll();

// Get supervisor user IDs (global, receive all SLA alerts)
$supervisors = $pdo->query(
    "SELECT id FROM users WHERE role IN ('super_admin','supervisor') AND is_active = TRUE"
)->fetchAll(PDO::FETCH_COLUMN);

foreach ($rows as $row) {
    $warnBefore = (int)($row['warn_before_minutes'] ?? 30);
    $now        = time();

    $firstResponseDue = strtotime($row['first_response_due_at']);
    $resolutionDue    = strtotime($row['resolution_due_at']);

    $recipients = array_filter(array_unique(
        array_merge($supervisors, $row['assigned_to_user_id'] ? [(int)$row['assigned_to_user_id']] : [])
    ));

    // --- First response SLA ---
    if (!$row['first_response_met_at']) {
        $firstResponseSecondsLeft = $firstResponseDue - $now;

        // Warn: within warn window and not yet warned
        if (!$row['warn_first_response_sent']
            && $firstResponseSecondsLeft > 0
            && $firstResponseSecondsLeft <= $warnBefore * 60
        ) {
            foreach ($recipients as $uid) {
                notify_user($pdo, $uid, $row['ticket_id'], 'sla_warn_first_response');
            }
            $pdo->prepare(
                'UPDATE ticket_sla SET warn_first_response_sent = TRUE WHERE id = ?'
            )->execute([$row['sla_id']]);
        }

        // Breach: past due and not yet notified
        if (!$row['breach_first_response_notified'] && $firstResponseSecondsLeft < 0) {
            foreach ($recipients as $uid) {
                notify_user($pdo, $uid, $row['ticket_id'], 'sla_breach_first_response');
            }
            $pdo->prepare(
                'UPDATE ticket_sla SET breach_first_response_notified = TRUE WHERE id = ?'
            )->execute([$row['sla_id']]);
        }
    }

    // --- Resolution SLA ---
    $resolutionSecondsLeft = $resolutionDue - $now;

    // Warn
    if (!$row['warn_resolution_sent']
        && $resolutionSecondsLeft > 0
        && $resolutionSecondsLeft <= $warnBefore * 60
    ) {
        foreach ($recipients as $uid) {
            notify_user($pdo, $uid, $row['ticket_id'], 'sla_warn_resolution');
        }
        $pdo->prepare(
            'UPDATE ticket_sla SET warn_resolution_sent = TRUE WHERE id = ?'
        )->execute([$row['sla_id']]);
    }

    // Breach
    if (!$row['breach_resolution_notified'] && $resolutionSecondsLeft < 0) {
        foreach ($recipients as $uid) {
            notify_user($pdo, $uid, $row['ticket_id'], 'sla_breach_resolution');
        }
        $pdo->prepare(
            'UPDATE ticket_sla SET breach_resolution_notified = TRUE WHERE id = ?'
        )->execute([$row['sla_id']]);
    }
}

echo date('c') . " SLA check complete. Processed " . count($rows) . " tickets.\n";

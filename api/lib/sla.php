<?php

declare(strict_types=1);

/**
 * Compute SLA due dates for a new ticket.
 * Returns [first_response_due_at, resolution_due_at] as ISO strings, or null if no rule found.
 */
function sla_compute_due_dates(int $tenantId, string $priority, string $createdAt): ?array
{
    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT first_response_minutes, resolution_minutes
         FROM sla_rules
         WHERE tenant_id = ? AND priority = ?'
    );
    $stmt->execute([$tenantId, $priority]);
    $rule = $stmt->fetch();

    if (!$rule) {
        return null;
    }

    $base = strtotime($createdAt);

    return [
        'first_response_due_at' => date('Y-m-d H:i:sO', $base + $rule['first_response_minutes'] * 60),
        'resolution_due_at'     => date('Y-m-d H:i:sO', $base + $rule['resolution_minutes'] * 60),
    ];
}

/**
 * Initialize SLA tracking row for a ticket.
 */
function sla_init(int $ticketId, int $tenantId, string $priority, string $createdAt): void
{
    $dates = sla_compute_due_dates($tenantId, $priority, $createdAt);

    if ($dates === null) {
        return; // No SLA rule configured for this tenant+priority
    }

    db_connect()->prepare(
        'INSERT INTO ticket_sla
            (ticket_id, first_response_due_at, resolution_due_at)
         VALUES (?, ?, ?)'
    )->execute([
        $ticketId,
        $dates['first_response_due_at'],
        $dates['resolution_due_at'],
    ]);
}

/**
 * Pause SLA clock (on transition to customer_pending or monitoring).
 */
function sla_pause(int $ticketId): void
{
    // Only insert if not already paused
    $pdo  = db_connect();
    $stmt = $pdo->prepare(
        'SELECT id FROM sla_pause_log
         WHERE ticket_id = ? AND resumed_at IS NULL'
    );
    $stmt->execute([$ticketId]);

    if ($stmt->fetch()) {
        return; // Already paused
    }

    $pdo->prepare(
        'INSERT INTO sla_pause_log (ticket_id) VALUES (?)'
    )->execute([$ticketId]);
}

/**
 * Resume SLA clock (on transition away from customer_pending / monitoring).
 * Adjusts due dates to add the paused duration.
 */
function sla_resume(int $ticketId): void
{
    $pdo = db_connect();

    $stmt = $pdo->prepare(
        'SELECT id, paused_at FROM sla_pause_log
         WHERE ticket_id = ? AND resumed_at IS NULL'
    );
    $stmt->execute([$ticketId]);
    $pause = $stmt->fetch();

    if (!$pause) {
        return; // Not paused
    }

    $pausedSeconds = time() - strtotime($pause['paused_at']);

    // Close the pause interval
    $pdo->prepare(
        'UPDATE sla_pause_log SET resumed_at = NOW() WHERE id = ?'
    )->execute([$pause['id']]);

    // Shift due dates forward by the paused duration
    $pdo->prepare(
        "UPDATE ticket_sla
         SET first_response_due_at = first_response_due_at + INTERVAL '1 second' * ?,
             resolution_due_at     = resolution_due_at     + INTERVAL '1 second' * ?
         WHERE ticket_id = ?"
    )->execute([$pausedSeconds, $pausedSeconds, $ticketId]);
}

/**
 * Mark first response SLA as met (call when agent posts first non-internal message).
 */
function sla_mark_first_response(int $ticketId): void
{
    db_connect()->prepare(
        'UPDATE ticket_sla
         SET first_response_met_at = NOW()
         WHERE ticket_id = ? AND first_response_met_at IS NULL'
    )->execute([$ticketId]);
}

/**
 * States that pause the SLA clock.
 */
function sla_pausing_states(): array
{
    return ['customer_pending', 'monitoring', 'close_pending'];
}
// Note: ce_pending (active work state) does NOT pause the SLA clock.

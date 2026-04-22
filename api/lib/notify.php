<?php

declare(strict_types=1);

/**
 * Create an in-app notification and send an email to the user.
 */
function notify_user(PDO $pdo, int $userId, int $ticketId, string $type): void
{
    // Insert in-app notification (ignore duplicate — same type on same ticket)
    $pdo->prepare(
        'INSERT INTO notifications (user_id, ticket_id, type)
         VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING'
    )->execute([$userId, $ticketId, $type]);

    // Fetch user email + ticket info for the email body
    $stmt = $pdo->prepare(
        'SELECT u.email, u.full_name,
                t.id AS ticket_id, t.subject, t.priority,
                sla.first_response_due_at, sla.resolution_due_at
         FROM users u
         JOIN tickets t ON t.id = ?
         LEFT JOIN ticket_sla sla ON sla.ticket_id = t.id
         WHERE u.id = ?'
    );
    $stmt->execute([$ticketId, $userId]);
    $info = $stmt->fetch();

    if (!$info) return;

    $subject = match($type) {
        'sla_warn_first_response'  => "[WARNING] Ticket #{$ticketId}: First response SLA approaching",
        'sla_warn_resolution'      => "[WARNING] Ticket #{$ticketId}: Resolution SLA approaching",
        'sla_breach_first_response'=> "[BREACH] Ticket #{$ticketId}: First response SLA breached",
        'sla_breach_resolution'    => "[BREACH] Ticket #{$ticketId}: Resolution SLA breached",
        default                    => "SLA Alert - Ticket #{$ticketId}",
    };

    $slaDetail = match($type) {
        'sla_warn_first_response',
        'sla_breach_first_response' => "First response due: {$info['first_response_due_at']}",
        'sla_warn_resolution',
        'sla_breach_resolution'     => "Resolution due: {$info['resolution_due_at']}",
        default => '',
    };

    $body = "Hello {$info['full_name']},\n\n"
        . "Ticket #{$ticketId}: {$info['subject']}\n"
        . "Priority: " . strtoupper($info['priority']) . "\n"
        . "{$slaDetail}\n\n"
        . "Please take action.\n\n"
        . getenv('APP_URL') . "/tickets/{$ticketId}";

    send_email($info['email'], $subject, $body);
}

/**
 * Send a plain-text email via SMTP using PHP's mail() or a simple SMTP socket.
 * For production, swap this for a proper mailer library or SMTP relay.
 */
function send_email(string $to, string $subject, string $body): void
{
    $from     = getenv('SMTP_FROM')      ?: 'support@example.com';
    $fromName = getenv('SMTP_FROM_NAME') ?: 'Support';

    $headers  = "From: {$fromName} <{$from}>\r\n";
    $headers .= "Reply-To: {$from}\r\n";
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $headers .= "X-Mailer: PHP/" . PHP_VERSION;

    // NOTE: For TLS/SMTP auth, replace with PHPMailer or similar.
    // mail() works for servers with a local MTA (sendmail/postfix).
    @mail($to, $subject, $body, $headers);
}

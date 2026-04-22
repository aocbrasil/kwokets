<?php

declare(strict_types=1);

function notifications_list(array $params): void
{
    $user = require_auth();
    $pdo  = db_connect();

    $onlyUnread = !empty($_GET['unread']);

    $sql = 'SELECT n.id, n.ticket_id, t.subject AS ticket_subject,
                   n.type, n.read_at, n.created_at
            FROM notifications n
            JOIN tickets t ON t.id = n.ticket_id
            WHERE n.user_id = ?';

    if ($onlyUnread) {
        $sql .= ' AND n.read_at IS NULL';
    }

    $sql .= ' ORDER BY n.created_at DESC LIMIT 100';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([$user['id']]);

    json_response(['notifications' => $stmt->fetchAll()]);
}

function notifications_mark_read(array $params): void
{
    $user = require_auth();
    $id   = (int)$params['id'];
    $pdo  = db_connect();

    $stmt = $pdo->prepare(
        'UPDATE notifications SET read_at = NOW()
         WHERE id = ? AND user_id = ? AND read_at IS NULL
         RETURNING id'
    );
    $stmt->execute([$id, $user['id']]);

    if (!$stmt->fetch()) not_found('Notification not found or already read');

    json_response(['id' => $id, 'read_at' => date('c')]);
}

function notifications_mark_all_read(array $params): void
{
    $user = require_auth();

    db_connect()->prepare(
        'UPDATE notifications SET read_at = NOW()
         WHERE user_id = ? AND read_at IS NULL'
    )->execute([$user['id']]);

    json_response(['message' => 'All notifications marked as read']);
}

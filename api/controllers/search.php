<?php

declare(strict_types=1);

function search_tickets(array $params): void
{
    require_role(['super_admin', 'supervisor', 'agent']);

    $q = trim($_GET['q'] ?? '');
    if (strlen($q) < 2) {
        json_response(['results' => [], 'query' => $q]);
        return;
    }

    $limit = min((int)($_GET['limit'] ?? 30), 100);

    $pdo = db_connect();

    // Detect whether pg_trgm is available
    $hasTrgm = false;
    try {
        $pdo->query("SELECT similarity('a','b')")->fetch();
        $hasTrgm = true;
    } catch (\PDOException $e) {
        // extension not installed — fall back to FTS only
    }

    if ($hasTrgm) {
        $sql = "
            WITH q AS (
                SELECT plainto_tsquery('english', ?) AS tsq,
                       ? AS raw
            ),
            fts AS (
                SELECT
                    t.id AS ticket_id,
                    ts_headline(
                        'english', t.subject, q.tsq,
                        'MaxWords=12,MinWords=4,StartSel=<mark>,StopSel=</mark>,HighlightAll=false'
                    ) AS snippet,
                    GREATEST(
                        ts_rank(to_tsvector('english', t.subject), q.tsq),
                        similarity(t.subject, q.raw)
                    ) AS rank,
                    'subject' AS match_source
                FROM tickets t, q
                WHERE to_tsvector('english', t.subject) @@ q.tsq
                   OR similarity(t.subject, q.raw) > 0.15

                UNION ALL

                SELECT
                    m.ticket_id,
                    ts_headline(
                        'english', m.body, q.tsq,
                        'MaxWords=35,MinWords=10,StartSel=<mark>,StopSel=</mark>,HighlightAll=false'
                    ) AS snippet,
                    ts_rank(to_tsvector('english', m.body), q.tsq) AS rank,
                    'message' AS match_source
                FROM ticket_messages m, q
                WHERE to_tsvector('english', m.body) @@ q.tsq
                  AND m.source != 'system'
            ),
            best AS (
                SELECT DISTINCT ON (ticket_id)
                    ticket_id, snippet, rank, match_source
                FROM fts
                ORDER BY ticket_id, rank DESC
            )
            SELECT
                t.id, t.subject, t.status, t.priority,
                tn.name AS tenant_name,
                t.created_at, t.updated_at,
                u.full_name AS assigned_to_name,
                b.snippet, b.rank, b.match_source
            FROM best b
            JOIN tickets t   ON t.id  = b.ticket_id
            JOIN tenants tn  ON tn.id = t.tenant_id
            LEFT JOIN users u ON u.id = t.assigned_to_user_id
            ORDER BY b.rank DESC, t.updated_at DESC
            LIMIT ?
        ";
        $binds = [$q, $q, $limit];
    } else {
        // FTS-only fallback (no trigram)
        $sql = "
            WITH q AS (
                SELECT plainto_tsquery('english', ?) AS tsq
            ),
            fts AS (
                SELECT
                    t.id AS ticket_id,
                    ts_headline(
                        'english', t.subject, q.tsq,
                        'MaxWords=12,MinWords=4,StartSel=<mark>,StopSel=</mark>,HighlightAll=false'
                    ) AS snippet,
                    ts_rank(to_tsvector('english', t.subject), q.tsq) AS rank,
                    'subject' AS match_source
                FROM tickets t, q
                WHERE to_tsvector('english', t.subject) @@ q.tsq

                UNION ALL

                SELECT
                    m.ticket_id,
                    ts_headline(
                        'english', m.body, q.tsq,
                        'MaxWords=35,MinWords=10,StartSel=<mark>,StopSel=</mark>,HighlightAll=false'
                    ) AS snippet,
                    ts_rank(to_tsvector('english', m.body), q.tsq) AS rank,
                    'message' AS match_source
                FROM ticket_messages m, q
                WHERE to_tsvector('english', m.body) @@ q.tsq
                  AND m.source != 'system'
            ),
            best AS (
                SELECT DISTINCT ON (ticket_id)
                    ticket_id, snippet, rank, match_source
                FROM fts
                ORDER BY ticket_id, rank DESC
            )
            SELECT
                t.id, t.subject, t.status, t.priority,
                tn.name AS tenant_name,
                t.created_at, t.updated_at,
                u.full_name AS assigned_to_name,
                b.snippet, b.rank, b.match_source
            FROM best b
            JOIN tickets t   ON t.id  = b.ticket_id
            JOIN tenants tn  ON tn.id = t.tenant_id
            LEFT JOIN users u ON u.id = t.assigned_to_user_id
            ORDER BY b.rank DESC, t.updated_at DESC
            LIMIT ?
        ";
        $binds = [$q, $limit];
    }

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($binds);
        json_response(['results' => $stmt->fetchAll(), 'query' => $q, 'fuzzy' => $hasTrgm]);
    } catch (\PDOException $e) {
        error_response('Search failed: ' . $e->getMessage(), 500);
    }
}

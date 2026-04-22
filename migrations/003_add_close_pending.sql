-- Migration 003: Add close_pending status

BEGIN;

ALTER TABLE tickets
    DROP CONSTRAINT tickets_status_check;

ALTER TABLE tickets
    ADD CONSTRAINT tickets_status_check
    CHECK (status IN (
        'open','in_progress','customer_pending',
        'monitoring','resolved','close_pending','closed'
    ));

COMMIT;

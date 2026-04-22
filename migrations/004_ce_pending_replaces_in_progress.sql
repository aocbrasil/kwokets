-- Migration 004: Replace in_progress with ce_pending

BEGIN;

-- Drop old constraint
ALTER TABLE tickets DROP CONSTRAINT tickets_status_check;

-- Migrate existing data
UPDATE tickets SET status = 'ce_pending' WHERE status = 'in_progress';
UPDATE ticket_status_log SET old_status = 'ce_pending' WHERE old_status = 'in_progress';
UPDATE ticket_status_log SET new_status = 'ce_pending' WHERE new_status = 'in_progress';

-- Add new constraint
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
    CHECK (status IN (
        'open','ce_pending','customer_pending',
        'monitoring','resolved','close_pending','closed'
    ));

COMMIT;

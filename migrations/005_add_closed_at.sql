-- Migration 005: Add closed_at to tickets

BEGIN;

ALTER TABLE tickets ADD COLUMN closed_at TIMESTAMPTZ;

-- Backfill: closed tickets get closed_at = updated_at as best estimate
UPDATE tickets SET closed_at = updated_at WHERE status = 'closed';

COMMIT;

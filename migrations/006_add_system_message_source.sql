-- Migration 006: Allow source='system' in ticket_messages for auto status-change notes

BEGIN;

ALTER TABLE ticket_messages
    DROP CONSTRAINT ticket_messages_source_check;

ALTER TABLE ticket_messages
    ADD CONSTRAINT ticket_messages_source_check
        CHECK (source IN ('web', 'email', 'system'));

COMMIT;

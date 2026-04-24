BEGIN;

ALTER TABLE tickets
  DROP CONSTRAINT tickets_status_check,
  ADD CONSTRAINT tickets_status_check
    CHECK (status IN ('open','ce_pending','customer_pending','monitoring','third_party_pending','resolved','close_pending','closed'));

COMMIT;

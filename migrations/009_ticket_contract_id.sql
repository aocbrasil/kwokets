BEGIN;

ALTER TABLE tickets
  ADD COLUMN contract_id INTEGER REFERENCES tenant_contracts(id) ON DELETE SET NULL;

CREATE INDEX idx_tickets_contract ON tickets(contract_id) WHERE contract_id IS NOT NULL;

COMMIT;

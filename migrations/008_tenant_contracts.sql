BEGIN;

CREATE TABLE tenant_contracts (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contract_code   VARCHAR(100) NOT NULL,
    tier            VARCHAR(20) NOT NULL CHECK (tier IN ('basic', 'standard', 'prime')),
    start_date      DATE NOT NULL,
    end_date        DATE,
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT,
    customer_terms  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, contract_code)
);

CREATE TABLE contract_sla_rules (
    id                      SERIAL PRIMARY KEY,
    contract_id             INTEGER NOT NULL REFERENCES tenant_contracts(id) ON DELETE CASCADE,
    priority                VARCHAR(5) NOT NULL CHECK (priority IN ('p1', 'p2', 'p3', 'p4')),
    first_response_minutes  INTEGER NOT NULL CHECK (first_response_minutes > 0),
    resolution_minutes      INTEGER NOT NULL CHECK (resolution_minutes > 0),
    warn_before_minutes     INTEGER NOT NULL DEFAULT 30 CHECK (warn_before_minutes > 0),

    UNIQUE (contract_id, priority)
);

CREATE INDEX idx_tenant_contracts_tenant ON tenant_contracts(tenant_id);
CREATE INDEX idx_contract_sla_contract   ON contract_sla_rules(contract_id);

CREATE TRIGGER trg_tenant_contracts_updated_at
    BEFORE UPDATE ON tenant_contracts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

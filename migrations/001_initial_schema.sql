-- Migration 001: Initial Schema
-- Ticketing System

BEGIN;

-- Tenants
CREATE TABLE tenants (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users (all roles)
CREATE TABLE users (
    id                       SERIAL PRIMARY KEY,
    tenant_id                INTEGER REFERENCES tenants(id) ON DELETE RESTRICT,
    email                    VARCHAR(255) NOT NULL UNIQUE,
    full_name                VARCHAR(255) NOT NULL,
    role                     VARCHAR(20) NOT NULL CHECK (role IN ('super_admin','supervisor','agent','customer')),
    auth_type                VARCHAR(10) NOT NULL CHECK (auth_type IN ('ldap','local')),
    password_hash            VARCHAR(255),
    ldap_dn                  VARCHAR(512),
    support_contract_number  VARCHAR(255),
    session_timeout_minutes  INTEGER,
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_customer_has_tenant
        CHECK (role != 'customer' OR tenant_id IS NOT NULL),
    CONSTRAINT chk_customer_has_contract
        CHECK (role != 'customer' OR (support_contract_number IS NOT NULL AND support_contract_number <> '')),
    CONSTRAINT chk_local_has_password
        CHECK (auth_type != 'local' OR password_hash IS NOT NULL),
    CONSTRAINT chk_ldap_has_dn
        CHECK (auth_type != 'ldap' OR ldap_dn IS NOT NULL),
    CONSTRAINT chk_staff_no_tenant
        CHECK (role = 'customer' OR tenant_id IS NULL)
);

-- Ticket ID sequence starting at 600000001
CREATE SEQUENCE ticket_id_seq START WITH 600000001 INCREMENT BY 1;

-- Tickets
CREATE TABLE tickets (
    id                  BIGINT PRIMARY KEY DEFAULT nextval('ticket_id_seq'),
    tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    subject             VARCHAR(500) NOT NULL,
    description         TEXT NOT NULL,
    priority            VARCHAR(5) NOT NULL CHECK (priority IN ('p1','p2','p3','p4')),
    status              VARCHAR(20) NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','in_progress','customer_pending','monitoring','resolved','closed')),
    created_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source              VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (source IN ('web','email')),
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ticket messages (visible + internal notes)
CREATE TABLE ticket_messages (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body        TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    source      VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (source IN ('web','email')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Attachments
CREATE TABLE ticket_attachments (
    id                BIGSERIAL PRIMARY KEY,
    ticket_id         BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    message_id        BIGINT REFERENCES ticket_messages(id) ON DELETE CASCADE,
    original_filename VARCHAR(512) NOT NULL,
    mime_type         VARCHAR(255) NOT NULL,
    size_bytes        BIGINT NOT NULL,
    storage_path      VARCHAR(1024) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SLA rules (per tenant, per priority)
CREATE TABLE sla_rules (
    id                     SERIAL PRIMARY KEY,
    tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    priority               VARCHAR(5) NOT NULL CHECK (priority IN ('p1','p2','p3','p4')),
    first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes > 0),
    resolution_minutes     INTEGER NOT NULL CHECK (resolution_minutes > 0),
    warn_before_minutes    INTEGER NOT NULL DEFAULT 30 CHECK (warn_before_minutes > 0),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, priority)
);

-- SLA tracking per ticket
CREATE TABLE ticket_sla (
    id                              BIGSERIAL PRIMARY KEY,
    ticket_id                       BIGINT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    first_response_due_at           TIMESTAMPTZ NOT NULL,
    resolution_due_at               TIMESTAMPTZ NOT NULL,
    first_response_met_at           TIMESTAMPTZ,
    warn_first_response_sent        BOOLEAN NOT NULL DEFAULT FALSE,
    warn_resolution_sent            BOOLEAN NOT NULL DEFAULT FALSE,
    breach_first_response_notified  BOOLEAN NOT NULL DEFAULT FALSE,
    breach_resolution_notified      BOOLEAN NOT NULL DEFAULT FALSE
);

-- SLA pause intervals (customer_pending + monitoring states)
CREATE TABLE sla_pause_log (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    paused_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resumed_at  TIMESTAMPTZ
);

-- Status audit trail
CREATE TABLE ticket_status_log (
    id                  BIGSERIAL PRIMARY KEY,
    ticket_id           BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    changed_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    old_status          VARCHAR(20),
    new_status          VARCHAR(20) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- In-app notifications
CREATE TABLE notifications (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL CHECK (type IN (
                    'sla_warn_first_response',
                    'sla_warn_resolution',
                    'sla_breach_first_response',
                    'sla_breach_resolution'
                )),
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(128) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Processed emails (deduplication)
CREATE TABLE email_poll_log (
    id               BIGSERIAL PRIMARY KEY,
    message_id_header VARCHAR(512) NOT NULL UNIQUE,
    ticket_id        BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    action           VARCHAR(20) NOT NULL CHECK (action IN ('replied','discarded','rejected')),
    processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tickets_tenant_status    ON tickets(tenant_id, status);
CREATE INDEX idx_tickets_assigned         ON tickets(assigned_to_user_id);
CREATE INDEX idx_tickets_created_by       ON tickets(created_by_user_id);
CREATE INDEX idx_tickets_resolved_at      ON tickets(resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX idx_ticket_messages_ticket   ON ticket_messages(ticket_id);
CREATE INDEX idx_ticket_attachments_msg   ON ticket_attachments(message_id);
CREATE INDEX idx_sla_pause_ticket         ON sla_pause_log(ticket_id);
CREATE INDEX idx_status_log_ticket        ON ticket_status_log(ticket_id);
CREATE INDEX idx_notifications_user       ON notifications(user_id, read_at);
CREATE INDEX idx_sessions_token           ON sessions(token_hash);
CREATE INDEX idx_sessions_user            ON sessions(user_id);
CREATE INDEX idx_users_email              ON users(email);
CREATE INDEX idx_users_tenant             ON users(tenant_id) WHERE tenant_id IS NOT NULL;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sla_rules_updated_at
    BEFORE UPDATE ON sla_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

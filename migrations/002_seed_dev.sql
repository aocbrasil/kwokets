-- Development seed: super_admin user
-- Password: Admin1234!
-- Run ONLY in development. Do not run in production.

BEGIN;

INSERT INTO users (email, full_name, role, auth_type, password_hash)
VALUES (
    'admin@localhost',
    'Super Admin',
    'super_admin',
    'local',
    '$2y$12$WCyq1Ph1JYdSdJRZqQrEeuzH8/nazWsgV.RjBABBGy8DhQ5Rlfe5e'
)
ON CONFLICT (email) DO NOTHING;

COMMIT;

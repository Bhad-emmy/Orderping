-- Remove privileges that authenticated clients do not need.
-- RLS does not protect tables from TRUNCATE, so keep it unavailable to client roles.
REVOKE TRUNCATE, TRIGGER, REFERENCES
ON ALL TABLES IN SCHEMA orderping
FROM anon, authenticated;

-- Apply the same restriction to future tables created by the schema owner.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA orderping
REVOKE TRUNCATE, TRIGGER, REFERENCES
ON TABLES FROM anon, authenticated;

-- PostgreSQL 17 includes MAINTAIN as a table privilege.
-- Client roles do not need it on OrderPing application tables.
REVOKE MAINTAIN
ON ALL TABLES IN SCHEMA orderping
FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA orderping
REVOKE MAINTAIN
ON TABLES FROM anon, authenticated;

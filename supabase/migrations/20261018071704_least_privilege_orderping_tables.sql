BEGIN;
-- Order line items and notification logs are read-only to vendor clients.
-- Trusted Edge Functions use the service role to create/manage these records.
REVOKE INSERT, UPDATE, DELETE ON TABLE orderping.order_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE orderping.notification_logs FROM authenticated;

-- Payment records are append-only from the vendor UI.
REVOKE UPDATE, DELETE ON TABLE orderping.payment_records FROM authenticated;

-- Fail closed for future tables: every migration must explicitly grant the
-- smallest set of client privileges required by that table.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA orderping
REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
COMMIT;

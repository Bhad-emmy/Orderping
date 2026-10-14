-- Secure, shareable customer access for guest orders.
-- Store only a SHA-256 hash; the raw token is returned once at order creation.
alter table orderping.orders
  add column if not exists customer_access_token_hash text unique
  check (
    customer_access_token_hash is null
    or customer_access_token_hash ~ '^[a-f0-9]{64}$'
  );

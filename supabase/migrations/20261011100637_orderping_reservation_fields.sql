-- Add a distinct reservation record shape to the OrderPing order ledger.
alter table orderping.orders
  add column if not exists order_type text not null default 'order',
  add column if not exists requested_pickup_at timestamptz,
  add column if not exists idempotency_key text;

alter table orderping.orders
  add constraint orders_order_type_check
  check (order_type in ('order', 'reservation'));

alter table orderping.orders
  add constraint orders_requested_pickup_check
  check (
    (order_type = 'order' and requested_pickup_at is null)
    or (order_type = 'reservation' and requested_pickup_at is not null)
  );

create unique index if not exists orders_business_idempotency_key_uidx
  on orderping.orders (business_id, idempotency_key)
  where idempotency_key is not null;

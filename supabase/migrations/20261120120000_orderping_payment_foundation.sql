-- OrderPing commerce foundation: vendor settlement accounts and payment lifecycle.
-- Additive only. Existing orders and payment_records remain the operational ledger.

create table if not exists orderping.vendor_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references orderping.businesses(id) on delete cascade,
  provider text not null default 'flutterwave'
    check (provider in ('flutterwave')),
  provider_subaccount_id text,
  bank_code text,
  account_name text,
  account_number_last4 text
    check (account_number_last4 is null or account_number_last4 ~ '^[0-9]{4}$'),
  settlement_currency char(3) not null default 'NGN',
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'failed')),
  verification_reference text,
  verified_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_payment_accounts_business_provider_unique
    unique (business_id, provider),
  constraint vendor_payment_accounts_provider_subaccount_unique
    unique (provider, provider_subaccount_id)
);

create table if not exists orderping.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references orderping.businesses(id) on delete restrict,
  order_id uuid not null references orderping.orders(id) on delete restrict,
  vendor_payment_account_id uuid references orderping.vendor_payment_accounts(id) on delete restrict,
  provider text not null default 'flutterwave'
    check (provider in ('flutterwave')),
  tx_ref text not null unique,
  provider_transaction_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code char(3) not null default 'NGN',
  status text not null default 'initiated'
    check (status in ('initiated', 'pending', 'successful', 'failed', 'cancelled', 'reversed')),
  checkout_url text,
  customer_email text,
  provider_fee_minor bigint check (provider_fee_minor is null or provider_fee_minor >= 0),
  platform_fee_minor bigint check (platform_fee_minor is null or platform_fee_minor >= 0),
  failure_code text,
  failure_message text,
  provider_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_metadata) = 'object'),
  payment_record_id uuid,
  initiated_at timestamptz not null default now(),
  paid_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transactions_business_order_unique
    unique (id, business_id, order_id)
);

create unique index if not exists payment_transactions_provider_id_unique
  on orderping.payment_transactions(provider, provider_transaction_id)
  where provider_transaction_id is not null;

create index if not exists payment_transactions_business_created_idx
  on orderping.payment_transactions(business_id, created_at desc);

create index if not exists payment_transactions_order_created_idx
  on orderping.payment_transactions(order_id, created_at desc);

create table if not exists orderping.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'flutterwave'
    check (provider in ('flutterwave')),
  provider_event_id text not null,
  event_type text not null,
  payload_hash text not null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_webhook_events_provider_event_unique
    unique (provider, provider_event_id)
);

create index if not exists payment_webhook_events_status_received_idx
  on orderping.payment_webhook_events(processing_status, received_at);

alter table orderping.payment_transactions
  add constraint payment_transactions_payment_record_fk
  foreign key (payment_record_id)
  references orderping.payment_records(id)
  on delete restrict;

alter table orderping.payment_transactions
  add constraint payment_transactions_record_unique
  unique (payment_record_id);

alter table orderping.vendor_payment_accounts enable row level security;
alter table orderping.payment_transactions enable row level security;
alter table orderping.payment_webhook_events enable row level security;

drop policy if exists "Business owners view their payment account"
  on orderping.vendor_payment_accounts;
create policy "Business owners view their payment account"
  on orderping.vendor_payment_accounts
  for select to authenticated
  using (
    exists (
      select 1 from orderping.businesses b
      where b.id = vendor_payment_accounts.business_id
        and b.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Business owners view their payment transactions"
  on orderping.payment_transactions;
create policy "Business owners view their payment transactions"
  on orderping.payment_transactions
  for select to authenticated
  using (
    exists (
      select 1 from orderping.businesses b
      where b.id = payment_transactions.business_id
        and b.owner_id = (select auth.uid())
    )
  );

revoke all on orderping.vendor_payment_accounts from anon, authenticated;
revoke all on orderping.payment_transactions from anon, authenticated;
revoke all on orderping.payment_webhook_events from anon, authenticated;

grant select on orderping.vendor_payment_accounts to authenticated;
grant select on orderping.payment_transactions to authenticated;

revoke all on orderping.vendor_payment_accounts from public;
revoke all on orderping.payment_transactions from public;
revoke all on orderping.payment_webhook_events from public;

grant all on orderping.vendor_payment_accounts to service_role;
grant all on orderping.payment_transactions to service_role;
grant all on orderping.payment_webhook_events to service_role;

comment on table orderping.vendor_payment_accounts is
  'OrderPing provider-side vendor settlement account references. Full bank account numbers and secrets must not be stored here.';
comment on table orderping.payment_transactions is
  'OrderPing hosted-checkout transaction lifecycle. Successful payments must be independently verified server-side before entering payment_records.';
comment on table orderping.payment_webhook_events is
  'Idempotency and processing log for verified payment-provider webhook events; service-role only.';

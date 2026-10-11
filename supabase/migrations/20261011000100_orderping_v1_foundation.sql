-- OrderPing V1: core schema and security baseline
-- Apply with Supabase CLI after linking the intended project.
-- Amounts are integer minor units (NGN kobo by default); never use float for money.

create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  business_type text not null check (business_type in ('service', 'product', 'mixed')),
  email text,
  whatsapp_number text,
  timezone text not null default 'Africa/Lagos',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check (type in ('service', 'product')),
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text,
  price_minor bigint not null check (price_minor >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 1440),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_duration_by_type check (
    (type = 'service' and duration_minutes is not null)
    or (type = 'product' and duration_minutes is null)
  )
);

create index if not exists catalog_items_business_active_idx
  on public.catalog_items(business_id, is_active);

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  unique (business_id, weekday),
  check (
    (is_closed = true and opens_at is null and closes_at is null)
    or
    (is_closed = false and opens_at is not null and closes_at is not null and opens_at < closes_at)
  )
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id) on delete restrict,
  customer_name text not null check (char_length(trim(customer_name)) between 1 and 120),
  customer_email text,
  customer_phone text not null check (char_length(trim(customer_phone)) between 5 and 32),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  amount_paid_minor bigint not null default 0
    check (amount_paid_minor >= 0 and amount_paid_minor <= total_amount_minor),
  currency_code char(3) not null default 'NGN',
  customer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists appointments_business_start_idx
  on public.appointments(business_id, starts_at);
create index if not exists appointments_business_status_idx
  on public.appointments(business_id, status);

-- Serialize booking checks per business to prevent simultaneous overlapping submissions.
create or replace function public.prevent_appointment_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text, 0));

  if new.status in ('pending', 'confirmed') and exists (
    select 1
    from public.appointments a
    where a.business_id = new.business_id
      and a.id is distinct from new.id
      and a.status in ('pending', 'confirmed')
      and a.starts_at < new.ends_at
      and a.ends_at > new.starts_at
  ) then
    raise exception 'This appointment slot is no longer available'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_prevent_overlap on public.appointments;
create trigger appointments_prevent_overlap
before insert or update of business_id, starts_at, ends_at, status
on public.appointments
for each row execute function public.prevent_appointment_overlap();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_name text not null check (char_length(trim(customer_name)) between 1 and 120),
  customer_email text,
  customer_phone text not null check (char_length(trim(customer_phone)) between 5 and 32),
  status text not null default 'new'
    check (status in ('new', 'processing', 'ready', 'dispatched', 'delivered', 'cancelled')),
  total_amount_minor bigint not null default 0 check (total_amount_minor >= 0),
  amount_paid_minor bigint not null default 0
    check (amount_paid_minor >= 0 and amount_paid_minor <= total_amount_minor),
  currency_code char(3) not null default 'NGN',
  fulfilment_method text not null check (fulfilment_method in ('delivery', 'collection')),
  customer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_business_created_idx
  on public.orders(business_id, created_at desc);
create index if not exists orders_business_status_idx
  on public.orders(business_id, status);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  catalog_item_id uuid references public.catalog_items(id) on delete set null,
  item_name text not null,
  quantity integer not null check (quantity between 1 and 1000),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null,
  recipient text not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed')),
  dedupe_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists notification_logs_business_created_idx
  on public.notification_logs(business_id, created_at desc);
create index if not exists notification_logs_retry_idx
  on public.notification_logs(status, created_at)
  where status in ('queued', 'failed');

-- Fixed-window, atomic rate-limit counters. Keys must be server-generated hashes,
-- e.g. hash(route + trusted client IP); never accept a raw client-chosen key.
create table if not exists public.rate_limit_buckets (
  bucket_key text primary key check (char_length(bucket_key) between 1 and 256),
  window_start timestamptz not null,
  request_count integer not null check (request_count >= 1),
  updated_at timestamptz not null default now()
);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer, request_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or char_length(p_bucket_key) < 1 or char_length(p_bucket_key) > 256
     or p_limit < 1 or p_limit > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit arguments' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_buckets as existing
    (bucket_key, window_start, request_count, updated_at)
  values
    (p_bucket_key, v_window_start, 1, clock_timestamp())
  on conflict (bucket_key) do update
    set window_start = excluded.window_start,
        request_count = case
          when existing.window_start = excluded.window_start then existing.request_count + 1
          else 1
        end,
        updated_at = clock_timestamp()
  returning existing.request_count into v_count;

  return query
    select
      v_count <= p_limit,
      greatest(
        1,
        ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - clock_timestamp())))::integer
      ),
      v_count;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Enable RLS everywhere. No anonymous direct writes: public booking/order submissions
-- must pass through validated, rate-limited Supabase Edge Functions using server secrets.
alter table public.businesses enable row level security;
alter table public.catalog_items enable row level security;
alter table public.business_hours enable row level security;
alter table public.appointments enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.notification_logs enable row level security;

create policy "Owners manage their businesses"
  on public.businesses for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners manage their catalogue"
  on public.catalog_items for all to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ));

create policy "Owners manage their business hours"
  on public.business_hours for all to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ));

create policy "Owners view and manage their appointments"
  on public.appointments for all to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ));

create policy "Owners view and manage their orders"
  on public.orders for all to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ));

create policy "Owners view items for their orders"
  on public.order_items for select to authenticated
  using (exists (
    select 1
    from public.orders o
    join public.businesses b on b.id = o.business_id
    where o.id = order_id and b.owner_id = (select auth.uid())
  ));

create policy "Owners view notification logs for their business"
  on public.notification_logs for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ));

-- The service role bypasses RLS and is used only in trusted Edge Functions.
-- Public catalogue reads and public submissions will be exposed through narrowly
-- scoped Edge Functions; do not add anon SELECT/INSERT policies to private tables.

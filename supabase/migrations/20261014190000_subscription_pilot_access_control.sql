-- OrderPing subscriptions: 5-business pilot and platform-owner-only administration.
-- Deliberately does not seed an administrator: the platform owner's auth.users UUID
-- must be explicitly verified and inserted into orderping.platform_admins before use.

create table if not exists orderping.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('starter', 'growth', 'pro')),
  name text not null,
  monthly_price_minor bigint not null check (monthly_price_minor >= 0),
  currency_code char(3) not null default 'NGN',
  is_active boolean not null default true,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into orderping.subscription_plans (code, name, monthly_price_minor, currency_code, features)
values
  ('starter', 'Starter', 300000, 'NGN', '{"orders":true,"tracking":true,"payment_records":true}'::jsonb),
  ('growth', 'Growth', 600000, 'NGN', '{"orders":true,"tracking":true,"payment_records":true,"reporting":"expanded"}'::jsonb),
  ('pro', 'Business Pro', 1200000, 'NGN', '{"orders":true,"tracking":true,"payment_records":true,"reporting":"advanced","staff_accounts":true}'::jsonb)
on conflict (code) do nothing;

create table if not exists orderping.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists orderping.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references orderping.businesses(id) on delete cascade,
  plan_id uuid references orderping.subscription_plans(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','pilot','active','grace_period','expired','suspended','cancelled')),
  pilot_started_at timestamptz,
  pilot_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  grace_period_ends_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'pilot') or (pilot_started_at is not null and pilot_ends_at is not null and pilot_ends_at > pilot_started_at)),
  check ((status not in ('active','grace_period')) or plan_id is not null)
);

create index if not exists business_subscriptions_status_expiry_idx
  on orderping.business_subscriptions(status, current_period_ends_at, pilot_ends_at);

create table if not exists orderping.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references orderping.businesses(id) on delete cascade,
  subscription_id uuid not null references orderping.business_subscriptions(id) on delete cascade,
  plan_id uuid not null references orderping.subscription_plans(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code char(3) not null default 'NGN',
  method text not null check (method in ('bank_transfer','paystack','other')),
  reference text not null unique,
  status text not null default 'pending' check (status in ('pending','verified','rejected','refunded')),
  paid_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  period_starts_at timestamptz,
  period_ends_at timestamptz,
  proof_note text,
  created_at timestamptz not null default now(),
  check (period_ends_at is null or period_starts_at is null or period_ends_at > period_starts_at)
);

create index if not exists subscription_payments_business_created_idx
  on orderping.subscription_payments(business_id, created_at desc);

create table if not exists orderping.subscription_audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references orderping.businesses(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(trim(action)) between 1 and 80),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscription_audit_logs_business_created_idx
  on orderping.subscription_audit_logs(business_id, created_at desc);

alter table orderping.subscription_plans enable row level security;
alter table orderping.platform_admins enable row level security;
alter table orderping.business_subscriptions enable row level security;
alter table orderping.subscription_payments enable row level security;
alter table orderping.subscription_audit_logs enable row level security;

revoke all on orderping.platform_admins from anon, authenticated;
revoke all on orderping.subscription_audit_logs from anon, authenticated;
revoke all on orderping.business_subscriptions from anon, authenticated;
revoke all on orderping.subscription_payments from anon, authenticated;
revoke all on orderping.subscription_plans from anon, authenticated;

grant select on orderping.subscription_plans to authenticated;
grant select on orderping.business_subscriptions to authenticated;
grant select on orderping.subscription_payments to authenticated;
grant select on orderping.subscription_audit_logs to authenticated;
grant all on orderping.subscription_plans, orderping.platform_admins,
  orderping.business_subscriptions, orderping.subscription_payments,
  orderping.subscription_audit_logs to service_role;

drop policy if exists "Authenticated users read active subscription plans" on orderping.subscription_plans;
create policy "Authenticated users read active subscription plans"
  on orderping.subscription_plans for select to authenticated using (is_active);

drop policy if exists "Business owners read their subscription" on orderping.business_subscriptions;
create policy "Business owners read their subscription"
  on orderping.business_subscriptions for select to authenticated
  using (exists (
    select 1 from orderping.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ) or exists (
    select 1 from orderping.platform_admins a
    where a.user_id = (select auth.uid()) and a.role = 'owner'
  ));

drop policy if exists "Business owners read their subscription payments" on orderping.subscription_payments;
create policy "Business owners read their subscription payments"
  on orderping.subscription_payments for select to authenticated
  using (exists (
    select 1 from orderping.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ) or exists (
    select 1 from orderping.platform_admins a
    where a.user_id = (select auth.uid()) and a.role = 'owner'
  ));

drop policy if exists "Platform owner reads subscription audit logs" on orderping.subscription_audit_logs;
create policy "Platform owner reads subscription audit logs"
  on orderping.subscription_audit_logs for select to authenticated
  using (exists (
    select 1 from orderping.platform_admins a
    where a.user_id = (select auth.uid()) and a.role = 'owner'
  ));

-- Atomic approval: serializes pilot-slot allocation and allows only the platform owner.
create or replace function orderping.approve_business_pilot(p_business_id uuid, p_days integer default 14)
returns orderping.business_subscriptions
language plpgsql
security definer
set search_path = pg_catalog, orderping, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_sub orderping.business_subscriptions;
  v_count integer;
begin
  if v_actor is null or not exists (
    select 1 from orderping.platform_admins a where a.user_id = v_actor and a.role = 'owner'
  ) then
    raise exception 'Only the platform owner can approve pilot businesses' using errcode = '42501';
  end if;
  if p_days < 1 or p_days > 30 then
    raise exception 'Pilot duration must be between 1 and 30 days' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('orderping-five-business-pilot', 0));

  if not exists (select 1 from orderping.businesses b where b.id = p_business_id) then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  select count(*) into v_count
  from orderping.business_subscriptions s
  where s.status = 'pilot'
    and s.pilot_ends_at > clock_timestamp();

  if v_count >= 5 and not exists (
    select 1 from orderping.business_subscriptions s
    where s.business_id = p_business_id and s.status = 'pilot'
  ) then
    raise exception 'All five active pilot slots are occupied' using errcode = '23514';
  end if;

  insert into orderping.business_subscriptions
    (business_id, status, pilot_started_at, pilot_ends_at, approved_by, approved_at)
  values
    (p_business_id, 'pilot', clock_timestamp(), clock_timestamp() + make_interval(days => p_days), v_actor, clock_timestamp())
  on conflict (business_id) do update
    set status = 'pilot',
        pilot_started_at = excluded.pilot_started_at,
        pilot_ends_at = excluded.pilot_ends_at,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = clock_timestamp()
  returning * into v_sub;

  insert into orderping.subscription_audit_logs (business_id, actor_user_id, action, details)
  values (p_business_id, v_actor, 'pilot_approved', jsonb_build_object('days', p_days, 'pilot_ends_at', v_sub.pilot_ends_at));

  return v_sub;
end;
$$;

-- Entitlement read for a business owner; all writes remain in trusted server-side operations.
create or replace function orderping.get_my_business_access(p_business_id uuid)
returns table (subscription_status text, can_manage boolean, access_until timestamptz, plan_code text)
language sql
stable
security definer
set search_path = pg_catalog, orderping, public, pg_temp
as $$
  select
    case
      when s.status = 'pilot' and s.pilot_ends_at > now() then 'pilot'
      when s.status = 'active' and s.current_period_ends_at > now() then 'active'
      when s.status = 'grace_period' and s.grace_period_ends_at > now() then 'grace_period'
      when s.status = 'suspended' then 'suspended'
      when s.status = 'cancelled' then 'cancelled'
      else 'expired'
    end,
    (
      (s.status = 'pilot' and s.pilot_ends_at > now())
      or (s.status = 'active' and s.current_period_ends_at > now())
      or (s.status = 'grace_period' and s.grace_period_ends_at > now())
    ),
    case when s.status = 'pilot' then s.pilot_ends_at
         when s.status = 'grace_period' then s.grace_period_ends_at
         else s.current_period_ends_at end,
    p.code
  from orderping.businesses b
  left join orderping.business_subscriptions s on s.business_id = b.id
  left join orderping.subscription_plans p on p.id = s.plan_id
  where b.id = p_business_id and b.owner_id = auth.uid()
$$;

revoke all on function orderping.approve_business_pilot(uuid, integer) from public, anon;
grant execute on function orderping.approve_business_pilot(uuid, integer) to authenticated, service_role;
revoke all on function orderping.get_my_business_access(uuid) from public, anon;
grant execute on function orderping.get_my_business_access(uuid) to authenticated;

comment on table orderping.platform_admins is 'Platform owner allowlist. Never expose writes to client roles; seed only after verifying the owner's auth.users UUID.';
comment on function orderping.approve_business_pilot(uuid, integer) is 'Owner-only, atomic approval enforcing at most five unexpired pilot businesses.';

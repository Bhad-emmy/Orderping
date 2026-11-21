-- OrderPing subscription entitlements and server-side usage enforcement.
-- Scope: orderping schema only. This migration is committed for review; it is not applied to Supabase here.

create table if not exists orderping.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references orderping.businesses(id) on delete cascade,
  plan_code text not null check (plan_code in ('basic', 'growth', 'business', 'legacy')),
  billing_interval text not null check (billing_interval in ('monthly', 'annual', 'legacy')),
  status text not null check (status in ('trialing', 'active', 'expired', 'cancelled', 'legacy')),
  monthly_price_ngn integer not null check (monthly_price_ngn >= 0),
  annual_price_ngn integer not null check (annual_price_ngn >= 0),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start),
  check ((status = 'trialing' and trial_ends_at is not null) or status <> 'trialing')
);

create index if not exists business_subscriptions_status_period_idx
  on orderping.business_subscriptions(status, current_period_end);

alter table orderping.business_subscriptions enable row level security;
revoke all on orderping.business_subscriptions from public, anon, authenticated;
grant select on orderping.business_subscriptions to authenticated;
grant all on orderping.business_subscriptions to service_role;

drop policy if exists "Owners read their subscription" on orderping.business_subscriptions;
create policy "Owners read their subscription"
  on orderping.business_subscriptions for select to authenticated
  using (exists (
    select 1 from orderping.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  ));

-- Existing vendors are grandfathered so the new limits do not unexpectedly
-- restrict stores created before subscription selection is introduced.
insert into orderping.business_subscriptions (
  business_id, plan_code, billing_interval, status,
  monthly_price_ngn, annual_price_ngn,
  current_period_start, current_period_end
)
select b.id, 'legacy', 'legacy', 'legacy', 0, 0,
       now(), now() + interval '100 years'
from orderping.businesses b
on conflict (business_id) do nothing;

create or replace function orderping.start_basic_trial(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, orderping, pg_temp
as $$
declare
  v_business orderping.businesses%rowtype;
  v_subscription orderping.business_subscriptions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_business
  from orderping.businesses
  where id = p_business_id and owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  if v_business.approval_status = 'rejected' then
    raise exception 'This store cannot start a trial. Contact support.' using errcode = '42501';
  end if;

  select * into v_subscription
  from orderping.business_subscriptions
  where business_id = p_business_id
  for update;

  if found then
    if v_subscription.plan_code = 'basic' and v_subscription.status = 'trialing' then
      return jsonb_build_object(
        'success', true, 'plan', 'basic', 'status', 'trialing',
        'trial_ends_at', v_subscription.trial_ends_at, 'already_started', true
      );
    end if;
    raise exception 'A subscription already exists for this business' using errcode = '23505';
  end if;

  insert into orderping.business_subscriptions (
    business_id, plan_code, billing_interval, status,
    monthly_price_ngn, annual_price_ngn,
    current_period_start, current_period_end, trial_ends_at
  ) values (
    p_business_id, 'basic', 'monthly', 'trialing',
    2999, 28790, v_now, v_now + interval '10 days', v_now + interval '10 days'
  )
  returning * into v_subscription;

  -- Starting the Basic trial is the vendor's explicit activation action.
  -- It replaces the former manual ₦2,500 fee/PIN gate for new trial stores.
  update orderping.businesses
  set approval_status = 'approved',
      approved_at = v_now,
      approved_by = null,
      updated_at = v_now
  where id = p_business_id;

  return jsonb_build_object(
    'success', true, 'plan', 'basic', 'status', 'trialing',
    'trial_ends_at', v_subscription.trial_ends_at, 'already_started', false
  );
end;
$$;

revoke all on function orderping.start_basic_trial(uuid) from public, anon;
grant execute on function orderping.start_basic_trial(uuid) to authenticated;

create or replace function orderping.get_subscription_usage(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, orderping, pg_temp
as $$
declare
  v_sub orderping.business_subscriptions%rowtype;
  v_product_count integer;
  v_order_count integer;
  v_appointment_count integer;
  v_period_start timestamptz := date_trunc('month', now());
  v_plan_limits jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from orderping.businesses b
    where b.id = p_business_id and b.owner_id = auth.uid()
  ) then
    raise exception 'Business not found' using errcode = '42501';
  end if;

  select * into v_sub from orderping.business_subscriptions where business_id = p_business_id;
  if not found then
    raise exception 'Subscription not found' using errcode = 'P0002';
  end if;

  v_plan_limits := case v_sub.plan_code
    when 'basic' then jsonb_build_object('products_services', 30, 'orders', 100, 'appointments', 20)
    when 'growth' then jsonb_build_object('products_services', 300, 'orders', 1000, 'appointments', 300)
    when 'business' then jsonb_build_object('products_services', null, 'orders', null, 'appointments', null)
    else jsonb_build_object('products_services', null, 'orders', null, 'appointments', null)
  end;

  select count(*)::integer into v_product_count
  from orderping.catalog_items where business_id = p_business_id and is_active = true;

  select count(*)::integer into v_order_count
  from orderping.orders where business_id = p_business_id and created_at >= v_period_start;

  select count(*)::integer into v_appointment_count
  from orderping.appointments where business_id = p_business_id and created_at >= v_period_start;

  return jsonb_build_object(
    'plan', v_sub.plan_code,
    'status', case when v_sub.status = 'trialing' and v_sub.trial_ends_at <= now() then 'expired' else v_sub.status end,
    'billing_interval', v_sub.billing_interval,
    'monthly_price_ngn', v_sub.monthly_price_ngn,
    'annual_price_ngn', v_sub.annual_price_ngn,
    'trial_ends_at', v_sub.trial_ends_at,
    'period_start', v_period_start,
    'products_services', jsonb_build_object('used', v_product_count, 'limit', v_plan_limits->'products_services'),
    'orders', jsonb_build_object('used', v_order_count, 'limit', v_plan_limits->'orders'),
    'appointments', jsonb_build_object('used', v_appointment_count, 'limit', v_plan_limits->'appointments'),
    'warning_threshold_percent', 80
  );
end;
$$;

revoke all on function orderping.get_subscription_usage(uuid) from public, anon;
grant execute on function orderping.get_subscription_usage(uuid) to authenticated;

create or replace function orderping.enforce_subscription_usage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, orderping, pg_temp
as $$
declare
  v_sub orderping.business_subscriptions%rowtype;
  v_limit integer;
  v_used integer;
  v_business_id uuid;
  v_period_start timestamptz := date_trunc('month', now());
begin
  v_business_id := case when tg_op = 'DELETE' then old.business_id else new.business_id end;

  -- Serialize concurrent usage changes for this business before counting.
  perform 1 from orderping.businesses where id = v_business_id for update;

  select * into v_sub
  from orderping.business_subscriptions
  where business_id = v_business_id;

  -- A missing subscription is not allowed to create new usage.
  if not found then
    raise exception 'Choose a subscription plan before using this feature'
      using errcode = 'P0001';
  end if;

  if v_sub.status in ('expired', 'cancelled')
     or (v_sub.status = 'trialing' and v_sub.trial_ends_at <= now())
     or (v_sub.status = 'active' and v_sub.current_period_end <= now()) then
    raise exception 'Your subscription has expired. Renew or upgrade to continue.'
      using errcode = 'P0001';
  end if;

  if tg_table_name = 'catalog_items' then
    if tg_op = 'UPDATE' and old.is_active = true and new.is_active = false then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.is_active = true and new.is_active = true then
      return new;
    end if;
    v_limit := case v_sub.plan_code when 'basic' then 30 when 'growth' then 300 else null end;
    if v_limit is not null then
      select count(*)::integer into v_used
      from orderping.catalog_items
      where business_id = v_business_id and is_active = true
        and (tg_op <> 'UPDATE' or id <> new.id);
      if v_used >= v_limit then
        raise exception 'You have reached your product and service limit for this plan. Upgrade to add more.'
          using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'orders' then
    v_limit := case v_sub.plan_code when 'basic' then 100 when 'growth' then 1000 else null end;
    if v_limit is not null then
      select count(*)::integer into v_used
      from orderping.orders
      where business_id = v_business_id and created_at >= v_period_start;
      if v_used >= v_limit then
        raise exception 'You have reached your monthly order limit. Upgrade to continue receiving orders.'
          using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'appointments' then
    v_limit := case v_sub.plan_code when 'basic' then 20 when 'growth' then 300 else null end;
    if v_limit is not null then
      select count(*)::integer into v_used
      from orderping.appointments
      where business_id = v_business_id and created_at >= v_period_start;
      if v_used >= v_limit then
        raise exception 'You have reached your monthly appointment limit. Upgrade to continue accepting appointments.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists catalog_items_subscription_limit on orderping.catalog_items;
create trigger catalog_items_subscription_limit
before insert or update of is_active on orderping.catalog_items
for each row execute function orderping.enforce_subscription_usage();

drop trigger if exists orders_subscription_limit on orderping.orders;
create trigger orders_subscription_limit
before insert on orderping.orders
for each row execute function orderping.enforce_subscription_usage();

drop trigger if exists appointments_subscription_limit on orderping.appointments;
create trigger appointments_subscription_limit
before insert on orderping.appointments
for each row execute function orderping.enforce_subscription_usage();

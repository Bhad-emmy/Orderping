-- OrderPing vendor approval gate. Existing stores stay approved; all newly-created stores are pending.
alter table orderping.businesses
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table orderping.businesses alter column approval_status set default 'pending';

-- Authenticated owners may not self-approve or edit approval audit fields.
create or replace function orderping.protect_business_approval_fields()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and
     (new.approval_status is distinct from old.approval_status
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by) then
    raise exception 'Only a platform administrator can change vendor approval'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_protect_approval_fields on orderping.businesses;
create trigger businesses_protect_approval_fields
before update on orderping.businesses
for each row execute function orderping.protect_business_approval_fields();

-- A vendor can create only a pending store; the existing owner policy continues to
-- support approved stores without permitting self-approval.
drop policy if exists "Owners manage their businesses" on orderping.businesses;
create policy "Owners read their businesses"
  on orderping.businesses for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners create pending businesses"
  on orderping.businesses for insert to authenticated
  with check (owner_id = (select auth.uid()) and approval_status = 'pending'
    and approved_at is null and approved_by is null);
create policy "Owners update their business details"
  on orderping.businesses for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Block vendor CRUD on workspace data until the owning store is approved.
drop policy if exists "Owners manage their catalogue" on orderping.catalog_items;
create policy "Approved owners manage their catalogue"
  on orderping.catalog_items for all to authenticated
  using (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'))
  with check (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'));

drop policy if exists "Owners manage their business hours" on orderping.business_hours;
create policy "Approved owners manage their business hours"
  on orderping.business_hours for all to authenticated
  using (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'))
  with check (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'));

drop policy if exists "Owners view and manage their appointments" on orderping.appointments;
create policy "Approved owners manage their appointments"
  on orderping.appointments for all to authenticated
  using (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'))
  with check (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'));

drop policy if exists "Owners view and manage their orders" on orderping.orders;
create policy "Approved owners manage their orders"
  on orderping.orders for all to authenticated
  using (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'))
  with check (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'));

drop policy if exists "Owners view items for their orders" on orderping.order_items;
create policy "Approved owners view items for their orders"
  on orderping.order_items for select to authenticated
  using (exists (select 1 from orderping.orders o join orderping.businesses b on b.id = o.business_id
    where o.id = order_id and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'));

drop policy if exists "Owners view notification logs for their business" on orderping.notification_logs;
create policy "Approved owners view notification logs for their business"
  on orderping.notification_logs for select to authenticated
  using (exists (select 1 from orderping.businesses b where b.id = business_id
    and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'));

-- Atomic server-side rate limiter used by public Edge Functions.
create table if not exists orderping.rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
revoke all on orderping.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on orderping.rate_limits to service_role;

create or replace function orderping.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
) returns table(allowed boolean, request_count integer)
language plpgsql
security definer
set search_path = pg_catalog, orderping
as $$
declare
  v_started timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or length(p_bucket_key) < 1 or length(p_bucket_key) > 200
    or p_limit < 1 or p_limit > 10000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;
  insert into orderping.rate_limits(bucket_key, window_started_at, request_count)
    values (p_bucket_key, clock_timestamp(), 1)
  on conflict (bucket_key) do update
    set window_started_at = case
          when orderping.rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
          then clock_timestamp() else orderping.rate_limits.window_started_at end,
        request_count = case
          when orderping.rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
          then 1 else orderping.rate_limits.request_count + 1 end
  returning orderping.rate_limits.window_started_at, orderping.rate_limits.request_count
    into v_started, v_count;
  return query select (v_count <= p_limit), v_count;
end;
$$;
revoke all on function orderping.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function orderping.consume_rate_limit(text, integer, integer) to service_role;

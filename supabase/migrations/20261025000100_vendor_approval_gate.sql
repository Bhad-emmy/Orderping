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

-- Payment records are part of the vendor workspace too; pending vendors must not
-- be able to read or insert payment ledger rows through the older policies.
drop policy if exists "Owners record payments for their orders" on orderping.payment_records;
create policy "Approved owners record payments for their orders"
  on orderping.payment_records for insert to authenticated
  with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from orderping.businesses b
      join orderping.orders o on o.business_id = b.id
      where b.id = business_id and o.id = order_id
        and b.owner_id = (select auth.uid()) and b.approval_status = 'approved'
    )
  );

drop policy if exists "Owners view their payment records" on orderping.payment_records;
create policy "Approved owners view their payment records"
  on orderping.payment_records for select to authenticated
  using (exists (
    select 1 from orderping.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
      and b.approval_status = 'approved'
  ));

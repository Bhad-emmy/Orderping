-- Tighten verified payment finalization to require an approved vendor,
-- an active Flutterwave subaccount and a non-cancelled order.
create or replace function orderping.finalize_flutterwave_payment(
  p_tx_ref text,
  p_provider_transaction_id text,
  p_amount_minor bigint,
  p_currency_code text,
  p_provider_fee_minor bigint default null,
  p_platform_fee_minor bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, orderping, pg_temp
as $function$
declare
  v_tx orderping.payment_transactions%rowtype;
  v_owner_id uuid;
  v_approval_status text;
  v_order_status text;
  v_order_total bigint;
  v_order_paid bigint;
  v_payment_record_id uuid;
begin
  if p_tx_ref is null or length(btrim(p_tx_ref)) < 8 or length(btrim(p_tx_ref)) > 128 then
    raise exception 'Invalid transaction reference' using errcode = '22023';
  end if;
  if p_provider_transaction_id is null or length(btrim(p_provider_transaction_id)) = 0 then
    raise exception 'Provider transaction ID is required' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Verified amount must be positive' using errcode = '22023';
  end if;
  if p_currency_code is null or upper(btrim(p_currency_code)) <> 'NGN' then
    raise exception 'Unsupported verified currency' using errcode = '22023';
  end if;
  if p_provider_fee_minor is not null and p_provider_fee_minor < 0 then
    raise exception 'Invalid provider fee' using errcode = '22023';
  end if;
  if p_platform_fee_minor is not null and p_platform_fee_minor < 0 then
    raise exception 'Invalid platform fee' using errcode = '22023';
  end if;

  select * into v_tx from orderping.payment_transactions
  where tx_ref = btrim(p_tx_ref) and provider = 'flutterwave' for update;
  if not found then
    raise exception 'Payment transaction not found' using errcode = 'P0002';
  end if;

  if v_tx.status = 'successful' then
    if v_tx.provider_transaction_id = btrim(p_provider_transaction_id)
       and v_tx.payment_record_id is not null then
      return jsonb_build_object('success', true, 'duplicate', true,
        'payment_record_id', v_tx.payment_record_id, 'transaction_id', v_tx.id);
    end if;
    raise exception 'Transaction already finalized with a different provider reference'
      using errcode = '23505';
  end if;
  if v_tx.status not in ('initiated', 'pending') then
    raise exception 'Transaction is not eligible for payment finalization'
      using errcode = '23514';
  end if;
  if v_tx.amount_minor <> p_amount_minor then
    raise exception 'Verified amount does not match the expected transaction amount'
      using errcode = '22023';
  end if;
  if upper(v_tx.currency_code::text) <> upper(btrim(p_currency_code)) then
    raise exception 'Verified currency does not match the expected currency'
      using errcode = '22023';
  end if;

  select b.owner_id, b.approval_status, o.status, o.total_amount_minor, o.amount_paid_minor
    into v_owner_id, v_approval_status, v_order_status, v_order_total, v_order_paid
  from orderping.orders o
  join orderping.businesses b on b.id = o.business_id
  where o.id = v_tx.order_id and o.business_id = v_tx.business_id
  for update of o;
  if not found then
    raise exception 'Order or business ownership could not be verified'
      using errcode = 'P0002';
  end if;
  if v_approval_status <> 'approved' then
    raise exception 'Vendor is not approved to receive online payments'
      using errcode = '23514';
  end if;
  if v_order_status = 'cancelled' then
    raise exception 'Cancelled orders cannot receive payment finalization'
      using errcode = '23514';
  end if;
  if v_tx.vendor_payment_account_id is null or not exists (
    select 1 from orderping.vendor_payment_accounts vpa
    where vpa.id = v_tx.vendor_payment_account_id
      and vpa.business_id = v_tx.business_id
      and vpa.provider = 'flutterwave'
      and vpa.status = 'active'
      and vpa.provider_subaccount_id is not null
  ) then
    raise exception 'Vendor settlement account is not active'
      using errcode = '23514';
  end if;
  if p_amount_minor > (v_order_total - v_order_paid) then
    raise exception 'Verified payment exceeds the current outstanding order balance'
      using errcode = '22003';
  end if;

  insert into orderping.payment_records (
    business_id, order_id, amount_minor, method, reference, note, recorded_by
  ) values (
    v_tx.business_id, v_tx.order_id, p_amount_minor, 'online',
    v_tx.tx_ref, 'Flutterwave payment verified server-side', v_owner_id
  ) returning id into v_payment_record_id;

  update orderping.payment_transactions
  set status = 'successful', provider_transaction_id = btrim(p_provider_transaction_id),
      payment_record_id = v_payment_record_id, provider_fee_minor = p_provider_fee_minor,
      platform_fee_minor = p_platform_fee_minor, paid_at = now(), verified_at = now(),
      updated_at = now(), failure_code = null, failure_message = null
  where id = v_tx.id;

  return jsonb_build_object('success', true, 'duplicate', false,
    'payment_record_id', v_payment_record_id, 'transaction_id', v_tx.id);
end;
$function$;

revoke all on function orderping.finalize_flutterwave_payment(text, text, bigint, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function orderping.finalize_flutterwave_payment(text, text, bigint, text, bigint, bigint)
  to service_role;

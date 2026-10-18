BEGIN;

CREATE OR REPLACE FUNCTION orderping.create_order_with_items(
  p_business_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_note text,
  p_fulfilment_method text,
  p_order_type text,
  p_requested_pickup_at timestamptz,
  p_idempotency_key text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = orderping, pg_temp
AS $function$
DECLARE
  v_order orderping.orders%ROWTYPE;
  v_requested_count integer;
  v_valid_count integer;
  v_total numeric;
BEGIN
  IF p_business_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM orderping.businesses b WHERE b.id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid business' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL
     AND p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT o.* INTO v_order
    FROM orderping.orders o
    WHERE o.business_id = p_business_id
      AND o.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      IF v_order.order_type IS DISTINCT FROM p_order_type THEN
        RAISE EXCEPTION 'Idempotency key already used for another request type'
          USING ERRCODE = '23505';
      END IF;
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'request', jsonb_build_object(
          'id', v_order.id,
          'status', v_order.status,
          'total_amount_minor', v_order.total_amount_minor,
          'created_at', v_order.created_at,
          'requested_pickup_at', v_order.requested_pickup_at
        )
      );
    END IF;
  END IF;

  IF p_customer_name IS NULL OR char_length(btrim(p_customer_name)) NOT BETWEEN 1 AND 120
     OR p_customer_phone IS NULL OR p_customer_phone !~ '^[+0-9() .-]{5,32}$'
     OR (p_customer_email IS NOT NULL AND p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
     OR char_length(coalesce(p_customer_note, '')) > 500 THEN
    RAISE EXCEPTION 'Invalid customer details' USING ERRCODE = '22023';
  END IF;

  IF p_order_type NOT IN ('order', 'reservation') THEN
    RAISE EXCEPTION 'Invalid request type' USING ERRCODE = '22023';
  END IF;

  IF p_order_type = 'order' THEN
    IF p_fulfilment_method NOT IN ('delivery', 'collection')
       OR p_customer_email IS NULL THEN
      RAISE EXCEPTION 'Invalid order details' USING ERRCODE = '22023';
    END IF;
    IF p_requested_pickup_at IS NOT NULL THEN
      RAISE EXCEPTION 'Orders cannot specify a reservation pickup time' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_fulfilment_method IS DISTINCT FROM 'collection'
       OR p_requested_pickup_at IS NULL
       OR p_requested_pickup_at <= clock_timestamp()
       OR p_requested_pickup_at > clock_timestamp() + interval '180 days' THEN
      RAISE EXCEPTION 'Invalid reservation time or fulfilment' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) < 1
     OR jsonb_array_length(p_items) > 30 THEN
    RAISE EXCEPTION 'Invalid item list' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS e(value)
    WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'object'
       OR coalesce(e.value->>'catalog_item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR coalesce(e.value->>'quantity', '') !~ '^[0-9]{1,4}$'
  ) THEN
    RAISE EXCEPTION 'Invalid item identifier or quantity' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer
  INTO v_requested_count
  FROM (
    SELECT (e.value->>'catalog_item_id')::uuid AS id
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY 1
  ) requested;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (e.value->>'catalog_item_id')::uuid AS id,
             sum((e.value->>'quantity')::integer) AS quantity
      FROM jsonb_array_elements(p_items) AS e(value)
      GROUP BY 1
    ) requested
    WHERE requested.quantity < 1 OR requested.quantity > 1000
  ) THEN
    RAISE EXCEPTION 'Invalid aggregate quantity' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM orderping.catalog_items c
  JOIN (
    SELECT (e.value->>'catalog_item_id')::uuid AS id
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY 1
  ) requested ON requested.id = c.id
  WHERE c.business_id = p_business_id
    AND c.type = 'product'
    AND c.is_active = true
  FOR SHARE OF c;

  SELECT count(*)::integer,
         coalesce(sum(requested.quantity::numeric * c.price_minor::numeric), 0)
  INTO v_valid_count, v_total
  FROM (
    SELECT (e.value->>'catalog_item_id')::uuid AS id,
           sum((e.value->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY 1
  ) requested
  JOIN orderping.catalog_items c
    ON c.id = requested.id
   AND c.business_id = p_business_id
   AND c.type = 'product'
   AND c.is_active = true;

  IF v_valid_count <> v_requested_count THEN
    RAISE EXCEPTION 'One or more products are unavailable' USING ERRCODE = '22023';
  END IF;

  IF v_total < 0 OR v_total > 9007199254740991 OR v_total > 9223372036854775807 THEN
    RAISE EXCEPTION 'Order total is outside the supported range' USING ERRCODE = '22003';
  END IF;

  INSERT INTO orderping.orders (
    business_id, customer_name, customer_phone, customer_email, customer_note,
    fulfilment_method, total_amount_minor, amount_paid_minor, currency_code,
    status, order_type, requested_pickup_at, idempotency_key,
    customer_access_token_hash
  )
  VALUES (
    p_business_id, btrim(p_customer_name), btrim(p_customer_phone), nullif(btrim(p_customer_email), ''),
    nullif(btrim(p_customer_note), ''), p_fulfilment_method, v_total::bigint, 0, 'NGN',
    CASE WHEN p_order_type = 'reservation' THEN 'pending' ELSE 'new' END,
    p_order_type, p_requested_pickup_at, p_idempotency_key, NULL
  )
  ON CONFLICT (business_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
    DO NOTHING
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    SELECT o.* INTO v_order
    FROM orderping.orders o
    WHERE o.business_id = p_business_id
      AND o.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order could not be created' USING ERRCODE = '40001';
    END IF;
    IF v_order.order_type IS DISTINCT FROM p_order_type THEN
      RAISE EXCEPTION 'Idempotency key already used for another request type'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'request', jsonb_build_object(
        'id', v_order.id,
        'status', v_order.status,
        'total_amount_minor', v_order.total_amount_minor,
        'created_at', v_order.created_at,
        'requested_pickup_at', v_order.requested_pickup_at
      )
    );
  END IF;

  INSERT INTO orderping.order_items (
    order_id, catalog_item_id, item_name, quantity, unit_price_minor
  )
  SELECT v_order.id, c.id, c.name, requested.quantity, c.price_minor
  FROM (
    SELECT (e.value->>'catalog_item_id')::uuid AS id,
           sum((e.value->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY 1
  ) requested
  JOIN orderping.catalog_items c
    ON c.id = requested.id
   AND c.business_id = p_business_id
   AND c.type = 'product'
   AND c.is_active = true;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'request', jsonb_build_object(
      'id', v_order.id,
      'status', v_order.status,
      'total_amount_minor', v_order.total_amount_minor,
      'created_at', v_order.created_at,
      'requested_pickup_at', v_order.requested_pickup_at
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION orderping.create_order_with_items(
  uuid, text, text, text, text, text, text, timestamptz, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION orderping.create_order_with_items(
  uuid, text, text, text, text, text, text, timestamptz, text, jsonb
) TO service_role;

COMMIT;

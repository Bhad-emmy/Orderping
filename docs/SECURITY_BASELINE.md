# OrderPing V1 Security Baseline

This document defines required controls for the MVP. OrderPing tables live in the dedicated `orderping` schema inside the existing MEKA LOGIC Supabase project. Do not expose public writes directly to database tables.

## Supabase schema setup

- Add `orderping` to the project's **API settings → Exposed schemas** before using `supabase.schema('orderping')` from the vendor dashboard or subscribing to OrderPing Realtime changes.
- The schema grants table access to `authenticated` with RLS as the row-level gate and to `service_role` for trusted Edge Functions. No table access is granted to `anon`.
- Public business pages and customer submissions must be served through validated Edge Functions; do not grant `anon` direct access just to make public pages work.
- The `orderping` schema and tables are separate from existing `public` tables used by MEKA LOGIC modules.

## Tenant isolation

- Enable Row Level Security on every application table.
- Authenticated vendors can access only records belonging to businesses they own.
- Public customers do not get direct access to private customer records or direct insert permission on appointments/orders.
- Public catalogue reads and booking/order submissions must go through narrowly scoped server-side Edge Functions.
- Keep the Supabase service-role key and all email/WhatsApp provider credentials in server-side secrets only.

## Rate limits

Apply limits on the server before validating or creating a public submission. The counters must be shared/atomic across function instances.

| Operation | Initial limit |
| --- | --- |
| Public appointment submission | 5 requests per minute per trusted client IP |
| Public product-order submission | 5 requests per minute per trusted client IP |
| Other public API routes | 60 requests per minute per trusted client IP |
| Authentication | Configure Supabase Auth rate limits; initial target is 5 attempts per 15 minutes where supported |

- Use a server-generated hashed bucket key that includes route and trusted client IP. Do not accept the key from the caller.
- Derive client IP only from platform-provided, trusted proxy metadata. Do not blindly trust arbitrary X-Forwarded-For values.
- Return HTTP 429 and a Retry-After header when the limit is exceeded.
- The consume_rate_limit RPC is executable only by service_role; never expose it through an anonymous client.
- The database helper uses fixed windows. Tune limits from real usage before launch.

## Booking and order integrity

- Validate payload sizes, field lengths, business/catalogue ownership, active catalogue items, quantities, and calculated totals server-side.
- Never trust a client-supplied price or total. Read current prices from the database and calculate totals on the server.
- Check appointment availability server-side and rely on the database overlap trigger as the final concurrency guard.
- Add idempotency/deduplication for submission requests before public launch so network retries do not create duplicate records.
- Vendor-confirmed payments are records only; OrderPing does not process or hold funds.

## Notification safety

- Create notification work only after the booking/order transaction succeeds.
- Use unique deduplication keys; record provider outcomes and retry failures without creating duplicate customer requests.
- Respect WhatsApp opt-in and provider/template requirements.
- Never log credentials or full payment secrets.

## Verification before public launch

1. Confirm a vendor cannot read another vendor's business, bookings, orders, order items, or notification logs.
2. Confirm anonymous users cannot insert directly into private tables.
3. Test concurrent requests against the rate limiter and verify requests over the limit return 429.
4. Test simultaneous overlapping booking attempts; only a non-overlapping booking may remain active.
5. Test malformed/oversized requests, duplicate submissions, and notification-provider failures.

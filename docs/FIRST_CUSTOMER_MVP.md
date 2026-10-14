# OrderPing First-Customer MVP

**Target:** one product vendor, delivered as a pilot in 3–5 working days  
**Build budget:** 6 focused hours/day (18–30 hours)  
**Stack:** React + Vite, Supabase, Vercel  
**Database constraint:** use the existing MEKA LOGIC Supabase project under the dedicated `orderping` schema. Do not alter the Predivic project or unrelated schemas.

## Customer outcome

The vendor receives one shareable mobile-friendly page where customers can either:

1. Place a product order for delivery or collection.
2. Request a product reservation for later purchase or pickup.

The vendor manages orders and reservation requests in one authenticated dashboard and records payments against confirmed orders. Reservations are not sales and must not be reported as paid orders.

## V1 in scope

- One vendor account and one business profile.
- Public catalogue: active products, name, description, price.
- Customer name and phone; email optional.
- Order basket with quantity and server-calculated totals.
- Delivery or collection selection for ordinary orders.
- Product reservation request with requested pickup date/time.
- Vendor can confirm or reject a reservation and update order status.
- Manual payment tracking: amount paid, balance, unpaid/partial/paid.
- Responsive mobile layout, useful loading/error/success states.
- Validated server-side public endpoints, rate limiting, duplicate-submit protection, and tenant isolation.
- Deploy and hand over the customer link.

## Explicitly out of scope for this deadline

- Payment gateway or holding funds.
- Automated WhatsApp notifications unless provider access is already configured and verified.
- Inventory deduction, guaranteed stock locking, and automatic reservation expiry.
- Customer accounts, multiple staff roles, analytics, AI, native apps, complex custom branding, and multi-location operations.
- Full realtime UX if a reliable refresh fallback is sufficient.

## Important schema decision before implementing reservations

The existing foundation has `orders.fulfilment_method` (`delivery` or `collection`) but no explicit order-vs-reservation discriminator or structured requested pickup timestamp. The existing `appointments` table has appointment-overlap semantics and should **not** be reused for product reservations.

Before implementing reservations, add and test a small, additive migration in the `orderping` schema. Recommended minimum:
- Add `order_type` to `orders` (for example `purchase` or `reservation`).
- Add nullable `requested_pickup_at` (`timestamptz`) for reservations.
- Define allowed status transitions for reservation requests (pending, confirmed, rejected/cancelled) without breaking purchase statuses.
- Ensure server-side validation requires a pickup time for reservations and rejects a reservation timestamp in the past.
- Keep totals in integer minor units (NGN kobo); calculate prices and totals on the server from active catalogue rows, never trust client-supplied totals.

Do not apply this migration until the existing migration state and actual deployed schema are checked. Keep it additive and isolated to `orderping`.

## Build plan (6 hours/day)

### Day 1 — connection and catalogue
- Confirm `orderping` is included in Supabase Data API Exposed schemas, preserving all existing entries.
- Inspect repository app structure and environment configuration.
- Verify the correct client configuration and vendor authentication.
- Fetch and render a real active product through the intended access path.
- Add loading, empty, and error states.

**Exit gate:** one real product is rendered without exposing service-role credentials or granting anonymous direct table access.

### Day 2 — complete order path
- Product selection and quantity controls.
- Customer contact fields and delivery/collection choice.
- Validated Edge Function or trusted backend creates order and order items.
- Server re-reads active product prices and calculates total.
- Duplicate-submit protection and success confirmation.

**Exit gate:** an end-to-end test order exists with correct line items and total.

### Day 3 — vendor dashboard and reservations
- Authenticated vendor sees only their own orders and reservations.
- Vendor updates order status.
- Apply the additive reservation schema migration after verifying deployed schema.
- Reservation request includes product quantities and requested pickup date/time.
- Vendor confirms or rejects the request.

**Exit gate:** order and reservation paths work end to end; reservation is distinguishable from a sale.

### Day 4 — payment tracking, security, deployment
- Record payment amount against an order and derive balance/status.
- Verify all writes go through authenticated owner access or validated server-side functions.
- Test cross-tenant access denial, malformed input, duplicate submissions, inactive products, and tampered prices.
- Deploy frontend and configure environment variables.

**Exit gate:** production build works and core security tests pass.

### Day 5 — acceptance and handover
- Test phone layout and the complete flows with realistic sample products.
- Fix blocking bugs.
- Verify customer confirmation and vendor status updates.
- Give the vendor the public URL and a short usage walkthrough.
- Record known limitations and follow-up requests.

**Exit gate:** customer can use the core workflows without developer intervention for each transaction.

## Acceptance checklist

- [ ] Vendor can sign in and edit their own business/catalogue.
- [ ] Public page shows only active products for the correct business.
- [ ] Customer can submit an order with one or more items.
- [ ] Server-calculated total matches item quantities and current catalogue prices.
- [ ] Vendor can view and update their own order.
- [ ] Customer can request a reservation with a future pickup date/time.
- [ ] Vendor can confirm or reject a reservation.
- [ ] Reservation is not treated as a completed sale.
- [ ] Manual payment entries cannot exceed the order total; balance is correct.
- [ ] Duplicate requests and invalid inputs are handled safely.
- [ ] Anonymous users cannot read private orders/customer details or write directly to private tables.
- [ ] Vendor A cannot read or mutate Vendor B's records.
- [ ] Deployed customer and vendor flows pass on a mobile browser.

## Delivery risk / fallback

The 3-day option is only a prototype and is not the recommended commitment. Target Day 5 for a narrow pilot. If time slips, keep product orders plus a simple reservation request/confirmation flow; defer automated notifications, realtime polish, and optional UI refinement. Do not skip authorization, server-side price validation, or tenant-isolation tests to meet the date.

## First implementation task

Verify the Supabase API exposes the `orderping` schema without removing existing schemas, then inspect the repo and render one real active product from the database. Do this before building dashboard screens.

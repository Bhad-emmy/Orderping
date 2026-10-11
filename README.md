# OrderPing

OrderPing is a mobile-first vendor tool for product orders, product reservations, and manual payment tracking.

## First-customer V1 scope

- Shareable public product catalogue.
- Product orders with quantities and fulfilment choice.
- Product reservations for later purchase or pickup.
- Vendor dashboard for products, orders, reservations, and payments.
- Payment tracking only; no payment processing or custody of funds.
- Supabase Auth, row-level security, server-side validation, rate limiting, and tenant isolation.

## Stack

- Frontend: React + Vite + TypeScript
- Auth/database: Supabase PostgreSQL and Auth
- Public customer API: Supabase Edge Functions
- Hosting target: Vercel

## Frontend routes

- `/login` — vendor sign-in and account creation
- `/app` — dashboard overview
- `/app/products` — add/edit/hide products
- `/app/orders` — orders, statuses, and payment recording
- `/app/reservations` — reservation requests (requires reservation Edge Functions)
- `/app/payments` — payment ledger
- `/app/settings` — business profile and storefront URL
- `/store/:slug` — public catalogue, order form, and reservation request UI

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env`.
3. Set the Supabase project URL and publishable/anon key from the MEKA LOGIC project.
4. In the Supabase dashboard, add `orderping` to **Project Settings → API → Exposed schemas** without removing existing schemas.
5. Install dependencies and run the Vite server:

   ```bash
   npm install
   npm run dev
   ```

6. Run a production type-check/build before deploying:

   ```bash
   npm run build
   ```

Never place the Supabase service-role key or email/WhatsApp provider secrets in a `VITE_*` variable. Browser code is public.

## Backend functions expected by this frontend

The public storefront deliberately uses server-side functions instead of anonymous direct table access:

- `public-storefront`: accepts `{ slug }`; returns `{ business, products }` for active products only.
- `submit-order`: validates customer fields and product IDs/quantities, re-reads active prices, calculates totals server-side, rate-limits and deduplicates, then inserts an order and its line items.
- `submit-reservation`: same validations as an order plus a future requested pickup timestamp; creates a distinct reservation, not a purchase sale.
- `vendor-reservations`: authenticates the vendor and returns reservations belonging only to the requested business after verifying ownership.
- `update-reservation-status`: authenticates and authorizes the vendor before confirming/rejecting a reservation.

**Backend status:** the five Edge Functions are deployed to the MEKA LOGIC Supabase project and their source is versioned under `supabase/functions/`. They still require end-to-end verification after the `orderping` schema is exposed in the Data API settings. The reservation migration is versioned under `supabase/migrations/`.

## Database and security notes

OrderPing uses a dedicated `orderping` PostgreSQL schema in the existing MEKA LOGIC Supabase project. The Predivic School project is not used by this application.

The existing foundation has `businesses`, `catalog_items`, `orders`, `order_items`, `appointments`, `business_hours`, `notification_logs`, and `rate_limit_buckets`. The schema now has an `order_type` discriminator, `requested_pickup_at`, and reservation-specific status constraints. Product reservations are stored separately from purchases in the shared order ledger; do not reuse appointment overlap semantics for product reservations.

The vendor dashboard uses Supabase Auth and owner RLS policies for business, catalogue, and order operations. Public customer reads and writes must remain behind validated Edge Functions. Do not add anonymous direct table access to private order/customer data.

## Deployment status

The frontend code is being introduced on a feature branch and requires review, a successful `npm run build`, configured environment variables, and backend Edge Functions before the customer-facing flow is production-ready.

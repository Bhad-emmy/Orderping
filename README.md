# OrderPing

OrderPing is a minimal, mobile-first SaaS for independent vendors to manage appointment bookings, product orders, payment records, and automated email + WhatsApp notifications.

## V1 scope

- Shareable business page with services or products
- Appointment booking with server-side availability checks
- Product orders and fulfilment status
- Payment tracking only; no payment processing or custody
- Vendor/customer email and WhatsApp notifications
- Live dashboard updates without manual refresh
- Server-side rate limiting, duplicate-submit protection, and tenant data isolation

## Planned stack

- Frontend: React + Vite
- Auth/database/realtime: Supabase (PostgreSQL)
- Server-side request handling: Supabase Edge Functions
- Hosting: Vercel

## Security baseline

- Row Level Security (RLS) on all tenant-owned tables
- Public submissions go through server-side functions; do not grant anonymous direct inserts to booking/order tables
- Server-side rate limiting for public submissions
- Supabase Auth's configured rate limits for authentication
- Keep service-role and provider secrets out of browser code

## Database isolation

OrderPing uses a dedicated `orderping` PostgreSQL schema inside the existing MEKA LOGIC Supabase project. It does not use the Predivic School project and does not create a third Supabase project. The schema has its own tables, RLS policies, booking-overlap guard, and rate-limit helper.

Before the vendor frontend uses the schema, add `orderping` under **Supabase Dashboard → Project Settings → API → Exposed schemas**. Public customer reads and submissions still go through Edge Functions; do not grant anonymous direct table access.

## Development status

Stage 1 foundation has been applied to the MEKA LOGIC Supabase project. The frontend and Edge Functions remain to be built and verified.

# OrderPing 2.0 — commerce foundation

## Working rules

- Production branch: `main`. Development branch: `feat/orderping-commerce-foundation`.
- Current Supabase project remains in use for this phase. OrderPing data is confined to the `orderping` schema.
- Do not modify Predivic School, Oka Rides, MEKA Jots, MEKAapply, shared Auth configuration, or unrelated schemas.
- All database changes must be additive, versioned migrations. Do not edit historical migrations.
- Never commit provider secrets, service-role keys, access tokens, customer bank account numbers, or webhook signing secrets.
- Do not deploy incomplete payment flows or represent a manually recorded payment as an online transaction.

## Product and settlement invariants

1. Vendors own their customer relationships, orders, catalogue and fulfilment.
2. OrderPing does not hold vendor sales proceeds. Payment design must support provider-managed vendor subaccounts/direct split settlement, subject to Flutterwave's current Nigeria onboarding and settlement rules.
3. The server creates checkout sessions and generates unpredictable unique transaction references.
4. The browser redirect is not proof of payment. A payment becomes successful only after server-side provider verification and a verified webhook/reconciliation check.
5. Provider event handling must be idempotent. A repeated webhook must never create a second ledger payment.
6. The existing `payment_records` ledger remains the source of truth for order balances. Provider transactions link to, but do not replace, that ledger.
7. Existing manual cash, transfer and POS payment recording must continue to work.
8. Tenant isolation and RLS remain mandatory. Public clients must not insert or update provider transaction state.

## Existing architecture verified

- React, Vite and TypeScript frontend.
- Supabase PostgreSQL schema: `orderping`.
- Supabase Auth, Edge Functions and RLS.
- Vercel project: `orderping`, production branch `main`.
- Existing commerce tables: businesses, catalog_items, orders, order_items and payment_records.
- Existing booking tables: appointments and business_hours.
- Existing order balance is reconciled from payment_records.
- Existing public checkout/order submission is handled by Edge Functions.
- Existing product image bucket is public and must not be reused for paid digital files.

## Phase 1 — payment data foundation

Migration `20261120120000_orderping_payment_foundation.sql` introduces:

- `vendor_payment_accounts`: provider subaccount reference and minimal account metadata. No full bank account number or credentials.
- `payment_transactions`: provider checkout and transaction lifecycle, linked to a business and order.
- `payment_webhook_events`: provider event idempotency and processing audit trail.
- RLS read policies for the owning vendor; writes restricted to service_role.

This migration is additive. It does not change current orders, manual payment records, appointment flows, or other MEKA Logic schemas.

## Phase 2 — server-side payment functions (not yet implemented)

Implement and test, before enabling production checkout:

1. Vendor account onboarding/verification function.
2. Checkout initialization function that verifies approved business ownership, order ownership, outstanding balance and active provider account.
3. Webhook function that verifies Flutterwave signatures using the official current specification, persists event idempotency, and independently verifies the transaction with Flutterwave before marking it successful.
4. A single database transaction/RPC to lock the order, check amount/currency/business/reference, insert one payment_records ledger row, link payment_record_id, and update payment transaction status atomically.
5. Reconciliation function for pending transactions and webhook delivery failures.

The payment ledger write must use the actual business owner as recorded_by, preserve the existing payment ledger trigger invariants, and be protected against duplicate provider references.

## Phase 3 — storefront checkout

- Add a server-created checkout flow.
- Never trust client-submitted price, business_id, fee, settlement account or payment status.
- Recalculate payable amount from the database.
- Keep the existing manual payment path available.
- Do not activate customer tracking or fulfilment on an unverified redirect.

## Phase 4 — digital products

- Create a separate private Storage bucket.
- Store metadata and object paths, not public file URLs.
- Grant time-limited signed downloads only after a verified successful purchase.
- Add purchase/download authorization and audit records.
- Keep the public product image bucket separate.

## Phase 5 — verification and release

- Test tenant isolation across two vendor accounts.
- Test tampered amount, currency, order and business identifiers.
- Test duplicate, delayed, replayed and invalid-signature webhooks.
- Test payment success, failure, cancellation, partial payment and overpayment.
- Verify that manual payment ledger behavior remains unchanged.
- Verify vendor settlement configuration and provider settlement reports.
- Run frontend build, dependency audit, database advisors and Vercel preview checks.
- Merge only after review; deploy production only after explicit release approval.

## Current implementation boundary

The payment foundation migration is schema preparation only. It does not enable live Flutterwave checkout, create provider subaccounts, send money, or process webhooks. Flutterwave credentials and verified account onboarding are required for those steps.

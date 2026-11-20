# Flutterwave sandbox setup for OrderPing

This guide is for the development branch only. Do not use production credentials or live vendor bank details during this phase.

## Settlement model

- OrderPing revenue is subscription-only.
- Vendor subaccounts are created with `split_type: percentage` and `split_value: 1.0`, allocating 100% of the vendor split to the vendor.
- OrderPing transaction commission is zero.
- Flutterwave processing fees and applicable statutory deductions may still reduce the final settlement under Flutterwave's terms and merchant settings.
- Vendor settlement timing follows Flutterwave's settlement cycle; it is not guaranteed to be instant.

## Required Supabase Edge Function secrets

Set these in the current Supabase project under Edge Function secrets:

- `FLW_SECRET_KEY`: Flutterwave **TEST** secret key (normally starts with `FLWSECK_TEST-`).
- `FLW_WEBHOOK_HASH`: a long random webhook signing value. Set the exact same value in Flutterwave's webhook settings.
- `ORDERPING_PUBLIC_URL`: optional; set to `https://orderping.vercel.app`. The checkout function has this default.

Do not place any of these in GitHub, the React app, Vercel client-side environment variables, or a chat message. Never use the Flutterwave live secret key for sandbox testing.

Supabase provides the standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` values to Edge Functions. The service-role key must never be exposed to the browser.

## Flutterwave dashboard

1. Switch the Flutterwave dashboard to Test Mode.
2. Copy the Test Secret Key into Supabase as `FLW_SECRET_KEY`.
3. Configure a webhook URL after the new Supabase function is deployed:
   `https://baoqyhhyenimfhkrwspn.supabase.co/functions/v1/flutterwave-webhook`
4. Set the webhook secret hash to the exact value stored as `FLW_WEBHOOK_HASH`.
5. Enable the `charge.completed` event and webhook retries.
6. Do not switch to Live Mode during this phase.

## Function responsibilities

- `vendor-payment-account`: authenticated vendor bank-list lookup, account resolution and subaccount creation.
- `flutterwave-checkout`: guest order checkout using the order's database-calculated outstanding balance and the active vendor subaccount.
- `flutterwave-verify-payment`: independently verifies the provider transaction before calling the service-role-only database finalizer.
- `flutterwave-webhook`: checks the `verif-hash` header, records an idempotency event, re-verifies the transaction and invokes the atomic finalizer.

The redirect URL is never treated as proof of payment. The order balance changes only after provider verification and atomic ledger finalization.

## Sandbox acceptance tests

- Resolve a Flutterwave test bank account and create one vendor subaccount.
- Confirm the vendor subaccount is configured for 100% allocation and OrderPing platform commission is zero.
- Create an order, initialize hosted checkout and complete a sandbox payment.
- Confirm the payment appears once in `orderping.payment_records` with method `online`.
- Confirm `orders.amount_paid_minor` updates through the existing ledger trigger.
- Replay the same webhook and confirm no duplicate payment row is created.
- Test invalid webhook signature, wrong transaction reference, wrong amount, wrong currency, failed/cancelled checkout and a cancelled order.
- Confirm manual cash, bank transfer and POS entries continue to work.
- Confirm a vendor cannot view another vendor's settlement account or payment transactions.

No production deployment, live credentials, real subaccount creation, or production payment should occur until all tests pass and release approval is given.

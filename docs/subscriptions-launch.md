# OrderPing subscriptions and five-business pilot

## Launch rules

- The first pilot is limited to five businesses at a time.
- Each approved pilot lasts 14 days by default (the database RPC accepts 1–30 days).
- Only the platform owner can approve pilot access, verify payments, or change subscription state.
- Proposed monthly plans are Starter ₦3,000, Growth ₦6,000, and Pro ₦12,000. Prices are stored in NGN minor units (kobo).
- Business owners can read only their own subscription and payment history.
- Expired businesses should become read-only; existing customer tracking and existing order records must remain accessible.
- Email deliverability is not a prerequisite for subscription access.

## Migration contents

`20261014190000_subscription_pilot_access_control.sql` creates:
- `subscription_plans`
- `platform_admins`
- `business_subscriptions`
- `subscription_payments`
- `subscription_audit_logs`
- `approve_business_pilot(uuid, integer)`, an owner-only RPC with an advisory lock so two concurrent approvals cannot occupy the same final pilot slot.
- `get_my_business_access(uuid)`, a read-only entitlement RPC scoped to the authenticated business owner.

## Owner bootstrap (required before enabling admin actions)

The migration intentionally does not guess the platform owner's user ID or grant admin access to the first person who calls the app.

1. Identify and verify the platform owner's UUID from Supabase Authentication.
2. Insert that exact UUID into `orderping.platform_admins` using the Supabase SQL Editor as a trusted project administrator:

```sql
insert into orderping.platform_admins (user_id, role)
values ('REPLACE-WITH-VERIFIED-OWNER-AUTH-UUID', 'owner');
```

Never expose service-role credentials or allow users to write to `platform_admins` from the client.

## Deliberate scope boundary

This migration is the database foundation only. It does **not** yet enforce subscriptions on all order/reservation Edge Functions, implement payment-verification and renewal RPCs, or add the admin dashboard. Do not apply this migration to production or announce subscription enforcement until those server-side checks and tests are completed. In particular, front-end hiding is not access control. Keep this change in a branch until review and integration are complete.

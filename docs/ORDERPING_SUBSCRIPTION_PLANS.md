# OrderPing subscription foundation

## Approved commercial terms

| Plan | Monthly | Annual | Active products/services | Monthly orders | Monthly appointments | Locations | Staff |
|---|---:|---:|---:|---:|---:|---:|---:|
| Basic | ₦2,999 | ₦28,790 | 30 | 100 | 20 | 1 | 0 |
| Growth | ₦8,999 | ₦86,390 | 300 | 1,000 | 300 | 1 | 2 |
| Business | ₦20,999 | ₦201,590 | Unlimited | Unlimited | Unlimited | 5 | 10 |

Basic includes a 10-day trial. Annual prices reflect the agreed 20% discount. Monthly usage limits reset at the start of each calendar month. Unused usage does not roll over. Existing records remain readable when a limit is reached. At 80%, the application should warn the vendor; at 100%, it should block new usage and present upgrade/renewal options.

## Implemented in this branch

- Adds OrderPing-only subscription records.
- Grandfathers existing businesses as legacy subscriptions so this migration does not unexpectedly restrict existing stores.
- Adds an authenticated, owner-checked RPC to start the 10-day Basic trial. Starting the trial also approves the new store, replacing the former manual ₦2,500 activation/PIN gate for stores that explicitly start the trial.
- Adds an authenticated usage snapshot RPC.
- Enforces active catalogue listings, monthly order/reservation creation, and monthly appointment creation in database triggers. Checks are serialized per business to prevent concurrent requests from exceeding limits.

## Deliberate scope limits

- This is a backend foundation. It does not integrate paid subscription checkout, Flutterwave recurring billing, annual renewals, refunds, or payment reconciliation.
- Staff accounts, role permissions, and multiple branches are not implemented by this migration; the approved limits are documented for a later phase.
- The 80% warning is exposed as a threshold in the usage snapshot; the vendor UI still needs to display warnings and plan status.
- Orders and product reservations share the existing `orders` table and both count against the monthly order allowance. This should be confirmed in product QA.
- The migration is not applied to the connected Supabase project. Review and test it before applying.

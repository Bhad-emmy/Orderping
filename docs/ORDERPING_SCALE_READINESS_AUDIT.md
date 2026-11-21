# OrderPing Infrastructure Audit and Scale Readiness Plan

**Status:** Audit complete; implementation not started  
**Date:** 21 November 2026  
**Capacity target:** 1,000 simultaneous active users initially; 10,000 registered users as the first growth milestone  
**Scope:** OrderPing only. Do not modify Predivic School, Oka Rides, MEKA Apply, or other applications/schemas.

## Executive summary

OrderPing's current React/Vite + Vercel + Supabase architecture can be evolved to support the target without an immediate rewrite or a fleet of manually managed servers. Vercel serves the static frontend through its CDN. The current backend is primarily Supabase PostgreSQL, PostgREST, Auth, Storage, and Supabase Edge Functions.

The largest architectural concern is not the absence of multiple web servers. It is that OrderPing currently shares one Supabase project/database with other MEKA applications, and the vendor dashboard downloads the complete order and payment history to compute summary figures. Those choices create shared-resource contention and unnecessary database/network work as usage grows.

**Recommendation:** keep Vercel for the frontend, move OrderPing to a dedicated Supabase project before meaningful scale, optimise the read paths and schema, add a durable background-job path, and prove capacity with staged load tests. Do not add read replicas, Redis, or separately managed application servers until measurements show they are needed.

## 1. Current-state findings

### Hosting and application

- Vercel project: `orderping`, framework Vite.
- Frontend is a static React application; `src/main.tsx` synchronously imports the full `App` and global stylesheet.
- Vercel serves the frontend on `orderping.vercel.app` and preview aliases.
- Current `vercel.json` only rewrites application paths to `/`; no Vercel API routes or scheduled jobs are declared there.
- The browser talks directly to Supabase using the public/anon client and invokes Supabase Edge Functions for privileged/server-side operations.
- The latest preview build emitted a 537.12 kB minified JavaScript chunk warning (>500 kB). This is a frontend performance issue to address with route-level lazy loading and dependency/chunk analysis.
- No load-test results or production latency/error-rate baseline were available during this audit.

### Database and backend

- Supabase project: `baoqyhhyenimfhkrwspn`, project name `MEKA LOGIC`, region `eu-west-1`, PostgreSQL 17.6.1, currently healthy.
- OrderPing uses the `orderping` schema inside that project. The same project also contains unrelated application schemas/tables and Edge Functions.
- The database advisor reports very small current OrderPing data volumes: approximately 3 businesses, 8 orders, 16 payment records, 1 appointment and 7 catalog items. These are estimates from PostgreSQL statistics, not a load test or proof of capacity.
- All inspected OrderPing tables have RLS enabled.
- Supabase lists active Edge Functions for OrderPing workflows including storefront, order/reservation submission, vendor approval/activation, order tracking, and Flutterwave payment flows. These functions currently share the Supabase project with other applications' functions.
- Existing indexes already cover common business-scoped access patterns on orders, payment records, appointments and catalog items. Preserve and validate them rather than adding duplicate indexes blindly.

### Confirmed performance findings

1. **Dashboard loads unbounded history.** In `src/App.tsx`, `VendorApp.loadData` loops through every 500-row page of `orders` and `payment_records`, selecting all columns, and stores the entire history in browser state. This was introduced to remove earlier 200/500 row caps, but it does not scale. A vendor with a very large ledger should not download every row to render the dashboard.
2. **Frontend bundle is too concentrated.** The current entrypoint imports the whole application synchronously and the latest Vercel build warned about a 537.12 kB minified JS chunk. Use route-level code splitting and measure actual mobile performance.
3. **Three OrderPing foreign keys lack covering indexes according to the Supabase performance advisor:**
   - `businesses.approved_by`
   - `payment_records.recorded_by`
   - `payment_transactions.vendor_payment_account_id`
   Add an index only after reviewing the relationship/query pattern and migration impact.
4. **Performance advisor also reports RLS init-plan and multiple-permissive-policy findings in the shared project.** The surfaced examples are primarily in the shared `public` schema. Do not modify them as part of OrderPing work without confirming ownership and impact.
5. **Unused-index warnings are not proof an index is unnecessary.** The current dataset and short usage history are too small to justify dropping indexes. Reassess after meaningful production traffic.
6. **Security advisor findings need ownership-aware review.** It reports RLS-enabled/no-policy tables including OrderPing internal tables such as `payment_webhook_events`, `rate_limit_buckets`, and `vendor_activation_pins`. These may intentionally be service-role-only. Verify their access paths and grants; do not add broad client policies merely to silence the advisor. It also reports leaked-password protection disabled at project Auth level. Because Auth is shared, do not change this setting on the shared project without a cross-application impact review.

### What is not yet known

- Real concurrent-user capacity, peak requests per second, p50/p95/p99 latency, error rates, database CPU/memory, connection saturation and Edge Function cold-start/latency distribution.
- Vercel plan/resource limits and any configured observability/drains not exposed by the project metadata inspected.
- Actual Lagos mobile network performance and real-device Core Web Vitals.
- Whether every OrderPing query path has the intended composite index and whether every Edge Function has suitable rate limits, timeouts and idempotency under concurrent retries.

## 2. Target service levels

These are engineering acceptance targets to test, not current measured performance guarantees.

| Metric | Initial acceptance target |
|---|---:|
| Simultaneous active users | 1,000 |
| Registered users supported in first growth stage | 10,000 |
| Common API read/write latency | p95 <= 500 ms, excluding external provider latency |
| Common API latency tail | p99 <= 1,000 ms, excluding external provider latency |
| API error rate during steady-state load | < 1% |
| Storefront Largest Contentful Paint | p75 <= 2.5 s on representative mobile 4G |
| Dashboard usable/interactive | p75 <= 3.0 s on representative mobile 4G |
| Sustained database CPU | < 70% during normal peak test |
| Connection pool utilisation | < 70% during normal peak test |
| Background job backlog | Drains within 5 minutes after a burst |
| Tenant isolation | Zero cross-business data exposure in automated tests |

Measure these from representative Lagos mobile networks and realistic test devices. Separate application latency from Flutterwave, email, WhatsApp and other third-party provider latency.

## 3. Target architecture

### Frontend delivery
- Keep React/Vite on Vercel.
- Use Vercel CDN for static assets, immutable hashed assets, compression and cache headers.
- Split the application by route/feature using React lazy loading and dynamic imports.
- Keep the storefront bundle small; load vendor-only modules only after authentication and route entry.
- Optimise images (responsive sizes, modern formats, lazy loading below the fold) and avoid loading full-resolution assets in list views.

### Application/API layer
- Keep privileged business logic on Supabase Edge Functions or a separately managed API only where justified.
- Keep functions stateless and horizontally scalable; no in-memory session, rate-limit or job state.
- Keep database calls close to the database region. Measure latency from Lagos before choosing a region.
- Apply server-side validation, rate limiting, idempotency and strict business ownership checks to every write path.
- Avoid creating a second set of manually managed web servers merely to increase the server count.

### Database
- Create a dedicated Supabase project for OrderPing, with a deliberate region decision and an appropriately sized database compute tier.
- Keep PostgreSQL as the source of truth. Use Supabase connection pooling for server-side connections and avoid opening one direct database connection per request.
- Preserve tenant-scoped RLS, constraints, transaction integrity and payment idempotency.
- Add only measured indexes for business-scoped filters, status/date sorting, foreign-key joins and high-volume lookup paths.
- Use database-side aggregates/materialised summaries where justified; do not download full histories to calculate dashboard cards.
- Consider read replicas only after query/index optimisation and only for read-heavy workloads where replica lag is acceptable. Writes remain on the primary.

### Cache
- Cache public storefront/catalog data with short, safe TTLs and explicit invalidation on catalog/business changes.
- Cache static assets for long periods using content hashes.
- Do not publicly cache authenticated vendor data, payment status, balances, customer personal data or tenant-specific responses.
- Add a shared cache (e.g. Redis/managed KV) only when measured repeated reads, rate limiting or job coordination justify it. Never use per-instance memory for cross-instance correctness.

### Background processing
- Move email/WhatsApp delivery, retries, bulk exports, report generation and other non-interactive work out of request-response paths.
- Use a durable queue with retry/backoff, dead-letter handling, deduplication and observable job states.
- Reuse the existing notification log/deduplication concepts where appropriate, but do not treat a database table as a reliable queue until claiming/locking, retries, visibility timeouts and worker concurrency are designed.
- Payment webhooks and payment finalisation must remain idempotent and transactionally safe.

### Observability and operations
- Track Vercel request/function metrics, Supabase database CPU/memory/connections, slow queries, Edge Function duration/error rate, queue depth and provider failures.
- Add structured request IDs and correlation IDs from frontend/API through database/job logs.
- Alert on error-rate spikes, p95 latency, database saturation, failed webhook processing and growing queue backlog.
- Maintain automated backups, restore drills, migration rollback procedures and a tested incident runbook.

## 4. Implementation roadmap

### Phase 0 — Baseline and safety
1. Capture current Vercel/Supabase plan limits, region, deployment settings, secrets inventory (names only), logs and metrics.
2. Establish baseline page performance and API/database timings.
3. Create staging and load-test environments; never load-test production payment endpoints with real money.
4. Add automated tenant-isolation and payment idempotency regression tests.
5. Record current RLS policies, grants, triggers, functions, extensions, storage buckets and Edge Function configurations for OrderPing only.

**Exit:** reproducible baseline, documented recovery path, no cross-tenant regression.

### Phase 1 — Remove immediate bottlenecks
1. Replace dashboard full-history downloads with server-side paginated list endpoints and aggregate queries for totals, outstanding balances and time-series summaries.
2. Fetch only the columns each screen needs.
3. Add route-level code splitting; investigate the >500 kB chunk warning and reduce initial JS.
4. Audit query plans for orders, payment records, appointments, catalog and vendor lookups.
5. Review the three unindexed OrderPing foreign keys and add only justified indexes.
6. Add cancellation/abort handling and avoid duplicate requests on navigation or refresh.

**Exit:** dashboard queries have bounded result sizes; mobile performance targets are met at low/moderate load; all query plans reviewed.

### Phase 2 — Isolate OrderPing infrastructure
1. Provision a separate Supabase project for OrderPing; choose the region using latency measurements from Nigeria and the provider's available-region options.
2. Recreate only the OrderPing schema, grants, RLS policies, functions/triggers, extensions and required storage configuration.
3. Migrate OrderPing rows, Auth users/identity configuration as applicable, storage objects, Edge Functions and their environment secrets through a controlled migration.
4. Verify all foreign keys, payment ledger consistency, customer tracking links, booking/order flows and vendor login in staging.
5. Run read-only reconciliation and application smoke tests before cutover.
6. Plan a maintenance window or a carefully tested low-downtime cutover; keep a rollback path to the original project until verification is complete.

**Critical constraint:** do not migrate, modify, or delete unrelated schemas, users, functions, storage buckets or data belonging to Predivic School, Oka Rides, MEKA Apply or other applications. Do not assume that copying only the `orderping` schema is sufficient; Auth, Storage, Edge Functions, secrets, API exposure and project-level Auth settings require separate handling.

**Exit:** OrderPing runs independently in staging, with validated tenant isolation and reconciled data.

### Phase 3 — Resilience and background work
1. Introduce durable asynchronous jobs for notifications, retries and reports.
2. Add provider-specific timeouts, retry budgets, exponential backoff and dead-letter review.
3. Add idempotency keys and concurrency controls to all externally retried write paths.
4. Add shared caching only where instrumentation shows a material benefit.
5. Define backup/restore, deployment rollback and incident response procedures.

**Exit:** background jobs recover from worker restarts and provider outages without duplicate notifications, orders or payments.

### Phase 4 — Load and capacity validation
Run k6 or an equivalent load test against staging using synthetic businesses and data. Model a mix of storefront browsing, product reads, vendor dashboard reads, order submissions, appointment bookings and vendor updates.

Ramp through 100, 250, 500 and 1,000 concurrent users; include a 2,000-user short spike test. Run a sustained 1,000-user test long enough to reveal connection leaks, queue growth and database saturation. Keep payment-provider interactions mocked or sandboxed.

Collect p50/p95/p99 latency, throughput, error rate, Vercel function concurrency/duration, Supabase CPU/memory/connections, slow queries, cache hit rate and queue backlog. Fix bottlenecks and repeat.

**Exit:** meet the target SLOs in section 2 with no tenant leakage, duplicate financial writes or unbounded queue growth.

### Phase 5 — Controlled production rollout
- Deploy in a low-traffic window with database and application rollback procedures.
- Start with a limited cohort, monitor closely, then expand.
- Increase database compute or function capacity based on observed saturation, not speculation.
- Add read replicas or a dedicated cache only when metrics justify them.
- Review capacity monthly and repeat load tests after major architectural changes.

## 5. Load-test workload proposal

Initial test mix (to be adjusted using real usage analytics):
- 55% public storefront/catalog reads
- 20% authenticated dashboard/list/summary reads
- 10% order submissions
- 5% appointment/reservation submissions
- 5% vendor order/status/payment-ledger writes
- 5% customer order tracking reads

Use unique synthetic tenant IDs and realistic data distribution. Include hot tenants, many small tenants, large tenants, and uneven traffic. Verify tenant isolation during the test. Do not use real customer data.

## 6. Decisions and guardrails

- Initial target: **1,000 concurrent active users**.
- First growth milestone: **10,000 registered users**.
- Preserve the current React/Vite + Vercel + Supabase architecture unless measurements demonstrate a specific limitation.
- Prioritise dedicated OrderPing database isolation and removal of unbounded dashboard reads before adding product features.
- Do not weaken RLS, tenant isolation, payment idempotency, server-side validation or rate limiting for performance.
- Do not alter the Predivic School project/database or unrelated schemas in the shared Supabase project.
- Do not make production migrations, change Supabase plans, purchase infrastructure, or switch regions without a separate reviewed change plan and explicit approval.

## 7. Audit evidence and limitations

Evidence inspected on 21 November 2026:
- Vercel project metadata and latest preview deployment.
- OrderPing repository files: `package.json`, `src/main.tsx`, `src/lib/supabase.ts`, `src/App.tsx`, `vite.config.ts`, `vercel.json`.
- Supabase project metadata, OrderPing table/column/foreign-key definitions, approximate table statistics, index definitions, performance/security/health advisors, migration list and Edge Function inventory.

Limitations:
- This is a configuration/code/database metadata audit, not a live penetration test, browser performance lab or capacity test.
- PostgreSQL row statistics are estimates and are very small at present.
- No production traffic metrics or verified 1,000-user test results were available.
- Some Supabase advisor findings concern the shared project's other schemas; they are explicitly out of OrderPing implementation scope.
- Current performance targets are proposed acceptance criteria, not measured service guarantees.

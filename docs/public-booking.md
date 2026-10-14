# Public appointment booking

- Public route: `/book/:slug`, linked from a business storefront.
- Supports service listings, durations/prices, business hours, customer contact details, and appointment requests.
- Uses the `public-booking` Supabase Edge Function; the service-role key stays server-side.
- Appointment inserts use the existing overlap-protection database trigger, so simultaneous requests for the same time cannot both be accepted.
- Requests are created as `pending`; the business must confirm them in its appointment management workflow.
- This page does not collect customer payments or promise immediate confirmation.
- Booking availability is derived from the business's configured `business_hours`. Owners must configure service items and opening hours before publishing the link.
- Deploy `public-booking` before using the route in a deployed frontend.

## Pilot salon checklist

1. Confirm the salon business profile and slug.
2. Add each bookable service to the catalogue with a duration and price.
3. Set opening/closing times for each weekday and mark closed days.
4. Share `https://orderping.vercel.app/book/<business-slug>` after the frontend and Edge Function are deployed.
5. Review incoming appointment requests and confirm or cancel them from the vendor workflow.

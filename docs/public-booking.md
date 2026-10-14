# Public appointment booking

OrderPing's shared appointment-booking feature is designed for any appointment-based or service business—not a salon-specific product. Examples include salons, barbershops, spas, consultants, repair services, photographers, tutors, and other providers.

- Public route: `/book/:slug`, linked from each business storefront.
- Each business sees its own active services, prices, durations, opening hours, and appointments.
- Customers can request an appointment without creating an OrderPing account.
- The `public-booking` Supabase Edge Function validates requests, rate-limits public traffic, checks business-local opening hours, and writes appointment requests.
- Existing database overlap protection prevents two active appointments from occupying the same business time slot.
- Requests are created as `pending`; the business must confirm or cancel them.
- This page does not collect customer payments or promise immediate confirmation.
- Business owners must configure service items and opening hours before sharing their booking link.
- Deploy `public-booking` before using the route in production.

## Pilot rollout

One of the five free pilot businesses happens to be a salon and can be used as the first real-world tester. The same booking feature remains available to all eligible OrderPing service businesses.

1. Confirm each pilot business profile and slug.
2. Add bookable services with duration and price.
3. Configure opening/closing times for each weekday and mark closed days.
4. Share `https://orderping.vercel.app/book/<business-slug>` after the frontend and Edge Function are deployed.
5. Review and manage requests from the vendor appointment dashboard. The appointment review/confirmation UI must be completed before this workflow is end-to-end ready.

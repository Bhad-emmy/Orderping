import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
async function digest(v: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 12000) return json({ error: "Request too large." }, 413);
    const body = await req.json();
    const action = text(body?.action, 12);
    const slug = text(body?.slug, 50).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) return json({ error: "Booking link is invalid." }, 400);
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Server configuration is incomplete." }, 503);
    const db = createClient(url, key, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown").slice(0, 120);
    const { data: rateData, error: rateError } = await db.rpc("consume_rate_limit", {
      p_bucket_key: await digest("public-booking:" + ip), p_limit: 30, p_window_seconds: 60,
    });
    if (rateError) return json({ error: "Booking service is temporarily unavailable." }, 503);
    const rate = Array.isArray(rateData) ? rateData[0] : rateData;
    if (!rate?.allowed) return json({ error: "Too many requests. Please wait a minute." }, 429);

    const { data: business, error: businessError } = await db.from("businesses")
      .select("id,name,slug,timezone,business_type,whatsapp_number")
      .eq("slug", slug).maybeSingle();
    if (businessError) return json({ error: "Business could not be loaded." }, 500);
    if (!business) return json({ error: "This business could not be found." }, 404);

    if (action === "load") {
      const [{ data: services, error: serviceError }, { data: hours, error: hoursError }] = await Promise.all([
        db.from("catalog_items").select("id,name,description,price_minor,duration_minutes")
          .eq("business_id", business.id).eq("type", "service").eq("is_active", true).order("name"),
        db.from("business_hours").select("weekday,opens_at,closes_at,is_closed")
          .eq("business_id", business.id).order("weekday"),
      ]);
      if (serviceError || hoursError) return json({ error: "Booking options could not be loaded." }, 500);
      return json({ business, services: services || [], hours: hours || [] });
    }

    if (action !== "book") return json({ error: "Unknown booking action." }, 400);
    const serviceId = body?.service_id;
    const name = text(body?.customer_name, 120);
    const phone = text(body?.customer_phone, 32);
    const email = text(body?.customer_email, 254) || null;
    const note = text(body?.customer_note, 500) || null;
    const startsAt = typeof body?.starts_at === "string" ? Date.parse(body.starts_at) : NaN;
    if ((serviceId && !uuid(serviceId)) || !name || !/^[+0-9() .-]{5,32}$/.test(phone)) return json({ error: "Enter your name and phone number." }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (!Number.isFinite(startsAt) || startsAt < Date.now() + 60_000 || startsAt > Date.now() + 90 * 24 * 60 * 60 * 1000) {
      return json({ error: "Choose an appointment time within the next 90 days." }, 400);
    }
    // A service and price are optional: businesses may quote after assessing the work in person.
    let service: { id: string; name: string; price_minor: number | null; duration_minutes: number | null } | null = null;
    if (serviceId) {
      if (!uuid(serviceId)) return json({ error: "Service selection is invalid." }, 400);
      const { data, error: serviceError } = await db.from("catalog_items")
        .select("id,name,price_minor,duration_minutes")
        .eq("id", serviceId).eq("business_id", business.id).eq("type", "service").eq("is_active", true).maybeSingle();
      if (serviceError) return json({ error: "Service could not be checked." }, 500);
      if (!data) return json({ error: "That service is no longer available." }, 400);
      service = data;
    }
    const durationMinutes = Number(service?.duration_minutes) > 0 ? Number(service?.duration_minutes) : 30;
    const start = new Date(startsAt);
    const end = new Date(startsAt + durationMinutes * 60_000);
    const businessTimezone = text(business.timezone, 80) || "Africa/Lagos";
    const localParts = (d: Date) => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: businessTimezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(d);
      const part = (type: string) => parts.find(p => p.type === type)?.value || "";
      const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { weekday: weekdayMap[part("weekday")], minutes: Number(part("hour")) * 60 + Number(part("minute")) };
    };
    let localStart: ReturnType<typeof localParts>, localEnd: ReturnType<typeof localParts>;
    try { localStart = localParts(start); localEnd = localParts(end); }
    catch { return json({ error: "Business timezone is invalid. Contact the business." }, 500); }
    const weekday = localStart.weekday;
    const { data: hours, error: hoursError } = await db.from("business_hours").select("opens_at,closes_at,is_closed")
      .eq("business_id", business.id).eq("weekday", weekday).maybeSingle();
    if (hoursError) return json({ error: "Business hours could not be checked." }, 500);
    if (!hours || hours.is_closed || !hours.opens_at || !hours.closes_at) return json({ error: "The business is closed on that day." }, 400);
    const toMinutes = (v: string) => { const [h, m] = v.slice(0, 5).split(":").map(Number); return h * 60 + m; };
    if (localStart.minutes < toMinutes(String(hours.opens_at)) || localEnd.minutes > toMinutes(String(hours.closes_at)) || localEnd.weekday !== weekday) {
      return json({ error: "Choose a time within the business opening hours." }, 400);
    }
    const { data: appointment, error: insertError } = await db.from("appointments").insert({
      business_id: business.id, catalog_item_id: service?.id ?? null, customer_name: name, customer_phone: phone,
      customer_email: email, customer_note: note, starts_at: start.toISOString(), ends_at: end.toISOString(),
      status: "pending", total_amount_minor: service ? Number(service.price_minor) : null, amount_paid_minor: 0, currency_code: "NGN",
    }).select("id,status,starts_at,ends_at,total_amount_minor,created_at").single();
    if (insertError) {
      if (insertError.code === "23P01" || /slot is no longer available|overlap/i.test(insertError.message || "")) {
        return json({ error: "That time was just booked. Please choose another slot." }, 409);
      }
      return json({ error: "Your appointment could not be saved. Please try another time." }, 500);
    }
    return json({ success: true, appointment: { ...appointment, service_name: service?.name ?? "Price agreed at location" }, business: { name: business.name } }, 201);
  } catch {
    return json({ error: "Booking could not be completed. Please try again." }, 500);
  }
});

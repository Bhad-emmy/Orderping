import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 5000) return json({ error: "Request too large." }, 413);
    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: "Password must be between 8 and 128 characters." }, 400);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({ error: "Signup is temporarily unavailable." }, 503);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 120);
    const db = createClient(url, service, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: rate, error: rateError } = await db.rpc("consume_rate_limit", {
      p_bucket_key: await sha256("vendor-signup:" + ip), p_limit: 5, p_window_seconds: 3600,
    });
    if (rateError) return json({ error: "Signup is temporarily unavailable." }, 503);
    const allowance = Array.isArray(rate) ? rate[0] : rate;
    if (!allowance?.allowed) return json({ error: "Too many signup attempts. Try again later." }, 429);
    // Never mutate or confirm an existing identity in the shared Auth project:
    // Oka Rides uses the same Supabase Auth tenant.
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { product: "orderping" },
    });
    if (error || !data.user) {
      console.warn("OrderPing signup rejected", error?.status || "unknown");
      return json({ error: "Could not create this account. If the email is already in use, sign in instead." }, 409);
    }
    return json({ success: true });
  } catch {
    return json({ error: "Signup could not be completed. Please try again." }, 400);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store, private" },
  });
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    if (Number(req.headers.get("content-length") || 0) > 4000) {
      return json({ error: "Request too large." }, 413);
    }

    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return json({ error: "Sign in to create a customer tracking link." }, 401);
    }

    const body = await req.json();
    const orderId = body?.order_id;
    const businessId = body?.business_id;
    if (!uuid(orderId) || !uuid(businessId)) {
      return json({ error: "Order or business reference is invalid." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      return json({ error: "Server configuration is incomplete." }, 503);
    }

    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
    }

    const db = createClient(url, serviceKey, {
      db: { schema: "orderping" },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const bucket = await hash("vendor-order-link:user:" + authData.user.id);
    const { data: rateData, error: rateError } = await db.rpc("consume_rate_limit", {
      p_bucket_key: bucket,
      p_limit: 20,
      p_window_seconds: 60,
    });
    if (rateError) return json({ error: "Tracking link service is temporarily unavailable." }, 503);
    const rate = Array.isArray(rateData) ? rateData[0] : rateData;
    if (!rate?.allowed) return json({ error: "Too many requests. Wait a minute and try again." }, 429);

    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id, owner_id")
      .eq("id", businessId)
      .maybeSingle();
    if (businessError) return json({ error: "Business could not be verified." }, 500);
    if (!business || business.owner_id !== authData.user.id) {
      return json({ error: "You are not allowed to create a link for this business." }, 403);
    }

    const { data: order, error: orderError } = await db
      .from("orders")
      .select("id, business_id, order_type")
      .eq("id", orderId)
      .eq("business_id", businessId)
      .eq("order_type", "order")
      .maybeSingle();
    if (orderError) return json({ error: "Order could not be verified." }, 500);
    if (!order) return json({ error: "Order not found for this business." }, 404);

    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const tokenHash = await hash(token);
    const { error: updateError } = await db
      .from("orders")
      .update({ customer_access_token_hash: tokenHash, updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("business_id", businessId);
    if (updateError) return json({ error: "A tracking link could not be created. Please try again." }, 500);

    return json({ success: true, order_id: orderId, customer_access_token: token });
  } catch {
    return json({ error: "A tracking link could not be created. Please try again." }, 500);
  }
});

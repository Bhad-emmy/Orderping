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
const escapeHtml = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\x27/g,"&#39;");
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
    const reissue = body?.reissue === true;
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
      .select("id, owner_id, name, slug")
      .eq("id", businessId)
      .maybeSingle();
    if (businessError) return json({ error: "Business could not be verified." }, 500);
    if (!business || business.owner_id !== authData.user.id) {
      return json({ error: "You are not allowed to create a link for this business." }, 403);
    }

    const { data: order, error: orderError } = await db
      .from("orders")
      .select("id, business_id, order_type, status, customer_name, customer_email, total_amount_minor, customer_access_token_hash")
      .eq("id", orderId)
      .eq("business_id", businessId)
      .eq("order_type", "order")
      .maybeSingle();
    if (orderError) return json({ error: "Order could not be verified." }, 500);
    if (!order) return json({ error: "Order not found for this business." }, 404);
    if (!["processing", "ready", "dispatched", "delivered"].includes(order.status)) return json({ error: "Confirm the order before activating customer tracking." }, 409);
    const { data: payments, error: paymentError } = await db.from("payment_records").select("amount_minor").eq("order_id", orderId).eq("business_id", businessId);
    if (paymentError) return json({ error: "Payment status could not be verified." }, 500);
    if (!(payments || []).some((p) => Number(p.amount_minor) > 0)) return json({ error: "Record at least one payment before activating customer tracking." }, 409);
    if (order.customer_access_token_hash && !reissue) return json({ error: "Tracking is already active. Use the explicit reissue action to replace the customer link." }, 409);

    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const tokenHash = await hash(token);
    let updateQuery = db.from("orders")
      .update({ customer_access_token_hash: tokenHash, updated_at: new Date().toISOString() })
      .eq("id", orderId).eq("business_id", businessId);
    if (reissue && order.customer_access_token_hash) updateQuery = updateQuery.eq("customer_access_token_hash", order.customer_access_token_hash);
    else updateQuery = updateQuery.is("customer_access_token_hash", null);
    const { data: updated, error: updateError } = await updateQuery.select("id").maybeSingle();
    if (updateError) return json({ error: "A tracking link could not be created. Please try again." }, 500);
    if (!updated) return json({ error: "Tracking changed during this request. Refresh the order and try again." }, 409);

    let emailNotification = "not_requested";
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (order.customer_email && resendKey) {
      const siteUrl = (Deno.env.get("ORDERPING_SITE_URL") || "https://orderping.vercel.app").replace(/\/$/, "");
      const trackingUrl = siteUrl + "/store/" + encodeURIComponent(business.slug) + "?track=" + encodeURIComponent(token);
      const from = Deno.env.get("RESEND_FROM_EMAIL") || "OrderPing <onboarding@resend.dev>";
      try {
        const mail = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            from, to: [order.customer_email],
            subject: "Your updated order tracking link — OrderPing #" + order.id.slice(0, 8).toUpperCase(),
            html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#182230"><h1>Your order tracking link is updated, ' + escapeHtml(order.customer_name || "customer") + '.</h1><p>The store has issued a replacement private link for order #' + order.id.slice(0, 8).toUpperCase() + '.</p><p><strong>Order total:</strong> ' + (Number(order.total_amount_minor) / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" }) + '</p><p><a href="' + trackingUrl + '" style="display:inline-block;padding:12px 18px;background:#171923;color:#fff;text-decoration:none;border-radius:8px">Track my order and balance</a></p><p style="font-size:12px;color:#667085">The previous tracking link has been invalidated. Keep this private link safe.</p></div>'
          }),
        });
        if (mail.ok) emailNotification = "sent";
        else { emailNotification = "failed"; console.error("OrderPing tracking reissue email failed", mail.status, (await mail.text()).slice(0, 300)); }
      } catch (err) { emailNotification = "failed"; console.error("OrderPing tracking reissue email request failed", String(err).slice(0, 200)); }
    } else if (order.customer_email) emailNotification = "not_configured";

    return json({ success: true, order_id: orderId, customer_access_token: token, email_notification: emailNotification, reissued: reissue });
  } catch {
    return json({ error: "A tracking link could not be created. Please try again." }, 500);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
async function hash(v: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 4000) return json({ error: "Request too large." }, 413);
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: "Sign in to activate customer tracking." }, 401);
    const body = await req.json();
    const orderId = body?.order_id;
    const businessId = body?.business_id;
    if (!uuid(orderId) || !uuid(businessId)) return json({ error: "Order or business reference is invalid." }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete." }, 503);
    const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser();
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);

    const db = createClient(url, serviceKey, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: business, error: businessError } = await db.from("businesses").select("id,owner_id,name,slug").eq("id", businessId).maybeSingle();
    if (businessError) return json({ error: "Business could not be verified." }, 500);
    if (!business || business.owner_id !== authData.user.id) return json({ error: "You are not allowed to activate tracking for this business." }, 403);

    const { data: order, error: orderError } = await db.from("orders")
      .select("id,business_id,status,order_type,customer_name,customer_email,total_amount_minor,customer_access_token_hash")
      .eq("id", orderId).eq("business_id", businessId).eq("order_type", "order").maybeSingle();
    if (orderError) return json({ error: "Order could not be verified." }, 500);
    if (!order) return json({ error: "Order not found for this business." }, 404);
    if (order.status === "new" || order.status === "cancelled") return json({ success: true, activated: false, reason: "awaiting_vendor_confirmation" });
    if (!["processing", "ready", "dispatched", "delivered"].includes(order.status)) return json({ success: true, activated: false, reason: "order_not_confirmed" });

    const { data: payments, error: paymentError } = await db.from("payment_records").select("amount_minor")
      .eq("order_id", orderId).eq("business_id", businessId);
    if (paymentError) return json({ error: "Payment status could not be verified." }, 500);
    const paid = (payments || []).reduce((sum, p) => sum + Number(p.amount_minor || 0), 0);
    if (!Number.isSafeInteger(paid) || paid <= 0) return json({ success: true, activated: false, reason: "awaiting_first_payment" });
    if (paid > Number(order.total_amount_minor)) return json({ error: "Recorded payments exceed the order total. Resolve the ledger before activating tracking." }, 409);

    if (order.customer_access_token_hash) return json({ success: true, activated: true, already_active: true, email_notification: "not_repeated" });

    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const tokenHash = await hash(token);
    // Conditional update ensures concurrent requests cannot activate multiple different links.
    const { data: updated, error: updateError } = await db.from("orders")
      .update({ customer_access_token_hash: tokenHash, updated_at: new Date().toISOString() })
      .eq("id", orderId).eq("business_id", businessId).in("status", ["processing", "ready", "dispatched", "delivered"])
      .is("customer_access_token_hash", null).select("id").maybeSingle();
    if (updateError) return json({ error: "Tracking could not be activated." }, 500);
    if (!updated) return json({ success: true, activated: true, already_active: true, email_notification: "not_repeated" });

    let emailNotification = "not_requested";
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (order.customer_email && resendKey) {
      const siteUrl = (Deno.env.get("ORDERPING_SITE_URL") || "https://orderping.vercel.app").replace(/\/$/, "");
      const trackingUrl = siteUrl + "/store/" + encodeURIComponent(business.slug) + "?track=" + encodeURIComponent(token);
      const from = Deno.env.get("RESEND_FROM_EMAIL") || "OrderPing <onboarding@resend.dev>";
      try {
        const mail = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [order.customer_email],
            subject: "Your order is confirmed — OrderPing #" + order.id.slice(0, 8).toUpperCase(),
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#182230"><h1>Your order is confirmed, ${escapeHtml(order.customer_name)}.</h1><p>The store has confirmed your order and recorded your first payment.</p><p><strong>Order reference:</strong> #${order.id.slice(0, 8).toUpperCase()}</p><p><strong>Order total:</strong> ${(Number(order.total_amount_minor) / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" })}</p><p>Use your private link to track order progress, see payments, and check the remaining balance.</p><p><a href="${trackingUrl}" style="display:inline-block;padding:12px 18px;background:#171923;color:#fff;text-decoration:none;border-radius:8px">Track my order and balance</a></p><p style="font-size:12px;color:#667085">Keep this private link safe. Anyone with it can view this order.</p></div>`,
          }),
        });
        if (mail.ok) emailNotification = "sent";
        else { emailNotification = "failed"; console.error("OrderPing activation email failed", mail.status, (await mail.text()).slice(0, 400)); }
      } catch (err) { emailNotification = "failed"; console.error("OrderPing activation email request failed", String(err).slice(0, 250)); }
    } else if (order.customer_email) emailNotification = "not_configured";
    return json({ success: true, activated: true, customer_access_token: token, email_notification: emailNotification });
  } catch {
    return json({ error: "Customer tracking could not be activated." }, 500);
  }
});

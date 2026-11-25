import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const uuid = (value: unknown) => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 4000) return json({ error: "Request too large." }, 413);
    const body = await req.json();
    const orderId = body?.order_id;
    if (!uuid(orderId)) return json({ error: "A valid order reference is required." }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secret = Deno.env.get("FLW_SECRET_KEY");
    const appUrl = (Deno.env.get("ORDERPING_PUBLIC_URL") || "https://orderping.vercel.app").replace(/\/$/, "");
    if (!url || !service || !secret) return json({ error: "Online payments are not configured yet." }, 503);
    const db = createClient(url, service, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });

    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown").slice(0, 120);
    for (const [key, limit, windowSeconds] of [
      ["flw-checkout:ip:" + ip, 12, 300],
      ["flw-checkout:order:" + orderId, 4, 300],
    ] as const) {
      const { data, error } = await db.rpc("consume_rate_limit", {
        p_bucket_key: await sha256(key), p_limit: limit, p_window_seconds: windowSeconds,
      });
      if (error) return json({ error: "Checkout is temporarily unavailable." }, 503);
      const rate = Array.isArray(data) ? data[0] : data;
      if (!rate?.allowed) return json({ error: "Too many payment attempts. Wait a few minutes and try again." }, 429);
    }

    const { data: order, error: orderError } = await db.from("orders")
      .select("id,business_id,customer_name,customer_email,customer_phone,status,order_type,total_amount_minor,amount_paid_minor,currency_code")
      .eq("id", orderId).maybeSingle();
    if (orderError) return json({ error: "Could not load this order." }, 500);
    if (!order || order.order_type !== "order") return json({ error: "Order not found." }, 404);
    if (order.status === "cancelled") return json({ error: "This order has been cancelled." }, 409);
    if (!order.customer_email) return json({ error: "This order needs a customer email before online payment can be used." }, 409);
    if (String(order.currency_code).trim() !== "NGN") return json({ error: "Only NGN orders are supported." }, 409);

    const { data: business, error: businessError } = await db.from("businesses")
      .select("id,name,slug,approval_status").eq("id", order.business_id).maybeSingle();
    if (businessError) return json({ error: "Could not verify the store." }, 500);
    if (!business || business.approval_status !== "approved") return json({ error: "This store is not approved for online payments." }, 409);

    const { data: account, error: accountError } = await db.from("vendor_payment_accounts")
      .select("id,provider_subaccount_id,status").eq("business_id", business.id)
      .eq("provider", "flutterwave").eq("status", "active").maybeSingle();
    if (accountError) return json({ error: "Could not verify the vendor settlement account." }, 500);
    if (!account?.provider_subaccount_id) return json({ error: "This store has not enabled online payments yet. Contact the seller to arrange payment." }, 409);

    const amountMinor = Number(order.total_amount_minor) - Number(order.amount_paid_minor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return json({ error: "There is no outstanding balance on this order." }, 409);

    // Reuse a recent hosted link to reduce accidental duplicate checkout sessions.
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: recent } = await db.from("payment_transactions")
      .select("tx_ref,checkout_url,amount_minor")
      .eq("order_id", order.id).in("status", ["initiated", "pending"])
      .gt("initiated_at", cutoff).order("initiated_at", { ascending: false }).limit(1).maybeSingle();
    if (recent?.checkout_url && Number(recent.amount_minor) === amountMinor) {
      return json({ success: true, checkout_url: recent.checkout_url, tx_ref: recent.tx_ref, reused: true });
    }

    const txRef = "OP-" + crypto.randomUUID();
    const { data: transaction, error: transactionError } = await db.from("payment_transactions").insert({
      business_id: business.id, order_id: order.id, vendor_payment_account_id: account.id,
      provider: "flutterwave", tx_ref: txRef, amount_minor: amountMinor,
      currency_code: "NGN", status: "initiated", customer_email: order.customer_email,
      platform_fee_minor: 0,
    }).select("id").single();
    if (transactionError || !transaction) return json({ error: "Could not prepare the payment." }, 500);

    const providerResponse = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: Number((amountMinor / 100).toFixed(2)),
        currency: "NGN",
        redirect_url: appUrl + "/payment-return",
        customer: { email: order.customer_email, name: order.customer_name, phone_number: order.customer_phone },
        customizations: { title: business.name + " checkout", description: "Order payment via OrderPing" },
        configuration: { session_duration: 30, max_retry_attempt: 3 },
        subaccounts: [{ id: account.provider_subaccount_id }],
        meta: { orderping_order_id: order.id, orderping_business_id: business.id, orderping_tx_ref: txRef },
      }),
    });
    const provider = await providerResponse.json().catch(() => ({}));
    const checkoutUrl = provider?.data?.link;
    if (!providerResponse.ok || provider?.status !== "success" || typeof checkoutUrl !== "string" ||
        !checkoutUrl.startsWith("https://checkout.flutterwave.com/")) {
      const code = String(provider?.code || providerResponse.status).slice(0, 80);
      await db.from("payment_transactions").update({
        status: "failed", failure_code: code, failure_message: "Flutterwave checkout initialization failed.",
        updated_at: new Date().toISOString(),
      }).eq("id", transaction.id);
      console.warn("Flutterwave checkout initialization failed", providerResponse.status, code);
      return json({ error: "Flutterwave could not start checkout. Please try again." }, 502);
    }
    const { error: updateError } = await db.from("payment_transactions").update({
      status: "pending", checkout_url: checkoutUrl, updated_at: new Date().toISOString(),
    }).eq("id", transaction.id);
    if (updateError) return json({ error: "Checkout was created but could not be saved. Contact support before retrying." }, 500);
    return json({ success: true, checkout_url: checkoutUrl, tx_ref: txRef });
  } catch (error) {
    console.error("Flutterwave checkout error", error);
    return json({ error: "Could not start checkout. Please try again." }, 500);
  }
});

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
const refPattern = /^OP-[0-9a-f-]{36}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 3000) return json({ error: "Request too large." }, 413);
    const body = await req.json();
    const txRef = typeof body?.tx_ref === "string" ? body.tx_ref.trim() : "";
    const providerTransactionId = typeof body?.transaction_id === "string" || typeof body?.transaction_id === "number"
      ? String(body.transaction_id).trim() : "";
    if (!refPattern.test(txRef) || !/^\d{1,30}$/.test(providerTransactionId)) {
      return json({ error: "Invalid payment reference." }, 400);
    }
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secret = Deno.env.get("FLW_SECRET_KEY");
    if (!url || !service || !secret) return json({ error: "Payment verification is not configured." }, 503);
    const db = createClient(url, service, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown").slice(0, 120);
    for (const key of ["flw-verify:ip:" + ip, "flw-verify:ref:" + txRef]) {
      const bucket = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
      const bucketKey = [...new Uint8Array(bucket)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data: rateData, error: rateError } = await db.rpc("consume_rate_limit", {
        p_bucket_key: bucketKey, p_limit: 20, p_window_seconds: 60,
      });
      if (rateError) return json({ error: "Payment verification is temporarily unavailable." }, 503);
      const rate = Array.isArray(rateData) ? rateData[0] : rateData;
      if (!rate?.allowed) return json({ error: "Too many verification attempts. Wait a minute and try again." }, 429);
    }

    const { data: transaction, error: transactionError } = await db.from("payment_transactions")
      .select("id,tx_ref,amount_minor,currency_code,status,provider_transaction_id")
      .eq("tx_ref", txRef).eq("provider", "flutterwave").maybeSingle();
    if (transactionError) return json({ error: "Could not load payment reference." }, 500);
    if (!transaction) return json({ error: "Payment reference not found." }, 404);
    if (transaction.status === "successful" && transaction.provider_transaction_id === providerTransactionId) {
      return json({ success: true, paid: true, duplicate: true });
    }

    const response = await fetch("https://api.flutterwave.com/v3/transactions/" +
      encodeURIComponent(providerTransactionId) + "/verify", {
      headers: { Authorization: "Bearer " + secret, Accept: "application/json" },
    });
    const provider = await response.json().catch(() => ({}));
    if (!response.ok || provider?.status !== "success" || !provider?.data) {
      console.warn("Flutterwave verification API error", response.status);
      return json({ error: "Flutterwave verification is temporarily unavailable. Try again shortly." }, 502);
    }
    const verified = provider.data;
    if (String(verified.tx_ref || "") !== txRef) return json({ error: "The provider transaction reference does not match." }, 409);
    if (String(verified.id) !== providerTransactionId) return json({ error: "The provider transaction ID does not match." }, 409);
    const providerStatus = String(verified.status || "").toLowerCase();
    if (providerStatus !== "successful") {
      if (["failed", "cancelled"].includes(providerStatus)) {
        await db.from("payment_transactions").update({
          status: providerStatus, failure_code: providerStatus,
          failure_message: "Flutterwave reported that the payment did not complete.",
          provider_transaction_id: providerTransactionId, updated_at: new Date().toISOString(),
        }).eq("id", transaction.id).in("status", ["initiated", "pending"]);
      }
      return json({ success: false, paid: false, status: providerStatus || "pending" });
    }
    const currency = String(verified.currency || "").toUpperCase();
    const amountMinor = Math.round(Number(verified.amount) * 100);
    if (currency !== "NGN" || !Number.isSafeInteger(amountMinor) ||
        amountMinor !== Number(transaction.amount_minor) ||
        currency !== String(transaction.currency_code).trim().toUpperCase()) {
      console.error("Flutterwave verification mismatch", txRef, currency, amountMinor);
      return json({ error: "The verified amount or currency does not match this order. Contact support." }, 409);
    }

    const { data: finalized, error: finalizeError } = await db.rpc("finalize_flutterwave_payment", {
      p_tx_ref: txRef,
      p_provider_transaction_id: providerTransactionId,
      p_amount_minor: amountMinor,
      p_currency_code: currency,
      p_provider_fee_minor: null,
      p_platform_fee_minor: 0,
    });
    if (finalizeError) {
      console.error("OrderPing payment finalization failed", txRef, finalizeError.message);
      return json({ error: "Payment was verified, but the order ledger could not be updated. Contact support with reference " + txRef + "." }, 500);
    }
    return json({ success: true, paid: true, duplicate: Boolean(finalized?.duplicate), tx_ref: txRef });
  } catch (error) {
    console.error("Flutterwave payment verification failed", error);
    return json({ error: "Could not verify this payment. Please refresh and try again." }, 500);
  }
});

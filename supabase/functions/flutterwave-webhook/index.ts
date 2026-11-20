import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
function constantTimeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const expectedHash = Deno.env.get("FLW_WEBHOOK_HASH");
  const signature = req.headers.get("verif-hash") || "";
  if (!expectedHash || !signature || !constantTimeEqual(signature, expectedHash)) {
    return json({ error: "Invalid webhook signature." }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("FLW_SECRET_KEY");
  if (!url || !service || !secret) return json({ error: "Webhook is not configured." }, 503);

  let raw = "";
  try {
    raw = await req.text();
    if (raw.length > 100_000) return json({ error: "Payload too large." }, 413);
    const payload = JSON.parse(raw);
    const eventType = String(payload?.event || "");
    const data = payload?.data || {};
    const txRef = String(data?.tx_ref || "");
    const providerTransactionId = String(data?.id || "");
    const providerEventId = String(payload?.id || (providerTransactionId + ":" + eventType));
    const db = createClient(url, service, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });
    const payloadHash = await sha256(raw);

    const { error: eventError } = await db.from("payment_webhook_events").upsert({
      provider: "flutterwave", provider_event_id: providerEventId,
      event_type: eventType || "unknown", payload_hash: payloadHash,
      processing_status: "received", attempts: 1, last_error: null,
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
    if (eventError) {
      console.error("Could not persist Flutterwave webhook event", eventError.message);
      return json({ error: "Could not record webhook event." }, 500);
    }

    // This Supabase project also serves other products. Ignore non-OrderPing references.
    if (!txRef.startsWith("OP-")) {
      await db.from("payment_webhook_events").update({ processing_status: "ignored", processed_at: new Date().toISOString() })
        .eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
      return json({ received: true, ignored: true });
    }
    if (eventType !== "charge.completed" || !providerTransactionId) {
      await db.from("payment_webhook_events").update({ processing_status: "ignored", processed_at: new Date().toISOString() })
        .eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
      return json({ received: true, ignored: true });
    }

    const verifyResponse = await fetch("https://api.flutterwave.com/v3/transactions/" +
      encodeURIComponent(providerTransactionId) + "/verify", {
      headers: { Authorization: "Bearer " + secret, Accept: "application/json" },
    });
    const verifiedPayload = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || verifiedPayload?.status !== "success" || !verifiedPayload?.data) {
      await db.from("payment_webhook_events").update({
        processing_status: "failed", attempts: 1, last_error: "Provider verification request failed.",
      }).eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
      return json({ error: "Provider verification failed; retry this webhook." }, 500);
    }

    const verified = verifiedPayload.data;
    if (String(verified.tx_ref || "") !== txRef || String(verified.id) !== providerTransactionId) {
      await db.from("payment_webhook_events").update({
        processing_status: "failed", attempts: 1, last_error: "Provider reference mismatch.",
      }).eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
      return json({ error: "Provider transaction mismatch." }, 400);
    }
    if (String(verified.status || "").toLowerCase() !== "successful") {
      await db.from("payment_webhook_events").update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
      return json({ received: true, paid: false });
    }

    const currency = String(verified.currency || "").toUpperCase();
    const amountMinor = Math.round(Number(verified.amount) * 100);
    if (currency !== "NGN" || !Number.isSafeInteger(amountMinor)) {
      await db.from("payment_webhook_events").update({
        processing_status: "failed", attempts: 1, last_error: "Unsupported amount or currency.",
      }).eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
      return json({ error: "Unsupported payment amount or currency." }, 400);
    }

    const { error: finalizeError } = await db.rpc("finalize_flutterwave_payment", {
      p_tx_ref: txRef, p_provider_transaction_id: providerTransactionId,
      p_amount_minor: amountMinor, p_currency_code: currency,
      p_provider_fee_minor: null, p_platform_fee_minor: 0,
    });
    if (finalizeError) {
      await db.from("payment_webhook_events").update({
        processing_status: "failed", attempts: 1, last_error: "Payment finalization failed.",
      }).eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
      console.error("Flutterwave webhook finalization failed", txRef, finalizeError.message);
      return json({ error: "Payment finalization failed; retry this webhook." }, 500);
    }
    await db.from("payment_webhook_events").update({
      processing_status: "processed", processed_at: new Date().toISOString(), last_error: null,
    }).eq("provider", "flutterwave").eq("provider_event_id", providerEventId);
    return json({ received: true, processed: true });
  } catch (error) {
    console.error("Flutterwave webhook processing failed", error);
    return json({ error: "Webhook processing failed." }, 500);
  }
});

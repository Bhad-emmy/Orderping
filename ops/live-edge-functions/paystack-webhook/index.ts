import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
};

const sign = async (body: Uint8Array, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, body);
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

async function hashKey(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 100000) return json({ error: "Request too large" }, 413);
    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.byteLength > 100000) return json({ error: "Request too large" }, 413);
    const signature = req.headers.get("x-paystack-signature");
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");

    if (!secret || !signature) return json({ error: "Unauthorized" }, 401);

    const expected = await sign(raw, secret);
    if (!timingSafeEqual(expected, signature)) return json({ error: "Invalid signature" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
    const bucket = await hashKey("paystack-webhook:ip:" + ip);
    const { data: rateData, error: rateError } = await admin.schema("orderping").rpc("consume_rate_limit", { p_bucket_key: bucket, p_limit: 300, p_window_seconds: 60 });
    if (rateError) return json({ error: "Webhook service temporarily unavailable" }, 503);
    const rate = Array.isArray(rateData) ? rateData[0] : rateData;
    if (!rate?.allowed) return json({ error: "Rate limit exceeded" }, 429);

    const event = JSON.parse(new TextDecoder().decode(raw));
    if (event?.event !== "charge.success") return json({ status: true });

    const transaction = event.data ?? {};
    const metadata = transaction.metadata ?? {};
    const walletId = metadata.wallet_id;
    const reference = String(transaction.reference ?? "").trim();
    const amount = Number(transaction.amount ?? 0) / 100;

    if (transaction.status !== "success" || !walletId || !reference || !Number.isFinite(amount) || amount <= 0) {
      return json({ status: true });
    }

    const { error } = await admin.rpc("credit_wallet", {
      p_wallet_id: walletId,
      p_amount: amount,
      p_reference: reference,
      p_description: "Paystack wallet funding",
    });

    if (error) {
      console.error("Webhook wallet credit failed", error);
      return json({ error: "Wallet credit failed" }, 500);
    }

    return json({ status: true });
  } catch (error) {
    console.error("paystack-webhook error", error);
    return json({ error: "Invalid webhook payload" }, 400);
  }
});

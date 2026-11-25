import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function hashKey(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

const getAdmin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

const paystackHeaders = () => {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Authentication required" }, 401);

    const admin = getAdmin();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid or expired session" }, 401);

    const bucket = await hashKey("wallet-funding:user:" + authData.user.id);
    const { data: rateData, error: rateError } = await admin.schema("orderping").rpc("consume_rate_limit", { p_bucket_key: bucket, p_limit: 10, p_window_seconds: 60 });
    if (rateError) return json({ error: "Wallet service is temporarily unavailable" }, 503);
    const rate = Array.isArray(rateData) ? rateData[0] : rateData;
    if (!rate?.allowed) return json({ error: "Too many requests. Wait a minute and try again." }, 429);

    const payload = await req.json();
    const action = payload?.action;

    if (action === "initialize") {
      const amount = Number(payload?.amount);
      if (!Number.isFinite(amount) || amount < 100 || amount > 1_000_000) {
        return json({ error: "Amount must be between ₦100 and ₦1,000,000" }, 400);
      }

      const { data: wallet, error: walletError } = await admin
        .from("wallets")
        .select("id")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (walletError || !wallet) return json({ error: "Wallet not found" }, 404);

      const reference = `MEKA-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
      const frontendUrl = Deno.env.get("FRONTEND_URL")?.trim();
      const body: Record<string, unknown> = {
        email: authData.user.email,
        amount: String(Math.round(amount * 100)),
        currency: "NGN",
        reference,
        metadata: {
          user_id: authData.user.id,
          wallet_id: wallet.id,
          purpose: "wallet_funding",
        },
      };

      if (frontendUrl) {
        body.callback_url = `${frontendUrl.replace(/\/$/, "")}/?payment=success`;
      }

      const response = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: paystackHeaders(),
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (!response.ok || !result?.status || !result?.data?.authorization_url) {
        console.error("Paystack initialize failed", result);
        return json({ error: "Unable to initialize Paystack payment" }, 502);
      }

      return json({
        authorization_url: result.data.authorization_url,
        reference: result.data.reference,
      });
    }

    if (action === "verify") {
      const reference = String(payload?.reference ?? "").trim();
      if (!reference) return json({ error: "Payment reference is required" }, 400);

      const response = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: paystackHeaders() },
      );
      const result = await response.json();

      if (!response.ok || !result?.status || !result?.data) {
        return json({ error: "Unable to verify Paystack payment" }, 502);
      }

      const transaction = result.data;
      const metadata = transaction.metadata ?? {};
      if (transaction.status !== "success") {
        return json({ credited: false, reason: "payment_not_successful" });
      }

      if (metadata.user_id !== authData.user.id) {
        return json({ error: "Payment does not belong to this user" }, 403);
      }

      const amount = Number(transaction.amount) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || !metadata.wallet_id) {
        return json({ error: "Invalid payment metadata" }, 400);
      }

      const { data: credit, error: creditError } = await admin.rpc("credit_wallet", {
        p_wallet_id: metadata.wallet_id,
        p_amount: amount,
        p_reference: reference,
        p_description: "Paystack wallet funding",
      });

      if (creditError) {
        console.error("Wallet credit failed", creditError);
        return json({ error: "Wallet credit could not be recorded" }, 500);
      }

      const row = Array.isArray(credit) ? credit[0] : credit;
      return json({
        credited: Boolean(row?.created),
        balance: Number(row?.balance ?? 0),
        reference,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("wallet-funding error", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
});

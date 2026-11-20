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
const uuid = (value: unknown) => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function flw(path: string, secret: string, method = "GET", body?: unknown) {
  const response = await fetch("https://api.flutterwave.com/v3" + path, {
    method,
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json", Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload?.status === "success", status: response.status, payload };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 6000) return json({ error: "Request too large." }, 413);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in to continue." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secret = Deno.env.get("FLW_SECRET_KEY");
    if (!url || !anon || !service || !secret) return json({ error: "Flutterwave test credentials are not configured on the server yet." }, 503);

    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);

    const db = createClient(url, service, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown").slice(0, 120);
    const { data: rate, error: rateError } = await db.rpc("consume_rate_limit", {
      p_bucket_key: await sha256("vendor-flw-account:" + authData.user.id + ":" + ip),
      p_limit: 30, p_window_seconds: 3600,
    });
    if (rateError) return json({ error: "Payment settings are temporarily unavailable." }, 503);
    const allowance = Array.isArray(rate) ? rate[0] : rate;
    if (!allowance?.allowed) return json({ error: "Too many attempts. Try again later." }, 429);

    const body = await req.json();
    if (body?.action === "banks") {
      const result = await flw("/banks/NG", secret);
      if (!result.ok) return json({ error: "Could not load supported Nigerian banks." }, 502);
      const banks = Array.isArray(result.payload?.data) ? result.payload.data
        .map((bank: any) => ({ code: String(bank.code || bank.id || ""), name: String(bank.name || "") }))
        .filter((bank: any) => bank.code && bank.name) : [];
      return json({ banks });
    }
    if (body?.action !== "register") return json({ error: "Invalid action." }, 400);

    const bankCode = typeof body.bank_code === "string" ? body.bank_code.trim().slice(0, 20) : "";
    const accountNumber = typeof body.account_number === "string" ? body.account_number.trim() : "";
    const mobile = typeof body.business_mobile === "string" ? body.business_mobile.trim().slice(0, 32) : "";
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) return json({ error: "Select a bank and enter a valid 10-digit account number." }, 400);
    if (!/^[+0-9() .-]{7,32}$/.test(mobile)) return json({ error: "Enter a valid business phone number." }, 400);

    const { data: business, error: businessError } = await db.from("businesses")
      .select("id,name,email,whatsapp_number,approval_status")
      .eq("owner_id", authData.user.id).maybeSingle();
    if (businessError) return json({ error: "Could not verify your store." }, 500);
    if (!business || business.approval_status !== "approved") return json({ error: "Only approved stores can register a settlement account." }, 403);

    const { data: existing, error: existingError } = await db.from("vendor_payment_accounts")
      .select("id,status,provider_subaccount_id,account_name,bank_code,account_number_last4")
      .eq("business_id", business.id).eq("provider", "flutterwave").maybeSingle();
    if (existingError) return json({ error: "Could not check your existing payment account." }, 500);
    if (existing?.status === "active" && existing.provider_subaccount_id) {
      return json({ error: "A settlement account is already active. Contact OrderPing support to change it." }, 409);
    }

    const resolved = await flw("/accounts/resolve", secret, "POST", { account_number: accountNumber, account_bank: bankCode });
    const accountName = resolved.payload?.data?.account_name;
    if (!resolved.ok || typeof accountName !== "string" || !accountName.trim()) {
      return json({ error: "Flutterwave could not verify this bank account. Check the bank and account number." }, 422);
    }

    const { data: pending, error: pendingError } = await db.from("vendor_payment_accounts").upsert({
      business_id: business.id, provider: "flutterwave", bank_code: bankCode,
      account_name: accountName.trim(), account_number_last4: accountNumber.slice(-4),
      settlement_currency: "NGN", status: "pending", provider_subaccount_id: null,
      last_error_code: null, last_error_at: null,
    }, { onConflict: "business_id,provider" }).select("id").single();
    if (pendingError || !pending) return json({ error: "Could not prepare your settlement account." }, 500);

    // 1.0 means 100% of the split allocation goes to the vendor subaccount.
    // OrderPing's platform commission is zero; Flutterwave processing fees remain provider fees.
    const created = await flw("/subaccounts", secret, "POST", {
      account_bank: bankCode,
      account_number: accountNumber,
      business_name: business.name,
      business_email: business.email || authData.user.email || undefined,
      business_mobile: mobile,
      country: "NG",
      split_type: "percentage",
      split_value: 1.0,
    });
    const subaccountId = created.payload?.data?.subaccount_id;
    if (!created.ok || typeof subaccountId !== "string" || !subaccountId.startsWith("RS_")) {
      const code = String(created.payload?.code || created.status).slice(0, 80);
      await db.from("vendor_payment_accounts").update({ status: "failed", last_error_code: code, last_error_at: new Date().toISOString() }).eq("id", pending.id);
      console.warn("Flutterwave subaccount creation failed", created.status, code);
      return json({ error: "Flutterwave could not register this settlement account. Please check the details and try again." }, 502);
    }

    const { data: saved, error: saveError } = await db.from("vendor_payment_accounts").update({
      provider_subaccount_id: subaccountId, status: "active",
      verification_reference: subaccountId, verified_at: new Date().toISOString(),
      last_error_code: null, last_error_at: null,
    }).eq("id", pending.id).select("id,status,bank_code,account_name,account_number_last4,settlement_currency,verified_at").single();
    if (saveError || !saved) {
      console.error("Flutterwave subaccount created but local account update failed", pending.id);
      return json({ error: "Flutterwave registered the account, but OrderPing could not finish saving it. Contact support before retrying." }, 500);
    }
    return json({ success: true, account: saved });
  } catch (error) {
    console.error("Vendor payment account request failed", error);
    return json({ error: "Could not update your settlement account. Please try again." }, 500);
  }
});

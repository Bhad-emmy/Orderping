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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "Authentication required." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admins = (Deno.env.get("ORDERPING_ADMIN_EMAILS") || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!url || !anon || !service || admins.length === 0) return json({ error: "Admin approval is not configured." }, 503);

  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user?.email || !admins.includes(authData.user.email.toLowerCase())) {
    return json({ error: "Not authorized." }, 403);
  }

  try {
    const body = await req.json();
    const action = body?.action;
    const admin = createClient(url, service, { db: { schema: "orderping" }, auth: { persistSession: false, autoRefreshToken: false } });
    if (action === "list") {
      const { data, error } = await admin.from("businesses")
        .select("id,name,slug,email,owner_id,created_at,approval_status")
        .eq("approval_status", "pending").order("created_at", { ascending: true }).limit(100);
      if (error) return json({ error: "Could not load pending vendors." }, 500);
      return json({ vendors: data || [] });
    }
    if (action !== "approve" && action !== "reject") return json({ error: "Invalid action." }, 400);
    const businessId = body?.business_id;
    if (typeof businessId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
      return json({ error: "A valid business_id is required." }, 400);
    }
    const status = action === "approve" ? "approved" : "rejected";
    const { data, error } = await admin.from("businesses").update({
      approval_status: status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
      approved_by: authData.user.id,
    }).eq("id", businessId).eq("approval_status", "pending")
      .select("id,name,approval_status").maybeSingle();
    if (error) return json({ error: "Could not update vendor approval." }, 500);
    if (!data) return json({ error: "Vendor not found or already reviewed." }, 409);
    return json({ vendor: data });
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
});

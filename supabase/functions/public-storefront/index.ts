import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  if (req.method !== "POST") return json({error:"Method not allowed."},405);
  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 4000) return json({error:"Request too large."},413);
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({error:"Server configuration is incomplete."},503);
    const db = createClient(url,key,{db:{schema:"orderping"},auth:{persistSession:false,autoRefreshToken:false}});
    const clientIp = req.headers.get("cf-connecting-ip") || "unknown";
    const ipDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("storefront:" + clientIp));
    const bucket = [...new Uint8Array(ipDigest)].map((b) => b.toString(16).padStart(2,"0")).join("");
    const {data:rateData,error:rateError} = await db.rpc("consume_rate_limit",{p_bucket_key:bucket,p_limit:60,p_window_seconds:60});
    if (rateError) return json({error:"Storefront is temporarily unavailable."},503);
    const rate = Array.isArray(rateData) ? rateData[0] : rateData;
    if (!rate?.allowed) return json({error:"Too many requests. Please wait a minute and try again."},429);
    const body = await req.json();
    const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) return json({error:"Store link is invalid."},400);
    const {data:business,error} = await db.from("businesses").select("id,name,slug").eq("slug",slug).eq("approval_status","approved").maybeSingle();
    if (error) return json({error:"Store could not be loaded."},500);
    if (!business) return json({error:"This store could not be found."},404);
    const {data:products,error:productError} = await db.from("catalog_items").select("id,business_id,type,name,description,price_minor,original_price_minor,image_url,is_active,created_at").eq("business_id",business.id).eq("type","product").eq("is_active",true).order("created_at",{ascending:false});
    if (productError) return json({error:"Products could not be loaded."},500);
    return json({business:{name:business.name,slug:business.slug},products:products||[]});
  } catch { return json({error:"Store could not be loaded."},500); }
});
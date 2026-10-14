import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
async function hashKey(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
Deno.serve(async (req) => {
 const origin=req.headers.get("origin")||"*";
 const h={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":origin,"access-control-allow-credentials":"true","access-control-allow-methods":"GET,POST,PATCH,OPTIONS","access-control-allow-headers":"Content-Type,Authorization"};
 if(req.method==="OPTIONS") return new Response(null,{status:204,headers:h});
 if(!["GET","POST","PATCH"].includes(req.method)) return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:h});
 try {
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return new Response(JSON.stringify({error:"Service unavailable"}),{status:503,headers:h});
  const db=createClient(url,key,{db:{schema:"orderping"},auth:{autoRefreshToken:false,persistSession:false}});
  const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"unknown";
  const bucket=await hashKey("oka-rides-api:ip:"+ip);
  const {data,error}=await db.rpc("consume_rate_limit",{p_bucket_key:bucket,p_limit:60,p_window_seconds:60});
  if(error) return new Response(JSON.stringify({error:"Service temporarily unavailable"}),{status:503,headers:h});
  const rate=Array.isArray(data)?data[0]:data;
  if(!rate?.allowed) return new Response(JSON.stringify({error:"Rate limit exceeded"}),{status:429,headers:h});
  return new Response(JSON.stringify({status:"ok",message:"Awka Rides API is running",database:"supabase"}),{headers:h});
 } catch {
  return new Response(JSON.stringify({error:"Service temporarily unavailable"}),{status:503,headers:h});
 }
});
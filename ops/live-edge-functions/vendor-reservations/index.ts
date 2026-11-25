import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
async function rateBucket(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"Method not allowed."},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({error:"Server configuration is incomplete."},503);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({error:"Sign in to view reservations."},401);
  const db=createClient(url,key,{db:{schema:"orderping"},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await db.auth.getUser(token);if(authError||!auth.user)return json({error:"Sign in to view reservations."},401);
  const bucket=await rateBucket("vendor-reservations:user:"+auth.user.id);
  const {data:rateData,error:rateError}=await db.rpc("consume_rate_limit",{p_bucket_key:bucket,p_limit:60,p_window_seconds:60});
  if(rateError)return json({error:"Request service is temporarily unavailable."},503);
  const rate=Array.isArray(rateData)?rateData[0]:rateData;
  if(!rate?.allowed)return json({error:"Too many requests. Wait a minute and try again."},429);
  const b=await req.json();if(!uuid(b?.business_id))return json({error:"Business identifier is invalid."},400);
  const {data:business,error:be}=await db.from("businesses").select("id").eq("id",b.business_id).eq("owner_id",auth.user.id).maybeSingle();
  if(be)return json({error:"Reservations could not be loaded."},500);if(!business)return json({error:"You do not have access to this business."},403);
  const {data,error}=await db.from("orders").select("id,business_id,customer_name,customer_phone,customer_email,status,requested_pickup_at,total_amount_minor,amount_paid_minor,customer_note,created_at").eq("business_id",business.id).eq("order_type","reservation").order("created_at",{ascending:false}).limit(200);
  if(error)return json({error:"Reservations could not be loaded."},500);
  return json({reservations:data||[]});
 }catch{return json({error:"Reservations could not be loaded."},500);}
});
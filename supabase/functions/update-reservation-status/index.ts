import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
async function rateBucket(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"Method not allowed."},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({error:"Server configuration is incomplete."},503);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({error:"Sign in to update reservations."},401);
  const db=createClient(url,key,{db:{schema:"orderping"},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await db.auth.getUser(token);if(authError||!auth.user)return json({error:"Sign in to update reservations."},401);
  const bucket=await rateBucket("update-reservation-status:user:"+auth.user.id);
  const {data:rateData,error:rateError}=await db.rpc("consume_rate_limit",{p_bucket_key:bucket,p_limit:20,p_window_seconds:60});
  if(rateError)return json({error:"Request service is temporarily unavailable."},503);
  const rate=Array.isArray(rateData)?rateData[0]:rateData;
  if(!rate?.allowed)return json({error:"Too many requests. Wait a minute and try again."},429);
  const b=await req.json();if(!uuid(b?.business_id)||!uuid(b?.reservation_id)||!["confirmed","cancelled"].includes(b?.status))return json({error:"Reservation update is invalid."},400);
  const {data:business,error:be}=await db.from("businesses").select("id").eq("id",b.business_id).eq("owner_id",auth.user.id).maybeSingle();
  if(be)return json({error:"Reservation could not be updated."},500);if(!business)return json({error:"You do not have access to this business."},403);
  const {data:reservation,error}=await db.from("orders").update({status:b.status,updated_at:new Date().toISOString()}).eq("id",b.reservation_id).eq("business_id",business.id).eq("order_type","reservation").select("id,status,requested_pickup_at").maybeSingle();
  if(error)return json({error:"Reservation could not be updated."},500);if(!reservation)return json({error:"Reservation not found."},404);
  return json({success:true,reservation});
 }catch{return json({error:"Reservation could not be updated."},500);}
});
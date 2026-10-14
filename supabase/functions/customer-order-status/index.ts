import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store, private"}});
async function hash(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed."},405);
 try{
  if(Number(req.headers.get("content-length")||0)>4000)return json({error:"Request too large."},413);
  const body=await req.json(),token=typeof body?.token==="string"?body.token.trim():"";
  if(!/^[a-f0-9]{64}$/i.test(token))return json({error:"Order link is invalid."},400);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({error:"Server configuration is incomplete."},503);
  const db=createClient(url,key,{db:{schema:"orderping"},auth:{persistSession:false,autoRefreshToken:false}});
  const ip=(req.headers.get("x-real-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim().slice(0,120);
  const bucket=await hash("customer-order:ip:"+ip);
  const {data:limit,error:limitError}=await db.rpc("consume_rate_limit",{p_bucket_key:bucket,p_limit:60,p_window_seconds:60});
  if(limitError)return json({error:"Order lookup is temporarily unavailable."},503);
  const result=Array.isArray(limit)?limit[0]:limit;
  if(!result?.allowed)return json({error:"Too many requests. Wait a minute and try again."},429);
  const tokenHash=await hash(token);
  const {data:order,error:orderError}=await db.from("orders").select("id,business_id,status,total_amount_minor,amount_paid_minor,currency_code,fulfilment_method,created_at").eq("customer_access_token_hash",tokenHash).maybeSingle();
  if(orderError)return json({error:"Order could not be loaded."},500);
  if(!order)return json({error:"This order link is invalid or unavailable."},404);
  const [{data:business,error:businessError},{data:items,error:itemError},{data:payments,error:paymentError}]=await Promise.all([
   db.from("businesses").select("name").eq("id",order.business_id).maybeSingle(),
   db.from("order_items").select("item_name,quantity,unit_price_minor").eq("order_id",order.id).order("created_at",{ascending:true}),
   db.from("payment_records").select("amount_minor,method,recorded_at").eq("order_id",order.id).order("recorded_at",{ascending:true})
  ]);
  if(businessError||itemError||paymentError)return json({error:"Order details could not be loaded."},500);
  return json({success:true,business:{name:business?.name||"Store"},order,items:items||[],payments:payments||[]});
 }catch{return json({error:"Order could not be loaded."},500);}
});

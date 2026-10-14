import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-idempotency-key","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text=(v:unknown,n:number)=>typeof v==="string"?v.trim().slice(0,n):"";
async function hash(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors}); if(req.method!=="POST")return json({error:"Method not allowed."},405);
 try{
  if(Number(req.headers.get("content-length")||0)>20000)return json({error:"Request too large."},413);
  const b=await req.json(),slug=text(b?.slug,50).toLowerCase(),name=text(b?.customer_name,120),phone=text(b?.customer_phone,32),email=text(b?.customer_email,254)||null,note=text(b?.customer_note,500)||null,fulfilment=b?.fulfilment_method;
  if(!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug))return json({error:"Store link is invalid."},400);
  if(!name||!/^[+0-9() .-]{5,32}$/.test(phone))return json({error:"Enter your name and a valid phone number."},400);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Enter a valid email address."},400);
  if(!["delivery","collection"].includes(fulfilment))return json({error:"Choose delivery or collection."},400);
  if(!Array.isArray(b?.items)||b.items.length<1||b.items.length>30)return json({error:"Choose between 1 and 30 products."},400);
  const qty=new Map<string,number>(); for(const x of b.items){if(!uuid(x?.catalog_item_id)||!Number.isInteger(x?.quantity)||x.quantity<1||x.quantity>1000)return json({error:"One or more product quantities are invalid."},400);qty.set(x.catalog_item_id,(qty.get(x.catalog_item_id)||0)+x.quantity);}
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({error:"Server configuration is incomplete."},503);
  const db=createClient(url,key,{db:{schema:"orderping"},auth:{persistSession:false,autoRefreshToken:false}});
  const ip=(req.headers.get("x-real-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim().slice(0,120);
  for(const [bucket,limit] of [[await hash("order:ip:"+ip),20],[await hash("order:phone:"+slug+":"+phone.replace(/[^0-9+]/g,"")),5]] as const){
   const {data,error}=await db.rpc("consume_rate_limit",{p_bucket_key:bucket,p_limit:limit,p_window_seconds:60});if(error)return json({error:"Ordering is temporarily unavailable."},503);
   const r=Array.isArray(data)?data[0]:data;if(!r?.allowed)return json({error:"Too many requests. Wait a minute and try again."},429);
  }
  const {data:business,error:be}=await db.from("businesses").select("id").eq("slug",slug).maybeSingle();if(be)return json({error:"Store could not be loaded."},500);if(!business)return json({error:"Store not found."},404);
  const ids=[...qty.keys()],{data:products,error:pe}=await db.from("catalog_items").select("id,name,price_minor").eq("business_id",business.id).eq("type","product").eq("is_active",true).in("id",ids);
  if(pe)return json({error:"Catalogue validation failed."},500);if(!products||products.length!==ids.length)return json({error:"A selected product is no longer available. Refresh the store."},400);
  const lines=products.map(p=>({catalog_item_id:p.id,item_name:p.name,quantity:qty.get(p.id)!,unit_price_minor:Number(p.price_minor)}));
  const total=lines.reduce((s,l)=>s+l.quantity*l.unit_price_minor,0);if(!Number.isSafeInteger(total)||total<0||lines.some(l=>!Number.isSafeInteger(l.unit_price_minor)||!Number.isSafeInteger(l.quantity*l.unit_price_minor)))return json({error:"Order total is invalid."},400);
  const idem=text(req.headers.get("x-idempotency-key"),128);if(idem&&!/^[a-zA-Z0-9._:-]{8,128}$/.test(idem))return json({error:"Request identifier is invalid."},400);
  if(idem){const {data:old}=await db.from("orders").select("id,status,total_amount_minor").eq("business_id",business.id).eq("idempotency_key",idem).maybeSingle();if(old)return json({success:true,duplicate:true,request:old});}
  const accessToken=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");const accessTokenHash=await hash(accessToken);
  const {data:order,error:oe}=await db.from("orders").insert({business_id:business.id,customer_name:name,customer_phone:phone,customer_email:email,customer_note:note,fulfilment_method:fulfilment,total_amount_minor:total,amount_paid_minor:0,currency_code:"NGN",status:"new",order_type:"order",requested_pickup_at:null,idempotency_key:idem||null,customer_access_token_hash:accessTokenHash}).select("id,status,total_amount_minor,created_at").single();
  if(oe||!order)return json({error:"Your order could not be saved. Please try again."},500);
  const {error:ie}=await db.from("order_items").insert(lines.map(l=>({...l,order_id:order.id})));
  if(ie){await db.from("orders").delete().eq("id",order.id).eq("business_id",business.id);return json({error:"Your order could not be completed. Please try again."},500);}
  return json({success:true,request:order,customer_access_token:accessToken},201);
 }catch{return json({error:"Your order could not be submitted. Please try again."},500);}
});
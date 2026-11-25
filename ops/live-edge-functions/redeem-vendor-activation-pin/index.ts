import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
async function hash(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed."},405);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return json({error:"Sign in to activate your store."},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return json({error:"Activation is temporarily unavailable."},503);
 try{
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(token);
  if(authError||!authData.user)return json({error:"Please sign in again."},401);
  const body=await req.json(),pin=typeof body?.pin==="string"?body.pin.trim():"";
  if(!/^\d{8}$/.test(pin))return json({error:"Enter the 8-digit activation PIN from support."},400);
  const db=createClient(url,service,{db:{schema:"orderping"},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc("redeem_vendor_activation_pin",{p_pin_hash:await hash(pin),p_owner_id:authData.user.id});
  if(error){console.error("PIN redemption failed",error.message);return json({error:"Could not verify the PIN right now. Try again."},500);}
  const row=Array.isArray(data)?data[0]:data;
  if(!row)return json({error:"That PIN is invalid, expired, already used, or does not belong to your store."},400);
  return json({success:true,business:{id:row.business_id,name:row.business_name}});
 }catch{return json({error:"Could not verify the activation PIN."},400);}
});
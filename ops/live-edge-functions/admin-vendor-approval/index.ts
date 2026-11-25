import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
async function hash(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed."},405);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return json({error:"Authentication required."},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const configured=(Deno.env.get("ORDERPING_ADMIN_EMAILS")||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
 const admins=configured.length?configured:["edwinchukwuemeka12@gmail.com"];
 if(!url||!anon||!service)return json({error:"Admin approval is not configured."},503);
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:authData,error:authError}=await auth.auth.getUser(token);
 if(authError||!authData.user?.email||!admins.includes(authData.user.email.toLowerCase()))return json({error:"Not authorized."},403);
 try{
  const body=await req.json(),action=body?.action;
  const db=createClient(url,service,{db:{schema:"orderping"},auth:{persistSession:false,autoRefreshToken:false}});
  if(action==="list"){
   const {data,error}=await db.from("businesses").select("id,name,slug,email,owner_id,created_at,approval_status").eq("approval_status","pending").order("created_at",{ascending:true}).limit(100);
   if(error)return json({error:"Could not load pending vendors."},500);
   return json({vendors:data||[]});
  }
  const businessId=body?.business_id;
  if(typeof businessId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId))return json({error:"A valid business_id is required."},400);
  if(action==="issue_pin"){
   const {data:business,error}=await db.from("businesses").select("id,name,approval_status").eq("id",businessId).maybeSingle();
   if(error||!business)return json({error:"Store not found."},404);
   if(business.approval_status!=="pending")return json({error:"Only pending stores can be activated."},409);
   const raw=new Uint32Array(1);crypto.getRandomValues(raw);const pin=String(raw[0]%100000000).padStart(8,"0");
   const pinHash=await hash(pin),expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
   const {error:deleteError}=await db.from("vendor_activation_pins").delete().eq("business_id",businessId).is("used_at",null);
   if(deleteError)return json({error:"Could not prepare activation PIN."},500);
   const {error:insertError}=await db.from("vendor_activation_pins").insert({business_id:businessId,pin_hash:pinHash,expires_at:expiresAt,created_by:authData.user.id});
   if(insertError)return json({error:"Could not issue activation PIN."},500);
   return json({pin,business:{id:business.id,name:business.name},expires_at:expiresAt});
  }
  if(action==="reject"){
   const {data,error}=await db.from("businesses").update({approval_status:"rejected",approved_at:null,approved_by:authData.user.id}).eq("id",businessId).eq("approval_status","pending").select("id,name,approval_status").maybeSingle();
   if(error)return json({error:"Could not update vendor approval."},500);
   if(!data)return json({error:"Vendor not found or already reviewed."},409);
   return json({vendor:data});
  }
  return json({error:"Invalid action."},400);
 }catch{return json({error:"Invalid request."},400);}
});
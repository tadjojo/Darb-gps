import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
const env={ALLOWED_ORIGINS:"https://darb-gps-web-2026.tadjojo.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"test-key",SUPABASE_SERVICE_ROLE_KEY:"test-service-role"};
async function sha(secret){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");}

test("tracker JSON ingest requires credential and service-role configuration",async()=>{
 const noAuth=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),env);assert.equal(noAuth.status,401);
 const noSecret=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest",{method:"POST",headers:{Authorization:"Bearer tracker-token","Content-Type":"application/json"},body:JSON.stringify({latitude:31,longitude:35,recordedAt:"2026-11-25T10:00:00Z"})}),{SUPABASE_URL:env.SUPABASE_URL});assert.equal(noSecret.status,503);
});

test("tracker JSON ingest hashes device credential and uses server service key",async()=>{
 const old=globalThis.fetch;let args={};let headers={};
 globalThis.fetch=async(_i,init={})=>{headers=new Headers(init.headers);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({accepted:true,duplicate:false}),{status:200});};
 try{
  const bad=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest",{method:"POST",headers:{Authorization:"Bearer tracker-token","Content-Type":"application/json"},body:JSON.stringify({latitude:100,longitude:35,recordedAt:"2026-11-25T10:00:00Z"})}),env);assert.equal(bad.status,400);
  const res=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest",{method:"POST",headers:{Authorization:"Bearer tracker-token","Content-Type":"application/json"},body:JSON.stringify({latitude:31.95,longitude:35.91,speedKmh:30,heading:90,eventId:"123e4567-e89b-12d3-a456-426614174001",recordedAt:"2026-11-25T10:00:00Z",tamper:true})}),env);assert.equal(res.status,200);assert.deepEqual(await res.json(),{accepted:true,duplicate:false});assert.equal(headers.get("Authorization"),"Bearer test-service-role");assert.equal(headers.get("apikey"),"test-service-role");assert.equal(args.p_credential_hash,await sha("tracker-token"));assert.equal(args.p_protocol,"json");assert.equal(args.p_tamper,true);
 }finally{globalThis.fetch=old;}
});

test("GT06 heartbeat hashes tracker token and maps upstream invalid credential",async()=>{
 const old=globalThis.fetch;let args={};let headers={};
 globalThis.fetch=async(_i,init={})=>{headers=new Headers(init.headers);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({code:"28000"}),{status:401});};
 try{const res=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/heartbeat/gt06",{method:"POST",headers:{Authorization:"Bearer device-secret"}}),env);assert.equal(res.status,401);assert.equal(args.p_credential_hash,await sha("device-secret"));assert.equal(args.p_protocol,"gt06");assert.equal(headers.get("Authorization"),"Bearer test-service-role");}finally{globalThis.fetch=old;}
});

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
const env={ALLOWED_ORIGINS:"https://darb-gps-web-2026.tadjojo.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"test-key"};
const vehicle="123e4567-e89b-12d3-a456-426614174000",device="123e4567-e89b-12d3-a456-426614174010";
const auth={Authorization:"Bearer test-token","Content-Type":"application/json"};

async function sha(secret){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");}

test("GPS tracker enrollment validates protocol profile and stores only credential hash",async()=>{
 const old=globalThis.fetch;let args={};
 globalThis.fetch=async(_i,init={})=>{args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({id:"tracker-1",vehicle_id:vehicle,protocol:"gt06"}),{status:200});};
 try{
  const invalid=await worker.fetch(new Request("https://worker.test/api/v1/tracking/devices/gps",{method:"POST",headers:auth,body:JSON.stringify({vehicleId:vehicle,protocol:"gt06"})}),env);assert.equal(invalid.status,400);
  const res=await worker.fetch(new Request("https://worker.test/api/v1/tracking/devices/gps",{method:"POST",headers:auth,body:JSON.stringify({vehicleId:vehicle,label:"Tracker A",protocol:"gt06",imei:"123456789012345",model:"GT06",timezoneOffsetMinutes:180})}),env);assert.equal(res.status,201);const out=await res.json();assert.equal(out.device.id,"tracker-1");assert.equal(out.credentialFormat,"Authorization: Bearer <credential>");assert.match(out.credential,/^[A-Za-z0-9_-]{43}$/);assert.equal(args.p_protocol,"gt06");assert.equal(args.p_imei,"123456789012345");assert.equal(args.p_timezone_offset_minutes,180);assert.equal(args.p_credential_hash,await sha(out.credential));assert.equal(args.p_credential_hash.length,64);
 }finally{globalThis.fetch=old;}
});

test("credential rotation returns one new credential and hash-only RPC payload",async()=>{
 const old=globalThis.fetch;let args={};let path="";
 globalThis.fetch=async(input,init={})=>{path=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({deviceId:device,protocol:"json"}),{status:200});};
 try{const res=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/devices/gps/${device}/rotate-credential`,{method:"POST",headers:auth}),env);assert.equal(res.status,200);const out=await res.json();assert.equal(out.deviceId,device);assert.match(out.credential,/^[A-Za-z0-9_-]{43}$/);assert.equal(args.p_device_id,device);assert.equal(args.p_credential_hash,await sha(out.credential));assert.match(path,/darb_api_rotate_gps_credential$/);}finally{globalThis.fetch=old;}
});

test("GPS tracker revoke uses authenticated RPC and returns revoked result",async()=>{
 const old=globalThis.fetch;let args={};let path="";
 globalThis.fetch=async(input,init={})=>{path=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({revoked:true,deviceId:device}),{status:200});};
 try{const res=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/devices/gps/${device}/revoke`,{method:"POST",headers:auth}),env);assert.equal(res.status,200);assert.deepEqual(await res.json(),{revoked:true,deviceId:device});assert.match(path,/darb_api_revoke_gps_tracker$/);assert.deepEqual(args,{p_device_id:device});}finally{globalThis.fetch=old;}
});

test("duplicate tracker IMEI conflict is mapped to HTTP 409",async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({code:"23505"}),{status:409});
 try{const res=await worker.fetch(new Request("https://worker.test/api/v1/tracking/devices/gps",{method:"POST",headers:auth,body:JSON.stringify({vehicleId:vehicle,protocol:"nmea",imei:"123456789"})}),env);assert.equal(res.status,409);}finally{globalThis.fetch=old;}
});

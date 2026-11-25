import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
const env={ALLOWED_ORIGINS:"https://darb-gps-web-2026.tadjojo.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"test-key"};

test("mobile enrollment validates authorization and invokes RPC",async()=>{
 const noAuth=await worker.fetch(new Request("https://worker.test/api/v1/tracking/devices/enroll-mobile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({vehicleId:"123e4567-e89b-12d3-a456-426614174000"})}),env);
 assert.equal(noAuth.status,401);
 const old=globalThis.fetch; let args={}; let target="";
 globalThis.fetch=async(input,init={})=>{target=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({device:{id:"m1"},authentication:"user_jwt"}),{status:200});};
 try {const res=await worker.fetch(new Request("https://worker.test/api/v1/tracking/devices/enroll-mobile",{method:"POST",headers:{Authorization:"Bearer test-token","Content-Type":"application/json"},body:JSON.stringify({vehicleId:"123e4567-e89b-12d3-a456-426614174000"})}),env);assert.equal(res.status,201);assert.match(target,/darb_api_enroll_mobile_device$/);assert.deepEqual(args,{p_vehicle_id:"123e4567-e89b-12d3-a456-426614174000"});} finally {globalThis.fetch=old;}
});

test("device list RPC returns Flutter-compatible data envelope",async()=>{
 const old=globalThis.fetch; let target="";
 globalThis.fetch=async(input)=>{target=String(input);return new Response(JSON.stringify([{id:"d1",device_type:"mobile"}]),{status:200});};
 try {const res=await worker.fetch(new Request("https://worker.test/api/v1/tracking/devices/vehicle/123e4567-e89b-12d3-a456-426614174000",{headers:{Authorization:"Bearer test-token"}}),env);assert.equal(res.status,200);assert.match(target,/darb_api_list_devices$/);assert.deepEqual(await res.json(),{data:[{id:"d1",device_type:"mobile"}]});} finally {globalThis.fetch=old;}
});
test("mobile location endpoint validates and normalizes payload",async()=>{
 const old=globalThis.fetch;let args={};let url="";
 globalThis.fetch=async(input,init={})=>{url=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({accepted:true,duplicate:false,location:{id:9}}),{status:200});};
 try {
  const bad=await worker.fetch(new Request("https://worker.test/api/v1/tracking/locations",{method:"POST",headers:{Authorization:"Bearer test-token","Content-Type":"application/json"},body:JSON.stringify({vehicleId:"123e4567-e89b-12d3-a456-426614174000",latitude:91,longitude:35,recordedAt:"2026-11-25T10:00:00Z"})}),env);assert.equal(bad.status,400);
  const res=await worker.fetch(new Request("https://worker.test/api/v1/tracking/locations",{method:"POST",headers:{Authorization:"Bearer test-token","Content-Type":"application/json"},body:JSON.stringify({vehicleId:"123e4567-e89b-12d3-a456-426614174000",latitude:31.95,longitude:35.91,speedKmh:24,heading:180,accuracyMeters:10,recordedAt:"2026-11-25T10:00:00Z",eventId:"123e4567-e89b-12d3-a456-426614174001",deviceId:"123e4567-e89b-12d3-a456-426614174002"})}),env);assert.equal(res.status,200);assert.match(url,/darb_api_ingest_mobile_location$/);assert.deepEqual(args,{p_vehicle_id:"123e4567-e89b-12d3-a456-426614174000",p_latitude:31.95,p_longitude:35.91,p_speed_kmh:24,p_heading:180,p_recorded_at:"2026-11-25T10:00:00.000Z",p_event_id:"123e4567-e89b-12d3-a456-426614174001",p_device_id:"123e4567-e89b-12d3-a456-426614174002",p_accuracy_meters:10});
 } finally {globalThis.fetch=old;}
});

test("latest location returns null empty state",async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response("null",{status:200});
 try {const res=await worker.fetch(new Request("https://worker.test/api/v1/tracking/vehicles/123e4567-e89b-12d3-a456-426614174000/latest",{headers:{Authorization:"Bearer test-token"}}),env);assert.equal(res.status,200);assert.equal(await res.text(),"null");}finally{globalThis.fetch=old;}
});

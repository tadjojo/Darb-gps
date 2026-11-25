import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
const env={ALLOWED_ORIGINS:"https://darb-gps-web-2026.tadjojo.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"test-key"};
const vehicle="123e4567-e89b-12d3-a456-426614174000";
const auth={Authorization:"Bearer test-token"};
const points=[
 {id:1,vehicle_id:vehicle,latitude:31.9,longitude:35.9,speed_kmh:0,recorded_at:"2026-11-25T10:00:00.000Z",received_at:"2026-11-25T10:00:01.000Z"},
 {id:2,vehicle_id:vehicle,latitude:31.91,longitude:35.91,speed_kmh:5,recorded_at:"2026-11-25T10:05:00.000Z",received_at:"2026-11-25T10:05:01.000Z"},
 {id:3,vehicle_id:vehicle,latitude:31.92,longitude:35.92,speed_kmh:0,recorded_at:"2026-11-25T10:10:00.000Z",received_at:"2026-11-25T10:10:01.000Z"},
 {id:4,vehicle_id:vehicle,latitude:31.92,longitude:35.92,speed_kmh:0,recorded_at:"2026-11-25T10:15:00.000Z",received_at:"2026-11-25T10:15:01.000Z"}
];

test("history endpoint validates dates/limit and requests descending points",async()=>{
 const old=globalThis.fetch;let args={};
 globalThis.fetch=async(_i,init={})=>{args=JSON.parse(init.body||"{}");return new Response(JSON.stringify(points),{status:200});};
 try{
  const invalid=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/vehicles/${vehicle}/history?from=bad`,{headers:auth}),env);assert.equal(invalid.status,400);
  const res=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/vehicles/${vehicle}/history?limit=25`,{headers:auth}),env);assert.equal(res.status,200);assert.deepEqual(await res.json(),points);assert.equal(args.p_order_desc,true);assert.equal(args.p_limit,25);assert.equal(args.p_max_days,0);
 }finally{globalThis.fetch=old;}
});

test("trip route validates 31-day window and returns ordered points",async()=>{
 const old=globalThis.fetch;let args={};
 globalThis.fetch=async(_i,init={})=>{args=JSON.parse(init.body||"{}");return new Response(JSON.stringify(points),{status:200});};
 try{
  const tooWide=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/vehicles/${vehicle}/trip-route?from=2026-10-01T00:00:00Z&to=2026-11-25T00:00:00Z`,{headers:auth}),env);assert.equal(tooWide.status,400);
  const res=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/vehicles/${vehicle}/trip-route?from=2026-11-25T09:00:00Z&to=2026-11-25T11:00:00Z`,{headers:auth}),env);assert.equal(res.status,200);assert.deepEqual(await res.json(),points);assert.equal(args.p_max_days,31);assert.equal(args.p_order_desc,false);
 }finally{globalThis.fetch=old;}
});

test("trip detection segments by inactivity gap and calculates distance",async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify(points.slice(0,2)),{status:200});
 try{
  const res=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/vehicles/${vehicle}/trips?from=2026-11-25T09:00:00Z&to=2026-11-25T11:00:00Z&limit=10`,{headers:auth}),env);assert.equal(res.status,200);const out=await res.json();assert.equal(out.data.length,1);assert.equal(out.data[0].id,"1");assert.equal(out.data[0].points_count,2);assert.ok(out.data[0].distance_meters>0);
 }finally{globalThis.fetch=old;}
});

test("stop detection recognizes five-minute stationary segment",async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify(points.slice(2)),{status:200});
 try{
  const res=await worker.fetch(new Request(`https://worker.test/api/v1/tracking/vehicles/${vehicle}/stops?from=2026-11-25T09:00:00Z&to=2026-11-25T11:00:00Z`,{headers:auth}),env);assert.equal(res.status,200);const out=await res.json();assert.equal(out.data.length,1);assert.equal(out.data[0].duration_seconds,300);assert.equal(out.data[0].points_count,2);
 }finally{globalThis.fetch=old;}
});

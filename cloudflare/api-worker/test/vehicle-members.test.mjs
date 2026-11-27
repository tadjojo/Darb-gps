import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
const env={ALLOWED_ORIGINS:"https://darb-gps-web-2026.tadjojo.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"test-key"};
const vehicle="123e4567-e89b-12d3-a456-426614174000",user="123e4567-e89b-12d3-a456-426614174010";
const auth={Authorization:"Bearer test-token","Content-Type":"application/json"};

test("vehicle member add validates role and uses scoped RPC",async()=>{
 const old=globalThis.fetch;let args={},url="";
 globalThis.fetch=async(input,init={})=>{url=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({vehicleId:vehicle,userId:user,role:"viewer",status:"active"}),{status:200});};
 try{const bad=await worker.fetch(new Request(`https://worker.test/api/v1/vehicles/${vehicle}/members`,{method:"POST",headers:auth,body:JSON.stringify({userId:user,role:"invalid"})}),env);assert.equal(bad.status,400);const res=await worker.fetch(new Request(`https://worker.test/api/v1/vehicles/${vehicle}/members`,{method:"POST",headers:auth,body:JSON.stringify({userId:user,role:"viewer"})}),env);assert.equal(res.status,201);assert.match(url,/darb_api_add_vehicle_member$/);assert.deepEqual(args,{p_vehicle_id:vehicle,p_user_id:user,p_role:"viewer"});}finally{globalThis.fetch=old;}
});

test("vehicle member revoke uses DELETE route and authenticated RPC",async()=>{
 const old=globalThis.fetch;let args={},url="";
 globalThis.fetch=async(input,init={})=>{url=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({vehicleId:vehicle,userId:user,status:"revoked"}),{status:200});};
 try{const res=await worker.fetch(new Request(`https://worker.test/api/v1/vehicles/${vehicle}/members/${user}`,{method:"DELETE",headers:auth}),env);assert.equal(res.status,200);assert.match(url,/darb_api_revoke_vehicle_member$/);assert.deepEqual(args,{p_vehicle_id:vehicle,p_member_user_id:user});assert.equal((await res.json()).status,"revoked");}finally{globalThis.fetch=old;}
});

test("vehicle member assignment permission errors map to 403",async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({code:"42501"}),{status:403});
 try{const res=await worker.fetch(new Request(`https://worker.test/api/v1/vehicles/${vehicle}/members`,{method:"POST",headers:auth,body:JSON.stringify({userId:user,role:"manager"})}),env);assert.equal(res.status,403);assert.deepEqual(await res.json(),{message:"Member assignment failed"});}finally{globalThis.fetch=old;}
});

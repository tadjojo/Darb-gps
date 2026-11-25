import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
const env={ALLOWED_ORIGINS:"https://darb-gps-web-2026.tadjojo.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"test-key"};
const vehicle="123e4567-e89b-12d3-a456-426614174000",alert="123e4567-e89b-12d3-a456-426614174010";
const auth={Authorization:"Bearer test-token","Content-Type":"application/json"};

test("alert list validates filters and returns RPC rows",async()=>{
 const old=globalThis.fetch;let args={};
 globalThis.fetch=async(_i,init={})=>{args=JSON.parse(init.body||"{}");return new Response(JSON.stringify([{id:alert,status:"open"}]),{status:200});};
 try{const bad=await worker.fetch(new Request("https://worker.test/api/v1/alerts?status=bad",{headers:auth}),env);assert.equal(bad.status,400);const res=await worker.fetch(new Request("https://worker.test/api/v1/alerts?status=open&vehicleId="+vehicle+"&limit=10",{headers:auth}),env);assert.equal(res.status,200);assert.deepEqual(await res.json(),[{id:alert,status:"open"}]);assert.deepEqual(args,{p_status:"open",p_vehicle_id:vehicle,p_limit:10});}finally{globalThis.fetch=old;}
});

test("alert rules list and create validates speed rule payload",async()=>{
 const old=globalThis.fetch;let args={},target="";
 globalThis.fetch=async(input,init={})=>{target=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({id:"rule-1",rule_type:"speed_limit"}),{status:200});};
 try{const list=await worker.fetch(new Request("https://worker.test/api/v1/alerts/rules?vehicleId="+vehicle,{headers:auth}),env);assert.equal(list.status,200);assert.match(target,/darb_api_list_alert_rules$/);const bad=await worker.fetch(new Request("https://worker.test/api/v1/alerts/rules",{method:"POST",headers:auth,body:JSON.stringify({vehicleId:vehicle,type:"speed_limit",name:"Speed",config:{limitKmh:0}})}),env);assert.equal(bad.status,400);const res=await worker.fetch(new Request("https://worker.test/api/v1/alerts/rules",{method:"POST",headers:auth,body:JSON.stringify({vehicleId:vehicle,type:"speed_limit",name:"Speed limit",config:{limitKmh:80},enabled:true})}),env);assert.equal(res.status,201);assert.match(target,/darb_api_create_alert_rule$/);assert.deepEqual(args,{p_vehicle_id:vehicle,p_type:"speed_limit",p_name:"Speed limit",p_config:{limitKmh:80},p_enabled:true});}finally{globalThis.fetch=old;}
});

test("alert acknowledge and resolve routes invoke corresponding RPCs",async()=>{
 const old=globalThis.fetch;let args={},target="";
 globalThis.fetch=async(input,init={})=>{target=String(input);args=JSON.parse(init.body||"{}");return new Response(JSON.stringify({id:alert,status:"resolved"}),{status:200});};
 try{const ack=await worker.fetch(new Request(`https://worker.test/api/v1/alerts/${alert}/acknowledge`,{method:"PATCH",headers:auth}),env);assert.equal(ack.status,200);assert.match(target,/darb_api_acknowledge_alert$/);assert.deepEqual(args,{p_alert_id:alert});const res=await worker.fetch(new Request(`https://worker.test/api/v1/alerts/${alert}/resolve`,{method:"PATCH",headers:auth}),env);assert.equal(res.status,200);assert.match(target,/darb_api_resolve_alert$/);assert.deepEqual(args,{p_alert_id:alert});}finally{globalThis.fetch=old;}
});

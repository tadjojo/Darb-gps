import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
const env={ALLOWED_ORIGINS:"https://darb-gps-web-2026.tadjojo.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"test-key",SUPABASE_SERVICE_ROLE_KEY:"test-service-role"};
const auth={Authorization:"Bearer tracker-secret","Content-Type":"application/json"};
async function sha(secret){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");}
function sentence(body){let x=0;for(const ch of body)x^=ch.charCodeAt(0);return "$"+body+"*"+x.toString(16).padStart(2,"0").toUpperCase();}
function crc16(data){let crc=0xffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0x8408:crc>>>1;}return (crc^0xffff)&0xffff;}
function gt06Frame(){const p=new Uint8Array(18);p.set([26,11,25,10,0,0,8],0);const lat=57510000,lon=64638000;p[7]=(lat>>>24)&255;p[8]=(lat>>>16)&255;p[9]=(lat>>>8)&255;p[10]=lat&255;p[11]=(lon>>>24)&255;p[12]=(lon>>>16)&255;p[13]=(lon>>>8)&255;p[14]=lon&255;p[15]=25;p[16]=0x1c;p[17]=90;const length=23;const frame=[0x78,0x78,length,0x12,...p,0,1,0,0,0x0d,0x0a];const crc=crc16(frame.slice(2,frame.length-4));frame[frame.length-4]=(crc>>8)&255;frame[frame.length-3]=crc&255;return frame.map(b=>b.toString(16).padStart(2,"0")).join("");}

test("NMEA RMC HTTPS adapter validates profile, parses checksum, and ingests UTC fix",async()=>{
 const old=globalThis.fetch;let calls=0,profileArgs={},ingestArgs={};
 globalThis.fetch=async(_i,init={})=>{calls++;const args=JSON.parse(init.body||"{}");if(calls===1){profileArgs=args;return new Response(JSON.stringify({protocol:"nmea",timezone_offset_minutes:null}),{status:200});}ingestArgs=args;return new Response(JSON.stringify({accepted:true,duplicate:false}),{status:200});};
 try{const raw=sentence("GPRMC,100000.00,A,3157.234,N,03554.123,E,10.0,90.0,251126,,,A");const res=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest/nmea",{method:"POST",headers:auth,body:JSON.stringify({sentence:raw})}),env);assert.equal(res.status,200);assert.equal(calls,2);assert.equal(profileArgs.p_credential_hash,await sha("tracker-secret"));assert.equal(ingestArgs.p_protocol,"nmea");assert.equal(ingestArgs.p_speed_kmh,18.52);assert.equal(ingestArgs.p_heading,90);assert.equal(ingestArgs.p_recorded_at,"2026-11-25T10:00:00.000Z");}finally{globalThis.fetch=old;}
});

test("NMEA GGA requires paired timestamp and rejects checksum errors",async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({protocol:"nmea"}),{status:200});
 try{const gga=sentence("GPGGA,100000.00,3157.234,N,03554.123,E,1,08,0.9,100.0,M,0.0,M,,");const noPair=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest/nmea",{method:"POST",headers:auth,body:JSON.stringify({sentence:gga})}),env);assert.equal(noPair.status,400);const bad=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest/nmea",{method:"POST",headers:auth,body:JSON.stringify({sentence:gga.slice(0,-2)+"00",pairedUtcTimestamp:"2026-11-25T10:00:00Z"})}),env);assert.equal(bad.status,400);}finally{globalThis.fetch=old;}
});

test("GT06 HTTPS adapter validates frame CRC and applies configured UTC offset",async()=>{
 const old=globalThis.fetch;let calls=0,profileArgs={},ingestArgs={};
 globalThis.fetch=async(_i,init={})=>{calls++;const args=JSON.parse(init.body||"{}");if(calls===1){profileArgs=args;return new Response(JSON.stringify({protocol:"gt06",timezone_offset_minutes:180}),{status:200});}ingestArgs=args;return new Response(JSON.stringify({accepted:true,duplicate:false}),{status:200});};
 try{const frame=gt06Frame();const res=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest/gt06",{method:"POST",headers:auth,body:JSON.stringify({frameHex:frame})}),env);assert.equal(res.status,200);assert.equal(calls,2);assert.equal(profileArgs.p_credential_hash,await sha("tracker-secret"));assert.equal(ingestArgs.p_protocol,"gt06");assert.equal(ingestArgs.p_latitude,31.95);assert.equal(ingestArgs.p_longitude,-35.91);assert.equal(ingestArgs.p_recorded_at,"2026-11-25T07:00:00.000Z");}finally{globalThis.fetch=old;}
});


test("GT06 adapter rejects a corrupted CRC frame",async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({protocol:"gt06",timezone_offset_minutes:180}),{status:200});};
 try{const validFrame=gt06Frame();const frame=validFrame.slice(0,-4)+"0000"+validFrame.slice(-2);const res=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest/gt06",{method:"POST",headers:auth,body:JSON.stringify({frameHex:frame})}),env);assert.equal(res.status,400);assert.equal(calls,1);}finally{globalThis.fetch=old;}
});

test("NMEA adapter rejects credentials enrolled for another protocol",async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({protocol:"json"}),{status:200});
 try{const res=await worker.fetch(new Request("https://worker.test/api/v1/device-gateway/ingest/nmea",{method:"POST",headers:auth,body:JSON.stringify({sentence:sentence("GPRMC,100000.00,A,3157.234,N,03554.123,E,10.0,90.0,251126,,,A")})}),env);assert.equal(res.status,400);}finally{globalThis.fetch=old;}
});

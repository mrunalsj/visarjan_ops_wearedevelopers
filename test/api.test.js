import { test } from 'node:test';
import assert from 'node:assert/strict';
const base=`http://localhost:${process.env.PORT||4173}/api/v1/public`;
const apiRoot=`http://localhost:${process.env.PORT||4173}/api/v1`;
async function request(path,options={}){const response=await fetch(base+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});return {status:response.status,body:await response.json()};}
async function opsRequest(path,options={}){const response=await fetch(apiRoot+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});return {status:response.status,body:await response.json(),headers:response.headers};}
test('demo booking persists, protects recovery, enforces capacity, and accepts assistance',async()=>{
 const reset=await request('/demo/reset',{method:'POST',body:'{}'});assert.equal(reset.status,200);
 const sites=await request('/sites');assert.equal(sites.status,200);assert.equal(sites.body.data.filter(s=>s.provenance.kind==='demo').length,8,'start the test server with DEMO_SITES=true');
 const payload=i=>JSON.stringify({siteId:'lakeview',slot:'6:00 – 6:30 PM',people:3,name:`Demo ${i}`,email:`demo${i}@example.test`});
 const responses=await Promise.all([0,1,2,3].map(i=>request('/bookings',{method:'POST',body:payload(i)})));
 assert.equal(responses.filter(r=>r.status===201).length,3);assert.equal(responses.filter(r=>r.status===409).length,1);
 const saved=responses.find(r=>r.status===201).body.data;
 assert.ok(saved.recoveryKey);assert.equal(saved.siteName,'Lakeview Artificial Pond');
 const recovered=await request(`/bookings/${saved.reference}?key=${encodeURIComponent(saved.recoveryKey)}`);assert.equal(recovered.status,200);assert.equal(recovered.body.data.reference,saved.reference);
 const denied=await request(`/bookings/${saved.reference}?key=wrong`);assert.equal(denied.status,404);
 const pass=await request(`/bookings/${saved.reference}/pass?key=${encodeURIComponent(saved.recoveryKey)}`);assert.equal(pass.status,200);assert.ok(pass.body.data.qrPayload.includes(saved.reference));
 const help=await request('/assistance-requests',{method:'POST',body:JSON.stringify({bookingReference:saved.reference,category:'Senior citizen support'})});assert.equal(help.status,201);
 const status=await request(`/assistance-requests/${help.body.data.reference}`);assert.equal(status.body.data.status,'Received');
 await request('/demo/reset',{method:'POST',body:'{}'});
});
test('public sites keep provenance and never expose unsourced or invented status',async()=>{
 const {status,body}=await request('/sites');assert.equal(status,200);
 for(const s of body.data){
  for(const raw of ['distance','waiting','wait','status','capacity','rawText','quality'])assert.equal(raw in s,false,`${raw} must not be public`);
  if(s.provenance.kind==='demo'){assert.equal(s.coordinates.kind,'synthetic');assert.equal(s.statusInfo.freshness,'demo');continue;}
  assert.equal(s.provenance.kind,'official-source');assert.equal(s.city,'Mumbai');
  assert.match(s.provenance.sourceUrl,/^https:\/\/portal\.mcgm\.gov\.in\//);assert.equal(s.provenance.festivalYear,2025);assert.equal(s.provenance.verificationStatus,'PENDING_REVIEW');
  if(s.coordinates){assert.equal(s.coordinates.kind,'official-link');assert.ok(s.coordinates.lat>18.85&&s.coordinates.lat<19.35&&s.coordinates.lng>72.75&&s.coordinates.lng<73.05);}
  if(s.statusInfo.freshness!=='unavailable')assert.equal(s.statusInfo.source,'VisarjanOps site staff');
 }
 const official=body.data.filter(s=>s.provenance.kind==='official-source');assert.ok(official.length>=200);assert.ok(official.filter(s=>s.coordinates).length>=100);
 const bengaluru=await request('/sites?q=Bengaluru');assert.equal(bengaluru.body.data.length,4);
 const booking=await request('/bookings',{method:'POST',body:JSON.stringify({siteId:official[0].id,slot:'5:00 – 5:30 PM',people:2,name:'Demo',email:'demo@example.test'})});assert.equal(booking.status,409);
});
test('only signed-in staff can post site status, and it shows publicly as live with its source',async()=>{
 const target=(await request('/sites')).body.data.find(s=>s.provenance.kind==='official-source').id;
 const anonymous=await opsRequest(`/operations/sites/${target}/status`,{method:'POST',body:JSON.stringify({status:'Busy'})});assert.equal(anonymous.status,401);
 if(!process.env.OPS_USERNAME||!process.env.OPS_PASSWORD)return;
 const login=await opsRequest('/operations/auth/login',{method:'POST',body:JSON.stringify({username:process.env.OPS_USERNAME,password:process.env.OPS_PASSWORD})});const cookie=login.headers.get('set-cookie').split(';')[0];
 const invalid=await opsRequest(`/operations/sites/${target}/status`,{method:'POST',headers:{cookie},body:JSON.stringify({status:'Empty'})});assert.equal(invalid.status,400);
 const badNumber=await opsRequest(`/operations/sites/${target}/status`,{method:'POST',headers:{cookie},body:JSON.stringify({status:'Busy',waiting:-3})});assert.equal(badNumber.status,400);
 const posted=await opsRequest(`/operations/sites/${target}/status`,{method:'POST',headers:{cookie},body:JSON.stringify({status:'Busy',waiting:35,waitMinutes:20})});assert.equal(posted.status,200);
 const site=(await request(`/sites/${target}`)).body.data;
 assert.equal(site.statusInfo.freshness,'live');assert.equal(site.statusInfo.status,'Busy');assert.equal(site.statusInfo.wait,'~20 min');assert.equal(site.statusInfo.source,'VisarjanOps site staff');
 await opsRequest('/operations/auth/logout',{method:'POST',headers:{cookie}});
});
test('operations site data is protected by a staff session',async()=>{
 const denied=await opsRequest('/operations/sites');assert.equal(denied.status,401);
 const session=await opsRequest('/operations/auth/session');assert.equal(session.status,200);assert.equal(session.body.data.authenticated,false);
 if(!process.env.OPS_USERNAME||!process.env.OPS_PASSWORD){const unavailableOrRejected=await opsRequest('/operations/auth/login',{method:'POST',body:JSON.stringify({username:'staff',password:'not-a-real-password'})});assert.ok([401,503].includes(unavailableOrRejected.status));return;}
 const rejected=await opsRequest('/operations/auth/login',{method:'POST',body:JSON.stringify({username:process.env.OPS_USERNAME,password:'wrong-password'})});assert.equal(rejected.status,401);
 const login=await opsRequest('/operations/auth/login',{method:'POST',body:JSON.stringify({username:process.env.OPS_USERNAME,password:process.env.OPS_PASSWORD})});assert.equal(login.status,200);assert.equal(login.body.data.role,'operations');
 const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.match(cookie||'',/^visarjanops_ops=/);
 const allowed=await opsRequest('/operations/sites',{headers:{cookie}});assert.equal(allowed.status,200);assert.ok(allowed.body.data.length>=208);assert.equal(allowed.body.sources[0].authority,'Brihanmumbai Municipal Corporation (MCGM)');
 const logout=await opsRequest('/operations/auth/logout',{method:'POST',headers:{cookie}});assert.equal(logout.status,200);
 const after=await opsRequest('/operations/sites',{headers:{cookie}});assert.equal(after.status,401);
});
test('public feature flags are exposed without secrets and voice refuses when off or cross-site',async()=>{
 const features=await request('/features');assert.equal(features.status,200);assert.deepEqual(Object.keys(features.body.data).sort(),['mapView','nearbyDiscovery','voiceAssistance']);
 const crossSite=await fetch(`${base}/voice/search`,{method:'POST',headers:{'content-type':'audio/webm',origin:'https://evil.example'},body:Buffer.alloc(5000)});assert.equal(crossSite.status,403);
 if(!features.body.data.voiceAssistance){const off=await fetch(`${base}/voice/search`,{method:'POST',headers:{'content-type':'audio/webm'},body:Buffer.alloc(5000)});assert.equal(off.status,503);}
});
test('health endpoint needs the monitor token or a staff session and exposes no secrets',async()=>{
 const anonymous=await fetch(`${apiRoot}/health`);assert.equal(anonymous.status,401);
 const wrong=await fetch(`${apiRoot}/health`,{headers:{authorization:'Bearer not-the-token-not-the-token'}});assert.equal(wrong.status,401);
 if(!process.env.OPS_MONITOR_TOKEN)return;
 const ok=await fetch(`${apiRoot}/health`,{headers:{authorization:`Bearer ${process.env.OPS_MONITOR_TOKEN}`}});assert.equal(ok.status,200);
 const text=await ok.text();const body=JSON.parse(text).data;
 assert.equal(body.status,'ok');assert.ok(body.store.sites>=208);assert.equal(typeof body.uptimeSeconds,'number');
 for(const secret of [process.env.OPS_MONITOR_TOKEN,process.env.OPS_PASSWORD,process.env.SARVAM_API_KEY].filter(Boolean))assert.equal(text.includes(secret),false);
});
test('booking issues a QR pass without the recovery key, and gate scans update the crowd once each',async()=>{
 const made=await request('/bookings',{method:'POST',body:JSON.stringify({siteId:'blr-indiranagar',slot:'5:30 – 6:00 PM',people:3,name:'Gate Test',email:'gate@example.test'})});assert.equal(made.status,201);
 const {reference,recoveryKey}=made.body.data;
 const pass=await request(`/bookings/${reference}/pass?key=${encodeURIComponent(recoveryKey)}`);assert.equal(pass.status,200);
 assert.match(pass.body.data.qrPayload,/^VJ1\|VJ-[0-9A-F]{8}\|[0-9A-F]{10}$/);assert.equal(pass.body.data.qrPayload.includes(recoveryKey),false);assert.match(pass.body.data.qrSvg,/^<svg/);
 const before=(await request('/sites/blr-indiranagar')).body.data.crowd;
 const anonymous=await opsRequest('/operations/checkin',{method:'POST',body:JSON.stringify({payload:pass.body.data.qrPayload})});assert.equal(anonymous.status,401);
 if(!process.env.OPS_USERNAME||!process.env.OPS_PASSWORD)return;
 const login=await opsRequest('/operations/auth/login',{method:'POST',body:JSON.stringify({username:process.env.OPS_USERNAME,password:process.env.OPS_PASSWORD})});const cookie=login.headers.get('set-cookie').split(';')[0];
 const scan=(extra={})=>opsRequest('/operations/checkin',{method:'POST',headers:{cookie},body:JSON.stringify({payload:pass.body.data.qrPayload,siteId:'blr-indiranagar',...extra})});
 assert.equal((await scan({siteId:'blr-whitefield'})).status,409,'wrong gate');
 assert.equal((await opsRequest('/operations/checkin',{method:'POST',headers:{cookie},body:JSON.stringify({reference,code:'0000000000'})})).status,404,'wrong code');
 const entry=await scan();assert.equal(entry.status,200);assert.equal(entry.body.data.action,'entry');
 let crowd=(await request('/sites/blr-indiranagar')).body.data.crowd;assert.equal(crowd.onSite,before.onSite+3);assert.equal(crowd.expected,before.expected-3);
 const exit=await scan();assert.equal(exit.body.data.action,'exit');
 crowd=(await request('/sites/blr-indiranagar')).body.data.crowd;assert.equal(crowd.onSite,before.onSite);
 assert.equal((await scan()).status,409,'pass cannot be reused');
 await opsRequest('/operations/auth/logout',{method:'POST',headers:{cookie}});
});

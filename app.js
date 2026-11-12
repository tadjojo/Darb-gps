(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const demoVehicles = [
    {id:'demo-1',name:'شاحنة التوزيع 04',plate:'34-82156',driver:'محمد العلي',status:'moving',updated:'منذ دقيقة',lat:31.9539,lng:35.9106},
    {id:'demo-2',name:'مركبة الخدمات 02',plate:'21-45980',driver:'أحمد خالد',status:'stopped',updated:'منذ 18 دقيقة',lat:32.0728,lng:36.088},
    {id:'demo-3',name:'سيارة النقل 11',plate:'17-90321',driver:'غير محدد',status:'moving',updated:'منذ 3 دقائق',lat:31.991,lng:35.875},
    {id:'demo-4',name:'شاحنة الأسطول 08',plate:'45-11762',driver:'سامي يوسف',status:'offline',updated:'منذ ساعتين',lat:32.015,lng:35.728},
    {id:'demo-5',name:'مركبة المتابعة 06',plate:'12-66310',driver:'ليث محمود',status:'moving',updated:'منذ 5 دقائق',lat:31.71,lng:35.793}
  ];
  let vehicles = [...demoVehicles], mapA, mapB, markers = [], token = sessionStorage.getItem('darb_access') || '', refreshToken = sessionStorage.getItem('darb_refresh') || '';
  let apiBase = localStorage.getItem('darb_api') || '', orgId = localStorage.getItem('darb_org') || '', isEnglish = false;
  const statusText = {moving:'تتحرك',stopped:'متوقفة',offline:'غير متصلة'};
  const vehicleRow = v => `<tr><td><div class="vehicle-cell"><span class="vehicle-icon">▰</span>${escapeHtml(v.name)}</div></td><td dir="ltr">${escapeHtml(v.plate || '—')}</td><td>${escapeHtml(v.driver || '—')}</td><td><span class="status ${v.status}">${statusText[v.status] || 'غير معروف'}</span></td><td>${escapeHtml(v.updated || '—')}</td>${v.id?.startsWith('demo-')?'':'<td></td>'}</tr>`;
  function escapeHtml(s){return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function renderVehicles(){ $('vehicleRows').innerHTML=vehicles.slice(0,5).map(vehicleRow).join(''); $('allVehicleRows').innerHTML=vehicles.map(vehicleRow).join(''); $('vehicleCount').textContent=`${vehicles.length} مركبة`; }
  function setConnection(online){$('connectionState').classList.toggle('online',online);$('connectionState').innerHTML=online?'<i></i> متصل بالخادم':'<i></i> وضع العرض التجريبي';$('demoNotice').style.display=online?'none':'flex';$('profileName').textContent=online?'مستخدم مسجل':'مستخدم تجريبي';$('profileRole').textContent=online?'متصل بالخادم':'وضع العرض';$('loginBtn').style.display=online?'none':'inline-block';$('logoutBtn').style.display=online?'block':'none';}
  function initMap(id){if(!window.L||!$(id))return null;const map=L.map(id,{scrollWheelZoom:false}).setView([31.95,35.91],8);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);return map;}
  function drawMarkers(){if(!window.L)return;[mapA,mapB].filter(Boolean).forEach(map=>{markers.filter(x=>x.map===map).forEach(x=>map.removeLayer(x.marker));markers=markers.filter(x=>x.map!==map);vehicles.forEach(v=>{if(!Number.isFinite(Number(v.lat))||!Number.isFinite(Number(v.lng)))return;const color=v.status==='moving'?'#159b70':v.status==='stopped'?'#d99522':'#8b97a8';const marker=L.circleMarker([v.lat,v.lng],{radius:8,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(map).bindPopup(`<b>${escapeHtml(v.name)}</b><br>${statusText[v.status]||''}<br>${escapeHtml(v.updated||'')}`);markers.push({map,marker});});});}
  function updateStats(){ $('statVehicles').textContent=vehicles.length; $('statMoving').textContent=vehicles.filter(v=>v.status==='moving').length; $('statStopped').textContent=vehicles.filter(v=>v.status==='stopped').length; }
  function showPage(view){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));const page=$(`page-${view}`);if(page)page.classList.add('active');document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.view===view));const link=document.querySelector(`[data-view="${view}"]`);$('pageTitle').textContent=link?link.textContent.trim():view;$('sidebar').classList.remove('open');if(view==='map'&&mapB)setTimeout(()=>mapB.invalidateSize(),100);if(view==='overview'&&mapA)setTimeout(()=>mapA.invalidateSize(),100);}
  async function api(path,options={}){if(!apiBase)throw new Error('أدخل عنوان API أولاً من الإعدادات.');const headers={'Content-Type':'application/json',...(options.headers||{})};if(token)headers.Authorization=`Bearer ${token}`;const response=await fetch(`${apiBase.replace(/\/$/,'')}${path}`,{...options,headers});if(response.status===204)return null;const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||`فشل الطلب (${response.status})`);return data;}
  async function loadVehicles(){if(!token||!orgId)return;const data=await api(`/organizations/${encodeURIComponent(orgId)}/vehicles`);const list=Array.isArray(data)?data:(data.items||data.vehicles||[]);const base=list.map(v=>({id:v.id,name:v.displayName||v.display_name||'مركبة',plate:v.registrationNumber||v.registration_number||'—',driver:v.driverName||'—',status:'offline',updated:'لا تتوفر إحداثيات بعد',lat:null,lng:null}));vehicles=await Promise.all(base.map(async v=>{try{const loc=await api(`/tracking/vehicles/${encodeURIComponent(v.id)}/latest`);if(!loc||!Number.isFinite(Number(loc.latitude))||!Number.isFinite(Number(loc.longitude)))return v;const age=Math.max(0,Date.now()-new Date(loc.recorded_at||loc.recordedAt).getTime());const mins=Math.floor(age/60000);const speed=Number(loc.speed_kmh??loc.speedKmh??0);return {...v,lat:Number(loc.latitude),lng:Number(loc.longitude),status:age>10*60000?'offline':speed<=3?'stopped':'moving',updated:mins<1?'الآن':`منذ ${mins} دقيقة`};}catch{return v;}}));renderVehicles();updateStats();drawMarkers();}
  function openModal(id){$(id).classList.add('open');$(id).setAttribute('aria-hidden','false');}function closeModal(id){$(id).classList.remove('open');$(id).setAttribute('aria-hidden','true');}
  async function login(e){e.preventDefault();$('loginMessage').textContent='جارٍ تسجيل الدخول…';try{const data=await api('/auth/login',{method:'POST',body:JSON.stringify({identifier:$('identifier').value.trim(),password:$('password').value})});token=data.accessToken;refreshToken=data.refreshToken;sessionStorage.setItem('darb_access',token);sessionStorage.setItem('darb_refresh',refreshToken);setConnection(true);closeModal('loginModal');if (orgId) {
  await loadVehicles();
  connectDarbRealtime();

  vehicles
    .filter(v => v.id && !String(v.id).startsWith('demo-'))
    .forEach(v => {
      darbSocket.emit('vehicle.join', {
        vehicleId: v.id
      });
    });
}$('loginForm').reset();}catch(err){$('loginMessage').textContent=err.message;}}
  async function logout(){try{if(token&&refreshToken)await api('/auth/logout',{method:'POST',body:JSON.stringify({refreshToken})});}catch(e){console.warn('Logout request failed',e);}if (darbSocket) {
  darbSocket.disconnect();
  darbSocket = null;
}token='';refreshToken='';sessionStorage.removeItem('darb_access');sessionStorage.removeItem('darb_refresh');vehicles=[...demoVehicles];renderVehicles();updateStats();drawMarkers();setConnection(false);}
  async function addVehicle(e){e.preventDefault();$('vehicleMessage').textContent='';if(!token||!orgId){$('vehicleMessage').textContent='سجّل الدخول وحدد معرّف المؤسسة أولاً.';return;}try{await api(`/organizations/${encodeURIComponent(orgId)}/vehicles`,{method:'POST',body:JSON.stringify({displayName:$('vehicleName').value.trim(),registrationNumber:$('vehiclePlate').value.trim()})});$('vehicleMessage').textContent='تم إرسال طلب إضافة المركبة.';await loadVehicles();setTimeout(()=>closeModal('vehicleModal'),700);}catch(err){$('vehicleMessage').textContent=err.message;}}
  async function testConnection(){const msg=$('settingsMessage');msg.textContent='جارٍ فحص الاتصال…';try{const base=$('apiBase').value.trim().replace(/\/$/,'');if(!base)throw new Error('أدخل عنوان الخادم.');const res=await fetch(`${base}/health/live`);if(!res.ok)throw new Error(`الخادم أعاد ${res.status}`);msg.textContent='نجح الاتصال بالخادم.';}catch(e){msg.textContent=`تعذر الاتصال: ${e.message}`;}}
  function bind(){document.querySelectorAll('[data-view]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();showPage(a.dataset.view);}));$('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));$('loginBtn').addEventListener('click',()=>openModal('loginModal'));$('noticeLogin').addEventListener('click',()=>openModal('loginModal'));$('deviceLogin').addEventListener('click',()=>openModal('loginModal'));$('tripsLogin').addEventListener('click',()=>openModal('loginModal'));$('closeLogin').addEventListener('click',()=>closeModal('loginModal'));$('closeVehicle').addEventListener('click',()=>closeModal('vehicleModal'));$('loginForm').addEventListener('submit',login);$('vehicleForm').addEventListener('submit',addVehicle);$('logoutBtn').addEventListener('click',logout);$('addVehicleBtn').addEventListener('click',()=>openModal('vehicleModal'));$('vehiclesAddBtn').addEventListener('click',()=>openModal('vehicleModal'));$('saveSettings').addEventListener('click',()=>{apiBase=$('apiBase').value.trim().replace(/\/$/,'');orgId=$('orgId').value.trim();localStorage.setItem('darb_api',apiBase);localStorage.setItem('darb_org',orgId);$('settingsMessage').textContent='تم حفظ الإعدادات على هذا المتصفح.';});$('testConnection').addEventListener('click',testConnection);$('refreshBtn').addEventListener('click',async()=>{try{await loadVehicles();$('refreshBtn').textContent='✓ تم التحديث';}catch(e){$('refreshBtn').textContent='تعذر التحديث';}setTimeout(()=>$('refreshBtn').textContent='↻ تحديث البيانات',1800);});$('vehicleSearch').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();$('allVehicleRows').innerHTML=vehicles.filter(v=>`${v.name} ${v.plate}`.toLowerCase().includes(q)).map(vehicleRow).join('');});$('locateMe').addEventListener('click',()=>{if(!navigator.geolocation)return alert('المتصفح لا يدعم تحديد الموقع.');navigator.geolocation.getCurrentPosition(p=>mapB?.setView([p.coords.latitude,p.coords.longitude],14),()=>alert('تعذر الوصول إلى موقعك. تحقق من صلاحية الموقع.'));});$('langBtn').addEventListener('click',()=>{alert('English interface is planned for the next web release. The current release is Arabic RTL.');});['loginModal','vehicleModal'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.id===id)closeModal(id);}));}
  function start(){mapA=initMap('overviewMap');mapB=initMap('fullMap');renderVehicles();updateStats();drawMarkers();bind();$('apiBase').value=apiBase;$('orgId').value=orgId;setConnection(Boolean(token));if(token&&orgId)loadVehicles().catch(e=>{console.warn(e);setConnection(false);});}
  // DARB GPS - Realtime connection
let darbSocket = null;

function connectDarbRealtime() {
  if (!window.io || !apiBase || !token) {
    console.warn('DARB: Realtime prerequisites missing');
    return;
  }

  if (darbSocket) {
    darbSocket.disconnect();
  }

  const socketBase = apiBase.replace(/\/api\/v1\/?$/, '');

  darbSocket = window.io(socketBase + '/tracking', {
    transports: ['websocket'],
    auth: { token }
  });

  darbSocket.on('connect', () => {
    console.log('DARB: Live tracking connected');
    vehicles
  .filter(v => v.id && !String(v.id).startsWith('demo-'))
  .forEach(v => {
    darbSocket.emit('vehicle.join', {
      vehicleId: v.id
    });
  });
  });

  darbSocket.on('vehicle.location.updated', event => {
    if (!event || !event.vehicleId) return;

    const vehicle = vehicles.find(
      v => String(v.id) === String(event.vehicleId)
    );

    if (!vehicle) return;

    const lat = Number(event.latitude);
    const lng = Number(event.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    vehicle.lat = lat;
    vehicle.lng = lng;
    vehicle.speed = Number(event.speedKmh || 0);
    vehicle.heading = Number(event.heading || 0);
    vehicle.status = vehicle.speed <= 3 ? 'stopped' : 'moving';
    vehicle.updated = 'الآن';

    renderVehicles();
    updateStats();
    drawMarkers();
  });

  darbSocket.on('disconnect', () => {
    console.log('DARB: Live tracking disconnected');
  });

  darbSocket.on('connect_error', error => {
    console.error('DARB realtime error:', error.message);
  });
}
  document.addEventListener('DOMContentLoaded',start);
})();

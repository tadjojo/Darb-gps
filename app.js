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
  let vehicles = [...demoVehicles], mapA, mapB, markers = [], routeLayer = null, routeMarkers = [], alertCount = 0, token = sessionStorage.getItem('darb_access') || '', refreshToken = sessionStorage.getItem('darb_refresh') || '', refreshPromise = null, socketRefreshInProgress = false;
  let apiBase = localStorage.getItem('darb_api') || 'https://darb-gps-x.onrender.com/api/v1', orgId = localStorage.getItem('darb_org') || '', isEnglish = false;
  const statusText = {moving:'تتحرك',stopped:'متوقفة',offline:'غير متصلة'};
  const vehicleRow = v => `<tr><td><div class="vehicle-cell"><span class="vehicle-icon">▰</span>${escapeHtml(v.name)}</div></td><td dir="ltr">${escapeHtml(v.plate || '—')}</td><td>${escapeHtml(v.driver || '—')}</td><td><span class="status ${v.status}">${statusText[v.status] || 'غير معروف'}</span></td><td>${escapeHtml(v.updated || '—')}</td>${v.id?.startsWith('demo-')?'':'<td></td>'}</tr>`;
  function escapeHtml(s){return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function renderVehicles(){
    $('vehicleRows').innerHTML=vehicles.slice(0,5).map(vehicleRow).join('');
    $('allVehicleRows').innerHTML=vehicles.map(vehicleRow).join('');
    $('vehicleCount').textContent=`${vehicles.length} مركبة`;
    const options='<option value="">اختر المركبة</option>'+vehicles.filter(v=>v.id&&!String(v.id).startsWith('demo-')).map(v=>'<option value="'+escapeHtml(v.id)+'">'+escapeHtml(v.name)+' — '+escapeHtml(v.plate)+'</option>').join('');
    ['deviceVehicle','tripVehicle'].forEach(id=>{
      const selector=$(id);
      if(selector){const selected=selector.value;selector.innerHTML=options;selector.value=selected;}
    });
  }
  function setConnection(online){$('connectionState').classList.toggle('online',online);$('connectionState').innerHTML=online?'<i></i> متصل بالخادم':'<i></i> وضع العرض التجريبي';$('demoNotice').style.display=online?'none':'flex';$('profileName').textContent=online?'مستخدم مسجل':'مستخدم تجريبي';$('profileRole').textContent=online?'متصل بالخادم':'وضع العرض';$('loginBtn').style.display=online?'none':'inline-block';$('logoutBtn').style.display=online?'block':'none';}
  function initMap(id){if(!window.L||!$(id))return null;const map=L.map(id,{scrollWheelZoom:false}).setView([31.95,35.91],8);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);return map;}
  function drawMarkers(){if(!window.L)return;[mapA,mapB].filter(Boolean).forEach(map=>{markers.filter(x=>x.map===map).forEach(x=>map.removeLayer(x.marker));markers=markers.filter(x=>x.map!==map);vehicles.forEach(v=>{if(!Number.isFinite(Number(v.lat))||!Number.isFinite(Number(v.lng)))return;const color=v.status==='moving'?'#159b70':v.status==='stopped'?'#d99522':'#8b97a8';const marker=L.circleMarker([v.lat,v.lng],{radius:8,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(map).bindPopup(`<b>${escapeHtml(v.name)}</b><br>${statusText[v.status]||''}<br>${escapeHtml(v.updated||'')}`);markers.push({map,marker});});});}
  function updateStats(){ $('statVehicles').textContent=vehicles.length; $('statMoving').textContent=vehicles.filter(v=>v.status==='moving').length; $('statStopped').textContent=vehicles.filter(v=>v.status==='stopped').length; $('statAlerts').textContent=alertCount; }
  function showPage(view){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));const page=$(`page-${view}`);if(page)page.classList.add('active');document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.view===view));const link=document.querySelector(`[data-view="${view}"]`);$('pageTitle').textContent=link?link.textContent.trim():view;$('sidebar').classList.remove('open');if(view==='map'&&mapB)setTimeout(()=>mapB.invalidateSize(),100);if(view==='overview'&&mapA)setTimeout(()=>mapA.invalidateSize(),100);if(view==='alerts'&&token)loadAlerts().catch(e=>{$('alertMessage').textContent='تعذر تحميل التنبيهات: '+e.message;});}
  async function refreshAccessToken(){
    if(!refreshToken)throw new Error('لا يوجد رمز تحديث للجلسة.');
    if(!refreshPromise){
      refreshPromise=(async()=>{
        const response=await fetch(`${apiBase.replace(/\/$/,'')}/auth/refresh`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({refreshToken})
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.accessToken||!data.refreshToken)throw new Error(data.message||'تعذر تجديد جلسة الدخول.');
        token=data.accessToken;
        refreshToken=data.refreshToken;
        sessionStorage.setItem('darb_access',token);
        sessionStorage.setItem('darb_refresh',refreshToken);
        return token;
      })().finally(()=>{refreshPromise=null;});
    }
    return refreshPromise;
  }
  async function api(path,options={}){
    if(!apiBase)throw new Error('أدخل عنوان API أولاً من الإعدادات.');
    const url=`${apiBase.replace(/\/$/,'')}${path}`;
    const request=()=>{
      const headers={'Content-Type':'application/json',...(options.headers||{})};
      if(token)headers.Authorization=`Bearer ${token}`;
      return fetch(url,{...options,headers});
    };
    let response=await request();
    if(response.status===401&&refreshToken&&!path.startsWith('/auth/')){
      try{
        await refreshAccessToken();
        response=await request();
      }catch(error){
        await logout();
        throw new Error('انتهت جلسة الدخول. سجّل الدخول مجدداً للمتابعة.');
      }
    }
    if(response.status===204)return null;
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||`فشل الطلب (${response.status})`);
    return data;
  }
  async function loadVehicles(){if(!token||!orgId)return;const data=await api(`/organizations/${encodeURIComponent(orgId)}/vehicles`);const list=Array.isArray(data)?data:(data.items||data.vehicles||[]);const base=list.map(v=>({id:v.id,name:v.displayName||v.display_name||'مركبة',plate:v.registrationNumber||v.registration_number||'—',driver:v.driverName||v.driver_name||'—',status:'offline',updated:'لا تتوفر إحداثيات بعد',lat:null,lng:null}));vehicles=await Promise.all(base.map(async v=>{try{const loc=await api(`/tracking/vehicles/${encodeURIComponent(v.id)}/latest`);if(!loc||!Number.isFinite(Number(loc.latitude))||!Number.isFinite(Number(loc.longitude)))return v;const age=Math.max(0,Date.now()-new Date(loc.recorded_at||loc.recordedAt).getTime());const mins=Math.floor(age/60000);const speed=Number(loc.speed_kmh??loc.speedKmh??0);return {...v,lat:Number(loc.latitude),lng:Number(loc.longitude),status:age>10*60000?'offline':speed<=3?'stopped':'moving',updated:mins<1?'الآن':`منذ ${mins} دقيقة`};}catch{return v;}}));renderVehicles();updateStats();drawMarkers();}
  function openModal(id){$(id).classList.add('open');$(id).setAttribute('aria-hidden','false');}function closeModal(id){$(id).classList.remove('open');$(id).setAttribute('aria-hidden','true');}
  async function login(e){e.preventDefault();$('loginMessage').textContent='جارٍ تسجيل الدخول…';try{const data=await api('/auth/login',{method:'POST',body:JSON.stringify({identifier:$('identifier').value.trim(),password:$('password').value})});token=data.accessToken;refreshToken=data.refreshToken;sessionStorage.setItem('darb_access',token);sessionStorage.setItem('darb_refresh',refreshToken);setConnection(true);closeModal('loginModal');if (!orgId) { vehicles=[];renderVehicles();updateStats();drawMarkers();$('settingsMessage').textContent='أنشئ مؤسسة من صفحة الإعدادات لبدء إضافة المركبات.'; } if (orgId) {
  await loadVehicles();
  connectDarbRealtime();
}$('loginForm').reset();}catch(err){$('loginMessage').textContent=err.message;}}
  async function logout(){try{if(token&&refreshToken)await api('/auth/logout',{method:'POST',body:JSON.stringify({refreshToken})});}catch(error){console.warn('Server logout did not complete; clearing local session.',error);}if (darbSocket) {
  darbSocket.disconnect();
  darbSocket = null;
}token='';refreshToken='';sessionStorage.removeItem('darb_access');sessionStorage.removeItem('darb_refresh');vehicles=[...demoVehicles];renderVehicles();updateStats();drawMarkers();setConnection(false);}
  async function createOrganization(){
    const name=$('orgName').value.trim();
    const msg=$('settingsMessage');
    if(!token){msg.textContent='سجّل الدخول أولاً لإنشاء مؤسسة.';return;}
    if(!name){msg.textContent='أدخل اسم المؤسسة.';return;}
    try{
      const result=await api('/organizations',{method:'POST',body:JSON.stringify({name})});
      if(!result||!result.id)throw new Error('لم يُرجع الخادم معرّف المؤسسة.');
      orgId=result.id;
      localStorage.setItem('darb_org',orgId);
      $('orgId').value=orgId;
      msg.textContent='تم إنشاء المؤسسة وربط حسابك بها بنجاح.';
      await loadVehicles();
      connectDarbRealtime();
    }catch(error){msg.textContent='تعذر إنشاء المؤسسة: '+error.message;}
  }
  async function enrollGpsDevice(){
    const vehicleId=$('deviceVehicle').value;
    const msg=$('deviceMessage');
    $('deviceCredential').value='';
    if(!token){msg.textContent='سجّل الدخول أولاً.';return;}
    if(!vehicleId){msg.textContent='اختر مركبة أولاً.';return;}
    try{
      const result=await api('/tracking/devices/gps',{method:'POST',body:JSON.stringify({vehicleId,label:$('deviceLabel').value.trim()||undefined})});
      $('deviceCredential').value=result.credential||'';
      msg.textContent='تم تسجيل الجهاز. احفظ الرمز الآن؛ لن يظهر مرة أخرى.';
    }catch(error){msg.textContent='تعذر تسجيل الجهاز: '+error.message;}
  }
  async function addVehicle(e){e.preventDefault();$('vehicleMessage').textContent='';if(!token||!orgId){$('vehicleMessage').textContent='سجّل الدخول وحدد معرّف المؤسسة أولاً.';return;}try{await api(`/organizations/${encodeURIComponent(orgId)}/vehicles`,{method:'POST',body:JSON.stringify({displayName:$('vehicleName').value.trim(),registrationNumber:$('vehiclePlate').value.trim()})});$('vehicleMessage').textContent='تم إرسال طلب إضافة المركبة.';await loadVehicles();setTimeout(()=>closeModal('vehicleModal'),700);}catch(err){$('vehicleMessage').textContent=err.message;}}
  function localDateTimeValue(date){
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }
  function formatDateTime(value){
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'—':date.toLocaleString('ar-JO');
  }
  function formatDistance(meters){
    const value=Number(meters||0);
    return value>=1000?`${(value/1000).toFixed(2)} كم`:`${Math.round(value)} م`;
  }
  function formatDuration(seconds){
    const total=Math.max(0,Math.floor(Number(seconds||0)/60));
    const hours=Math.floor(total/60), minutes=total%60;
    return hours?`${hours} س ${minutes} د`:`${minutes} دقيقة`;
  }
  async function loadTrips(){
    const message=$('tripMessage');
    if(!token){message.textContent='سجّل الدخول أولاً لعرض سجل مركباتك.';openModal('loginModal');return;}
    const vehicleId=$('tripVehicle').value;
    if(!vehicleId){message.textContent='اختر مركبة مسجلة أولاً.';return;}
    const fromValue=$('tripFrom').value, toValue=$('tripTo').value;
    if(!fromValue||!toValue){message.textContent='حدد تاريخ البداية والنهاية.';return;}
    const fromDate=new Date(fromValue), toDate=new Date(toValue);
    if(!Number.isFinite(fromDate.getTime())||!Number.isFinite(toDate.getTime())||fromDate>=toDate){message.textContent='الفترة الزمنية غير صحيحة.';return;}
    if(toDate-fromDate>31*86400000){message.textContent='اختر فترة لا تتجاوز 31 يوماً.';return;}
    const from=fromDate.toISOString(), to=toDate.toISOString();
    const query=`from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    message.textContent='جارٍ تحميل الرحلات والتوقفات…';
    $('tripRows').innerHTML='<tr><td colspan="5">جارٍ التحميل…</td></tr>';
    $('stopRows').innerHTML='<tr><td colspan="4">جارٍ التحميل…</td></tr>';
    try{
      const [trips,stops]=await Promise.all([
        api(`/tracking/vehicles/${encodeURIComponent(vehicleId)}/trips?${query}&limit=100`),
        api(`/tracking/vehicles/${encodeURIComponent(vehicleId)}/stops?${query}&limit=500`)
      ]);
      $('tripRows').innerHTML=trips.length?trips.map(trip=>`<tr><td>${escapeHtml(formatDateTime(trip.start_at))}</td><td>${escapeHtml(formatDateTime(trip.end_at))}</td><td>${escapeHtml(formatDistance(trip.distance_meters))}</td><td>${Number(trip.points_count)||0}</td><td><button class="outline-btn trip-route-btn" type="button" data-from="${escapeHtml(trip.start_at)}" data-to="${escapeHtml(trip.end_at)}">عرض المسار</button></td></tr>`).join(''):'<tr><td colspan="5">لا توجد رحلات مسجلة خلال الفترة المحددة.</td></tr>';
      $('stopRows').innerHTML=stops.length?stops.map(stop=>`<tr><td>${escapeHtml(formatDateTime(stop.start_at))}</td><td>${escapeHtml(formatDuration(stop.duration_seconds))}</td><td>${Number(stop.points_count)||0}</td><td dir="ltr">${Number(stop.latitude).toFixed(5)}, ${Number(stop.longitude).toFixed(5)}</td></tr>`).join(''):'<tr><td colspan="4">لا توجد توقفات طويلة خلال الفترة المحددة.</td></tr>';
      message.textContent=`تم تحميل ${trips.length} رحلة و${stops.length} توقف.`;
    }catch(error){
      message.textContent='تعذر تحميل السجل: '+error.message;
      $('tripRows').innerHTML='<tr><td colspan="5">تعذر تحميل الرحلات.</td></tr>';
      $('stopRows').innerHTML='<tr><td colspan="4">تعذر تحميل التوقفات.</td></tr>';
    }
  }
  async function viewTripRoute(from,to){
    const vehicleId=$('tripVehicle').value;
    if(!vehicleId)return;
    try{
      const points=await api(`/tracking/vehicles/${encodeURIComponent(vehicleId)}/trip-route?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`);
      const coordinates=points.map(point=>[Number(point.latitude),Number(point.longitude)]).filter(point=>Number.isFinite(point[0])&&Number.isFinite(point[1]));
      if(coordinates.length<2){$('tripMessage').textContent='لا توجد نقاط كافية لرسم هذا المسار.';return;}
      showPage('map');
      setTimeout(()=>{
        if(!window.L||!mapB)return;
        if(routeLayer)mapB.removeLayer(routeLayer);
        routeMarkers.forEach(marker=>mapB.removeLayer(marker));
        routeMarkers=[];
        routeLayer=L.polyline(coordinates,{color:'#1769aa',weight:5,opacity:.9}).addTo(mapB);
        routeMarkers.push(L.circleMarker(coordinates[0],{radius:7,color:'#fff',weight:2,fillColor:'#159b70',fillOpacity:1}).addTo(mapB).bindPopup('بداية الرحلة'));
        routeMarkers.push(L.circleMarker(coordinates[coordinates.length-1],{radius:7,color:'#fff',weight:2,fillColor:'#d34b4b',fillOpacity:1}).addTo(mapB).bindPopup('نهاية الرحلة'));
        mapB.invalidateSize();
        mapB.fitBounds(routeLayer.getBounds(),{padding:[24,24]});
      },150);
    }catch(error){$('tripMessage').textContent='تعذر عرض المسار: '+error.message;}
  }
  const alertTypeText={speed_limit:'تجاوز السرعة',geofence_enter:'دخول نطاق جغرافي',geofence_exit:'خروج من نطاق جغرافي',device_offline:'الجهاز غير متصل',tamper:'عبث بالجهاز'};
  const alertStatusText={open:'مفتوح',acknowledged:'تمت المراجعة',resolved:'مغلق'};
  async function loadAlerts(){
    if(!token){$('alertRows').innerHTML='<tr><td colspan="6">سجّل الدخول لعرض التنبيهات.</td></tr>';return;}
    $('alertMessage').textContent='جارٍ تحميل التنبيهات…';
    const status=$('alertStatusFilter').value;
    const [alerts,rules]=await Promise.all([api('/alerts?limit=200'+(status?'&status='+encodeURIComponent(status):'')),api('/alerts/rules')]);
    alertCount=alerts.filter(a=>a.status==='open').length;updateStats();
    $('alertRows').innerHTML=alerts.length?alerts.map(a=>'<tr><td dir="ltr">'+escapeHtml(new Date(a.occurred_at).toLocaleString('ar-JO'))+'</td><td>'+escapeHtml(a.vehicle_name||'—')+'</td><td>'+escapeHtml(alertTypeText[a.alert_type]||a.alert_type)+'</td><td>'+escapeHtml(a.message)+'</td><td><span class="status '+(a.status==='open'?'offline':'stopped')+'">'+escapeHtml(alertStatusText[a.status]||a.status)+'</span></td><td>'+(a.status==='open'?'<button class="outline-btn alert-ack-btn" data-action="acknowledge" data-id="'+escapeHtml(a.id)+'">تأكيد المراجعة</button>':'')+(a.status!=='resolved'?'<button class="outline-btn alert-ack-btn" data-action="resolve" data-id="'+escapeHtml(a.id)+'">إغلاق</button>':'—')+'</td></tr>').join(''):'<tr><td colspan="6">لا توجد تنبيهات ضمن هذا المرشح.</td></tr>';
    $('alertRuleRows').innerHTML=rules.length?rules.map(r=>'<tr><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.vehicle_name||'—')+'</td><td>'+ (r.rule_type==='speed_limit'?'حد السرعة':'نطاق جغرافي')+'</td><td>'+ (r.rule_type==='speed_limit'?escapeHtml(r.config.limitKmh)+' كم/س':escapeHtml(r.config.radiusMeters)+' متر')+'</td><td>'+ (r.enabled?'مفعّلة':'متوقفة')+'</td></tr>').join(''):'<tr><td colspan="5">لا توجد قواعد بعد.</td></tr>';
    const options='<option value="">اختر المركبة</option>'+vehicles.filter(v=>v.id&&!String(v.id).startsWith('demo-')).map(v=>'<option value="'+escapeHtml(v.id)+'">'+escapeHtml(v.name)+' — '+escapeHtml(v.plate)+'</option>').join('');
    $('alertVehicle').innerHTML=options;
    $('alertMessage').textContent='تم تحميل '+alerts.length+' تنبيه و'+rules.length+' قاعدة.';
  }
  async function createAlertRule(e){
    e.preventDefault();const msg=$('alertRuleMessage');msg.textContent='جارٍ حفظ القاعدة…';
    const type=$('alertRuleType').value,vehicleId=$('alertVehicle').value,name=$('alertRuleName').value.trim();
    if(!vehicleId){msg.textContent='اختر مركبة أولاً.';return;}
    let config={};
    if(type==='speed_limit')config={limitKmh:Number($('alertSpeedLimit').value)};
    else config={latitude:Number($('geofenceLat').value),longitude:Number($('geofenceLng').value),radiusMeters:Number($('geofenceRadius').value)};
    try{await api('/alerts/rules',{method:'POST',body:JSON.stringify({vehicleId,type,name,config})});$('alertRuleForm').reset();$('alertRuleType').value='speed_limit';toggleAlertRuleFields();msg.textContent='تم حفظ القاعدة بنجاح.';await loadAlerts();}
    catch(error){msg.textContent='تعذر حفظ القاعدة: '+error.message;}
  }
  function toggleAlertRuleFields(){const geo=$('alertRuleType').value==='geofence';$('geofenceRuleFields').hidden=!geo;$('speedRuleFields').hidden=geo;}
  async function testConnection(){const msg=$('settingsMessage');msg.textContent='جارٍ فحص الاتصال…';try{const base=$('apiBase').value.trim().replace(/\/$/,'');if(!base)throw new Error('أدخل عنوان الخادم.');const res=await fetch(`${base}/health/live`);if(!res.ok)throw new Error(`الخادم أعاد ${res.status}`);msg.textContent='نجح الاتصال بالخادم.';}catch(e){msg.textContent=`تعذر الاتصال: ${e.message}`;}}
  function bind(){document.querySelectorAll('[data-view]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();showPage(a.dataset.view);}));$('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));$('loginBtn').addEventListener('click',()=>openModal('loginModal'));$('noticeLogin').addEventListener('click',()=>openModal('loginModal'));if($('tripsLogin'))$('tripsLogin').addEventListener('click',()=>openModal('loginModal'));$('closeLogin').addEventListener('click',()=>closeModal('loginModal'));$('closeVehicle').addEventListener('click',()=>closeModal('vehicleModal'));$('loginForm').addEventListener('submit',login);$('vehicleForm').addEventListener('submit',addVehicle);$('logoutBtn').addEventListener('click',logout);$('enrollDeviceBtn').addEventListener('click',enrollGpsDevice);$('copyDeviceCredential').addEventListener('click',async()=>{const value=$('deviceCredential').value;if(!value){$('deviceMessage').textContent='لا يوجد رمز لنسخه.';return;}try{await navigator.clipboard.writeText(value);$('deviceMessage').textContent='تم نسخ الرمز.';}catch{$('deviceMessage').textContent='تعذر النسخ؛ حدد الرمز وانسخه يدوياً.';}});$('addVehicleBtn').addEventListener('click',()=>openModal('vehicleModal'));$('vehiclesAddBtn').addEventListener('click',()=>openModal('vehicleModal'));$('createOrgBtn').addEventListener('click',createOrganization);$('saveSettings').addEventListener('click',()=>{apiBase=$('apiBase').value.trim().replace(/\/$/,'');orgId=$('orgId').value.trim();localStorage.setItem('darb_api',apiBase);localStorage.setItem('darb_org',orgId);$('settingsMessage').textContent='تم حفظ الإعدادات على هذا المتصفح.';});$('testConnection').addEventListener('click',testConnection);$('loadTripsBtn').addEventListener('click',loadTrips);$('refreshAlertsBtn').addEventListener('click',()=>loadAlerts().catch(e=>$('alertMessage').textContent='تعذر التحديث: '+e.message));$('alertStatusFilter').addEventListener('change',()=>loadAlerts().catch(e=>$('alertMessage').textContent='تعذر التحديث: '+e.message));$('alertRuleForm').addEventListener('submit',createAlertRule);$('alertRuleType').addEventListener('change',toggleAlertRuleFields);$('alertRows').addEventListener('click',async e=>{const btn=e.target.closest('.alert-ack-btn');if(!btn)return;btn.disabled=true;try{await api('/alerts/'+encodeURIComponent(btn.dataset.id)+'/'+(btn.dataset.action==='resolve'?'resolve':'acknowledge'),{method:'PATCH'});await loadAlerts();}catch(error){$('alertMessage').textContent='تعذر تأكيد التنبيه: '+error.message;btn.disabled=false;}});$('tripRows').addEventListener('click',e=>{const button=e.target.closest('.trip-route-btn');if(button)viewTripRoute(button.dataset.from,button.dataset.to);});$('refreshBtn').addEventListener('click',async()=>{try{await loadVehicles();$('refreshBtn').textContent='✓ تم التحديث';}catch(e){$('refreshBtn').textContent='تعذر التحديث';}setTimeout(()=>$('refreshBtn').textContent='↻ تحديث البيانات',1800);});$('vehicleSearch').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();$('allVehicleRows').innerHTML=vehicles.filter(v=>`${v.name} ${v.plate}`.toLowerCase().includes(q)).map(vehicleRow).join('');});$('locateMe').addEventListener('click',()=>{if(!navigator.geolocation)return alert('المتصفح لا يدعم تحديد الموقع.');navigator.geolocation.getCurrentPosition(p=>mapB?.setView([p.coords.latitude,p.coords.longitude],14),()=>alert('تعذر الوصول إلى موقعك. تحقق من صلاحية الموقع.'));});$('langBtn').addEventListener('click',()=>{alert('English interface is planned for the next web release. The current release is Arabic RTL.');});['loginModal','vehicleModal'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.id===id)closeModal(id);}));}
  function start(){mapA=initMap('overviewMap');mapB=initMap('fullMap');const now=new Date();$('tripTo').value=localDateTimeValue(now);$('tripFrom').value=localDateTimeValue(new Date(now.getTime()-7*86400000));renderVehicles();updateStats();drawMarkers();bind();toggleAlertRuleFields();$('apiBase').value=apiBase;$('orgId').value=orgId;setConnection(Boolean(token));if(token&&orgId)loadVehicles().then(connectDarbRealtime).catch(e=>{console.warn(e);setConnection(false);});else if(token&&!orgId){vehicles=[];renderVehicles();updateStats();drawMarkers();}}
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

  darbSocket.on('disconnect', reason => {
    console.log('DARB: Live tracking disconnected', reason);
    if(reason==='io server disconnect'&&refreshToken&&!socketRefreshInProgress){
      socketRefreshInProgress=true;
      refreshAccessToken()
        .then(()=>connectDarbRealtime())
        .catch(error=>console.warn('DARB: realtime session refresh failed',error.message))
        .finally(()=>{socketRefreshInProgress=false;});
    }
  });

  darbSocket.on('connect_error', error => {
    console.error('DARB realtime error:', error.message);
  });
}
  document.addEventListener('DOMContentLoaded',start);
})();

/* ======================= ESTADO ======================= */
const DEFAULT_CONSOLES = [
  {id:'c-ps4', name:'PS4', rate:1.5},
  {id:'c-ps5', name:'PS5', rate:2.5},
  {id:'c-xss', name:'Xbox Series S', rate:2},
  {id:'c-xsx', name:'Xbox Series X', rate:2.5},
  {id:'c-switch', name:'Nintendo Switch', rate:1.5},
];
const BANKS = ['Banco de Venezuela','Banesco','Mercantil','BBVA Provincial','Banco Bicentenario','BNC (Banco Nacional de Crédito)','Banco Exterior','Bancaribe','Banplus','100% Banco','Banco Activo','Bancrecer','Mi Banco','Banco Caroní','Banco Plaza','Otro'];
const DURATIONS = [0.5,1,1.5,2,2.5,3,3.5,4,5,6];
const PRODUCT_CATEGORIES = ['Consola','Videojuego','Accesorio','Repuesto','Otro'];
const PRODUCT_CONDITIONS = ['Nuevo','Usado'];
const SERVICE_STATUSES = ['Recibido','Diagnóstico','Reparación','Listo','Entregado','Cancelado'];

let state = {
  consoles: DEFAULT_CONSOLES.map(c=>({...c})),
  stations: [],
  transactions: [],
  bcv: { rate: 40, updatedAt: null, manual: true },
  products: [],
  invoices: [],
  invoiceSeq: 0,
  serviceTickets: []
};
let tab = 'estaciones';
let modal = null; // {type:'start'|'pay'|'station'|'console', ...}
let dashFilter = 'hoy';
let reportMode = 'semanal'; // 'semanal' | 'mensual'
let reportRefDate = new Date();
let saveTimer = null;
let aiInsights = null;
let aiLoading = false;
let aiError = null;

/* ======================= API / SESIÓN ======================= */
async function apiFetch(url, opts){
  opts = opts || {};
  opts.credentials = 'include';
  opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  return fetch(url, opts);
}
async function init(){
  let res;
  try{ res = await apiFetch('/api/state'); }
  catch(e){ showLogin('No se pudo conectar con el servidor.'); return; }
  if(res.status===401){ showLogin(); return; }
  if(!res.ok){ showLogin('Error del servidor al cargar los datos.'); return; }
  const data = await res.json();
  if(data){
    state = Object.assign(state, data);
    if(!state.consoles || !state.consoles.length) state.consoles = DEFAULT_CONSOLES.map(c=>({...c}));
  } else {
    persist();
  }
  render();
  fetchBcvRate(true);
  fetchAiInsights();
  setInterval(()=>{ if(tab==='estaciones') renderMain(); }, 1000);
}
function persist(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{
      const res = await apiFetch('/api/state', {method:'PUT', body: JSON.stringify(state)});
      if(res.status===401){ showLogin('Tu sesión expiró. Inicia sesión de nuevo.'); return; }
      if(!res.ok) showToast('No se pudo guardar los datos en el servidor.', true);
    }catch(e){ showToast('Sin conexión con el servidor. Los cambios no se guardaron todavía.', true); }
  }, 300);
}
function logLoggedUsage(consoleName, startTimeMs, endTimeMs){
  const d = new Date(startTimeMs);
  const date = d.toISOString().slice(0,10);
  apiFetch('/api/usage-log', {method:'POST', body: JSON.stringify({
    consoleName, date, startTime: new Date(startTimeMs).toISOString(), endTime: new Date(endTimeMs).toISOString()
  })}).catch(()=>{ /* no bloquea la operación si falla el registro de uso */ });
}
async function logout(){
  try{ await apiFetch('/api/logout', {method:'POST'}); }catch(e){}
  showLogin();
}

/* ======================= LOGIN ======================= */
function loginHtml(msg){
  const logoSrc = (document.querySelector('link[rel="icon"]')||{}).href || '';
  return `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
    <form id="login-form" class="card" style="width:100%;max-width:340px;padding:26px;">
      <div style="text-align:center;margin-bottom:18px;">
        ${logoSrc?`<img src="${logoSrc}" style="width:64px;height:64px;border-radius:14px;box-shadow:0 0 18px rgba(242,242,242,.18);margin-bottom:10px;">`:''}
        <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:17px;">DOMUS<span style="color:var(--accent);">HACK</span></div>
        <div class="muted">Acceso administrador</div>
      </div>
      ${msg?`<div style="background:var(--rose-soft);color:var(--rose);padding:9px 12px;border-radius:9px;font-size:13px;margin-bottom:14px;">${esc(msg)}</div>`:''}
      <div class="field"><label>Usuario</label><input type="text" id="login-user" autocomplete="username" required></div>
      <div class="field"><label>Contraseña</label><input type="password" id="login-pass" autocomplete="current-password" required></div>
      <button type="submit" class="btn btn-primary btn-block" id="login-btn">Ingresar</button>
    </form>
  </div>`;
}
function showLogin(msg){
  document.getElementById('app').innerHTML = loginHtml(msg);
  document.getElementById('login-form').onsubmit = async (e)=>{
    e.preventDefault();
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const btn = document.getElementById('login-btn'); btn.disabled = true; btn.textContent = 'Ingresando...';
    try{
      const res = await apiFetch('/api/login', {method:'POST', body: JSON.stringify({username, password})});
      const data = await res.json().catch(()=>({}));
      if(!res.ok){ showLogin(data.error || 'No se pudo iniciar sesión.'); return; }
      init();
    }catch(err){ showLogin('Error de conexión con el servidor.'); }
  };
}

/* ======================= ASISTENTE DE IA ======================= */
async function fetchAiInsights(){
  try{
    const res = await apiFetch('/api/ai/insights');
    if(res.ok){ aiInsights = await res.json(); }
  }catch(e){ /* sin caché disponible todavía */ }
  if(tab==='ia') renderMain();
}
async function generateAiInsights(){
  aiLoading = true; aiError = null; renderMain();
  try{
    const res = await apiFetch('/api/ai/insights/generate', {method:'POST'});
    const data = await res.json();
    if(!res.ok){ aiError = data.error || 'No se pudo generar el análisis.'; }
    else { aiInsights = data; }
  }catch(e){ aiError = 'Sin conexión con el servidor.'; }
  aiLoading = false; renderMain();
}


/* ======================= TASA BCV ======================= */
async function fetchBcvRate(silent){
  try{
    const r = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    if(!r.ok) throw new Error('bad response');
    const data = await r.json();
    const rate = data.promedio || data.venta || data.compra;
    if(!rate) throw new Error('sin tasa');
    state.bcv = { rate: Number(rate), updatedAt: Date.now(), manual:false };
    persist();
    render();
    if(!silent) showToast('Tasa BCV actualizada: '+formatBs(rate)+' Bs/$');
  }catch(e){
    if(!silent) showToast('No se pudo obtener la tasa BCV automáticamente. Puedes ingresarla manualmente en Configuración.', true);
  }
}

/* ======================= HELPERS ======================= */
function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function findConsole(id){ return state.consoles.find(c=>c.id===id); }
function findStation(id){ return state.stations.find(s=>s.id===id); }
function formatUsd(n){ const sign = n<0?'-':''; return sign+'$'+(Math.abs(Math.round(n*100)/100)).toFixed(2); }
function formatBs(n){ return (Math.round(n*100)/100).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function toBs(usd){ return usd * (state.bcv.rate||0); }
function fmtHours(h){
  if(h===0.5) return '30 min';
  if(Number.isInteger(h)) return h+' h';
  return (h)+' h';
}
/* Formatea una duración arbitraria (no necesariamente múltiplo de 30 min) */
function fmtDur(hours){
  if(hours<=0) return '0 min';
  const totalMin = Math.round(hours*60);
  const h = Math.floor(totalMin/60), m = totalMin%60;
  if(h<=0) return m+' min';
  if(m===0) return h+' h';
  return h+' h '+m+' min';
}
function formatClock(totalSeconds){
  const neg = totalSeconds < 0;
  const s = Math.abs(Math.round(totalSeconds));
  const hh = Math.floor(s/3600), mm = Math.floor((s%3600)/60), ss = s%60;
  const pad = n=>String(n).padStart(2,'0');
  const str = hh>0 ? pad(hh)+':'+pad(mm)+':'+pad(ss) : pad(mm)+':'+pad(ss);
  return (neg?'+':'')+str;
}
function consoleColor(name){
  if(/ps\d|playstation/i.test(name)) return 'var(--blue)';
  if(/xbox/i.test(name)) return 'var(--green)';
  if(/switch|nintendo/i.test(name)) return 'var(--pink)';
  return 'var(--purple)';
}
function showToast(msg, isErr){
  const el = document.createElement('div');
  el.className = 'toast'+(isErr?' err':'');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3600);
}
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Devuelve la lista de líneas de pago de una transacción, compatible con
   transacciones antiguas de un solo método (method/paymentDetails) */
function getPayments(t){
  if(t.payments) return t.payments;
  if(t.method) return [{method:t.method, amountUsd:t.costUsd, amountBs:t.costBs, details:t.paymentDetails}];
  return [];
}
const METHOD_LABELS = {pago_movil:'Pago Móvil', efectivo_bs:'Efectivo (Bs)', efectivo_usd:'Efectivo ($)', pos_debito:'Punto de venta · Débito', pos_credito:'Punto de venta · Crédito'};
function methodKey(p){
  return p.method==='efectivo' ? 'efectivo_'+p.details.currency.toLowerCase()
       : p.method==='pos' ? 'pos_'+p.details.cardType.toLowerCase()
       : 'pago_movil';
}
function computeBreakdown(txs){
  const totalUsd = txs.reduce((a,t)=>a+t.costUsd,0);
  const totalBs = txs.reduce((a,t)=>a+t.costBs,0);
  const byConsole = {};
  txs.forEach(t=>{
    byConsole[t.consoleName] = byConsole[t.consoleName] || {usd:0,bs:0,count:0};
    byConsole[t.consoleName].usd += t.costUsd;
    byConsole[t.consoleName].bs += t.costBs;
    byConsole[t.consoleName].count += 1;
  });
  const byMethod = {};
  txs.forEach(t=>{
    getPayments(t).forEach(p=>{
      const key = methodKey(p);
      byMethod[key] = byMethod[key] || {usd:0,bs:0,count:0};
      byMethod[key].usd += p.amountUsd;
      byMethod[key].bs += p.amountBs;
      byMethod[key].count += 1;
    });
  });
  return {totalUsd, totalBs, byConsole, byMethod};
}
function getWeekRange(refDate){
  const d = new Date(refDate);
  const day = (d.getDay()+6)%7; // 0 = lunes
  const monday = new Date(d); monday.setHours(0,0,0,0); monday.setDate(d.getDate()-day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6); sunday.setHours(23,59,59,999);
  return {start:monday, end:sunday};
}
function getMonthRange(refDate){
  const d = new Date(refDate);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0,0,0,0);
  const end = new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59,999);
  return {start, end};
}
function currentRange(){ return reportMode==='semanal' ? getWeekRange(reportRefDate) : getMonthRange(reportRefDate); }
function shiftRefDate(dir){
  const d = new Date(reportRefDate);
  if(reportMode==='semanal') d.setDate(d.getDate() + dir*7);
  else d.setMonth(d.getMonth() + dir);
  reportRefDate = d;
}
function rangeLabel(range){
  const opts = {day:'2-digit', month:'short'};
  if(reportMode==='semanal'){
    return range.start.toLocaleDateString('es-VE',opts)+' – '+range.end.toLocaleDateString('es-VE',opts)+' de '+range.end.getFullYear();
  }
  return range.start.toLocaleDateString('es-VE',{month:'long', year:'numeric'});
}

/* ======================= RENDER RAÍZ ======================= */
function render(){
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="sidebar">
      <div class="brand"><img src="data:image/png;base64,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" alt="DomusHack"><div class="txt">DOMUSHACK<small>VENTAS · TALLER · ALQUILER</small></div></div>
      ${navGroupLabel('Tienda')}
      ${navItem('inventario','Inventario')}
      ${navItem('ventas','Ventas')}
      ${navItem('servicio','Servicio Técnico')}
      ${navGroupLabel('Alquiler')}
      ${navItem('estaciones','Estaciones')}
      ${navItem('dashboard','Dashboard')}
      ${navItem('reportes','Reportes')}
      ${navItem('ia','Asistente IA')}
      ${navItem('historial','Historial')}
      ${navGroupLabel('')}
      ${navItem('config','Configuración')}
      <div class="sidebar-foot">
        Datos guardados en el servidor
        <div style="margin-top:8px;"><a href="#" id="btn-logout" style="color:var(--text-faint);text-decoration:underline;">Cerrar sesión</a></div>
      </div>
    </div>
    <div class="main" id="main"></div>
  `;
  [...document.querySelectorAll('.nav-item')].forEach(el=>{
    el.onclick = ()=>{ tab = el.dataset.tab; renderMain(); [...document.querySelectorAll('.nav-item')].forEach(n=>n.classList.remove('active')); el.classList.add('active'); };
  });
  document.getElementById('btn-logout').onclick = (e)=>{ e.preventDefault(); logout(); };
  renderMain();
  renderModal();
}
function navItem(id,label){
  return `<div class="nav-item ${tab===id?'active':''}" data-tab="${id}"><span class="dot"></span>${label}</div>`;
}
function navGroupLabel(text){
  if(!text) return `<div style="height:10px;"></div>`;
  return `<div style="font-size:10.5px;font-weight:700;letter-spacing:.6px;color:var(--text-faint);padding:14px 12px 6px 12px;">${text.toUpperCase()}</div>`;
}

function topbar(title){
  const updated = state.bcv.updatedAt ? new Date(state.bcv.updatedAt).toLocaleTimeString('es-VE',{hour:'2-digit',minute:'2-digit'}) : 'sin actualizar';
  return `
  <div class="topbar">
    <div class="page-title">${title}</div>
    <div class="rate-pill">
      <span class="lbl">Tasa BCV</span>
      <span class="val">${formatBs(state.bcv.rate)} Bs/$</span>
      <span class="updated">${state.bcv.manual? 'manual':'auto · '+updated}</span>
      <button id="btn-refresh-rate">↻</button>
    </div>
  </div>`;
}

function renderMain(){
  const main = document.getElementById('main');
  if(!main) return;
  if(tab==='estaciones') main.innerHTML = topbar('Estaciones') + stationsHtml();
  if(tab==='dashboard') main.innerHTML = topbar('Dashboard') + dashboardHtml();
  if(tab==='reportes') main.innerHTML = topbar('Reportes') + reportsHtml();
  if(tab==='historial') main.innerHTML = topbar('Historial') + historyHtml();
  if(tab==='config') main.innerHTML = topbar('Configuración') + configHtml();
  if(tab==='ia') main.innerHTML = topbar('Asistente IA') + aiHtml();
  if(tab==='inventario') main.innerHTML = topbar('Inventario') + inventoryHtml();
  if(tab==='ventas') main.innerHTML = topbar('Ventas') + salesHtml();
  if(tab==='servicio') main.innerHTML = topbar('Servicio Técnico') + serviceHtml();
  bindMainEvents();
}

/* ======================= ESTACIONES ======================= */
function stationsHtml(){
  if(!state.stations.length){
    return `<div class="empty">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;margin-bottom:6px;">Aún no hay estaciones</div>
      <div class="muted">Crea una estación por cada consola física disponible en el local.</div>
      <button class="btn btn-primary" id="btn-new-station">+ Crear estación</button>
    </div>`;
  }
  let cards = state.stations.map(st=>stationCardHtml(st)).join('');
  return `<div style="margin-bottom:14px;"><button class="btn btn-primary" id="btn-new-station">+ Crear estación</button></div>
          <div class="grid stations-grid">${cards}</div>`;
}

function stationCardHtml(st){
  const c = findConsole(st.consoleId) || {name:'—', rate:0};
  const color = consoleColor(c.name);
  let timerBlock = '';
  let costBlock = '';
  let actions = '';
  if(st.status==='busy' && st.session){
    const s = st.session;
    const elapsed = (Date.now()-s.startTime)/1000;
    const remaining = s.plannedHours*3600 - elapsed;
    const costUsd = s.plannedHours * c.rate;
    timerBlock = `<div class="timer ${remaining<0?'over':''}">${formatClock(remaining)}</div>
                  <div class="timer-sub">${remaining<0?'Tiempo excedido':'Restante de '+fmtHours(s.plannedHours)}</div>`;
    costBlock = `<div class="station-cost">Ya pagado: <b>${formatUsd(costUsd)}</b> · <b>${formatBs(toBs(costUsd))} Bs</b></div>`;
    actions = `
      <div class="station-actions">
        <button class="btn btn-ghost btn-sm" data-act="extend" data-id="${st.id}">Extender tiempo</button>
        <button class="btn btn-ghost btn-sm" data-act="swap" data-id="${st.id}">Cambiar consola</button>
      </div>
      <div class="station-actions" style="margin-top:8px;">
        <button class="btn btn-primary" data-act="finish" data-id="${st.id}">Finalizar</button>
      </div>
    `;
  } else {
    timerBlock = `<div class="timer" style="color:var(--text-faint);font-size:22px;">Disponible</div>`;
    actions = `
      <div class="station-actions">
        <button class="btn btn-primary" data-act="startsession" data-id="${st.id}">Iniciar sesión</button>
      </div>
    `;
  }
  return `
    <div class="card station-card">
      <div class="accent-bar" style="background:${color};"></div>
      <div class="station-head">
        <div>
          <div class="station-name">${esc(st.name)}</div>
          <span class="console-tag" style="background:${color}22;color:${color};">${esc(c.name)} · ${formatUsd(c.rate)}/h</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="status-badge ${st.status==='busy'?'busy':'free'}">${st.status==='busy'?'Ocupada':'Libre'}</span>
          ${st.status!=='busy' ? `<button class="icon-x" data-act="delstation" data-id="${st.id}" title="Eliminar estación">✕</button>` : ''}
        </div>
      </div>
      ${timerBlock}
      ${costBlock}
      ${actions}
    </div>
  `;
}

/* ======================= DASHBOARD ======================= */
function filteredTx(){
  if(dashFilter==='todo') return state.transactions;
  const start = new Date(); start.setHours(0,0,0,0);
  return state.transactions.filter(t=>t.timestamp >= start.getTime());
}
function dashboardHtml(){
  const txs = filteredTx();
  const {totalUsd, totalBs, byConsole, byMethod} = computeBreakdown(txs);
  const maxConsoleUsd = Math.max(1, ...Object.values(byConsole).map(v=>v.usd));

  const consoleRows = Object.entries(byConsole).sort((a,b)=>b[1].usd-a[1].usd).map(([name,v])=>`
    <tr>
      <td class="strong">${esc(name)}</td>
      <td>${v.count}</td>
      <td class="strong">${formatUsd(v.usd)}</td>
      <td>${formatBs(v.bs)} Bs</td>
      <td style="width:120px;"><div class="bar-track"><div class="bar-fill" style="width:${(v.usd/maxConsoleUsd*100)}%;background:${consoleColor(name)};"></div></div></td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted" style="padding:16px 10px;">Sin datos en este periodo</td></tr>`;

  const methodRows = Object.entries(byMethod).sort((a,b)=>b[1].usd-a[1].usd).map(([key,v])=>`
    <tr>
      <td class="strong">${METHOD_LABELS[key]||key}</td>
      <td>${v.count}</td>
      <td class="strong">${formatUsd(v.usd)}</td>
      <td>${formatBs(v.bs)} Bs</td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted" style="padding:16px 10px;">Sin datos en este periodo</td></tr>`;

  return `
    <div class="filter-toggle" style="margin-bottom:16px;">
      <button class="${dashFilter==='hoy'?'active':''}" data-filter="hoy">Hoy</button>
      <button class="${dashFilter==='todo'?'active':''}" data-filter="todo">Todo</button>
    </div>
    <div class="kpi-row">
      <div class="card kpi"><div class="lbl">Recaudado (USD)</div><div class="val usd">${formatUsd(totalUsd)}</div></div>
      <div class="card kpi"><div class="lbl">Recaudado (Bolívares)</div><div class="val bs">${formatBs(totalBs)} Bs</div></div>
      <div class="card kpi"><div class="lbl">Sesiones cobradas</div><div class="val">${txs.length}</div></div>
      <div class="card kpi"><div class="lbl">Estaciones activas</div><div class="val">${state.stations.filter(s=>s.status==='busy').length} / ${state.stations.length}</div></div>
    </div>

    <div class="section-title">Por consola</div>
    <div class="card" style="padding:6px 4px;">
      <table><thead><tr><th>Consola</th><th>Sesiones</th><th>USD</th><th>Bolívares</th><th></th></tr></thead>
      <tbody>${consoleRows}</tbody></table>
    </div>

    <div class="section-title">Por método de pago</div>
    <div class="card" style="padding:6px 4px;">
      <table><thead><tr><th>Método</th><th>Sesiones</th><th>USD</th><th>Bolívares</th></tr></thead>
      <tbody>${methodRows}</tbody></table>
    </div>
  `;
}

function paymentLineLabel(p){
  return p.method==='pago_movil' ? 'Pago Móvil'
    : p.method==='efectivo' ? 'Efectivo ('+ (p.details.currency==='USD'?'$':'Bs') +')'
    : 'POS · '+(p.details.cardType==='debito'?'Débito':'Crédito');
}
function paymentLineDetail(p){
  if(p.method==='pago_movil') return `${esc(p.details.bank)} · ${esc(p.details.phone)} · ref ${esc(p.details.reference)} · ${formatBs(p.amountBs)} Bs`;
  if(p.method==='efectivo') return `Recibido: ${p.details.currency==='USD'?formatUsd(p.details.amount):formatBs(p.details.amount)+' Bs'}`;
  return `Facturado: ${formatBs(p.details.amountBs)} Bs`;
}
/* ======================= HISTORIAL ======================= */
function historyHtml(){
  const txs = [...state.transactions].sort((a,b)=>b.timestamp-a.timestamp);
  if(!txs.length) return `<div class="empty">Todavía no se ha registrado ningún cobro.</div>`;
  const rows = txs.map(t=>{
    const payments = getPayments(t);
    const isMixed = payments.length > 1;
    const methodLabel = isMixed ? 'Pago mixto ('+payments.length+')' : paymentLineLabel(payments[0]||{method:'—',details:{}});
    const detail = payments.map(p=> (isMixed? paymentLineLabel(p)+' — ':'') + paymentLineDetail(p)).join(isMixed? '<br>' : '');
    return `<tr>
      <td>${new Date(t.timestamp).toLocaleString('es-VE',{dateStyle:'short',timeStyle:'short'})}</td>
      <td class="strong">${esc(t.stationName)}${t.type==='extension'?' <span class="muted">(extensión)</span>':t.type==='swap'?' <span class="muted">(cambio de consola)</span>':''}</td>
      <td>${t.type==='swap' ? esc(t.swapFrom)+' → '+esc(t.swapTo) : esc(t.consoleName)}</td>
      <td>${fmtDur(t.plannedHours)}</td>
      <td class="strong">${formatUsd(t.costUsd)}</td>
      <td>${formatBs(t.costBs)} Bs</td>
      <td>${payments.length? methodLabel+'<div class="muted">'+detail+'</div>' : '<span class="muted">Sin ajuste monetario</span>'}</td>
      <td><button class="icon-x" data-act="deltx" data-id="${t.id}" title="Eliminar registro">✕</button></td>
    </tr>`;
  }).join('');
  return `<div class="card" style="padding:6px 4px;overflow-x:auto;">
    <table><thead><tr><th>Fecha</th><th>Estación</th><th>Consola</th><th>Tiempo</th><th>USD</th><th>Bs</th><th>Pago</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
}

/* ======================= REPORTES ======================= */
function reportsHtml(){
  const range = currentRange();
  const txs = state.transactions.filter(t=> t.timestamp>=range.start.getTime() && t.timestamp<=range.end.getTime());
  const {totalUsd, totalBs, byConsole, byMethod} = computeBreakdown(txs);
  const maxConsoleUsd = Math.max(1, ...Object.values(byConsole).map(v=>v.usd));

  const consoleRows = Object.entries(byConsole).sort((a,b)=>b[1].usd-a[1].usd).map(([name,v])=>`
    <tr>
      <td class="strong">${esc(name)}</td>
      <td>${v.count}</td>
      <td class="strong">${formatUsd(v.usd)}</td>
      <td>${formatBs(v.bs)} Bs</td>
      <td style="width:120px;"><div class="bar-track"><div class="bar-fill" style="width:${(v.usd/maxConsoleUsd*100)}%;background:${consoleColor(name)};"></div></div></td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted" style="padding:16px 10px;">Sin datos en este periodo</td></tr>`;

  const methodRows = Object.entries(byMethod).sort((a,b)=>b[1].usd-a[1].usd).map(([key,v])=>`
    <tr>
      <td class="strong">${METHOD_LABELS[key]||key}</td>
      <td>${v.count}</td>
      <td class="strong">${formatUsd(v.usd)}</td>
      <td>${formatBs(v.bs)} Bs</td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted" style="padding:16px 10px;">Sin datos en este periodo</td></tr>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
      <div class="filter-toggle">
        <button class="${reportMode==='semanal'?'active':''}" data-repmode="semanal">Semanal</button>
        <button class="${reportMode==='mensual'?'active':''}" data-repmode="mensual">Mensual</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <button class="btn btn-ghost btn-sm" id="btn-rep-prev">‹</button>
        <div class="muted" style="min-width:170px;text-align:center;text-transform:capitalize;">${rangeLabel(range)}</div>
        <button class="btn btn-ghost btn-sm" id="btn-rep-next">›</button>
        <button class="btn btn-primary btn-sm" id="btn-rep-export">⬇ Exportar a Excel</button>
      </div>
    </div>

    <div class="kpi-row">
      <div class="card kpi"><div class="lbl">Recaudado (USD)</div><div class="val usd">${formatUsd(totalUsd)}</div></div>
      <div class="card kpi"><div class="lbl">Recaudado (Bolívares)</div><div class="val bs">${formatBs(totalBs)} Bs</div></div>
      <div class="card kpi"><div class="lbl">Cobros registrados</div><div class="val">${txs.length}</div></div>
    </div>

    <div class="section-title">Ingresos por consola</div>
    <div class="card" style="padding:6px 4px;">
      <table><thead><tr><th>Consola</th><th>Sesiones</th><th>USD</th><th>Bolívares</th><th></th></tr></thead>
      <tbody>${consoleRows}</tbody></table>
    </div>

    <div class="section-title">Ingresos por método de pago</div>
    <div class="card" style="padding:6px 4px;">
      <table><thead><tr><th>Método</th><th>Pagos</th><th>USD</th><th>Bolívares</th></tr></thead>
      <tbody>${methodRows}</tbody></table>
    </div>
  `;
}

function exportReportExcel(){
  if(typeof XLSX==='undefined'){ showToast('No se pudo cargar el módulo de exportación (revisa tu conexión a internet).', true); return; }
  const range = currentRange();
  const txs = state.transactions.filter(t=> t.timestamp>=range.start.getTime() && t.timestamp<=range.end.getTime());
  const {totalUsd, totalBs, byConsole, byMethod} = computeBreakdown(txs);

  const wb = XLSX.utils.book_new();

  const resumen = [
    ['DomusHack — Reporte '+(reportMode==='semanal'?'semanal':'mensual')],
    ['Periodo', rangeLabel(range)],
    [],
    ['Total recaudado (USD)', Number(totalUsd.toFixed(2))],
    ['Total recaudado (Bs)', Number(totalBs.toFixed(2))],
    ['Cobros registrados', txs.length],
    ['Tasa BCV usada al exportar', state.bcv.rate],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');

  const consoleSheet = [['Consola','Sesiones','USD','Bs']].concat(
    Object.entries(byConsole).sort((a,b)=>b[1].usd-a[1].usd).map(([name,v])=>[name, v.count, Number(v.usd.toFixed(2)), Number(v.bs.toFixed(2))])
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(consoleSheet), 'Por consola');

  const methodSheet = [['Método de pago','Pagos','USD','Bs']].concat(
    Object.entries(byMethod).sort((a,b)=>b[1].usd-a[1].usd).map(([key,v])=>[METHOD_LABELS[key]||key, v.count, Number(v.usd.toFixed(2)), Number(v.bs.toFixed(2))])
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(methodSheet), 'Por método de pago');

  const txSheet = [['Fecha','Estación','Consola','Tipo','Tiempo (h)','USD','Bs','Métodos de pago']].concat(
    txs.sort((a,b)=>a.timestamp-b.timestamp).map(t=>[
      new Date(t.timestamp).toLocaleString('es-VE'),
      t.stationName, t.consoleName,
      t.type==='extension' ? 'Extensión' : t.type==='swap' ? 'Cambio de consola' : 'Sesión',
      t.plannedHours, Number(t.costUsd.toFixed(2)), Number(t.costBs.toFixed(2)),
      getPayments(t).map(p=>paymentLineLabel(p)+' '+formatUsd(p.amountUsd)).join(' + ')
    ])
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(txSheet), 'Transacciones');

  const fname = 'argame-reporte-'+reportMode+'-'+range.start.toISOString().slice(0,10)+'.xlsx';
  XLSX.writeFile(wb, fname);
}

/* ======================= ASISTENTE DE IA ======================= */
function aiHtml(){
  const card = (label, text) => `
    <div class="card" style="padding:18px;margin-bottom:14px;">
      <div class="section-title" style="margin:0 0 8px 0;">${label}</div>
      <div style="line-height:1.55;">${esc(text)}</div>
    </div>`;
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px;">
      <div class="muted" style="max-width:520px;">
        Analiza automáticamente el registro de uso de los últimos 7 días (consola, fecha, hora de inicio y fin)
        para detectar patrones, sugerir un horario de torneo y una idea de fidelización.
      </div>
      <button class="btn btn-primary" id="btn-ai-generate" ${aiLoading?'disabled':''}>${aiLoading?'Analizando…':'Generar / Actualizar análisis'}</button>
    </div>`;

  if(aiError){
    return header + `<div class="card" style="padding:16px;color:var(--rose);background:var(--rose-soft);border:none;">${esc(aiError)}</div>`;
  }
  if(aiLoading){
    return header + `<div class="empty">Consultando al asistente de IA, esto puede tardar unos segundos…</div>`;
  }
  if(!aiInsights){
    return header + `<div class="empty">Aún no se ha generado ningún análisis. Usa el botón de arriba (se necesitan al menos algunas sesiones registradas en los últimos 7 días).</div>`;
  }
  const meta = `<div class="muted" style="margin-bottom:16px;">Basado en ${aiInsights.records_analyzed} sesiones registradas · generado ${new Date(aiInsights.generated_at).toLocaleString('es-VE')}</div>`;
  return header + meta
    + card('📅 Día y franja de mayor actividad', aiInsights.busiest_slot)
    + card('🏆 Horario sugerido para un torneo', aiInsights.tournament_suggestion)
    + card('🎁 Idea de fidelización sugerida', aiInsights.loyalty_idea);
}

/* ======================= INVENTARIO ======================= */
function inventoryHtml(){
  const rows = state.products.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{
    const low = p.qty<=2;
    return `<tr>
      <td>${esc(p.sku||'—')}</td>
      <td class="strong">${esc(p.name)}</td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.condition||'—')}</td>
      <td>${formatUsd(p.costUsd||0)}</td>
      <td class="strong">${formatUsd(p.priceUsd)}</td>
      <td style="color:${low?'var(--rose)':'inherit'};font-weight:${low?'700':'400'};">${p.qty}${low?' ⚠':''}</td>
      <td>
        <button class="icon-x" data-act="editproduct" data-id="${p.id}" title="Editar">✎</button>
        <button class="icon-x" data-act="delproduct" data-id="${p.id}" title="Eliminar">✕</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="muted" style="padding:16px 10px;">Sin productos en el inventario todavía.</td></tr>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
      <div class="muted">${state.products.length} producto(s) · ${state.products.reduce((a,p)=>a+p.qty,0)} unidades en stock</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="btn-inv-template">⬇ Plantilla Excel</button>
        <button class="btn btn-ghost btn-sm" id="btn-inv-import">⬆ Importar desde Excel</button>
        <button class="btn btn-primary btn-sm" id="btn-inv-new">+ Agregar producto</button>
      </div>
    </div>
    <input type="file" id="inv-file-input" accept=".xlsx,.xls,.csv" style="display:none;">
    <div class="card" style="padding:6px 4px;overflow-x:auto;">
      <table><thead><tr><th>SKU</th><th>Nombre</th><th>Categoría</th><th>Condición</th><th>Costo</th><th>Precio</th><th>Stock</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  `;
}

function downloadInventoryTemplate(){
  if(typeof XLSX==='undefined'){ showToast('No se pudo cargar el módulo de Excel.', true); return; }
  const rows = [
    ['sku','nombre','categoria','condicion','costo','precio','cantidad'],
    ['PS5-001','PlayStation 5 Slim 1TB','Consola','Nuevo', 380, 480, 2],
    ['GTA5-PS5','GTA V (PS5)','Videojuego','Usado', 15, 25, 5],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Inventario');
  XLSX.writeFile(wb, 'plantilla-inventario-domushack.xlsx');
}

function pickHeaderValue(row, keys){
  const lowerMap = {};
  Object.keys(row).forEach(k=>{ lowerMap[String(k).trim().toLowerCase()] = row[k]; });
  for(const k of keys){ if(lowerMap[k]!==undefined && lowerMap[k]!=='') return lowerMap[k]; }
  return undefined;
}

function openImportModal(parsedRows){
  const mapped = parsedRows.map(r=>{
    const name = pickHeaderValue(r, ['nombre','name','producto','descripcion']);
    const sku = pickHeaderValue(r, ['sku','codigo','código']);
    const category = pickHeaderValue(r, ['categoria','categoría','category','tipo']) || 'Otro';
    const condition = pickHeaderValue(r, ['condicion','condición','condition','estado']) || 'Nuevo';
    const cost = Number(pickHeaderValue(r, ['costo','cost','costo_usd'])) || 0;
    const price = Number(pickHeaderValue(r, ['precio','price','precio_usd','venta'])) || 0;
    const qty = Number(pickHeaderValue(r, ['cantidad','qty','stock','existencia'])) || 0;
    return { name: name?String(name).trim():'', sku: sku?String(sku).trim():'', category:String(category).trim(), condition:String(condition).trim(), costUsd:cost, priceUsd:price, qty };
  });
  const valid = mapped.filter(r=>r.name);
  const invalidCount = mapped.length - valid.length;

  const rowsHtml = valid.slice(0,200).map(r=>`
    <tr><td>${esc(r.sku||'—')}</td><td>${esc(r.name)}</td><td>${esc(r.category)}</td><td>${esc(r.condition)}</td><td>${formatUsd(r.costUsd)}</td><td>${formatUsd(r.priceUsd)}</td><td>${r.qty}</td></tr>
  `).join('');

  modal = {
    html: `<div class="modal wide">
      <div class="modal-head"><div class="modal-title">Confirmar importación</div><button class="close-x" id="m-close">✕</button></div>
      <div class="muted" style="margin-bottom:12px;">
        ${valid.length} producto(s) listos para importar${invalidCount?` · ${invalidCount} fila(s) ignoradas (sin nombre)`:''}.
        Si el SKU coincide con un producto existente, se sumará la cantidad y se actualizará el precio; si no, se creará un producto nuevo.
      </div>
      <div class="card" style="padding:6px 4px;max-height:320px;overflow:auto;">
        <table><thead><tr><th>SKU</th><th>Nombre</th><th>Categoría</th><th>Condición</th><th>Costo</th><th>Precio</th><th>Cant.</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" class="muted" style="padding:14px;">No se encontraron filas válidas.</td></tr>'}</tbody></table>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save" ${!valid.length?'disabled':''}>Importar ${valid.length} producto(s)</button>
      </div>
    </div>`,
    bind(){
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-save').onclick = ()=>{
        valid.forEach(r=>{
          const existing = r.sku ? state.products.find(p=>p.sku && p.sku.toLowerCase()===r.sku.toLowerCase()) : null;
          if(existing){
            existing.qty += r.qty;
            existing.priceUsd = r.priceUsd || existing.priceUsd;
            existing.costUsd = r.costUsd || existing.costUsd;
            existing.category = r.category || existing.category;
            existing.condition = r.condition || existing.condition;
          } else {
            state.products.push({ id: uid(), sku: r.sku, name: r.name, category: r.category, condition: r.condition, costUsd: r.costUsd, priceUsd: r.priceUsd, qty: r.qty, notes:'' });
          }
        });
        persist(); closeModal(); renderMain();
        showToast('Inventario actualizado desde Excel.');
      };
    }
  };
  renderModal();
}

function openProductModal(productId){
  const existing = productId ? state.products.find(p=>p.id===productId) : null;
  modal = {
    html: `<div class="modal">
      <div class="modal-head"><div class="modal-title">${existing?'Editar producto':'Nuevo producto'}</div><button class="close-x" id="m-close">✕</button></div>
      <div class="field"><label>Nombre</label><input type="text" id="p-name" value="${existing?esc(existing.name):''}" placeholder="Ej. PlayStation 5 Slim 1TB"></div>
      <div class="field"><label>SKU / código (opcional)</label><input type="text" id="p-sku" value="${existing?esc(existing.sku||''):''}"></div>
      <div class="field"><label>Categoría</label><select id="p-category">${PRODUCT_CATEGORIES.map(c=>`<option ${existing&&existing.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Condición</label><select id="p-condition">${PRODUCT_CONDITIONS.map(c=>`<option ${existing&&existing.condition===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Costo (USD)</label><input type="number" step="0.01" min="0" id="p-cost" value="${existing?existing.costUsd:0}"></div>
      <div class="field"><label>Precio de venta (USD)</label><input type="number" step="0.01" min="0" id="p-price" value="${existing?existing.priceUsd:0}"></div>
      <div class="field"><label>Cantidad en stock</label><input type="number" step="1" min="0" id="p-qty" value="${existing?existing.qty:0}"></div>
      <div class="field"><label>Notas (opcional)</label><input type="text" id="p-notes" value="${existing?esc(existing.notes||''):''}"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">${existing?'Guardar':'Agregar'}</button>
      </div>
    </div>`,
    bind(){
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-save').onclick = ()=>{
        const name = document.getElementById('p-name').value.trim();
        if(!name){ showToast('El nombre es obligatorio.', true); return; }
        const data = {
          name,
          sku: document.getElementById('p-sku').value.trim(),
          category: document.getElementById('p-category').value,
          condition: document.getElementById('p-condition').value,
          costUsd: parseFloat(document.getElementById('p-cost').value)||0,
          priceUsd: parseFloat(document.getElementById('p-price').value)||0,
          qty: parseInt(document.getElementById('p-qty').value,10)||0,
          notes: document.getElementById('p-notes').value.trim()
        };
        if(existing){ Object.assign(existing, data); }
        else { state.products.push({ id: uid(), ...data }); }
        persist(); closeModal(); renderMain();
      };
    }
  };
  renderModal();
}

/* ======================= VENTAS / FACTURACIÓN ======================= */
function salesHtml(){
  const invs = state.invoices.slice().sort((a,b)=>b.timestamp-a.timestamp);
  const rows = invs.map(inv=>`
    <tr>
      <td>#${inv.number}</td>
      <td>${new Date(inv.timestamp).toLocaleString('es-VE',{dateStyle:'short',timeStyle:'short'})}</td>
      <td>${esc(inv.customerName||'Consumidor final')}</td>
      <td>${inv.items.length} ítem(s)</td>
      <td class="strong">${formatUsd(inv.totalUsd)}</td>
      <td>${formatBs(inv.totalBs)} Bs</td>
      <td><button class="btn btn-ghost btn-sm" data-act="viewinvoice" data-id="${inv.id}">Ver / Imprimir</button></td>
    </tr>`).join('') || `<tr><td colspan="7" class="muted" style="padding:16px 10px;">Aún no se han registrado ventas.</td></tr>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div class="muted">${invs.length} venta(s) registradas</div>
      <button class="btn btn-primary" id="btn-sale-new">+ Nueva venta</button>
    </div>
    <div class="card" style="padding:6px 4px;overflow-x:auto;">
      <table><thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Ítems</th><th>USD</th><th>Bs</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  `;
}

function openSaleModal(prefill){
  prefill = prefill || {};
  const round2 = n => Math.round(n*100)/100;
  let customerName = prefill.customerName || '';
  let customerPhone = prefill.customerPhone || '';
  let cart = prefill.items ? prefill.items.map(it=>({...it})) : [];
  let selProduct = (state.products.find(p=>p.qty>0)||{}).id || '';
  let selQty = 1;
  let ti = { desc:'', value:0, addInv:false, category:'Consola', condition:'Usado', qty:1 };
  let lineSeq = 0;
  let lines = [];

  function subtotalUsd(){ return cart.reduce((s,l)=>s+l.lineTotalUsd,0); }
  function lineUsd(l){ return (l.method==='efectivo' && l.currency==='USD') ? (l.amount||0) : (l.amount||0)/(state.bcv.rate||1); }
  function coveredUsd(){ return lines.reduce((s,l)=>s+lineUsd(l),0); }
  function defaultLine(amountBs){ return {id:lineSeq++, method:'pago_movil', currency:'Bs', amount: round2(amountBs), cardType:'debito', phone:'', reference:'', bank:BANKS[0]}; }
  function resetLines(){ const target = Math.abs(subtotalUsd()); lineSeq=0; lines = target>0.01 ? [defaultLine(toBs(target))] : []; }
  resetLines();

  function cartRowsHtml(){
    if(!cart.length) return `<div class="muted" style="padding:10px 0;">Aún no has agregado productos.</div>`;
    return `<table style="margin-bottom:10px;"><thead><tr><th>Ítem</th><th>Cant.</th><th>Precio</th><th>Total</th><th></th></tr></thead><tbody>
      ${cart.map((l,i)=>`<tr>
        <td>${esc(l.name)}${l.kind==='tradein'?' <span class="muted">(cambio)</span>':''}</td>
        <td>${l.qty}</td>
        <td>${formatUsd(l.unitPriceUsd)}</td>
        <td class="strong">${formatUsd(l.lineTotalUsd)}</td>
        <td><button class="icon-x" data-cartremove="${i}">✕</button></td>
      </tr>`).join('')}
    </tbody></table>`;
  }
  function productOptionsHtml(){
    const avail = state.products.filter(p=>p.qty>0);
    if(!avail.length) return `<option value="">— sin stock disponible —</option>`;
    return avail.map(p=>`<option value="${p.id}" ${p.id===selProduct?'selected':''}>${esc(p.name)} · ${formatUsd(p.priceUsd)} · stock ${p.qty}</option>`).join('');
  }
  function lineFieldsHtml(l){
    if(l.method==='pago_movil'){
      return `
        <div class="field"><label>Teléfono</label><input type="text" data-f="phone" value="${esc(l.phone)}" placeholder="0412-1234567"></div>
        <div class="field"><label>Referencia (últimos 6 dígitos)</label><input type="text" maxlength="6" data-f="reference" value="${esc(l.reference)}" placeholder="123456"></div>
        <div class="field"><label>Banco</label><select data-f="bank">${BANKS.map(b=>`<option ${b===l.bank?'selected':''}>${b}</option>`).join('')}</select></div>
        <div class="field"><label>Monto (Bs)</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
      `;
    }
    if(l.method==='efectivo'){
      return `
        <div class="field"><label>Moneda</label>
          <div class="seg" data-segfor="currency">
            <button data-v="Bs" class="${l.currency==='Bs'?'active':''}">Bolívares</button>
            <button data-v="USD" class="${l.currency==='USD'?'active':''}">Dólares</button>
          </div>
        </div>
        <div class="field"><label>Monto (${l.currency==='USD'?'$':'Bs'})</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
      `;
    }
    return `
      <div class="field"><label>Tipo de tarjeta</label>
        <div class="seg" data-segfor="cardType">
          <button data-v="debito" class="${l.cardType==='debito'?'active':''}">Débito</button>
          <button data-v="credito" class="${l.cardType==='credito'?'active':''}">Crédito</button>
        </div>
      </div>
      <div class="field"><label>Monto (Bs)</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
    `;
  }
  function lineBlockHtml(l){
    return `<div class="card" style="padding:12px;margin-bottom:10px;background:var(--surface-2);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <div class="paytabs" style="flex:1;margin-bottom:0;" data-methodfor="${l.id}">
          <button data-v="pago_movil" class="${l.method==='pago_movil'?'active':''}">Pago Móvil</button>
          <button data-v="efectivo" class="${l.method==='efectivo'?'active':''}">Efectivo</button>
          <button data-v="pos" class="${l.method==='pos'?'active':''}">Punto de venta</button>
        </div>
        ${lines.length>1?`<button class="icon-x" data-removeline="${l.id}">✕</button>`:''}
      </div>
      <div data-fieldswrap="${l.id}">${lineFieldsHtml(l)}</div>
    </div>`;
  }
  function summaryHtml(){
    const total = subtotalUsd();
    let settleLine;
    if(total>0.01) settleLine = `<div class="summary-row" style="color:var(--rose);"><span>Total a cobrar</span><b>${formatUsd(total)} · ${formatBs(toBs(total))} Bs</b></div>`;
    else if(total<-0.01) settleLine = `<div class="summary-row" style="color:var(--mint);"><span>Se debe entregar al cliente</span><b>${formatUsd(-total)} · ${formatBs(-toBs(total))} Bs</b></div>`;
    else settleLine = `<div class="summary-row"><span>Total</span><b>${formatUsd(0)}</b></div>`;
    let coverLine = '';
    if(Math.abs(total)>0.01){
      const remaining = Math.abs(total) - coveredUsd();
      if(remaining>0.01) coverLine = `<div class="summary-row" style="color:var(--rose);"><span>Falta por ${total>0?'cobrar':'entregar'}</span><b>${formatUsd(remaining)} · ${formatBs(toBs(remaining))} Bs</b></div>`;
      else if(remaining<-0.01) coverLine = `<div class="summary-row" style="color:var(--mint);"><span>Sobra (vuelto)</span><b>${formatUsd(-remaining)} · ${formatBs(toBs(-remaining))} Bs</b></div>`;
      else coverLine = `<div class="summary-row" style="color:var(--mint);"><span>Cubierto completamente ✓</span><span></span></div>`;
    }
    return `${settleLine}${coverLine}`;
  }

  function build(){
    const total = subtotalUsd();
    const needsSettle = Math.abs(total) > 0.01;
    return `<div class="modal wide">
      <div class="modal-head"><div class="modal-title">Nueva venta</div><button class="close-x" id="m-close">✕</button></div>
      <div class="field"><label>Cliente (opcional)</label><input type="text" id="s-cname" value="${esc(customerName)}" placeholder="Nombre del cliente"></div>
      <div class="field"><label>Teléfono (opcional)</label><input type="text" id="s-cphone" value="${esc(customerPhone)}"></div>

      <div class="section-title" style="margin:14px 0 8px 0;">Productos</div>
      ${cartRowsHtml()}
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
        <div class="field" style="flex:2;min-width:200px;margin-bottom:0;"><label>Producto</label><select id="s-product">${productOptionsHtml()}</select></div>
        <div class="field" style="flex:0 0 80px;margin-bottom:0;"><label>Cant.</label><input type="number" min="1" step="1" id="s-qty" value="${selQty}"></div>
        <button class="btn btn-ghost" id="s-addproduct">+ Agregar</button>
      </div>

      <div class="section-title" style="margin:14px 0 8px 0;">Cambio / trade-in (opcional)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
        <div class="field" style="flex:2;min-width:180px;margin-bottom:0;"><label>Descripción</label><input type="text" id="ti-desc" value="${esc(ti.desc)}" placeholder="Ej. PS4 usada recibida en parte de pago"></div>
        <div class="field" style="flex:0 0 120px;margin-bottom:0;"><label>Valor acreditado (USD)</label><input type="number" step="0.01" min="0" id="ti-value" value="${ti.value}"></div>
        <button class="btn btn-ghost" id="ti-add">+ Aplicar cambio</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-dim);margin-bottom:16px;">
        <input type="checkbox" id="ti-addinv" ${ti.addInv?'checked':''}> Agregar este artículo al inventario al confirmar la venta
      </label>
      ${ti.addInv ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
          <div class="field" style="margin-bottom:0;"><label>Categoría</label><select id="ti-category">${PRODUCT_CATEGORIES.map(c=>`<option ${ti.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
          <div class="field" style="margin-bottom:0;"><label>Condición</label><select id="ti-condition">${PRODUCT_CONDITIONS.map(c=>`<option ${ti.condition===c?'selected':''}>${c}</option>`).join('')}</select></div>
        </div>
      `:''}

      <div class="summary-box" id="m-summary">${summaryHtml()}</div>
      ${needsSettle ? `
        <div id="m-lines">${lines.map(l=>lineBlockHtml(l)).join('')}</div>
        <button class="btn btn-ghost btn-sm btn-block" id="m-addline" style="margin-bottom:14px;">+ Agregar otro método (mixto)</button>
      `:''}
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save" ${!cart.length?'disabled':''}>Registrar venta</button>
      </div>
    </div>`;
  }

  modal = {
    html: build(),
    bind(){
      const refresh = ()=>{ modal.html = build(); renderModal(); };
      const refreshCore = ()=>{ resetLines(); refresh(); };

      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('s-cname').onchange = e=>{ customerName = e.target.value; };
      document.getElementById('s-cphone').onchange = e=>{ customerPhone = e.target.value; };
      document.getElementById('s-product').onchange = e=>{ selProduct = e.target.value; };
      document.getElementById('s-qty').onchange = e=>{ selQty = Math.max(1, parseInt(e.target.value,10)||1); };
      document.getElementById('s-addproduct').onclick = ()=>{
        const p = state.products.find(x=>x.id===selProduct);
        if(!p){ showToast('Selecciona un producto con stock.', true); return; }
        if(selQty>p.qty){ showToast('No hay suficiente stock de ese producto.', true); return; }
        const existingLine = cart.find(l=>l.kind==='product' && l.productId===p.id);
        if(existingLine){ existingLine.qty += selQty; existingLine.lineTotalUsd = round2(existingLine.qty*existingLine.unitPriceUsd); }
        else cart.push({ kind:'product', productId:p.id, name:p.name, qty:selQty, unitPriceUsd:p.priceUsd, lineTotalUsd: round2(selQty*p.priceUsd) });
        selQty = 1;
        refreshCore();
      };
      document.getElementById('ti-desc').onchange = e=>{ ti.desc = e.target.value; };
      document.getElementById('ti-value').onchange = e=>{ ti.value = parseFloat(e.target.value)||0; };
      document.getElementById('ti-add').onclick = ()=>{
        if(!ti.desc.trim()){ showToast('Describe el artículo recibido en el cambio.', true); return; }
        if(!(ti.value>0)){ showToast('Ingresa el valor acreditado por el cambio.', true); return; }
        cart.push({ kind:'tradein', name:ti.desc.trim(), qty:1, unitPriceUsd:-ti.value, lineTotalUsd:-ti.value, addInv: ti.addInv, category: ti.category, condition: ti.condition });
        ti = { desc:'', value:0, addInv:false, category:'Consola', condition:'Usado', qty:1 };
        refreshCore();
      };
      document.getElementById('ti-addinv').onchange = e=>{ ti.addInv = e.target.checked; refresh(); };
      if(document.getElementById('ti-category')) document.getElementById('ti-category').onchange = e=>{ ti.category = e.target.value; };
      if(document.getElementById('ti-condition')) document.getElementById('ti-condition').onchange = e=>{ ti.condition = e.target.value; };
      [...document.querySelectorAll('[data-cartremove]')].forEach(b=>{
        b.onclick = ()=>{ cart.splice(Number(b.dataset.cartremove),1); refreshCore(); };
      });

      if(document.getElementById('m-addline')){
        document.getElementById('m-addline').onclick = ()=>{
          const target = Math.abs(subtotalUsd());
          const remainingUsd = Math.max(0, target - coveredUsd());
          lines.push(defaultLine(toBs(remainingUsd)));
          refresh();
        };
      }
      [...document.querySelectorAll('[data-methodfor]')].forEach(segEl=>{
        const id = Number(segEl.dataset.methodfor);
        [...segEl.querySelectorAll('button')].forEach(b=>{
          b.onclick = ()=>{
            const line = lines.find(x=>x.id===id);
            const preUsd = lineUsd(line);
            line.method = b.dataset.v;
            if(line.method==='efectivo') line.currency='Bs';
            if(line.method==='pos') line.cardType='debito';
            const otherUsd = coveredUsd() - preUsd;
            const target = Math.abs(subtotalUsd());
            const remainingExcl = Math.max(0, target - otherUsd);
            line.amount = round2( (line.method==='efectivo' && line.currency==='USD') ? remainingExcl : toBs(remainingExcl) );
            refresh();
          };
        });
      });
      [...document.querySelectorAll('[data-removeline]')].forEach(b=>{
        b.onclick = ()=>{ lines = lines.filter(l=>l.id!==Number(b.dataset.removeline)); refresh(); };
      });
      [...document.querySelectorAll('[data-fieldswrap]')].forEach(wrap=>{
        const id = Number(wrap.dataset.fieldswrap);
        const line = lines.find(x=>x.id===id);
        const phoneInp = wrap.querySelector('[data-f="phone"]');
        if(phoneInp) phoneInp.onchange = e=>{ line.phone = e.target.value; };
        const refInp = wrap.querySelector('[data-f="reference"]');
        if(refInp) refInp.onchange = e=>{ line.reference = e.target.value; };
        const bankSel = wrap.querySelector('[data-f="bank"]');
        if(bankSel) bankSel.onchange = e=>{ line.bank = e.target.value; };
        const amountInp = wrap.querySelector('[data-f="amount"]');
        if(amountInp) amountInp.onchange = e=>{ line.amount = parseFloat(e.target.value)||0; refresh(); };
        const curSeg = wrap.querySelector('[data-segfor="currency"]');
        if(curSeg){
          [...curSeg.querySelectorAll('button')].forEach(b=>{
            b.onclick = ()=>{
              const preUsd = lineUsd(line);
              line.currency = b.dataset.v;
              const otherUsd = coveredUsd() - preUsd;
              const target = Math.abs(subtotalUsd());
              const remainingExcl = Math.max(0, target - otherUsd);
              line.amount = round2( line.currency==='USD' ? remainingExcl : toBs(remainingExcl) );
              refresh();
            };
          });
        }
        const cardSeg = wrap.querySelector('[data-segfor="cardType"]');
        if(cardSeg){
          [...cardSeg.querySelectorAll('button')].forEach(b=>{ b.onclick = ()=>{ line.cardType = b.dataset.v; refresh(); }; });
        }
      });

      document.getElementById('m-save').onclick = ()=>{
        if(!cart.length){ showToast('Agrega al menos un producto.', true); return; }
        const total = subtotalUsd();
        if(Math.abs(total)>0.01){
          for(const l of lines){
            if(l.method==='pago_movil' && (!l.phone.trim() || l.reference.trim().length!==6)){
              showToast('Revisa el teléfono y que la referencia tenga 6 dígitos en Pago Móvil.', true); return;
            }
            if(!(l.amount>=0)){ showToast('Ingresa montos válidos en cada método.', true); return; }
          }
          const target = Math.abs(total);
          const remaining = target - coveredUsd();
          if(remaining > 0.02){ showToast('Los montos ingresados no cubren el total. Falta '+formatUsd(remaining)+'.', true); return; }
        }
        const sign = total<0 ? -1 : 1;
        const payments = lines.filter(l=>l.amount>0).map(l=>{
          const amountUsd = lineUsd(l)*sign;
          const amountBsRaw = (l.method==='efectivo' && l.currency==='USD') ? toBs(l.amount) : l.amount;
          const amountBs = amountBsRaw*sign;
          let details = {};
          if(l.method==='pago_movil') details = {phone:l.phone.trim(), reference:l.reference.trim(), bank:l.bank};
          else if(l.method==='efectivo') details = {currency:l.currency, amount:l.amount};
          else details = {cardType:l.cardType, amountBs:l.amount};
          return {method:l.method, amountUsd, amountBs, details};
        });

        // descuenta stock de productos vendidos
        cart.filter(l=>l.kind==='product').forEach(l=>{
          const p = state.products.find(x=>x.id===l.productId);
          if(p) p.qty = Math.max(0, p.qty - l.qty);
        });
        // agrega al inventario los cambios marcados
        cart.filter(l=>l.kind==='tradein' && l.addInv).forEach(l=>{
          state.products.push({ id: uid(), sku:'', name:l.name, category:l.category, condition:l.condition, costUsd: Math.abs(l.unitPriceUsd), priceUsd: Math.abs(l.unitPriceUsd), qty:1, notes:'Recibido en cambio' });
        });

        state.invoiceSeq = (state.invoiceSeq||0) + 1;
        const invoice = {
          id: uid(), number: state.invoiceSeq, timestamp: Date.now(),
          customerName: customerName.trim(), customerPhone: customerPhone.trim(),
          items: cart, subtotalUsd: total, totalUsd: total, totalBs: toBs(total),
          bcvRateUsed: state.bcv.rate, payments
        };
        state.invoices.push(invoice);
        if(prefill.onInvoiceCreated) prefill.onInvoiceCreated(invoice);
        persist(); closeModal(); renderMain();
        showToast('Venta registrada correctamente.');
      };
    }
  };
  renderModal();
}

function openInvoiceView(invoiceId){
  const inv = state.invoices.find(i=>i.id===invoiceId);
  if(!inv) return;
  const itemsRows = inv.items.map(l=>`
    <tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${formatUsd(l.unitPriceUsd)}</td><td>${formatUsd(l.lineTotalUsd)}</td></tr>
  `).join('');
  const paymentsRows = (inv.payments||[]).map(p=>`<div class="summary-row"><span>${paymentLineLabel(p)}</span><span>${formatUsd(p.amountUsd)}</span></div>`).join('');
  modal = {
    html: `<div class="modal wide">
      <div class="modal-head"><div class="modal-title">Factura #${inv.number}</div><button class="close-x" id="m-close">✕</button></div>
      <div id="print-invoice">
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:16px;">DOMUSHACK</div>
          <div class="muted">Factura #${inv.number} · ${new Date(inv.timestamp).toLocaleString('es-VE')}</div>
        </div>
        <div class="summary-row"><span>Cliente</span><span>${esc(inv.customerName||'Consumidor final')}</span></div>
        ${inv.customerPhone?`<div class="summary-row"><span>Teléfono</span><span>${esc(inv.customerPhone)}</span></div>`:''}
        <table style="margin:12px 0;"><thead><tr><th>Ítem</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>${itemsRows}</tbody></table>
        <div class="summary-box">
          <div class="summary-row summary-total"><span>Total</span><b>${formatUsd(inv.totalUsd)} · ${formatBs(inv.totalBs)} Bs</b></div>
          ${paymentsRows}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-close2">Cerrar</button>
        <button class="btn btn-primary" id="m-print">🖨 Imprimir</button>
      </div>
    </div>`,
    bind(){
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-close2').onclick = closeModal;
      document.getElementById('m-print').onclick = ()=> window.print();
    }
  };
  renderModal();
}

/* ======================= SERVICIO TÉCNICO ======================= */
function serviceHtml(){
  const tickets = state.serviceTickets.slice().sort((a,b)=>b.createdAt-a.createdAt);
  const statusColor = s => s==='Entregado' ? 'var(--mint)' : s==='Cancelado' ? 'var(--rose)' : s==='Listo' ? 'var(--blue)' : 'var(--text-dim)';
  const rows = tickets.map(t=>`
    <tr>
      <td>${new Date(t.createdAt).toLocaleDateString('es-VE')}</td>
      <td class="strong">${esc(t.customerName)}</td>
      <td>${esc(t.device)}</td>
      <td class="muted">${esc((t.problem||'').slice(0,60))}${(t.problem||'').length>60?'…':''}</td>
      <td><span style="color:${statusColor(t.status)};font-weight:600;">${esc(t.status)}</span></td>
      <td>${formatUsd(t.estimatedCostUsd||0)}</td>
      <td style="white-space:nowrap;">
        <select data-act="ticketstatus" data-id="${t.id}" style="background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:4px 6px;font-size:12px;">
          ${SERVICE_STATUSES.map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('')}
        </select>
        ${!t.invoiceId ? `<button class="btn btn-ghost btn-sm" data-act="ticketinvoice" data-id="${t.id}" style="margin-left:4px;">Facturar</button>` : `<span class="muted" style="margin-left:6px;">Facturado</span>`}
        <button class="icon-x" data-act="delticket" data-id="${t.id}">✕</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="7" class="muted" style="padding:16px 10px;">Sin tickets de servicio técnico todavía.</td></tr>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div class="muted">${tickets.length} ticket(s)</div>
      <button class="btn btn-primary" id="btn-ticket-new">+ Nuevo ticket</button>
    </div>
    <div class="card" style="padding:6px 4px;overflow-x:auto;">
      <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Equipo</th><th>Problema</th><th>Estado</th><th>Estimado</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  `;
}

function openTicketModal(){
  modal = {
    html: `<div class="modal">
      <div class="modal-head"><div class="modal-title">Nuevo ticket de servicio</div><button class="close-x" id="m-close">✕</button></div>
      <div class="field"><label>Cliente</label><input type="text" id="t-name" placeholder="Nombre del cliente"></div>
      <div class="field"><label>Teléfono</label><input type="text" id="t-phone" placeholder="0412-1234567"></div>
      <div class="field"><label>Equipo</label><input type="text" id="t-device" placeholder="Ej. PS5 Slim, Xbox Series X…"></div>
      <div class="field"><label>Problema reportado</label><input type="text" id="t-problem" placeholder="Ej. No enciende, lector no lee discos…"></div>
      <div class="field"><label>Costo estimado (USD)</label><input type="number" step="0.01" min="0" id="t-cost" value="0"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">Crear ticket</button>
      </div>
    </div>`,
    bind(){
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-save').onclick = ()=>{
        const customerName = document.getElementById('t-name').value.trim();
        const device = document.getElementById('t-device').value.trim();
        if(!customerName || !device){ showToast('Cliente y equipo son obligatorios.', true); return; }
        state.serviceTickets.push({
          id: uid(), createdAt: Date.now(), customerName,
          customerPhone: document.getElementById('t-phone').value.trim(),
          device, problem: document.getElementById('t-problem').value.trim(),
          status: 'Recibido',
          estimatedCostUsd: parseFloat(document.getElementById('t-cost').value)||0,
          invoiceId: null
        });
        persist(); closeModal(); renderMain();
      };
    }
  };
  renderModal();
}

/* ======================= CONFIGURACIÓN ======================= */
function configHtml(){
  const rows = state.consoles.map(c=>`
    <div class="cfg-row">
      <span style="width:10px;height:10px;border-radius:50%;background:${consoleColor(c.name)};flex-shrink:0;"></span>
      <div class="name">${esc(c.name)}</div>
      <span class="muted">$/hora</span>
      <input type="number" step="0.1" min="0" value="${c.rate}" data-console-rate="${c.id}">
      <button class="icon-x" data-act="delconsole" data-id="${c.id}" title="Eliminar tipo de consola">✕</button>
    </div>
  `).join('');
  return `
    <div class="section-title" style="margin-top:0;">Tipos de consola y tarifa por hora</div>
    <div class="card">
      ${rows}
      <button class="btn btn-ghost btn-sm" style="margin-top:6px;" id="btn-add-console">+ Añadir tipo de consola</button>
    </div>

    <div class="section-title">Tasa del dólar (BCV)</div>
    <div class="card">
      <div class="field">
        <label>Tasa actual (Bs por $1)</label>
        <input type="number" step="0.01" min="0" id="input-manual-rate" value="${state.bcv.rate}">
        <div class="hint">Se usa para convertir cada cobro de dólares a bolívares. ${state.bcv.manual ? 'Tasa ingresada manualmente.' : 'Última actualización automática: '+new Date(state.bcv.updatedAt).toLocaleString('es-VE')}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="btn-save-rate">Guardar tasa manual</button>
        <button class="btn btn-primary" id="btn-refresh-rate-cfg">Actualizar automáticamente</button>
      </div>
    </div>
  `;
}

/* ======================= EVENTOS ======================= */
function bindMainEvents(){
  const byId = (id)=>document.getElementById(id);
  if(byId('btn-refresh-rate')) byId('btn-refresh-rate').onclick = ()=>fetchBcvRate(false);
  if(byId('btn-refresh-rate-cfg')) byId('btn-refresh-rate-cfg').onclick = ()=>fetchBcvRate(false);
  if(byId('btn-save-rate')) byId('btn-save-rate').onclick = ()=>{
    const v = parseFloat(byId('input-manual-rate').value);
    if(v>0){ state.bcv = {rate:v, updatedAt: Date.now(), manual:true}; persist(); renderMain(); showToast('Tasa manual guardada.'); }
  };
  if(byId('btn-new-station')) byId('btn-new-station').onclick = ()=> openStationModal(null);
  if(byId('btn-add-console')) byId('btn-add-console').onclick = ()=> openConsoleModal();
  if(byId('btn-ai-generate')) byId('btn-ai-generate').onclick = ()=> generateAiInsights();
  if(byId('btn-inv-new')) byId('btn-inv-new').onclick = ()=> openProductModal(null);
  if(byId('btn-inv-template')) byId('btn-inv-template').onclick = ()=> downloadInventoryTemplate();
  if(byId('btn-inv-import')) byId('btn-inv-import').onclick = ()=> byId('inv-file-input').click();
  if(byId('inv-file-input')) byId('inv-file-input').onchange = (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    if(typeof XLSX==='undefined'){ showToast('No se pudo cargar el módulo de Excel.', true); return; }
    const reader = new FileReader();
    reader.onload = (ev)=>{
      try{
        const wb = XLSX.read(ev.target.result, {type:'array'});
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
        if(!rows.length){ showToast('El archivo no tiene filas de datos.', true); return; }
        openImportModal(rows);
      }catch(err){ showToast('No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.', true); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };
  [...document.querySelectorAll('[data-act="editproduct"]')].forEach(b=>{ b.onclick = ()=> openProductModal(b.dataset.id); });
  [...document.querySelectorAll('[data-act="delproduct"]')].forEach(b=>{
    b.onclick = ()=>{ if(confirm('¿Eliminar este producto del inventario?')){ state.products = state.products.filter(p=>p.id!==b.dataset.id); persist(); renderMain(); } };
  });
  if(byId('btn-sale-new')) byId('btn-sale-new').onclick = ()=> openSaleModal();
  [...document.querySelectorAll('[data-act="viewinvoice"]')].forEach(b=>{ b.onclick = ()=> openInvoiceView(b.dataset.id); });
  if(byId('btn-ticket-new')) byId('btn-ticket-new').onclick = ()=> openTicketModal();
  [...document.querySelectorAll('[data-act="delticket"]')].forEach(b=>{
    b.onclick = ()=>{ if(confirm('¿Eliminar este ticket?')){ state.serviceTickets = state.serviceTickets.filter(t=>t.id!==b.dataset.id); persist(); renderMain(); } };
  });
  [...document.querySelectorAll('[data-act="ticketstatus"]')].forEach(sel=>{
    sel.onchange = ()=>{
      const t = state.serviceTickets.find(x=>x.id===sel.dataset.id);
      if(t){ t.status = sel.value; persist(); renderMain(); }
    };
  });
  [...document.querySelectorAll('[data-act="ticketinvoice"]')].forEach(b=>{
    b.onclick = ()=>{
      const t = state.serviceTickets.find(x=>x.id===b.dataset.id);
      if(!t) return;
      openSaleModal({
        customerName: t.customerName,
        customerPhone: t.customerPhone,
        items: [{ kind:'product', productId:null, name:'Servicio técnico: '+t.device+(t.problem?' — '+t.problem:''), qty:1, unitPriceUsd:t.estimatedCostUsd||0, lineTotalUsd:t.estimatedCostUsd||0 }],
        onInvoiceCreated(invoice){ t.invoiceId = invoice.id; t.status = 'Entregado'; }
      });
    };
  });

  [...document.querySelectorAll('[data-console-rate]')].forEach(inp=>{
    inp.onchange = ()=>{
      const c = findConsole(inp.dataset.consoleRate);
      const v = parseFloat(inp.value);
      if(c && v>=0){ c.rate = v; persist(); renderMain(); }
    };
  });
  [...document.querySelectorAll('[data-act="delconsole"]')].forEach(b=>{
    b.onclick = ()=>{
      const inUse = state.stations.some(s=>s.consoleId===b.dataset.id);
      if(inUse){ showToast('No se puede eliminar: hay una estación usando este tipo de consola.', true); return; }
      state.consoles = state.consoles.filter(c=>c.id!==b.dataset.id);
      persist(); renderMain();
    };
  });
  [...document.querySelectorAll('[data-filter]')].forEach(b=>{
    b.onclick = ()=>{ dashFilter = b.dataset.filter; renderMain(); };
  });
  [...document.querySelectorAll('[data-repmode]')].forEach(b=>{
    b.onclick = ()=>{ reportMode = b.dataset.repmode; reportRefDate = new Date(); renderMain(); };
  });
  if(byId('btn-rep-prev')) byId('btn-rep-prev').onclick = ()=>{ shiftRefDate(-1); renderMain(); };
  if(byId('btn-rep-next')) byId('btn-rep-next').onclick = ()=>{ shiftRefDate(1); renderMain(); };
  if(byId('btn-rep-export')) byId('btn-rep-export').onclick = ()=> exportReportExcel();
  [...document.querySelectorAll('[data-act="deltx"]')].forEach(b=>{
    b.onclick = ()=>{ if(confirm('¿Eliminar este registro de cobro?')){ state.transactions = state.transactions.filter(t=>t.id!==b.dataset.id); persist(); renderMain(); } };
  });
  [...document.querySelectorAll('[data-act="delstation"]')].forEach(b=>{
    b.onclick = ()=>{ if(confirm('¿Eliminar esta estación?')){ state.stations = state.stations.filter(s=>s.id!==b.dataset.id); persist(); renderMain(); } };
  });
  [...document.querySelectorAll('[data-act="startsession"]')].forEach(b=>{ b.onclick = ()=> openStationModal(b.dataset.id); });
  [...document.querySelectorAll('[data-act="extend"]')].forEach(b=>{ b.onclick = ()=> openExtendModal(b.dataset.id); });
  [...document.querySelectorAll('[data-act="swap"]')].forEach(b=>{ b.onclick = ()=> openSwapConsoleModal(b.dataset.id); });
  [...document.querySelectorAll('[data-act="finish"]')].forEach(b=>{
    b.onclick = ()=>{
      if(confirm('¿Finalizar esta sesión? La estación quedará libre.')){
        const s=findStation(b.dataset.id);
        const c=findConsole(s.consoleId);
        if(s.session) logLoggedUsage(c?c.name:'—', s.session.startTime, Date.now());
        s.status='available'; s.session=null; persist(); renderMain();
      }
    };
  });
}

/* ======================= MODALES ======================= */
function renderModal(){
  const old = document.querySelector('.overlay');
  if(old) old.remove();
  if(!modal) return;
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = modal.html;
  wrap.onclick = (e)=>{ if(e.target===wrap) closeModal(); };
  document.body.appendChild(wrap);
  modal.bind && modal.bind();
}
function closeModal(){ modal = null; renderModal(); }

function openStationModal(stationId){
  const existing = stationId ? findStation(stationId) : null;
  let chosen = 1;
  let consoleId = existing ? existing.consoleId : (state.consoles[0] && state.consoles[0].id);
  const rateOf = (id)=> (findConsole(id)||{rate:0}).rate;
  const optionsHtml = ()=> state.consoles.map(c=>`<option value="${c.id}" ${c.id===consoleId?'selected':''}>${esc(c.name)} — ${formatUsd(c.rate)}/h</option>`).join('');
  const build = ()=>{
    const cost = chosen*rateOf(consoleId);
    return `<div class="modal">
      <div class="modal-head"><div class="modal-title">${existing?'Iniciar sesión — '+esc(existing.name):'Nueva estación'}</div><button class="close-x" id="m-close">✕</button></div>
      ${!existing ? `<div class="field"><label>Nombre de la estación</label><input type="text" id="m-name" placeholder="Ej. Estación 1"></div>`:''}
      <div class="field"><label>Consola</label><select id="m-console">${optionsHtml()}</select></div>
      <div class="field">
        <label>Tiempo</label>
        <div class="seg" id="m-durs">${DURATIONS.map(d=>`<button data-d="${d}" class="${d===chosen?'active':''}">${fmtHours(d)}</button>`).join('')}</div>
      </div>
      <div class="field">
        <label>Tiempo personalizado (múltiplos de 30 min)</label>
        <input type="number" step="0.5" min="0.5" id="m-custom" value="${chosen}">
      </div>
      <div class="summary-box">
        <div class="summary-row"><span>Tiempo seleccionado</span><span id="m-time-lbl">${fmtHours(chosen)}</span></div>
        <div class="summary-row summary-total"><span>Costo</span><b id="m-cost-lbl">${formatUsd(cost)} · ${formatBs(toBs(cost))} Bs</b></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">${existing?'Ir a pagar y activar':'Ir a pagar y crear'}</button>
      </div>
    </div>`;
  };
  modal = {
    html: build(),
    bind(){
      const refresh = ()=>{
        document.getElementById('m-time-lbl').textContent = fmtHours(chosen);
        const cost = chosen*rateOf(consoleId);
        document.getElementById('m-cost-lbl').textContent = formatUsd(cost)+' · '+formatBs(toBs(cost))+' Bs';
        [...document.querySelectorAll('#m-durs button')].forEach(b=>b.classList.toggle('active', parseFloat(b.dataset.d)===chosen));
        document.getElementById('m-custom').value = chosen;
      };
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-console').onchange = (e)=>{ consoleId = e.target.value; refresh(); };
      [...document.querySelectorAll('#m-durs button')].forEach(b=>{
        b.onclick = ()=>{ chosen = parseFloat(b.dataset.d); refresh(); };
      });
      document.getElementById('m-custom').onchange = (e)=>{
        let v = Math.round(parseFloat(e.target.value)*2)/2;
        if(!(v>=0.5)) v = 0.5;
        chosen = v; refresh();
      };
      document.getElementById('m-save').onclick = ()=>{
        if(!consoleId){ showToast('Primero crea al menos un tipo de consola en Configuración.', true); return; }
        const rate = rateOf(consoleId);
        const cName = findConsole(consoleId).name;
        const nameInput = !existing ? document.getElementById('m-name').value.trim() : '';
        const finalName = existing ? existing.name : (nameInput || ('Estación '+(state.stations.length+1)));
        const hours = chosen;
        closeModal();
        openPayModal({
          title: (existing ? 'Cobrar — Iniciar sesión en ' : 'Cobrar — Nueva estación ')+finalName,
          stationName: finalName,
          consoleName: cName,
          hours,
          costUsd: hours*rate,
          costBs: toBs(hours*rate),
          txType: 'sesion',
          applyEffect(){
            if(existing){
              existing.consoleId = consoleId;
              existing.status = 'busy';
              existing.session = { startTime: Date.now(), plannedHours: hours };
            } else {
              state.stations.push({id:uid(), name: finalName, consoleId, status:'busy', session:{ startTime: Date.now(), plannedHours: hours }});
            }
          }
        });
      };
    }
  };
  renderModal();
}

function openExtendModal(stationId){
  const st = findStation(stationId);
  const c = findConsole(st.consoleId);
  let chosen = 0.5;
  const build = ()=>{
    const cost = chosen*c.rate;
    return `<div class="modal">
      <div class="modal-head"><div class="modal-title">Extender tiempo — ${esc(st.name)}</div><button class="close-x" id="m-close">✕</button></div>
      <div class="muted" style="margin-bottom:10px;">${esc(c.name)} · ${formatUsd(c.rate)} por hora</div>
      <div class="field">
        <label>Tiempo adicional</label>
        <div class="seg" id="m-durs">${DURATIONS.map(d=>`<button data-d="${d}" class="${d===chosen?'active':''}">${fmtHours(d)}</button>`).join('')}</div>
      </div>
      <div class="field">
        <label>Tiempo personalizado (múltiplos de 30 min)</label>
        <input type="number" step="0.5" min="0.5" id="m-custom" value="${chosen}">
      </div>
      <div class="summary-box">
        <div class="summary-row"><span>Tiempo adicional</span><span id="m-time-lbl">${fmtHours(chosen)}</span></div>
        <div class="summary-row summary-total"><span>Costo de la extensión</span><b id="m-cost-lbl">${formatUsd(cost)} · ${formatBs(toBs(cost))} Bs</b></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">Continuar al pago</button>
      </div>
    </div>`;
  };
  modal = {
    html: build(),
    bind(){
      const refresh = ()=>{
        document.getElementById('m-time-lbl').textContent = fmtHours(chosen);
        const cost = chosen*c.rate;
        document.getElementById('m-cost-lbl').textContent = formatUsd(cost)+' · '+formatBs(toBs(cost))+' Bs';
        [...document.querySelectorAll('#m-durs button')].forEach(b=>b.classList.toggle('active', parseFloat(b.dataset.d)===chosen));
        document.getElementById('m-custom').value = chosen;
      };
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      [...document.querySelectorAll('#m-durs button')].forEach(b=>{
        b.onclick = ()=>{ chosen = parseFloat(b.dataset.d); refresh(); };
      });
      document.getElementById('m-custom').onchange = (e)=>{
        let v = Math.round(parseFloat(e.target.value)*2)/2;
        if(!(v>=0.5)) v = 0.5;
        chosen = v; refresh();
      };
      document.getElementById('m-save').onclick = ()=>{
        closeModal();
        openPayModal({
          title: 'Pagar extensión — '+st.name,
          stationName: st.name,
          consoleName: c.name,
          hours: chosen,
          costUsd: chosen*c.rate,
          costBs: toBs(chosen*c.rate),
          txType: 'extension',
          applyEffect(){ st.session.plannedHours += chosen; }
        });
      };
    }
  };
  renderModal();
}

function openSwapConsoleModal(stationId){
  const st = findStation(stationId);
  const oldConsole = findConsole(st.consoleId);
  const oldRate = oldConsole.rate;
  const elapsedHours = (Date.now()-st.session.startTime)/3600000;
  const R_hours = Math.max(0, st.session.plannedHours - elapsedHours);
  const otherConsoles = state.consoles.filter(c=>c.id!==st.consoleId);
  if(!otherConsoles.length){ showToast('Agrega otro tipo de consola en Configuración para poder hacer el cambio.', true); return; }

  const rateOf = id => (findConsole(id)||{rate:0}).rate;
  const round2 = n => Math.round(n*100)/100;

  let newConsoleId = otherConsoles[0].id;
  let keepRemaining = true;
  let wantExtra = false;
  let extraHours = 1;
  let lineSeq = 0;
  let lines = [];

  function computeD(){
    const newRate = rateOf(newConsoleId);
    const kept = keepRemaining ? R_hours : 0;
    const extra = wantExtra ? extraHours : 0;
    return (kept+extra)*newRate - R_hours*oldRate;
  }
  function newPlannedHoursVal(){
    return (keepRemaining?R_hours:0) + (wantExtra?extraHours:0);
  }
  function lineUsd(l){ return (l.method==='efectivo' && l.currency==='USD') ? (l.amount||0) : (l.amount||0)/(state.bcv.rate||1); }
  function coveredUsd(){ return lines.reduce((s,l)=>s+lineUsd(l),0); }
  function defaultLine(amountBs){
    return { id: lineSeq++, method:'pago_movil', currency:'Bs', amount: round2(amountBs), cardType:'debito', phone:'', reference:'', bank:BANKS[0] };
  }
  function resetLines(){
    const target = Math.abs(computeD());
    lineSeq = 0;
    lines = target>0.01 ? [defaultLine(toBs(target))] : [];
  }
  resetLines();

  function lineFieldsHtml(l){
    if(l.method==='pago_movil'){
      return `
        <div class="field"><label>Teléfono</label><input type="text" data-f="phone" value="${esc(l.phone)}" placeholder="0412-1234567"></div>
        <div class="field"><label>Referencia (últimos 6 dígitos)</label><input type="text" maxlength="6" data-f="reference" value="${esc(l.reference)}" placeholder="123456"></div>
        <div class="field"><label>Banco</label><select data-f="bank">${BANKS.map(b=>`<option ${b===l.bank?'selected':''}>${b}</option>`).join('')}</select></div>
        <div class="field"><label>Monto (Bs)</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
      `;
    }
    if(l.method==='efectivo'){
      return `
        <div class="field"><label>Moneda</label>
          <div class="seg" data-segfor="currency">
            <button data-v="Bs" class="${l.currency==='Bs'?'active':''}">Bolívares</button>
            <button data-v="USD" class="${l.currency==='USD'?'active':''}">Dólares</button>
          </div>
        </div>
        <div class="field"><label>Monto (${l.currency==='USD'?'$':'Bs'})</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
      `;
    }
    return `
      <div class="field"><label>Tipo de tarjeta</label>
        <div class="seg" data-segfor="cardType">
          <button data-v="debito" class="${l.cardType==='debito'?'active':''}">Débito</button>
          <button data-v="credito" class="${l.cardType==='credito'?'active':''}">Crédito</button>
        </div>
      </div>
      <div class="field"><label>Monto (Bs)</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
    `;
  }
  function lineBlockHtml(l){
    return `<div class="card" style="padding:12px;margin-bottom:10px;background:var(--surface-2);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <div class="paytabs" style="flex:1;margin-bottom:0;" data-methodfor="${l.id}">
          <button data-v="pago_movil" class="${l.method==='pago_movil'?'active':''}">Pago Móvil</button>
          <button data-v="efectivo" class="${l.method==='efectivo'?'active':''}">Efectivo</button>
          <button data-v="pos" class="${l.method==='pos'?'active':''}">Punto de venta</button>
        </div>
        ${lines.length>1?`<button class="icon-x" data-removeline="${l.id}">✕</button>`:''}
      </div>
      <div data-fieldswrap="${l.id}">${lineFieldsHtml(l)}</div>
    </div>`;
  }

  function summaryHtml(){
    const D = computeD();
    const npH = newPlannedHoursVal();
    let settleLine;
    if(D>0.01) settleLine = `<div class="summary-row" style="color:var(--rose);"><span>Se debe cobrar</span><b>${formatUsd(D)} · ${formatBs(toBs(D))} Bs</b></div>`;
    else if(D<-0.01) settleLine = `<div class="summary-row" style="color:var(--mint);"><span>Se debe reembolsar al cliente</span><b>${formatUsd(-D)} · ${formatBs(-toBs(D))} Bs</b></div>`;
    else settleLine = `<div class="summary-row" style="color:var(--mint);"><span>Sin diferencia que cobrar o reembolsar</span><span>✓</span></div>`;

    let coverLine = '';
    if(Math.abs(D)>0.01){
      const remaining = Math.abs(D) - coveredUsd();
      if(remaining>0.01) coverLine = `<div class="summary-row" style="color:var(--rose);"><span>Falta por ${D>0?'cobrar':'reembolsar'}</span><b>${formatUsd(remaining)} · ${formatBs(toBs(remaining))} Bs</b></div>`;
      else if(remaining<-0.01) coverLine = `<div class="summary-row" style="color:var(--mint);"><span>Sobra (vuelto)</span><b>${formatUsd(-remaining)} · ${formatBs(toBs(-remaining))} Bs</b></div>`;
      else coverLine = `<div class="summary-row" style="color:var(--mint);"><span>Cubierto completamente ✓</span><span></span></div>`;
    }
    return `
      <div class="summary-row"><span>Consola actual</span><span>${esc(oldConsole.name)} (${formatUsd(oldRate)}/h)</span></div>
      <div class="summary-row"><span>Tiempo restante actual</span><span>${fmtDur(R_hours)}</span></div>
      <div class="summary-row"><span>Nueva consola</span><span>${esc(findConsole(newConsoleId).name)} (${formatUsd(rateOf(newConsoleId))}/h)</span></div>
      <div class="summary-row summary-total"><span>Nueva duración de sesión</span><b>${fmtDur(npH)}</b></div>
      ${settleLine}
      ${coverLine}
    `;
  }

  function build(){
    const D = computeD();
    const needsSettle = Math.abs(D) > 0.01;
    const npH = newPlannedHoursVal();
    return `<div class="modal wide">
      <div class="modal-head"><div class="modal-title">Cambiar consola — ${esc(st.name)}</div><button class="close-x" id="m-close">✕</button></div>
      <div class="field"><label>Nueva consola</label>
        <select id="m-newconsole">${otherConsoles.map(c=>`<option value="${c.id}" ${c.id===newConsoleId?'selected':''}>${esc(c.name)} — ${formatUsd(c.rate)}/h</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Tiempo restante actual (${fmtDur(R_hours)})</label>
        <div class="seg" id="m-keep">
          <button data-v="1" class="${keepRemaining?'active':''}">Mantener</button>
          <button data-v="0" class="${!keepRemaining?'active':''}">Cancelar (reembolsar)</button>
        </div>
      </div>
      <div class="field">
        <label>¿Desea tiempo adicional?</label>
        <div class="seg" id="m-extra-toggle">
          <button data-v="0" class="${!wantExtra?'active':''}">No</button>
          <button data-v="1" class="${wantExtra?'active':''}">Sí</button>
        </div>
      </div>
      ${wantExtra ? `<div class="field">
        <label>Tiempo adicional</label>
        <div class="seg" id="m-extra-durs">${DURATIONS.map(d=>`<button data-d="${d}" class="${d===extraHours?'active':''}">${fmtHours(d)}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Personalizado (múltiplos de 30 min)</label><input type="number" step="0.5" min="0.5" id="m-extra-custom" value="${extraHours}"></div>` : ''}
      <div class="summary-box" id="m-summary">${summaryHtml()}</div>
      ${needsSettle ? `
        <div id="m-lines">${lines.map(l=>lineBlockHtml(l)).join('')}</div>
        <button class="btn btn-ghost btn-sm btn-block" id="m-addline" style="margin-bottom:14px;">+ Agregar otro método de ${D>0?'pago':'reembolso'} (mixto)</button>
      ` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">${npH<=0 ? 'Cambiar y finalizar estación' : 'Aplicar cambio de consola'}</button>
      </div>
    </div>`;
  }

  modal = {
    html: build(),
    bind(){
      const refresh = ()=>{ modal.html = build(); renderModal(); };
      const refreshCore = ()=>{ resetLines(); refresh(); };

      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-newconsole').onchange = e=>{ newConsoleId = e.target.value; refreshCore(); };
      [...document.querySelectorAll('#m-keep button')].forEach(b=>{
        b.onclick = ()=>{ keepRemaining = b.dataset.v==='1'; refreshCore(); };
      });
      [...document.querySelectorAll('#m-extra-toggle button')].forEach(b=>{
        b.onclick = ()=>{ wantExtra = b.dataset.v==='1'; refreshCore(); };
      });
      if(document.getElementById('m-extra-durs')){
        [...document.querySelectorAll('#m-extra-durs button')].forEach(b=>{
          b.onclick = ()=>{ extraHours = parseFloat(b.dataset.d); refreshCore(); };
        });
      }
      if(document.getElementById('m-extra-custom')){
        document.getElementById('m-extra-custom').onchange = e=>{
          let v = Math.round(parseFloat(e.target.value)*2)/2;
          if(!(v>=0.5)) v = 0.5;
          extraHours = v; refreshCore();
        };
      }
      if(document.getElementById('m-addline')){
        document.getElementById('m-addline').onclick = ()=>{
          const target = Math.abs(computeD());
          const remainingUsd = Math.max(0, target - coveredUsd());
          lines.push(defaultLine(toBs(remainingUsd)));
          refresh();
        };
      }
      [...document.querySelectorAll('[data-methodfor]')].forEach(segEl=>{
        const id = Number(segEl.dataset.methodfor);
        [...segEl.querySelectorAll('button')].forEach(b=>{
          b.onclick = ()=>{
            const line = lines.find(x=>x.id===id);
            const preUsd = lineUsd(line);
            line.method = b.dataset.v;
            if(line.method==='efectivo') line.currency='Bs';
            if(line.method==='pos') line.cardType='debito';
            const otherUsd = coveredUsd() - preUsd;
            const target = Math.abs(computeD());
            const remainingExcl = Math.max(0, target - otherUsd);
            line.amount = round2( (line.method==='efectivo' && line.currency==='USD') ? remainingExcl : toBs(remainingExcl) );
            refresh();
          };
        });
      });
      [...document.querySelectorAll('[data-removeline]')].forEach(b=>{
        b.onclick = ()=>{ lines = lines.filter(l=>l.id!==Number(b.dataset.removeline)); refresh(); };
      });
      [...document.querySelectorAll('[data-fieldswrap]')].forEach(wrap=>{
        const id = Number(wrap.dataset.fieldswrap);
        const line = lines.find(x=>x.id===id);
        const phoneInp = wrap.querySelector('[data-f="phone"]');
        if(phoneInp) phoneInp.onchange = e=>{ line.phone = e.target.value; };
        const refInp = wrap.querySelector('[data-f="reference"]');
        if(refInp) refInp.onchange = e=>{ line.reference = e.target.value; };
        const bankSel = wrap.querySelector('[data-f="bank"]');
        if(bankSel) bankSel.onchange = e=>{ line.bank = e.target.value; };
        const amountInp = wrap.querySelector('[data-f="amount"]');
        if(amountInp) amountInp.onchange = e=>{ line.amount = parseFloat(e.target.value)||0; refresh(); };
        const curSeg = wrap.querySelector('[data-segfor="currency"]');
        if(curSeg){
          [...curSeg.querySelectorAll('button')].forEach(b=>{
            b.onclick = ()=>{
              const preUsd = lineUsd(line);
              line.currency = b.dataset.v;
              const otherUsd = coveredUsd() - preUsd;
              const target = Math.abs(computeD());
              const remainingExcl = Math.max(0, target - otherUsd);
              line.amount = round2( line.currency==='USD' ? remainingExcl : toBs(remainingExcl) );
              refresh();
            };
          });
        }
        const cardSeg = wrap.querySelector('[data-segfor="cardType"]');
        if(cardSeg){
          [...cardSeg.querySelectorAll('button')].forEach(b=>{ b.onclick = ()=>{ line.cardType = b.dataset.v; refresh(); }; });
        }
      });

      document.getElementById('m-save').onclick = ()=>{
        const D = computeD();
        const npH = newPlannedHoursVal();
        if(Math.abs(D)>0.01){
          for(const l of lines){
            if(l.method==='pago_movil' && (!l.phone.trim() || l.reference.trim().length!==6)){
              showToast('Revisa el teléfono y que la referencia tenga 6 dígitos en Pago Móvil.', true); return;
            }
            if(!(l.amount>=0)){ showToast('Ingresa montos válidos en cada método.', true); return; }
          }
          const target = Math.abs(D);
          const remaining = target - coveredUsd();
          if(remaining > 0.02){ showToast('Los montos ingresados no cubren el total de '+(D>0?'cobro':'reembolso')+'. Falta '+formatUsd(remaining)+'.', true); return; }
        }
        const sign = D<0 ? -1 : 1;
        const payments = lines.filter(l=>l.amount>0).map(l=>{
          const amountUsd = lineUsd(l)*sign;
          const amountBsRaw = (l.method==='efectivo' && l.currency==='USD') ? toBs(l.amount) : l.amount;
          const amountBs = amountBsRaw*sign;
          let details = {};
          if(l.method==='pago_movil') details = {phone:l.phone.trim(), reference:l.reference.trim(), bank:l.bank};
          else if(l.method==='efectivo') details = {currency:l.currency, amount:l.amount};
          else details = {cardType:l.cardType, amountBs:l.amount};
          return {method:l.method, amountUsd, amountBs, details};
        });
        const newConsole = findConsole(newConsoleId);
        if(Math.abs(D)>0.01){
          state.transactions.push({
            id: uid(), timestamp: Date.now(),
            stationName: st.name, consoleName: newConsole.name,
            plannedHours: npH,
            costUsd: D, costBs: toBs(D), bcvRateUsed: state.bcv.rate,
            type: 'swap', swapFrom: oldConsole.name, swapTo: newConsole.name,
            payments
          });
        }
        logLoggedUsage(oldConsole.name, st.session.startTime, Date.now());
        st.consoleId = newConsoleId;
        if(npH>0){
          st.status = 'busy';
          st.session = { startTime: Date.now(), plannedHours: npH };
        } else {
          st.status = 'available';
          st.session = null;
        }
        persist(); closeModal(); renderMain();
        showToast(D>0.01 ? 'Diferencia cobrada y consola cambiada.' : D<-0.01 ? 'Reembolso registrado y consola cambiada.' : 'Consola cambiada correctamente.');
      };
    }
  };
  renderModal();
}

function openConsoleModal(){
  modal = {
    html: `<div class="modal">
      <div class="modal-head"><div class="modal-title">Nuevo tipo de consola</div><button class="close-x" id="m-close">✕</button></div>
      <div class="field"><label>Nombre</label><input type="text" id="m-cname" placeholder="Ej. PS5 Pro"></div>
      <div class="field"><label>Tarifa por hora (USD)</label><input type="number" step="0.1" min="0" id="m-crate" placeholder="2.5"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">Añadir</button>
      </div>
    </div>`,
    bind(){
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-save').onclick = ()=>{
        const name = document.getElementById('m-cname').value.trim();
        const rate = parseFloat(document.getElementById('m-crate').value);
        if(!name || !(rate>=0)){ showToast('Completa nombre y tarifa válidos.', true); return; }
        state.consoles.push({id:uid(), name, rate});
        persist(); closeModal(); renderMain();
      };
    }
  };
  renderModal();
}

function openPayModal(ctx){
  // ctx: {title, stationName, consoleName, hours, costUsd, costBs, txType, applyEffect}
  let lineSeq = 0;
  const round2 = n => Math.round(n*100)/100;
  const lineUsd = l => (l.method==='efectivo' && l.currency==='USD') ? (l.amount||0) : (l.amount||0)/(state.bcv.rate||1);
  const coveredUsd = () => lines.reduce((sum,l)=> sum + lineUsd(l), 0);
  const newLine = (excludeUsd)=>{
    const remainingUsd = Math.max(0, ctx.costUsd - (excludeUsd!==undefined?excludeUsd:coveredUsd()));
    return { id: lineSeq++, method:'pago_movil', currency:'Bs', amount: round2(toBs(remainingUsd)), cardType:'debito', phone:'', reference:'', bank:BANKS[0] };
  };
  let lines = [ newLine(0) ];

  function lineFieldsHtml(l){
    if(l.method==='pago_movil'){
      return `
        <div class="field"><label>Teléfono</label><input type="text" data-f="phone" value="${esc(l.phone)}" placeholder="0412-1234567"></div>
        <div class="field"><label>Referencia (últimos 6 dígitos)</label><input type="text" maxlength="6" data-f="reference" value="${esc(l.reference)}" placeholder="123456"></div>
        <div class="field"><label>Banco</label><select data-f="bank">${BANKS.map(b=>`<option ${b===l.bank?'selected':''}>${b}</option>`).join('')}</select></div>
        <div class="field"><label>Monto (Bs)</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
      `;
    }
    if(l.method==='efectivo'){
      return `
        <div class="field"><label>Moneda</label>
          <div class="seg" data-segfor="currency">
            <button data-v="Bs" class="${l.currency==='Bs'?'active':''}">Bolívares</button>
            <button data-v="USD" class="${l.currency==='USD'?'active':''}">Dólares</button>
          </div>
        </div>
        <div class="field"><label>Monto recibido (${l.currency==='USD'?'$':'Bs'})</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
      `;
    }
    return `
      <div class="field"><label>Tipo de tarjeta</label>
        <div class="seg" data-segfor="cardType">
          <button data-v="debito" class="${l.cardType==='debito'?'active':''}">Débito</button>
          <button data-v="credito" class="${l.cardType==='credito'?'active':''}">Crédito</button>
        </div>
      </div>
      <div class="field"><label>Monto facturado (Bs)</label><input type="number" step="0.01" min="0" data-f="amount" value="${l.amount}"></div>
    `;
  }
  function lineBlockHtml(l){
    return `<div class="card" style="padding:12px;margin-bottom:10px;background:var(--surface-2);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <div class="paytabs" style="flex:1;margin-bottom:0;" data-methodfor="${l.id}">
          <button data-v="pago_movil" class="${l.method==='pago_movil'?'active':''}">Pago Móvil</button>
          <button data-v="efectivo" class="${l.method==='efectivo'?'active':''}">Efectivo</button>
          <button data-v="pos" class="${l.method==='pos'?'active':''}">Punto de venta</button>
        </div>
        ${lines.length>1?`<button class="icon-x" data-removeline="${l.id}">✕</button>`:''}
      </div>
      <div data-fieldswrap="${l.id}">${lineFieldsHtml(l)}</div>
    </div>`;
  }
  function summaryInnerHtml(){
    const covered = coveredUsd();
    const remaining = ctx.costUsd - covered;
    const remainingBs = toBs(remaining);
    let remLine;
    if(remaining > 0.01){
      remLine = `<div class="summary-row" style="color:var(--rose);"><span>Falta por cubrir</span><b>${formatUsd(remaining)} · ${formatBs(remainingBs)} Bs</b></div>`;
    } else if(remaining < -0.01){
      remLine = `<div class="summary-row" style="color:var(--mint);"><span>Vuelto / cambio</span><b>${formatUsd(-remaining)} · ${formatBs(-remainingBs)} Bs</b></div>`;
    } else {
      remLine = `<div class="summary-row" style="color:var(--mint);"><span>Cubierto completamente ✓</span><span></span></div>`;
    }
    return `
      <div class="summary-row"><span>Consola</span><span>${esc(ctx.consoleName)}</span></div>
      <div class="summary-row"><span>${ctx.txType==='extension'?'Tiempo adicional':'Tiempo'}</span><span>${fmtHours(ctx.hours)}</span></div>
      <div class="summary-row summary-total"><span>Total a cobrar</span><b>${formatUsd(ctx.costUsd)} · ${formatBs(ctx.costBs)} Bs</b></div>
      ${remLine}
    `;
  }
  function build(){
    return `<div class="modal wide">
      <div class="modal-head"><div class="modal-title">${esc(ctx.title)}</div><button class="close-x" id="m-close">✕</button></div>
      <div class="summary-box" id="m-summary">${summaryInnerHtml()}</div>
      <div id="m-lines">${lines.map(l=>lineBlockHtml(l)).join('')}</div>
      <button class="btn btn-ghost btn-sm btn-block" id="m-addline" style="margin-bottom:14px;">+ Agregar otro método de pago (pago mixto)</button>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">Registrar pago</button>
      </div>
    </div>`;
  }
  modal = {
    html: build(),
    bind(){
      const refresh = ()=>{ modal.html = build(); renderModal(); };
      document.getElementById('m-close').onclick = closeModal;
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-addline').onclick = ()=>{ lines.push(newLine()); refresh(); };

      [...document.querySelectorAll('[data-methodfor]')].forEach(segEl=>{
        const id = Number(segEl.dataset.methodfor);
        [...segEl.querySelectorAll('button')].forEach(b=>{
          b.onclick = ()=>{
            const line = lines.find(x=>x.id===id);
            const preUsd = lineUsd(line);
            line.method = b.dataset.v;
            if(line.method==='efectivo') line.currency = 'Bs';
            if(line.method==='pos') line.cardType = 'debito';
            const otherUsd = coveredUsd() - preUsd;
            const remainingExcl = Math.max(0, ctx.costUsd - otherUsd);
            line.amount = round2( (line.method==='efectivo' && line.currency==='USD') ? remainingExcl : toBs(remainingExcl) );
            refresh();
          };
        });
      });
      [...document.querySelectorAll('[data-removeline]')].forEach(b=>{
        b.onclick = ()=>{ lines = lines.filter(l=>l.id!==Number(b.dataset.removeline)); refresh(); };
      });
      [...document.querySelectorAll('[data-fieldswrap]')].forEach(wrap=>{
        const id = Number(wrap.dataset.fieldswrap);
        const line = lines.find(x=>x.id===id);
        const phoneInp = wrap.querySelector('[data-f="phone"]');
        if(phoneInp) phoneInp.onchange = e=>{ line.phone = e.target.value; };
        const refInp = wrap.querySelector('[data-f="reference"]');
        if(refInp) refInp.onchange = e=>{ line.reference = e.target.value; };
        const bankSel = wrap.querySelector('[data-f="bank"]');
        if(bankSel) bankSel.onchange = e=>{ line.bank = e.target.value; };
        const amountInp = wrap.querySelector('[data-f="amount"]');
        if(amountInp) amountInp.onchange = e=>{ line.amount = parseFloat(e.target.value)||0; refresh(); };
        const curSeg = wrap.querySelector('[data-segfor="currency"]');
        if(curSeg){
          [...curSeg.querySelectorAll('button')].forEach(b=>{
            b.onclick = ()=>{
              const preUsd = lineUsd(line);
              line.currency = b.dataset.v;
              const otherUsd = coveredUsd() - preUsd;
              const remainingExcl = Math.max(0, ctx.costUsd - otherUsd);
              line.amount = round2( line.currency==='USD' ? remainingExcl : toBs(remainingExcl) );
              refresh();
            };
          });
        }
        const cardSeg = wrap.querySelector('[data-segfor="cardType"]');
        if(cardSeg){
          [...cardSeg.querySelectorAll('button')].forEach(b=>{ b.onclick = ()=>{ line.cardType = b.dataset.v; refresh(); }; });
        }
      });

      document.getElementById('m-save').onclick = ()=>{
        for(const l of lines){
          if(l.method==='pago_movil' && (!l.phone.trim() || l.reference.trim().length!==6)){
            showToast('Revisa el teléfono y que la referencia tenga 6 dígitos en Pago Móvil.', true); return;
          }
          if(!(l.amount>=0)){ showToast('Ingresa montos válidos en cada método de pago.', true); return; }
        }
        const remaining = ctx.costUsd - coveredUsd();
        if(remaining > 0.02){ showToast('Los montos ingresados no cubren el total. Falta '+formatUsd(remaining)+'.', true); return; }
        const payments = lines.filter(l=>l.amount>0).map(l=>{
          const amountUsd = lineUsd(l);
          const amountBs = (l.method==='efectivo' && l.currency==='USD') ? toBs(l.amount) : l.amount;
          let details = {};
          if(l.method==='pago_movil') details = {phone:l.phone.trim(), reference:l.reference.trim(), bank:l.bank};
          else if(l.method==='efectivo') details = {currency:l.currency, amount:l.amount};
          else details = {cardType:l.cardType, amountBs:l.amount};
          return {method:l.method, amountUsd, amountBs, details};
        });
        if(!payments.length){ showToast('Registra al menos un método de pago.', true); return; }
        state.transactions.push({
          id: uid(), timestamp: Date.now(),
          stationName: ctx.stationName, consoleName: ctx.consoleName,
          plannedHours: ctx.hours,
          costUsd: ctx.costUsd, costBs: ctx.costBs, bcvRateUsed: state.bcv.rate,
          type: ctx.txType,
          payments
        });
        ctx.applyEffect();
        persist(); closeModal(); renderMain();
        showToast(ctx.txType==='extension' ? 'Extensión pagada y añadida al tiempo.' : 'Pago registrado. Estación activada.');
      };
    }
  };
  renderModal();
}

/* ======================= INICIO ======================= */
init();
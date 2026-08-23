// nxrzoom_ — app logic
const $ = (s) => document.querySelector(s);

// ===== buy links: deep-link per token (mint) =====
function mintFor(token){
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let h = 0;
  for(const ch of token) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let out = '';
  let x = h || 1;
  while(out.length < 44){
    x = (x * 1103515245 + 12345) >>> 0;
    out += B58[x % 58];
  }
  return out;
}

function buyLinks(token){
  const mint = mintFor(token);
  return [
    { label:'axiom',    url:`https://axiom.trade/t/${mint}`,        hot:true },
    { label:'gmgn',     url:`https://gmgn.ai/sol/token/${mint}` },
    { label:'trojan',   url:`https://t.me/solana_trojanbot?start=r-${mint}` },
    { label:'pump.fun', url:`https://pump.fun/coin/${mint}` },
    { label:'dexscreener', url:`https://dexscreener.com/solana/${mint}` }
  ];
}

// ===== render: top calls =====
function renderCalls(){
  $('#topCalls').innerHTML = DATA.topCalls.map((c,i)=>{
    const links = buyLinks(c.token)
      .map(l=>`<a class="buyl${l.hot?' hot':''}" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('');
    return `
    <a class="call" href="${buyLinks(c.token)[0].url}" target="_blank" rel="noopener">
      <span class="rank">${String(i+1).padStart(2,'0')}</span>
      <div>
        <div class="call-token">${c.token}</div>
        <div class="call-meta">${c.time} · ${c.cap} · ${c.w}w</div>
      </div>
      <div>
        <div class="call-x">${c.x}</div>
        <div class="call-pct">${c.pct}</div>
      </div>
      <span class="call-links">${links}</span>
    </a>`;
  }).join('');
}

// ===== render: live feed =====
function feedRowHTML(item, isNew=false){
  const links = buyLinks(item.token)
    .map(l=>`<a class="buyl${l.hot?' hot':''}" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('');
  return `
  <li class="fitem${isNew?' new':''}">
    <button class="frow" aria-expanded="false">
      <span class="wbadge">${item.w} w</span>
      <span class="ftoken">${item.token}</span>
      <span class="fmcap">${item.mcap||''}</span>
      <span class="ftime">${item.t}</span>
      <span class="farrow">▾</span>
    </button>
    <div class="buyrow" hidden><span hidden></span></div>
  </li>`;
}

// after insert, fill real links
function hydrateBuyRow(li, token){
  li.querySelector('.buyrow').innerHTML =
    `<span class="buylabel">buy on</span>` +
    buyLinks(token).map(l=>`<a class="buyl${l.hot?' hot':''}" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('');
}

function renderFeed(){
  const list = $('#feedList');
  list.innerHTML = DATA.feed.map(f=>feedRowHTML(f)).join('');
  list.querySelectorAll('.fitem').forEach((li,i)=>hydrateBuyRow(li, DATA.feed[i].token));
}

// expand/collapse — event delegation so it works for new rows too
$('#feedList').addEventListener('click', (e)=>{
  if(e.target.closest('.buyl')) return; // don't toggle when clicking a link
  const row = e.target.closest('.frow');
  if(!row) return;
  const buyrow = row.nextElementSibling;
  const open = !buyrow.hidden;
  buyrow.hidden = open;
  row.setAttribute('aria-expanded', String(!open));
});

// ===== render: trending table =====
function pctSpan(v){
  const cls = v.startsWith('+') ? 'green' : v.startsWith('-') ? 'red' : 'muted';
  return `<span class="${cls}">${v}</span>`;
}

let sortKey = 'd'; // 'd' | 'h24'
let sortDir = 1;

function renderTable(){
  let rows = [...DATA.trending];
  if(sortKey === 'd')        rows.sort((a,b)=>(b.d-a.d)*sortDir);
  if(sortKey === 'h24')      rows.sort((a,b)=>(parseFloat(b.h24)-parseFloat(a.h24))*sortDir);
  $('#tokenRows').innerHTML = rows.map(t=>{
    const mint = mintFor('$'+t.sym);
    return `
    <a class="trow" href="https://dexscreener.com/solana/${mint}" target="_blank" rel="noopener">
      <span><span class="tt-name">${t.name}</span><span class="tt-sym">$${t.sym}</span></span>
      <span class="tc-created">${t.d}d</span>
      ${pctCell(t.h1)}${pctCell(t.h6,'h6c')}${pctCell(t.h24)}
      <span class="num vol volc">${t.vol}</span>
      <span class="num mcap mcapt">${t.mcap}</span>
    </a>`;
  }).join('');
}

function pctCell(v, extra=''){
  const cls = v.startsWith('+') ? 'green' : v.startsWith('-') ? 'red' : 'muted';
  return `<span class="num ${extra}"><span class="${cls}">${v}</span></span>`;
}

// ===== render: signals =====
function renderSignals(filter='hot'){
  let list = [...DATA.signals];
  if(filter==='hot') list.sort((a,b)=>b.s-a.s);
  if(filter==='new') list = list.filter(s=>s.isNew).concat(list.filter(s=>!s.isNew));
  if(filter==='projects') list = list.filter(s=>s.type==='projects');
  if(filter==='people')   list = list.filter(s=>s.type==='people');

  $('#signalList').innerHTML = list.length ? list.map((s,i)=>`
    <li class="sig">
      <span class="sigrank">${String(i+1).padStart(2,'0')}</span>
      <span class="sigavatar">${s.n.charAt(0)}</span>
      <div class="sig-info">
        <div><span class="sig-name">${s.n}</span> <span class="sig-handle">${s.h}</span></div>
        <div class="sig-desc">${s.d}</div>
      </div>
      <div>
        <div class="sig-score">+${s.s}</div>
        <div class="sig-foll">${s.f} foll</div>
      </div>
    </li>`).join('')
    : `<li class="sig-empty muted">nothing here yet — check back soon.</li>`;
}

// ===== filters =====
function applyFilters(){
  const min = parseFloat($('#walletsMin').value);
  const max = parseFloat($('#walletsMax').value);
  const mcMin = parseFloat($('#mcapMin').value);   // in K
  const mcMax = parseFloat($('#mcapMax').value);   // in K
  const q = ($('#tickerFilter').value || '').toLowerCase().replace('$','');
  const sq = ($('#searchInput').value || '').toLowerCase().replace('$','');

  const parseK = (str)=>{
    if(!str) return NaN;
    const n = parseFloat(str.replace(/[^0-9.]/g,''));
    if(isNaN(n)) return NaN;
    return /m/i.test(str) ? n*1000 : n; // M→K
  };

  document.querySelectorAll('#feedList .fitem').forEach(li=>{
    const w = parseInt(li.querySelector('.wbadge').textContent)||0;
    const tokEl = li.querySelector('.ftoken');
    const tok = (tokEl?tokEl.textContent:'').toLowerCase().replace('$','');
    const mcRaw = li.querySelector('.fmcap').textContent;
    const mcK = parseK(mcRaw);

    let ok = true;
    if(!isNaN(min)) ok = ok && w>=min;
    if(!isNaN(max)) ok = ok && w<=max;
    if(!isNaN(mcMin)) ok = ok && !isNaN(mcK) && mcK>=mcMin;
    if(!isNaN(mcMax)) ok = ok && !isNaN(mcK) && mcK<=mcMax;
    if(q)  ok = ok && tok.includes(q);
    if(sq) ok = ok && tok.includes(sq);
    li.style.display = ok ? '' : 'none';
  });
}
['walletsMin','walletsMax','mcapMin','mcapMax','tickerFilter'].forEach(id=>$('#'+id).addEventListener('input',applyFilters));
$('#searchInput').addEventListener('input',applyFilters);

// ===== pause / resume =====
let paused = false;
$('#pauseBtn').addEventListener('click',()=>{
  paused = !paused;
  $('#pauseBtn').textContent = paused ? 'resume' : 'pause';
});

// ===== tabs: trending =====
document.querySelectorAll('[data-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    if(tab==='new'){
      sortKey='d'; sortDir=1;            // newest first
    } else if(tab==='trending'){
      sortKey='h24'; sortDir=-1;         // biggest gainers first
    } else {
      sortKey='d'; sortDir=-1;
    }
    renderTable();
  });
});

// ===== tabs: signals =====
document.querySelectorAll('[data-sig]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-sig]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderSignals(btn.dataset.sig);
  });
});

// ===== live simulation =====
const NEW_TOKENS = ['$MOON','$GIGA','$ALPHA','$SIGMA','$WOJAK','$FLOKI','$BASED'];
function pushFeedItem(){
  if(paused) return;
  const t = NEW_TOKENS[Math.floor(Math.random()*NEW_TOKENS.length)];
  const item = {
    w: Math.floor(Math.random()*14)+2,
    token: t,
    mcap: '$'+(Math.floor(Math.random()*900)+20)+'K',
    t: 'now'
  };
  $('#feedList').insertAdjacentHTML('afterbegin', feedRowHTML(item,true));
  const first = $('#feedList .fitem');
  hydrateBuyRow(first, item.token);
  // bump timestamps of older rows
  document.querySelectorAll('#feedList .ftime').forEach((el,i)=>{
    if(i===0) return;
    const cur = el.textContent;
    if(cur==='now'){ el.textContent='1m'; return; }
    const m = parseInt(cur);
    if(!isNaN(m) && m<15) el.textContent = (m+1)+'m';
  });
  const rows = document.querySelectorAll('#feedList .fitem');
  if(rows.length>14) rows[rows.length-1].remove();
  applyFilters();
}
setInterval(pushFeedItem, 8000);

renderCalls(); renderFeed(); renderTable(); renderSignals();

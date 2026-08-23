// nxrzoom_ — app logic (live dexscreener data)
const $ = (s) => document.querySelector(s);

// ===== render: top calls =====
function renderCalls(pairs){
  const ranked = [...pairs]
    .filter(p=>p.priceChange && p.priceChange.h24 != null)
    .sort((a,b)=>(b.priceChange.h24)-(a.priceChange.h24))
    .slice(0,6);
  $('#topCalls').innerHTML = ranked.map((p,i)=>{
    const mint = p.baseToken.address;
    const x = multOf(p.priceChange.h24).toFixed(2)+'x';
    const pct = (p.priceChange.h24>=0?'+':'')+Number(p.priceChange.h24).toFixed(1)+'%';
    const cap = `${fmtUsd(Number(p.priceUsd)*(p.fdv||0))} · ${fmtUsd((p.liquidity&&p.liquidity.usd)||0)} liq`;
    const links = buyLinks(mint, p.url)
      .map(l=>`<a class="buyl${l.hot?' hot':''}" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('');
    return `
    <div class="call">
      <span class="rank">${String(i+1).padStart(2,'0')}</span>
      <div>
        <div class="call-token">${esc(p.baseToken.symbol)}</div>
        <div class="call-meta">${fmtAge(p.pairCreatedAt)} · ${cap}</div>
      </div>
      <div>
        <div class="call-x">${x}</div>
        <div class="call-pct">${pct}</div>
      </div>
      <span class="call-links">${links}</span>
    </div>`;
  }).join('');
}

function esc(s){
  return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== render: live feed =====
function feedRowHTML(p, isNew=false){
  const mint = p.baseToken.address;
  const buys = p.txns && p.txns.m5 ? p.txns.m5.buys : 0;
  const links = buyLinks(mint, p.url)
    .map(l=>`<a class="buyl${l.hot?' hot':''}" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('');
  return `
  <li class="fitem${isNew?' new':''}" data-mint="${mint}" data-mcap="${Math.round((Number(p.priceUsd)*(p.fdv||0))/1000)||0}">
    <button class="frow" aria-expanded="false">
      <span class="wbadge">${buys} b</span>
      <span class="ftoken">$${esc(p.baseToken.symbol)}</span>
      <span class="fmcap">${fmtUsd(Number(p.priceUsd)*(p.fdv||0))}</span>
      <span class="ftime">${fmtAge(p.pairCreatedAt)}</span>
      <span class="farrow">▾</span>
    </button>
    <div class="buyrow" hidden><span class="buylabel">buy on</span>${links}</div>
  </li>`;
}

function renderFeed(pairs){
  // freshest pairs first
  const rows = [...pairs].sort((a,b)=>(b.pairCreatedAt||0)-(a.pairCreatedAt||0));
  $('#feedList').innerHTML = rows.map(p=>feedRowHTML(p)).join('');
}

// expand/collapse — delegation so it works for all rows
$('#feedList').addEventListener('click', (e)=>{
  if(e.target.closest('.buyl')) return;
  const row = e.target.closest('.frow');
  if(!row) return;
  const buyrow = row.nextElementSibling;
  const open = !buyrow.hidden;
  buyrow.hidden = open;
  row.setAttribute('aria-expanded', String(!open));
});

// ===== render: trending table =====
let sortMode = 'vol'; // 'vol' | 'gain' | 'new'

function renderTable(pairs){
  let rows = [...pairs];
  if(sortMode==='new')       rows.sort((a,b)=>(b.pairCreatedAt||0)-(a.pairCreatedAt||0));
  else if(sortMode==='gain') rows.sort((a,b)=>(b.priceChange?.h24??-999)-(a.priceChange?.h24??-999));
  else                       rows.sort((a,b)=>((b.volume&&b.volume.h24)||0)-((a.volume&&a.volume.h24)||0));

  $('#tokenRows').innerHTML = rows.slice(0,12).map(p=>{
    const mint = p.baseToken.address;
    const pc = (v)=> v==null ? '<span class="muted">—</span>' : `<span class="${v>=0?'green':'red'}">${v>=0?'+':''}${Number(v).toFixed(v>100?0:2)}%</span>`;
    return `
    <a class="trow" href="${p.url||`https://dexscreener.com/solana/${mint}`}" target="_blank" rel="noopener">
      <span><span class="tt-name">${esc(p.baseToken.name===p.baseToken.symbol?p.baseToken.name:p.baseToken.name)}</span><span class="tt-sym">$${esc(p.baseToken.symbol)}</span></span>
      <span class="tc-created">${fmtAge(p.pairCreatedAt)}</span>
      <span class="num">${pc(p.priceChange?.h1)}</span>
      <span class="num h6c">${pc(p.priceChange?.h6)}</span>
      <span class="num">${pc(p.priceChange?.h24)}</span>
      <span class="num vol volc">${fmtUsd(p.volume&&p.volume.h24)}</span>
      <span class="num mcap mcapt">${fmtUsd(Number(p.priceUsd)*(p.fdv||0))}</span>
    </a>`;
  }).join('');
}

// ===== render: signals (derived from live momentum) =====
function renderSignals(pairs, filter='hot'){
  let list = [...pairs];
  if(filter==='hot')      list.sort((a,b)=>((b.volume&&b.volume.h1)||0)-((a.volume&&a.volume.h1)||0));
  if(filter==='new')      list.sort((a,b)=>(b.pairCreatedAt||0)-(a.pairCreatedAt||0));
  if(filter==='projects') list.sort((a,b)=>((b.liquidity&&b.liquidity.usd)||0)-((a.liquidity&&a.liquidity.usd)||0));
  if(filter==='people')   list.sort((a,b)=>((b.txns?.h24?.buys)||0)-((a.txns?.h24?.buys)||0));

  $('#signalList').innerHTML = list.slice(0,8).map((p,i)=>{
    const score = Math.max(1, Math.min(9, Math.round(((p.volume&&p.volume.h24)||0)/5e4)));
    return `
    <li class="sig">
      <span class="sigrank">${String(i+1).padStart(2,'0')}</span>
      <span class="sigavatar">${esc(p.baseToken.symbol.charAt(0))}</span>
      <div class="sig-info">
        <div><span class="sig-name">${esc(p.baseToken.name)}</span> <span class="sig-handle">$${esc(p.baseToken.symbol)}</span></div>
        <div class="sig-desc">${fmtUsd((p.liquidity&&p.liquidity.usd)||0)} liq · ${fmtUsd(p.volume&&p.volume.h24)} vol 24h · ${(p.txns&&p.txns.h24?p.txns.h24.buys:0)} buys</div>
      </div>
      <div>
        <div class="sig-score">+${score}</div>
        <div class="sig-foll">${(p.priceChange&&p.priceChange.h24!=null)?((p.priceChange.h24>=0?'+':'')+Number(p.priceChange.h24).toFixed(1)+'%'):'—'}</div>
      </div>
    </li>`;
  }).join('');
}

// ===== filters =====
function applyFilters(){
  const num = (id)=>{ const v = parseFloat($(id).value); return isNaN(v)?null:v; };
  const min = num('#walletsMin'), max = num('#walletsMax');
  const mcMin = num('#mcapMin'), mcMax = num('#mcapMax');
  const q = ($('#tickerFilter').value||'').toLowerCase().replace('$','');
  const sq = ($('#searchInput').value||'').toLowerCase().replace('$','');

  document.querySelectorAll('#feedList .fitem').forEach(li=>{
    const w = parseInt(li.querySelector('.wbadge').textContent)||0;
    const tok = li.querySelector('.ftoken').textContent.toLowerCase().replace('$','');
    const mcK = parseInt(li.dataset.mcap)||0;
    let ok = true;
    if(min!=null)   ok = ok && w>=min;
    if(max!=null)   ok = ok && w<=max;
    if(mcMin!=null) ok = ok && mcK>=mcMin;
    if(mcMax!=null) ok = ok && mcK<=mcMax;
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

// ===== tabs =====
document.querySelectorAll('[data-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    sortMode = btn.dataset.tab==='trending' ? 'gain' : btn.dataset.tab==='new' ? 'new' : 'vol';
    renderTable(window.__PAIRS__||[]);
  });
});
document.querySelectorAll('[data-sig]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-sig]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderSignals(window.__PAIRS__||[], btn.dataset.sig);
  });
});

// ===== live refresh =====
async function refresh(){
  if(paused && window.__PAIRS__) return;
  try{
    const addrs = await DS.universe();
    const pairs = await DS.pairs(addrs);
    if(!pairs.length) throw new Error('empty');
    window.__PAIRS__ = pairs;
    renderCalls(pairs);
    renderFeed(pairs);
    renderTable(pairs);
    renderSignals(pairs, document.querySelector('[data-sig].active')?.dataset.sig || 'hot');
    applyFilters();
    const el = $('#updatedAt');
    if(el) el.textContent = 'just now';
  }catch(err){
    const el = $('#updatedAt');
    if(el && !window.__PAIRS__) el.textContent = 'reconnecting…';
  }
}

refresh();
setInterval(refresh, 60000); // dexscreener rate limit friendly

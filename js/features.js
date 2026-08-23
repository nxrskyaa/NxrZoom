// nxrzoom_ — scan + smart money alerts (client-side, no backend)

// ===== SCAN WALLET =====
const RPC = 'https://api.mainnet-beta.solana.com';

async function rpc(method, params){
  const r = await fetch(RPC, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0', id:1, method, params})
  });
  if(!r.ok) throw new Error('rpc http '+r.status);
  const j = await r.json();
  if(j.error) throw new Error(j.error.message);
  return j.result;
}

function isSolAddr(a){ return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim()); }
function short(a){ return a.slice(0,4)+'…'+a.slice(-4); }

async function scanWallet(addr){
  // balance
  let sol = 0;
  try{
    const bal = await rpc('getBalance', [addr]);
    sol = bal.value / 1e9;
  }catch(e){ /* keep 0 */ }

  // token accounts (holdings)
  const holdings = [];
  try{
    const ta = await rpc('getTokenAccountsByOwner', [
      addr,
      {programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},
      {encoding:'jsonParsed'}
    ]);
    for(const acc of (ta.value||[])){
      try{
        const info = acc.account.data.parsed.info;
        const amt = info.tokenAmount;
        if(!amt || Number(amt.uiAmount||0) <= 0) continue;
        const mint = info.mint;
        // lookup price/metadata via dexscreener
        let meta = null;
        try{
          const ds = await fetch('https://api.dexscreener.com/tokens/v1/solana/'+mint).then(r=>r.json());
          if(Array.isArray(ds) && ds.length){
            const best = ds.sort((a,b)=>((b.liquidity&&b.liquidity.usd)||0)-((a.liquidity&&a.liquidity.usd)||0))[0];
            meta = best;
          }
        }catch(e){}
        const uiAmt = Number(amt.uiAmount);
        const price = meta ? Number(meta.priceUsd) : null;
        holdings.push({
          mint,
          amount: uiAmt,
          symbol: meta ? meta.baseToken.symbol : null,
          name: meta ? meta.baseToken.name : null,
          usd: price != null ? uiAmt*price : null,
          liq: meta && meta.liquidity ? meta.liquidity.usd : null,
          chg24: meta && meta.priceChange ? meta.priceChange.h24 : null,
          url: meta ? meta.url : `https://dexscreener.com/solana/${mint}`
        });
      }catch(e){}
    }
  }catch(e){}

  // recent activity signature count
  let sigCount = 0;
  try{
    const sigs = await rpc('getSignaturesForAddress', [addr, {limit: 20}]);
    sigCount = (sigs||[]).length;
  }catch(e){}

  return { addr, sol, holdings: holdings.sort((a,b)=>(b.usd||0)-(a.usd||0)), sigCount };
}

async function doScan(){
  const input = $('#scanInput');
  const out = $('#scanResult');
  const addr = (input.value||'').trim();
  if(!isSolAddr(addr)){
    out.hidden = false;
    out.innerHTML = `<p class="scan-err">address gak valid — paste solana wallet address yang bener.</p>`;
    return;
  }
  out.hidden = false;
  out.innerHTML = `<p class="muted">scanning ${short(addr)} …</p>`;
  $('#scanGo').disabled = true;
  try{
    const res = await scanWallet(addr);
    renderScan(res);
  }catch(e){
    out.innerHTML = `<p class="scan-err">gagal scan — RPC rate limit. coba lagi 10 detik.</p>`;
  }finally{
    $('#scanGo').disabled = false;
  }
}

function renderScan({addr, sol, holdings, sigCount}){
  const totalUsd = holdings.reduce((s,h)=>s+(h.usd||0),0);
  const rows = holdings.slice(0,15).map(h=>`
    <a class="trow" href="${h.url}" target="_blank" rel="noopener">
      <span><span class="tt-name">${esc(h.symbol||'unknown')}</span><span class="tt-sym">${short(h.mint)}</span></span>
      <span class="tc-created">${h.amount<1?h.amount.toPrecision(3):h.amount.toLocaleString('en-US',{maximumFractionDigits:0})}</span>
      <span class="num">${h.usd!=null?'<span class="green">'+fmtUsd(h.usd)+'</span>':'<span class="muted">—</span>'}</span>
      <span class="num h6c">${h.liq!=null?fmtUsd(h.liq):'—'}</span>
      <span class="num">${h.chg24!=null?`<span class="${h.chg24>=0?'green':'red'}">${h.chg24>=0?'+':''}${Number(h.chg24).toFixed(1)}%</span>`:'—'}</span>
    </a>`).join('');

  const score = Math.min(9,
    Math.floor(totalUsd/10000) +
    Math.floor(sol/10) +
    Math.min(2, Math.floor(sigCount/10))
  );

  $('#scanResult').innerHTML = `
    <div class="scanhead">
      <div>
        <div class="sig-name">${short(addr)}</div>
        <div class="tc-created">${sigCount} recent tx · ${sol.toFixed(3)} SOL</div>
      </div>
      <div style="text-align:right">
        <div class="call-x">${fmtUsd(totalUsd)}</div>
        <div class="sig-foll">est. token value</div>
      </div>
    </div>
    ${rows ? `<div class="panel scanpanel">
      <div class="thead"><span class="tc-token">token</span><span class="tc-created">amount</span><span class="num">value</span><span class="num h6c">liq</span><span class="num">24h</span></div>
      <div>${rows}</div>
    </div>` : `<p class="muted" style="padding:14px 0">no priced tokens found — mungkin semua di SOL / token gabutu harga.</p>`}
  `;
}

$('#scanGo').addEventListener('click', doScan);
$('#scanInput').addEventListener('keydown', e=>{ if(e.key==='Enter') doScan(); });

// ===== SMART MONEY ALERTS =====
const seenMints = new Set(JSON.parse(localStorage.getItem('nxz_seen')||'[]'));
let alertPrefs = JSON.parse(localStorage.getItem('nxz_alerts')||'null') || {enabled:false, minBuys:50, minChg:100};
let newAlerts = [];

// browser notification permission on first toggle
async function askNotifPerm(){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default'){ try{ await Notification.requestPermission(); }catch(e){} }
}

function notify(p){
  if(!('Notification' in window) || Notification.permission!=='granted') return;
  try{
    new Notification('$'+p.baseToken.symbol+' moving', {
      body:`+${Number(p.priceChange.h24).toFixed(0)}% 24h · ${p.txns.h24.buys} buys · vol ${fmtUsd(p.volume&&p.volume.h24)}`,
      tag: p.baseToken.address
    });
  }catch(e){}
}

function checkAlerts(pairs){
  if(!alertPrefs.enabled) return;
  newAlerts = pairs.filter(p =>
    p.priceChange && p.priceChange.h24 != null &&
    p.priceChange.h24 >= alertPrefs.minChg &&
    p.txns && p.txns.h24 &&
    p.txns.h24.buys >= alertPrefs.minBuys
  );
  const badge = $('#alertBadge');
  if(badge){
    badge.hidden = newAlerts.length===0;
    badge.textContent = String(newAlerts.length);
  }
  if(newAlerts.length) notify(newAlerts[0]);
}

function renderAlertPanel(){
  const panel = $('#alertPanel');
  if(!panel) return;
  panel.innerHTML = `
    <div class="alertrow">
      <label class="switch">
        <input type="checkbox" id="alertOn" ${alertPrefs.enabled?'checked':''}>
        <span>smart money alerts</span>
      </label>
      <div class="alertcfg">
        <label>min buys 24h <input type="number" id="alertMinBuys" value="${alertPrefs.minBuys}" min="0"></label>
        <label>min gain % <input type="number" id="alertMinChg" value="${alertPrefs.minChg}" min="0"></label>
      </div>
    </div>
    <div class="alertlist">
      ${newAlerts.length ? newAlerts.map(p=>{
        const links = buyLinks(p.baseToken.address, p.url)
          .map(l=>`<a class="buyl${l.hot?' hot':''}" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('');
        return `<div class="alertitem">
          <div>
            <div><span class="ftoken">$${esc(p.baseToken.symbol)}</span> <span class="fmcap">${fmtUsd(mcapOf(p))}</span></div>
            <div class="sig-desc"><span class="green">+${Number(p.priceChange.h24).toFixed(0)}%</span> · ${p.txns.h24.buys} buys · ${fmtUsd(p.volume&&p.volume.h24)} vol</div>
          </div>
          <div class="buyrow-inline">${links}</div>
        </div>`;
      }).join('') : `<p class="muted">belum ada alert — aktifin switch &amp; tunggu token yang lolos filter.</p>`}
    </div>
    <p class="tg-note muted">mau push ke HP? connect telegram bot nanti di banner bawah.</p>
  `;

  panel.querySelector('#alertOn').addEventListener('change', async (e)=>{
    alertPrefs.enabled = e.target.checked;
    localStorage.setItem('nxz_alerts', JSON.stringify(alertPrefs));
    if(alertPrefs.enabled) await askNotifPerm();
    checkAlerts(window.__PAIRS__||[]);
  });
  panel.querySelector('#alertMinBuys').addEventListener('change', e=>{
    alertPrefs.minBuys = parseInt(e.target.value)||0;
    localStorage.setItem('nxz_alerts', JSON.stringify(alertPrefs));
    checkAlerts(window.__PAIRS__||[]);
  });
  panel.querySelector('#alertMinChg').addEventListener('change', e=>{
    alertPrefs.minChg = parseInt(e.target.value)||0;
    localStorage.setItem('nxz_alerts', JSON.stringify(alertPrefs));
    checkAlerts(window.__PAIRS__||[]);
  });
}

// dropdown toggle
$('#alertBtn').addEventListener('click', ()=>{
  const dd = $('#alertDropdown');
  const open = !dd.hidden;
  dd.hidden = open;
  if(!open){ renderAlertPanel(); $('#alertBadge').hidden = true; }
});
document.addEventListener('click', e=>{
  const dd = $('#alertDropdown'), btn = $('#alertBtn');
  if(dd && !dd.hidden && !e.target.closest('#alertDropdown') && !e.target.closest('#alertBtn')) dd.hidden = true;
});

// hook into refresh loop
const _origRefreshDone = () => {};
setInterval(()=>checkAlerts(window.__PAIRS__||[]), 30000);

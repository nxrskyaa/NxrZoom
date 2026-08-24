// nxrzoom_ — scan (token CA) + nft tracker
const $f = (s) => document.querySelector(s);

// ===== SCAN TOKEN =====
function isSolAddr(a){ return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((a||'').trim()); }
function short(a){ return a ? a.slice(0,4)+'…'+a.slice(-4) : ''; }

async function doScan(){
  const input = $f('#scanInput');
  const out = $f('#scanResult');
  const ca = (input.value||'').trim();
  if(!isSolAddr(ca)){
    out.hidden = false;
    out.innerHTML = `<p class="scan-err">CA gak valid — paste solana contract address yang bener.</p>`;
    return;
  }
  out.hidden = false;
  out.innerHTML = `<p class="muted pad">scanning ${short(ca)} …</p>`;
  $f('#scanGo').disabled = true;
  try{
    const r = await fetch('/api/scan?ca='+encodeURIComponent(ca));
    const d = await r.json();
    if(!r.ok || d.error) throw new Error(d.error||'fail');
    renderScan(d);
  }catch(e){
    out.innerHTML = `<p class="scan-err">scan gagal — coba lagi sebentar.</p>`;
  }finally{
    $f('#scanGo').disabled = false;
  }
}

function renderScan(d){
  const chg = d.chg && d.chg.h24!=null ? `<span class="${d.chg.h24>=0?'green':'red'}">${d.chg.h24>=0?'+':''}${Number(d.chg.h24).toFixed(1)}% 24h</span>` : '';
  const holderRows = (d.holders||[]).slice(0,10).map((h,i)=>`
    <div class="trow holder-row">
      <span><span class="tt-name">${String(i+1).padStart(2,'0')}</span> <span class="tc-created monoaddr">${h.short}</span></span>
      <span class="num">${h.uiAmount.toLocaleString('en-US',{maximumFractionDigits:0})}</span>
      <span class="num h6c">${h.pctOfSupply!=null?h.pctOfSupply.toFixed(2)+'%':'—'}</span>
      <span class="num"><a class="buyl" target="_blank" rel="noopener" href="https://solscan.io/account/${h.address}">solscan</a></span>
    </div>`).join('');

  $f('#scanResult').innerHTML = `
    <div class="scanhead">
      <div>
        <div class="sig-name">${esc2(d.symbol||'unknown')} <span class="sig-handle">${esc2(d.name||'')}</span></div>
        <div class="tc-created monoaddr">${short(d.ca)}</div>
        ${chg}
      </div>
      <div style="text-align:right">
        <div class="call-x">${d.priceUsd?'$'+Number(d.priceUsd).toPrecision(4):'—'}</div>
        <div class="sig-foll">mcap ${fmtUsd2(d.mcap)} · liq ${fmtUsd2(d.liq)} · vol24 ${fmtUsd2(d.vol24)}</div>
      </div>
    </div>

    <div class="call-links" style="margin:12px 0">
      <a class="buyl hot" href="${d.buyLinks.axiom}" target="_blank" rel="noopener">axiom</a>
      <a class="buyl" href="${d.buyLinks.gmgn}" target="_blank" rel="noopener">gmgn</a>
      <a class="buyl" href="${d.buyLinks.trojan}" target="_blank" rel="noopener">trojan</a>
      <a class="buyl" href="${d.buyLinks.pumpfun}" target="_blank" rel="noopener">pump.fun</a>
      <a class="buyl" href="${d.dsUrl}" target="_blank" rel="noopener">dexscreener</a>
      <a class="buyl" href="https://solscan.io/token/${d.ca}" target="_blank" rel="noopener">solscan</a>
    </div>

    ${holderRows?`
    <h3 class="subhead muted">top holders${d.supply?` <span class="tc-created">· supply ${Number(d.supply).toLocaleString('en-US',{maximumFractionDigits:0})}</span>`:''}</h3>
    <div class="panel scanpanel">
      <div class="thead"><span class="tc-token">rank / wallet</span><span class="num">balance</span><span class="num h6c">% supply</span><span class="num">link</span></div>
      <div>${holderRows}</div>
    </div>`:'<p class="muted pad">holder data unavailable — token mungkin terlalu baru atau rpc sibuk.</p>'}
  `;
}

if($f('#scanGo')) $f('#scanGo').addEventListener('click', doScan);
if($f('#scanInput')) $f('#scanInput').addEventListener('keydown', e=>{ if(e.key==='Enter') doScan(); });

// ===== NFT TRACKER =====
var solUsd = 210;

const TYPE_LABEL = {list:'listed', bid:'bid', sell:'sold', buy:'bought'};
const fmtSol = (l)=> l!=null ? (l/1e9).toFixed(2)+' SOL' : '—';
function esc2(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtUsd2(n){ if(n==null||isNaN(n))return '—'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+(n/1e3).toFixed(1)+'K'; return '$'+Number(n).toFixed(0); }
const ago = (ts)=>{ if(!ts)return''; const s=Date.now()/1000-ts; if(s<60)return Math.floor(Math.max(1,s))+'s'; if(s<3600)return Math.floor(s/60)+'m'; return Math.floor(s/3600)+'h'; };
const fpChgTxt = (v)=>{
  if(v==null) return '<span class="muted">—</span>';
  const pct = Number(v*100);
  return `<span class="${pct>=0?'green':'red'}">${pct>=0?'+':''}${pct.toFixed(1)}%</span>`;
};


// ===== DEGEN FREE MINTS (ink & robinhood via opensea) =====
let degenData = null;
let degenChain = 'ink';

function renderDegen(){
  if(!degenData || !$f('#degenGrid')) return;
  const list = degenChain==='ink' ? (degenData.ink||[]) : (degenData.robinhood||[]);
  $f('#degenGrid').innerHTML = list.length ? list.map(c=>{
    const isFree = c.floorUsd===0 || c.floorUsd==null;
    const stage = c.anyActiveStage ? '<span class="sweep-tag">LIVE MINT</span>' :
      c.nextStageStart ? `<span class="na-time">next window ${new Date(c.nextStageStart).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>` : '';
    return `
    <a class="nftcard" href="https://opensea.io/collection/${c.slug}" target="_blank" rel="noopener">
      ${c.image?`<img src="/api/img?url=${encodeURIComponent(c.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`:''}
      <div class="nftc-info">
        <span class="nftc-name">${esc2(c.name)}${c.verified?' <span class="green">✓</span>':''} ${stage}</span>
        <span class="nftc-floor">${isFree?'<span class="green">free / near-free</span>':'floor ~$'+Number(c.floorUsd).toFixed(0)}</span>
        ${c.supply?`<span class="nftc-vol">supply ${c.supply.toLocaleString('en-US')}</span>`:''}
      </div>
    </a>`;
  }).join('') : `<p class="muted pad">no free/near-free mints on ${degenChain} right now — check back.</p>`;
}

document.querySelectorAll('[data-chain]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-chain]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    degenChain = btn.dataset.chain;
    renderDegen();
  });
});

async function loadDegen(){
  if(!$f('#degenGrid')) return;
  try{
    const r = await fetch('/api/degen');
    const d = await r.json();
    if(!r.ok) throw new Error();
    degenData = d;
    renderDegen();
  }catch(e){
    if($f('#degenGrid')) $f('#degenGrid').innerHTML = '<p class="muted pad">opensea radar unavailable — retry later.</p>';
  }
}
loadDegen();
setInterval(loadDegen, 180000);

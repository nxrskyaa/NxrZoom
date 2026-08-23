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

$f('#scanGo').addEventListener('click', doScan);
$f('#scanInput').addEventListener('keydown', e=>{ if(e.key==='Enter') doScan(); });

// ===== NFT TRACKER =====
let solUsd = 210;

function fmtSol(lamports){
  return lamports!=null ? (lamports/1e9).toFixed(3)+' SOL' : '—';
}
function fmtEthStyle(sol){ return solUsd ? `($${Math.round(sol*solUsd)})` : ''; }
function esc2(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtUsd2(n){ if(n==null||isNaN(n))return '—'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+(n/1e3).toFixed(1)+'K'; return '$'+Number(n).toFixed(0); }
function ago(ts){ if(!ts)return''; const s=Date.now()/1000-ts; if(s<60)return Math.floor(s)+'s'; if(s<3600)return Math.floor(s/60)+'m'; return Math.floor(s/3600)+'h'; }

async function loadNft(){
  try{
    const r = await fetch('/api/nft');
    const d = await r.json();
    if(!r.ok) throw new Error();
    solUsd = d.solUsd || 210;

    // collections grid
    $f('#nftGrid').innerHTML = (d.collections||[]).slice(0,8).map(c=>{
      const fpChg = c.fpChange24h!=null ? `<span class="${c.fpChange24h>=0?'green':'red'}">${c.fpChange24h>=0?'+':''}${Number(c.fpChange24h*100).toFixed(1)}%</span>` : '<span class="muted">—</span>';
      return `
      <a class="nftcard" href="https://magiceden.io/collections/solana/${c.symbol}" target="_blank" rel="noopener">
        <img src="${esc2(c.image||'')}" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="nftc-info">
          <span class="nftc-name">${esc2(c.name)}</span>
          <span class="nftc-floor">FP ${fmtSol(c.floor)} · ${fpChg}</span>
          <span class="nftc-vol">vol24 ${fmtUsd2((c.vol24hr||0)*solUsd)} · ${c.listedCount??'—'} listed</span>
        </div>
      </a>`;
    }).join('');

    // activity feed — group by signature to detect sweeps
    const bySig = {};
    for(const a of (d.activities||[])){
      if(a.type!=='sell'&&a.type!=='buy') continue;
      (bySig[a.signature] = bySig[a.signature]||{count:0,total:0,collection:a.collectionSymbol,sig:a.signature,blockTime:a.blockTime,buyer:a.buyer,seller:a.seller});
      bySig[a.signature].count++;
      bySig[a.signature].total += Number(a.price||0);
    }
    const events = Object.values(bySig)
      .sort((a,b)=>(b.blockTime||0)-(a.blockTime||0))
      .slice(0,12);

    $f('#nftFeed').innerHTML = events.length ? events.map(e=>{
      const isSweep = e.count >= 3;
      return `
      <li class="nftitem${isSweep?' sweep':''}">
        <div>
          <div>${isSweep?'<span class="sweep-tag">SWEEP</span> ':''}<span class="ftoken">${e.count}x sale${e.count>1?'s':''}</span> <span class="fmcap">${esc2(e.collection)}</span></div>
          <div class="sig-desc">${e.total.toFixed(2)} SOL ${fmtEthStyle(e.total)} · by ${short(e.seller||e.buyer)} · ${ago(e.blockTime)} ago</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          <a class="buyl" href="https://magiceden.io/collections/solana/${e.collection}" target="_blank" rel="noopener">collection</a>
          <a class="buyl" href="https://solscan.io/tx/${e.sig}" target="_blank" rel="noopener">tx</a>
        </div>
      </li>`;
    }).join('') : '<li class="muted pad">no recent marketplace sales — quiet market.</li>';
  }catch(e){
    $f('#nftGrid').innerHTML = '<p class="muted pad">gagal load — refresh page.</p>';
  }
}

loadNft();
setInterval(loadNft, 60000);

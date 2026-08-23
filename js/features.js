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

const TYPE_LABEL = {list:'listed', bid:'bid', sell:'sold', buy:'bought'};
function fmtSol(l){ return l!=null ? (l/1e9).toFixed(2)+' SOL' : '—'; }
function esc2(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtUsd2(n){ if(n==null||isNaN(n))return '—'; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+(n/1e3).toFixed(1)+'K'; return '$'+Number(n).toFixed(0); }
function ago(ts){ if(!ts)return''; const s=Date.now()/1000-ts; if(s<60)return Math.floor(Math.max(1,s))+'s'; if(s<3600)return Math.floor(s/60)+'m'; return Math.floor(s/3600)+'h'; }
function fpChgTxt(v){
  if(v==null) return '<span class="muted">—</span>';
  const pct = Number(v*100);
  return `<span class="${pct>=0?'green':'red'}">${pct>=0?'+':''}${pct.toFixed(1)}%</span>`;
}

async function loadNft(){
  try{
    const r = await fetch('/api/nft');
    const d = await r.json();
    if(!r.ok) throw new Error();
    solUsd = d.solUsd || 210;
    const counts = d.eventCounts || {};

    // watchlist cards
    $f('#nftGrid').innerHTML = (d.collections||[]).map(c=>{
      const ec = counts[c.symbol] || {};
      const act = (ec.list?ec.list+' listed':'') + (ec.bid?(ec.list?' · ':'')+ec.bid+' bids':'');
      return `
      <a class="nftcard" href="https://magiceden.io/collections/solana/${c.symbol}" target="_blank" rel="noopener">
        <div class="nftc-info">
          <span class="nftc-name">${esc2(c.name)}</span>
          <span class="nftc-floor">FP ${fmtSol(c.floor)} · ${fpChgTxt(c.fpChange24h)}</span>
          <span class="nftc-vol">${act?act+' (10m)':'—'}${c.listedCount?' · '+c.listedCount+' listed':''}</span>
        </div>
      </a>`;
    }).join('');

    // ===== smart money detection engine =====
    const alerts = [];
    const raw = (d.activities||[]).filter(a=>['list','bid','sell','buy'].includes(a.type));
    const byColl = {};
    raw.forEach(a=>{ (byColl[a.collectionSymbol] = byColl[a.collectionSymbol]||[]).push(a); });

    // 1. SWEEP: same buyer, >=3 buys, <=15 min window
    for(const [coll, evts] of Object.entries(byColl)){
      const buys = evts.filter(a=>a.type==='buy'||a.type==='sell');
      const byBuyer = {};
      buys.forEach(b=>{
        if(!b.buyer) return;
        const k = b.buyer;
        (byBuyer[k]=byBuyer[k]||[]).push(b);
      });
      for(const [buyer, bs] of Object.entries(byBuyer)){
        if(bs.length >= 3){
          const total = bs.reduce((s,b)=>s+Number(b.price||0),0);
          alerts.push({
            kind:'SWEEP', coll,
            text:`${bs.length}x bought by ${short(buyer)}`,
            detail:`total ${total.toFixed(1)} SOL ($${Math.round(total*solUsd)}) in ${Math.round(Math.max(...bs.map(b=>b.blockTime||0))-Math.min(...bs.map(b=>b.blockTime||0))/60)||'<1'}m`,
            sig:bs[0].signature
          });
        }
      }
    }

    // 2. FLOOR MOVE: compare current floor vs avg listing price wave
    for(const c of (d.collections||[])){
      if(c.fpChange24h!=null && Math.abs(Number(c.fpChange24h))>=0.03){
        const pct = Number(c.fpChange24h)*100;
        alerts.push({
          kind: pct>=0?'FP +':'FP −', coll:c.symbol,
          text:`floor ${pct>=0?'+':''}${pct.toFixed(1)}% 24h`,
          detail:`now ${(c.floor/1e9).toFixed(3)} SOL · ${c.listedCount??'?'} listed`,
          sig:null,
          tone: pct>=0?'up':'down'
        });
      }
    }

    // 3. UNUSUAL ACTIVITY: event burst vs the small sample we hold
    for(const [coll, evts] of Object.entries(byColl)){
      const lists = evts.filter(e=>e.type==='list');
      if(lists.length >= 5){
        const prices = lists.map(l=>Number(l.price||0)).sort((a,b)=>a-b);
        const med = prices[Math.floor(prices.length/2)];
        alerts.push({
          kind:'LISTING WAVE', coll,
          text:`${lists.length} new listings in window`,
          detail:`median ${med.toFixed(2)} SOL — possible dump pressure`,
          sig:lists[0].signature,
          tone:'down'
        });
      }
      const bids = evts.filter(e=>e.type==='bid');
      if(bids.length >= 6){
        alerts.push({
          kind:'BID PRESSURE', coll,
          text:`${bids.length} active bids in window`,
          detail:'accumulation signal — buyers stepping in',
          sig:bids[0].signature,
          tone:'up'
        });
      }
    }

    // render alert chips
    $f('#nftAlerts').innerHTML = alerts.length ? alerts.slice(0,8).map(al=>`
      <a class="nftalert${al.tone?' '+al.tone:''}" href="https://magiceden.io/collections/solana/${al.coll}" target="_blank" rel="noopener">
        <span class="na-kind">${esc2(al.kind)}</span>
        <span class="na-coll">${esc2(al.coll.replace(/_/g,' '))}</span>
        <span class="na-text">${esc2(al.text)}</span>
        <span class="na-detail">${esc2(al.detail)}</span>
      </a>`).join('')
      : '<p class="muted pad">no unusual signals right now — market calm.</p>';

    // ===== plain activity feed =====
    const events = (d.activities||[]).filter(a=>TYPE_LABEL[a.type]).slice(0,12);
    $f('#nftFeed').innerHTML = events.length ? events.map(a=>{
      const sol = Number(a.price||0);
      const usd = sol*solUsd;
      return `
      <li class="nftitem">
        <div>
          <div><span class="ftoken">${TYPE_LABEL[a.type]}</span> <span class="fmcap">${esc2((a.collectionSymbol||'').replace(/_/g,' '))}</span> <span class="fmcap">@ ${sol.toFixed(2)} SOL ($${Math.round(usd)})</span></div>
          <div class="sig-desc">${short(a.seller||a.buyer)} · ${ago(a.blockTime)} ago</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          <a class="buyl" href="https://magiceden.io/collections/solana/${a.collectionSymbol}" target="_blank" rel="noopener">collection</a>
          <a class="buyl" href="https://solscan.io/tx/${a.signature}" target="_blank" rel="noopener">tx</a>
        </div>
      </li>`;
    }).join('') : '<li class="muted pad">no recent marketplace activity — quiet market.</li>';

    // launchpad
    $f('#nftLaunch').innerHTML = (d.launchpad||[]).length ? (d.launchpad).map(c=>`
      <a class="nftcard lp" href="https://magiceden.io/collections/solana/${c.symbol}" target="_blank" rel="noopener">
        ${c.image?`<img src="/api/img?url=${encodeURIComponent(c.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`:''}
        <div class="nftc-info">
          <span class="nftc-name">${esc2(c.name)}</span>
          <span class="nftc-vol">${esc2(c.desc||'')}</span>
        </div>
      </a>`).join('') : '<p class="muted pad">no live mints right now.</p>';
  }catch(e){
    if($f('#nftGrid')) $f('#nftGrid').innerHTML = '<p class="muted pad">gagal load — refresh page.</p>';
  }
}

loadNft();
setInterval(loadNft, 45000);

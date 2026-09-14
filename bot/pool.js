// yukaya — pool.js: cross-chain pool screener (sol / bsc / robinhood / arc)
// discovery: gmgn trending --interval 5m --min-volume 200k (server-side filter)
// enrich:    gmgn token info → pool.fee_ratio + holders + dev + bundler
// fee gate:  fees24h (est = vol24h × fee_ratio) ≥ floor per chain:
//            robinhood 0.2 ETH · solana 5 SOL · bnb 1.5 BNB · arc $600 flat
// fees dihitung dari data asli (vol × fee tier), ditandai "(est)" — bukan karangan.
import { execFile } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, 'pool-state.json');
let state = {};
try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
function saveState() { try { writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }

const CFG = {
  minVol5m: 200000,           // user spec: volume 5 menit > $200k
  cooldownH: 4,
  maxPerChain: 2,             // max alert per chain per cycle
  topEnrich: 5,               // enrich N kandidat vol terbesar per chain
  floors: [
    { chain: 'robinhood', id: 'ethereum',   amt: 0.2 },   // 0.2 ETH
    { chain: 'sol',       id: 'solana',     amt: 5   },   // 5 SOL
    { chain: 'bsc',       id: 'binancecoin',amt: 1.5 },   // 1.5 BNB
    { chain: 'arc',       id: null,         usd: 600 },   // arc: flat USD
  ],
};

let gasPx = { at: 0, px: {} }; // harga gas token (eth/sol/bnb), cache 10 menit
async function gasPrices() {
  if (gasPx.px.ethereum && Date.now() - gasPx.at < 600000) return gasPx.px;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,binancecoin&vs_currencies=usd', { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    gasPx = { at: Date.now(), px: { ethereum: d.ethereum?.usd, solana: d.solana?.usd, binancecoin: d.binancecoin?.usd } };
  } catch {}
  return gasPx.px;
}

const cli = (args) => new Promise((resolve) => {
  execFile('gmgn-cli', args, { timeout: 25000 }, (err, stdout) => {
    if (err) return resolve(null);
    try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
  });
});

// ── fee tier resolution: gmgn fee_ratio → v2 table → on-chain fee() (v3-style) ──
const EVM_RPC = {
  bsc: 'https://bsc-dataseed.binance.org',
  robinhood: 'https://rpc.mainnet.chain.robinhood.com',
  arc: 'https://rpc.arc-scan.org',
};
const V2_TIERS = { pancake_v2: 0.25, pancake_v1: 0.25, uniswap_v2: 0.3, raydium: 0.25, pump_amm: 1.0, raydium_amm: 0.25 };
const feeCache = {};
async function onChainFeePct(chain, poolAddr) {
  if (!poolAddr || !/^0x[0-9a-fA-F]{40}$/.test(poolAddr)) return null;
  const k = chain + ':' + poolAddr.toLowerCase();
  if (feeCache[k] !== undefined) return feeCache[k];
  const rpc = EVM_RPC[chain];
  if (!rpc) return null;
  try {
    // eth_call fee() selector 0xddca3f43 → uint24 (basis points)
    const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: poolAddr, data: '0xddca3f43' }, 'latest'] }), signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    const hex = d?.result;
    if (!hex || hex === '0x') { feeCache[k] = null; return null; }
    const bps = parseInt(BigInt(hex).toString(), 10);
    feeCache[k] = bps / 10000; // uniswap fee unit: 3000 = 0.3%
  } catch { feeCache[k] = null; }
  return feeCache[k];
}
async function feeTierPct(t) {
  if (t.feeRatioPct != null && t.feeRatioPct > 0) return t.feeRatioPct;
  if (V2_TIERS[t.exchange] != null) return V2_TIERS[t.exchange];
  return onChainFeePct(t.chain, t.poolAddr); // v3/v4-style: baca fee() dari pool
}

export function poolFloorsText(px) {
  return CFG.floors.map(f => {
    const p = f.id ? px[f.id] : null;
    const usd = f.usd ?? (p ? f.amt * p : null);
    return `${f.chain} ≥ ${f.amt ?? '$' + f.usd}${f.id && p ? ' ' + f.id.toUpperCase().slice(0, 3) + ' (≈$' + Math.round(usd) + ')' : ''}`;
  }).join(' · ');
}

async function scanChain(chainId, floor, px) {
  const d = await cli(['market', 'trending', '--chain', chainId, '--interval', '5m', '--min-volume', String(CFG.minVol5m), '--limit', '30', '--raw']);
  const items = d?.data?.rank || d?.rank || [];
  items.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  const floorUsd = floor.usd ?? (floor.id && px[floor.id] ? floor.amt * px[floor.id] : Infinity);
  const out = [];
  for (const it of items.slice(0, CFG.topEnrich)) {
    const info = await cli(['token', 'info', '--chain', chainId, '--address', it.address, '--raw']);
    if (!info || !info.price) continue;
    const vol24 = Number(info.price.volume_24h || 0);
    const p = info.price;
    const mc = Number(p.price || 0) * Number(info.circulating_supply || 0);
    const t = {
      chain: chainId, addr: it.address, sym: it.symbol || '?', name: it.name || '',
      vol5m: it.volume || Number(p.volume_5m || 0),
      vol24h: vol24,
      chg5m: it.price_change_percent5m ?? it.price_change_percent ?? null,
      mc, liq: info.liquidity || it.liquidity || 0,
      holders: info.holder_count ?? null,
      top10: info.stat?.top_10_holder_rate ?? null,
      devHold: info.stat?.dev_team_hold_rate ?? info.dev_team_hold_rate ?? null,
      bundler: info.stat?.top_bundler_trader_percentage ?? it.bundler_rate ?? null,
      smart: info.wallet_tags_stat?.smart_wallets ?? it.smart_degen_count ?? null,
      wash: info.is_wash_trading ?? it.is_wash_trading ?? null,
      exchange: info.pool?.exchange || it.exchange || '?',
      poolAddr: info.pool?.pool_address || null,
      feeRatioPct: info.pool?.fee_ratio ?? null,
      floorUsd: floorUsd, floorNative: floor.amt, floorId: floor.id,
      ageH: info.creation_timestamp ? (Date.now() / 1000 - info.creation_timestamp) / 3600 : null,
      gmgnUrl: info.link?.gmgn || `https://gmgn.ai/${chainId}/token/${it.address}`,
    };
    const tier = await feeTierPct(t); // asli: gmgn → v2 table → on-chain fee()
    t.feePctUsed = tier;
    t.fees24 = tier != null ? vol24 * (tier / 100) : 0;
    t.fees24Eth = floor.id === 'ethereum' && px.ethereum ? t.fees24 / px.ethereum : null;
    out.push(t);
  }
  // sort by fees desc — yang beneran jalan duluan
  out.sort((a, b) => b.fees24 - a.fees24);
  return { out, floorUsd };
}

// gates buat pool alert: wash/bundler/dev/top10 + fee floor
export function poolGates(t) {
  const why = [];
  if (t.wash === true) why.push('wash trading');
  if ((t.bundler ?? 0) > 0.3) why.push(`bundler ${(t.bundler * 100).toFixed(0)}%`);
  if ((t.devHold ?? 0) > 0.5) why.push(`dev hold ${(t.devHold * 100).toFixed(0)}%`);
  if ((t.top10 ?? 0) > 0.6) why.push(`top10 ${(t.top10 * 100).toFixed(0)}%`);
  if (t.feePctUsed == null) { why.push('fee tier unreadable (fail-closed)'); }
  else if (t.fees24 < t.floorUsd) {
    const native = t.fees24Eth != null ? `${t.fees24Eth.toFixed(3)} ETH < ${t.floorNative} ETH` : `$${Math.round(t.fees24)} < $${Math.round(t.floorUsd)}`;
    why.push(`fees ${native}`);
  }
  return why;
}

const fw = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));

export function poolCard(t) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const L = (label, val) => (label + ' ').padEnd(8, ' ') + val;
  const feesTxt = t.fees24Eth != null ? `$${fw(t.fees24)} (≈${t.fees24Eth.toFixed(2)} ETH)` : `$${fw(t.fees24)}`;
  const lines = [
    `$${t.sym} — $${fw(t.vol5m)} in 5m`,
    `${t.chain.toUpperCase()} · ${t.exchange} · ${t.ageH != null ? (t.ageH < 1 ? Math.round(t.ageH * 60) + 'm' : t.ageH.toFixed(1) + 'd') : 'age?'} old`,
    t.addr,
    '',
    L('mcap', '$' + fw(t.mc)),
    L('liq', '$' + fw(t.liq)),
    L('5m chg', t.chg5m != null ? (t.chg5m >= 0 ? '+' : '') + Number(t.chg5m).toFixed(1) + '%' : '—'),
    L('fees24h', feesTxt + (t.feePctUsed != null ? ` (est @${t.feePctUsed}%)` : ' (?)')),
    L('vol24h', '$' + fw(t.vol24h || 0)),
    '',
    L('holders', t.holders ?? '—') + (t.top10 != null ? ` · top10 ${(t.top10 * 100).toFixed(0)}%` : ''),
    (t.smart != null ? L('smart', t.smart + ' wallets') : null),
    (t.bundler != null ? L('bundler', (t.bundler * 100).toFixed(0) + '%') : null),
    '',
    'yukaya pool desk · gmgn',
  ].filter(Boolean);
  return `<pre>${lines.map(x => esc(x)).join('\n')}</pre>`;
}

// full cycle — balikin daftar alert yang layak kirim
export async function poolScan() {
  const px = await gasPrices();
  const now = Date.now();
  const alerts = [];
  for (const f of CFG.floors) {
    let res;
    try { res = await scanChain(f.chain, f, px); } catch { continue; }
    if (!res) continue;
    let sent = 0;
    for (const t of res.out) {
      if (sent >= CFG.maxPerChain) break;
      const key = `${f.chain}:${t.addr.toLowerCase()}`;
      if (state[key] && now - state[key] < CFG.cooldownH * 3600000) continue;
      const why = poolGates(t);
      if (why.length) { console.log(`pool-gate skip ${f.chain} ${t.sym}: ${why.join(', ')}`); continue; }
      state[key] = now;
      alerts.push(t);
      sent++;
    }
  }
  // prune > 7d
  for (const [k, ts] of Object.entries(state)) if (now - ts > 7 * 86400000) delete state[k];
  saveState();
  return alerts;
}

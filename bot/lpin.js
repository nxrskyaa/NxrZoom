// yukaya — lpin.js: LP-incoming detector (arc / robinhood / sol)
// sinyal: token volume 5m ≥ $150k tapi TVL masih tipis relatif volume
//         → fee/TVL tinggi = insentif kuat buat LP baru masuk nambah likuiditas.
// discovery: gmgn trending 5m --min-volume 150k (server-side filter)
// enrich:    gmgn token info → liq, holders, fee tier pool, wash/bundler
// core ratio: vol5m / liq ≥ CFG.minRatio → alert (fee APY est kalau fee tier kebaca)
import { execFile } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, 'lpin-state.json');
let state = {};
try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
function saveState() { try { writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }

const CFG = {
  chains: ['arc', 'robinhood', 'sol'],
  minVol5m: 150000,   // user spec: volume 5 menit > $150k
  minRatio: 2.5,      // vol5m ≥ 2.5× liq → TVL tipis relatif volume = LP magnet
  minLiq: 10000,      // buang kolam debu < $10k
  cooldownH: 4,
  maxPerChain: 2,
  topEnrich: 6,
};

const cli = (args) => new Promise((resolve) => {
  execFile('gmgn-cli', args, { timeout: 25000 }, (err, stdout) => {
    if (err) return resolve(null);
    try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
  });
});

// fee tier: gmgn pool.fee_ratio → v2 table (tanpa on-chain fee() biar scan ringan)
const V2_TIERS = { pancake_v2: 0.25, pancake_v1: 0.25, uniswap_v2: 0.3, raydium: 0.25, pump_amm: 1.0, raydium_amm: 0.25 };

export function lpGates(t) {
  const why = [];
  if (t.wash === true) why.push('wash trading');
  if ((t.bundler ?? 0) > 0.3) why.push(`bundler ${(t.bundler * 100).toFixed(0)}%`);
  if ((t.top10 ?? 0) > 0.65) why.push(`top10 ${(t.top10 * 100).toFixed(0)}%`);
  if (t.liq < CFG.minLiq) why.push(`liq $${Math.round(t.liq)} < $${CFG.minLiq / 1000}k`);
  if (t.ratio < CFG.minRatio) why.push(`vol/liq ${t.ratio.toFixed(1)}x < ${CFG.minRatio}x`);
  return why;
}

async function scanChain(chainId) {
  const d = await cli(['market', 'trending', '--chain', chainId, '--interval', '5m', '--min-volume', String(CFG.minVol5m), '--limit', '30', '--raw']);
  const items = d?.data?.rank || d?.rank || [];
  items.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  const out = [];
  for (const it of items.slice(0, CFG.topEnrich)) {
    const info = await cli(['token', 'info', '--chain', chainId, '--address', it.address, '--raw']);
    if (!info || !info.price) continue;
    const p = info.price;
    const liq = info.liquidity || it.liquidity || 0;
    const vol5m = it.volume || Number(p.volume_5m || 0);
    const ratio = liq > 0 ? vol5m / liq : Infinity;
    const feePct = info.pool?.fee_ratio ?? V2_TIERS[info.pool?.exchange || it.exchange] ?? null;
    // LP economics: fees5m ≈ vol5m × fee% ; APY est = fees5m × 288 (5m/window per hari) × 365 / liq
    const fees5m = feePct != null ? vol5m * (feePct / 100) : null;
    const apy = fees5m != null && liq >= CFG.minLiq ? (fees5m * 288 * 365) / liq : null;
    out.push({
      chain: chainId, addr: it.address, sym: it.symbol || '?', name: it.name || '',
      vol5m, liq, ratio, apy, feePct, fees5m,
      vol24h: Number(p.volume_24h || 0),
      chg5m: it.price_change_percent5m ?? it.price_change_percent ?? null,
      mc: Number(p.price || 0) * Number(info.circulating_supply || 0),
      holders: info.holder_count ?? null,
      top10: info.stat?.top_10_holder_rate ?? null,
      bundler: info.stat?.top_bundler_trader_percentage ?? it.bundler_rate ?? null,
      smart: info.wallet_tags_stat?.smart_wallets ?? it.smart_degen_count ?? null,
      wash: info.is_wash_trading ?? it.is_wash_trading ?? null,
      exchange: info.pool?.exchange || it.exchange || '?',
      ageH: info.creation_timestamp ? (Date.now() / 1000 - info.creation_timestamp) / 3600 : null,
      gmgnUrl: info.link?.gmgn || `https://gmgn.ai/${chainId}/token/${it.address}`,
    });
  }
  // yang paling "LP magnet": ratio tinggi + volume besar
  out.sort((a, b) => (b.ratio - a.ratio) || (b.vol5m - a.vol5m));
  return out;
}

const fw = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));

export function lpCard(t) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const L = (label, val) => (label + ' ').padEnd(8, ' ') + val;
  const lines = [
    `$${t.sym} — LP magnet ${t.ratio.toFixed(1)}x`,
    `${t.chain.toUpperCase()} · ${t.exchange} · ${t.ageH != null ? (t.ageH < 1 ? Math.round(t.ageH * 60) + 'm' : t.ageH.toFixed(1) + 'd') : 'age?'} old`,
    t.addr,
    '',
    L('vol 5m', '$' + fw(t.vol5m)),
    L('tvl', '$' + fw(t.liq)),
    L('vol/tvl', t.ratio.toFixed(1) + 'x' + (t.feePct != null ? ` · fee ${t.feePct}%` : '')),
    (t.apy != null ? L('lp apy', '≈' + (t.apy >= 1000 ? Math.round(t.apy / 1000) + 'k' : Math.round(t.apy)) + '% (est 24h pace)') : null),
    L('mcap', '$' + fw(t.mc)),
    L('5m chg', t.chg5m != null ? (t.chg5m >= 0 ? '+' : '') + Number(t.chg5m).toFixed(1) + '%' : '—'),
    '',
    L('holders', t.holders ?? '—') + (t.top10 != null ? ` · top10 ${(t.top10 * 100).toFixed(0)}%` : ''),
    (t.smart != null ? L('smart', t.smart + ' wallets') : null),
    (t.bundler != null ? L('bundler', (t.bundler * 100).toFixed(0) + '%') : null),
    '',
    'yukaya lp desk · gmgn',
  ].filter(Boolean);
  return `<pre>${lines.map(x => esc(x)).join('\n')}</pre>`;
}

export async function lpWatch() {
  const all = [];
  for (const chain of CFG.chains) {
    try { all.push(...(await scanChain(chain)).map(t => ({ ...t, gateReasons: lpGates(t) }))); } catch (e) { console.error(`lpin watch ${chain}:`, e.message); }
  }
  return all.sort((a,b) => (b.vol5m - a.vol5m)).slice(0, 12);
}

// full cycle — balikin alert LP-in yang lolos gate
export async function lpScan() {
  const now = Date.now();
  const alerts = [];
  for (const chain of CFG.chains) {
    let out;
    try { out = await scanChain(chain); } catch { continue; }
    if (!out) continue;
    let sent = 0;
    for (const t of out) {
      if (sent >= CFG.maxPerChain) break;
      const key = `${chain}:${t.addr.toLowerCase()}`;
      if (state[key] && now - state[key] < CFG.cooldownH * 3600000) continue;
      const why = lpGates(t);
      if (why.length) { console.log(`lpin-gate skip ${chain} ${t.sym}: ${why.join(', ')}`); continue; }
      state[key] = now;
      alerts.push(t);
      sent++;
    }
  }
  for (const [k, ts] of Object.entries(state)) if (now - ts > 7 * 86400000) delete state[k];
  saveState();
  return alerts;
}

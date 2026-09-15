// yukaya — smarttrack.js: auto smart money tracking via gmgn track smartmoney
// ganti kerjaan manual: screen wallet satu-satu di gmgn.
// logika: poll trades smartmoney per chain → agregasi per token → cluster signal
// (≥2 wallet beli bareng dalam window) → gate security → alert.
import { execFile } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, 'smtrack-state.json');
let state = {};
try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
function saveState() { try { writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }

const CFG = {
  chains: ['sol', 'robinhood'],
  clusterMakers: 2,      // ≥2 wallet smart beli bareng = alert
  clusterUsd: 2000,      // total beli ≥$2k
  cooldownH: 6,
  maxPerChain: 2,
};
const NATIVE = new Set([
  'so11111111111111111111111111111111111111112', // WSOL
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0x4200000000000000000000000000000000000006',
  '0x0000000000000000000000000000000000000000',
]);

const cli = (args) => new Promise((resolve) => {
  execFile('gmgn-cli', args, { timeout: 25000 }, (err, stdout) => {
    if (err) return resolve(null);
    try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
  });
});

const fw = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));

export function smCard(c) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const L = (label, val) => (label + ' ').padEnd(8, ' ') + val;
  const lines = [
    `$${c.sym} — ${c.chain.toUpperCase()} chain`,
    c.addr,
    '',
    L('signal', `${c.makers.length ?? c.makers} smart wallets BELI bareng`),
    L('total', '$' + fw(c.usd) + ` (${c.n} trades)`),
    L('mc', '$' + fw(c.mc)),
    L('liq', '$' + fw(c.liq)),
    '',
    (c.smart != null ? L('smart', c.smart + ' wallets holding') : null),
    (c.top10 != null ? L('top10', (c.top10 * 100).toFixed(0) + '%') : null),
    (c.bundler != null ? L('bundler', (c.bundler * 100).toFixed(0) + '%') : null),
    '',
    'yukaya smart track · gmgn',
  ].filter(Boolean);
  return `<pre>${lines.map(x => esc(x)).join('\n')}</pre>`;
}

export function smGates(t) {
  const why = [];
  if ((t.bundler ?? 0) > 0.3) why.push(`bundler ${(t.bundler * 100).toFixed(0)}%`);
  if ((t.devHold ?? 0) > 0.5) why.push(`dev hold ${(t.devHold * 100).toFixed(0)}%`);
  if ((t.top10 ?? 0) > 0.6) why.push(`top10 ${(t.top10 * 100).toFixed(0)}%`);
  if (t.liq > 0 && t.usd / t.liq > 0.5) why.push('buy >50% liq');
  return why;
}

// satu cycle — balikin cluster alert
export async function smTrackScan() {
  const now = Date.now();
  const alerts = [];
  for (const chain of CFG.chains) {
    const d = await cli(['track', 'smartmoney', '--chain', chain, '--limit', '100', '--raw']);
    const items = d?.list || [];
    const agg = new Map();
    for (const t of items) {
      if ((t.side || '') !== 'buy') continue; // buys only buat cluster entry
      const addr = (t.base_address || '').toLowerCase();
      if (!addr || NATIVE.has(addr)) continue;
      if (!agg.has(addr)) agg.set(addr, { addr, sym: t.base_token?.symbol || '?', chain, makers: new Set(), usd: 0, n: 0, lastTs: 0 });
      const a = agg.get(addr);
      a.makers.add((t.maker || '').toLowerCase());
      a.usd += t.amount_usd || 0;
      a.n += 1;
      a.lastTs = Math.max(a.lastTs, t.timestamp || 0);
    }
    // cuma trade fresh (≤90 menit) yang diitung cluster
    let sent = 0;
    const cands = [...agg.values()]
      .filter(a => a.makers.size >= CFG.clusterMakers && a.usd >= CFG.clusterUsd && now / 1000 - a.lastTs < 5400)
      .sort((x, y) => (y.makers.size - x.makers.size) || (y.usd - x.usd));
    for (const c of cands) {
      if (sent >= CFG.maxPerChain) break;
      const key = `sm:${chain}:${c.addr}`;
      if (state[key] && now - state[key] < CFG.cooldownH * 3600000) continue;
      // enrich via token info
      const info = await cli(['token', 'info', '--chain', chain, '--address', c.addr, '--raw']);
      if (!info || !info.price) { console.log(`smtrack: ${c.sym} info unreadable, skip`); continue; }
      const e = {
        ...c,
        mc: Number(info.price?.price || 0) * Number(info.circulating_supply || 0),
        liq: info.liquidity || 0,
        smart: info.wallet_tags_stat?.smart_wallets ?? null,
        top10: info.stat?.top_10_holder_rate ?? null,
        devHold: info.stat?.dev_team_hold_rate ?? null,
        bundler: info.stat?.top_bundler_trader_percentage ?? null,
        holders: info.holder_count ?? null,
        gmgnUrl: info.link?.gmgn || `https://gmgn.ai/${chain}/token/${c.addr}`,
      };
      const why = smGates(e);
      if (why.length) { console.log(`smtrack-gate skip ${chain} ${c.sym}: ${why.join(', ')}`); continue; }
      state[key] = now;
      alerts.push({ ...e, makers: [...e.makers] });
      sent++;
    }
  }
  for (const [k, ts] of Object.entries(state)) if (now - ts > 7 * 86400000) delete state[k];
  saveState();
  return alerts;
}

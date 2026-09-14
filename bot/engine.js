// nxrzoom_ bot — signal engine
// discovery → hard gates → scoring → dedupe. Missing data = abstain, never fabricated.
// Data source: nxrzoom's own API (/api/feed) with direct GeckoTerminal fallback.

const FEED_URL = process.env.NXRZOOM_FEED_URL || 'https://nxrzoom.vercel.app/api/feed';
const GT = 'https://api.geckoterminal.com/api/v2';

// ── config (all thresholds env-tunable) ──────────────────────
const CFG = {
  pollSec:        Number(process.env.POLL_SEC || 900),        // scan every 15 min
  cooldownHrs:    Number(process.env.COOLDOWN_HRS || 12),     // per-token re-alert cooldown
  minLiq:         Number(process.env.MIN_LIQ || 20000),       // dust gate (usd)
  minVol24:       Number(process.env.MIN_VOL24 || 40000),     // noise gate
  minAgeHrs:      0,                                          // no age floor for anomalies
  maxAgeHrs:      Number(process.env.MAX_AGE_HRS || 0),       // 0 = any age
  turnoverBuy:    Number(process.env.TURNOVER_BUY || 0.25),   // vol/mc threshold → anomaly
  maxAlertsCycle: Number(process.env.MAX_ALERTS_CYCLE || 3),  // top-N per cycle
  recapHour:      Number(process.env.RECAP_HOUR || 14),       // daily recap hour (local VM tz)
};

// ── data layer ───────────────────────────────────────────────
async function j(url, timeoutMs = 15000) {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

// map GT pool → dexscreener-shape pair (same mapping as api/feed.js)
function mapPool(p) {
  const a = p.attributes || {};
  const rel = p.relationships || {};
  const addr = ((rel.base_token?.data?.id) || '').split('_')[1] || a.address || '';
  const nameParts = String(a.name || '').split('/');
  const baseSym = (nameParts[0] || '????').trim();
  const num = (o, k) => (o && o[k] != null) ? Number(o[k]) : null;
  return {
    chainId: 'solana',
    dexId: ((rel.dex?.data?.id) || 'dex').split('_')[1] || 'dex',
    url: 'https://www.geckoterminal.com/solana/pools/' + a.address,
    baseToken: { address: addr, name: baseSym, symbol: baseSym },
    priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
    liquidity: { usd: num(a, 'reserve_in_usd') || 0 },
    volume: { h24: num(a.volume_usd, 'h24'), h6: num(a.volume_usd, 'h6'), h1: num(a.volume_usd, 'h1') },
    priceChange: {
      h24: num(a.price_change_percentage, 'h24'), h6: num(a.price_change_percentage, 'h6'),
      h1: num(a.price_change_percentage, 'h1'), m5: num(a.price_change_percentage, 'm5'),
    },
    fdv: num(a, 'fdv_usd'),
    marketCap: num(a, 'market_cap_usd') || num(a, 'fdv_usd'),
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    txns: {
      h24: { buys: Math.round(num(a.transactions?.h24, 'buys') || 0), sells: Math.round(num(a.transactions?.h24, 'sells') || 0) },
      h1:  { buys: Math.round(num(a.transactions?.h1, 'buys') || 0),  sells: Math.round(num(a.transactions?.h1, 'sells') || 0) },
      m5:  { buys: Math.round(num(a.transactions?.m5, 'buys') || 0),  sells: Math.round(num(a.transactions?.m5, 'sells') || 0) },
    },
  };
}

async function fetchPairs() {
  // primary: nxrzoom's own feed (60s cache, stale-serve) — reuses the site's data layer
  try {
    const d = await j(FEED_URL);
    if (d && Array.isArray(d.pairs) && d.pairs.length) return d.pairs;
  } catch (e) { /* fall through */ }
  // fallback: direct GT (trending + new), same as api/feed.js
  const [trend, recent] = await Promise.all([
    j(GT + '/networks/solana/trending_pools?page=1').catch(() => null),
    j(GT + '/networks/solana/new_pools?page=1').catch(() => null),
  ]);
  const pools = [].concat(trend?.data || [], recent?.data || []);
  const seen = new Set(); const pairs = [];
  for (const p of pools) {
    if (seen.has(p.id)) continue; seen.add(p.id);
    const m = mapPool(p);
    if (m.baseToken.address) pairs.push(m);
  }
  return pairs;
}

// ── scoring ──────────────────────────────────────────────────
// severity 0–100 composite: turnover (vol/mc), momentum alignment, buy pressure, participation
// each component null → abstained → removed from denominator (never treated as 0)
function scorePair(p) {
  const mc = p.marketCap ?? p.fdv ?? null;
  const vol = p.volume?.h24 ?? null;
  const liq = p.liquidity?.usd ?? 0;

  // ── hard gates (rejection, not zero-score)
  if (!p.baseToken?.address)        return { reject: 'no address' };
  if (!mc || mc <= 0)               return { reject: 'no mcap data' };
  if (!vol || vol <= 0)             return { reject: 'no volume data' };
  if (liq < CFG.minLiq)             return { reject: `liq < $${fmtShort(CFG.minLiq)}` };
  if (vol < CFG.minVol24)           return { reject: `vol24 < $${fmtShort(CFG.minVol24)}` };
  const ageH = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3600000 : null;
  if (CFG.maxAgeHrs > 0 && ageH != null && ageH > CFG.maxAgeHrs) return { reject: 'too old' };

  const volMc = vol / mc;
  const parts = {};            // component → { raw, norm, weight }
  const avail = [];            // available component weights

  // 1. turnover — vol/mc, 0.25 → 1.0 maps 0..1
  parts.turnover = { raw: volMc, norm: clamp01(volMc / 1.0), weight: 0.35 };
  if (volMc >= CFG.turnoverBuy) avail.push('turnover');

  // 2. momentum alignment — h1 change agrees in sign with h24 change and is material
  const h1 = p.priceChange?.h1, h24 = p.priceChange?.h24;
  if (h1 != null && h24 != null) {
    const aligned = Math.sign(h1) === Math.sign(h24) && Math.abs(h1) >= 2;
    parts.momentum = { raw: h1, norm: aligned ? clamp01(Math.abs(h1) / 15) : 0, weight: 0.25 };
    if (aligned) avail.push('momentum');
  } else {
    parts.momentum = { raw: null, norm: null, weight: 0.25 }; // abstained
  }

  // 3. buy pressure — h1 buys vs sells (needs at least one txn on each side to be readable)
  const t1 = p.txns?.h1;
  if (t1 && (t1.buys + t1.sells) > 0) {
    const bp = t1.buys / (t1.buys + t1.sells);
    parts.pressure = { raw: bp, norm: clamp01((bp - 0.5) * 4), weight: 0.25 };
    avail.push('pressure');
  } else {
    parts.pressure = { raw: null, norm: null, weight: 0.25 };
  }

  // 4. participation — distinct-ish txn count h24 (buys+sells), log scale 20 → 400
  const t24 = p.txns?.h24;
  if (t24) {
    const n = t24.buys + t24.sells;
    parts.activity = { raw: n, norm: clamp01(Math.log10(Math.max(1, n)) / Math.log10(400)), weight: 0.15 };
    if (n >= 20) avail.push('activity');
  } else {
    parts.activity = { raw: null, norm: null, weight: 0.15 };
  }

  if (!avail.length) return { reject: 'no qualifying components (turnover < ' + CFG.turnoverBuy + 'x)' };

  const wsum = avail.reduce((s, k) => s + parts[k].weight, 0);
  const mean = avail.reduce((s, k) => s + parts[k].norm * parts[k].weight, 0) / wsum;
  const sev = Math.round(100 * mean);
  const conf = Math.round(100 * wsum); // data-availability confidence

  // side: price direction wins ties, buy pressure breaks flat prices
  const side = (h24 != null && h24 < 0) ? 'SELL'
             : (h24 != null && h24 > 0) ? 'BUY'
             : (parts.pressure?.raw != null ? (parts.pressure.raw >= 0.5 ? 'BUY' : 'SELL') : 'WATCH');

  const age = ageH == null ? null : ageH;
  return {
    severity: sev, confidence: conf, side, volMc,
    components: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { raw: round2(v.raw), norm: v.norm }])),
    ageHrs: age == null ? null : round2(age),
  };
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function round2(x) { return x == null || isNaN(x) ? null : Math.round(x * 100) / 100; }

function levelOf(sev) {
  if (sev >= 70) return 'Critical';
  if (sev >= 50) return 'High';
  if (sev >= 30) return 'Elevated';
  return 'Watch';
}

function fmtShort(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}

// ── dedupe state ─────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const STATE_FILE = process.env.STATE_FILE || join(dirname(fileURLToPath(import.meta.url)), 'state.json');

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { alerted: {} }; }
}
function saveState(s) {
  try { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s)); }
  catch (e) { console.error('state save failed:', e.message); }
}

// ── scan cycle ───────────────────────────────────────────────
export async function scan(opts = {}) {
  const pairs = await fetchPairs();
  if (!pairs.length) throw new Error('feed empty');

  const state = loadState();
  const now = Date.now();
  const results = [];
  for (const p of pairs) {
    const s = scorePair(p);
    if (s.reject) { results.push({ pair: p, reject: s.reject }); continue; }
    const last = state.alerted[p.baseToken.address] || 0;
    const cooldownMs = CFG.cooldownHrs * 3600000;
    const fresh = opts.ignoreCooldown || (now - last) > cooldownMs;
    results.push({
      pair: p, score: s,
      alertable: fresh && s.severity >= 30 && s.confidence >= 50,
      onCooldown: !fresh,
    });
  }
  return results;
}

// pick top alertable, mark state
export async function pickAlerts(results) {
  const cands = results.filter(r => r.alertable)
    .sort((a, b) => (b.score.severity * (b.score.confidence / 100)) - (a.score.severity * (a.score.confidence / 100)))
    .slice(0, CFG.maxAlertsCycle);
  if (cands.length) {
    const state = loadState();
    for (const c of cands) state.alerted[c.pair.baseToken.address] = Date.now();
    saveState(state);
  }
  return cands;
}

// 24h recap from live feed
export async function buildRecap(results) {
  const scored = results.filter(r => r.score);
  const top = [...scored].sort((a, b) => (b.pair.priceChange?.h24 ?? -999) - (a.pair.priceChange?.h24 ?? -999)).slice(0, 5);
  const hottest = [...scored].sort((a, b) => b.score.severity - a.score.severity).slice(0, 3);
  const vol24 = results.reduce((s, r) => s + ((r.pair.volume?.h24) || 0), 0);
  const buys = results.reduce((s, r) => s + ((r.pair.txns?.h24?.buys) || 0), 0);
  const sells = results.reduce((s, r) => s + ((r.pair.txns?.h24?.sells) || 0), 0);
  const fresh = results.filter(r => r.pair.pairCreatedAt && (Date.now() - r.pair.pairCreatedAt) < 86400000).length;
  return { top, hottest, vol24, buys, sells, fresh, total: results.length, at: Date.now() };
}

export { CFG, levelOf, fmtShort, fetchPairs, scorePair };

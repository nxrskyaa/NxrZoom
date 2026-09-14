// yukaya — enrichment layer: smart reads per token
// rugcheck (free, keyless) + derived flow metrics. Missing = abstain, never fabricated.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUGCHECK = 'https://api.rugcheck.xyz/v1/tokens';
const CACHE_FILE = join(HERE, 'rug-cache.json');

// rugcheck cache (TTL 30 min) — persisted so restarts don't re-hit API
function loadCache() { try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; } }
function saveCache(c) { try { writeFileSync(CACHE_FILE, JSON.stringify(c)); } catch {} }

async function rugcheck(ca) {
  const cache = loadCache();
  const hit = cache[ca];
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.data;
  const r = await fetch(`${RUGCHECK}/${ca}/report`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error('rugcheck http ' + r.status);
  const d = await r.json();
  const data = {
    score: d.score_normalised ?? null,           // 0 = aman … 100 = rug
    lpLockedPct: d.lpLockedPct ?? null,
    lpProviders: d.totalLPProviders ?? null,
    risks: (d.risks || []).map(x => ({ name: x.name, level: x.level })),
  };
  cache[ca] = { at: Date.now(), data };
  saveCache(cache);
  return data;
}

// full enrichment for one pair (dexscreener-shape). Never throws.
export async function enrich(p) {
  const out = { rug: null, accel: null, pressure: {}, liqMc: null, ageHrs: null, flags: [] };
  const mc = p.marketCap ?? p.fdv ?? null;
  const vol = p.volume || {};
  const tx = p.txns || {};

  // rugcheck safety read (cached)
  try { out.rug = await rugcheck(p.baseToken.address); } catch { /* abstain */ }

  // flow acceleration: 1h vol share vs flat baseline (1/24)
  if (vol.h1 != null && vol.h24 > 0) out.accel = Math.round((vol.h1 * 24 / vol.h24) * 100) / 100;

  // buy pressure windows
  for (const w of ['m5', 'h1', 'h24']) {
    const t = tx[w];
    if (t && t.buys + t.sells > 0) out.pressure[w] = Math.round(t.buys / (t.buys + t.sells) * 100);
  }

  // liquidity health
  const liq = p.liquidity?.usd ?? null;
  if (liq != null && mc > 0) out.liqMc = Math.round(liq / mc * 100);

  // age
  if (p.pairCreatedAt) out.ageHrs = Math.round((Date.now() - p.pairCreatedAt) / 360000) / 10;

  // flags — the honest risk reads
  if (out.rug) {
    if (out.rug.score != null && out.rug.score >= 60) out.flags.push(`🚨 rugcheck ${out.rug.score}/100 — risiko tinggi`);
    for (const r of out.rug.risks || []) {
      if (r.level === 'danger') out.flags.push(`⛔ ${r.name}`);
      else if (r.level === 'warn') out.flags.push(`⚠️ ${r.name}`);
    }
  }
  if (out.liqMc != null && out.liqMc < 8) out.flags.push(`💧 liq cuma ${out.liqMc}% dari MC — slippage bahaya`);
  if (out.pressure.h24 != null && out.pressure.h24 < 40 && (p.priceChange?.h24 ?? 0) > 20)
    out.flags.push(`🚨 harga naik tapi seller dominan (${100 - out.pressure.h24}% sell) — distribusi?`);
  if (out.accel != null && out.accel >= 2) out.flags.push(`⚡ vol 1h ${out.accel}x baseline — akselerasi`);
  if (out.ageHrs != null && out.ageHrs < 6) out.flags.push(`🌱 fresh launch (${out.ageHrs}h)`);
  return out;
}

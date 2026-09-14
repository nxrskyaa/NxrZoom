// yukaya — ta.js: supertrend + ema stack (25/50/100/200) dari OHLCV geckoterminal
// dipake buat: (1) info bounce potensi di supertrend, (2) golden/death cross 5m-1h,
// (3) gate bear stack (price<e50<e100<e200 1h + ST down) → skip buy signal ngaco
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(HERE, 'ta-cache.json');
const GEO = 'https://api.geckoterminal.com/api/v2';

function loadCache() { try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; } }
function saveCache(c) { try { writeFileSync(CACHE_FILE, JSON.stringify(c)); } catch {} }

// ── ohlcv fetch (cached 3 min per pool+tf) ───────────────────
// tf: { id: '5m', tf: 'minute', agg: 5 } | { id: '1h', tf: 'hour', agg: 1 }
async function ohlcv(pool, tf, agg, limit = 300) {
  const cache = loadCache();
  const key = `${pool}:${tf}:${agg}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < 3 * 60000) return hit.rows;
  const r = await fetch(`${GEO}/networks/solana/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('gecko ' + r.status);
  const d = await r.json();
  const rows = d?.data?.attributes?.ohlcv_list || []; // [ts, o, h, l, c, vol] — newest first
  cache[key] = { at: Date.now(), rows };
  // prune
  for (const [k, v] of Object.entries(cache)) if (Date.now() - v.at > 3600000) delete cache[k];
  saveCache(cache);
  return rows;
}

// ── indikator ────────────────────────────────────────────────
function ema(vals, period) {
  if (vals.length < period) return null;
  const k = 2 / (period + 1);
  let e = vals.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [{ i: period - 1, v: e }];
  for (let i = period; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out.push({ i, v: e }); }
  return out; // chronologis dari index period-1
}
function atr(candles, period = 10) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const [, o, h, l, c] = candles[i];
    const pc = candles[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}
// supertrend klasik (period 10, mult 3) → { value, dir } dir=1 up, -1 down
export function supertrend(candles, period = 10, mult = 3) {
  const a = atr(candles, period);
  if (a == null) return null;
  let dir = 1, upper = 0, lower = 0, st = 0;
  for (let i = period; i < candles.length; i++) {
    const [, o, h, l, c] = candles[i];
    const mid = (h + l) / 2;
    const bu = mid + mult * a, bl = mid - mult * a;
    upper = c > upper ? Math.max(bu, upper) : bu;
    lower = c < lower ? Math.min(bl, lower) : bl;
    const prevClose = candles[i - 1][4];
    dir = prevClose > st ? 1 : prevClose < st ? -1 : dir;
    st = dir === 1 ? lower : upper;
  }
  return { value: st, dir };
}

// ── baca TA satu pool ────────────────────────────────────────
// return { lines:[], bear:bool, ok:bool }
export async function taRead(pool) {
  if (!pool) return { ok: false, lines: [], bear: false };
  const TFS = [
    { id: '5m', tf: 'minute', agg: 5 },
    { id: '15m', tf: 'minute', agg: 15 },
    { id: '1h', tf: 'hour', agg: 1 },
  ];
  const lines = [];
  let bear = false, any = false;
  for (const t of TFS) {
    try {
      const rows = await ohlcv(pool, t.tf, t.agg);
      if (rows.length < 60) continue;
      const candles = rows.slice().reverse(); // oldest → newest
      const closes = candles.map(c => c[4]);
      const px = closes[closes.length - 1];
      const e25 = ema(closes, 25), e50 = ema(closes, 50), e100 = ema(closes, 100), e200 = ema(closes, 200);
      if (!e25 || !e50 || !e100 || !e200) continue;
      const v25 = e25[e25.length - 1].v, v50 = e50[e50.length - 1].v, v100 = e100[e100.length - 1].v, v200 = e200[e200.length - 1].v;
      const p25 = e25[e25.length - 2]?.v ?? v25, p50 = e50[e50.length - 2]?.v ?? v50;
      const st = supertrend(candles);
      any = true;

      // cross fresh (bar terakhir): golden = e25 baru aja nanjak di atas e50
      const golden = v25 > v50 && p25 <= p50;
      const death = v25 < v50 && p25 >= p50;
      const gapPct = Math.abs(v25 - v50) / v50 * 100;
      const nearCross = !golden && !death && gapPct < 0.3;

      let txt = `${t.id}: `;
      if (golden) txt += `⚡ GOLDEN CROSS 25/50`;
      else if (death) txt += `☠️ death cross 25/50`;
      else if (nearCross) txt += `EMAs nempel (gap ${gapPct.toFixed(2)}%) — cross imminent`;
      else if (v25 > v50 && v50 > v100 && v100 > v200) txt += `stack bullish ✓`;
      else if (v25 < v50 && v50 < v100 && v100 < v200) txt += `stack bearish`;
      else txt += `mixed`;

      if (st) {
        const dist = (px - st.value) / st.value * 100;
        if (st.dir === 1 && dist >= 0 && dist <= 3) txt += ` · ST bounce zone (${dist.toFixed(1)}% di atas line)`;
        else if (st.dir === 1 && dist > 3) txt += ` · ST up ${dist.toFixed(1)}%`;
        else if (st.dir === -1) txt += ` · ST down ${Math.abs(dist).toFixed(1)}%`;
      }
      lines.push(txt);

      // bear stack 1h
      if (t.id === '1h' && px < v50 && v50 < v100 && v100 < v200 && st && st.dir === -1) bear = true;
    } catch { /* abstain per tf */ }
  }
  return { ok: any, lines, bear };
}

// ── card block ───────────────────────────────────────────────
export function taBlock(ta) {
  if (!ta || !ta.ok || !ta.lines.length) return '';
  return '\n<i>' + ta.lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n') + '</i>';
}

// ── GMGN kline path (robinhood chain — gak keindeks geckoterminal) ──
// pakai gmgn-cli market kline --chain robinhood; candle [ts_s,o,h,l,c,vol]
import { execFile } from 'child_process';
const gmgnCandles = (addr, resolution, minutes) => new Promise((resolve) => {
  const from = Math.floor(Date.now() / 1000) - minutes * 60;
  execFile('gmgn-cli', ['market', 'kline', '--chain', 'robinhood', '--address', addr, '--resolution', resolution, '--from', String(from), '--to', String(Math.floor(Date.now() / 1000)), '--raw'], { timeout: 20000 }, (err, stdout) => {
    if (err) return resolve([]);
    try {
      const d = JSON.parse(stdout);
      resolve((d.list || []).map(k => [Math.floor(k.time / 1000), +k.open, +k.high, +k.low, +k.close, +k.volume]));
    } catch { resolve([]); }
  });
});

export async function taReadGmgn(tokenAddr) {
  if (!tokenAddr || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddr)) return { ok: false, lines: [], bear: false };
  const TFS = [
    { id: '5m', res: '5m', min: 300 },
    { id: '15m', res: '15m', min: 900 },
    { id: '1h', res: '1h', min: 1440 },
  ];
  const lines = [];
  let bear = false, any = false;
  for (const t of TFS) {
    try {
      const rows = await gmgnCandles(tokenAddr.toLowerCase(), t.res, t.min);
      if (rows.length < 60) continue; // 1h w/ 24h window = 24 candle — 60 gak kecapai, treat < 8
      const candles = rows; // sudah oldest → newest
      const closes = candles.map(c => c[4]);
      const px = closes[closes.length - 1];
      const e25 = ema(closes, 25), e50 = ema(closes, 50);
      if (!e25 || !e50) continue;
      const v25 = e25[e25.length - 1].v, v50 = e50[e50.length - 1].v;
      const p25 = e25[e25.length - 2]?.v ?? v25, p50 = e50[e50.length - 2]?.v ?? v50;
      const st = supertrend(candles);
      any = true;

      const golden = v25 > v50 && p25 <= p50;
      const death = v25 < v50 && p25 >= p50;
      const gapPct = Math.abs(v25 - v50) / v50 * 100;
      const nearCross = !golden && !death && gapPct < 0.3;

      let txt = `${t.id}: `;
      if (golden) txt += `⚡ GOLDEN CROSS 25/50`;
      else if (death) txt += `☠️ death cross 25/50`;
      else if (nearCross) txt += `EMAs nempel (gap ${gapPct.toFixed(2)}%) — cross imminent`;
      else if (v25 > v50) txt += `ema 25>50 ✓`;
      else txt += `ema 25<50`;

      if (st) {
        const dist = (px - st.value) / st.value * 100;
        if (st.dir === 1 && dist >= 0 && dist <= 3) txt += ` · ST bounce zone (${dist.toFixed(1)}% di atas line)`;
        else if (st.dir === 1 && dist > 3) txt += ` · ST up ${dist.toFixed(1)}%`;
        else if (st.dir === -1) txt += ` · ST down ${Math.abs(dist).toFixed(1)}%`;
      }
      lines.push(txt);

      // bear stack 1h (EMA 25/50 + ST down — 100/200 butuh data lebih panjang, 24 candle 1h kurang)
      if (t.id === '1h' && px < v50 && v25 < v50 && st && st.dir === -1) bear = true;
    } catch { /* abstain */ }
  }
  return { ok: any, lines, bear };
}

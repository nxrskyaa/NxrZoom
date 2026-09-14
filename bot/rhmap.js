// yukaya — rhmap: stockyard.rhps.fun integration (Robinhood Chain meme×stock map)
// source: github.com/gtmcknight/stockyard — /api/map.json = per-stock roster of memes
// pakai buat: (1) board /rh, (2) screening meme RH chain yang layak alert,
// (3) safety read: share-side liquidity (sk>0 = pool beneran pegang sahamnya)
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_URL = 'https://stockyard.rhps.fun/api/map.json';
const STATE_FILE = join(HERE, 'rhmap-state.json');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; YukayaBot/1.0)' };

function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { memes: {} }; } }
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('rhmap state:', e.message); } }

const kUsd = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(0) + 'k' : '$' + n.toFixed(0);

export async function rhmapScan() {
  const r = await fetch(MAP_URL, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return { error: 'map http ' + r.status };
  const d = await r.json();
  const rows = d.rows || [];

  // flatten memes
  const memes = [];
  for (const s of rows) {
    const shareSidePct = s.ml > 0 ? (s.sk / s.ml) * 100 : 0;
    for (const m of s.m || []) {
      memes.push({
        sym: m.s, addr: m.a, stock: s.t, stockPx: s.p,
        liq: m.l, vol: m.v, tx: m.tx, mc: m.mc, ageD: m.age,
        chg1h: m.cs ? m.cs[0] : null, chg24: m.cs ? m.cs[2] : null,
        shareSidePct, lp: m.lp || null, x: m.x || null, w: m.w || null,
        url: m.u || null, crown: m.c ?? null,
      });
    }
  }
  return { asOf: d.asOf, rows, memes, nStocks: rows.length };
}

// ── screening: meme yang layak alert ─────────────────────────
// gate kualitas (anti-rug heuristik dari data map):
//   liq ≥ $30k, vol24h ≥ $10k, age ≤ 14d, chg1h ≥ 25%
//   + share-side liq > 0 = pool beneran pegang saham (bukan single-sided wash)
//   + bukan dust: mc ≥ $100k
export function screenMemes(memes) {
  const now = Date.now();
  const state = loadState();
  const alerts = [];
  const seen = state.memes || {};
  for (const m of memes) {
    if ((m.liq ?? 0) < 30000) continue;
    if ((m.vol ?? 0) < 10000) continue;
    if ((m.mc ?? 0) < 100000) continue;
    if (m.ageD != null && m.ageD > 14) continue;
    if (m.chg1h == null || m.chg1h < 25) continue;
    const key = m.addr.toLowerCase();
    if (seen[key] && now - seen[key] < 6 * 3600000) continue; // cooldown 6h
    seen[key] = now;
    alerts.push(m);
  }
  state.memes = seen;
  // prune seen > 7d
  for (const [k, ts] of Object.entries(seen)) if (now - ts > 7 * 86400000) delete seen[k];
  saveState(state);
  alerts.sort((a, b) => b.chg1h - a.chg1h);
  return alerts.slice(0, 3);
}

// ── safety read per meme (dipake arc/rh alert apa pun) ───────
export function memeSafety(m) {
  const flags = [];
  if (m.ageD != null && m.ageD < 1) flags.push('⚠️ umur <1d');
  if ((m.liq ?? 0) / (m.mc || 1) < 0.02) flags.push('🚨 liq tipis vs mcap');
  if (m.shareSidePct != null && m.shareSidePct <= 1) flags.push('🚨 no MRNA — pool gak pegang sahamnya');
  return flags;
}

// ── board /rh ────────────────────────────────────────────────
export function boardCard(data) {
  const top = [...data.rows].sort((a, b) => (b.mv || 0) - (a.mv || 0)).slice(0, 8);
  const lines = [
    'RH CHAIN · meme × stock map',
    (typeof data.asOf === 'string' ? data.asOf.slice(5, 16).replace('T', ' ') : new Date(data.asOf * 1000).toISOString().slice(5, 16).replace('T', ' ')) + ' UTC',
    `stocks ${data.nStocks} · memes ${data.memes.length}`,
    '',
    'STOCK      VOL24H    CROWN MEME',
  ];
  for (const s of top) {
    const crown = (s.m || []).slice().sort((a, b) => (b.v || 0) - (a.v || 0))[0];
    const vol = '$' + (s.mv / 1e6).toFixed(1) + 'M';
    let memeTxt = '—';
    if (crown) {
      const c24 = crown.cs ? crown.cs[2] : null;
      memeTxt = `${crown.s} ${c24 != null ? (c24 >= 0 ? '+' : '') + c24.toFixed(1) + '%' : ''}`;
    }
    lines.push(('stock ' + s.t).padEnd(12) + vol.padEnd(9) + memeTxt);
  }
  return `<pre>${lines.join('\n')}</pre>`;
}

export function memeCard(m) {
  const L = (label, val) => (label + ' ').padEnd(7, ' ') + val;
  const lines = [
    `$${m.sym} on \$${m.stock} — RH chain`,
    m.addr,
    '',
    L('px', m.stockPx ? '$' + Number(m.stockPx).toFixed(2) + ' /' + m.stock : '—'),
    L('mcap', kUsd(m.mc || 0)),
    L('liq', kUsd(m.liq || 0) + (m.shareSidePct != null ? ` (${m.shareSidePct.toFixed(0)}% stock-side)` : '')),
    L('vol24h', kUsd(m.vol || 0)),
    L('chg', `${m.chg1h != null ? (m.chg1h >= 0 ? '+' : '') + m.chg1h.toFixed(1) + '% 1h' : '—'}${m.chg24 != null ? ` · ${(m.chg24 >= 0 ? '+' : '') + m.chg24.toFixed(1) + '% 24h'}` : ''}`),
    L('age', m.ageD != null ? (m.ageD < 1 ? '<1d' : m.ageD.toFixed(1) + 'd') : '—'),
    m.lp ? L('launchpad', m.lp) : null,
    '',
    ...memeSafety(m).map(f => f),
    '',
    'yukaya rh desk · stockyard',
  ].filter(Boolean);
  return `<pre>${lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')}</pre>`;
}

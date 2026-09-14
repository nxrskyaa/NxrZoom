// yukaya — smart flow: track LONG-proven wallets across arc narrative pools
// wallets diambil dari rekonstruksi PnL pool LONG/CRCL (keeper swaps decode)
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ARC_RPC || 'https://rpc.arc-scan.org';
const STATE_FILE = join(HERE, 'smart-state.json');

// watch list — top PnL/behavior wallets di $LONG (on-chain proven, 2026-09-14)
export const WATCH = [
  '0xa130577e3fcd1775e6ae51c89aa5d0d4c586484c', // whale rotator, LONG +$21k, beli semua narasi
  '0x5107a9bc9f2b6a452e0e38a1eb9fc55e3ddc0165', // accumulator 25.9M LONG, +$41k net CRCL
  '0x5ed5279d7769b57ba2506739cbd56401e5edc762', // 2.4M LONG, +$31k
  '0x0474f9dd7c3902b001ca14b7dc4a8d77e7f63bf3', // LONGCAT + ARCHITECTS buyer
  '0x0a83e8d822fc0b9029c0db4cce1c2b6398888888', // 1.6M LONG, +$5k
  '0xf955dab8bdb1158dc0df449997a057ab9eb4f774', // realized +$7.5k
  '0xefa988eabbb2b768ab95ce5a194a910b0050f377', // realized +$7k
  '0xfe6442a3b301862330ed1f6b3103386104237c30', // realized +$758
  '0xbaa0011e701079bb05b13ff55d9eb289e40e55e4', // 92 trades
  '0x333d54566d423a7c0243c8c6ec81a3264c4d5333', // 39 trades
];

// keeper-family (bukan trader)
const KEEPERS = new Set([
  '0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77',
  '0x919c548ea8a779e0e551ef35f6aba65565b140a7',
  '0x38a006cc0c8c9eb4669280145e40cade99e1b3db',
]);

// narrative pools (decoded on-chain) + token kontrak (buat link explorer)
export const POOLS = {
  LONGCAT:    { pool: '0xab4fdf36b37d980ff51e81c5476a8f91226a3638', t0: 'LONG',  t1: 'LONGCAT',  token: '0x79e4561ede9f21f5cb7d9445e0f8b20b9ad05a31' },
  ARCHITECTS: { pool: '0x0a0b6a4382810e1db376d287f3254c7419a8c3c7', t0: 'CRCL',  t1: 'ARCHITECTS', token: '0x526c91c1192594ff90697ae2bf94b47c41c44ede' },
  ARCHANGEL:  { pool: '0x66a6e7da7d202d5fed60dcc38f90c91ecd623aec', t0: 'CRCL',  t1: 'ARCHANGEL', token: '0xfabd9588da3c12a43a0ea5b913abcfd860a8cdd1' },
  ARCHAGNEL:  { pool: '0x417131cbc9ea95f96a058bd4daab398e91f87c2d', t0: 'ARCHAGNEL', t1: 'CRCL', token: '0x0be45b23b584f33aa734d31e8666713a5cd013f2' },
  LONGGUY:    { pool: '0x585196fb47c5877aadbd42c7a562b328d1dd9103', t0: 'LONG',  t1: 'LONGGUY',  token: '0x1f8208c55ee2647146bf187fb4a07629324f604f' },
  DONG:       { pool: '0x3046e901717136277eeae9ffd896cc7f8af0963b', t0: 'LONG',  t1: 'DONG',     token: '0x67b6e08bb16955af7de07c3ad98b81abae26ec4f' },
  JERK:       { pool: '0xef62470d469a4f119843ac6c1df090d43b4bae43', t0: 'CRCL',  t1: 'JERK',     token: '0xe71891015472e8ae6bd9d5f7d4e9a9bf6cf6055c' },
};

const SWAP = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
// uint256-signed parse — WAJIB BigInt (parseInt kehilangan presisi → nilai negatif = 0)
const S = h => { const v = BigInt(h); return v >= (1n << 255n) ? v - (1n << 256n) : v; };

function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { lastBlock: {}, alertTs: {} }; } }
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('smart state:', e.message); } }

const ENDPOINTS = [RPC, 'https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8'];
let epIdx = 0;
async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  for (let i = 0; i < 6; i++) {
    const ep = ENDPOINTS[(epIdx + i) % ENDPOINTS.length];
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' }, body, signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      if (d.result !== undefined) { epIdx = (epIdx + i) % ENDPOINTS.length; return d.result; }
    } catch { /* next */ }
    await new Promise(res => setTimeout(res, 2000 + i * 1500));
  }
  return null;
}

const CRCL_USD = 90.6; // refresh tiap cycle dari keeper /pairs

// decode: user menerima token0 jika a0<0, token1 jika a1<0
function decodeSwap(l) {
  const sender = '0x' + l.topics[1].slice(-40).toLowerCase();
  const recipient = '0x' + l.topics[2].slice(-40).toLowerCase();
  const d = l.data.replace(/^0x/, '');
  const a0 = S('0x' + d.slice(0, 64));
  const a1 = S('0x' + d.slice(64, 128));
  return { sender, recipient, a0, a1, block: parseInt(l.blockNumber, 16), ts: parseInt(l.blockTimestamp, 16) };
}

// user endpoint = yang bukan keeper
function humanOf(sw) {
  if (!KEEPERS.has(sw.sender)) return sw.sender;
  if (!KEEPERS.has(sw.recipient)) return sw.recipient;
  return null;
}

const short = a => a.slice(0, 8) + '…' + a.slice(-4);
const fmtA = n => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : n.toFixed(1);

// ── wallet behavior classifier (paperhand vs gacor) ─────────
// FIFO match buys→sells, avg hold time, exit quality (jual deket top lokal?)
import { readFileSync as _rf } from 'fs';
const BASELINE_FILE = join(HERE, 'baseline-long-trades.json');
let PROFILES = null; // wallet → {trades:[{side,ts,px,tokAmt}]} dari baseline + live

function loadProfiles() {
  if (PROFILES) return PROFILES;
  PROFILES = {};
  try {
    const b = JSON.parse(_rf(BASELINE_FILE, 'utf8'));
    for (const t of b.trades || []) {
      (PROFILES[t.w] ||= []).push({ side: (t.side || '').toLowerCase(), ts: t.ts, px: t.px, tok: t.long, crcl: t.crcl });
    }
  } catch {}
  return PROFILES;
}
function addTrade(w, side, ts, px, tokAmt, crclVal) {
  const p = loadProfiles();
  (p[w] ||= []).push({ side, ts, px, tok: tokAmt, crcl: crclVal });
  if (p[w].length > 400) p[w].splice(0, p[w].length - 400); // jaga memori
}

// px timeline untuk exit quality (dari swap stream, ts→px CRCL/LONG)
let PXTL = []; // [{ts, px}]
export function feedPxTimeline(rows) { PXTL = rows; }
const pxAt = ts => { // max px dalam [ts, ts+2h] — seberapa bagus dia jual vs pump sesudahnya
  if (!PXTL.length) return null;
  let mx = 0;
  for (const r of PXTL) { if (r.ts >= ts - 600 && r.ts <= ts + 7200) mx = Math.max(mx, r.px); }
  return mx || null;
};

export function classifyWallet(w) {
  const p = loadProfiles();
  const tt = p[w];
  if (!tt || tt.length < 2) return { tier: 'MID', note: 'data kurang' };
  // FIFO
  const buys = [];
  let holdSum = 0, holdN = 0, exitSum = 0, exitN = 0, net = 0, inv = 0;
  for (const t of tt.sort((a, b) => a.ts - b.ts)) {
    if (t.side === 'buy') { buys.push(t); inv += t.tok; net += t.crcl; }
    else {
      inv -= t.tok; net -= t.crcl;
      let left = t.tok;
      while (left > 0 && buys.length) {
        const b = buys[0];
        const take = Math.min(left, b.tok);
        holdSum += (t.ts - b.ts) * take; holdN += take;
        const mx = pxAt(t.ts);
        if (mx && t.px) { exitSum += (t.px / mx); exitN++; }
        b.tok -= take; left -= take;
        if (b.tok <= 1e-9) buys.shift();
      }
    }
  }
  const avgHoldMin = holdN > 0 ? (holdSum / holdN) / 60000 : null;
  const exitScore = exitN > 0 ? exitSum / exitN : null;
  // klasifikasi (exitScore null kalau px timeline belum keisi → pakai hold+net saja)
  let tier = 'MID';
  const canExit = exitScore != null;
  if (avgHoldMin != null && avgHoldMin < 45) {
    // flip cepat: paperhand KECUALI exit-nya terbukti bagus (jual deket top, profit)
    if (canExit && net > 0 && exitScore >= 0.8) tier = 'GACOR';
    else if (canExit && exitScore < 0.75) tier = 'PAPERHAND';
    else if (!canExit && net > 0) tier = 'MID';
    else tier = 'PAPERHAND';
  }
  else if (net > 0 && avgHoldMin != null && avgHoldMin >= 120 && (!canExit || exitScore >= 0.7)) tier = 'GACOR';
  else if (avgHoldMin != null && avgHoldMin >= 240) tier = 'DIAMOND';
  return { tier, avgHoldMin: avgHoldMin != null ? Math.max(1, Math.round(avgHoldMin)) : null, exitScore: exitScore != null ? +exitScore.toFixed(2) : null, net: +net.toFixed(2), inv: Math.round(inv) };
}

export const TIER_W = { GACOR: 2.0, DIAMOND: 1.5, MID: 1.0, PAPERHAND: 0.4 };

// ── launch scorer: wallet watchlist masuk token baru? ────────
// l = launch object {pool, token} — orientasi narrative token di-resolve dari token0 pool
export async function scoreLaunch(l, fromBlock, toBlock) {
  const hits = [];
  // token0 pool vs kontrak launch → narrative di t0 atau t1
  let tokIsT0 = true;
  const t0 = await rpc('eth_call', [{ to: l.pool, data: '0x0dfe1681' }, 'latest']);
  if (t0 && t0 !== '0x') tokIsT0 = ('0x' + t0.slice(-40).toLowerCase()) === (l.token || '').toLowerCase();
  let f = fromBlock;
  while (f <= toBlock) {
    const t = Math.min(f + 9999, toBlock);
    const logs = await rpc('eth_getLogs', [{ address: l.pool, fromBlock: '0x' + f.toString(16), toBlock: '0x' + t.toString(16) }]);
    if (logs) {
      for (const lg of logs) {
        if (lg.topics[0] !== SWAP) continue;
        const sw = decodeSwap(lg);
        const w = humanOf(sw);
        if (!w || !WATCH.includes(w)) continue;
        const tokRaw = tokIsT0 ? sw.a0 : sw.a1;
        const othRaw = tokIsT0 ? sw.a1 : sw.a0;
        const tokAmt = Number(tokRaw < 0n ? -tokRaw : tokRaw) / 1e18;
        const othAmt = Number(othRaw < 0n ? -othRaw : othRaw) / 1e18;
        const side = tokRaw < 0n ? 'buy' : 'sell'; // terima narrative = buy
        hits.push({ w, side, tok: tokAmt, crcl: othAmt, ts: sw.ts });
      }
      f = t + 1;
    } else break; // rpc gagal — stop
  }
  const tiers = {};
  let score = 0;
  for (const h of hits) {
    if (!tiers[h.w]) tiers[h.w] = classifyWallet(h.w).tier;
    if (h.side === 'buy') score += TIER_W[tiers[h.w]] || 1;
    else score -= (TIER_W[tiers[h.w]] || 1) * 0.5; // jual = ngurangi skor
  }
  return { hits, tiers, score: +score.toFixed(1), wallets: Object.keys(tiers).length };
}

// ── cycle ────────────────────────────────────────────────────
// scan semua pool, decode swap oleh watch wallets sejak lastBlock.
// return { alerts:[{sym, lines, crcl, token, nWallets}], scanned }
export async function smartScan(opts = {}) {
  const state = loadState();
  const headHex = await rpc('eth_blockNumber', []);
  if (!headHex) return { alerts: [], scanned: 0, error: 'rpc head fail' };
  const head = parseInt(headHex, 16);

  // refresh CRCL price dari keeper pairs (best-effort)
  try {
    const r = await fetch('https://long-supply-keeper-production.up.railway.app/pairs', { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    const crcl = (d.pairs || []).find(p => p.symbol === 'CRCL');
    if (crcl) CRCL_USD = Number(BigInt(crcl.usdX18)) / 1e18;
  } catch {}

  const byToken = {}; // sym → { lines:[], crcl:0, wallets:Set, token }
  let scanned = 0;
  const pxRows = [];

  for (const [sym, cfg] of Object.entries(POOLS)) {
    const from = state.lastBlock[sym] ? state.lastBlock[sym] + 1 : head - 15000; // first run: ~4 jam
    if (from > head) { continue; }
    const to = Math.min(from + 9999, head);
    const logs = await rpc('eth_getLogs', [{ address: cfg.pool, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]);
    if (!logs) continue; // jangan advance lastBlock kalau gagal — cycle berikutnya retry
    state.lastBlock[sym] = to;
    scanned += to - from + 1;

    // narrative token di pool ini: t0 (ARCHAGNEL) atau t1 (sisanya)
    const tokIsT0 = cfg.t0 === sym;

    for (const l of logs) {
      if (l.topics[0] !== SWAP) continue;
      const sw = decodeSwap(l);

      // px timeline (harga token narasi dalam CRCL) — dari SEMUA swap
      const tokRaw = tokIsT0 ? sw.a0 : sw.a1;
      const othRaw = tokIsT0 ? sw.a1 : sw.a0;
      const tokAbs = tokRaw < 0n ? -tokRaw : tokRaw;
      const othAbs = othRaw < 0n ? -othRaw : othRaw;
      const tokAmtAll = Number(tokAbs) / 1e18;
      const othSymAll = tokIsT0 ? cfg.t1 : cfg.t0;
      const othAmtAll = Number(othAbs) / 1e18;
      if (othSymAll === 'CRCL' && tokAmtAll > 0) {
        pxRows.push({ ts: sw.ts, px: othAmtAll / tokAmtAll });
        if (pxRows.length > 20000) pxRows.shift();
      }

      const w = humanOf(sw);
      if (!w || !WATCH.includes(w)) continue;

      // a<0n → pool bayar (user terima); a>0n → pool terima (user bayar)
      const recvTok = tokIsT0 ? sw.a0 < 0n : sw.a1 < 0n;
      const payTok = tokIsT0 ? sw.a0 > 0n : sw.a1 > 0n;
      if (!recvTok && !payTok) continue;
      const side = recvTok ? 'buy' : 'sell';
      const tokAmt = tokAmtAll;
      const otherSym = tokIsT0 ? cfg.t1 : cfg.t0;
      const otherAmt = othAmtAll;

      // nilai dalam CRCL
      let crclVal = 0;
      if (otherSym === 'CRCL') crclVal = otherAmt;
      else if (otherSym === 'LONG') crclVal = otherAmt * 0.000128;
      const tokPx = tokAmt > 0 && crclVal > 0 ? crclVal / tokAmt : 0;

      // rekam ke profil wallet (buat classifier)
      addTrade(w, side, sw.ts, tokPx, tokAmt, crclVal);

      if (!byToken[sym]) byToken[sym] = { lines: [], crcl: 0, wallets: new Set(), token: cfg.token, buys: 0, sells: 0 };
      const b = byToken[sym];
      b.wallets.add(w);
      const tier = classifyWallet(w).tier;
      if (side === 'buy') { b.buys++; b.crcl += crclVal; b.lines.push(`${short(w)} ${tier} buy ${fmtA(tokAmt)} ${sym}${crclVal ? ` (${crclVal.toFixed(2)} CRCL)` : ''}`); }
      else { b.sells++; b.crcl -= crclVal; b.lines.push(`${short(w)} ${tier} sell ${fmtA(tokAmt)} ${sym}${crclVal ? ` (${crclVal.toFixed(2)} CRCL)` : ''}`); }
    }
  }
  feedPxTimeline(pxRows);
  saveState(state);

  // build alerts: buys>sells & (nilai ≥0.5 CRCL atau ≥2 wallet), cooldown 4 jam
  const now = Date.now();
  const alerts = [];
  for (const [sym, b] of Object.entries(byToken)) {
    const sig = 'sm:' + sym;
    const hot = b.buys >= b.sells && (b.crcl >= 0.5 || b.wallets.size >= 2);
    if (!hot) continue;
    if (state.alertTs[sig] && now - state.alertTs[sig] < 4 * 3600000) continue;
    state.alertTs[sig] = now;
    // agregasi tier
    const mix = {};
    for (const w of b.wallets) { const t = classifyWallet(w).tier; mix[t] = (mix[t] || 0) + 1; }
    alerts.push({ sym, ...b, wallets: b.wallets.size, lines: b.lines.slice(0, 6), mix });
  }
  saveState(state);
  alerts.sort((a, b) => (b.crcl || 0) - (a.crcl || 0) || b.wallets - a.wallets);
  return { alerts: alerts.slice(0, 3), scanned };
}

// ── card ─────────────────────────────────────────────────────
export function smartCard(a) {
  const mixTxt = a.mix ? Object.entries(a.mix).map(([t, n]) => `${n} ${t.toLowerCase()}`).join(' · ') : '';
  const lines = [
    `$${a.sym} — smartmoney flow`,
    '',
    ...a.lines,
    '',
    `wallets: ${a.wallets}/${WATCH.length} watch · buys ${a.buys} · sells ${a.sells}`,
    mixTxt ? `mix: ${mixTxt}` : null,
    `net ~${a.crcl.toFixed(2)} CRCL (≈$${(a.crcl * CRCL_USD).toFixed(0)})`,
    '',
    'yukaya arc desk · smartmoney',
  ].filter(Boolean);
  return `<pre>${lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')}</pre>`;
}

export { CRCL_USD };

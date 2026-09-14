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
      const w = humanOf(sw);
      if (!w || !WATCH.includes(w)) continue;

      // a<0n → pool bayar (user terima); a>0n → pool terima (user bayar)
      const recvTok = tokIsT0 ? sw.a0 < 0n : sw.a1 < 0n;
      const payTok = tokIsT0 ? sw.a0 > 0n : sw.a1 > 0n;
      if (!recvTok && !payTok) continue;
      const side = recvTok ? 'buy' : 'sell';
      const tokAmt = Number(tokIsT0 ? (sw.a0 < 0n ? -sw.a0 : sw.a0) : (sw.a1 < 0n ? -sw.a1 : sw.a1)) / 1e18;
      const otherSym = tokIsT0 ? cfg.t1 : cfg.t0;
      const otherRaw = tokIsT0 ? (sw.a1 < 0n ? -sw.a1 : sw.a1) : (sw.a0 < 0n ? -sw.a0 : sw.a0);
      const otherAmt = Number(otherRaw) / 1e18;

      // nilai dalam CRCL
      let crclVal = 0;
      if (otherSym === 'CRCL') crclVal = otherAmt;
      else if (otherSym === 'LONG') crclVal = otherAmt * 0.000128;

      if (!byToken[sym]) byToken[sym] = { lines: [], crcl: 0, wallets: new Set(), token: cfg.token, buys: 0, sells: 0 };
      const b = byToken[sym];
      b.wallets.add(w);
      if (side === 'buy') { b.buys++; b.crcl += crclVal; b.lines.push(`${short(w)} buy ${fmtA(tokAmt)} ${sym}${crclVal ? ` (${crclVal.toFixed(2)} CRCL)` : ''}`); }
      else { b.sells++; b.crcl -= crclVal; b.lines.push(`${short(w)} sell ${fmtA(tokAmt)} ${sym}${crclVal ? ` (${crclVal.toFixed(2)} CRCL)` : ''}`); }
    }
  }
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
    alerts.push({ sym, ...b, wallets: b.wallets.size, lines: b.lines.slice(0, 6) });
  }
  saveState(state);
  alerts.sort((a, b) => (b.crcl || 0) - (a.crcl || 0) || b.wallets - a.wallets);
  return { alerts: alerts.slice(0, 3), scanned };
}

// ── card ─────────────────────────────────────────────────────
export function smartCard(a) {
  const lines = [
    `$${a.sym} — smartmoney flow`,
    '',
    ...a.lines,
    '',
    `wallets: ${a.wallets}/${WATCH.length} watch · buys ${a.buys} · sells ${a.sells}`,
    `net ~${a.crcl.toFixed(2)} CRCL (≈$${(a.crcl * CRCL_USD).toFixed(0)})`,
    '',
    'yukaya arc desk · smartmoney',
  ];
  return `<pre>${lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')}</pre>`;
}

export { CRCL_USD };

// yukaya — arc desk: long.supply (stocks on arc) tracker
// frontrun engine: new token launches + movers on arc, paired vs real stocks
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEPER = process.env.ARC_KEEPER || 'https://long-supply-keeper-production.up.railway.app';
const RPC = process.env.ARC_RPC || 'https://rpc.arc-scan.org';
const STATE_FILE = join(HERE, 'arc-state.json');

function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { seen: {}, hist: {}, supplyCache: {}, pairAlert: {}, moverAlert: {} }; } }
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('arc state save:', e.message); } }

const x18 = v => Number(BigInt(v)) / 1e18;
export const fmtUsd = n => n == null ? '—' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'k' : '$' + n.toFixed(2);

async function keeper(path) {
  const r = await fetch(KEEPER + path, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('keeper ' + r.status);
  return r.json();
}

async function totalSupply(token) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data: '0x18160ddd' }, 'latest'] }),
    signal: AbortSignal.timeout(12000),
  });
  const d = await r.json();
  if (!d.result || d.result === '0x') throw new Error('no supply');
  return BigInt(d.result);
}

// parallel chunks
async function mapChunked(items, fn, size = 12) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const vals = await Promise.all(slice.map(x => fn(x).catch(() => null)));
    vals.forEach((v, j) => { out[i + j] = v; });
  }
  return out;
}

// ── scan ─────────────────────────────────────────────────────
// returns { launches, stocks:{sym:{addr,usd}}, new:[launch], movers:[launch] }
export async function arcScan(opts = {}) {
  const state = loadState();
  const now = Date.now();

  const [pairs, feed] = await Promise.all([
    keeper('/pairs'),
    keeper('/launches?limit=100&offset=0'),
  ]);

  const stocks = {};
  for (const p of pairs.pairs || []) {
    stocks[(p.arcStock || '').toLowerCase()] = { sym: p.symbol, usd: x18(p.usdX18) };
  }

  const ls = feed.launches || [];
  const supplies = await mapChunked(ls, async l => {
    const t = (l.token || '').toLowerCase();
    const c = state.supplyCache[t];
    if (c && now - c.at < 30 * 60000) return BigInt(c.v);
    const s = await totalSupply(t);
    state.supplyCache[t] = { at: now, v: s.toString() };
    return s;
  });

  const out = [];
  const newLaunches = [];
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const token = (l.token || '').toLowerCase();
    const pair = (l.pairToken || '').toLowerCase();
    const stock = stocks[pair];
    const priceUsd = l.priceX18 != null && stock ? x18(l.priceX18) * stock.usd : null;
    const supply = supplies[i];
    const fdvUsd = priceUsd != null && supply ? priceUsd * Number(supply) / 1e18 : null;

    // price history (48h rolling) for movers
    const hist = state.hist[token] || (state.hist[token] = []);
    hist.push({ at: now, p: priceUsd });
    while (hist.length && now - hist[0].at > 48 * 3600000) hist.shift();
    let chg = null;
    if (priceUsd != null && hist.length > 1 && hist[0].p > 0) chg = (priceUsd / hist[0].p - 1) * 100;

    const isNew = !state.seen[token];
    state.seen[token] = now;
    if (isNew && !opts.firstRun && (fdvUsd == null || fdvUsd >= 5000)) newLaunches.push(token);

    out.push({
      sym: l.symbol, name: l.name, token, pool: l.pool, deployer: l.deployer,
      priceUsd, fdvUsd, pair, pairSym: stock ? stock.sym : 'pair',
      chg, image: l.image || null, website: l.website || null, twitter: l.twitter || null,
      positionId: l.positionId,
    });
  }

  // prune supply cache > 7d
  for (const [t, c] of Object.entries(state.supplyCache)) if (now - c.at > 7 * 86400000) delete state.supplyCache[t];

  saveState(state);
  const movers = out
    .filter(t => t.chg != null && t.chg >= 15 && (t.fdvUsd ?? 0) >= 50_000)
    .sort((a, b) => b.chg - a.chg);
  return { launches: out, stocks, newLaunches, movers };
}

// ── cards ────────────────────────────────────────────────────
export function launchCard(l, stocks) {
  const L = (label, val) => label.padEnd(8, ' ') + val;
  const lines = [
    `$${l.sym} — ${l.name || 'unnamed'}`,
    l.token,
    '',
    L('price', l.priceUsd != null ? '$' + (l.priceUsd >= 0.01 ? l.priceUsd.toFixed(4) : l.priceUsd.toPrecision(3)) : '—'),
    L('fdv', fmtUsd(l.fdvUsd)),
    L('pair', l.pairSym),
    '',
    'deployer ' + l.deployer.slice(0, 6) + '…' + l.deployer.slice(-4),
    'yukaya arc desk · new launch',
  ];
  return `<pre>${lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')}</pre>`;
}

// socials sebagai link klikable (di luar mono card biar bisa di-copy/tap)
export function socialLinks(l) {
  const parts = [];
  if (l.website) parts.push(`<a href="${escAttr(l.website)}">🌐 site</a>`);
  if (l.twitter) parts.push(`<a href="${escAttr(l.twitter)}">𝕏 x</a>`);
  if (l.telegram) parts.push(`<a href="${escAttr(l.telegram)}">💬 tg</a>`);
  return parts.length ? parts.join(' · ') : '';
}
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function moverCard(l) {
  const L = (label, val) => label.padEnd(8, ' ') + val;
  const lines = [
    `$${l.sym} — ${l.name || 'unnamed'}`,
    l.token,
    '',
    L('pump', '+' + l.chg.toFixed(0) + '%'),
    L('price', l.priceUsd != null ? '$' + (l.priceUsd >= 0.01 ? l.priceUsd.toFixed(4) : l.priceUsd.toPrecision(3)) : '—'),
    L('fdv', fmtUsd(l.fdvUsd)),
    L('pair', l.pairSym),
    '',
    'yukaya arc desk · mover',
  ];
  return `<pre>${lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')}</pre>`;
}

export function boardCard(r) {
  const L = (label, val) => label.padEnd(9, ' ') + val;
  const stockList = Object.values(r.stocks)
    .filter(s => s.sym !== 'WETH')
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 8)
    .map(s => L(s.sym.toLowerCase(), fmtUsd(s.usd)));
  const top = [...r.launches].filter(l => l.fdvUsd).sort((a, b) => b.fdvUsd - a.fdvUsd).slice(0, 6)
    .map(l => L(l.sym.toLowerCase().slice(0, 8), (fmtUsd(l.fdvUsd) + '').padEnd(8) + (l.chg != null ? (l.chg >= 0 ? '+' : '') + l.chg.toFixed(0) + '%' : '—')));
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' });
  const lines = [
    'stocks on arc (long.supply)',
    '─────────────────────────',
    ...stockList,
    '',
    'top tokens by fdv',
    '─────────────────────────',
    ...top,
    '',
    `${r.launches.length} tokens live`,
    'yukaya arc desk · ' + now + ' WITA',
  ];
  return `<pre>${lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')}</pre>`;
}

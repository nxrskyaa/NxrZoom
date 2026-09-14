// yukaya — rh desk: Robinhood Chain bridge-inflow screener
// demand signal: user bridge rhToken (saham) → vault long.supply custody = mint arcToken di Arc
// inflow gede ke vault = permintaan saham di Arc naik → narasi potensial
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RH_RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const KEEPER = 'https://long-supply-keeper-production.up.railway.app';
const STATE_FILE = join(HERE, 'rh-state.json');
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { head: 0, sym: {} }; } }
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('rh state:', e.message); } }

async function rpc(method, params) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(RH_RPC, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      if (d.result !== undefined) return d.result;
    } catch {}
    await new Promise(res => setTimeout(res, 1500 + i * 1000));
  }
  return null;
}

// pad address ke topic 32 byte
const topic = addr => '0x' + addr.replace(/^0x/, '').toLowerCase().padStart(64, '0');

// ── scan ─────────────────────────────────────────────────────
// return { alerts:[{sym, inflowUsd, nTx, usd}], head, tracked }
export async function rhScan() {
  const pairs = await fetch(KEEPER + '/pairs', { signal: AbortSignal.timeout(12000) }).then(r => r.json()).catch(() => null);
  if (!pairs) return { alerts: [], error: 'keeper fail' };

  const headHex = await rpc('eth_blockNumber', []);
  if (!headHex) return { alerts: [], error: 'rh rpc fail' };
  const head = parseInt(headHex, 16);

  const state = loadState();
  if (!state.sym) state.sym = {};
  const baseFrom = state.head ? state.head + 1 : head - 3000; // first run baseline ~12.5 menit

  const alerts = [];
  let tracked = 0;
  for (const p of pairs.pairs || []) {
    if (!p.underlying || !p.vault || !p.usdX18) continue;
    const usd = Number(BigInt(p.usdX18)) / 1e18;
    if (p.symbol === 'WETH') continue;
    tracked++;
    const from = state.sym[p.symbol] != null ? state.sym[p.symbol] + 1 : baseFrom;
    if (from > head) continue;
    const to = Math.min(from + 9000, head);
    const logs = await rpc('eth_getLogs', [{
      address: p.underlying,
      topics: [TRANSFER, null, topic(p.vault)], // to = vault
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16),
    }]);
    if (logs) state.sym[p.symbol] = to;
    if (!logs || !logs.length) continue;

    let amt = 0;
    for (const l of logs) amt += Number(BigInt(l.data)) / 1e18;
    const inflowUsd = amt * usd;
    // threshold: inflow ≥ $5k dalam window → layak alert (bukan noise)
    if (inflowUsd >= 5000) alerts.push({ sym: p.symbol, inflowUsd, nTx: logs.length, usd });
  }
  state.head = head;
  saveState(state);
  alerts.sort((a, b) => b.inflowUsd - a.inflowUsd);
  return { alerts: alerts.slice(0, 3), head, tracked };
}

export function rhCard(a) {
  const lines = [
    `$${a.sym} — bridge inflow`,
    '',
    `in   $${a.inflowUsd >= 1000 ? (a.inflowUsd / 1000).toFixed(1) + 'k' : a.inflowUsd.toFixed(0)}`,
    `tx   ${a.nTx}`,
    `px   $${a.usd.toFixed(2)}`,
    '',
    'custody vault menerima rhToken',
    '→ mint arcToken di Arc (demand naik)',
    '',
    'yukaya rh desk · bridge screener',
  ];
  return `<pre>${lines.map(x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')}</pre>`;
}

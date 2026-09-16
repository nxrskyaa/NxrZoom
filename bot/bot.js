// Yukaya by NxrLabs — Telegram signal bot (nxrzoom engine)
// owner-gated, long-polling, zero deps (node 22 native fetch)
import { scan, pickAlerts, buildRecap, CFG, levelOf, fmtShort } from './engine.js';
import { enrich } from './enrich.js';
import { arcScan, launchCard, socialLinks, moverCard, boardCard, fmtUsd } from './arc.js';
import { smartScan, smartCard, POOLS as SMART_POOLS, scoreLaunch } from './smart.js';
import { rhmapScan, screenMemes, memeCard, boardCard as rhBoardCard } from './rhmap.js';
import { taRead, taReadGmgn } from './ta.js';
import { gmgnMap, gmgnGates, gmgnLines } from './gmgn.js';
import { poolScan, poolCard } from './pool.js';
import { lpScan, lpWatch, lpCard, lpGates } from './lpin.js';
import { smTrackScan, smCard } from './smtrack.js';
import { renderRecap, recordSignal, snapshotCycle } from './recap.js';
import { cexAnomalies } from './cex.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── env ──────────────────────────────────────────────────────
let env = {};
try { env = Object.fromEntries(readFileSync(join(HERE, '.env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); } catch {}
const TOKEN = process.env.YUKAYA_TOKEN || env.YUKAYA_TOKEN;
const OWNERS = String(process.env.OWNER_IDS || env.OWNER_IDS || '').split(',').map(Number).filter(Boolean);
// where alerts go: default = first owner's private chat; override with ALERT_CHAT_ID / ALERT_THREAD_ID
const ALERT_CHAT = String(env.ALERT_CHAT_ID || '') || null;
const ALERT_THREAD = env.ALERT_THREAD_ID ? Number(env.ALERT_THREAD_ID) : null;
const API = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) { console.error('YUKAYA_TOKEN required'); process.exit(1); }
if (!OWNERS.length) { console.error('OWNER_IDS required'); process.exit(1); }

// mute state
const MUTE_FILE = join(HERE, 'mute.json');
let mutedUntil = 0;
try { mutedUntil = Number(JSON.parse(readFileSync(MUTE_FILE, 'utf8')).until) || 0; } catch {}
function setMute(hrs) {
  mutedUntil = hrs > 0 ? Date.now() + hrs * 3600000 : 0;
  writeFileSync(MUTE_FILE, JSON.stringify({ until: mutedUntil }));
}

// channel binding (set via /setchannel posted inside the target channel)
const CHANNEL_FILE = join(HERE, 'channel.json');
function loadChannel() {
  try { const c = JSON.parse(readFileSync(CHANNEL_FILE, 'utf8')); if (c.chatId) return c; } catch {}
  return null;
}
function saveChannel(chatId, threadId, title) {
  writeFileSync(CHANNEL_FILE, JSON.stringify({ chatId, threadId: threadId || null, title: title || '', at: Date.now() }));
}
// alert destination: bound channel → env override → owner DM
function alertTarget() {
  const ch = loadChannel();
  if (ch) return { chat: ch.chatId, thread: ch.threadId, where: 'channel ' + (ch.title || ch.chatId) };
  return { chat: ALERT_CHAT || OWNERS[0], thread: ALERT_THREAD, where: ALERT_CHAT ? 'chat ' + ALERT_CHAT : 'DM owner' };
}

// ── tg helpers ───────────────────────────────────────────────
async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`tg ${method}: ${d.description}`);
  return d.result;
}
function send(chatId, text, extra = {}) {
  const p = { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra };
  const t = alertTarget();
  if (t.thread && String(chatId) === String(t.chat)) p.message_thread_id = t.thread;
  return tg('sendMessage', p);
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const meter = sev => '▰'.repeat(Math.round(sev / 10)) + '▱'.repeat(10 - Math.round(sev / 10));

function alertKeyboard(p) {
  const ca = p.baseToken.address;
  return { inline_keyboard: [
    [
      { text: '📈 Chart', url: p.url || `https://dexscreener.com/solana/${ca}` },
      { text: 'axiom', url: `https://axiom.trade/t/${ca}` },
      { text: 'gmgn', url: `https://gmgn.ai/sol/token/${ca}` },
    ],
    [{ text: '⧉ Copy CA', copy_text: { text: ca } }],
  ] };
}

// plain reads (rendered inside the mono card — no rich tags)
function buildReads(p, e) {
  const fw = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n ?? 0);
  const L = (label, val) => label.padEnd(8, ' ') + val;
  const reads = [];
  if (e.pressure.h1 != null) reads.push(L('flow', `buy ${e.pressure.h1}%` + (e.accel != null ? ` · accel ${e.accel}x` : '')));
  if (e.rug && e.rug.score != null) reads.push(L('safety', `${e.rug.score}/100 ${e.rug.score < 25 ? 'ok' : e.rug.score < 60 ? 'mid' : 'RISK'}`));
  const t24 = p.txns?.h24;
  if (t24 && t24.buys + t24.sells > 0) reads.push(L('wallets', `${fw(t24.buys)} b / ${fw(t24.sells)} s`));
  const sm5 = p.txns?.m5?.buys ?? null, sh1 = p.txns?.h1?.buys ?? null;
  if (sm5 != null || sh1 != null) reads.push(L('entry', `${fw(sm5 ?? 0)} (5m)` + (sh1 != null ? ` · ${fw(sh1)} (1h)` : '')));
  for (const f of e.flags) reads.push('! ' + f.replace(/^[^\w$]+ /, '').replace(/<[^>]+>/g, ''));
  return reads;
}

// full signal card — mono terminal style
function fmtCard(p, s, e, ta, g) {
  const pc = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const mc = p.marketCap ?? p.fdv;
  const P = (label, val) => label.padEnd(8, ' ') + val;
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' });
  const liqMcTxt = e.liqMc != null ? ` · ${e.liqMc}% mc` : '';
  const lines = [
    `$${p.baseToken.symbol} — ${p.baseToken.name}`,
    p.baseToken.address,
    `${meter(s.severity)} sev ${s.severity} · ${s.side}${s.confidence ? ` · conf ${s.confidence}%` : ''}`,
    ``,
    P('price', p.priceUsd != null ? '$' + p.priceUsd.toPrecision(4) : '—'),
    P('mcap', '$' + fmtShort(mc)),
    P('liq', '$' + fmtShort(p.liquidity?.usd) + liqMcTxt),
    P('vol 24h', '$' + fmtShort(p.volume?.h24) + (s.volMc != null ? ` · turn ${s.volMc.toFixed(2)}x` : '')),
    ``,
    `5m ${pc(p.priceChange?.m5)}  1h ${pc(p.priceChange?.h1)}  24h ${pc(p.priceChange?.h24)}` + (e.ageHrs != null ? `\nage ${e.ageHrs}h` : ''),
    ``,
    ...buildReads(p, e),
    ...(ta && ta.ok ? ['', '── ta 5m/15m/1h ──', ...ta.lines] : []),
    ...(gmgnLines(g).length ? ['', '── security gmgn ──', ...gmgnLines(g)] : []),
    ``,
    `yukaya signal desk · ${now} WITA`,
  ];
  return `<pre>${esc(lines.join('\n'))}</pre>`;
}

function fmtAlert(r, e, ta, g) {
  const { pair: p, score: s } = r;
  const head = s.side === 'BUY'
    ? '🟢 <b>BUY SIGNAL</b>'
    : s.side === 'SELL' ? '🔴 <b>SELL PRESSURE</b>' : '🟡 <b>ANOMALY</b>';
  return `⚡ <b>YUKAYA</b> · NxrLabs\n${head}\n\n${fmtCard(p, s, e, ta, g)}`;
}

// ── arc desk cycle (long.supply frontrun) ────────────────────
const ARC_ALERT_FILE = join(HERE, 'arc-alerts.json');
const ARC_POLL_MIN = Number(env.ARC_POLL_MIN || 5);
let arcAlerts = {};
try { arcAlerts = JSON.parse(readFileSync(ARC_ALERT_FILE, 'utf8')); } catch {}
function saveArcAlerts() { try { writeFileSync(ARC_ALERT_FILE, JSON.stringify(arcAlerts)); } catch {} }

async function arcCycle(tgt, opts = {}) {
  const r = await arcScan(opts);
  const now = Date.now();
  let sent = 0;

  // SCREENING: launch baru di-score berdasarkan watch wallets yang masuk.
  // Gak semua launch dibagitin — cuma yang ada conviksi smartmoney.
  const fresh = r.newLaunches.map(t => r.launches.find(l => l.token === t)).filter(Boolean).slice(0, 6);
  const scored = [];
  for (const l of fresh) {
    let sc = { score: 0, tiers: {}, wallets: 0, hits: [] };
    try {
      const fromB = l.block ? Math.max(l.block, (r.head || 0) - 480000) : (r.head || 0) - 480000;
      sc = await scoreLaunch(l, fromB, r.head || fromB);
    } catch (e) { console.error('scoreLaunch:', e.message); }
    scored.push({ l, sc });
    if (arcAlerts[l.token] && now - arcAlerts[l.token] < 6 * 3600000) continue;
    // gate: skor ≥2.5 ATAU ≥2 wallet watchlist masuk → layak post
    if (sc.score < 2.5 && sc.wallets < 2) continue;
    arcAlerts[l.token] = now;
    const mixTxt = Object.entries(sc.tiers).map(([, t]) => t).join(', ');
    const smartLine = sc.wallets ? `smart entry: ${Object.values(sc.tiers).filter(t => t === 'GACOR').length} gacor · ${Object.values(sc.tiers).filter(t => t === 'DIAMOND').length} diamond (score ${sc.score})` : '';
    try {
      const links = socialLinks(l);
      await send(tgt.chat, `🟠 <b>ARC LAUNCH</b> · NxrLabs\n\n${launchCard(l, r.stocks)}${smartLine ? `\n<i>${esc(smartLine)}</i>` : ''}${links ? '\n' + links : ''}`, {
        reply_markup: { inline_keyboard: [[{ text: '⧉ Copy CA', copy_text: { text: l.token } }, { text: '🔎 Explorer', url: `https://arc-scan.org/token/${l.token}` }]] },
      });
      sent++;
    } catch (e) { console.error('arc launch send:', e.message); }
  }
  const skipped = scored.filter(s => s.sc.score < 2.5 && s.sc.wallets < 2).length;
  if (skipped) console.log(`launch screening: ${skipped} skipped (no smartmoney), ${scored.length - skipped} passed`);

  // movers: chg >= 15% over tracked window, cooldown 6h per token, max 2/cycle
  const mv = r.movers.filter(l => !arcAlerts['mv:' + l.token] || now - arcAlerts['mv:' + l.token] > 6 * 3600000).slice(0, 2);
  for (const l of mv) {
    arcAlerts['mv:' + l.token] = now;
    try {
      await send(tgt.chat, `🚀 <b>ARC PUMP</b> · NxrLabs\n\n${moverCard(l)}`, {
        reply_markup: { inline_keyboard: [[{ text: '⧉ Copy CA', copy_text: { text: l.token } }, { text: '🔎 Explorer', url: `https://arc-scan.org/token/${l.token}` }]] },
      });
      sent++;
    } catch (e) { console.error('arc mover send:', e.message); }
  }
  saveArcAlerts();
  return { ...r, sent };
}

// ── rh map cycle (stockyard meme×stock) ──────────────────────
async function rhmapCycle(tgt) {
  const d = await rhmapScan();
  if (d.error) { console.error('rhmap:', d.error); return 0; }
  const alerts = screenMemes(d.memes);
  let sent = 0;
  for (const m of alerts) {
    try {
      const ta = await taReadGmgn(m.addr).catch(() => null);
      // bear gate: 1h ema bear + ST down → skip
      if (ta?.bear) { console.log(`rhmap ta-gate skip $${m.sym}: 1h bear`); continue; }
      const chart = `https://gmgn.ai/robinhood/token/${m.addr}`;
      await send(tgt.chat, `🟣 <b>RH MEME</b> · NxrLabs\n\n${memeCard(m, ta)}\n📈 <a href="${chart}">chart gmgn</a>${m.url ? ` · <a href="${m.url}">dexscreener</a>` : ''}`, {});
      console.log(`rhmap alert: $${m.sym} on $${m.stock} +${(m.chg1h ?? 0).toFixed(0)}%`);
      sent++;
    } catch (e) { console.error('rhmap send:', e.message); }
  }
  return sent;
}
setTimeout(() => rhmapCycle(alertTarget()).catch(e => console.error('rhmap first:', e.message)), 40000);
setInterval(() => rhmapCycle(alertTarget()).catch(e => console.error('rhmap cycle:', e.message)), ARC_POLL_MIN * 180000);
async function smartCycle(tgt) {
  const r = await smartScan();
  if (r.error) { console.error('smart scan:', r.error); return { sent: 0 }; }
  let sent = 0;
  for (const a of r.alerts) {
    const tok = SMART_POOLS[a.sym]?.token;
    try {
      await send(tgt.chat, `🧠 <b>SMART FLOW</b> · NxrLabs\n\n${smartCard(a)}`, {
        reply_markup: { inline_keyboard: [[
          { text: '⧉ Copy CA', copy_text: { text: tok || a.sym } },
          ...(tok ? [{ text: '🔎 Explorer', url: `https://arc-scan.org/token/${tok}` }] : []),
        ]] },
      });
      sent++;
    } catch (e) { console.error('smart send:', e.message); }
  }
  if (r.alerts.length) console.log(`smart flow: ${r.alerts.length} alert(s) — ${r.alerts.map(a => a.sym).join(', ')}`);
  return { sent };
}

// ── cycle ────────────────────────────────────────────────────
let lastRecapDay = new Date().getDate();
let lastResults = null, lastScanAt = 0;
async function cycle(opts = {}) {
  const results = await scan(opts);
  lastResults = results; lastScanAt = Date.now();
  snapshotCycle({ tracked: results.length, scored: results.filter(x => x.score).length });
  if (mutedUntil > Date.now() && !opts.ignoreCooldown) {
    return { results, sent: 0, muted: true };
  }
  const cands = await pickAlerts(results);
  const tgt = alertTarget();
  for (const c of cands) {
    try {
      const e = await enrich(c.pair); // smart reads (abstains silently on RPC failure)
      // ── RUG GATE: hard skip — jangan sampai buy signal buat token rug ──
      if (e.rug && e.rug.score != null) {
        const danger = (e.rug.risks || []).some(r => r.level === 'danger');
        if (e.rug.score >= 45 || danger) {
          console.log(`rug-gate skip ${c.pair.baseToken?.symbol || c.pair.chainId}: score ${e.rug.score}${danger ? ' +danger risk' : ''}`);
          continue;
        }
      }
      // ── QUALITY GATE (BUY only): liq/mc/wash/umur/deadcat/fail-closed ──
      if (c.score.side === 'BUY') {
        const liq = c.pair.liquidity?.usd || 0;
        const mc = c.pair.marketCap ?? c.pair.fdv ?? 0;
        const vol = c.pair.volume?.h24 || 0;
        const ageH = c.pair.pairCreatedAt ? (Date.now() - c.pair.pairCreatedAt) / 3600000 : null;
        const chg24 = c.pair.priceChange?.h24;
        const why = [];
        if (liq < 30000) why.push(`liq $${(liq / 1000).toFixed(1)}k <30k`);
        if (mc < 50000) why.push(`mc $${(mc / 1000).toFixed(1)}k <50k`);
        if (liq > 0 && vol / liq > 30) why.push(`vol/liq ${(vol / liq).toFixed(0)}x (wash?)`);
        if (ageH != null && ageH < 1) why.push(`umur ${Math.floor(ageH * 60)}m <1h`);
        if (chg24 != null && chg24 < -50) why.push(`deadcat ${chg24.toFixed(0)}% 24h`);
        if (!e.rug || e.rug.score == null) why.push('rugcheck unreadable (fail-closed)');
        if (why.length) {
          console.log(`quality-gate skip ${c.pair.baseToken?.symbol}: ${why.join(', ')}`);
          continue;
        }
      }
      // TA read: supertrend + ema cross 5m/15m/1h (cached 3 min)
      const ta = await taRead(c.pair.pairAddress).catch(() => null);
      // GMGN security read (trending map, cached 3 min)
      const g = await gmgnMap().then(m => m[(c.pair.baseToken?.address || '').toLowerCase()]).catch(() => null);
      // GMGN GATE: wash/phishing/bundler/dev/top10
      const gwhy = gmgnGates(g);
      if (gwhy.length) {
        console.log(`gmgn-gate skip ${c.pair.baseToken?.symbol}: ${gwhy.join(', ')}`);
        continue;
      }
      // BEAR GATE: buy signal tapi 1h bear stack + ST down → skip (kejar topbagus)
      if (ta?.bear && c.score.side === 'BUY') {
        console.log(`ta-gate skip ${c.pair.baseToken?.symbol}: 1h bear stack + ST down`);
        continue;
      }
      await send(tgt.chat, fmtAlert(c, e, ta, g), { reply_markup: alertKeyboard(c.pair) });
      recordSignal({ symbol: c.pair.baseToken.symbol, address: c.pair.baseToken.address, chain: c.pair.chainId, entry: c.pair.priceUsd, severity: c.score.severity, side: c.score.side });
      hourlyAlerts++;
    } catch (e) { console.error('send failed:', e.message); }
  }
  // daily recap
  const today = new Date().getDate();
  if (new Date().getHours() >= CFG.recapHour && lastRecapDay !== today) {
    lastRecapDay = today;
    const rec = await buildRecap(results);
    await send(tgt.chat, recapText(rec)).catch(() => {});
  }
  return { results, sent: cands.length, muted: false };
}

function recapText(rec) {
  const lines = ['📊 <b>YUKAYA DAILY RECAP — 24H</b>', ''];
  if (rec.top.length) {
    lines.push('<b>Top movers</b>');
    for (const t of rec.top) {
      const ch = t.pair.priceChange?.h24;
      lines.push(`• <b>$${esc(t.pair.baseToken.symbol)}</b> ${ch != null ? (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%' : ''} · vol $${fmtShort(t.pair.volume?.h24)}`);
    }
    lines.push('');
  }
  if (rec.hottest.length) {
    lines.push('<b>Hottest anomalies</b>');
    for (const h of rec.hottest) lines.push(`• $${esc(h.pair.baseToken.symbol)} — sev ${h.score.severity} (${levelOf(h.score.severity)})`);
    lines.push('');
  }
  lines.push(`Total vol: $${fmtShort(rec.vol24)} · ${rec.buys}/${rec.buys + rec.sells} buys (${Math.round(100 * rec.buys / Math.max(1, rec.buys + rec.sells))}%)`);
  lines.push(`${rec.fresh} pairs <24h · ${rec.total} tracked`);
  lines.push('');
  lines.push('— yukaya · nxrlabs —');
  return lines.join('\n');
}

// ── commands ─────────────────────────────────────────────────
function isOwner(ctx) { return ctx.from && OWNERS.includes(ctx.from.id); }

async function handle(msg) {
  const text = (msg.text || '').trim();
  const chatId = msg.chat.id;
  if (!msg.from || !OWNERS.includes(msg.from.id)) return; // silently ignore non-owners

  if (/^\/(start|help)/.test(text)) {
    return send(chatId, [
      '⚡ <b>YUKAYA by NxrLabs</b>',
      '',
      'volume-anomaly scanner solana — yukaya signal engine',
      '',
      '/scan — paksa scan sekarang',
      '/status — kondisi engine + target alerts',
      '/recap — rekap 24h',
      '/arc — arc desk (saham + top tokens) · /arc sm — smart money ARC',
      '/sm — smartmoney flow sweep manual',
      '/lp — lp desk: kandidat LP-in (vol5m ≥ $150k, vol/tvl ≥ 2.5x)',
      '/rh — rh chain: meme×stock board + breakouts',
      '/setchannel — aktifkan auto-post ke channel',
      '/mute 3 — diam 3 jam',
      '/unmute — aktif lagi',
      '',
      `interval: ${CFG.pollSec / 60}m · min liq: $${fmtShort(CFG.minLiq)} · min vol: $${fmtShort(CFG.minVol24)}`,
    ].join('\n'));
  }

  if (/^\/scan/.test(text)) {
    const m = await send(chatId, '🔍 scanning feed…');
    try {
      const { results, sent, muted } = await cycle({ ignoreCooldown: true });
      const scored = results.filter(r => r.score).length;
      let extra = '';
      if (!muted && sent > 0) {
        const best = results.filter(r => r.score).sort((a, b) => b.score.severity - a.score.severity)[0];
        extra = `\n\nTop: <b>$${esc(best.pair.baseToken.symbol)}</b> sev ${best.score.severity} (${levelOf(best.score.severity)})`;
      }
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `✅ ${results.length} pairs · ${scored} scored · ${muted ? 'MUTED — no alerts sent' : sent + ' alert terkirim'}${extra}`, parse_mode: 'HTML' });
    } catch (e) {
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `❌ scan failed: ${esc(e.message)}` });
    }
    return;
  }

  if (/^\/status/.test(text)) {
    const muted = mutedUntil > Date.now();
    const t = alertTarget();
    return send(chatId, [
      `🟢 yukaya online`,
      `alerts → ${t.where}`,
      `mute: ${muted ? 'sampai ' + new Date(mutedUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'off'}`,
      `poll: ${CFG.pollSec / 60}m · cooldown ${CFG.cooldownHrs}h`,
    ].join('\n'));
  }

  if (/^\/recap/.test(text)) {
    const m = await send(chatId, '📊 compiling hourly performance…');
    try {
      const results = await scan({ ignoreCooldown: true });
      const [cex, rendered] = await Promise.all([cexAnomalies(), renderRecap({ results, cex, alerts: 0 })]);
      await tg('deleteMessage', { chat_id: chatId, message_id: m.message_id }).catch(() => {});
      const form = new FormData(); form.append('chat_id', String(chatId)); form.append('caption', '📊 <b>YUKAYA · PERFORMANCE RECAP</b>\nManual snapshot · current price vs alert entry'); form.append('parse_mode', 'HTML'); form.append('photo', new Blob([readFileSync(rendered.path)], { type: 'image/png' }), 'yukaya-recap.png');
      await fetch(`${API}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    } catch (e) { await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `❌ ${esc(e.message)}` }); }
    return;
  }

  if (/^\/arc/.test(text)) {
    // /arc sm — leaderboard smart money ARC (curated list hasil PnL screening)
    if (/^\/arc\s*sm/i.test(text)) {
      const m = await send(chatId, '🧠 arc smart money — loading…');
      try {
        const db = JSON.parse(readFileSync(join(HERE, 'arc-smartmoney.json'), 'utf8'));
        const w = (db.wallets || []).filter(x => (x.realized_30d || 0) >= 1000);
        const L = (label, val) => (label + ' ').padEnd(9, ' ');
        const fw = n => n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'k' : '$' + Math.round(n);
        const lines = [
          'arc smart money · top PnL 30d',
          '──────────────────────────',
          ...w.slice(0, 12).map((x, i) =>
            `${String(i + 1).padStart(2)}. ${x.addr.slice(0, 6)}…${x.addr.slice(-4)}  ${fw(x.realized_30d || 0).padStart(7)}  all ${fw(x.realized_all || 0)}${(x.tags || []).includes('wash_trader') ? ' ⚠️' : ''}`),
          '',
          `${w.length} wallets terverifikasi profit (gmgn PnL)`,
          'deteksi beli bareng otomatis via smart flow',
          'yukaya arc desk · ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) + ' WITA',
        ];
        const kb = { inline_keyboard: [w.slice(0, 6).map(x => ({ text: x.addr.slice(0, 6) + '…' + x.addr.slice(-4), url: `https://arc-scan.org/address/${x.addr}` }))] };
        await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `<pre>${lines.map(l => String(l).replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n')}</pre>`, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: kb });
      } catch (e) {
        await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `❌ ${esc(e.message)}` });
      }
      return;
    }
    const m = await send(chatId, '🟠 arc desk — loading…');
    try {
      const r = await arcScan({ firstRun: true });
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: boardCard(r), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (e) {
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `❌ ${esc(e.message)}` });
    }
    return;
  }

  if (/^\/sm/.test(text)) {
    const m = await send(chatId, '🧠 smart flow — sweep…');
    try {
      const r = await smartScan();
      if (r.error) throw new Error(r.error);
      const txt = r.alerts.length
        ? r.alerts.map(a => `🧠 <b>SMART FLOW</b> · ${a.sym}\n\n${smartCard(a)}`).join('\n\n')
        : '🧠 smart flow — <b>bersih</b>\n\n<i>gak ada aktivitas watch wallets di window ini</i>';
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: txt, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (e) {
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `❌ ${esc(e.message)}` });
    }
    return;
  }

  if (/^\/lp\b/.test(text)) {
    const m = await send(chatId, '💧 lp desk — watchlist sweep…');
    try {
      const rows = await lpWatch();
      const lines = ['💧 <b>YUKAYA LP DESK</b>', '<i>watchlist: vol 5m ≥ $150k · auto-alert hanya yang lolos gate</i>', ''];
      if (!rows.length) lines.push('Tidak ada token di feed 5m saat ini.');
      for (const t of rows.slice(0, 6)) {
        const status = t.gateReasons.length ? '⚠️ ' + t.gateReasons[0] : '✅ ALERTABLE';
        lines.push(`<b>$${esc(t.sym)}</b> · ${t.chain.toUpperCase()} · vol $${fmtShort(t.vol5m)} · TVL $${fmtShort(t.liq)} · <b>${t.ratio.toFixed(1)}x</b>\n${esc(status)}`);
      }
      lines.push('', '<i>vol/tvl ≥2.5x · TVL ≥$10k · bundler ≤30% · top10 ≤65%</i>');
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: lines.join('\n'), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (e) { await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `❌ ${esc(e.message)}` }); }
    return;
  }

  if (/^\/rh\b/.test(text)) {
    const m = await send(chatId, '🟣 rh desk — pulling stockyard map…');
    try {
      const d = await rhmapScan();
      if (d.error) throw new Error(d.error);
      const hot = screenMemes(d.memes);
      const txt = hot.length
        ? ['🟣 <b>RH DESK</b> · meme×stock\n\n', rhBoardCard(d), '\n\nHOT (1h):', ...hot.slice(0, 3).map(x => `\n$${x.sym} on $${x.stock} +${x.chg1h.toFixed(1)}% · liq ${x.liq >= 1e3 ? '$' + Math.round(x.liq / 1e3) + 'k' : '$' + Math.round(x.liq)}`)].join('')
        : rhBoardCard(d);
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: txt, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (e) {
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: `❌ ${esc(e.message)}` });
    }
    return;
  }

  if (/^\/mute/.test(text)) {
    const hrs = Math.min(72, Math.max(1, parseFloat(text.split(/\s+/)[1]) || 1));
    setMute(hrs);
    return send(chatId, `🔇 muted ${hrs} jam`);
  }
  if (/^\/unmute/.test(text)) { setMute(0); return send(chatId, '🔔 unmuted'); }

  if (/^\/alerts/.test(text)) {
    const t = alertTarget();
    return send(chatId, `📡 alerts sekarang → ${t.where}\n\nGanti ke channel: jadikan bot admin di channel, lalu posting \`/setchannel\` di situ.\nBalik ke DM: /alerts dm`);
  }
  if (/^\/alerts dm/.test(text)) {
    saveChannel(0, null, ''); // clears binding
    return send(chatId, '📡 alerts → DM owner');
  }
}

// /setchannel posted inside a channel binds that channel as alert target;
// /scan, /recap, /status posted in channel also work (owner must be channel admin)
async function handleChannelPost(post) {
  const text = (post.text || '').trim();
  const chat = post.chat || {};
  if (chat.type !== 'channel') return;

  if (/^\/setchannel/.test(text)) {
    saveChannel(chat.id, post.message_thread_id || null, chat.title || '');
    await tg('sendMessage', {
      chat_id: chat.id,
      ...(post.message_thread_id ? { message_thread_id: post.message_thread_id } : {}),
      text: `⚡ <b>YUKAYA terhubung</b>\n\nSignal otomatis akan diposting di channel ini.\nYukaya signal engine · scan tiap ${CFG.pollSec / 60} menit\n\nUji: /scan`,
      parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    }).catch(e => console.error('setchannel confirm:', e.message));
    console.log('channel bound:', chat.id, chat.title);
    return;
  }

  // channel-side scan/recap/status — bypass owner check (channels have no from user)
  if (/^\/scan/.test(text)) {
    const m = await send(chat.id, '🔍 scanning feed…').catch(e => (console.error('ch scan send:', e.message), null));
    if (!m) return;
    try {
      const { results, sent, muted } = await cycle({ ignoreCooldown: false });
      const scored = results.filter(r => r.score).length;
      await tg('editMessageText', { chat_id: chat.id, message_id: m.message_id, text: `✅ ${results.length} pairs · ${scored} scored · ${muted ? 'MUTED' : sent + ' alert baru'}`, parse_mode: 'HTML' });
    } catch (e) {
      await tg('editMessageText', { chat_id: chat.id, message_id: m.message_id, text: `❌ scan failed: ${esc(e.message)}` });
    }
    return;
  }
  if (/^\/recap/.test(text)) {
    try {
      const results = await scan({ ignoreCooldown: true });
      const rec = await buildRecap(results);
      await send(chat.id, recapText(rec));
    } catch (e) { console.error('ch recap:', e.message); }
  }
  if (/^\/arc/.test(text)) {
    const m = await send(chat.id, '🟠 arc desk — loading…').catch(() => null);
    try {
      const r = await arcScan({ firstRun: true });
      const payload = boardCard(r);
      if (m) await tg('editMessageText', { chat_id: chat.id, message_id: m.message_id, text: payload, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      else await send(chat.id, payload);
    } catch (e) { console.error('ch arc:', e.message); }
  }
  if (/^\/sm/.test(text)) {
    try {
      const r = await smartScan();
      if (r.error) throw new Error(r.error);
      const txt = r.alerts.length
        ? r.alerts.map(a => `🧠 <b>SMART FLOW</b> · ${a.sym}\n\n${smartCard(a)}`).join('\n\n')
        : '🧠 smart flow — <b>bersih</b>\n\n<i>gak ada aktivitas watch wallets di window ini</i>';
      await send(chat.id, txt);
    } catch (e) { console.error('ch sm:', e.message); }
  }
}

// ── long polling ─────────────────────────────────────────────
let offset = 0;
async function pollLoop() {
  while (true) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'channel_post'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) handle(u.message).catch(e => console.error('handle:', e.message));
        if (u.channel_post) handleChannelPost(u.channel_post).catch(e => console.error('channel_post:', e.message));
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ── main ─────────────────────────────────────────────────────
console.log(`yukaya starting — owner: ${OWNERS.join(',')} — alerts → ${ALERT_CHAT || 'private'}`);
cycle().then(({ sent }) => console.log(`first cycle done, ${sent} alerts`)).catch(e => console.error('first cycle:', e.message));
setInterval(() => cycle().catch(e => console.error('cycle:', e.message)), CFG.pollSec * 1000);

// arc desk: first run quiet (baseline), then every ARC_POLL_MIN minutes
setTimeout(() => {
  const tgt = alertTarget();
  arcCycle(tgt, { firstRun: true })
    .then(r => console.log(`arc baseline: ${r.launches.length} tokens, stocks ${Object.keys(r.stocks).length}`))
    .catch(e => console.error('arc baseline:', e.message));
}, 15000).unref?.();
setInterval(() => {
  const tgt = alertTarget();
  arcCycle(tgt).catch(e => console.error('arc cycle:', e.message));
}, ARC_POLL_MIN * 60000);

// smart flow: tiap 5 menit, offset 2.5 menit dari arc cycle
setTimeout(() => {
  smartCycle(alertTarget()).catch(e => console.error('smart first:', e.message));
  setInterval(() => smartCycle(alertTarget()).catch(e => console.error('smart cycle:', e.message)), ARC_POLL_MIN * 60000);
}, (ARC_POLL_MIN * 60000) / 2);

// pool desk: cross-chain pool screener (sol/bsc/robinhood/arc), tiap 5 menit
async function poolCycle(tgt) {
  try {
    const alerts = await poolScan();
    for (const t of alerts) {
      try {
        await send(tgt.chat, `💠 <b>POOL ${t.chain === 'robinhood' ? 'RH' : t.chain.toUpperCase()}</b> · NxrLabs\n\n${poolCard(t)}\n📈 <a href="${t.gmgnUrl}">gmgn</a>`, {
          reply_markup: { inline_keyboard: [[{ text: '⧉ Copy CA', copy_text: { text: t.addr } }]] },
        });
        console.log(`pool alert: ${t.chain} $${t.sym} 5m $${Math.round(t.vol5m / 1000)}k fees24 $${Math.round(t.fees24)}`);
      } catch (e) { console.error('pool send:', e.message); }
    }
  } catch (e) { console.error('pool cycle:', e.message); }
}
setTimeout(() => poolCycle(alertTarget()).catch(e => console.error('pool first:', e.message)), 42000);
setInterval(() => poolCycle(alertTarget()).catch(e => console.error('pool cycle:', e.message)), 300000);
// smart track cycle: cluster smart money buys via gmgn, tiap 5 menit
async function smTrackCycle(tgt) {
  try {
    const alerts = await smTrackScan();
    for (const c of alerts) {
      try {
        await send(tgt.chat, `🧠 <b>SMART FLOW</b> · NxrLabs\n\n${smCard(c)}\n📈 <a href="${c.gmgnUrl}">gmgn</a>`, {
          reply_markup: { inline_keyboard: [[{ text: '⧉ Copy CA', copy_text: { text: c.addr } }]] },
        });
        console.log(`smtrack alert: ${c.chain} $${c.sym} ${c.makers.length} makers $${Math.round(c.usd)}`);
      } catch (e) { console.error('smtrack send:', e.message); }
    }
  } catch (e) { console.error('smtrack cycle:', e.message); }
}
setTimeout(() => smTrackCycle(alertTarget()).catch(e => console.error('smtrack first:', e.message)), 66000);
setInterval(() => smTrackCycle(alertTarget()).catch(e => console.error('smtrack cycle:', e.message)), 300000);
// lp desk cycle: deteksi potensi LP-in (vol 5m gedé, TVL tipis) tiap 5 menit
async function lpCycle(tgt) {
  try {
    const alerts = await lpScan();
    for (const t of alerts) {
      try {
        await send(tgt.chat, `💧 <b>LP INCOMING</b> · NxrLabs\n\n${lpCard(t)}`, {
          reply_markup: { inline_keyboard: [[
            { text: '⧉ Copy CA', copy_text: { text: t.addr } },
            { text: 'gmgn', url: t.gmgnUrl },
          ]] },
        });
        console.log(`lpin alert: ${t.chain} $${t.sym} vol/tvl ${t.ratio.toFixed(1)}x vol5m $${Math.round(t.vol5m)}`);
      } catch (e) { console.error('lpin send:', e.message); }
    }
  } catch (e) { console.error('lpin cycle:', e.message); }
}
setTimeout(() => lpCycle(alertTarget()).catch(e => console.error('lpin first:', e.message)), 81000);
setInterval(() => lpCycle(alertTarget()).catch(e => console.error('lpin cycle:', e.message)), 300000);
// hourly image recap: signal performance + CEX volume anomalies
let lastHourlyRecap = 0;
let hourlyAlerts = 0;
async function hourlyRecap(tgt, force = false) {
  const now = Date.now();
  if (!force && now - lastHourlyRecap < 55 * 60000) return;
  lastHourlyRecap = now;
  try {
    const count = hourlyAlerts; hourlyAlerts = 0;
    const cex = await cexAnomalies();
    const rendered = await renderRecap({ results: lastResults || [], cex, alerts: count });
    const form = new FormData();
    form.append('chat_id', String(tgt.chat));
    if (tgt.thread) form.append('message_thread_id', String(tgt.thread));
    form.append('caption', '📊 <b>YUKAYA · HOURLY RECAP</b>\nPerformance ledger + CEX volume anomaly scan');
    form.append('parse_mode', 'HTML');
    form.append('photo', new Blob([readFileSync(rendered.path)], { type: 'image/png' }), 'yukaya-hourly.png');
    const r = await fetch(`${API}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    const d = await r.json(); if (!d.ok) throw new Error(d.description);
    console.log(`hourly recap sent: ${rendered.performance.closed} tracked, pnl ${rendered.performance.pnl.toFixed(1)}%`);
  } catch (e) { console.error('hourly recap:', e.message); }
}
setTimeout(() => hourlyRecap(alertTarget()).catch(e => console.error('hourly first:', e.message)), 90000);
setInterval(() => hourlyRecap(alertTarget()).catch(e => console.error('hourly cycle:', e.message)), 3600000);
pollLoop();

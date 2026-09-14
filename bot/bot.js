// Yukaya by NxrLabs — Telegram signal bot (nxrzoom engine)
// owner-gated, long-polling, zero deps (node 22 native fetch)
import { scan, pickAlerts, buildRecap, CFG, levelOf, fmtShort } from './engine.js';
import { enrich } from './enrich.js';
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
const sideIcon = s => s === 'BUY' ? '🟢' : s === 'SELL' ? '🔴' : '🟡';

function fmtAlert(r, e) {
  const { pair: p, score: s } = r;
  const pc = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const mc = p.marketCap ?? p.fdv;
  const t24 = p.txns?.h24;

  const reads = [];
  if (e.pressure.h1 != null) {
    reads.push(`• flow: <b>buy ${e.pressure.h1}%</b> (1h)${e.accel != null ? ` · accel ${e.accel}x` : ''}`);
  } else if (e.accel != null) {
    reads.push(`• flow: accel ${e.accel}x`);
  }
  if (e.rug && e.rug.score != null) {
    const tag = e.rug.score < 25 ? '✓ aman' : e.rug.score < 60 ? '〜 waspada' : '⚠️ berbahaya';
    reads.push(`• rugcheck: <b>${e.rug.score}/100</b> ${tag}${e.rug.lpLockedPct != null ? ` · LP ${Math.round(e.rug.lpLockedPct)}% locked` : ''}${e.rug.lpProviders ? ` · ${e.rug.lpProviders} LP` : ''}`);
  }
  if (e.liqMc != null) reads.push(`• liq: $${fmtShort(p.liquidity?.usd)} (${e.liqMc}% MC)${e.liqMc < 8 ? ' ⚠️' : ' ✓'}`);
  if (t24 && t24.buys + t24.sells > 0) {
    reads.push(`• wallets: ${t24.buys} buy / ${t24.sells} sell (24h)`);
  }
  const sm5 = p.txns?.m5?.buys ?? null, sh1 = p.txns?.h1?.buys ?? null;
  if (sm5 != null || sh1 != null) {
    reads.push(`• smart money: <b>${sm5 ?? 0} wallets in</b> (5m)${sh1 != null ? ` · ${sh1} (1h)` : ''}`);
  }
  for (const f of e.flags) reads.push(f.startsWith('⚡') || f.startsWith('🌱') ? f : `<b>${f}</b>`);

  return [
    `⚡ <b>YUKAYA</b> · ${sideIcon(s.side)} Volume Anomaly`,
    ``,
    `<b>$${esc(p.baseToken.symbol)}</b> — ${esc(p.baseToken.name)}`,
    `${meter(s.severity)} sev ${s.severity}/100 · conf ${s.confidence}%`,
    ``,
    `MC $${fmtShort(mc)} · Vol 24h $${fmtShort(p.volume?.h24)} · Vol/MC ${s.volMc.toFixed(2)}x`,
    `1h ${pc(p.priceChange?.h1)} · 24h ${pc(p.priceChange?.h24)}${e.ageHrs != null ? ` · age ${e.ageHrs}h` : ''}`,
    ``,
    `🧠 <b>smart reads</b>`,
    ...reads,
    ``,
    `↳ detail: nxrzoom.vercel.app/scan?ca=${esc(p.baseToken.address)}`,
  ].join('\n');
}
function alertKeyboard(p) {
  const ca = p.baseToken.address;
  return { inline_keyboard: [[
    { text: '📈 Chart', url: p.url || `https://dexscreener.com/solana/${ca}` },
    { text: 'axiom', url: `https://axiom.trade/t/${ca}` },
    { text: 'gmgn', url: `https://gmgn.ai/sol/token/${ca}` },
  ]] };
}

// ── cycle ────────────────────────────────────────────────────
let lastRecapDay = new Date().getDate();
async function cycle(opts = {}) {
  const results = await scan(opts);
  if (mutedUntil > Date.now() && !opts.ignoreCooldown) {
    return { results, sent: 0, muted: true };
  }
  const cands = await pickAlerts(results);
  const tgt = alertTarget();
  for (const c of cands) {
    try {
      const e = await enrich(c.pair); // smart reads (abstains silently on RPC failure)
      await send(tgt.chat, fmtAlert(c, e), { reply_markup: alertKeyboard(c.pair) });
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
  lines.push('yukaya by nxrlabs · nxrzoom.vercel.app');
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
      'volume-anomaly scanner untuk solana — sinyal dari feed nxrzoom_',
      '',
      '/scan — paksa scan sekarang',
      '/status — kondisi engine + target alerts',
      '/recap — rekap 24h',
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
    const m = await send(chatId, '📊 compiling…');
    try {
      const results = await scan({ ignoreCooldown: true });
      const rec = await buildRecap(results);
      await tg('editMessageText', { chat_id: chatId, message_id: m.message_id, text: recapText(rec), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
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
      text: `⚡ <b>YUKAYA terhubung</b>\n\nAlert otomatis akan diposting di channel ini.\nSumber: feed nxrzoom_ · scan tiap ${CFG.pollSec / 60} menit\n\nUji: /scan`,
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
pollLoop();

// yukaya — gmgn.js: security enrichment via gmgn trending (sol)
// satu call / 3 menit, map by address. Data asli gmgn, gak ada yang dikarang.
import { execFile } from 'child_process';

let cache = { at: 0, map: null };

export function gmgnMap() {
  return new Promise((resolve) => {
    if (cache.map && Date.now() - cache.at < 180000) return resolve(cache.map);
    execFile('gmgn-cli', ['market', 'trending', '--chain', 'sol', '--interval', '1m', '--limit', '100', '--raw'], { timeout: 20000 }, (err, stdout) => {
      if (err) { resolve(cache.map || {}); return; }
      try {
        const d = JSON.parse(stdout);
        const items = d?.data?.rank || d?.rank || [];
        const map = {};
        for (const it of items) if (it.address) map[String(it.address)] = it;
        cache = { at: Date.now(), map };
        resolve(map);
      } catch { resolve(cache.map || {}); }
    });
  });
}

// gate keputusan: balikin list alasan skip (kosong = lolos)
export function gmgnGates(g) {
  if (!g) return []; // gak ada data = abstain (rugcheck tetep jadi gate utama)
  const why = [];
  if (g.is_wash_trading === true) why.push('wash trading');
  if ((g.bundler_rate ?? 0) > 0.3) why.push(`bundler ${(g.bundler_rate * 100).toFixed(0)}%`);
  if ((g.entrapment_ratio ?? 0) > 0.5) why.push(`phishing ${(g.entrapment_ratio * 100).toFixed(0)}%`);
  if ((g.dev_team_hold_rate ?? 0) > 0.5) why.push(`dev hold ${(g.dev_team_hold_rate * 100).toFixed(0)}%`);
  if ((g.top_10_holder_rate ?? 0) > 0.5) why.push(`top10 ${(g.top_10_holder_rate * 100).toFixed(0)}%`);
  return why;
}

// lines tambahan buat card (mirip format gmgn)
export function gmgnLines(g) {
  if (!g) return [];
  const pc = v => v == null ? '—' : (v * 100).toFixed(0) + '%';
  const L = [];
  if (g.holder_count != null) L.push(`👥 holders ${g.holder_count} · top10 ${pc(g.top_10_holder_rate)}`);
  const sec = [];
  if (g.rat_trader_amount_rate != null) sec.push(`insiders ${pc(g.rat_trader_amount_rate)}`);
  if (g.entrapment_ratio != null) sec.push(`phishing ${pc(g.entrapment_ratio)}`);
  if (g.bundler_rate != null) sec.push(`bundler ${pc(g.bundler_rate)}`);
  if (g.bot_degen_rate != null) sec.push(`botdegen ${pc(g.bot_degen_rate)}`);
  if (sec.length) L.push('🛡 ' + sec.join(' · '));
  const sm = [];
  if (g.smart_degen_count != null) sm.push(`smart ${g.smart_degen_count}`);
  if (g.rug_ratio != null) sm.push(`rug_ratio ${g.rug_ratio.toFixed(2)}`);
  if (sm.length) L.push(sm.join(' · '));
  if (g.dev_team_hold_rate != null) L.push(`👨‍💻 dev hold ${pc(g.dev_team_hold_rate)}`);
  return L;
}

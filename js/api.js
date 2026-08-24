// nxrzoom_ — dexscreener live data layer (public API, no key)
const DS = {
  // server-side proxy with cache — direct client calls were getting throttled
  async json(url){
    const r = await fetch(url);
    if(!r.ok) throw new Error('http '+r.status);
    return r.json();
  },
  // one cached server call returns ready pairs (throttle-proof)
  async pairs(){
    const d = await this.json('/api/feed');
    return d.pairs || [];
  }
};

function fmtUsd(n){
  if(n == null || isNaN(n)) return '—';
  if(n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if(n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if(n >= 1e3) return '$'+(n/1e3).toFixed(1)+'K';
  if(n >= 1) return '$'+n.toFixed(2);
  return '$'+Number(n).toPrecision(2);
}

function fmtAge(ms){
  if(!ms) return '—';
  const s = Math.max(0,(Date.now()-ms)/1000);
  if(s < 3600) return Math.max(1,Math.floor(s/60))+'m';
  if(s < 86400) return Math.floor(s/3600)+'h';
  return Math.floor(s/86400)+'d';
}

function multOf(h24){ return (100 + Number(h24||0)) / 100 }

// deep-link builders per platform
function buyLinks(mint, dsUrl){
  return [
    { label:'axiom',       url:`https://axiom.trade/t/${mint}`, hot:true },
    { label:'gmgn',        url:`https://gmgn.ai/sol/token/${mint}` },
    { label:'trojan',      url:`https://t.me/solana_trojanbot?start=r-${mint}` },
    { label:'pump.fun',    url:`https://pump.fun/coin/${mint}` },
    { label:'dexscreener', url: dsUrl || `https://dexscreener.com/solana/${mint}` }
  ];
}

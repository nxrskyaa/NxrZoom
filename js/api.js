// nxrzoom_ — dexscreener live data layer (public API, no key)
const DS = {
  async json(url){
    const r = await fetch(url);
    if(!r.ok) throw new Error('http '+r.status);
    return r.json();
  },
  // gather fresh solana tokens from boosts + new profiles
  async universe(){
    const [top, latest, profiles] = await Promise.all([
      this.json('https://api.dexscreener.com/token-boosts/top/v1').catch(()=>[]),
      this.json('https://api.dexscreener.com/token-boosts/latest/v1').catch(()=>[]),
      this.json('https://api.dexscreener.com/token-profiles/latest/v1').catch(()=>[])
    ]);
    const seen = new Set();
    const out = [];
    for(const t of [...top, ...latest, ...profiles]){
      if(t.chainId === 'solana' && t.tokenAddress && !seen.has(t.tokenAddress)){
        seen.add(t.tokenAddress);
        out.push(t.tokenAddress);
      }
    }
    return out.slice(0, 28);
  },
  // batch lookup pairs, keep most liquid pair per token
  async pairs(addrs){
    if(!addrs.length) return [];
    const data = await this.json('https://api.dexscreener.com/tokens/v1/solana/' + addrs.join(','));
    const best = {};
    for(const p of (data || [])){
      const a = p.baseToken && p.baseToken.address;
      if(!a) continue;
      const liq = (p.liquidity && p.liquidity.usd) || 0;
      if(!best[a] || liq > ((best[a].liquidity && best[a].liquidity.usd) || 0)) best[a] = p;
    }
    return Object.values(best);
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

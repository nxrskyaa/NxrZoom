// nxrzoom_ — server-side dexscreener proxy with cache (client was getting throttled)
const BASE = 'https://api.dexscreener.com';

let cache = { at: 0, data: null };
const TTL = 45000; // 45s

async function j(url){
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if(!r.ok) throw new Error('http '+r.status);
  return r.json();
}

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 's-maxage=45, stale-while-revalidate=60');
  try{
    if(cache.data && Date.now()-cache.at < TTL){
      return res.status(200).json(cache.data);
    }
    const [top, latest, profiles] = await Promise.all([
      j(BASE+'/token-boosts/top/v1').catch(()=>[]),
      j(BASE+'/token-boosts/latest/v1').catch(()=>[]),
      j(BASE+'/token-profiles/latest/v1').catch(()=>[])
    ]);
    const seen = new Set(), addrs = [];
    for(const t of [...top, ...latest, ...profiles]){
      if(t.chainId==='solana' && t.tokenAddress && !seen.has(t.tokenAddress)){
        seen.add(t.tokenAddress); addrs.push(t.tokenAddress);
      }
    }
    const list = addrs.slice(0,28);
    let pairs = [];
    if(list.length){
      pairs = await j(BASE+'/tokens/v1/solana/'+list.join(',')).catch(()=>[]);
    }
    // keep most liquid pair per token
    const best = {};
    for(const p of (pairs||[])){
      const a = p.baseToken && p.baseToken.address;
      if(!a) continue;
      const liq = (p.liquidity && p.liquidity.usd) || 0;
      if(!best[a] || liq > ((best[a].liquidity && best[a].liquidity.usd) || 0)) best[a]=p;
    }
    const out = { pairs: Object.values(best), at: Date.now() };
    cache = { at: Date.now(), data: out };
    res.status(200).json(out);
  }catch(e){
    if(cache.data) return res.status(200).json(cache.data); // serve stale on failure
    res.status(502).json({ error: 'dexscreener unavailable' });
  }
}

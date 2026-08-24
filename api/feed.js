// nxrzoom_ — server-side dexscreener proxy with cache (client was getting throttled)
const BASE = 'https://api.dexscreener.com';

let cache = { at: 0, data: null };
const TTL = 60000; // 60s

async function j(url, ms){
  const r = await fetch(url, { signal: AbortSignal.timeout(ms || 30000) });
  if(!r.ok) throw new Error('http '+r.status);
  return r.json();
}

// gather solana addresses from whichever endpoint responds
async function addrs(){
  const tries = [
    BASE + '/token-profiles/latest/v1',
    BASE + '/token-boosts/top/v1',
    BASE + '/token-boosts/latest/v1'
  ];
  const seen = new Set(), out = [];
  // race-lite: try in order, first that responds wins (dexscreener flaky — some endpoints down)
  for(const u of tries){
    try{
      const d = await j(u, 12000);
      if(Array.isArray(d) && d.length){
        for(const t of d){
          if(t.chainId === 'solana' && t.tokenAddress && !seen.has(t.tokenAddress)){
            seen.add(t.tokenAddress); out.push(t.tokenAddress);
          }
        }
        if(out.length >= 12) break;
      }
    }catch(e){ /* try next */ }
  }
  return out.slice(0, 24);
}

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=120');
  try{
    if(cache.data && Date.now()-cache.at < TTL){
      return res.status(200).json(cache.data);
    }
    const list = await addrs();
    let pairs = [];
    if(list.length){
      try{
        pairs = await j(BASE+'/tokens/v1/solana/'+list.join(','), 25000) || [];
      }catch(e){
        // batch failed — try 2 smaller batches
        for(const part of [list.slice(0,12), list.slice(12)]){
          if(!part.length) continue;
          try{ const d = await j(BASE+'/tokens/v1/solana/'+part.join(','), 20000); pairs = pairs.concat(d||[]); }catch(_){}
        }
      }
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
    if(out.pairs.length) cache = { at: Date.now(), data: out };
    res.status(200).json(out);
  }catch(e){
    if(cache.data) return res.status(200).json(cache.data); // serve stale on failure
    res.status(502).json({ error: 'dexscreener unavailable' });
  }
}

// nxrzoom_ — feed proxy: GeckoTerminal trending+new solana pools (dexscreener API was down/flaky)
const GT = 'https://api.geckoterminal.com/api/v2';

let cache = { at: 0, data: null };
const TTL = 60000;

async function j(url){
  const r = await fetch(url, { headers:{ accept:'application/json' }, signal: AbortSignal.timeout(15000) });
  if(!r.ok) throw new Error('http '+r.status);
  return r.json();
}

// map geckoterminal pool -> dexscreener-like pair object (frontend stays unchanged)
function mapPool(p){
  const a = p.attributes || {};
  const rel = p.relationships || {};
  const addr = ((rel.base_token && rel.base_token.data && rel.base_token.data.id) || '').split('_')[1] || a.address || '';
  const nameParts = String(a.name || '').split('/');
  const baseSym = (nameParts[0] || '????').trim();
  const dexId = ((rel.dex && rel.dex.data && rel.dex.data.id) || 'dex').split('_')[1] || 'dex';
  const num = (o,k) => (o && o[k] != null) ? Number(o[k]) : null;
  return {
    chainId: 'solana',
    dexId,
    url: 'https://www.geckoterminal.com/solana/pools/' + a.address,
    pairAddress: a.address,
    baseToken: { address: addr, name: baseSym, symbol: baseSym },
    quoteToken: { symbol: (nameParts[1] || '').trim() || 'SOL' },
    priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
    liquidity: { usd: num(a,'reserve_in_usd') ? Number(a.reserve_in_usd) : 0 },
    volume: { h24: num(a.volume_usd,'h24'), h6: num(a.volume_usd,'h6'), h1: num(a.volume_usd,'h1') },
    priceChange: { h24: num(a.price_change_percentage,'h24'), h6: num(a.price_change_percentage,'h6'), h1: num(a.price_change_percentage,'h1'), m5: num(a.price_change_percentage,'m5') },
    fdv: num(a,'fdv_usd'),
    marketCap: num(a,'market_cap_usd') || num(a,'fdv_usd'),
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    txns: {
      h24: { buys: Math.round(num(a.transactions.h24,'buys')||0), sells: Math.round(num(a.transactions.h24,'sells')||0) },
      h1:  { buys: Math.round(num(a.transactions.h1,'buys')||0),  sells: Math.round(num(a.transactions.h1,'sells')||0) },
      m5:  { buys: Math.round(num(a.transactions.m5,'buys')||0),  sells: Math.round(num(a.transactions.m5,'sells')||0) }
    }
  };
}

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=120');
  try{
    if(cache.data && Date.now()-cache.at < TTL){
      return res.status(200).json(cache.data);
    }
    const [trend, recent] = await Promise.all([
      j(GT+'/networks/solana/trending_pools?page=1').catch(()=>null),
      j(GT+'/networks/solana/new_pools?page=1').catch(()=>null)
    ]);
    const pools = []
      .concat(trend && trend.data ? trend.data : [])
      .concat(recent && recent.data ? recent.data : []);
    const seen = new Set();
    const pairs = [];
    for(const p of pools){
      if(seen.has(p.id)) continue;
      seen.add(p.id);
      const m = mapPool(p);
      if(m.baseToken.address) pairs.push(m);
    }
    const out = { pairs: pairs.slice(0, 40), at: Date.now() };
    if(out.pairs.length) cache = { at: Date.now(), data: out };
    res.status(200).json(out);
  }catch(e){
    if(cache.data) return res.status(200).json(cache.data);
    res.status(502).json({ error: 'feed unavailable' });
  }
}

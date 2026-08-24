// nxrzoom_ — magic eden helper w/ TTL cache (rate limit 10 req/min upstream!)
const BASE = 'https://api-mainnet.magiceden.dev/v2';

// simple in-memory ttl cache — survives on warm lambda instances
const cache = new Map();
async function cached(key, ttlMs, fn){
  const hit = cache.get(key);
  if(hit && Date.now()-hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, {t:Date.now(), v});
  return v;
}

async function j(url){
  const r = await fetch(url, {headers:{'accept':'application/json','user-agent':'nxrzoom/1.0'}});
  if(!r.ok) throw new Error('me http '+r.status);
  return r.json();
}

// blue chips with real secondary markets
const WATCH = ['mad_lads','degods','tensorians','famous_fox_federation'];

const stats = (sym) => cached('st:'+sym, 120000, async ()=>{
  try{
    const s = await j(`${BASE}/collections/${sym}/stats`);
    return {
      symbol: sym,
      name: sym.replace(/_/g,' '),
      image: null,
      floor: s.floorPrice ?? null,
      listedCount: s.listedCount ?? null,
      fpChange24h: s.floorPriceChange24hr ?? null
    };
  }catch(e){ return {symbol:sym, name:sym.replace(/_/g,' '), floor:null}; }
});

const acts = (sym, n=10) => cached('ac:'+sym+':'+n, 30000, async ()=>{
  try{ return await j(`${BASE}/collections/${sym}/activities?offset=0&limit=${n}`); }
  catch(e){ return []; }
});

const launchpad = () => cached('lp', 300000, async ()=>[]); // removed — solana launchpad dropped per user request

export default {
  WATCH,
  async watchlist(){
    // parallel but cached — cold start worst case: 8 upstream calls
    const [w, lp] = await Promise.all([
      Promise.all(WATCH.map(s=>stats(s))),
      Promise.all(WATCH.map(s=>acts(s)))
    ]);
    // derive 24h activity count per collection from the events we see
    const counts = {};
    w.forEach((s,i)=>{
      counts[s.symbol] = {};
      (lp[i]||[]).forEach(a=>{ counts[s.symbol][a.type]=(counts[s.symbol][a.type]||0)+1; });
    });
    return {collections:w, eventCounts:counts};
  },
  async activities(){
    const all = (await Promise.all(WATCH.map(s=>acts(s,12)))).flat();
    all.sort((a,b)=>(b.blockTime||0)-(a.blockTime||0));
    return all.slice(0,30);
  },
  launchpad
};

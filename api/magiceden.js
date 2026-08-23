// nxrzoom_ — magic eden server-side helper
const BASE = 'https://api-mainnet.magiceden.dev/v2';

async function j(url){
  const r = await fetch(url, {headers:{'accept':'application/json','user-agent':'nxrzoom/1.0'}});
  if(!r.ok) throw new Error('me http '+r.status);
  return r.json();
}

// curated watchlist — real blue chips w/ active markets
const WATCH = ['mad_lads','famous_fox_federation','tensorians','degods','y00ts','solana_monke_busines','ommnus','cyber_frogs'];

async function collectionImages(){
  try{
    const data = await j(`${BASE}/collections?offset=0&limit=20`);
    const map = {};
    (data||[]).forEach(c=>{ if(c.symbol && c.image) map[c.symbol] = c.image; });
    return map;
  }catch(e){ return {}; }
}

async function collectionStats(symbol){
  try{
    const s = await j(`${BASE}/collections/${symbol}/stats`);
    return {
      symbol,
      name: s.name || symbol.replace(/_/g,' '),
      image: s.image || null,
      floor: s.floorPrice ?? null,
      listedCount: s.listedCount ?? null,
      vol24hr: s.volume24hr ?? null,
      avgPrice24hr: s.avgPrice24hr ?? null,
      fpChange24h: s.floorPriceChange24hr ?? null
    };
  }catch(e){ return {symbol, name: symbol.replace(/_/g,' '), floor:null}; }
}

export default {
  async trending(){
    const [stats, images] = await Promise.all([
      Promise.all(WATCH.map(s=>collectionStats(s))),
      collectionImages()
    ]);
    // fill missing images from browse endpoint
    stats.forEach(st=>{
      if(!st.image && images[st.symbol]) st.image = images[st.symbol];
      if(!st.name || st.name===st.symbol.replace(/_/g,' ')){
        if(images[st.symbol+'_name']) st.name = images[st.symbol+'_name'];
      }
    });
    return stats.sort((a,b)=>(b.vol24hr||0)-(a.vol24hr||0));
  },
  async collectionActivities(symbol, limit=8){
    try{ return await j(`${BASE}/collections/${symbol}/activities?offset=0&limit=${limit}`); }
    catch(e){ return []; }
  },
  async allActivities(perCollection=6){
    const results = await Promise.all(WATCH.map(s=>this.collectionActivities(s, perCollection)));
    let all = [];
    results.forEach(acts=>acts.forEach(a=>all.push(a)));
    all.sort((a,b)=>(b.blockTime||0)-(a.blockTime||0));
    return all.slice(0, 50);
  }
};

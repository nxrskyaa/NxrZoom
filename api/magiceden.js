// nxrzoom_ — magic eden server-side helper
const BASE = 'https://api-mainnet.magiceden.dev/v2';

async function j(url){
  const r = await fetch(url, {headers:{'accept':'application/json','user-agent':'nxrzoom/1.0'}});
  if(!r.ok) throw new Error('me http '+r.status);
  return r.json();
}

// collections we watch for the activity feed
const WATCH = ['mad_lads','famous_fox_federation','tensorians','solana_monke_busines','cyber_frogs','ommnus','degods','y00ts'];

export default {
  async trending(page=1){
    // offset must be multiple of 20
    let data = await j(`${BASE}/collections?offset=${(page-1)*20}&limit=20`);
    // top by 24h volume
    data = (data||[]).sort((a,b)=>(b.volume24hr||0)-(a.volume24hr||0));
    return data.map(c=>({
      symbol: c.symbol,
      name: c.name,
      image: c.image,
      floor: c.floorPrice,
      listedCount: c.listedCount,
      vol24hr: c.volume24hr,
      volumeAll: c.volumeAll,
      fpChange24h: c.floorPriceChange24hr ?? null
    }));
  },
  async collectionActivities(symbol, limit=10){
    try{
      const acts = await j(`${BASE}/collections/${symbol}/activities?offset=0&limit=${limit}`);
      return acts||[];
    }catch(e){ return []; }
  },
  async allActivities(perCollection=4){
    const results = await Promise.all(
      WATCH.map(s=>this.collectionActivities(s, perCollection))
    );
    let all = [];
    results.forEach((acts,i)=>{
      acts.forEach(a=>all.push({...a, watch: WATCH[i]}));
    });
    // newest first
    all.sort((a,b)=>(b.blockTime||0)-(a.blockTime||0));
    return all.slice(0, 40);
  }
};

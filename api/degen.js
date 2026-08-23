// nxrzoom_ — degen nfts: free-mint radar (opensea x ink/robinhood)
import { discover } from './opensea.js';

const cache = new Map();
async function cached(key, ttl, fn){
  const hit = cache.get(key);
  if(hit && Date.now()-hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, {t:Date.now(), v});
  return v;
}

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  try{
    const [ink, robinhood] = await Promise.all([
      cached('os:ink', 120000, ()=>discover('ink').catch(()=>[])),
      cached('os:robinhood', 120000, ()=>discover('robinhood').catch(()=>[]))
    ]);

    // free mint candidates: floor $0 / tiny floor or active drop stage
    const pick = arr => arr
      .filter(c => c.floorUsd===0 || c.anyActiveStage || (c.floorUsd!=null && c.floorUsd < 5))
      .sort((a,b)=>(a.floorUsd??1e9)-(b.floorUsd??1e9))
      .slice(0,8);

    res.setHeader('cache-control','s-maxage=120, stale-while-revalidate=300');
    res.status(200).json({
      ink: pick(ink),
      robinhood: pick(robinhood),
      counts: {inkTotal: ink.length, rhTotal: robinhood.length}
    });
  }catch(e){
    res.status(502).json({error:'degen feed unavailable'});
  }
}

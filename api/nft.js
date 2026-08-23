// nxrzoom_ — nft tracker: watchlist + live activity + launchpad
import ME from './magiceden.js';

const SOL_FALLBACK = 210;

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  try{
    let solUsd = SOL_FALLBACK;
    try{
      const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd').then(r=>r.json());
      if(cg && cg.solana && cg.solana.usd) solUsd = cg.solana.usd;
    }catch(e){}

    const [wl, acts, lp] = await Promise.all([
      ME.watchlist(),
      ME.activities(),
      ME.launchpad()
    ]);

    res.setHeader('cache-control','s-maxage=20, stale-while-revalidate=40');
    res.status(200).json({
      solUsd,
      collections: wl.collections,
      eventCounts: wl.eventCounts,
      activities: acts,
      launchpad: lp
    });
  }catch(e){
    res.status(502).json({error:'nft feed unavailable'});
  }
}

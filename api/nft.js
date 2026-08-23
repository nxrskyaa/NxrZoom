// nxrzoom_ — nft tracker: trending collections + live activity via magic eden
import ME from './magiceden.js';

const SOL_FALLBACK = 210; // usd per sol if coingecko fails

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  try{
    // sol price
    let solUsd = SOL_FALLBACK;
    try{
      const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd').then(r=>r.json());
      if(cg && cg.solana && cg.solana.usd) solUsd = cg.solana.usd;
    }catch(e){}

    const [trending, activities] = await Promise.all([
      ME.trending(1),           // page 1 = top 20
      ME.allActivities(30)      // recent events across tracked collections
    ]);

    res.setHeader('cache-control','s-maxage=20, stale-while-revalidate=40');
    res.status(200).json({solUsd, collections: trending, activities});
  }catch(e){
    res.status(502).json({error:'nft feed unavailable'});
  }
}

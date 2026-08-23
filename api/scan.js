// nxrzoom_ — token scan via birdeye-free sources
// uses dexscreener (token info) + publicnode rpc (top holders via getTokenLargestAccounts)
import DS from './dexscreener.js';

const RPC = 'https://solana-rpc.publicnode.com';
async function rpc(method, params){
  const r = await fetch(RPC, {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0', id:1, method, params})
  });
  const j = await r.json();
  if(j.error) throw new Error(j.error.message);
  return j.result;
}
function isSolAddr(a){ return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((a||'').trim()); }
function short(a){ return a ? a.slice(0,4)+'…'+a.slice(-4) : ''; }

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  const ca = (req.query.ca || '').trim();
  if(!isSolAddr(ca)) return res.status(400).json({error:'invalid CA'});

  try{
    // 1. token info from dexscreener
    let pairs = [];
    try{ pairs = await DS.tokens(ca); }catch(e){}
    const best = pairs.sort((a,b)=>((b.liquidity&&b.liquidity.usd)||0)-((a.liquidity&&a.liquidity.usd)||0))[0] || null;

    // 2. supply + top holders from rpc
    let supply = null, holders = [], holderCount = null;
    try{
      const sup = await rpc('getTokenSupply', [ca]);
      supply = sup.value.uiAmountString;
      const largest = await rpc('getTokenLargestAccounts', [ca]);
      const top20 = largest.value.slice(0,15);
      holderCount = largest.value.length >= 20 ? '20+' : String(largest.value.length);
      // resolve which of top accounts are user wallets vs contract vaults — just label addresses
      holders = top20.map(h => ({
        address: h.address,
        uiAmount: Number(h.uiAmountString),
        pctOfSupply: supply ? (Number(h.uiAmountString) / Number(supply) * 100) : null
      }));
    }catch(e){}

    res.setHeader('cache-control','s-maxage=30');
    res.status(200).json({
      ca,
      name: best ? best.baseToken.name : null,
      symbol: best ? best.baseToken.symbol : null,
      priceUsd: best ? best.priceUsd : null,
      mcap: best ? (best.marketCap ?? best.fdv ?? null) : null,
      liq: best ? (best.liquidity && best.liquidity.usd) || null : null,
      vol24: best ? (best.volume && best.volume.h24) || null : null,
      chg: best ? best.priceChange : null,
      pairCreatedAt: best ? best.pairCreatedAt : null,
      dsUrl: best ? best.url : `https://dexscreener.com/solana/${ca}`,
      buyLinks: {
        axiom:`https://axiom.trade/t/${ca}`,
        gmgn:`https://gmgn.ai/sol/token/${ca}`,
        trojan:`https://t.me/solana_trojanbot?start=r-${ca}`,
        pumpfun:`https://pump.fun/coin/${ca}`
      },
      supply, holderCount,
      holders: holders.map(h=>({...h, short: short(h.address)}))
    });
  }catch(e){
    res.status(502).json({error:'scan failed'});
  }
}

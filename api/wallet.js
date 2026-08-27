// nxrzoom_ — wallet quality radar (public Solana RPC, heuristic score)
const RPC = 'https://api.mainnet-beta.solana.com';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function rpc(method, params){
  const r = await fetch(RPC, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:Date.now(), method, params}),
    signal:AbortSignal.timeout(18000)
  });
  if(!r.ok) throw new Error('rpc http '+r.status);
  const d = await r.json();
  if(d.error) throw new Error(d.error.message || 'rpc error');
  return d.result;
}

function scoreWallet({signatures, tokens, balance, lastActivity}){
  const sample = Math.min(25, Math.round((signatures / 60) * 25));
  const activity = lastActivity ? Math.max(0, Math.min(20, Math.round(20 - ((Date.now()/1000-lastActivity)/86400)*2))) : 0;
  const diversity = Math.min(20, Math.round(Math.log2(tokens.length + 1) * 5));
  const balances = tokens.filter(t=>Number(t.amount)>0).map(t=>Number(t.amount));
  const total = balances.reduce((a,b)=>a+b,0);
  const concentration = total ? Math.max(...balances)/total : 1;
  const quality = Math.min(20, Math.round((1-concentration)*25));
  const capital = Math.min(15, Math.round(Math.log10(Math.max(1, balance+1)) * 5));
  const totalScore = Math.max(0, Math.min(100, sample+activity+diversity+quality+capital));
  return {total:totalScore, sample, activity, diversity, concentration:quality, capital};
}

export default async function handler(req,res){
  res.setHeader('access-control-allow-origin','*');
  res.setHeader('cache-control','s-maxage=60, stale-while-revalidate=180');
  const address = String(req.query.address || '').trim();
  if(!B58.test(address)) return res.status(400).json({error:'invalid Solana wallet address'});
  try{
    const [sigs, bal, accounts] = await Promise.all([
      rpc('getSignaturesForAddress',[address,{limit:100}]),
      rpc('getBalance',[address,{commitment:'confirmed'}]),
      rpc('getTokenAccountsByOwner',[address,{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},{encoding:'jsonParsed',commitment:'confirmed'}])
    ]);
    const tokens=(accounts.value||[]).map(x=>{
      const i=x.account?.data?.parsed?.info || {};
      const t=i.tokenAmount || {};
      return {mint:i.mint, amount:Number(t.uiAmount||0), decimals:t.decimals||0};
    }).filter(x=>x.amount>0);
    const lastActivity=(sigs||[]).find(x=>x.blockTime)?.blockTime || null;
    const score=scoreWallet({signatures:(sigs||[]).length,tokens,balance:(bal?.value||0)/1e9,lastActivity});
    const tier=score.total>=70?'core':score.total>=45?'experimental':'watch';
    res.status(200).json({address, score, tier, sample:{transactions:(sigs||[]).length, capped:(sigs||[]).length>=100}, holdings:{tokens:tokens.length, sol:(bal?.value||0)/1e9}, lastActivity, limitations:['public RPC sample only (max 100 signatures)','PnL, entry timing, exits, and volume need an indexed trade history'], checkedAt:Date.now()});
  }catch(e){
    res.status(502).json({error:'wallet data unavailable — RPC mungkin sedang rate-limit'});
  }
}

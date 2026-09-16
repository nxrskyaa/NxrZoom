// CEX volume anomaly adapter — keyless CoinGecko snapshot
export async function cexAnomalies(){
 try{
  const u='https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h,24h';
  const r=await fetch(u,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)}); if(!r.ok) return [];
  const a=await r.json(); return a.map(x=>({symbol:x.symbol, name:x.name, price:x.current_price, mc:x.market_cap||0, vol24:x.total_volume||0, ratio:x.market_cap?(x.total_volume/x.market_cap):0, chg1h:x.price_change_percentage_1h_in_currency, chg24:x.price_change_percentage_24h_in_currency})).filter(x=>x.mc>0&&x.ratio>=0.25&&Math.abs(x.chg1h||0)>=1).sort((a,b)=>b.ratio-a.ratio).slice(0,10);
 }catch(e){console.error('cex anomaly:',e.message);return []}
}

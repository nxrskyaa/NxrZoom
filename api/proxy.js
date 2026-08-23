// nxrzoom_ — magic eden cors proxy (whitelist v2 paths)
const BASE = 'https://api-mainnet.magiceden.dev/v2/';
const OK = /^[a-zA-Z0-9_\-\/]+$/;

export default async function handler(req, res){
  res.setHeader('access-control-allow-origin', '*');
  const p = (req.query.path || '').toString();
  if(!p || !OK.test(p)) return res.status(400).json({error:'bad path'});
  try{
    const r = await fetch(BASE + p.replace(/^\/+/,''), {
      headers:{'accept':'application/json', 'user-agent':'nxrzoom/1.0'}
    });
    const text = await r.text();
    let data;
    try{ data = JSON.parse(text); }catch(e){ data = {raw:text.slice(0,500)}; }
    res.setHeader('cache-control','s-maxage=15, stale-while-revalidate=30');
    res.status(r.status).json(data);
  }catch(e){
    res.status(502).json({error:'upstream error'});
  }
}

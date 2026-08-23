// nxrzoom_ — image proxy for ipfs/nft cdns (whitelisted)
const OK_HOST = /(\.ipfs\.w3s\.link|\.ipfs\.dweb\.link|ipfs\.io|magiceden\.dev|cloudflare-ipfs\.com|nft-cdn\.magiceden\.dev)$/i;

export default async function handler(req, res){
  const u = (req.query.url||'').toString();
  let host;
  try{ host = new URL(u).hostname; }catch(e){ return res.status(400).end(); }
  if(!OK_HOST.test(host)) return res.status(403).end();

  try{
    const r = await fetch(u, {headers:{'user-agent':'nxrzoom/1.0'}, redirect:'follow'});
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('content-type', r.headers.get('content-type')||'image/jpeg');
    res.setHeader('cache-control','public, max-age=86400, s-maxage=604800');
    res.status(200).send(buf);
  }catch(e){
    // fallback: swap w3s -> dweb
    try{
      const alt = u.replace('.ipfs.w3s.link','.ipfs.dweb.link');
      const r2 = await fetch(alt, {headers:{'user-agent':'nxrzoom/1.0'}});
      const buf2 = Buffer.from(await r2.arrayBuffer());
      res.setHeader('content-type', r2.headers.get('content-type')||'image/jpeg');
      res.setHeader('cache-control','public, max-age=86400, s-maxage=604800');
      res.status(200).send(buf2);
    }catch(e2){
      res.status(502).end();
    }
  }
}

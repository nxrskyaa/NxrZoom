// nxrzoom_ — opensea discover page scraper (no key needed)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function extractCollections(html){
  const out = new Map();
  const re = /"slug":"([^"]+)","name":"([^"]+)","imageUrl":"([^"]*)"/g;
  let m;
  while((m = re.exec(html))){
    const [, slug, name, img] = m;
    if(out.has(slug)) continue;
    const chunk = html.slice(m.index, m.index+4000);

    const fp = chunk.match(/"floorPrice":\{"pricePerItem":\{"usd":([0-9.]+)/);
    const tok = chunk.match(/"token":\{"unit":([0-9.eE+-]+),"symbol":"([^"]+)"/);
    const sup = chunk.match(/"totalSupply":(\d+)/);
    const verified = /"isVerified":true/.test(chunk.slice(0,600));
    const chainId = chunk.match(/"chain":\{"identifier":"([^"]+)"/);
    const fpChg = chunk.match(/"floorPriceChange":(-?[0-9.]+)/);
    // mint stages (seadrop windows)
    const stages = [...chunk.matchAll(/\{"startTime":"([^"]+)","endTime":"([^"]+)"/g)].map(s=>({start:s[1], end:s[2]}));
    const activeDrop = chunk.includes('"activeDropStage":{') && !chunk.includes('"activeDropStage":null');

    out.set(slug, {
      slug, name,
      image: img || null,
      verified,
      chain: chainId ? chainId[1] : null,
      floorUsd: fp ? Number(fp[1]) : null,
      floorToken: tok ? {unit:Number(tok[1]), symbol:tok[2]} : null,
      fpChange24h: fpChg ? Number(fpChg[1]) : null,
      supply: sup ? Number(sup[1]) : null,
      hasStages: stages.length>0,
      nextStageStart: stages.map(s=>Date.parse(s.start)).filter(t=>t>Date.now()).sort((a,b)=>a-b)[0] || null,
      anyActiveStage: stages.some(s=>Date.parse(s.start)<=Date.now() && Date.parse(s.end)>=Date.now()) || activeDrop
    });
  }
  return [...out.values()];
}

export async function discover(chain){
  const url = `https://opensea.io/discover/chain/${chain}`;
  const r = await fetch(url, {headers:{'user-agent':UA,'accept':'text/html'}});
  if(!r.ok) throw new Error('opensea http '+r.status);
  const html = await r.text();
  return extractCollections(html);
}

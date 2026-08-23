// nxrzoom_ — dexscreener helper (server side, no cors issues)
const BASE = 'https://api.dexscreener.com';

async function j(url){
  const r = await fetch(url, {headers:{'accept':'application/json'}});
  if(!r.ok) throw new Error('http '+r.status);
  return r.json();
}

export default {
  async tokens(addrs){
    const arr = Array.isArray(addrs) ? addrs : [addrs];
    return j(`${BASE}/tokens/v1/solana/` + arr.join(','));
  },
  async boosts(kind='top'){
    return j(`${BASE}/token-boosts/${kind}/v1`);
  },
  async profiles(){
    return j(`${BASE}/token-profiles/latest/v1`);
  }
};

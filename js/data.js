// nxrzoom_ — data (mock, swap with live API later)

// deterministic mock mint per token (looks like real base58 address)
function mintFor(token){
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let h = 0;
  for(const ch of token) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let out = '';
  let x = h || 1;
  while(out.length < 44){
    x = (x * 1103515245 + 12345) >>> 0;
    out += B58[x % 58];
  }
  return out;
}

const DATA = {
  topCalls: [
    { token:"$Dinger", time:"5h", x:"73.89x", pct:"+7,289%", cap:"$86.9K → $6.42M", w:10 },
    { token:"$Link",   time:"6h", x:"60.44x", pct:"+5,944%", cap:"$36.0K → $2.18M", w:4  },
    { token:"$RING",   time:"7h", x:"44.62x", pct:"+4,362%", cap:"$10.4K → $463K",  w:15 },
    { token:"$CHAD",   time:"3h", x:"32.15x", pct:"+3,115%", cap:"$24.7K → $795K",  w:8  },
    { token:"$PEPE2",  time:"2h", x:"28.74x", pct:"+2,774%", cap:"$18.3K → $526K",  w:12 },
    { token:"$WIF",    time:"1h", x:"21.05x", pct:"+2,005%", cap:"$52.1K → $1.09M", w:6  }
  ],
  feed: [
    { w:2,  token:"$Hogecoin", mcap:"$86K",  t:"3m" },
    { w:5,  token:"$XYZ",      mcap:"$210K", t:"5m" },
    { w:2,  token:"$SPIRITS",  mcap:"$44K",  t:"7m" },
    { w:2,  token:"$Melo",     mcap:"$130K", t:"8m" },
    { w:4,  token:"$MOKU",     mcap:"$380K", t:"10m"},
    { w:15, token:"$CocaCola", mcap:"$1.2M", t:"11m"},
    { w:5,  token:"$BCAMEL",   mcap:"$95K",  t:"12m"},
    { w:5,  token:"$KABOSU",   mcap:"$260K", t:"13m"},
    { w:2,  token:"$SIMBA",    mcap:"$58K",  t:"14m"},
    { w:10, token:"$DIDDY",    mcap:"$740K", t:"15m"}
  ],
  trending: [
    { name:"Sestri",        sym:"SESTRI",   d:22, h1:"+0.57%",  h6:"-0.73%",  h24:"-10.98%", vol:"$6.85K",  mcap:"$208.64K" },
    { name:"Pilates",       sym:"PLTS",     d:27, h1:"+1.20%",  h6:"-1.06%",  h24:"-4.99%",  vol:"$238",    mcap:"$123.33K" },
    { name:"Vanta",         sym:"VANTA",    d:26, h1:"+0.31%",  h6:"+0.00%",  h24:"-9.11%",  vol:"$2.38K",  mcap:"$104.17K" },
    { name:"c1a0",          sym:"CIAO",     d:26, h1:"-0.42%",  h6:"+0.57%",  h24:"-0.49%",  vol:"$343",    mcap:"$98.11K" },
    { name:"John Pork Coin",sym:"JPORK",    d:21, h1:"+2.10%",  h6:"-3.88%",  h24:"-1.80%",  vol:"$10.22K", mcap:"$94.28K" },
    { name:"GigaCHAD",      sym:"CHAD",     d:26, h1:"+0.88%",  h6:"+0.00%",  h24:"-3.75%",  vol:"$4.48",   mcap:"$92.8K" },
    { name:"Riviera",       sym:"RIERA",    d:26, h1:"-1.05%",  h6:"+0.00%",  h24:"-3.80%",  vol:"$2.74",   mcap:"$85.26K" },
    { name:"Rivo Altus",    sym:"RA",       d:26, h1:"+0.19%",  h6:"+1.41%",  h24:"+1.41%",  vol:"$2.30",   mcap:"$79.42K" }
  ],
  signals: [
    { n:"Quotrons",         h:"@Quotrons404",    s:+7, f:"48k",  type:"people",   isNew:false, d:"early solana calls, avg entry <100k mc" },
    { n:"NetNet Capital",   h:"@NetNetCap",      s:+6, f:"112k", type:"people",   isNew:true,  d:"microcap degen plays + exit signals" },
    { n:"basedpad",         h:"@basedpadfun",    s:+5, f:"31k",  type:"projects", isNew:false, d:"base chain launches, fast in-and-outs" },
    { n:"Bluechip",         h:"@basebluechip",   s:+5, f:"67k",  type:"projects", isNew:false, d:"mid-cap momentum, holds runners" },
    { n:"Hedgehog",         h:"@HedgeOnHood",    s:+4, f:"89k",  type:"people",   isNew:true,  d:"cross-chain arb + new pair snipes" },
    { n:"ØKStock",          h:"@OKStockRWA",     s:+3, f:"54k",  type:"projects", isNew:true,  d:"rwa narrative entries before listings" },
    { n:"Mr Succ Holdings", h:"@MrSuccHoldings", s:+3, f:"23k",  type:"projects", isNew:false, d:"small caps only, high hit rate" },
    { n:"Verus",            h:"@TradeVerus",     s:+2, f:"76k",  type:"people",   isNew:false, d:"swing calls with on-chain receipts" }
  ]
};

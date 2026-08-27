# nxrzoom_

live smart money feed — track what top wallets buy on solana before the crowd.

**live:** https://nxrzoom.vercel.app

## features

- **live feed** — real-time wallet buys, expandable rows with one-tap deep links (axiom / gmgn / trojan / pump.fun / dexscreener) per token
- **top calls 24h** — ranked best calls, peak multiplier vs cap at call
- **trending tokens** — sortable table: newest, biggest 24h gainers
- **alpha signals** — ranked insiders, filter hot/new/projects/people
- **telegram alerts** — push notifications via bot
- **filters** — wallets in range, mcap at call range, ticker search
- **wallet quality radar** — inspect a Solana wallet's public RPC footprint and classify it as core / experimental / watch using sample size, recent activity, token diversity, position spread, and capital

The wallet score is intentionally a transparent heuristic. It does not claim PnL or “smart money” status until an indexed trade-history source is added; the UI lists those limitations instead of inventing precision.

## stack

vanilla html/css/js · no build step · static on vercel

## run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## deploy

```bash
vercel --prod
```

---

© 2026 nxrzoom_

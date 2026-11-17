# Market News & Possible Crypto Impact

## Run this update
1. Stop the previous Node server with Ctrl+C.
2. Extract the new ZIP to a new folder. Copy the previous `logs` folder into the new project if you want to retain your saved netflow/news history.
3. Run `npm install`, then `npm run dev` inside the extracted project.
4. Open the new server URL and use Ctrl+F5.

The new panel is beneath the live netflow section. No API key or paid news subscription is required. The same-origin endpoint is `GET /api/market-news`, available in both Vite dev and Node preview. A static-only upload cannot serve this endpoint.

## Sources and coverage
The API aggregates public RSS/Atom headline metadata from:
- Federal Reserve monetary policy releases (official).
- Federal Reserve speeches (official).
- Yahoo Finance NVDA stock headlines.
- Yahoo Finance QQQ/SPY market headlines.
- Google News macro/technology search index, when reachable.
- Cointelegraph, CoinDesk and The Block crypto feeds.

The server checks these feeds in parallel and caches the combined response for 120 seconds. The page refreshes automatically every 2 minutes while open. Headlines can be delayed at the publisher/indexer; this is not a tick-by-tick professional news wire. Coverage is limited to the configured feeds, not every possible market-moving event. Some sources may be blocked or unavailable in your location; the Source health section reports each source independently and working feeds continue.

Categories include Nvidia/technology, Fed/macro, ETF/institutional news, regulation, exchange/security incidents, stablecoins, geopolitical events, coin updates and general markets. Categories reflect available headlines; the app does not supply a comprehensive scheduled economic calendar or a verified consensus-versus-actual data terminal.

## What impact means
Impact is a conservative, transparent **headline-rule interpretation**, not an AI confidence score, verified causal explanation or trade recommendation.

Examples:
- Nvidia/tech share weakness: possible indirect risk-off pressure on crypto.
- Tech strength: possible support for risk appetite.
- Fed interest-rate cuts/hikes: possible policy-easing/tightening context; expectations and guidance still matter.
- Inflation above/below expectations: possible policy-expectation context.
- ETF inflows/outflows: possible demand pressure.
- Hacks, withdrawal suspensions, stablecoin depegs: possible liquidity/security risk.

Labels are **Potential bullish**, **Potential bearish**, **Mixed / review** or **Unclear**. Importance labels indicate attention, not a numerical price forecast or expected return. Speculation, rumours, questions, upcoming announcements, negation and contradictory statements receive cautious labels. Headlines may be incomplete, sarcastic, wrong or already priced in. Many real catalysts will correctly remain unclear; read the linked report and check actual price, volume and flow.

The panel never claims that an Nvidia move caused a crypto move merely because both happened. It does not promise to catch a news item before other traders. News labels do not place exchange orders and do not change the existing $5M flow alarm.

## How to use the panel
- Filter by category, possible direction, 24 hours / 72 hours / 7 days, or search Nvidia/Fed/BTC/ETF etc.
- Open a headline to review the publisher's article.
- Read the Roman Urdu explanation of the possible crypto impact and the direct/indirect asset scope.
- Expand Source health to see which feeds returned data.
- Published time is supplied by the publisher, displayed in Asia/Karachi (PKT). Missing publication dates remain explicitly unavailable.
- First seen here is the first time this installation collected that item. It is NOT proof of the first TV channel, social account or website to publish it.
- Bullish/bearish headline counts describe matching headlines; they are not independent market evidence or a combined trading score.

## Archive
The latest 1,000 deduplicated headlines within 7 days are retained in `logs/market-news.json`. Publication time, first-seen time, links and source attribution are stored; full article bodies are not downloaded or copied. The UI shows at most 100 matching cards. On restart, the archive keeps original first-seen timestamps. Preserve the logs folder when changing directories. An unreadable archive is retained rather than silently overwritten; new headlines can continue in memory with an explicit warning.

## Verification
- Production build passed.
- 89 remaining automated tests passed, including safe link parsing, RSS/Atom dates, duplicate detection, cache sharing, partial/all feed failures, first-seen persistence, archive recovery and conservative impact rules.
- Live probes successfully retrieved Federal Reserve, Yahoo Finance NVDA/QQQ/SPY, Cointelegraph and The Block feeds. CoinDesk initially timed out but recovered on the final check. The final check returned 114 headlines from 7 of 8 feeds; Google News remained unavailable. Source health exposes these failures.
- Browser visual inspection was unavailable in this environment.

Feed reference: https://www.federalreserve.gov/feeds/feeds.htm

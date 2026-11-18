# Per-coin 1-minute thresholds, market proxies and liquidity depth

## Install
Stop the previous server, extract this ZIP to a fresh directory, copy your existing `logs` folder into the new project, and run `npm install` then `npm run dev`. Open the new URL and use Ctrl+F5. Enable the sound alarm once and use Test sound to check browser audio.

## Two groups in the same netflow table
| Group | Coin | Positive / negative 1-minute threshold |
|---|---|---:|
| Fixed | BTC | ±5,000,000 USDT |
| Fixed | USDC | ±5,000,000 USDT |
| Fixed | ETH | ±5,000,000 USDT |
| Fixed | BNB | ±5,000,000 USDT |
| Fixed | SOL | ±5,000,000 USDT |
| Fixed | XRP | ±5,000,000 USDT |

All six listed coins use the same fixed threshold. The threshold is visible beside each row and in the summary card.

The trigger is the absolute net taker flow, not total turnover: at least $5M net buying or at most -$5M net selling inside the rolling 60-second window. It is USDT (approximately USD) for Binance spot pairs. It is not a claim that flow caused a price move.

The panel also adds the five biggest 24-hour gainers and five biggest 24-hour losers among Binance USDT pairs, refreshed on the Pakistan calendar day. These daily movers must have at least $10M of 24-hour quote volume, and stablecoins, the six core coins and leveraged tokens are excluded. Each mover uses a ±$2M net buying/selling alarm over a rolling 60 seconds. Their live minute flow is shown in the table; historical candles and order-book depth remain limited to the six core coins. The daily list is selected by percentage change, not market capitalization, so it may contain coins of different sizes.

Both signs trigger the same per-coin rule: netflow >= threshold or <= negative threshold. WebSocket events, REST fallback, sound eligibility, screen events, durable logs and CSV use the same threshold source. The first complete stream minute, deduplication, freshness checks and 60-second same-coin/direction cooldown remain in place. Existing old events retain their historical $5M threshold when that metadata was absent. New logs record the actual coin threshold. Clearing events does not erase saved logs.

Only the **1-minute** column uses the strong threshold border; longer historical windows remain contextual netflow colors. Selecting another card interval does not change the 1-minute alarm rules. The older separate multi-coin Whale Radar and IEX controls keep their own existing behavior; this update is for the Spot Netflow panel.

## Order-book depth in each coin's row
The new columns show:
- Buy-side/bid depth within the selected range below the book midpoint.
- Sell-side/ask depth within the selected range above the midpoint.
- Bid/ask spread percentage.
- Snapshot received date/time in Asia/Karachi.

Select ±0.1% or ±0.5% from midpoint. Pending order value is sum(price × quantity) within the band, quoted in USDT (approximately USD). These are snapshots of Binance USDT pairs only. They are not all exchanges combined.

The `/api/spot-depth` Node endpoint requests up to 1,000 bid/ask levels per coin and caches requests across tabs for 10 seconds. The page requests updates every 10 seconds plus provider/network latency. No API key is needed. Rate-limit responses cause a cooldown rather than continuous retries.

**Full band** means returned levels reach the selected boundary, or the provider returned fewer than the requested levels and thus exhausted that side. **Partial book / ≥ amount** means the snapshot stops before the boundary. This amount is a lower bound and must not be treated as proof of thin liquidity. A stale or unavailable book is labelled explicitly; old values are not presented as fresh. The received timestamp is local receipt time, not an exchange event timestamp.

The book and 60-second executed flow are different data types and snapshots in time. Visible orders can change or cancel. Depth is shown as context and does **not** gate or suppress verified netflow alerts. A book snapshot does not establish a specific expected price move. USDC's flow is not a prediction that the stablecoin will pump.

## Daily movers and traditional markets

The daily gainers and losers use Binance Spot books (up to 500 levels per side) and Binance Spot candles for net taker flow. Both depth bands, the spread, and the book receipt time in PKT use the same display as the core pairs.

Gold (XAUUSDT), Silver (XAGUSDT), and S&P 500 (SPYUSDT) use Binance USDⓈ-M perpetual contracts in the netflow table. All prices, book amounts, spreads, and netflow for each of these rows come from the named contract. The 60-second net taker flow refreshes every 10 seconds. These public endpoints do not require an API key. The Futures rows have no sound alarm threshold or market cap. The ETF price momentum panel remains available separately. Depth amounts use visible orders and show partial coverage when the snapshot stops short of the selected band.

If Binance cannot provide a snapshot or enough history for a window, the corresponding cell shows unavailable. A successful depth timestamp comes from the received book, independent of the latest trade.

## Preserved features
News and impact feeds, prices, historical columns, the REST stream fallback, sound controls, dated event history and full CSV logs remain present. The removed paper-trading lab remains absent.

## Validation
The updated focused tests check all six thresholds at $5M, positive and negative alarm crossings, REST minute flow, news impact handling and market instrument handling.

Binance API reference: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints

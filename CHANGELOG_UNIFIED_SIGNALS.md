# Combined Crypto + ETF Signal Feed

- Added **All signals / 50 Crypto Coins / NASDAQ-100 / S&P 500** tabs above the original Binance crypto signal feed.
- Merges Binance aggressive-trade events and Alpaca IEX QQQ/SPY quote-inferred trade events by absolute event timestamp (newest first), using unique source-prefixed IDs.
- Selecting any row updates **the same right-side details panel** with fields appropriate to its source.
- Keeps US ETFs accurately marked **ESTIMATED · IEX ONLY**; does not mislabel IEX prints as Binance aggressor trades or individual whales.
- Reuses existing IEX Server-Sent Events subscription, notification logic, threshold ($5M/60s minimum), and PKT time conversion; no second stream or duplicate alarms.
- Converted the old lower ETF feed into a **collapsed diagnostic panel** to prevent duplicate lists while preserving live feed visibility.
- Existing Twelve Data candle/momentum panel retained as-is below.
- Existing crypto threshold and window controls still affect crypto, while ETF threshold remains $5M/60s.
- API keys stay in local `.env` only, never distributed in the ZIP.

## Run

`npm install` then `npm run dev`. Preserve your private `.env` locally and do not commit credentials.

# Zero QQQ / SPY signals: troubleshooting

This build adds clear IEX data-feed health diagnostics. It does **not** lower the $5 million threshold or generate artificial signals.

## When the dashboard says IEX connected and $0 pressure

1. The IEX WebSocket may be authenticated but receive no trades; this is common outside US regular trading hours. Regular hours are 9:30 AM-4:00 PM America/New_York, Monday-Friday, except holidays and closures. During October while the US is on daylight saving time, these hours correspond to about 6:30 PM-1:00 AM PKT.
2. See the added `trade frames received since server start`, `quote frames`, and `last trade received` counters. If trade frames are zero, data cannot produce a signal.
3. If frames arrive, `Estimated BUY` and `Estimated SELL` only include quote-classified IEX prints. Unknown trades are never assumed to be BUY or SELL.
4. A signal requires >= $5,000,000 on one classified side within a 60-second rolling window. This is intentionally strict and may rarely occur using a single IEX venue.

## Twelve Data 'No candles' is separate

With `npm run dev` running, open these URLs in your browser using the port Vite printed:
- http://localhost:5173/api/market-candles?symbol=QQQ
- http://localhost:5173/api/market-candles?symbol=SPY

Inspect `configured`, `bars`, and `error` in JSON. It may report missing key, plan restrictions, or rate limits; a provider response error is not necessarily an Alpaca IEX failure. Do not share your API secrets.

## Safe checks

- Start using `npm run dev`, not a raw static HTML file or a disconnected production server.
- Keep `.env` private, with `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `ALPACA_FLOW_THRESHOLD_USD=5000000`, and (if using candles) `TWELVEDATA_API_KEY`.
- Restart `npm run dev` after changes to `.env`.
- The Binance top-50 crypto engine is unchanged.

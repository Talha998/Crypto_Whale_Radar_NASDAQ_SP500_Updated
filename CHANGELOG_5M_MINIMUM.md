# NASDAQ-100 / S&P 500: $5M minimum IEX signal threshold

This update changes only the Alpaca Basic IEX ETF **estimated trade-flow** alert threshold for QQQ / SPY. The existing 50-coin Binance whale scanner, crypto thresholds, Twelve Data price-momentum section, and alarm controls remain unchanged.

## Exact rule

- Combine **quote-classified BUY or SELL**, separately, from real IEX QQQ/SPY trade prints in a **rolling 60-second window**.
- Emit a new estimated directional signal only when its respective side reaches **at least $5,000,000** of `trade.price * trade.size` cumulative turnover.
- Example: $4,900,000 BUY plus $1,000,000 SELL does **not** qualify as BUY or SELL pressure, because **neither side** reaches $5M; $5,010,000 BUY alone does.
- If `.env` contains the old `ALPACA_FLOW_THRESHOLD_USD=50000`, the backend enforces $5M anyway. Update it to `ALPACA_FLOW_THRESHOLD_USD=5000000` to make your preference explicit, then fully restart `npm run dev`.
- Alerts and selected-event rows under $5M are suppressed. The raw live diagnostics can still show e.g. $357K classified turnover; that is **not** a signal.
- Higher thresholds may be configured in `.env`. Lower ones cannot bypass the $5M minimum.

## Data and limitations

IEX is one US exchange; free Alpaca Basic does not provide all-market, exchange-confirmed aggressor sides. The BUY/SELL labels are **quote-based estimates** for the tracked QQQ/SPY ETFs, not identified large investors, not count of unique people, and not NQ/ES futures. $5M per-side classified IEX volume in 60s can be uncommon, so the signal list may remain empty even if quotes/trades are live. This is expected and prevents misleading $142K or $357K "whale" signals.

## Quick start

1. Copy files over previous web project (keep your private `.env`).
2. Check `.env`: `ALPACA_FLOW_THRESHOLD_USD=5000000` (alongside your own `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`).
3. `npm install` to install/update dependencies, then `npm run dev`.
4. Verify **IEX STREAM LIVE**, **minimum BUY/SELL pressure $5.00M** in the IEX panel.
5. Run `npm test` to verify the threshold is enforced for QQQ/SPY.

Never expose Alpaca API credentials in a screenshot or source-control repository.

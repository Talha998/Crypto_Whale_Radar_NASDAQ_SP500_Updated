# Signal History Retention — Web Update

## What changed
- One **Clear Signals** button is now visible at the top of the unified Binance / NASDAQ-100 (QQQ) / S&P 500 (SPY) feed.
- Both signal sources save every signal in this **browser tab's `sessionStorage`**. Signals are restored after page reload, returning to the tab, or a browser background-tab discard/reload.
- No 150-event client-side automatic deletion: incoming signals are appended and existing signals remain available until you clear them or the tab session ends.
- IEX server `snapshot` messages now **merge** with restored history. Old server snapshots never overwrite saved events.
- Clear Signals asks for confirmation, removes BOTH crypto and ETF signal histories, resets the selected detail panel, and prevents the server's pre-clear IEX snapshot from adding old signals back. Live monitoring continues after a clear.
- Existing Binance 50-coin monitoring, Alpaca IEX $5M minimum, filter controls, alarms, and mobile bridge are unchanged.

## Retention limits / expectations
- **This tab only:** sessionStorage is per browser tab. Closing the tab ordinarily clears its history; browser *Restore previous session* features may preserve a restored tab.
- Browser storage has a limited quota. If full/disabled, a warning is emitted and newer signals may not survive another reload; no older signals are automatically deleted by this patch.
- Browser page discard or network loss can disconnect the client. Signals that **already arrived** are retained. A signal that occurred *while neither an active tab nor a server-side collector observed it* cannot be reconstructed just from sessionStorage. For 24/7 collection use a continuously running backend and server-side durable history.
- Clearing records does not stop or reset Binance/Alpaca market-data feeds. New qualifying signals will appear normally.

## Upgrade
1. Unzip this project and preserve your existing private `.env` file (not included).
2. `npm install`
3. `npm run dev`
4. Wait for a live signal, refresh the page, confirm that the signal is retained. Click **Clear Signals** and confirm it disappears. New signals continue to arrive.

## Checks
- Run `npm test` to execute the existing market tests plus session-history and reload tests.
- All API keys remain server-side in `.env`; do not paste them into React code or commit them to Git.

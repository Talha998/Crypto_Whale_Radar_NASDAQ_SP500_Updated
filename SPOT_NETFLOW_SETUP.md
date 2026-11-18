# Persistent netflow event log

The top panel now includes **Saved netflow log · 1 minute** and **Download full CSV**.

Each verified event saves at +$5,000,000 or higher or -$5,000,000 or lower for the six core coins; daily gainers/losers use ±$2,000,000. It records:
- Coin name (core coins or a selected daily mover).
- Direction: net buying or net selling.
- Signed 60-second netflow and observed trade price.
- Calendar date and time in Asia/Karachi (PKT), plus UTC time.
- Source and event ID.

Logs are written to **logs/spot-netflow.jsonl** in the project folder. The folder is created on the first saved event. Existing files survive browser and normal server restarts. The UI shows the latest 200 records (up to the recent file tail on restart), can filter by coin, and refreshes automatically. CSV streams all valid saved records, including older entries outside the UI list. No automatic deletion is configured.

Logging runs independently of the sound toggle. Clear live events and dismiss alarm banners do not delete durable logs. Identical events and same-coin/same-direction events within 60 seconds are deduplicated across tabs and transports. As before, this records observed crossings, not a new entry for every refresh that stays above the threshold.

REST events are saved by the Node server before the response returns. Browser stream events are sent to the server; unsuccessful saves stay pending in this browser and retry automatically, with an error shown on screen. The saved-log table confirms what is actually written. Browser-reported entries are labelled separately from server-verified REST entries. The browser must remain open and active to continue monitoring; the server does not independently keep polling after all pages close.

Restart the Node server after installing this update. When moving to a new extracted project folder in future, copy the old **logs** folder into it to retain your history. Keep that folder writable. These endpoints are designed for the existing local application; a publicly shared deployment requires your normal access controls.

Validation: production build and **77 automated tests passed**. Log-specific checks cover dates, positive/negative records, persistence after restart, duplicate suppression, CSV export, partial lines and visible disk failures. Browser visual/audio verification remains unavailable in this environment.

---

# 1-minute core and daily-mover sound alarms

The top panel now has **Enable alarm**, **Disable**, and **Test sound** controls using the existing shared laptop signal alarm. No additional application or API key is needed.

1. Start the updated project using the instructions below.
2. In the top netflow panel, click **Enable alarm** once to unlock browser audio.
3. Use **Test sound** to check your speaker volume. Test does not arm the alarm by itself.
4. Keep the tab open and active. After a page reload, enable sound again.

When a new verified rolling-60-second netflow event reaches **±$5,000,000** for BTC, USDC, ETH, BNB, SOL or XRP, or **±$2,000,000** for one of the five daily gainers/five daily losers, the matching buy/sell tone plays. The daily list excludes core coins, stablecoins and leveraged tokens, and requires at least $10M 24-hour quote volume. A screen banner shows each qualifying crossing and desktop notifications appear if permission is granted.

Visual alerts and event history remain available when sound is disabled. The same event never sounds twice; same-coin/same-direction crossings have a 60-second cooldown. Old saved/cached history, events observed before arming, stale events and incomplete minutes cannot sound. Sound is emitted for newly observed crossings; turning it on does not replay a threshold already recorded while sound was off.

In REST fallback mode, alarms fire when the next approximately 3-second refresh observes the crossing. With a complete WebSocket minute, incoming trades drive events. Tracking depends on a running page, browser audio access and a working connection. Browser audio output was not audibly verified in this environment; the existing tone generator is reused, and the threshold/arming/replay rules passed automated tests.

---

# Live spot netflow — connection fix

## What's fixed
The price and 1-minute columns previously depended on browser WebSocket access. If the connection was blocked, both stayed blank even when the older REST history columns worked.

The panel now starts a server-side REST fallback immediately. It fetches the complete latest 60 seconds of Binance aggregate trades (with pagination), calculates net taker buying minus selling, and returns the latest actual trade price for six core coins and selected daily movers. Refresh interval: approximately 3 seconds plus network time. Data is cached across tabs to limit API requests. No API key is required.

Status **LIVE · REST · 3s** means fallback is working. When WebSocket streaming is available and has a complete minute, **LIVE · WebSocket** is shown. The fallback is kept as standby. If both fail, the panel reports offline and marks last-known data stale.

REST mode detects threshold crossings at refresh times, rather than on every individual trade. Network outages or browser suspension can interrupt tracking. Keep the page open and active. Daily movers update once per Pakistan calendar date; the page checks for a new daily list every five minutes.

## Replace the previous version
1. Stop the old terminal server with Ctrl+C.
2. Extract this ZIP to a fresh folder.
3. Open a terminal inside the extracted project folder.
4. Run:

```bash
npm install
npm run dev
```

5. Open the URL printed by the NEW server. Hard-refresh the browser with Ctrl+F5.

A restart is required because this update adds `/api/spot-live-minute` on the Node server. Copying frontend files while the old server remains running will not add the endpoint. Do not upload `dist` alone to a static-only host: the REST endpoints require Node. Both `npm run dev` and `npm run preview` register them.

## Display and event meaning
- Coins: BTC, ETH, BNB, USDC, XRP.
- Default: **1 minute**, the latest rolling 60 seconds, not fixed clock-minute buckets.
- Prices: actual Binance USDT pair trade prices. USDT approximates USD.
- Green: net taker buying; red: net taker selling.
- At +5,000,000 USDT or higher: net buying event; at -5,000,000 or lower: net selling event.
- Event includes the amount, price at observation, calendar date and Asia/Karachi time (PKT).
- These are trading-flow values, not wallet deposits/withdrawals or identified single-whale orders.
- Events keep the most recent 100 entries in this browser. Threshold crossings have a 60-second cooldown per coin/direction. Clear events removes the displayed history.
- WebSocket starts with a partial-window countdown until 60 seconds of uninterrupted data has been collected. REST can bootstrap the complete minute directly from history.
- Exchange time is used for REST queries so an incorrect local machine clock does not shift the minute range.

Historical 5-minute to 30-day columns keep their 30-second REST refresh. Short historical periods use minute candles; long periods use hourly candles including the current partial bucket. This update also aligns the current hour to the provider's timestamps to avoid missing long-window cells when the machine clock differs. Missing or incomplete data stays unavailable.

Market caps use CoinGecko separately and may be absent or delayed. Optional `COINGLASS_API_KEY` in `.env` enables CoinGlass Startup-or-higher historical netflow; the live minute and price still cover Binance pairs and are labelled separately.

## Verification
- Production build passed.
- 67 automated tests passed, including positive/negative sound eligibility, arming, restored-history suppression, cooldowns, pagination, clock alignment, stale handling and threshold events.
- Live REST check returned verified complete-minute flow and prices for all five coins, including an ETH minute requiring more than one page of trades.
- Browser WebSocket access and visual rendering could not be verified in this environment. The REST fallback was tested against Binance directly.

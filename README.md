> **Latest change:** NASDAQ-100 / S&P 500 IEX quote-classified trade signals now require **minimum $5,000,000 per BUY/SELL side within 60 seconds**. No smaller IEX trade-pressure events or alarms are produced. See [CHANGELOG_5M_MINIMUM.md](CHANGELOG_5M_MINIMUM.md).

# Crypto Whale Radar — Rolling Pressure Edition

React/Vite dashboard that monitors active Binance Spot USDT markets and detects cumulative aggressive BUY/SELL pressure over rolling 30-second or 60-second windows.

## Why this version is better

A large order is often split into many smaller executions. Instead of requiring one single $5M print, this version adds together same-side aggressive executions for each coin inside the selected rolling window.

Example: $0.9M + $1.4M + $1.1M + $1.8M aggressive BUY executions within 60 seconds = a $5.2M BUY-pressure signal.

## What it shows

- Dynamic list of active Binance Spot USDT markets
- $5M / $10M / $25M / $50M pressure thresholds
- 30-second or 60-second rolling aggregation
- Coin, BUY/SELL pressure, cumulative USD value, quantity and trade count
- Volume-weighted average execution price (VWAP)
- Price when the threshold was crossed
- Opposite-side flow and net side pressure
- 30-second and 60-second observed price reaction after the signal

## Important interpretation

The data comes from Binance public aggregate trades. BUY/SELL means the aggressive/taker side. A rolling signal proves concentrated exchange execution pressure, but it does **not** prove all included trades belong to one wallet or identify a trader. Price reaction is correlation, not proof of causation.

## Run

```bat
npm install
npm run dev
```

The project keeps the direct Node-to-Vite npm scripts to avoid Windows `.cmd` shim issues seen in some environments.

## Optional endpoints

Create `.env` if you need alternate Binance endpoints:

```env
VITE_BINANCE_REST_BASE=https://api.binance.com
VITE_BINANCE_WS_URL=wss://stream.binance.com:9443/ws
```

## BTC laptop alarm

Use **BTC laptop alarm → Enable** once after opening the dashboard. Browser autoplay rules require a user click before future audio alerts are allowed. After it is armed, every detected BTC rolling whale-pressure signal plays a three-tone alarm. If desktop notifications are permitted, the browser also shows the BTC side, amount, rolling window, and signal price.

Use **Test** to verify your laptop volume before leaving the dashboard running.

## Live Long / Short Account panel

The header now includes a Binance USD-M Futures global long/short account snapshot. BTC is selected by default, and the dropdown is populated with active USDT perpetual futures symbols when Binance is reachable.

- Source: Binance Futures `globalLongShortAccountRatio`
- UI refresh: every 15 seconds
- Binance source period: 5 minutes
- Shows: long-account %, short-account %, long/short ratio, previous-5m percentage-point change, and timestamp
- Important: Binance's public endpoint does **not** publish the absolute number of people/accounts, so the app does not fabricate values such as "1,000 users long". It displays Binance's real published account split instead.

Optional environment override:

```env
VITE_BINANCE_FUTURES_REST_BASE=https://fapi.binance.com
```

## NEW — NASDAQ-100 and S&P 500 price-momentum signals (QQQ / SPY)

The existing **50 live Binance Spot USDT** signals and futures account-positioning panel are unchanged. An additional **US Equity Markets** section shows real ETF price/volume-derived events in the **same selectable rows + right-hand detail panel format as the crypto event feed** for:

| Display | Tracked asset | Data type |
| --- | --- | --- |
| NASDAQ-100 | QQQ (Invesco QQQ ETF) | 5-minute OHLCV candles |
| S&P 500 | SPY (SPDR S&P 500 ETF) | 5-minute OHLCV candles |

**Important distinction:** These are **ETF price-momentum indicators, not aggressive taker-side trades or $5M whale signals**. They are labelled `BUY MOMENTUM` / `SELL MOMENTUM` and must not be interpreted as evidence of a single trader, institutional order, or executed index transaction. Indices themselves are not traded like Binance spot tokens.


### Screenshot-style NASDAQ / S&P 500 selected event panel

The US section now mirrors the crypto signals layout: selectable left-column events (symbol, New York signal time, BUY/SELL momentum pill, five-minute ETF share volume, estimated total dollar turnover and 15-minute price change) plus a right-column **Selected US Market Signal** panel (market, ETF, 15-minute change, closing price, total turnover, available share volume, relative volume and exact source time). All signals remain derived from the existing Twelve Data five-minute ETF candles.

**Do not treat this as true whale trades.** The aggregate share count represents all trades and the dollar figure is **shares × close**, not money bought or sold by one side. True aggressive buy volume, aggressive sell volume, net signed pressure, individual whale identities, aggressive trade counts and true execution VWAP are explicitly displayed as **Not available** rather than fabricated. To fill those fields accurately, an authorized tick/trade-level data provider with market-side classification is needed (e.g., relevant NQ/ES futures data licensing).

If you already have `.env` set up, keep it when replacing project files. The ZIP deliberately contains only `.env.example`; **never place secret keys into the ZIP**.

### Free market-data setup

1. Register for a free API key at https://twelvedata.com/pricing . Free usage is limited and data / ETF coverage depends on the provider and licence.
2. Copy `.env.example` to `.env` in the project root, and replace the blank `TWELVEDATA_API_KEY=` with your key.
3. Run `npm install` (unless already installed), then `npm run dev` and open the Vite URL.
4. If the provider supports these symbols on your plan, the `NASDAQ-100 & S&P 500 Signals` panels populate automatically. If not, an explicit provider error is displayed instead of made-up data. Market quotes are **not included in the ZIP**.

Example `.env` (keep private):

```env
TWELVEDATA_API_KEY=YOUR_OWN_KEY
```

### What triggers US market signals?

- The local Vite server requests SPY and QQQ **5-minute candles** through its own `/api/market-candles?symbol=...` route. Your key stays in the Node server; it is **not** exposed through a `VITE_` browser environment variable.
- Client-side signal detection compares an ETF's **last completed 5-minute close** with its close **3 bars (15 minutes) earlier**. An upward move of at least **+0.25%** is labelled `BUY MOMENTUM`; a downward move of at least **-0.25%** is `SELL MOMENTUM`.
- A `volume spike` flag appears when a bar's volume is at least **1.5×** the average of the previous five candles. No volume value is invented when a source does not provide it.
- Events are throttled to **one per same instrument/direction every 30 minutes** and are displayed for the latest available session only. Events from initial historical loading do **not** trigger an alarm.
- The browser refreshes every five minutes. Responses are cached for five minutes **across browser tabs** by the local server. During a continuously running 24-hour session this requests no more than 576 ETF series reads/day (two assets × 288 checks), below the provider's currently advertised 800-credit daily allowance if each read costs one credit; other apps and retries count separately.
- Use the existing **Signal laptop alarm → Enable** button to arm sound/browser notifications for *new* price-momentum events as well as crypto whale signals. Browser permission and the page remaining open are necessary for web alerts.

### Limits, market hours, and deployment

- US regular session typically runs 9:30 AM–4:00 PM **America/New_York**, weekdays, excluding exchange holidays; holiday detection depends on the actual timestamps delivered by the provider. The dashboard explicitly displays `outside session hours`, last completed bar time (ET), and provider errors.
- The free data source can be delayed, stale, unavailable or restricted by ticker/plan. The section **never claims millisecond or 30-second NASDAQ/SPX whale execution data**.
- By default **`npm run dev`** and **`npm run preview`** include the local API middleware. A **static-only `dist/` upload** does *not* include the Node-side market API route. A hosted deployment needs a server-side route and a suitable market-data licence.
- The key must never be committed, shared publicly, or included in a client-side Vite variable. The `.gitignore` excludes `.env`.
- Public redistribution of free-tier financial quotes may require a different data licence. Review Twelve Data licensing before publishing this dashboard to users.

### Automated checks

```bash
npm test
npm run build
```


## NEW — FREE trade-level NASDAQ-100 / S&P 500 IEX estimate (QQQ / SPY)

The dashboard now includes a **separate live IEX Trade Pressure** section ABOVE the existing 5-minute momentum analysis. The original Binance top-50 monitor, Binance Futures account-ratio panel, Twelve Data momentum cards, filters and alarms are preserved. The IEX panel mirrors the crypto feed layout: **left-side selectable BUY/SELL rows and right-side detailed event metrics**.

### What this actually measures

- Source: Alpaca **Basic (free)** real-time **IEX exchange only** stock/ETF print (`trades`) and best bid/ask quote (`quotes`) WebSocket (`wss://stream.data.alpaca.markets/v2/iex`).
- Tracks **QQQ ETF** as a NASDAQ-100 proxy and **SPY ETF** as an S&P 500 proxy. It does NOT measure the Nasdaq-100 or S&P 500 indices themselves or CME NQ / ES futures contracts.
- Every actual IEX print reports a price, size and timestamp. A print priced **at/above a fresh ask** (quote at most 2 seconds old, timestamp not later than print) is tagged **ESTIMATED BUY**; **at/below the bid** is **ESTIMATED SELL**. Trades in between, with absent/stale/invalid quotes, are **UNKNOWN** and are excluded from directional totals.
- Sums price × executed shares by estimated side over a rolling **60s window**, counts classified prints, calculates share-weighted VWAP, opposite-side and estimated net classified pressure, shows unknown totals and an observed subsequent 30s price reaction if a qualifying IEX print arrives. The IEX-only signal threshold is **at least $5,000,000 of estimated BUY *or* SELL turnover within 60 seconds**, matching the crypto monitor's default minimum. Set `ALPACA_FLOW_THRESHOLD_USD=5000000` in `.env`, or increase it (for example to `10000000`). Any value below $5M is automatically raised to $5M. **Smaller side totals never create signal rows or sound alarms**; live estimated side totals below $5M remain visible for diagnostics. Because Alpaca Basic provides IEX-only data rather than consolidated US market volume, qualifying $5M signals may be rare or absent.
- **This is a quote-classified ESTIMATE**, not an exchange-reported aggressor flag. It covers only a fraction of US market executions. Counts mean prints/trades **not individual buyers, sellers, institutions or whales**. Corrections/cancels are not netted. No false values are generated for unknown sides. USD figures are actual observed IEX turnover assigned to an estimated side, NOT buy/sell capital invested by unique traders.
- Do not expect live QQQ/SPY signals all the time: IEX is a limited free exchange feed and the $5M minimum is strict. No substitute data, smaller signals, or invented whale counts are used.
- The worker keeps one upstream Alpaca WebSocket connection server-side while `npm run dev` is running and streams sanitized signal/snapshot JSON to local browser tabs via same-origin Server-Sent Events. Alpaca credentials never appear in frontend code, HTML or browser websocket request.

### Setup (free Alpaca account required)

1. Go to https://app.alpaca.markets/ and obtain an API Key ID and API Secret Key for the Alpaca **Trading API** (paper-trading keys can work for market data according to account entitlement). Use Alpaca Basic IEX feed, not paid SIP.
2. Copy `.env.example` to `.env`, or merge these extra variables into your EXISTING `.env` (keep any Twelve Data key):

   ```env
   ALPACA_API_KEY_ID=YOUR_KEY_ID
   ALPACA_API_SECRET_KEY=YOUR_SECRET_KEY
   ALPACA_FLOW_THRESHOLD_USD=5000000
   ```

3. Run `npm install` (adds `ws` to the original React/Vite dependencies), then run `npm run dev`. Keep the terminal running. Open the Vite URL and look for **IEX STREAM LIVE** (during normal session, IEX volume will be more frequent than overnight).
4. Enable **Signal laptop alarm** for new incoming trade-level alerts (browser must stay open for browser audio/desktop notifications). The local Node stream itself continues when you close the tab, **as long as npm run dev remains running**; the saved in-memory signal list disappears on a server restart.
5. Never post your Alpaca API keys, don't prefix with `VITE_`, don't commit `.env` or host this development server publicly. Free exchange-feed redistribution and licensing rules still apply.

**Troubleshooting:**

- **SETUP REQUIRED** means `.env` credentials are absent; restart after adding them.
- **Alpaca feed error / insufficient subscription** means check credentials and Basic IEX entitlements. Free IEX is not SIP.
- **Stream live but no signals:** outside US market hours, IEX can be quiet, or live quote quality/amount may be below threshold. Unknown-classified prints will show separately; lowering the `.env` threshold does **not** turn estimates into verified whale order flow.
- **No console build?** Ensure Node.js version meets the Vite version installed and run `npm install` again if dependencies are absent.
- **Do not use actual NASDAQ/SPX index symbols in the IEX stock API:** indices are not stock trade tapes.

The original Twelve Data 5-minute momentum section is still provided below the new IEX estimate; it is labeled as price momentum, not actual aggressor-side pressure.


## Why QQQ/SPY signals can show zero (diagnostics update)

- **IEX connected** means the WebSocket is authenticated and subscribed, **not** that the current minute has any trades. The dashboard now shows stream frame counts and last trade reception separately.
- During US regular trading hours (9:30 AM–4:00 PM America/New_York), incoming IEX trades and quotes can create estimated flows. Outside that session they may legitimately be zero. US holidays/halts can also limit trading.
- Whale-style QQQ/SPY signals require at least **$5,000,000 estimated quote-classified BUY OR SELL in the same rolling 60 seconds**, not total turnover. Alpaca Basic provides IEX-only coverage, so legitimate $5M signals could be rare or absent. No fake events are emitted.
- The lower **Twelve Data** 5-minute ETF candle cards are independent of Alpaca IEX. If they say **No candles**, inspect the local endpoint at `http://localhost:5173/api/market-candles?symbol=QQQ` while Vite is running. The JSON may include a provider restriction or API error; keys are never returned. Replace port `5173` if Vite shows another port. Also check `symbol=SPY`. Do not share keys.


## Pakistan time display (PKT)

QQQ / SPY Alpaca IEX trade signals, selected-event start/signal timestamps,
last observed IEX trade, and Twelve Data ETF momentum candles are now displayed
in **Pakistan Standard Time (Asia/Karachi, UTC+05:00)**. Each row includes
the Pakistan calendar date to make after-midnight rollover clear. US exchange
regular-session calculations still use New York time, so market hours and the
60-second / 15-minute signal rules are unchanged. The conversion automatically
handles New York EST/EDT daylight-saving differences.


## New: unified live signal list (crypto + US ETFs)

The main signal feed now combines Binance crypto whale-pressure events with Alpaca IEX QQQ (NASDAQ-100) and SPY (S&P 500) quote-classified ETF events, ordered newest first. Click either type to see its appropriate details in the same right panel. Filters: **All signals**, **50 Crypto Coins**, **NASDAQ-100**, **S&P 500**. Search and BUY/SELL filters also apply to both types. The separate ETF feed has been replaced with collapsed optional diagnostics to avoid scrolling. The Twelve Data price-momentum panel remains available below.

**Data-source distinction:** Crypto uses Binance aggressive executions. ETF events show *estimated initiator side on IEX-only trades*, not verified institutional whale flow. ETF emissions remain fixed at $5M per side per 60 seconds, even if crypto UI controls are adjusted. Empty ETF results may be normal outside regular US market trading hours or when IEX classification does not cross the threshold.

See `CHANGELOG_UNIFIED_SIGNALS.md` for the implementation and setup notes.

## Browser-tab signal history (latest update)

The unified Binance + QQQ/SPY feed now keeps received signal history in the current tab's
`sessionStorage`. Returning after 15–20 minutes or reloading the page does not automatically
clear the old alerts. Use **Clear Signals** at the top of the unified feed to remove both
Crypto and IEX histories; live monitoring continues. The session ends when the tab closes
(subject to browser session-restore behavior and storage quota). See
[CHANGELOG_SIGNAL_HISTORY.md](./CHANGELOG_SIGNAL_HISTORY.md).

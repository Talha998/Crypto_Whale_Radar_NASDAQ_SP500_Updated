# Automatic paper strategy lab

This feature is virtual practice. It uses public market-data endpoints only and sends no exchange orders or account requests.

## Start
Stop the old server, extract the updated ZIP, then run `npm install` and `npm run dev` inside the project. Open the new URL. Keep the page open; the simulator advances when the page polls every 30 seconds.

The first run downloads approximately 7 days of actual Binance 1-minute candles for BTC, ETH, BNB, USDC and XRP. First load may take about a minute. Existing alerts and netflow logs remain available.

## What runs automatically
Three fixed strategies are evaluated independently on each coin:
1. EMA 9/21 crossover confirmed by UTC-day VWAP.
2. Breakout of the preceding 20 candles with volume above 1.5 times the prior 20-candle average and EMA trend confirmation.
3. Three-candle taker-buy-minus-sell ratio above +20% or below -20%, with EMA/VWAP and price direction confirmation.

Default **Practice all strategies** mode simulates signals from all three, including strategies with poor or insufficient historical results. This collects forward practice evidence; it does not claim they are profitable. Each strategy/coin pair gets a separate $10,000 virtual account and at most one $1,000 position. There are 15 independent virtual accounts, not a shared real balance.

Choose **Only qualified strategies** to allow new paper entries only when that pair's historical holdout statistics meet all these conditions:
- At least 20 closed holdout trades.
- Observed win rate >= the selected 80% or 90% threshold.
- Positive net P/L after assumed trading costs.
- Profit factor > 1, or positive profit with no losses yet.

No qualifying strategy means no new entries in this mode. 80%/90% is a filter on measured historical win rate, not a prediction probability or guarantee. Comparing several strategies introduces selection bias. Seven days is limited history; minimum sample counts do not establish future reliability. Forward paper results are therefore shown separately.

In the live check for this update, **none of the 15 combinations qualified at 80%**. The software displays this result honestly instead of inserting a fabricated score. Results change as the historical window and forward trades evolve.

## Execution and risk model
Signals use completed candles. Historical simulation enters at the next candle open; forward simulation uses the same next-candle-open model when the next minute is observed. This is an idealized candle-based fill model, not an actual exchange execution or a tick-accurate prediction. A forward entry may be recorded seconds after that modelled opening timestamp.

- Position: $1,000 nominal, independently per strategy/coin.
- Assumed fee: 0.1% on entry and exit.
- Assumed adverse slippage: 0.05% on entry and exit.
- Stop loss: 0.5% from modelled entry.
- Take profit: 1% from modelled entry.
- Maximum hold: 15 minutes.
- If SL and TP both touch in the same candle, SL is assumed first.
- A gap past a stop uses the worse opening price.
- SELL entries are simulated shorts. Borrowing, futures funding, leverage, liquidation and exchange-specific constraints are not modelled.
- Win rate counts net-of-cost profitable closes; gross-positive trades can still be net losses.

Pause stops new entries; existing modelled risk exits continue. Price data failures block new entries. With all pages closed, polling and automatic simulation pause. On return, available closed candles may resolve existing virtual positions; no background live trading continues.

## Results and storage
The lab shows chronological holdout wins, sample counts, P/L, profit factor, qualification, forward closed P/L, realized virtual balance and open positions. Backtest uses the final 30% of the chronological candle series for holdout metrics; earlier candles provide indicator context. Trades opened before the split are excluded from holdout statistics. Strategy rules are fixed, not optimized to force an 80% result.

The forward journal records coin, strategy, BUY/SELL direction, entry/exit, fees, net P/L, reason and Pakistan date/time. The UI and CSV show the latest 200 journal events; the server JSON retains the latest 2,000 journal events and account trade statistics/history.

State is saved atomically in `logs/paper-trading.json`. Carry the entire `logs` folder forward when updating to a new extracted directory. Corrupt/unwritable state is reported and new entries are paused. Historical strategy results are recomputed from fresh candles, while forward results persist.

## Verification
- Production build passed.
- 84 automated tests passed, including qualification gating, chronological separation, no future-candle use in signals, SL/TP ambiguity, gaps, fees/slippage, state persistence and public-market-data-only requests.
- Live history check produced all 15 strategy/coin evaluations with no qualified strategies at 80%.
- Browser visual/audio verification was unavailable in this environment.

API reference: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints

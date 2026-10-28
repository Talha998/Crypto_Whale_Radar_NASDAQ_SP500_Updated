/**
 * IEX-only quote-classified ETF trades. This is an estimate, NOT an exchange-
 * reported aggressor flag. Trades inside spread or with stale quotes are UNKNOWN.
 * Counts are prints, never unique people; SPY/QQQ are ETF proxies, not indices.
 */
export const IEX_SYMBOLS = ['QQQ', 'SPY'];
export const IEX_LABELS = {QQQ: 'NASDAQ-100', SPY: 'S&P 500'};
export const IEX_WINDOW_MS = 60_000;
export const IEX_QUOTE_MAX_AGE_MS = 2_000;
// Keep IEX ETF pressure signals aligned with the crypto monitor's $5M minimum.
// The free IEX feed may not reach this threshold for long periods; we must
// NEVER label smaller observed turnover as a $5M whale-pressure event.
export const IEX_MIN_THRESHOLD = 5_000_000;
export const IEX_DEFAULT_THRESHOLD = IEX_MIN_THRESHOLD;

export function normalizeIexThreshold(value) {
  const requested = Number(value);
  return Number.isFinite(requested) && requested >= IEX_MIN_THRESHOLD
    ? requested
    : IEX_MIN_THRESHOLD;
}

const finitePositive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const priceSide = (price, bid, ask) => {
  const eps = 1e-7;
  if (price >= ask - eps) return 'BUY';
  if (price <= bid + eps) return 'SELL';
  return 'UNKNOWN';
};

export function classifyIexTrade(trade, quote, quoteMaxAgeMs = IEX_QUOTE_MAX_AGE_MS) {
  const tradeTime = Date.parse(trade?.t);
  const quoteTime = quote?.time;
  if (!Number.isFinite(tradeTime) || !quote || !Number.isFinite(quoteTime) ||
      quoteTime > tradeTime || tradeTime - quoteTime > quoteMaxAgeMs ||
      !finitePositive(quote.bid) || !finitePositive(quote.ask) || quote.ask <= quote.bid ||
      !finitePositive(trade.p)) return 'UNKNOWN';
  return priceSide(Number(trade.p), quote.bid, quote.ask);
}

export class IexFlowEngine {
  constructor({threshold = IEX_DEFAULT_THRESHOLD, windowMs = IEX_WINDOW_MS,
    cooldownMs = 60_000, onSignal = () => {}, onUpdate = () => {}} = {}) {
    this.threshold = normalizeIexThreshold(threshold);
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.onSignal = onSignal;
    this.onUpdate = onUpdate;
    this.queues = new Map();
    this.quotes = new Map();
    this.crossings = new Map();
    this.events = [];
    this.latestPrices = new Map();
    this.lastTradeTime = new Map();
    this.sequence = 0;
  }

  quote(data) {
    if (!IEX_SYMBOLS.includes(data?.S)) return;
    const time = Date.parse(data.t);
    if (Number.isFinite(time) && finitePositive(data.bp) && finitePositive(data.ap) && data.ap > data.bp) {
      this.quotes.set(data.S, {time, bid: Number(data.bp), ask: Number(data.ap)});
    }
  }

  prune(now = Date.now()) {
    for (const symbol of IEX_SYMBOLS) {
      const queue = this.queues.get(symbol) || [];
      const remaining = queue.filter(trade => trade.time >= now - this.windowMs && trade.time <= now + 5000);
      this.queues.set(symbol, remaining);
    }
    // A 30-second reaction is only measured using a subsequent actual IEX print.
    for (const event of this.events) {
      if (event.reactionStatus === 'PENDING' && now > event.time + 40_000) {
        event.reactionStatus = 'N/A';
        this.onUpdate({...event});
      }
    }
  }

  trade(data, receivedAt = Date.now()) {
    if (!IEX_SYMBOLS.includes(data?.S) || !finitePositive(data.p) || !finitePositive(data.s)) return;
    const tradeTime = Date.parse(data.t);
    if (!Number.isFinite(tradeTime) || tradeTime > receivedAt + 5_000 || tradeTime < receivedAt - this.windowMs) return;
    const symbol = data.S;
    const price = Number(data.p);
    const size = Number(data.s);
    const side = classifyIexTrade(data, this.quotes.get(symbol));
    const trade = {symbol, time: tradeTime, price, size, notional: price * size, side};
    this.latestPrices.set(symbol, price);
    this.lastTradeTime.set(symbol, tradeTime);
    const queue = this.queues.get(symbol) || [];
    queue.push(trade);
    this.queues.set(symbol, queue);
    this.prune(tradeTime);

    for (const event of this.events) {
      if (event.symbol !== symbol || event.reactionStatus !== 'PENDING') continue;
      if (tradeTime >= event.time + 30_000 && tradeTime <= event.time + 40_000) {
        event.reaction30sPct = ((price / event.signalPrice) - 1) * 100;
        event.reactionStatus = 'READY';
        this.onUpdate({...event});
      } else if (tradeTime > event.time + 40_000) {
        event.reactionStatus = 'N/A';
        this.onUpdate({...event});
      }
    }

    const snapshot = this.snapshot(symbol);
    for (const direction of ['BUY', 'SELL']) {
      const sideStats = snapshot[direction];
      const key = `${symbol}:${direction}`;
      const previous = this.crossings.get(key) || {above: false, lastSignal: 0};
      const above = sideStats.usd >= this.threshold;
      if (above && (!previous.above || tradeTime - previous.lastSignal >= this.cooldownMs)) {
        const opposite = snapshot[direction === 'BUY' ? 'SELL' : 'BUY'];
        const event = {
          id: `iex-${symbol}-${direction}-${tradeTime}-${++this.sequence}`,
          source: 'Alpaca IEX', kind: 'ESTIMATED_IEX_FLOW', symbol, index: IEX_LABELS[symbol],
          side: direction, time: tradeTime, windowSeconds: this.windowMs / 1000,
          startTime: tradeTime - this.windowMs, threshold: this.threshold,
          notional: sideStats.usd, qty: sideStats.shares, tradeCount: sideStats.trades,
          oppositeNotional: opposite.usd, netPressure: sideStats.usd - opposite.usd,
          unknownNotional: snapshot.UNKNOWN.usd, unknownTrades: snapshot.UNKNOWN.trades,
          totalTrades: snapshot.totalTrades, totalNotional: snapshot.totalUsd,
          vwap: sideStats.shares ? sideStats.usd / sideStats.shares : null,
          signalPrice: price, reaction30sPct: null, reactionStatus: 'PENDING',
        };
        this.events.unshift(event);
        if (this.events.length > 150) this.events.length = 150;
        this.crossings.set(key, {above: true, lastSignal: tradeTime});
        this.onSignal({...event});
      } else if (!above) {
        this.crossings.set(key, {above: false, lastSignal: previous.lastSignal});
      }
    }
  }

  snapshot(symbol) {
    const row = {BUY: {usd:0, shares:0, trades:0}, SELL: {usd:0,shares:0,trades:0}, UNKNOWN: {usd:0,shares:0,trades:0}};
    for (const trade of this.queues.get(symbol) || []) {
      const side = row[trade.side];
      side.usd += trade.notional;
      side.shares += trade.size;
      side.trades++;
    }
    return {...row,
      totalUsd: row.BUY.usd + row.SELL.usd + row.UNKNOWN.usd,
      totalTrades: row.BUY.trades + row.SELL.trades + row.UNKNOWN.trades,
      lastPrice: this.latestPrices.get(symbol) ?? null,
      lastTradeTime: this.lastTradeTime.get(symbol) ?? null,
    };
  }

  state() {
    return {
      threshold: this.threshold, windowSeconds: this.windowMs / 1000,
      snapshots: Object.fromEntries(IEX_SYMBOLS.map(s => [s, this.snapshot(s)])),
      events: this.events.map(e => ({...e})),
    };
  }
}

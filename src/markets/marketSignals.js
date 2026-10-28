/** US market price-momentum signals from 5-minute SPY/QQQ ETF candles.
 * NOT order-flow/whale signals: OHLCV data cannot establish aggressive taker side.
 * This module deliberately has no React/browser dependencies so it can be tested.
 */
export const MARKET_INSTRUMENTS = [
  { symbol: 'QQQ', index: 'NASDAQ-100', subtitle: 'Invesco QQQ ETF · Nasdaq-100 proxy' },
  { symbol: 'SPY', index: 'S&P 500', subtitle: 'SPDR S&P 500 ETF · S&P 500 proxy' },
];

export const MOMENTUM_THRESHOLD_PCT = 0.25;
export const VOLUME_SPIKE_MULTIPLIER = 1.5;
export const MARKET_POLL_MS = 5 * 60 * 1000;

export function nyNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
    weekday: p.weekday,
  };
}

export function isUsRegularSession(now = new Date()) {
  const t = nyNow(now);
  return !['Sat', 'Sun'].includes(t.weekday) && t.minutes >= 570 && t.minutes < 960;
}

// Input datetime is a New York local time string, as returned by Twelve Data.
export function formatEtTime(datetime) {
  if (!datetime || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(datetime)) return '—';
  return `${datetime.slice(11, 16)} ET · ${datetime.slice(0, 10)}`;
}

// A 5m price candle may be delayed by the provider. Do not represent it as tick-by-tick live.
export function normalizeBars(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(row => ({
      time: String(row.datetime || ''),
      open: Number(row.open), high: Number(row.high),
      low: Number(row.low), close: Number(row.close),
      volume: row.volume == null || row.volume === '' ? null : Number(row.volume),
    }))
    .filter(row => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.time) &&
      [row.open, row.high, row.low, row.close].every(x => Number.isFinite(x) && x > 0) &&
      (row.volume === null || (Number.isFinite(row.volume) && row.volume >= 0)))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function computeMarketSignals(symbol, values, thresholdPct = MOMENTUM_THRESHOLD_PCT) {
  if (!['SPY', 'QQQ'].includes(symbol)) return [];
  const candles = normalizeBars(values);
  const signals = [];
  let lastEmission = null;
  for (let i = 5; i < candles.length; i++) {
    const current = candles[i];
    const start = candles[i - 3];
    // Compare only candles in the same US market session/day.
    if (current.time.slice(0, 10) !== start.time.slice(0, 10)) continue;
    const startMinutes = Number(start.time.slice(11, 13)) * 60 + Number(start.time.slice(14, 16));
    const currentMinutes = Number(current.time.slice(11, 13)) * 60 + Number(current.time.slice(14, 16));
    // Never label a gap caused by missing bars as a 15-minute move.
    if (currentMinutes - startMinutes !== 15) continue;
    const changePct = ((current.close - start.close) / start.close) * 100;
    if (!Number.isFinite(changePct) || Math.abs(changePct) < thresholdPct) continue;
    const history = candles.slice(i - 5, i).filter(b => b.time.slice(0, 10) === current.time.slice(0, 10));
    const avgVolume = history.length === 5 && history.every(b => b.volume != null)
      ? history.reduce((sum, b) => sum + b.volume, 0) / 5 : null;
    const volumeRatio = avgVolume > 0 && current.volume != null ? current.volume / avgVolume : null;
    const side = changePct > 0 ? 'BUY' : 'SELL';
    // At most one new signal every 30 minutes per instrument and direction.
    if (lastEmission && lastEmission.side === side && lastEmission.time.slice(0, 10) === current.time.slice(0, 10)) {
      const previousMinutes = Number(lastEmission.time.slice(11, 13)) * 60 + Number(lastEmission.time.slice(14, 16));
      const currentMinutes = Number(current.time.slice(11, 13)) * 60 + Number(current.time.slice(14, 16));
      if (currentMinutes - previousMinutes < 30) continue;
    }
    const signal = {
      id: `${symbol}-${side}-${current.time}`,
      symbol,
      index: symbol === 'QQQ' ? 'NASDAQ-100' : 'S&P 500',
      side, time: current.time,
      price: current.close,
      previousPrice: start.close,
      changePct,
      volume: current.volume,
      // Total shares x price is estimated total ETF turnover (both sides), NEVER a BUY/SELL aggressor flow.
      turnoverUsd: current.volume == null ? null : current.volume * current.close,
      avgVolume,
      volumeRatio,
      volumeSpike: volumeRatio != null && volumeRatio >= VOLUME_SPIKE_MULTIPLIER,
      kind: 'PRICE_MOMENTUM',
      source: 'Twelve Data · 5-minute ETF OHLCV',
    };
    signals.push(signal);
    lastEmission = signal;
  }
  return signals;
}

export function latestSnapshot(symbol, bars) {
  const data = normalizeBars(bars);
  if (!data.length) return null;
  const bar = data.at(-1);
  const sessionStart = data.find(b => b.time.slice(0, 10) === bar.time.slice(0, 10));
  return {
    symbol,
    price: bar.close,
    time: bar.time,
    sessionChangePct: sessionStart ? ((bar.close - sessionStart.open) / sessionStart.open) * 100 : null,
    volume: bar.volume,
  };
}

export function formatChange(n) {
  return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
}

/** Exclude a still-forming five-minute candle in today's NY trading session. */
export function completedMarketBars(values, now = new Date()) {
  const t = nyNow(now);
  const currentBucket = Math.floor(t.minutes / 5) * 5;
  return normalizeBars(values).filter(bar => {
    if (bar.time.slice(0, 10) !== t.date) return true;
    const barMinutes = Number(bar.time.slice(11, 13)) * 60 + Number(bar.time.slice(14, 16));
    return barMinutes < currentBucket;
  });
}

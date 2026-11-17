export const COINS = ['BTC', 'ETH', 'BNB', 'USDC', 'XRP'];
export const WINDOWS = [['5m','5 minute',5],['15m','15 minute',15],['30m','30 minute',30],['1h','1 hour',60],['2h','2 hour',120],['4h','4 hour',240],['6h','6 hour',360],['8h','8 hour',480],['12h','12 hour',720],['24h','24 hour',1440],['7d','1 week',10080],['15d','15 day',21600],['30d','30 day',43200]];
export function finite(value) { return value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null; }
export function candleFlow(candles, minutes, now) {
  const step = minutes <= 720 ? 60000 : 3600000;
  const count = minutes * 60000 / step;
  const end = Math.floor(now / step) * step;
  const start = end - (count - 1) * step;
  const bars = new Map(candles.filter(c => Number(c[0]) >= start && Number(c[0]) <= end).map(c => [Number(c[0]),c]));
  if (bars.size !== count) return null;
  let net = 0;
  for (let at = start; at <= end; at += step) {
    const c = bars.get(at), total = finite(c?.[7]), buy = finite(c?.[10]);
    if (total === null || buy === null || total < 0 || buy < 0 || buy > total) return null;
    net += 2 * buy - total;
  }
  return net;
}
export function normalizeCoinGlass(data) {
  return COINS.map(symbol => {
    const row = data.find(d => d.symbol === symbol);
    return {symbol, marketCap: finite(row?.market_cap), values: Object.fromEntries(WINDOWS.map(([key]) => [key, finite(row?.[`net_flow_usd_${key}`])]))};
  });
}
export function usd(value, signed = true) {
  if (!Number.isFinite(value)) return '—';
  const n = Math.abs(value), unit = n >= 1e12 ? [1e12,'T'] : n >= 1e9 ? [1e9,'B'] : n >= 1e6 ? [1e6,'M'] : n >= 1e3 ? [1e3,'K'] : [1,''];
  return `${value < 0 ? '-' : signed && value > 0 ? '+' : ''}$${(n/unit[0]).toFixed(2)}${unit[1]}`;
}

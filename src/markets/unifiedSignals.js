/** A shared view-model only. No additional Binance or IEX WebSocket connections. */
export const IEX_MINIMUM_USD = 5_000_000;

export function buildUnifiedSignals({
  cryptoEvents = [], iexEvents = [], cryptoThreshold = 5_000_000,
  cryptoWindowSec = 60, query = '', sideFilter = 'ALL', marketFilter = 'ALL',
} = {}) {
  const search = String(query || '').trim().toUpperCase();
  const cryptoAllowed = marketFilter === 'ALL' || marketFilter === 'CRYPTO';
  const iexAllowed = marketFilter === 'ALL' || marketFilter === 'QQQ' || marketFilter === 'SPY';
  const rows = [];

  if (cryptoAllowed) {
    for (const event of cryptoEvents) {
      if (!event || !Number.isFinite(Number(event.notional)) || Number(event.notional) < cryptoThreshold || event.windowSec !== cryptoWindowSec) continue;
      if (sideFilter !== 'ALL' && event.side !== sideFilter) continue;
      if (search && !`${event.coin || ''} ${event.symbol || ''} CRYPTO BINANCE`.toUpperCase().includes(search)) continue;
      const time = Number(event.time);
      if (!Number.isFinite(time)) continue;
      rows.push({key:`crypto:${event.id}`, market:'CRYPTO', symbol:event.symbol, event, time});
    }
  }

  if (iexAllowed) {
    for (const event of iexEvents) {
      // IEX must always stay >= $5M and the fixed 60s window, regardless of crypto controls.
      if (!event || !['QQQ','SPY'].includes(event.symbol) || Number(event.notional) < IEX_MINIMUM_USD || !Number.isFinite(Number(event.notional)) || Number(event.windowSeconds) !== 60) continue;
      if (marketFilter !== 'ALL' && event.symbol !== marketFilter) continue;
      if (sideFilter !== 'ALL' && event.side !== sideFilter) continue;
      if (search && !`${event.index || ''} ${event.symbol || ''} ETF IEX`.toUpperCase().includes(search)) continue;
      const time = Number(event.time);
      if (!Number.isFinite(time)) continue;
      rows.push({key:`iex:${event.id}`, market:'IEX', symbol:event.symbol, event, time});
    }
  }

  return rows.sort((a,b) => b.time - a.time || a.key.localeCompare(b.key));
}

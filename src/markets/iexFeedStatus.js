/** Browser-side diagnostic text. A connected WebSocket does not mean trades
 * or $5M directional turnover have actually been received.
 */
export function explainIexFeed({configured, connected, subscribed, error, feedDiagnostics, snapshots},
  isRegularHours, nowMs = Date.now()) {
  if (!configured) return 'Setup required: provide your Alpaca API credentials on the local server.';
  if (error) return `Provider/stream warning: ${error}`;
  if (!connected || !subscribed) return 'Not fully subscribed: verify Alpaca authentication and QQQ/SPY trades + quotes subscriptions.';
  const lastTradeMs = Date.parse(feedDiagnostics?.lastTradeFrameAt || '');
  const ageSeconds = Number.isFinite(lastTradeMs) ? Math.floor((nowMs - lastTradeMs) / 1000) : null;
  if (!isRegularHours) {
    return 'Outside the regular US trading session (9:30 AM–4:00 PM New York time). IEX can stay connected with no QQQ/SPY prints; the 60-second totals legitimately show $0.';
  }
  if (ageSeconds == null || ageSeconds > 120) {
    return 'IEX is subscribed, but no QQQ/SPY trade prints arrived in the last 2 minutes. Connection alone does not produce signals. Check the live feed during regular US trading hours.';
  }
  const observed = ['QQQ', 'SPY'].map(s => snapshots?.[s]?.totalUsd || 0);
  if (observed.every(v => v === 0)) {
    return 'Trades were received previously, but there are no prints in the current rolling 60-second window.';
  }
  return 'IEX trade prints are arriving. A signal appears ONLY when estimated BUY or SELL (separately) reaches $5,000,000 within one rolling 60-second window.';
}

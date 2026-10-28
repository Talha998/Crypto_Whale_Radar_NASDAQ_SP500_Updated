import React, {useEffect, useMemo, useRef, useState} from 'react';
import {IEX_DEFAULT_THRESHOLD, IEX_MIN_THRESHOLD, IEX_LABELS, IEX_SYMBOLS, normalizeIexThreshold} from './iexFlowEngine.js';
import {isUsRegularSession} from './marketSignals.js';
import {explainIexFeed} from './iexFeedStatus.js';
import {formatPakistanTime, formatPakistanDate, formatPakistanDateTime} from './pakistanTime.js';
import {
  getIexSessionSignals, getSignalClearTime, mergeSessionSignals,
  saveIexSessionSignals,
} from './signalSessionHistory.js';
import './iex-flow.css';

const EMPTY = {
  configured: false, connected: false, subscribed: false, error: '', threshold: IEX_DEFAULT_THRESHOLD,
  snapshots: {}, events: [], windowSeconds: 60,
};

const money = n => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n), abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1e9) return `${prefix}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${prefix}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${prefix}${(abs / 1e3).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
};
const number = n => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', {maximumFractionDigits: 0});
const price = n => n == null || !Number.isFinite(Number(n)) ? '—' : `$${Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 4})}`;
const clock = formatPakistanTime;
const pct = n => Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(3)}%` : '—';
const zero = {usd: 0, trades: 0, shares: 0};

function Detail({label, value, variant}) {
  return <div className="info"><span>{label}</span><strong className={variant === 'buy' ? 'green' : variant === 'sell' ? 'red' : ''}>{value}</strong></div>;
}

export default function IexTradeFlowPanel({alarmEnabled, onIexSignal, onFeedStateChange, clearEpoch = 0, compact = false}) {
  const [state, setState] = useState(() => ({...EMPTY, events: getIexSessionSignals()}));
  const [connection, setConnection] = useState('connecting');
  // Share the existing SSE feed with the unified list; never open a second Alpaca stream.
  useEffect(() => { onFeedStateChange?.(state); }, [state, onFeedStateChange]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const [filter, setFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState(null);
  const alertRef = useRef(onIexSignal);
  const armedRef = useRef(alarmEnabled);
  const seenRef = useRef(new Set(getIexSessionSignals().map(event => event.id)));
  const lastClearRef = useRef(clearEpoch);
  useEffect(() => { alertRef.current = onIexSignal; armedRef.current = alarmEnabled; }, [onIexSignal, alarmEnabled]);

  // A manual clear only removes signal HISTORY. It never stops live monitoring.
  useEffect(() => {
    if (lastClearRef.current === clearEpoch) return;
    lastClearRef.current = clearEpoch;
    seenRef.current.clear();
    setState(prev => ({...prev, events: []}));
  }, [clearEpoch]);

  useEffect(() => {
    saveIexSessionSignals(state.events);
  }, [state.events]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setConnection('unsupported');
      return;
    }
    const eventSource = new EventSource('/api/iex-flow');
    const parse = fn => message => {
      try { fn(JSON.parse(message.data)); }
      catch (error) { console.warn('IEX message parsing:', error); }
    };
    const snapshotHandler = parse(data => {
      // A server snapshot holds only recent signals. Merge it with this tab's
      // saved signals rather than overwriting older events after a refresh.
      setState(prev => ({...data, events: mergeSessionSignals(prev.events, data.events, getSignalClearTime())}));
      // Restored / snapshot events are never played again as new alarms.
      data.events?.forEach(event => seenRef.current.add(event.id));
      setConnection('connected');
    });
    const signalHandler = parse(event => {
      // Do not surface or alarm on sub-$5M events, including a stale old server tab.
      if (!Number.isFinite(Number(event.notional)) || Number(event.notional) < IEX_MIN_THRESHOLD) return;
      if (Number(event.time) <= getSignalClearTime()) return;
      setState(prev => ({...prev, events: mergeSessionSignals(prev.events, [event], getSignalClearTime())}));
      if (!seenRef.current.has(event.id)) {
        seenRef.current.add(event.id);
        if (armedRef.current) alertRef.current?.(event);
      }
    });
    const updateHandler = parse(event => {
      if (Number(event.time) <= getSignalClearTime()) return;
      setState(prev => ({...prev,
        events: prev.events.map(x => x.id === event.id
          ? mergeSessionSignals([x], [event], getSignalClearTime())[0] || x : x),
      }));
    });
    eventSource.addEventListener('snapshot', snapshotHandler);
    eventSource.addEventListener('signal', signalHandler);
    eventSource.addEventListener('update', updateHandler);
    eventSource.onerror = () => setConnection('reconnecting');
    return () => eventSource.close();
  }, []);

  const signalMinimum = normalizeIexThreshold(state.threshold);
  const events = useMemo(() => (state.events || []).filter(e =>
    Number.isFinite(Number(e.notional)) && Number(e.notional) >= signalMinimum &&
    (filter === 'ALL' || e.symbol === filter),
  ), [state.events, filter, signalMinimum]);
  const selected = events.find(e => e.id === selectedId) || events[0] || null;
  const active = state.connected && connection === 'connected';
  const inRegularHours = isUsRegularSession(new Date(now));
  const latestFrame = state.feedDiagnostics?.lastTradeFrameAt;
  const lastTradeAge = latestFrame ? Math.max(0, Math.floor((now - Date.parse(latestFrame)) / 1000)) : null;
  const freshPrints = active && lastTradeAge != null && lastTradeAge <= 120;
  const displayStatus = active
    ? (freshPrints ? '● IEX PRINTS RECEIVED' : '● IEX CONNECTED · NO RECENT PRINTS')
    : state.configured ? '○ IEX DISCONNECTED' : '○ SETUP REQUIRED';
  const reason = explainIexFeed(state, inRegularHours, now);

  if (compact) {
    return <section className="iex-compact" aria-label="NASDAQ and S&P market feed diagnostics">
      <details>
        <summary><strong>NASDAQ-100 / S&amp;P 500 live feed diagnostics</strong><span className={active ? 'green' : 'muted'}>{displayStatus}</span></summary>
        <div className="iex-compact-body">
          <p>QQQ/SPY trade signals are displayed above together with the 50 crypto coins. IEX estimates are not Binance aggressive executions or identified whale traders.</p>
          {!state.configured && <div className="iex-setup">Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to your private local .env file and restart npm run dev.</div>}
          {!!state.error && <div className="iex-feed-error">{state.error}</div>}
          <div className="iex-feed-health"><strong>{inRegularHours ? 'US regular trading window' : 'Outside regular US market hours'}</strong><p>{reason}</p>
            <div className="iex-health-stats"><span>Trade frames: <b>{number(state.feedDiagnostics?.tradeFrames ?? 0)}</b></span><span>Quote frames: <b>{number(state.feedDiagnostics?.quoteFrames ?? 0)}</b></span><span>Last print: <b>{latestFrame ? formatPakistanDateTime(latestFrame) : 'None'}</b></span></div>
          </div>
          <div className="iex-ticker-cards">{IEX_SYMBOLS.map(symbol => {
            const snap = state.snapshots?.[symbol];
            const buy = snap?.BUY || zero, sell = snap?.SELL || zero, unknown = snap?.UNKNOWN || zero;
            return <div key={symbol} className="iex-ticker">
              <div className="iex-ticker-top"><h3>{IEX_LABELS[symbol]} ({symbol})</h3><span className="iex-mini-label">IEX ONLY</span></div>
              <div className="iex-two-numbers"><div><small>Est. BUY / 60s</small><strong className="green">{money(buy.usd)}</strong><span>{number(buy.trades)} prints</span></div><div><small>Est. SELL / 60s</small><strong className="red">{money(sell.usd)}</strong><span>{number(sell.trades)} prints</span></div></div>
              <div className="iex-ticker-stat"><span>Unknown / unclassified</span><strong>{money(unknown.usd)} · {number(unknown.trades)} prints</strong></div>
            </div>;
          })}</div>
        </div>
      </details>
    </section>;
  }

  return (
    <section className="iex-panel" aria-label="Free IEX ETF estimated trade flow">
      <header className="iex-head">
        <div>
          <div className="eyebrow">TRADE-BY-TRADE ETF PRINTS · ALPACA BASIC IEX</div>
          <h2>NASDAQ-100 &amp; S&amp;P 500 Trade Pressure</h2>
          <p>Real IEX execution prints for <strong>QQQ</strong> and <strong>SPY</strong>, with <strong>estimated</strong> BUY / SELL initiator sides inferred from timely bid/ask quotes.</p>
        </div>
        <div className="iex-badges">
          <span className={`iex-live-pill ${active ? 'live' : ''}`}>{displayStatus}</span>
          <small>PKT display times · 60s rolling window · minimum BUY/SELL pressure {money(signalMinimum)} · server calculates signals</small>
        </div>
      </header>

      <div className="iex-warning">
        <strong>IEX LIMITED-EXCHANGE ESTIMATES — NOT VERIFIED WHALE TRADES.</strong> This free feed covers only the IEX exchange, not Nasdaq-100 / S&amp;P 500 index executions, all US venues, or NQ/ES futures. A print at/above a recent ask is classified as <b>estimated BUY</b>; at/below the bid as <b>estimated SELL</b>. Trades without a reliable quote remain <b>UNKNOWN</b>. Counts are executions, <em>not numbers of people</em>. Corrected/cancelled trades may change the actual flow. Markets can be closed or quiet.
      </div>

      {!state.configured && <div className="iex-setup" role="status">
        <strong>Connect Alpaca Free (IEX) trade-level feed</strong>
        <p>Add <code>ALPACA_API_KEY_ID</code> and <code>ALPACA_API_SECRET_KEY</code> to your local <code>.env</code> file (NOT prefixed with <code>VITE_</code>), then restart <code>npm run dev</code>. These credentials stay on your local Node server.</p>
        <a href="https://app.alpaca.markets/" target="_blank" rel="noreferrer">Open Alpaca dashboard ↗</a>
      </div>}
      {!!state.error && <div className="iex-feed-error" role="status">{state.error}</div>}
      {connection === 'reconnecting' && <div className="iex-feed-error" role="status">Local stream connection dropped; reconnecting…</div>}

      <div className="iex-feed-health" role="status">
        <strong>{inRegularHours ? 'US regular trading time window' : 'Outside regular US trading hours'}</strong>
        <p>{reason}</p>
        <div className="iex-health-stats">
          <span>IEX trade frames received since server start: <b>{number(state.feedDiagnostics?.tradeFrames ?? 0)}</b></span>
          <span>IEX quote frames received since server start: <b>{number(state.feedDiagnostics?.quoteFrames ?? 0)}</b></span>
          <span>Last received trade: <b>{latestFrame ? formatPakistanDateTime(latestFrame) : 'None'}</b></span>
        </div>
        <small>These counts do not represent people. IEX stream access can be healthy while the market is quiet. Market holidays/halts can also stop prints. Crypto signals are independent.</small>
      </div>

      <div className="iex-minimum-note" role="note">
        <strong>Signal minimum: {money(signalMinimum)} per BUY or SELL side within 60 seconds.</strong>
        {' '}Smaller prints and pressure totals remain visible in live diagnostics but will NOT generate a signal or alarm. US IEX Basic covers only one exchange; $5M quote-classified events may be rare.
      </div>

      <div className="iex-ticker-cards">
        {IEX_SYMBOLS.map(symbol => {
          const snap = state.snapshots?.[symbol];
          const buy = snap?.BUY || zero, sell = snap?.SELL || zero, unknown = snap?.UNKNOWN || zero;
          const net = buy.usd - sell.usd;
          return <div key={symbol} className="iex-ticker">
            <div className="iex-ticker-top"><div><span className="eyebrow">{symbol} · ETF PROXY</span><h3>{IEX_LABELS[symbol]}</h3></div><span className="iex-mini-label">IEX ONLY</span></div>
            <div className="iex-two-numbers"><div><small>EST. BUY · 60s</small><strong className="green">{money(buy.usd)}</strong><span>{number(buy.trades)} prints</span></div><div><small>EST. SELL · 60s</small><strong className="red">{money(sell.usd)}</strong><span>{number(sell.trades)} prints</span></div></div>
            <div className="iex-ticker-stat"><span>Est. net classified pressure</span><strong className={net >= 0 ? 'green' : 'red'}>{money(net)}</strong></div>
            <div className="iex-ticker-stat"><span>Unclassified / unknown (60s)</span><strong>{money(unknown.usd)} · {number(unknown.trades)} prints</strong></div>
            <div className="iex-ticker-stat"><span>Last observed IEX trade</span><strong>{clock(snap?.lastTradeTime)} · {price(snap?.lastPrice)}</strong></div>
          </div>;
        })}
      </div>

      <div className="iex-section-bar">
        <div><div className="eyebrow">IEX LIVE ROLLING ESTIMATED TRADE SIGNALS</div><h3>NASDAQ-100 &amp; S&amp;P 500 monitored ETFs</h3></div>
        <div className="iex-filters" aria-label="Filter IEX events">{['ALL', 'QQQ', 'SPY'].map(v => <button key={v} type="button" onClick={() => setFilter(v)} aria-pressed={filter === v} className={filter === v ? 'selected' : ''}>{v === 'ALL' ? 'All' : v === 'QQQ' ? 'NASDAQ-100' : 'S&P 500'}</button>)}</div>
      </div>
      <div className="grid iex-event-grid">
        <div className="card feed-card">
          <div className="section-head"><div><div className="eyebrow">NEWEST IEX SIGNALS FIRST</div><h2>ETF Trade Signals</h2></div><span className="muted">{events.length} signals</span></div>
          <div className="feed iex-event-feed">
            {!events.length && <div className="empty">{!state.configured ? 'Connect Alpaca credentials to start actual trade-stream monitoring.' : active ? `Waiting for at least ${money(signalMinimum)} of IEX-estimated BUY or SELL pressure in 60 seconds. Smaller events are not shown. Free IEX-only volume may rarely reach this minimum.` : 'Waiting for IEX subscription. Check credentials, US market hours and connection status.'}</div>}
            {events.map(event => <button key={event.id} type="button" className={`trade-row iex-trade-row ${selected?.id === event.id ? 'selected' : ''}`} aria-pressed={selected?.id === event.id} onClick={() => setSelectedId(event.id)}>
              <div className="coin-cell"><strong className="coin">{event.index}</strong><small>{event.symbol} · IEX ETF</small></div>
              <div><strong>{clock(event.time)}</strong><small>{formatPakistanDate(event.time)} · 60s rolling window</small></div>
              <div><span className={`pill ${event.side.toLowerCase()}`}>EST. {event.side} PRESSURE</span><small>{number(event.tradeCount)} classified prints</small></div>
              <div><strong>{number(event.qty)} shares</strong><small>VWAP @ {price(event.vwap)}</small></div>
              <div className="right"><strong>{money(event.notional)}</strong><small>EST. IEX PRESSURE</small></div>
              <div className="right"><strong className={event.reaction30sPct >= 0 ? 'green' : event.reaction30sPct < 0 ? 'red' : ''}>{event.reactionStatus === 'READY' ? pct(event.reaction30sPct) : event.reactionStatus === 'PENDING' ? 'Pending' : 'N/A'}</strong><small>30s reaction</small></div>
            </button>)}
          </div>
        </div>
        <aside className="card impact-card iex-detail" aria-label="Selected IEX trade signal details">
          <div className="eyebrow">SELECTED IEX QUOTE-CLASSIFIED FLOW EVENT</div>
          <h2>{selected ? `${selected.index} · ${selected.side}` : 'Waiting for ETF pressure'}</h2>
          {selected ? <>
            <div className={`whale-banner ${selected.side.toLowerCase()}`}><span>ESTIMATED · IEX · {selected.windowSeconds}s</span><strong>{money(selected.notional)}</strong></div>
            <div className="iex-detail-note">Trade amounts are real IEX prints. BUY/SELL classification is inferred, not published aggressor side. A trade has a buyer and a seller; neither unique investors nor actual whales are identified.</div>
            <div className="impact-grid">
              <Detail label="Index proxy" value={selected.index} />
              <Detail label="Tracked ETF" value={selected.symbol} />
              <Detail label="Estimated pressure side" value={selected.side} variant={selected.side.toLowerCase()} />
              <Detail label="Quote-classified side volume" value={money(selected.notional)} />
              <Detail label="Opposite classified side" value={money(selected.oppositeNotional)} />
              <Detail label="Estimated net classified pressure" value={money(selected.netPressure)} variant={selected.netPressure >= 0 ? 'buy' : 'sell'} />
              <Detail label="Quote-classified prints" value={number(selected.tradeCount)} />
              <Detail label="Classified shares" value={`${number(selected.qty)} shares`} />
              <Detail label="VWAP of classified prints" value={price(selected.vwap)} />
              <Detail label="Signal trade price" value={price(selected.signalPrice)} />
              <Detail label="Unknown/unclassified prints" value={number(selected.unknownTrades)} />
              <Detail label="Unknown/unclassified notional" value={money(selected.unknownNotional)} />
              <Detail label="Total observed IEX prints" value={number(selected.totalTrades)} />
              <Detail label="Observed total IEX turnover" value={money(selected.totalNotional)} />
              <Detail label="Window start (Pakistan)" value={formatPakistanDateTime(selected.startTime)} />
              <Detail label="Signal time (Pakistan)" value={formatPakistanDateTime(selected.time)} />
              <Detail label="30s observed reaction" value={selected.reactionStatus === 'READY' ? pct(selected.reaction30sPct) : selected.reactionStatus === 'PENDING' ? 'Pending...' : 'N/A'} />
              <Detail label="Data source" value="Alpaca Basic · IEX trades + quotes" />
            </div>
            <div className="interpretation"><strong>WHAT THIS SIGNAL MEANS</strong><p>{selected.symbol}: {number(selected.tradeCount)} IEX prints were <em>estimated</em> as {selected.side}-initiated, totaling {money(selected.notional)} during a rolling 60-second window. Actual investor counts and consolidated US-market side pressure are unavailable on the free IEX plan.</p></div>
          </> : <div className="empty">No {money(signalMinimum)}+ classified IEX BUY/SELL signal yet. The minimum cannot be lowered below $5M. Lower IEX-only volumes are not whale-pressure signals.</div>}
        </aside>
      </div>
      <p className="iex-footer">Only local browser tabs connected to this Vite server show the feed. The Node stream runs while <code>npm run dev</code> remains active. Desktop audio/notification alarms require the existing Signal laptop alarm to be enabled and this page running. Signals are not investment advice and are not exchange-reported aggressive order flow.</p>
    </section>
  );
}

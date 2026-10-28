import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MARKET_INSTRUMENTS, MARKET_POLL_MS, MOMENTUM_THRESHOLD_PCT,
  completedMarketBars, computeMarketSignals, latestSnapshot,
  isUsRegularSession, nyNow, formatChange,
} from './marketSignals.js';
import {formatPakistanTime, formatPakistanDate, formatPakistanDateTime} from './pakistanTime.js';
import './market.css';

const fmtPrice = value => Number.isFinite(value)
  ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtNumber = value => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'Unavailable';
const fmtMoney = value => {
  if (!Number.isFinite(value)) return 'Unavailable';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return fmtPrice(value);
};
const fmtTime = formatPakistanTime;

const initialState = Object.fromEntries(MARKET_INSTRUMENTS.map(x => [x.symbol, {
  loading: true, configured: true, error: '', snapshot: null, signals: [], lastBar: '', stale: false,
}]));

function isRecentFinishedCandle(signal, now) {
  if (!signal || !isUsRegularSession(now)) return false;
  const t = nyNow(now);
  if (signal.time.slice(0, 10) !== t.date) return false;
  const barMinutes = Number(signal.time.slice(11, 13)) * 60 + Number(signal.time.slice(14, 16));
  return t.minutes - (barMinutes + 5) >= 0 && t.minutes - (barMinutes + 5) <= 15;
}

function Detail({ label, value, positive, negative }) {
  return <div className="info"><span>{label}</span><strong className={positive ? 'green' : negative ? 'red' : ''}>{value}</strong></div>;
}

export default function MarketIndicesPanel({ alarmEnabled, onMarketSignal }) {
  const [markets, setMarkets] = useState(initialState);
  const [now, setNow] = useState(() => new Date());
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastSeenIds = useRef(new Set());
  const initialized = useRef(new Set());
  const notifyRef = useRef(onMarketSignal);
  const armedRef = useRef(alarmEnabled);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => { notifyRef.current = onMarketSignal; }, [onMarketSignal]);
  useEffect(() => { armedRef.current = alarmEnabled; }, [alarmEnabled]);

  useEffect(() => {
    mounted.current = true;
    const refresh = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (mounted.current) setRefreshing(true);
      try {
        await Promise.all(MARKET_INSTRUMENTS.map(async instrument => {
          try {
            const response = await fetch(`/api/market-candles?symbol=${encodeURIComponent(instrument.symbol)}`, {
              headers: { Accept: 'application/json' },
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || `US market data HTTP ${response.status}`);
            if (!body.configured) {
              if (mounted.current) setMarkets(prev => ({ ...prev, [instrument.symbol]: {
                loading: false, configured: false, error: body.message || 'Free API key required',
                snapshot: null, signals: [], lastBar: '', stale: false,
              }}));
              return;
            }
            // This is completed ETF OHLCV, NOT trade-by-trade aggressor flow.
            const finished = completedMarketBars(body.bars || [], new Date());
            const snapshot = latestSnapshot(instrument.symbol, finished);
            const fullSignals = computeMarketSignals(instrument.symbol, finished);
            const session = snapshot?.time.slice(0, 10);
            const sessionSignals = fullSignals.filter(s => s.time.slice(0, 10) === session).slice(-40).reverse();
            const id = instrument.symbol;
            // The first load is historical; do not ring for historical signals.
            if (!initialized.current.has(id)) {
              fullSignals.forEach(s => lastSeenIds.current.add(s.id));
              initialized.current.add(id);
            } else if (!body.stale && armedRef.current) {
              for (const signal of fullSignals) {
                if (!lastSeenIds.current.has(signal.id) && isRecentFinishedCandle(signal, new Date())) {
                  notifyRef.current?.(signal);
                }
              }
            }
            fullSignals.forEach(s => lastSeenIds.current.add(s.id));
            if (lastSeenIds.current.size > 500) lastSeenIds.current = new Set(fullSignals.map(s => s.id));

            if (mounted.current) setMarkets(prev => ({ ...prev, [id]: {
              loading: false, configured: true, error: body.error || '', snapshot,
              signals: sessionSignals, lastBar: snapshot?.time || '', stale: Boolean(body.stale),
            }}));
          } catch (error) {
            if (mounted.current) setMarkets(prev => ({ ...prev, [instrument.symbol]: {
              ...prev[instrument.symbol], loading: false,
              error: error.message || 'No US stock market data available', stale: true,
            }}));
          }
        }));
      } finally {
        inFlight.current = false;
        if (mounted.current) setRefreshing(false);
      }
    };

    refresh();
    const interval = setInterval(refresh, MARKET_POLL_MS);
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => { mounted.current = false; clearInterval(interval); clearInterval(clock); };
  }, []);

  const allSignals = useMemo(() => MARKET_INSTRUMENTS.flatMap(i => markets[i.symbol]?.signals || [])
    .filter(signal => activeFilter === 'ALL' || signal.symbol === activeFilter)
    .sort((a, b) => b.time.localeCompare(a.time)), [markets, activeFilter]);
  const selected = allSignals.find(s => s.id === selectedId) || allSignals[0] || null;
  const regularSession = isUsRegularSession(now);
  const pendingSetup = Object.values(markets).some(m => !m.configured);

  return (
    <section className="us-markets" aria-label="NASDAQ-100 and S&P 500 ETF signal analysis">
      <header className="us-heading">
        <div>
          <div className="eyebrow">US EQUITY MARKETS · NASDAQ-100 / S&amp;P 500</div>
          <h2>NASDAQ &amp; S&amp;P 500 BUY / SELL Signals</h2>
          <p>Same selectable signal-feed and details layout as Crypto Whale Radar. US signals are <strong>QQQ / SPY ETF price/volume proxies</strong>, not verified whale trades.</p>
        </div>
        <div className="us-state">
          <span className={regularSession ? 'us-session-open' : 'us-session-closed'}>{regularSession ? '● US REGULAR SESSION' : '○ OUTSIDE US SESSION HOURS'}</span>
          <small>{refreshing ? 'Checking ETF candles…' : '5-minute checks · data may be delayed'}</small>
        </div>
      </header>
      <div className="us-note" role="note">
        <strong>REAL BUY/SELL WHALES ARE NOT PROVIDED BY THIS FREE FEED.</strong> QQQ tracks NASDAQ-100 and SPY tracks S&amp;P 500. A BUY or SELL label means an ETF price move of at least ±{MOMENTUM_THRESHOLD_PCT.toFixed(2)}% over 15 minutes, <strong>not identified buy/sell executions</strong>. Dollar turnover = 5-minute traded shares × candle close (estimated total turnover, NOT buy-side or sell-side dollars). Trade count, large traders, true VWAP, opposite-side and net order flow cannot be determined from OHLCV candles.
      </div>

      <div className="us-market-cards">
        {MARKET_INSTRUMENTS.map(instrument => {
          const m = markets[instrument.symbol];
          const snapshot = m?.snapshot;
          const headline = m?.signals?.[0];
          const isToday = snapshot && snapshot.time.slice(0, 10) === nyNow(now).date;
          return (
            <article className="us-market-card" key={instrument.symbol}>
              <div className="us-market-title">
                <div><span className="us-market-ticker">{instrument.symbol}</span><h3>{instrument.index}</h3><small>{instrument.subtitle}</small></div>
                <span className="us-feed-pill">ETF · 5m DATA</span>
              </div>
              {!m.configured ? (
                <div className="us-placeholder">
                  <strong>Free market feed setup required</strong>
                  <span>Put your Twelve Data key in <code>.env</code> as <code>TWELVEDATA_API_KEY=...</code>, then restart <code>npm run dev</code>.</span>
                  <a href="https://twelvedata.com/pricing" target="_blank" rel="noreferrer">Twelve Data plans ↗</a>
                </div>
              ) : (
                <>
                  <div className="us-price-line"><strong>{snapshot ? fmtPrice(snapshot.price) : '—'}</strong>
                    <span className={`us-pct ${snapshot?.sessionChangePct >= 0 ? 'us-up' : 'us-down'}`}>{snapshot ? formatChange(snapshot.sessionChangePct) : '—'}</span>
                  </div>
                  <div className="us-market-meta"><span>ETF price (not index points)</span><span>{snapshot ? (isToday ? 'Latest session' : 'Previous session') : 'No candles'}</span></div>
                  <div className="us-market-time">Last completed candle: {snapshot ? formatPakistanDateTime(snapshot.time) : 'Waiting for data'} {m.stale ? '· STALE FEED' : ''}</div>
                  <div className="us-market-summary"><span>Latest price-direction signal</span><strong className={headline?.side === 'BUY' ? 'us-up' : 'us-down'}>{headline ? `${headline.side} MOMENTUM · ${formatChange(headline.changePct)}` : 'None in latest session'}</strong></div>
                  <div className="us-market-summary"><span>5m share turnover (all sides)</span><strong>{headline ? fmtMoney(headline.turnoverUsd) : '—'}</strong></div>
                  {m.loading && <div className="us-status-text">Loading {instrument.symbol} candles…</div>}
                  {!!m.error && <div className="us-status-text us-error" role="status">{m.error}</div>}
                  {!m.loading && !snapshot && !m.error && <div className="us-status-text">No verified ETF candles available.</div>}
                </>
              )}
            </article>
          );
        })}
      </div>

      <div className="us-list-header">
        <div><div className="eyebrow">ETF PRICE-MOMENTUM SIGNALS · NOT EXCHANGE WHALE FLOW</div><h3>NASDAQ-100 &amp; S&amp;P 500 signal history</h3></div>
        <div className="us-filters" aria-label="Filter US market events">
          {['ALL', 'QQQ', 'SPY'].map(choice => (
            <button type="button" key={choice} aria-pressed={activeFilter === choice} className={activeFilter === choice ? 'us-active' : ''} onClick={() => setActiveFilter(choice)}>
              {choice === 'ALL' ? 'All signals' : choice === 'QQQ' ? 'NASDAQ-100' : 'S&P 500'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid us-event-grid">
        <div className="card feed-card">
          <div className="section-head">
            <div><div className="eyebrow">LATEST ETF BUY / SELL MOMENTUM</div><h2>Market signals</h2></div>
            <span className="muted">Newest first · {allSignals.length} shown</span>
          </div>
          <div className="feed us-trade-feed" aria-label="Select NASDAQ or S&P price signal">
            {!allSignals.length && <div className="empty">
              <div><strong>{pendingSetup ? 'Configure your Twelve Data API key' : 'No qualifying NASDAQ / S&P signals'}</strong>
                <p>{pendingSetup ? 'Market data has not been connected yet.' : 'No ±0.25% 15-minute momentum event in the latest accessible trading session. Check provider access and market hours.'}</p>
              </div>
            </div>}
            {allSignals.map(s => (
              <button type="button" key={s.id} className={`trade-row us-momentum-row ${selected?.id === s.id ? 'selected' : ''}`} aria-pressed={selected?.id === s.id} onClick={() => setSelectedId(s.id)}>
                <div className="coin-cell"><strong className="coin">{s.index}</strong><small>{s.symbol} · ETF</small></div>
                <div><strong>{fmtTime(s.time)}</strong><small>{formatPakistanDate(s.time)} · 15m price window</small></div>
                <div><span className={`pill ${s.side.toLowerCase()}`}>{s.side} MOMENTUM</span><small>Price direction, not trade side</small></div>
                <div><strong>{fmtNumber(s.volume)} shares</strong><small>5m volume · close {fmtPrice(s.price)}</small></div>
                <div className="right"><strong>{fmtMoney(s.turnoverUsd)}</strong><small>EST. 5m TOTAL TURNOVER</small></div>
                <div className="right"><strong className={s.side === 'BUY' ? 'green' : 'red'}>{formatChange(s.changePct)}</strong><small>15m ETF return</small></div>
              </button>
            ))}
          </div>
        </div>

        <aside className="card impact-card us-detail" aria-label="Selected US equity signal detail">
          <div className="eyebrow">SELECTED US MARKET SIGNAL · ETF PRICE PROXY</div>
          <h2>{selected ? `${selected.index} · ${selected.side}` : 'Waiting for price signal'}</h2>
          {selected ? <>
            <div className={`whale-banner ${selected.side.toLowerCase()}`}>
              <span>{selected.side} MOMENTUM · 15m</span>
              <strong>{formatChange(selected.changePct)}</strong>
            </div>
            <div className="us-detail-warning">5m turnover is <strong>both sides combined</strong>. Not aggressive BUY/SELL whale pressure or a count of investors.</div>
            <div className="impact-grid">
              <Detail label="Market" value={selected.index} />
              <Detail label="ETF" value={selected.symbol} />
              <Detail label="Price direction" value={`${selected.side} MOMENTUM`} positive={selected.side === 'BUY'} negative={selected.side === 'SELL'} />
              <Detail label="15m price movement" value={formatChange(selected.changePct)} positive={selected.changePct >= 0} negative={selected.changePct < 0} />
              <Detail label="Estimated 5m TOTAL turnover" value={fmtMoney(selected.turnoverUsd)} />
              <Detail label="5m shares traded (all sides)" value={fmtNumber(selected.volume)} />
              <Detail label="Aggressive BUY volume" value="Not available" />
              <Detail label="Aggressive SELL volume" value="Not available" />
              <Detail label="Net aggressive pressure" value="Not available" />
              <Detail label="Aggressive trade count" value="Not available" />
              <Detail label="Exchange execution VWAP" value="Not available" />
              <Detail label="ETF candle close / signal price" value={fmtPrice(selected.price)} />
              <Detail label="Comparison close (15m earlier)" value={fmtPrice(selected.previousPrice)} />
              <Detail label="Relative volume (5m vs last 5)" value={selected.volumeRatio == null ? 'Not available' : `${selected.volumeRatio.toFixed(2)}×`} />
              <Detail label="Signal timestamp (Pakistan)" value={formatPakistanDateTime(selected.time)} />
              <Detail label="Underlying source" value="Twelve Data · QQQ/SPY 5m OHLCV" />
            </div>
            <div className="interpretation">
              <strong>{selected.side === 'BUY' ? 'UPWARD ETF PRICE MOMENTUM' : 'DOWNWARD ETF PRICE MOMENTUM'}</strong>
              <p>{selected.symbol} moved {formatChange(selected.changePct)} in 15 minutes. Its latest 5-minute candle reported {fmtNumber(selected.volume)} shares and an approximate <strong>{fmtMoney(selected.turnoverUsd)}</strong> in total turnover (volume × closing price).</p>
              <p className="muted">Every executed stock trade has a buyer AND a seller. OHLCV bars cannot reveal who initiated trades, how many people traded, whale identities or genuine net buying. For crypto-style aggressor-side dollars and contract counts on NQ/ES futures, a suitable exchange trade-level feed would be necessary.</p>
            </div>
          </> : <div className="empty">No ETF price-direction signal yet. The Binance top-50 crypto whale feed above is unchanged.</div>}
        </aside>
      </div>
      <div className="us-footer">Updates use completed 5-minute ETF bars and may arrive late on a free plan. Browser notifications work only while the web page is active and the alarm is enabled. Genuine futures order-flow and individual trader counts are not available through this feed.</div>
    </section>
  );
}

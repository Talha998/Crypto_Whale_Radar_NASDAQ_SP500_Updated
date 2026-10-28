import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import MarketIndicesPanel from './markets/MarketIndicesPanel.jsx';
import IexTradeFlowPanel from './markets/IexTradeFlowPanel.jsx';
import {formatPakistanTime, formatPakistanDateTime} from './markets/pakistanTime.js';
import {buildUnifiedSignals} from './markets/unifiedSignals.js';
import {
  getCryptoSessionSignals,
  getSignalClearTime,
  getSignalStorageWarning,
  saveCryptoSessionSignals,
  clearAllSessionSignals,
} from './markets/signalSessionHistory.js';

const DEFAULT_THRESHOLD = 5_000_000;
const DEFAULT_WINDOW = 60;
const MAX_WINDOW_MS = 60_000;
const SIGNAL_COOLDOWN_MS = 60_000;
const TOP_MARKET_LIMIT = 50;
const REST_BASE = import.meta.env.VITE_BINANCE_REST_BASE || 'https://api.binance.com';
const WS_URL = import.meta.env.VITE_BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws';
const FUTURES_REST_BASE = import.meta.env.VITE_BINANCE_FUTURES_REST_BASE || 'https://fapi.binance.com';

function money(v, max = 2) {
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: max,
  }).format(v);
}

function compactUsd(v) {
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const x = Math.abs(v);
  if (x >= 1e9) return `${sign}$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${sign}$${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${sign}$${(x / 1e3).toFixed(1)}K`;
  return `${sign}${money(x)}`;
}

function pct(v) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(3)}%`;
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString([], {
    month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function baseAsset(symbol) {
  return symbol?.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

function whaleTier(notional) {
  if (notional >= 50_000_000) return 'ULTRA';
  if (notional >= 25_000_000) return 'GIANT';
  if (notional >= 10_000_000) return 'MEGA';
  return 'WHALE';
}

function priceDigits(price) {
  if (price < 0.0001) return 10;
  if (price < 0.01) return 8;
  if (price < 1) return 6;
  return 4;
}

function impactLabel(event) {
  if (!event) return 'Waiting';
  if (!Number.isFinite(event.reaction30s)) return 'Measuring 30s / 60s reaction';
  const x = Math.abs(event.reaction30s);
  if (x >= 1) return 'Very large observed move';
  if (x >= 0.5) return 'Large observed move';
  if (x >= 0.15) return 'Moderate observed move';
  return 'Limited observed move';
}

function playAlarmTone(audioContext, side = 'BUY') {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const frequencies = side === 'BUY' ? [880, 1046, 1318] : [660, 523, 392];

  frequencies.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + index * 0.22;
    const end = start + 0.16;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  });
}

function windowStats(queue, now, windowMs) {
  const cutoff = now - windowMs;
  let buyUsd = 0;
  let sellUsd = 0;
  let buyQty = 0;
  let sellQty = 0;
  let buyPriceUsd = 0;
  let sellPriceUsd = 0;
  let buyCount = 0;
  let sellCount = 0;
  let firstPrice = null;
  let firstTime = null;
  let lastPrice = null;

  for (const t of queue) {
    if (t.time < cutoff) continue;
    if (firstTime == null) {
      firstTime = t.time;
      firstPrice = t.price;
    }
    lastPrice = t.price;
    if (t.side === 'BUY') {
      buyUsd += t.notional;
      buyQty += t.qty;
      buyPriceUsd += t.price * t.notional;
      buyCount += 1;
    } else {
      sellUsd += t.notional;
      sellQty += t.qty;
      sellPriceUsd += t.price * t.notional;
      sellCount += 1;
    }
  }

  return {
    buyUsd,
    sellUsd,
    buyQty,
    sellQty,
    buyCount,
    sellCount,
    buyAvgPrice: buyUsd ? buyPriceUsd / buyUsd : null,
    sellAvgPrice: sellUsd ? sellPriceUsd / sellUsd : null,
    firstPrice,
    firstTime,
    lastPrice,
    net: buyUsd - sellUsd,
  };
}

function App() {
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [windowSec, setWindowSec] = useState(DEFAULT_WINDOW);
  const [connected, setConnected] = useState(false);
  const [marketCount, setMarketCount] = useState(0);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [streamError, setStreamError] = useState('');
  const [events, setEvents] = useState(getCryptoSessionSignals);
  const [clearEpoch, setClearEpoch] = useState(getSignalClearTime);
  const [selectedSignalKey, setSelectedSignalKey] = useState(null);
  const [marketFilter, setMarketFilter] = useState('ALL');
  const [iexFeedState, setIexFeedState] = useState({events: [], configured: false, connected: false});
  const [query, setQuery] = useState('');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [signalAlarmEnabled, setSignalAlarmEnabled] = useState(false);
  const [alarmMessage, setAlarmMessage] = useState('Signal alarm is off');
  const [positionSymbol, setPositionSymbol] = useState('BTCUSDT');
  const [positionSymbols, setPositionSymbols] = useState(['BTCUSDT']);
  const [accountRatio, setAccountRatio] = useState(null);
  const [accountRatioError, setAccountRatioError] = useState('');
  const [accountRatioLoading, setAccountRatioLoading] = useState(true);
  const latestPriceRef = useRef(new Map());
  const signalAlarmEnabledRef = useRef(false);
  const audioContextRef = useRef(null);
  const thresholdRef = useRef(DEFAULT_THRESHOLD);
  const windowSecRef = useRef(DEFAULT_WINDOW);
  const rollingRef = useRef(new Map());
  const crossingRef = useRef(new Map());
  const timersRef = useRef(new Map());

  // The tab's signal history survives browser refresh/background tab discard.
  // Saved data is intentionally limited to this tab's session (not localStorage).
  useEffect(() => {
    saveCryptoSessionSignals(events);
  }, [events]);

  const clearSignalHistory = () => {
    if (!events.length && !(iexFeedState.events || []).length) return;
    if (!window.confirm('Clear ALL saved Binance and NASDAQ/S&P 500 signals for this tab? New qualifying signals will still arrive.')) return;
    const epoch = clearAllSessionSignals();
    setEvents([]);
    setIexFeedState(prev => ({...prev, events: []}));
    setSelectedSignalKey(null);
    setClearEpoch(epoch);
  };

  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);

  useEffect(() => {
    windowSecRef.current = windowSec;
  }, [windowSec]);

  useEffect(() => {
    signalAlarmEnabledRef.current = signalAlarmEnabled;
  }, [signalAlarmEnabled]);

  useEffect(() => {
    let cancelled = false;

    async function loadSymbols() {
      try {
        const response = await fetch(`${FUTURES_REST_BASE}/fapi/v1/exchangeInfo`);
        if (!response.ok) throw new Error(`Futures exchangeInfo HTTP ${response.status}`);
        const info = await response.json();
        const symbols = (info.symbols || [])
          .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL')
          .map(s => s.symbol)
          .sort((a, b) => {
            if (a === 'BTCUSDT') return -1;
            if (b === 'BTCUSDT') return 1;
            if (a === 'ETHUSDT') return -1;
            if (b === 'ETHUSDT') return 1;
            return a.localeCompare(b);
          });
        if (!cancelled && symbols.length) setPositionSymbols(symbols);
      } catch {
        // Keep BTC available even if futures symbol discovery is unavailable.
      }
    }

    loadSymbols();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function loadAccountRatio() {
      try {
        setAccountRatioLoading(true);
        const url = `${FUTURES_REST_BASE}/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(positionSymbol)}&period=5m&limit=2`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Long/short ratio HTTP ${response.status}`);
        const rows = await response.json();
        const latest = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
        const previous = Array.isArray(rows) && rows.length > 1 ? rows[rows.length - 2] : null;
        if (!latest) throw new Error('No long/short account data returned');

        const next = {
          longPct: Number(latest.longAccount) * 100,
          shortPct: Number(latest.shortAccount) * 100,
          ratio: Number(latest.longShortRatio),
          time: Number(latest.timestamp) || Date.now(),
          previousLongPct: previous ? Number(previous.longAccount) * 100 : null,
          previousShortPct: previous ? Number(previous.shortAccount) * 100 : null,
        };

        if (!cancelled) {
          setAccountRatio(next);
          setAccountRatioError('');
        }
      } catch (err) {
        if (!cancelled) setAccountRatioError(err?.message || 'Unable to load futures long/short ratio');
      } finally {
        if (!cancelled) setAccountRatioLoading(false);
      }
    }

    loadAccountRatio();
    timer = setInterval(loadAccountRatio, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [positionSymbol]);

  const enableSignalAlarm = async () => {
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Audio alerts are not supported by this browser');
        audioContextRef.current = new AudioContextClass();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      setSignalAlarmEnabled(true);
      signalAlarmEnabledRef.current = true;
      setAlarmMessage('Signal alarm armed');
      playAlarmTone(audioContextRef.current, 'BUY');
    } catch (err) {
      setAlarmMessage(err?.message || 'Unable to enable signal alarm');
    }
  };

  // Shares the existing user-armed browser sound/desktop notification toggle.
  // US ETF candles provide price momentum, NOT Binance aggressive BUY/SELL flow.
  const alertUsMomentum = (signal) => {
    if (!signalAlarmEnabledRef.current) return;
    const ctx = audioContextRef.current;
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      playAlarmTone(ctx, signal.side);
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`${signal.index} · ${signal.side} PRICE MOMENTUM`, {
          body: `${signal.symbol} ETF ${signal.changePct >= 0 ? '+' : ''}${signal.changePct.toFixed(2)}% over 15m · 5m candle close ${money(signal.price)}. Not whale flow.`,
          tag: `us-market-${signal.id}`,
        });
      } catch (error) {
        console.warn('US market desktop alert unavailable:', error);
      }
    }
  };

  const alertIexTradeFlow = (signal) => {
    if (!signalAlarmEnabledRef.current) return;
    const ctx = audioContextRef.current;
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      playAlarmTone(ctx, signal.side);
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`${signal.index} · EST. ${signal.side} PRESSURE (IEX ONLY)`, {
          body: `${signal.symbol} · ${compactUsd(signal.notional)} quote-classified IEX prints · ${signal.tradeCount} executions, not individual traders.`,
          tag: `iex-flow-${signal.id}`,
        });
      } catch (error) {
        console.warn('IEX alert unavailable:', error);
      }
    }
  };

  const disableSignalAlarm = () => {
    setSignalAlarmEnabled(false);
    signalAlarmEnabledRef.current = false;
    setAlarmMessage('Signal alarm is off');
  };

  const testSignalAlarm = async () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        setAlarmMessage('Audio alerts are not supported by this browser');
        return;
      }
      audioContextRef.current = new AudioContextClass();
    }
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    playAlarmTone(audioContextRef.current, 'BUY');
    setAlarmMessage('Test alarm played');
  };

  useEffect(() => {
    let ws;
    let retry;
    let stopped = false;

    const scheduleReaction = (evt) => {
      const t30 = setTimeout(() => {
        const nowPrice = latestPriceRef.current.get(evt.symbol);
        if (!Number.isFinite(nowPrice)) return;
        const reaction = ((nowPrice - evt.signalPrice) / evt.signalPrice) * 100;
        setEvents(prev => prev.map(x => x.id === evt.id ? { ...x, reaction30s: reaction, price30s: nowPrice } : x));
      }, 30_000);

      const t60 = setTimeout(() => {
        const nowPrice = latestPriceRef.current.get(evt.symbol);
        if (!Number.isFinite(nowPrice)) return;
        const reaction = ((nowPrice - evt.signalPrice) / evt.signalPrice) * 100;
        setEvents(prev => prev.map(x => x.id === evt.id ? { ...x, reaction60s: reaction, price60s: nowPrice } : x));
        timersRef.current.delete(evt.id);
      }, 60_000);

      timersRef.current.set(evt.id, [t30, t60]);
    };

    const emitSignal = ({ symbol, side, tradeTime, tradeId, windowSeconds, stats }) => {
      const sideUsd = side === 'BUY' ? stats.buyUsd : stats.sellUsd;
      const oppositeUsd = side === 'BUY' ? stats.sellUsd : stats.buyUsd;
      const qty = side === 'BUY' ? stats.buyQty : stats.sellQty;
      const tradeCount = side === 'BUY' ? stats.buyCount : stats.sellCount;
      const avgPrice = side === 'BUY' ? stats.buyAvgPrice : stats.sellAvgPrice;
      const signalPrice = stats.lastPrice || avgPrice;
      if (!Number.isFinite(signalPrice) || !Number.isFinite(sideUsd)) return;

      const id = `${symbol}-${side}-${windowSeconds}-${tradeTime}-${tradeId}`;
      const evt = {
        id,
        kind: 'ROLLING_PRESSURE',
        symbol,
        coin: baseAsset(symbol),
        tradeId,
        time: tradeTime,
        startTime: stats.firstTime,
        side,
        price: avgPrice,
        signalPrice,
        qty,
        notional: sideUsd,
        oppositeNotional: oppositeUsd,
        netPressure: side === 'BUY' ? sideUsd - oppositeUsd : oppositeUsd - sideUsd,
        tradeCount,
        windowSec: windowSeconds,
        startPrice: stats.firstPrice,
        tier: whaleTier(sideUsd),
        reaction30s: null,
        reaction60s: null,
      };

      setEvents(prev => [evt, ...prev.filter(x => x.id !== id)]);
      scheduleReaction(evt);

      if (signalAlarmEnabledRef.current) {
        const audioContext = audioContextRef.current;
        if (audioContext) {
          if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
          playAlarmTone(audioContext, evt.side);
        }

        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`${evt.coin} ${evt.side} WHALE PRESSURE`, {
            body: `${compactUsd(evt.notional)} in ${evt.windowSec}s near ${money(evt.signalPrice, priceDigits(evt.signalPrice))}`,
            tag: `${evt.symbol}-${evt.side}-whale-pressure`,
            renotify: true,
          });
        }
      }
    };

    async function connect() {
      try {
        setStreamError('');
        setConnected(false);

        const response = await fetch(`${REST_BASE}/api/v3/exchangeInfo`);
        if (!response.ok) throw new Error(`exchangeInfo HTTP ${response.status}`);
        const info = await response.json();

        const activeUsdtSymbols = new Set(
          (info.symbols || [])
            .filter(
              s =>
                s.status === 'TRADING' &&
                s.quoteAsset === 'USDT' &&
                s.isSpotTradingAllowed !== false
            )
            .map(s => s.symbol)
        );

        if (!activeUsdtSymbols.size) {
          throw new Error('No active USDT spot markets returned by Binance');
        }

        // Rank active USDT spot markets by Binance 24h quote volume.
        // Monitoring only the strongest 50 markets keeps the WebSocket lighter
        // and avoids unnecessary reconnect pressure from 500+ subscriptions.
        const tickerResponse = await fetch(`${REST_BASE}/api/v3/ticker/24hr`);
        if (!tickerResponse.ok) {
          throw new Error(`24hr ticker HTTP ${tickerResponse.status}`);
        }

        const tickers = await tickerResponse.json();

        const symbols = (Array.isArray(tickers) ? tickers : [])
          .filter(t => activeUsdtSymbols.has(t.symbol))
          .map(t => ({
            symbol: t.symbol,
            quoteVolume: Number(t.quoteVolume) || 0,
          }))
          .sort((a, b) => b.quoteVolume - a.quoteVolume)
          .slice(0, TOP_MARKET_LIMIT)
          .map(t => t.symbol.toLowerCase());

        if (!symbols.length) {
          throw new Error('Unable to select top USDT spot markets');
        }

        setMarketCount(symbols.length);

        ws = new WebSocket(WS_URL);
        ws.onopen = () => {
          setConnected(true);

          // Only 50 streams, so a single subscription request is enough.
          const params = symbols.map(s => `${s}@aggTrade`);
          ws.send(
            JSON.stringify({
              method: 'SUBSCRIBE',
              params,
              id: 1,
            })
          );

          setSubscriptionCount(symbols.length);
        };

        ws.onclose = () => {
          setConnected(false);
          if (!stopped) retry = setTimeout(connect, 2500);
        };

        ws.onerror = () => {
          setConnected(false);
          setStreamError('WebSocket connection error');
        };

        ws.onmessage = (msg) => {
          let d;
          try { d = JSON.parse(msg.data); } catch { return; }
          if (d.result !== undefined) return;
          if (d.e !== 'aggTrade' || !d.s) return;

          const tradePrice = Number(d.p);
          const qty = Number(d.q);
          if (!Number.isFinite(tradePrice) || !Number.isFinite(qty)) return;

          const symbol = String(d.s).toUpperCase();
          const notional = tradePrice * qty;
          const tradeTime = Number(d.T || d.E || Date.now());
          const side = d.m ? 'SELL' : 'BUY';
          latestPriceRef.current.set(symbol, tradePrice);

          const queue = rollingRef.current.get(symbol) || [];
          queue.push({ time: tradeTime, side, notional, qty, price: tradePrice, tradeId: d.a });
          const cutoff = tradeTime - MAX_WINDOW_MS;
          let firstValid = 0;
          while (firstValid < queue.length && queue[firstValid].time < cutoff) firstValid += 1;
          if (firstValid > 0) queue.splice(0, firstValid);
          rollingRef.current.set(symbol, queue);

          const activeWindow = windowSecRef.current;
          const stats = windowStats(queue, tradeTime, activeWindow * 1000);
          const thresholdNow = thresholdRef.current;

          for (const signalSide of ['BUY', 'SELL']) {
            const amount = signalSide === 'BUY' ? stats.buyUsd : stats.sellUsd;
            const key = `${symbol}:${signalSide}:${activeWindow}`;
            const state = crossingRef.current.get(key) || { above: false, lastSignal: 0 };
            const isAbove = amount >= thresholdNow;
            const cooldownPassed = tradeTime - state.lastSignal >= SIGNAL_COOLDOWN_MS;

            if (isAbove && (!state.above || cooldownPassed)) {
              emitSignal({
                symbol,
                side: signalSide,
                tradeTime,
                tradeId: d.a,
                windowSeconds: activeWindow,
                stats,
              });
              crossingRef.current.set(key, { above: true, lastSignal: tradeTime });
            } else if (!isAbove) {
              crossingRef.current.set(key, { above: false, lastSignal: state.lastSignal });
            } else {
              crossingRef.current.set(key, state);
            }
          }
        };
      } catch (err) {
        setConnected(false);
        setStreamError(err?.message || 'Unable to connect to Binance market data');
        if (!stopped) retry = setTimeout(connect, 4000);
      }
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      if (ws) ws.close();
      for (const timers of timersRef.current.values()) timers.forEach(clearTimeout);
      timersRef.current.clear();
      rollingRef.current.clear();
      crossingRef.current.clear();
    };
  }, []);

  // One chronological feed for Binance executions and Alpaca IEX quote-classified ETF prints.
  // IEX's $5M threshold and 60s window are fixed independently of the crypto controls.
  const merged = useMemo(() => buildUnifiedSignals({
    cryptoEvents: events,
    iexEvents: iexFeedState.events || [],
    cryptoThreshold: threshold,
    cryptoWindowSec: windowSec,
    query,
    sideFilter,
    marketFilter,
  }), [events, iexFeedState.events, threshold, windowSec, query, sideFilter, marketFilter]);

  // A manual selection stays visible while it passes the active filters.
  // Otherwise the newest visible event is automatically selected.
  const selectedEntry = merged.find(row => row.key === selectedSignalKey) || merged[0] || null;
  const selected = selectedEntry?.event || null;
  const selectedIsIex = selectedEntry?.market === 'IEX';
  const cryptoShown = merged.filter(row => row.market === 'CRYPTO').length;
  const etfShown = merged.filter(row => row.market === 'IEX').length;

  const stats = useMemo(() => {
    const visible = events.filter(e => e.notional >= threshold && e.windowSec === windowSec);
    const buyUsd = visible.filter(x => x.side === 'BUY').reduce((s, x) => s + x.notional, 0);
    const sellUsd = visible.filter(x => x.side === 'SELL').reduce((s, x) => s + x.notional, 0);
    const coins = new Set(visible.map(x => x.coin));
    return { buyUsd, sellUsd, net: buyUsd - sellUsd, count: visible.length, coins: coins.size };
  }, [events, threshold, windowSec]);

  const selectedCurrentPrice = selected && !selectedIsIex ? latestPriceRef.current.get(selected.symbol) : null;

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">REAL-TIME MULTI-COIN WHALE PRESSURE</div>
          <h1>Crypto Whale Radar</h1>
          <p>Detects large cumulative aggressive BUY or SELL flow across active Binance Spot USDT markets. It combines many smaller executions inside a rolling time window, so a whale order split into pieces is less likely to be missed.</p>

          <div className="position-snapshot">
            <div className="position-topline">
              <div>
                <span className="position-kicker">BINANCE FUTURES · GLOBAL ACCOUNT POSITIONING</span>
                <strong>Live Long vs Short Accounts</strong>
              </div>
              <select
                className="position-coin-select"
                value={positionSymbol}
                onChange={e => setPositionSymbol(e.target.value)}
                aria-label="Select futures coin"
              >
                {positionSymbols.map(symbol => (
                  <option key={symbol} value={symbol}>{baseAsset(symbol)}</option>
                ))}
              </select>
            </div>

            <div className="position-values">
              <div className="position-side long">
                <span>LONG ACCOUNTS</span>
                <strong>{accountRatio && Number.isFinite(accountRatio.longPct) ? `${accountRatio.longPct.toFixed(2)}%` : '—'}</strong>
                <small>
                  {accountRatio && Number.isFinite(accountRatio.previousLongPct)
                    ? `${accountRatio.longPct - accountRatio.previousLongPct >= 0 ? '+' : ''}${(accountRatio.longPct - accountRatio.previousLongPct).toFixed(2)} pp vs previous 5m`
                    : 'Waiting for comparison'}
                </small>
              </div>
              <div className="position-divider" />
              <div className="position-side short">
                <span>SHORT ACCOUNTS</span>
                <strong>{accountRatio && Number.isFinite(accountRatio.shortPct) ? `${accountRatio.shortPct.toFixed(2)}%` : '—'}</strong>
                <small>
                  {accountRatio && Number.isFinite(accountRatio.previousShortPct)
                    ? `${accountRatio.shortPct - accountRatio.previousShortPct >= 0 ? '+' : ''}${(accountRatio.shortPct - accountRatio.previousShortPct).toFixed(2)} pp vs previous 5m`
                    : 'Waiting for comparison'}
                </small>
              </div>
              <div className="position-meta">
                <span>LONG / SHORT RATIO</span>
                <strong>{accountRatio && Number.isFinite(accountRatio.ratio) ? accountRatio.ratio.toFixed(3) : '—'}</strong>
                <small>{accountRatioLoading ? 'Refreshing…' : accountRatio ? `Updated ${formatTime(accountRatio.time)}` : 'Waiting…'}</small>
              </div>
            </div>

            {accountRatioError && <div className="position-error">{accountRatioError}</div>}
            <div className="position-note">Binance publishes the percentage/ratio of long vs short futures accounts, not the absolute number of people. This panel therefore shows the real published account split and refreshes every 15 seconds; Binance's source bucket is 5 minutes.</div>
          </div>
        </div>
        <div className="rule-card">
          <strong>What this proves</strong>
          <span>Real exchange executions — not wallet identity.</span>
          <small>Signals aggregate the aggressive taker side reported by Binance. They indicate concentrated buy/sell pressure, not the identity of a specific trader or wallet.</small>
        </div>
      </header>

      <section className="toolbar card">
        <div className="controls">
          <div>
            <label>Whale pressure threshold</label>
            <select value={threshold} onChange={e => setThreshold(Number(e.target.value))}>
              <option value={5_000_000}>$5M+</option>
              <option value={10_000_000}>$10M+</option>
              <option value={25_000_000}>$25M+</option>
              <option value={50_000_000}>$50M+</option>
            </select>
          </div>
          <div>
            <label>Rolling window</label>
            <select value={windowSec} onChange={e => setWindowSec(Number(e.target.value))}>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </div>
          <div>
            <label>Coin search</label>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="BTC, ETH, QQQ, SPY..." />
          </div>
          <div>
            <label>Side</label>
            <select value={sideFilter} onChange={e => setSideFilter(e.target.value)}>
              <option value="ALL">All</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div className="alarm-control">
            <label>Signal laptop alarm</label>
            <div className="alarm-actions">
              <button
                type="button"
                className={`alarm-toggle ${signalAlarmEnabled ? 'armed' : ''}`}
                onClick={signalAlarmEnabled ? disableSignalAlarm : enableSignalAlarm}
              >
                {signalAlarmEnabled ? '🔔 Armed' : '🔕 Enable'}
              </button>
              <button type="button" className="alarm-test" onClick={testSignalAlarm}>Test</button>
            </div>
            <small className={signalAlarmEnabled ? 'alarm-ok' : 'muted'}>{alarmMessage}</small>
          </div>
        </div>
        <div className={`status ${connected ? 'ok' : 'bad'}`}>
          <span className="dot" /> {connected ? `${subscriptionCount} USDT MARKETS LIVE` : 'RECONNECTING'}
        </div>
      </section>

      {streamError && <div className="alert">{streamError}. If Binance is blocked on your network, set VITE_BINANCE_REST_BASE / VITE_BINANCE_WS_URL in .env.</div>}

      <section className="metrics">
        <Metric label="USDT spot markets" value={marketCount || 'Connecting…'} sub="Top 50 active USDT spot markets by 24h quote volume" />
        <Metric label="Whale pressure signals" value={stats.count} sub={`${stats.coins} coins · ${windowSec}s rolling window`} />
        <Metric label="Detected BUY pressure" value={compactUsd(stats.buyUsd)} sub={`Signals ≥ ${compactUsd(threshold)}`} positive />
        <Metric label="Detected SELL pressure" value={compactUsd(stats.sellUsd)} sub={`Signal net ${compactUsd(stats.net)}`} negative={stats.net < 0} positive={stats.net > 0} />
      </section>

      <section className="grid unified-signal-grid" aria-label="Combined crypto and ETF signals">
        <div className="card feed-card">
          <div className="section-head unified-head">
            <div>
              <div className="eyebrow">LIVE CRYPTO WHALE + US ETF TRADE SIGNALS</div>
              <h2>Top 50 Coins + NASDAQ-100 &amp; S&amp;P 500</h2>
              <p className="unified-help">Binance: aggressive executions · QQQ/SPY: estimated IEX BUY/SELL classifications. Latest signals first, in one list.</p>
            </div>
            <div className="unified-head-right">
              <span className="muted">Newest first · {merged.length} shown</span>
              <span className="unified-counts">{cryptoShown} crypto · {etfShown} ETF</span>
              <button type="button" className="clear-signals-button" onClick={clearSignalHistory}
                disabled={!events.length && !(iexFeedState.events || []).length}
                title="Remove all saved signals from this browser tab">
                Clear Signals
              </button>
            </div>
          </div>
          <p className="signal-history-notice" role="status">
            Saved in this tab until you close it or click Clear Signals. Reloading or returning later will not erase existing alerts.
            {getSignalStorageWarning() && <span className="signal-save-warning"> {getSignalStorageWarning()}</span>}
          </p>
          <div className="unified-filters" role="group" aria-label="Filter signal market">
            {[
              ['ALL', 'All signals'],
              ['CRYPTO', '50 Crypto Coins'],
              ['QQQ', 'NASDAQ-100'],
              ['SPY', 'S&amp;P 500'],
            ].map(([value, label]) => (
              <button
                key={value} type="button"
                className={marketFilter === value ? 'active' : ''}
                aria-pressed={marketFilter === value}
                onClick={() => setMarketFilter(value)}
              >{label === 'S&amp;P 500' ? 'S&P 500' : label}</button>
            ))}
          </div>
          <div className="unified-disclaimer">
            <strong>Signal source matters:</strong> Crypto = Binance actual aggressive trade flow. ETF = IEX-only quote-inferred estimated direction, NOT verified whale buyers or full US-market order flow. ETF signals require at least $5M per side in 60s; crypto uses the controls above.
          </div>
          <div className="feed" aria-live="polite" aria-relevant="additions">
            {merged.length === 0 && (
              <div className="empty">
                <div>
                  <strong>No matching signals yet.</strong>
                  <p>Crypto waits for {compactUsd(threshold)}+ in the selected {windowSec}s window. QQQ/SPY require $5M+ estimated IEX flow per side in 60 seconds. Check filters and US market hours.</p>
                </div>
              </div>
            )}
            {merged.map(({key, market, event: e}) => {
              const isIex = market === 'IEX';
              const vwap = isIex ? e.vwap : e.price;
              const reaction = isIex
                ? (e.reactionStatus === 'READY' ? pct(e.reaction30sPct) : e.reactionStatus === 'PENDING' ? 'Pending' : 'N/A')
                : (e.reaction30s == null ? 'Measuring…' : pct(e.reaction30s));
              return <button
                key={key}
                type="button"
                className={`trade-row ${isIex ? 'unified-iex-row' : ''} ${selectedEntry?.key === key ? 'selected' : ''}`}
                aria-pressed={selectedEntry?.key === key}
                onClick={() => setSelectedSignalKey(key)}
              >
                <div className="coin-cell">
                  <strong className="coin">{isIex ? e.index : e.coin}</strong>
                  <small>{e.symbol} · {isIex ? 'IEX ETF' : 'BINANCE'}</small>
                  {isIex && <span className="market-source-tag">ESTIMATED · IEX ONLY</span>}
                </div>
                <div>
                  <strong>{isIex ? formatPakistanTime(e.time) : formatTime(e.time)}</strong>
                  <small>{isIex ? `${e.windowSeconds || 60}s rolling · PKT` : `${e.windowSec}s rolling window`}</small>
                </div>
                <div>
                  <span className={`pill ${e.side.toLowerCase()}`}>{isIex ? 'EST. ' : ''}{e.side} PRESSURE</span>
                  <small>{Number(e.tradeCount).toLocaleString('en-US')} {isIex ? 'quote-classified prints' : 'aggressive trades'}</small>
                </div>
                <div>
                  <strong>{Number(e.qty).toLocaleString('en-US', {maximumFractionDigits: 6})} {isIex ? 'shares' : e.coin}</strong>
                  <small>VWAP @ {Number.isFinite(vwap) ? money(vwap, priceDigits(vwap)) : '—'}</small>
                </div>
                <div className="right">
                  <strong>{compactUsd(e.notional)}</strong>
                  <small className={isIex ? 'unified-estimate-label' : `tier tier-${e.tier.toLowerCase()}`}>{isIex ? 'EST. IEX PRESSURE' : `${e.tier} PRESSURE`}</small>
                </div>
                <div className="right">
                  <strong>{reaction}</strong>
                  <small>30s reaction</small>
                </div>
              </button>;
            })}
          </div>
        </div>

        <div className="card impact-card">
          <div className="eyebrow">{selectedIsIex ? 'SELECTED IEX ESTIMATED TRADE EVENT' : 'SELECTED WHALE PRESSURE EVENT'}</div>
          <h2>{selected ? `${selectedIsIex ? selected.index : selected.coin} · ${selected.side}` : 'Waiting for signals'}</h2>
          {selected && selectedIsIex ? (
            <>
              <div className={`whale-banner ${selected.side.toLowerCase()}`}>
                <span>ESTIMATED · IEX · {selected.windowSeconds}s</span>
                <strong>{compactUsd(selected.notional)}</strong>
              </div>
              <div className="unified-iex-warning">
                Real IEX prints; inferred BUY/SELL from bid/ask quotes, not an exchange-reported aggressor flag. Counts are executions, not individual people or verified whales. Free feed covers IEX only.
              </div>
              <div className="impact-grid">
                <Info label="Market proxy" value={selected.index} />
                <Info label="Tracked ETF" value={selected.symbol} />
                <Info label="Estimated pressure side" value={selected.side} className={selected.side === 'BUY' ? 'green' : 'red'} />
                <Info label="Classified side notional (IEX)" value={compactUsd(selected.notional)} />
                <Info label="Opposite classified side" value={compactUsd(selected.oppositeNotional)} />
                <Info label="Net classified pressure" value={compactUsd(selected.netPressure)} className={selected.netPressure >= 0 ? 'green' : 'red'} />
                <Info label="Quote-classified prints" value={Number(selected.tradeCount).toLocaleString('en-US')} />
                <Info label="Classified quantity" value={`${Number(selected.qty).toLocaleString('en-US')} shares`} />
                <Info label="VWAP of classified prints" value={money(selected.vwap, priceDigits(selected.vwap))} />
                <Info label="Signal trade price" value={money(selected.signalPrice, priceDigits(selected.signalPrice))} />
                <Info label="Unknown / unclassified prints" value={Number(selected.unknownTrades || 0).toLocaleString('en-US')} />
                <Info label="Unknown / unclassified notional" value={compactUsd(selected.unknownNotional)} />
                <Info label="Total observed IEX prints" value={Number(selected.totalTrades || 0).toLocaleString('en-US')} />
                <Info label="Total IEX turnover" value={compactUsd(selected.totalNotional)} />
                <Info label="Window start (PKT)" value={formatPakistanDateTime(selected.startTime)} />
                <Info label="Signal time (PKT)" value={formatPakistanDateTime(selected.time)} />
                <Info label="30s observed reaction" value={selected.reactionStatus === 'READY' ? pct(selected.reaction30sPct) : selected.reactionStatus === 'PENDING' ? 'Pending...' : 'N/A'} />
                <Info label="Data source" value="Alpaca Basic · IEX prints + quotes" />
              </div>
              <div className="interpretation">
                <strong>What this estimated signal means</strong>
                <p>{selected.symbol} recorded {Number(selected.tradeCount).toLocaleString('en-US')} IEX executions classified as likely {selected.side}-initiated, totaling {compactUsd(selected.notional)} within 60 seconds. This is not a count of investors or consolidated exchange buy/sell volume.</p>
              </div>
            </>
          ) : selected ? (
            <>
              <div className={`whale-banner ${selected.side.toLowerCase()}`}>
                <span>{selected.tier} · {selected.windowSec}s</span>
                <strong>{compactUsd(selected.notional)}</strong>
              </div>
              <div className="impact-grid">
                <Info label="Coin" value={selected.coin} />
                <Info label="Pressure side" value={selected.side} className={selected.side === 'BUY' ? 'green' : 'red'} />
                <Info label="Cumulative side volume" value={compactUsd(selected.notional)} />
                <Info label="Opposite-side volume" value={compactUsd(selected.oppositeNotional)} />
                <Info label="Net side pressure" value={compactUsd(selected.netPressure)} className={selected.netPressure >= 0 ? 'green' : 'red'} />
                <Info label="Aggressive trades" value={selected.tradeCount.toLocaleString()} />
                <Info label="Volume-weighted avg price" value={money(selected.price, priceDigits(selected.price))} />
                <Info label="Signal price" value={money(selected.signalPrice, priceDigits(selected.signalPrice))} />
                <Info label="Quantity" value={`${selected.qty.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${selected.coin}`} />
                <Info label="Window" value={`${selected.windowSec} seconds`} />
                <Info label="Window start" value={selected.startTime ? formatTime(selected.startTime) : '—'} />
                <Info label="Signal time" value={formatTime(selected.time)} />
                <Info label="Latest observed price" value={Number.isFinite(selectedCurrentPrice) ? money(selectedCurrentPrice, priceDigits(selectedCurrentPrice)) : '—'} />
                <Info label="30 sec reaction" value={pct(selected.reaction30s)} />
                <Info label="60 sec reaction" value={pct(selected.reaction60s)} />
              </div>
              <div className="interpretation">
                <strong>{impactLabel(selected)}</strong>
                <p>
                  {selected.side === 'BUY'
                    ? `${selected.coin} accumulated ${compactUsd(selected.notional)} of aggressive BUY executions inside ${selected.windowSec}s at a weighted average near ${money(selected.price, priceDigits(selected.price))}.`
                    : `${selected.coin} accumulated ${compactUsd(selected.notional)} of aggressive SELL executions inside ${selected.windowSec}s at a weighted average near ${money(selected.price, priceDigits(selected.price))}.`}
                </p>
                <p className="muted">This is a market-pressure signal made from real Binance executions. It does not prove that one wallet placed all of those trades, and the 30s/60s move is observed correlation rather than guaranteed causation.</p>
              </div>
            </>
          ) : <div className="empty">No matching Binance or IEX signal has appeared yet. Signals populate this same feed as soon as each market qualifies.</div>}
        </div>
      </section>

      <IexTradeFlowPanel compact alarmEnabled={signalAlarmEnabled} onIexSignal={alertIexTradeFlow} onFeedStateChange={setIexFeedState} clearEpoch={clearEpoch} />
      <MarketIndicesPanel alarmEnabled={signalAlarmEnabled} onMarketSignal={alertUsMomentum} />

      <section className="card explain">
        <div className="eyebrow">HOW THE NEW DETECTOR WORKS</div>
        <h2>Split whale orders are now visible</h2>
        <div className="explain-grid">
          <div><strong>Rolling aggregation</strong><p>Every Binance aggregate trade from the top 50 active USDT spot markets (ranked by 24h quote volume) is grouped by coin and aggressive BUY/SELL side for the selected 30s or 60s window.</p></div>
          <div><strong>$5M example</strong><p>$900K + $1.4M + $1.1M + $1.8M BUY executions can trigger one $5.2M BUY-pressure signal.</p></div>
          <div><strong>Execution price</strong><p>The signal shows a volume-weighted average execution price plus the price when the threshold was crossed.</p></div>
          <div><strong>Impact check</strong><p>The same coin is checked 30s and 60s after the signal to show the observed follow-through.</p></div>
          <div><strong>Signal laptop alarm</strong><p>Enable it once in the browser. Every whale-pressure signal from any monitored coin then plays a three-tone alert and can also show a desktop notification.</p></div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, sub, positive, negative }) {
  return <div className="card metric"><span>{label}</span><strong className={positive ? 'green' : negative ? 'red' : ''}>{value}</strong><small>{sub}</small></div>;
}

function Info({ label, value, className = '' }) {
  return <div className="info"><span>{label}</span><strong className={className}>{value}</strong></div>;
}

createRoot(document.getElementById('root')).render(<App />);

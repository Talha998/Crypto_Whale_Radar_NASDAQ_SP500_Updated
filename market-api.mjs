// Local-only Vite/preview middleware. API keys stay on the Node side of the app.
// Twelve Data Basic free tier currently has an 800-credit daily budget.
// We cache responses across browser tabs and refresh at most once per 5 minutes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SYMBOLS = new Set(['SPY', 'QQQ']);
const FIVE_MINUTES = 5 * 60 * 1000;
const cache = new Map();
const pending = new Map();

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

export async function getMarketSeries(symbol, key, fetcher = fetch, now = Date.now()) {
  if (!SYMBOLS.has(symbol)) return { status: 400, payload: { error: 'Unsupported market symbol' } };
  if (!key) return { status: 200, payload: { configured: false, symbol, bars: [], message: 'Add TWELVEDATA_API_KEY to .env for free-tier ETF momentum data.' } };
  const previous = cache.get(symbol);
  if (previous && now - previous.at < FIVE_MINUTES) {
    return { status: 200, payload: { ...previous.payload, cacheAgeSeconds: Math.max(0, Math.floor((now - previous.at) / 1000)) } };
  }
  if (pending.has(symbol)) return pending.get(symbol);
  const run = (async () => {
    try {
      const url = new URL('https://api.twelvedata.com/time_series');
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('interval', '5min');
      url.searchParams.set('outputsize', '96');
      url.searchParams.set('timezone', 'America/New_York');
      url.searchParams.set('apikey', key);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try { response = await fetcher(url.toString(), { signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error(`Market data service HTTP ${response.status}`);
      const upstream = await response.json();
      if (upstream.status === 'error' || !Array.isArray(upstream.values)) {
        throw new Error(upstream.message || 'Market data is not available for this symbol on your plan');
      }
      // Only return price/volume bars, never private credentials or provider URL.
      const bars = upstream.values.map(v => ({
        datetime: v.datetime, open: v.open, high: v.high,
        low: v.low, close: v.close, volume: v.volume,
      }));
      const payload = {
        configured: true, symbol, bars,
        source: 'Twelve Data', interval: '5min',
        sourceTimeZone: 'America/New_York', fetchedAt: new Date(now).toISOString(), cacheAgeSeconds: 0,
        notice: 'ETF price/volume candles, not an index trade tape. Price data may be delayed.',
      };
      cache.set(symbol, { at: now, payload });
      return { status: 200, payload };
    } catch (error) {
      // Never turn outdated/stale data into an apparently fresh signal.
      const message = error.name === 'AbortError' ? 'Market data request timed out' : error.message;
      return {
        status: previous ? 200 : 502,
        payload: previous
          ? { ...previous.payload, stale: true, error: message, cacheAgeSeconds: Math.floor((now - previous.at) / 1000) }
          : { configured: true, symbol, bars: [], error: message },
      };
    } finally { pending.delete(symbol); }
  })();
  pending.set(symbol, run);
  return run;
}

export function marketApiPlugin() {
  return {
    name: 'private-market-data-api',
    configureServer(server) { attachMarketMiddleware(server.middlewares, server.config.mode); },
    configurePreviewServer(server) { attachMarketMiddleware(server.middlewares, server.config.mode); },
  };
}

function attachMarketMiddleware(middlewares, mode) {
  const key = process.env.TWELVEDATA_API_KEY || readLocalKey(mode);

  middlewares.use('/api/market-candles', async (req, res) => {
    try {
      if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return; }
      const url = new URL(req.url || '', 'http://localhost');
      const symbol = url.searchParams.get('symbol') || '';
      const result = await getMarketSeries(symbol, key);
      json(res, result.status, result.payload);
    } catch { json(res, 500, { error: 'Market API unavailable' }); }
  });
}

// Small .env parser: only read our private key, never expose it through Vite.
function readLocalKey(mode) {
  for (const name of [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']) {
    try {
      const content = readFileSync(resolve(process.cwd(), name), 'utf8');
      const match = content.match(/^\s*TWELVEDATA_API_KEY\s*=\s*(.*?)\s*$/m);
      if (match) return match[1].trim().replace(/^([\"'])(.*)\1$/, '$2');
    } catch { /* Optional env file absent */ }
  }
  return '';
}

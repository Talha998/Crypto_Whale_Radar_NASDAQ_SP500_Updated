/** Server-side Alpaca Basic (IEX-only) WebSocket -> same-origin SSE feed.
 * Auth credentials never reach the browser. One upstream connection per server.
 * The feed runs while the local Vite server stays running (not just while a tab is open).
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import WebSocket, {WebSocketServer} from 'ws';
import {timingSafeEqual} from 'node:crypto';
import {IexFlowEngine, normalizeIexThreshold, IEX_MIN_THRESHOLD} from './src/markets/iexFlowEngine.js';

const SSE_PATH = '/api/iex-flow';
const FEED_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const CLIENTS = new Set();
const MOBILE_CLIENTS = new Set();
const MOBILE_WS_PATH = '/api/mobile-iex';

function safeTokenMatch(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
function sendMobile(ws, type, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({type, data}));
}

const symbols = ['QQQ', 'SPY'];
const eventName = 'alpaca-iex-flow';

function envValue(name, mode) {
  if (process.env[name]) return process.env[name];
  for (const file of [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const found = text.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.*?)\\s*$`, 'm'));
      if (found) return found[1].replace(/^(['"])(.*)\1$/, '$2').trim();
    } catch { /* absent file is allowed */ }
  }
  return '';
}

function send(client, type, data) {
  if (client.destroyed || client.writableEnded) { CLIENTS.delete(client); return; }
  try { client.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  catch { CLIENTS.delete(client); }
}
function broadcast(type, data) {
  for (const client of CLIENTS) send(client, type, data);
  for (const client of MOBILE_CLIENTS) sendMobile(client, type, data);
}

export function createIexFlowPlugin() {
  let started = false;
  let instance;
  const register = (server) => {
    if (started) return;
    started = true;
    const mode = server.config.mode;
    const key = envValue('ALPACA_API_KEY_ID', mode);
    const secret = envValue('ALPACA_API_SECRET_KEY', mode);
    const configuredThreshold = envValue('ALPACA_FLOW_THRESHOLD_USD', mode);
    // Dedicated read-only mobile bridge token, never the Alpaca API secret.
    const mobileAccessToken = envValue('MOBILE_IEX_ACCESS_TOKEN', mode);
    const flowThreshold = normalizeIexThreshold(configuredThreshold);
    if (configuredThreshold && Number(configuredThreshold) < IEX_MIN_THRESHOLD) {
      server.config.logger.warn(
        `Alpaca IEX threshold ${configuredThreshold} is below the required $5M minimum; using $5,000,000.`,
      );
    }
    instance = new IexRelay({key, secret, threshold: flowThreshold});
    server.middlewares.use(SSE_PATH, (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Method not allowed'})); return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      CLIENTS.add(res);
      send(res, 'snapshot', instance.snapshot());
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
      req.on('close', () => { clearInterval(heartbeat); CLIENTS.delete(res); });
    });
    const mobileWss = new WebSocketServer({noServer: true, maxPayload: 16 * 1024});
    // Attach only to our private mobile path; leave Vite's HMR upgrade alone.
    server.httpServer?.on('upgrade', (request, socket, head) => {
      let pathname;
      try { pathname = new URL(request.url, 'http://localhost').pathname; }
      catch { return; }
      if (pathname !== MOBILE_WS_PATH) return;
      const auth = request.headers.authorization || '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!safeTokenMatch(bearer, mobileAccessToken)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      mobileWss.handleUpgrade(request, socket, head, ws => {
        MOBILE_CLIENTS.add(ws);
        sendMobile(ws, 'snapshot', instance.snapshot());
        ws.on('close', () => MOBILE_CLIENTS.delete(ws));
        ws.on('error', () => MOBILE_CLIENTS.delete(ws));
      });
    });
    server.httpServer?.on('close', () => {
      instance.stop();
      for (const ws of MOBILE_CLIENTS) ws.terminate();
      MOBILE_CLIENTS.clear();
      mobileWss.close();
    });
    instance.start();
  };
  return {name: eventName, configureServer: register, configurePreviewServer: register};
}

export class IexRelay {
  constructor({key, secret, threshold = IEX_MIN_THRESHOLD, WebSocketImpl = WebSocket} = {}) {
    this.key = key;
    this.secret = secret;
    this.WS = WebSocketImpl;
    this.engine = new IexFlowEngine({threshold,
      onSignal: signal => broadcast('signal', signal),
      onUpdate: event => broadcast('update', event),
    });
    this.connected = false;
    this.authenticated = false;
    this.subscribed = false;
    this.error = '';
    this.stopped = false;
    this.attempts = 0;
    this.connection = null;
    this.retry = null;
    this.tick = null;
    this.initializedAt = new Date().toISOString();
    // Counts are received stream frames, not identified investors or whale trades.
    this.tradeFrames = 0;
    this.quoteFrames = 0;
    this.lastTradeFrameAt = null;
    this.lastQuoteFrameAt = null;
  }
  get configured() { return Boolean(this.key && this.secret); }
  snapshot() {
    return {configured: this.configured, connected: this.connected, subscribed: this.subscribed,
      error: this.error, feed: 'IEX', accuracy: 'quote-classified estimate',
      initializedAt: this.initializedAt,
      feedDiagnostics: {
        tradeFrames: this.tradeFrames,
        quoteFrames: this.quoteFrames,
        lastTradeFrameAt: this.lastTradeFrameAt,
        lastQuoteFrameAt: this.lastQuoteFrameAt,
      },
      ...this.engine.state()};
  }
  emitStatus() { broadcast('snapshot', this.snapshot()); }
  start() {
    if (!this.configured) {
      this.error = 'Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env, then restart npm run dev.';
      this.emitStatus(); return;
    }
    if (this.tick) return;
    this.stopped = false;
    this.tick = setInterval(() => {
      this.engine.prune();
      this.emitStatus();
    }, 1000);
    this.connect();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.tick);
    this.tick = null;
    if (this.connection) this.connection.close();
    this.connection = null;
  }
  scheduleRetry() {
    if (this.stopped || !this.configured || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, Math.min(30000, 2000 * (2 ** Math.min(this.attempts++, 4))));
  }
  connect() {
    if (this.stopped) return;
    const socket = new this.WS(FEED_URL);
    this.connection = socket;
    let authTimer = null;
    socket.on('open', () => {
      authTimer = setTimeout(() => socket.terminate(), 10000);
      socket.send(JSON.stringify({action:'auth', key:this.key, secret:this.secret}));
    });
    socket.on('message', raw => {
      let frames;
      try { frames = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(frames)) return;
      for (const frame of frames) {
        if (frame.T === 'success' && frame.msg === 'authenticated') {
          this.authenticated = true;
          clearTimeout(authTimer);
          socket.send(JSON.stringify({action:'subscribe', trades:symbols, quotes:symbols}));
        } else if (frame.T === 'subscription') {
          this.subscribed = symbols.every(s => frame.trades?.includes(s) && frame.quotes?.includes(s));
          this.connected = this.subscribed;
          this.attempts = 0;
          this.error = this.subscribed ? '' : 'Alpaca did not subscribe to both ETF trades and quotes.';
          this.emitStatus();
        } else if (frame.T === 'error') {
          this.error = `Alpaca feed: ${String(frame.msg || frame.code || 'unknown error').slice(0, 220)}`;
          this.emitStatus();
          if ([401, 402, 405, 406, 409].includes(Number(frame.code))) {
            this.stopped = true; // Avoid hammering invalid credentials / subscription errors.
          }
          socket.close();
        } else if (this.subscribed && frame.T === 'q') {
          this.quoteFrames += 1;
          this.lastQuoteFrameAt = new Date().toISOString();
          this.engine.quote(frame);
        } else if (this.subscribed && frame.T === 't') {
          this.tradeFrames += 1;
          this.lastTradeFrameAt = new Date().toISOString();
          this.engine.trade(frame);
        }
      }
    });
    socket.on('error', err => {
      this.error = `IEX connection: ${String(err.message).slice(0, 180)}`;
      this.emitStatus();
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      if (this.connection === socket) this.connection = null;
      this.connected = false;
      this.authenticated = false;
      this.subscribed = false;
      this.engine.queues.clear();
      this.engine.crossings.clear();
      this.emitStatus();
      this.scheduleRetry();
    });
  }
}

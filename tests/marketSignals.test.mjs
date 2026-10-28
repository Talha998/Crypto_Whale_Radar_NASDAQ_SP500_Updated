import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMarketSignals, normalizeBars, latestSnapshot, isUsRegularSession } from '../src/markets/marketSignals.js';
import { getMarketSeries } from '../market-api.mjs';

const bars = Array.from({ length: 12 }, (_, i) => ({
  datetime: `2026-10-20 10:${String(i * 5).padStart(2, '0')}:00`,
  open: String(100 + i * 0.14), close: String(100 + i * 0.14),
  high: String(101 + i * 0.14), low: String(99 + i * 0.14), volume: String(1000 + i * 100),
}));

test('signals are price momentum, not whale flow', () => {
  const result = computeMarketSignals('QQQ', bars);
  assert.ok(result.length > 0);
  assert.equal(result[0].kind, 'PRICE_MOMENTUM');
  assert.equal(result[0].side, 'BUY');
  assert.equal(result[0].symbol, 'QQQ');
  assert.ok(result[0].changePct > 0.25);
});

test('invalid bars do not invent signals', () => {
  assert.deepEqual(computeMarketSignals('SPY', [{ datetime: 'invalid', close: 100 }]), []);
  assert.equal(latestSnapshot('SPY', []), null);
  assert.equal(normalizeBars([{ datetime: '2026-10-20 10:00:00', close: -1, open: 1, high: 1, low: 1, volume: 2 }]).length, 0);
});

test('only US regular weekday trading hours report open', () => {
  assert.equal(isUsRegularSession(new Date('2026-10-20T15:00:00Z')), true);
  assert.equal(isUsRegularSession(new Date('2026-10-18T15:00:00Z')), false);
});

test('server requires a configured key and rejects unsupported symbols', async () => {
  assert.equal((await getMarketSeries('QQQ', '')).payload.configured, false);
  assert.equal((await getMarketSeries('INVALID', '')).status, 400);
});

test('server filters third-party payload to price data only', async () => {
  const response = await getMarketSeries('QQQ', 'my-secret-test-key', async url => {
    assert.ok(url.includes('symbol=QQQ'));
    return { ok: true, json: async () => ({ values: bars }) };
  }, 11000000);
  assert.equal(response.status, 200);
  assert.equal(response.payload.bars.length, 12);
  assert.ok(!JSON.stringify(response.payload).includes('my-secret'));
});

test('missing bars do not create false 15-minute momentum', () => {
  const gap = bars.map(x => ({...x}));
  gap[7].datetime = '2026-10-20 11:35:00';
  const results = computeMarketSignals('SPY', gap);
  assert.ok(results.every(s => /^2026-10-20 10:/.test(s.time)));
});

test('5-minute server cache suppresses redundant provider calls', async () => {
  let called = 0;
  const fetcher = async () => { called++; return { ok: true, json: async () => ({ values: bars }) }; };
  const first = await getMarketSeries('SPY', 'local-only-key', fetcher, 22200000);
  const second = await getMarketSeries('SPY', 'local-only-key', fetcher, 22205000);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(called, 1);
  assert.ok(second.payload.cacheAgeSeconds > 0);
});

test('ETF candle turnover is total volume times close; never claimed as aggressor BUY or SELL', () => {
  const signals = computeMarketSignals('QQQ', bars);
  assert.ok(signals.length > 0);
  const latest = signals.at(-1);
  assert.equal(latest.turnoverUsd, latest.volume * latest.price);
  assert.equal(latest.kind, 'PRICE_MOMENTUM');
  assert.equal(latest.tradeCount, undefined);
  assert.equal(latest.buyVolume, undefined);
  assert.equal(latest.sellVolume, undefined);
});

test('absent ETF candle volume must remain unavailable, not a fictitious whale USD value', () => {
  const copy = bars.map(x => ({ ...x }));
  for (const row of copy) row.volume = undefined;
  const signals = computeMarketSignals('SPY', copy);
  assert.ok(signals.length > 0);
  assert.ok(signals.every(signal => signal.turnoverUsd === null && signal.volume === null));
});

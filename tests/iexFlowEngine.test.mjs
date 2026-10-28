import test from 'node:test';
import assert from 'node:assert/strict';
import {IexFlowEngine, classifyIexTrade, IEX_DEFAULT_THRESHOLD, IEX_MIN_THRESHOLD, normalizeIexThreshold} from '../src/markets/iexFlowEngine.js';

const time = new Date('2026-10-20T15:30:00.000Z').getTime();
const iso = ms => new Date(ms).toISOString();
const quote = t => ({T:'q', S:'QQQ', bp:500.00, ap:500.02, t:iso(t)});
const trade = (t, p, s) => ({T:'t', S:'QQQ', p, s, t:iso(t)});

test('no quote, stale quote, future quote, and midspread trade are UNKNOWN', () => {
  const buy = trade(time, 500.02, 10);
  assert.equal(classifyIexTrade(buy, undefined), 'UNKNOWN');
  assert.equal(classifyIexTrade(buy, {time: time - 2500, bid:500, ask:500.02}), 'UNKNOWN');
  assert.equal(classifyIexTrade(buy, {time: time + 10, bid:500, ask:500.02}), 'UNKNOWN');
  assert.equal(classifyIexTrade(trade(time, 500.01, 10), {time, bid:500,ask:500.02}), 'UNKNOWN');
});

test('at ask is estimated BUY, at bid is estimated SELL, not identified whales', () => {
  assert.equal(classifyIexTrade(trade(time,500.02,10), {time, bid:500,ask:500.02}), 'BUY');
  assert.equal(classifyIexTrade(trade(time,500.00,10), {time,bid:500,ask:500.02}), 'SELL');
});

test('crossing threshold uses trade counts, US dollars, VWAP and cooldown', () => {
  const signaled = [];
  const engine = new IexFlowEngine({threshold: 50_000, onSignal: x => signaled.push(x)});
  assert.equal(engine.threshold, 5_000_000, 'low config must not permit sub-$5M alerts');
  engine.quote(quote(time - 100));
  engine.trade(trade(time, 500.02, 6000), time);
  assert.equal(signaled.length, 0);
  engine.trade(trade(time + 500, 500.02, 5000), time + 500);
  assert.equal(signaled.length, 1);
  const signal = signaled[0];
  assert.equal(signal.kind, 'ESTIMATED_IEX_FLOW');
  assert.equal(signal.index, 'NASDAQ-100');
  assert.equal(signal.side, 'BUY');
  assert.equal(signal.tradeCount, 2);
  assert.equal(signal.qty, 11000);
  assert.equal(signal.notional, 5_500_220);
  assert.equal(signal.vwap, 500.02);
  assert.equal(signal.oppositeNotional, 0);
  assert.ok(!('people' in signal));
  engine.trade(trade(time + 1000, 500.02, 20), time + 1000);
  assert.equal(signaled.length, 1);
});

test('UNKNOWN print is not silently converted to BUY or SELL', () => {
  const engine = new IexFlowEngine({threshold: 100});
  engine.trade(trade(time, 500.01, 100), time);
  const snap = engine.snapshot('QQQ');
  assert.equal(snap.BUY.usd, 0);
  assert.equal(snap.SELL.usd, 0);
  assert.equal(snap.UNKNOWN.trades, 1);
  assert.equal(snap.UNKNOWN.usd, 50_001);
});

test('60 second window expires and reaction is actual subsequent trade price', () => {
  const events = [];
  const updates = [];
  const engine = new IexFlowEngine({threshold: IEX_MIN_THRESHOLD, onSignal: e => events.push(e), onUpdate: e => updates.push(e)});
  engine.quote(quote(time));
  engine.trade(trade(time, 500.02, 10000), time);
  assert.equal(events.length, 1);
  assert.equal(events[0].reactionStatus, 'PENDING');
  engine.trade(trade(time + 30_000, 500.52, 1), time + 30_000);
  assert.equal(updates.find(e => e.id === events[0].id)?.reactionStatus, 'READY');
  engine.prune(time + 61_000);
  assert.equal(engine.snapshot('QQQ').totalTrades, 1);
  engine.prune(time + 100_000);
  assert.equal(engine.snapshot('QQQ').totalTrades, 0);
});

test('feed tracks only ETF prints for QQQ and SPY, not index prints', () => {
  const engine = new IexFlowEngine({threshold: IEX_DEFAULT_THRESHOLD});
  engine.trade({T:'t', S:'NDX', p:500, s:1000, t:iso(time)}, time);
  engine.trade({T:'t', S:'ES', p:500, s:1000, t:iso(time)}, time);
  assert.equal(engine.state().events.length, 0);
  assert.equal(engine.snapshot('QQQ').totalTrades, 0);
});


test('IEX signal minimum is always $5M, including bad and missing env settings', () => {
  assert.equal(IEX_MIN_THRESHOLD, 5_000_000);
  assert.equal(IEX_DEFAULT_THRESHOLD, 5_000_000);
  for (const requested of [undefined, null, '', 0, -200, 'bad', 10_000, 50_000, 4_999_999]) {
    assert.equal(normalizeIexThreshold(requested), 5_000_000);
  }
  assert.equal(normalizeIexThreshold(10_000_000), 10_000_000);
});

test('QQQ exactly below $5M never emits, above $5M emits at once', () => {
  const alerts = [];
  const engine = new IexFlowEngine({onSignal: x => alerts.push(x)});
  engine.quote(quote(time));
  engine.trade(trade(time + 10, 500.02, 9999), time + 10);
  assert.equal(alerts.length, 0);
  engine.trade(trade(time + 20, 500.02, 1), time + 20);
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].notional >= 5_000_000);
  assert.equal(alerts[0].threshold, 5_000_000);
});

test('SPY estimated SELL requires $5M of classified SELL prints (not total turnover)', () => {
  const alerts = [];
  const engine = new IexFlowEngine({onSignal: x => alerts.push(x)});
  const spyQuote = {T:'q',S:'SPY',bp:625.00,ap:625.02,t:iso(time)};
  engine.quote(spyQuote);
  engine.trade({T:'t',S:'SPY',p:625.00,s:7500,t:iso(time + 20)}, time + 20); // $4.6875M SELL
  engine.trade({T:'t',S:'SPY',p:625.02,s:10000,t:iso(time + 30)}, time + 30); // $6.25M BUY
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].side, 'BUY');
  engine.trade({T:'t',S:'SPY',p:625.00,s:501,t:iso(time + 40)}, time + 40); // SELL crosses $5M
  assert.equal(alerts.length, 2);
  assert.equal(alerts[1].side, 'SELL');
  assert.equal(alerts[1].notional, 5_000_625);
  assert.equal(alerts[1].oppositeNotional, 6_250_200);
});

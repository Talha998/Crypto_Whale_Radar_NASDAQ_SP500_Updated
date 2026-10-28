import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUnifiedSignals} from '../src/markets/unifiedSignals.js';

const crypto = (id, time, side='BUY') => ({id, coin:'BTC', symbol:'BTCUSDT', side, notional:6e6, windowSec:60, time});
const iex = (id, time, symbol='QQQ', notional=6e6, side='SELL') => ({id, index:symbol==='QQQ'?'NASDAQ-100':'S&P 500', symbol, side, notional, time, windowSeconds:60});

test('merges Binance and IEX feeds by latest timestamp with distinct keys', () => {
  const list = buildUnifiedSignals({cryptoEvents:[crypto('same',100)], iexEvents:[iex('same',200)]});
  assert.deepEqual(list.map(x=>x.key), ['iex:same','crypto:same']);
});
test('keeps IEX minimum $5M despite lower crypto threshold', () => {
  const list = buildUnifiedSignals({cryptoEvents:[crypto('c',100)], iexEvents:[iex('a',101,'QQQ',4_999_999),iex('b',102,'SPY',5e6)], cryptoThreshold:1e6});
  assert.deepEqual(list.map(x=>x.key),['iex:b','crypto:c']);
});
test('respects market, side and search filters for both source feeds', () => {
  const data = {cryptoEvents:[crypto('c',100)],iexEvents:[iex('q',102,'QQQ',6e6,'BUY'),iex('s',103,'SPY',6e6,'SELL')]};
  assert.deepEqual(buildUnifiedSignals({...data,marketFilter:'SPY'}).map(x=>x.key),['iex:s']);
  assert.deepEqual(buildUnifiedSignals({...data,marketFilter:'CRYPTO'}).map(x=>x.key),['crypto:c']);
  assert.deepEqual(buildUnifiedSignals({...data,sideFilter:'BUY'}).map(x=>x.key),['iex:q','crypto:c']);
  assert.deepEqual(buildUnifiedSignals({...data,query:'NASDAQ'}).map(x=>x.key),['iex:q']);
});
test('crypto rolling window filter does not hide fixed 60s ETF events', () => {
  assert.deepEqual(buildUnifiedSignals({cryptoEvents:[crypto('c',100)],iexEvents:[iex('q',102)],cryptoWindowSec:30}).map(x=>x.key),['iex:q']);
});
test('rejects subminimum, other instrument, malformed time and wrong IEX window', () => {
  const all = [iex('a',100,'QQQ',NaN),iex('b',100,'AAPL'),{...iex('c',105),windowSeconds:30},iex('d',NaN)];
  assert.equal(buildUnifiedSignals({iexEvents:all}).length,0);
});

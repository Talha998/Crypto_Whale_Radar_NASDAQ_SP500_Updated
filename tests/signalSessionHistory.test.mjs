import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAllSessionSignals, getSignalClearTime, getCryptoSessionSignals,
  getIexSessionSignals, saveCryptoSessionSignals, saveIexSessionSignals,
  mergeSessionSignals,
} from '../src/markets/signalSessionHistory.js';

const row = (id, time, extras = {}) => ({id, time, side: 'BUY', notional: 6_000_000, ...extras});

test('retains every signal instead of automatically truncating to 150', () => {
  const baseline = getSignalClearTime() + 1000;
  const many = Array.from({length: 301}, (_, i) => row(`c${i}`, baseline + i));
  saveCryptoSessionSignals(many);
  assert.equal(getCryptoSessionSignals().length, 301);
});

test('crypto updates never overwrite ETF history (and vice versa)', () => {
  const t = getSignalClearTime() + 2000;
  saveIexSessionSignals([row('etf', t)]);
  saveCryptoSessionSignals([row('crypto', t)]);
  assert.equal(getIexSessionSignals()[0].id, 'etf');
  assert.equal(getCryptoSessionSignals()[0].id, 'crypto');
});

test('SSE snapshots merge with existing session history and deduplicate IDs', () => {
  const t = getSignalClearTime() + 3000;
  const events = mergeSessionSignals([row('older', t), row('same', t + 1)],
    [row('same', t + 1, {notional: 7_000_000}), row('new', t + 2)]);
  assert.deepEqual(events.map(e => e.id), ['new', 'same', 'older']);
  assert.equal(events[1].notional, 7_000_000);
});

test('stale pending snapshot never overwrites a measured reaction', () => {
  const t = getSignalClearTime() + 4000;
  const [event] = mergeSessionSignals([row('e', t, {reactionStatus:'READY', reaction30sPct:2.5})],
    [row('e', t, {reactionStatus:'PENDING', reaction30sPct:null})]);
  assert.equal(event.reactionStatus, 'READY');
  assert.equal(event.reaction30sPct, 2.5);
});

test('explicit clear removes both histories and suppresses older snapshots', () => {
  const t = getSignalClearTime() + 5000;
  saveCryptoSessionSignals([row('crypto', t)]);
  saveIexSessionSignals([row('etf', t)]);
  const clearedAt = clearAllSessionSignals(t + 10);
  assert.equal(getCryptoSessionSignals().length, 0);
  assert.equal(getIexSessionSignals().length, 0);
  assert.deepEqual(mergeSessionSignals([], [row('etf', t)], clearedAt), []);
  assert.equal(mergeSessionSignals([], [row('fresh', clearedAt + 1)], clearedAt).length, 1);
});

test('saved events are rehydrated on simulated refresh of the same tab', async () => {
  const values = new Map();
  const originalWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    const live = await import('../src/markets/signalSessionHistory.js?tab-live');
    const t = Date.now() + 100;
    live.saveCryptoSessionSignals([row('btc', t)]);
    live.saveIexSessionSignals([row('spy', t + 1)]);
    const reloaded = await import('../src/markets/signalSessionHistory.js?tab-reloaded');
    assert.deepEqual(reloaded.getCryptoSessionSignals().map(e => e.id), ['btc']);
    assert.deepEqual(reloaded.getIexSessionSignals().map(e => e.id), ['spy']);
    reloaded.clearAllSessionSignals(t + 10);
    const afterClear = await import('../src/markets/signalSessionHistory.js?tab-cleared');
    assert.deepEqual(afterClear.getCryptoSessionSignals(), []);
    assert.deepEqual(afterClear.getIexSessionSignals(), []);
  } finally {
    globalThis.window = originalWindow;
  }
});

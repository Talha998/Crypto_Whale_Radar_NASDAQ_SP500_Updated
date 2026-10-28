import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPakistanTime, formatPakistanDate, formatPakistanDateTime,
  parseNewYorkMarketTime, toAbsoluteMarketDate,
} from '../src/markets/pakistanTime.js';

test('Oct 21 2026 3:03:57 PM EDT becomes next day 12:03:57 AM PKT', () => {
  const ts = '2026-10-21T19:03:57.000Z';
  assert.equal(formatPakistanTime(ts), '12:03:57 AM PKT');
  assert.equal(formatPakistanDate(ts), 'Oct 22, 2026');
  assert.equal(formatPakistanDateTime(ts), '12:03:57 AM PKT · Oct 22, 2026');
});

test('NY 15:03 October OHLCV wall time converts to PKT midnight next day', () => {
  const nyTime = '2026-10-21 15:03:57';
  assert.equal(parseNewYorkMarketTime(nyTime)?.toISOString(), '2026-10-21T19:03:57.000Z');
  assert.equal(formatPakistanDateTime(nyTime), '12:03:57 AM PKT · Oct 22, 2026');
});

test('Winter NY time automatically uses EST offset', () => {
  assert.equal(parseNewYorkMarketTime('2026-12-21 15:03:57')?.toISOString(), '2026-12-21T20:03:57.000Z');
  assert.equal(formatPakistanDateTime('2026-12-21 15:03:57'), '01:03:57 AM PKT · Dec 22, 2026');
});

test('Date, milliseconds and timezone ISO strings parse consistently', () => {
  const time = new Date('2026-10-21T19:03:45Z');
  for (const value of [time, time.getTime(), '2026-10-21T19:03:45Z', '2026-10-21T15:03:45-04:00']) {
    assert.equal(formatPakistanTime(value), '12:03:45 AM PKT');
    assert.equal(toAbsoluteMarketDate(value)?.toISOString(), time.toISOString());
  }
});

test('Missing and invalid dates stay unavailable', () => {
  assert.equal(formatPakistanTime(''), '—');
  assert.equal(formatPakistanDateTime('not-a-time'), '—');
  assert.equal(parseNewYorkMarketTime('2026-10-21 02:30:00')?.toISOString(), '2026-10-21T06:30:00.000Z');
});

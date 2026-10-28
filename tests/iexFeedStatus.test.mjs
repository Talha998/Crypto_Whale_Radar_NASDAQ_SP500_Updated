import test from 'node:test';
import assert from 'node:assert/strict';
import {explainIexFeed} from '../src/markets/iexFeedStatus.js';
const status = {configured: true, connected: true, subscribed: true,
 feedDiagnostics: {tradeFrames: 0, quoteFrames: 0}, snapshots:{}};
test('connection during closed session does not imply trades', () => {
 const msg = explainIexFeed(status, false);
 assert.match(msg, /Outside the regular US trading session/);
});
test('open with no prints yields explicit diagnostic', () => {
 const msg = explainIexFeed(status, true);
 assert.match(msg, /no QQQ\/SPY trade prints/);
});
test('recent trades but no rolling volume are diagnosed', () => {
 const msg = explainIexFeed({...status,
  feedDiagnostics:{lastTradeFrameAt:new Date(1000000).toISOString()},
  snapshots: {QQQ:{totalUsd:0}, SPY:{totalUsd:0}}}, true, 1000000);
 assert.match(msg, /current rolling 60-second window/);
});
test('active IEX prints still require $5M per side', () => {
 const msg = explainIexFeed({...status,
  feedDiagnostics:{lastTradeFrameAt:new Date(1000000).toISOString()},
  snapshots: {QQQ:{totalUsd:75000}, SPY:{totalUsd:0}}}, true, 1000000);
 assert.match(msg, /5,000,000/);
});

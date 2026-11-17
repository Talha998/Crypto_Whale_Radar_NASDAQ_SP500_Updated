import test from 'node:test';
import assert from 'node:assert/strict';
import {NetflowAlarmGate} from '../src/netflow/netflowAlarm.js';
const event=(overrides={})=>({id:'btc-buy',symbol:'BTC',windowSeconds:60,side:'BUY',net:5000000,time:100000,...overrides});
test('positive and negative $5M events both ring once when armed',()=>{
 const gate=new NetflowAlarmGate();gate.arm(99000);
 assert.equal(gate.accept(event(),100000),true);
 assert.equal(gate.accept(event({id:'btc-sell',side:'SELL',net:-5000000}),100000),true);
 assert.equal(gate.accept(event(),100001),false);
});
test('below threshold never rings even when total turnover exceeds $5M',()=>{
 const gate=new NetflowAlarmGate();gate.arm(99000);
 assert.equal(gate.accept(event({net:4999999,buy:20e6,sell:15000001}),100000),false);
 assert.equal(gate.accept(event({net:-4999999,side:'SELL'}),100000),false);
});
test('old cached events and events observed before arming never replay',()=>{
 const gate=new NetflowAlarmGate();gate.arm(100000);
 assert.equal(gate.accept(event({time:99999}),100000),false);
 assert.equal(gate.accept(event({time:100000}),116000),false);
 assert.equal(gate.accept(event({time:120001}),100000),false);
});
test('disabled sound still permits future arming without replaying historical events',()=>{
 const gate=new NetflowAlarmGate();assert.equal(gate.accept(event(),100000),false);
 gate.arm(100000);gate.disable();assert.equal(gate.accept(event(),100000),false);
 gate.arm(101000);assert.equal(gate.accept(event(),101000),false);
 assert.equal(gate.accept(event({time:101001}),101001),true);
});
test('same direction cannot ring twice through different transports within one minute',()=>{
 const gate=new NetflowAlarmGate();gate.arm(99000);
 assert.equal(gate.accept(event(),100000),true);
 assert.equal(gate.accept(event({id:'rest-btc-buy',time:100001}),100001),false);
 assert.equal(gate.accept(event({id:'later-btc-buy',time:160000}),160000),true);
});
test('each coin and direction can alert independently',()=>{
 const gate=new NetflowAlarmGate();gate.arm(99000);
 assert.equal(gate.accept(event(),100000),true);
 assert.equal(gate.accept(event({id:'eth-buy',symbol:'ETH'}),100000),true);
 assert.equal(gate.accept(event({id:'btc-sell',side:'SELL',net:-6e6}),100000),true);
});
test('historical periods, unsupported coins and contradictory directions cannot sound',()=>{
 const gate=new NetflowAlarmGate();gate.arm(99000);
 for(const patch of [{windowSeconds:300},{symbol:'DOGE'},{net:NaN},{side:'SELL'},{time:null},{id:null}])assert.equal(gate.accept(event(patch),100000),false);
});

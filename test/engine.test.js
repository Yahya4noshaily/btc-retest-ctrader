import test from 'node:test'
import assert from 'node:assert/strict'
import {analyse,closedBars} from '../public/engine.js'
const make=(values,period,start=0)=>values.map((close,i)=>({t:start+i*period*60000,high:close+1,low:close-1,open:close,close}))
const trend=make([100,101,104,101,99,101,106,104,102,104,105],5)
const setup=make([105,106,110,108,106,108,112,113],1,3600000)
const mirror=bars=>bars.map(b=>({...b,open:240-b.open,high:240-b.low,low:240-b.high,close:240-b.close}))
const retest={...setup.at(-1),low:111}
test('requires a separate retest after breakout',()=>{
 assert.equal(analyse(setup.slice(0,-1),trend).phase,'retest')
 assert.equal(analyse(setup,trend).phase,'retest')
})
test('confirms at the closing bar with symmetric buy and sell stops',()=>{
 const bars=[...setup.slice(0,-1),retest]
 const buy=analyse(bars,trend),sell=analyse(mirror(bars),mirror(trend))
 assert.equal(buy.phase,'signal'); assert.equal(buy.trend,1);assert.equal(buy.stop,110.99)
 assert.equal(sell.phase,'signal');assert.equal(sell.trend,-1);assert.equal(sell.stop,129.01)
 assert.notEqual(analyse([...bars,{...retest,t:retest.t+60000}],trend).phase,'signal')
})
test('no signal without trend or across a missing bar',()=>{
 assert.notEqual(analyse(setup,[]).phase,'signal')
 assert.notEqual(analyse([...setup.slice(0,-1),{...retest,t:retest.t+60000}],trend).phase,'signal')
})
test('decode, sort, deduplicate and drop the forming candle',()=>{
 const bar={utcTimestampInMinutes:10,low:12345000,deltaOpen:20,deltaHigh:90,deltaClose:70}
 assert.deepEqual(closedBars([{...bar,utcTimestampInMinutes:11},bar,bar],1,11*60000),[{t:600000,low:123.45,open:123.4502,high:123.4509,close:123.4507}])
})
test('near retest is aggressive only; conservative requires directional close',()=>{
 const near={...retest,low:111.2,open:112,high:114}
 const bars=[...setup.slice(0,-1),near]
 assert.equal(analyse(bars,trend,.01,'aggressive').phase,'signal')
 assert.notEqual(analyse(bars,trend,.01,'balanced').phase,'signal')
 const strict=[...setup.slice(0,-1),{...retest,open:112,high:113.1}]
 assert.equal(analyse(strict,trend,.01,'conservative').phase,'signal')
 assert.equal(analyse(mirror(strict),mirror(trend),.01,'conservative').phase,'signal')
 assert.notEqual(analyse([...setup.slice(0,-1),retest],trend,.01,'conservative').phase,'signal')
})

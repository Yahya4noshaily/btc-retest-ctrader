import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {scan,message} from '../server/market.js'
import {modes} from '../public/engine.js'

const due=68*60000
function wireBars(period,buy) {
  const closes=period===1?[105,106,110,108,106,108,112,113]:[100,101,104,101,99,101,106,104,102,104,105]
  return closes.map((price,index)=>{
    // 111.2 is just above the broken 111 pivot. Only the aggressive mode qualifies.
    const near=period===1 && index===closes.length-1
    let low=near?111.2:price-1,high=price+1,close=price
    if(!buy){[low,high]=[240-high,240-low];close=240-price}
    return {utcTimestampInMinutes:(period===1?60:10)+index*period,low:Math.round(low*1e5),
      deltaHigh:Math.round((high-low)*1e5),deltaOpen:Math.round((close-low)*1e5),deltaClose:Math.round((close-low)*1e5)}
  })
}
function dashboard(signal) {
  const file=readFileSync(new URL('../public/cloud.js',import.meta.url),'utf8').replace(/^import .*$/gm,'')
  const fields=new Map()
  const element=id=>{
    if(!fields.has(id))fields.set(id,{value:'',textContent:'',replaceChildren(...rows){this.rows=rows}})
    return fields.get(id)
  }
  let now=due+2500
  const state={enabled:true,started:due-60000,lastCheck:now,account:1,mode:'aggressive',history:[signal],note:'اكتملت إشارة الدخول'}
  const ctx={modes,Date:class extends Date{static now(){return now}},localMonitorRunning:()=>false,
    cloudCredentials:()=>({account:1}),document:{hidden:true,getElementById:element,createElement:()=>({}),addEventListener(){}},
    setTimeout:()=>1,clearTimeout(){},state}
  vm.runInNewContext(file+'\ndraw(state)',ctx)
  const heading=element('signal').textContent,reason=element('reason').textContent
  now=due+15000;vm.runInContext('draw(state)',ctx)
  return {heading,reason,expired:element('signal').textContent,history:element('cloudHistory').rows[0].textContent}
}

for(const buy of [true,false])test('aggressive '+(buy?'buy':'sell')+' reaches the card, history and Telegram formatter',async t=>{
  const now=due+2000
  t.mock.method(Date,'now',()=>now)
  let minuteRequests=0
  class Socket {
    static OPEN=1
    readyState=1
    constructor(){queueMicrotask(()=>this.onopen())}
    close(){this.readyState=3;this.onclose?.()}
    send(data){
      const {payloadType:type,payload:p,clientMsgId}=JSON.parse(data)
      let payload={}
      if(type===2127)queueMicrotask(()=>this.onmessage({data:JSON.stringify({payloadType:2131,payload:{symbolId:7,timestamp:now,bid:buy?11300000:12680000,ask:buy?11320000:12700000}})}))
      if(type===2137){
        let bars=wireBars(p.period,buy)
        if(p.period===1 && ++minuteRequests===1)bars=bars.slice(0,-1)
        payload={trendbar:bars}
      }
      queueMicrotask(()=>this.onmessage({data:JSON.stringify({payloadType:type+1,payload,clientMsgId})}))
    }
  }
  const original=globalThis.WebSocket
  globalThis.WebSocket=Socket;t.after(()=>{globalThis.WebSocket=original})
  const result=await scan({env:'demo',account:1,symbolId:7,digits:2,mode:'aggressive'},due)
  assert.equal(minuteRequests,2)
  const signal=result.signal,side=buy?'شراء':'بيع'
  assert.equal(signal.buy,buy);assert.equal(signal.mode,'aggressive')
  assert.equal(signal.entry,buy?113.2:126.8)
  assert.ok(message(signal).includes(side+' · هجومي'))
  const card=dashboard(signal)
  assert.equal(card.heading,side+' BTCUSD · هجومي')
  assert.ok(card.reason.includes(String(signal.entry)))
  assert.ok(card.history.includes('هجومي · '+side))
  assert.equal(card.expired,'انتهت نافذة الدخول')
})

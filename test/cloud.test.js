import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
const source=readFileSync(new URL('../server/jobs.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
function setup(override={}){
 const now=Math.floor(Date.now()/60000)*60000+2000
 const due=now-2000
 let state={enabled:true,revision:'1',tgOn:true,tg:{},history:[],...override}
 const sends=[],alerts=[],beats=[]
 const ctx={Date:class extends Date{static now(){return now}},Math,
   send:async(...args)=>sends.push(args),pulse:async(_id,p)=>beats.push(p),read:async()=>({value:structuredClone(state),etag:'abc'}),
   write:async(_id,s)=>{state=s},message:()=>'signal',telegram:async(...args)=>alerts.push(args),
   scan:async()=>({note:'OK',signal:{due}})}
 const consume=vm.runInNewContext(source+'\nconsume',ctx)
 const run=(t=due)=>consume({id:'owner',revision:'1',due:t})
 return {run,sends,alerts,beats,due,history:()=>state.history}
}
test('closed browser worker schedules next minute and deduplicates entry delivery',async()=>{
 const j=setup()
 await j.run();await j.run()
 assert.equal(j.alerts.length,1)
 assert.equal(j.history().length,1)
 assert.equal(j.sends[0][1].due,j.due+60000)
 assert.equal(j.sends[0][2].idempotencyKey,j.sends[1][2].idempotencyKey)
})
test('stopped, stale and replaced consumers cannot issue alerts',async()=>{
 for(const config of [{enabled:false},{revision:'2'}]){
   const j=setup(config);await j.run();assert.equal(j.sends.length,0);assert.equal(j.alerts.length,0)
 }
 const j=setup();await j.run(j.due-60000);assert.equal(j.alerts.length,0);assert.equal(j.sends.length,1)
})
test('Telegram can be disabled while signals continue to be recorded',async()=>{
 const j=setup({tgOn:false});await j.run();assert.equal(j.history().length,1);assert.equal(j.alerts.length,0)
})

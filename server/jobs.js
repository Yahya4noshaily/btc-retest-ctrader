import {send} from '@vercel/queue'
import {read,write,pulse} from './state.js'
import {scan,message,telegram} from './market.js'
export async function enqueue(id,revision,due){
  await send('btc-monitor-v1',{id,revision,due},{region:'iad1',delaySeconds:Math.max(0,Math.floor((due-Date.now()-5000)/1000)),idempotencyKey:[id,revision,due].join(':'),retentionSeconds:1800})
}
async function renew(id,c){
  const {value,etag}=await read(id,true)
  if(!value?.enabled || value.revision!==c.revision || value.renewingUntil>Date.now())return null
  if(value.expiresAt>Date.now()+3600000)return value
  value.renewingUntil=Date.now()+60000
  await write(id,value,etag)
  const url=new URL('https://openapi.ctrader.com/apps/token')
  url.search=new URLSearchParams({grant_type:'refresh_token',client_id:value.clientId,client_secret:value.clientSecret,refresh_token:value.refreshToken})
  const r=await fetch(url,{method:'POST',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(7000)})
  const data=await r.json()
  if(!data.accessToken || !data.refreshToken)throw Error('تعذر تجديد تفويض cTrader. أعد التفويض من الموقع.')
  const current=await read(id,true)
  if(current.value?.revision!==c.revision || !current.value.enabled)return null
  Object.assign(current.value,{accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:Date.now()+1000*Number(data.expiresIn||2628000),renewingUntil:0})
  await write(id,current.value,current.etag)
  return current.value
}
export async function consume({id,revision,due,probe}){
  if(probe){await pulse(id,{probe,at:Date.now()});return}
  let {value:c}=await read(id)
  if(!c?.enabled || c.revision!==revision)return
  await enqueue(id,revision,Math.max(due+60000,(Math.floor(Date.now()/60000)+1)*60000))
  if(Date.now()>due+12000)return
  let note
  try{
    if(c.refreshToken && c.expiresAt && Date.now()+3600000>c.expiresAt){c=await renew(id,c);if(!c)return}
    const result=await scan(c,due)
    note=result.note
    if(result.signal){
      const current=await read(id,true)
      const state=current.value
      if(!state?.enabled || state.revision!==revision || state.history?.some(s=>s.due===due))return
      const signal=result.signal
      if(Date.now()>due+12000){note='انتهت نافذة الدخول قبل الإرسال';return}
      state.history=[signal,...(state.history||[])].slice(0,20)
      await write(id,state,current.etag)
      if(state.tgOn && Date.now()<=due+12000){
        try{await telegram(state.tg,'sendMessage',message(signal))}
        catch{note='تعذر تسليم الإشارة إلى تيليجرام. اختبر الربط من الموقع.'}
      }
    }
  } catch(err){
    note=/cTrader · [A-Z_]+/.exec(err.message)?.[0] || (/تفويض/.test(err.message)?'يلزم تجديد تفويض cTrader':'تعذر فحص الوسيط. ستُعاد المحاولة عند الدقيقة التالية.')
  } finally {
    await pulse(id,{revision,at:Date.now(),note})
  }
}

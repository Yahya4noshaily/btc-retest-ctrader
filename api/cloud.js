import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto'
import {send} from '@vercel/queue'
import {read,write,owner,idFor,cookie,heartbeat} from '../server/state.js'
import {identify,telegram} from '../server/market.js'
import {enqueue} from '../server/jobs.js'
import {modes} from '../public/engine.js'
function invalid(message){throw Object.assign(Error(message),{expose:true})}
function credentials(raw){
  if(!['demo','live'].includes(raw?.env)||!Number.isSafeInteger(raw.account)||raw.account<=0 ||
    ![raw.clientId,raw.clientSecret,raw.accessToken].every(s=>typeof s==='string'&&s.length>0&&s.length<=2048))invalid('اربط cTrader واختر الحساب أولًا.')
  return {env:raw.env,account:raw.account,clientId:raw.clientId,clientSecret:raw.clientSecret,accessToken:raw.accessToken,
    refreshToken:String(raw.refreshToken||'').slice(0,2048),expiresAt:Number(raw.expiresAt)||0}
}
async function status(id){
  if(!id)return {enabled:false}
  const {value}=await read(id)
  if(!value)return {enabled:false}
  const beat=await heartbeat(id)
  return {enabled:value.enabled,env:value.env,account:value.account,mode:value.mode,tgOn:!!value.tgOn,hasTelegram:!!value.tg,
    history:value.history||[],started:value.started,lastCheck:beat?.revision===value.revision?beat.at:null,note:beat?.revision===value.revision?beat.note:''}
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  try{
    let id=owner(req)
    if(req.method==='GET')return res.json(await status(id))
    if(req.method!=='POST')return res.status(405).end()
    if(req.headers.origin!=='https://'+req.headers.host || !req.headers['content-type']?.startsWith('application/json'))return res.status(403).end()
    const b=req.body||{}
    // A signed, short-lived deployment check exercises the queue without broker credentials.
    if(b.action==='probe'){
      const sig=createHmac('sha256',Buffer.from(process.env.MONITOR_KEY,'base64')).update('probe/'+b.ts).digest('hex')
      if(!Number.isSafeInteger(b.ts)||Math.abs(Date.now()-b.ts)>120000||typeof b.sig!=='string'||!/^[a-f0-9]{64}$/.test(b.sig)||!timingSafeEqual(Buffer.from(sig),Buffer.from(b.sig)))return res.status(403).end()
      const probeId='check-'+b.ts
      if(b.check)return res.json({processed:(await heartbeat(probeId))?.probe===b.ts})
      await send('btc-monitor-v1',{id:probeId,probe:b.ts},{region:'iad1',retentionSeconds:120,idempotencyKey:probeId})
      return res.json({accepted:true})
    }
    if(b.action==='save' && b.credentials){
      const c=credentials(b.credentials)
      const symbol=await identify(c)
      const authorized=idFor(c)
      if(id && id!==authorized && (await read(id,true)).value?.enabled)invalid('أوقف المراقبة السحابية للحساب السابق قبل تبديل الحساب.')
      id=authorized
      b.verified={...c,...symbol}
    } else {delete b.verified}
    if(!id)return res.status(401).json({error:'اربط حساب cTrader ثم اختر حساب التداول لتشغيل المراقبة.'})
    const {value:old,etag}=await read(id,true)
    if(b.action==='stop'){
      if(old)await write(id,{enabled:false,account:old.account,env:old.env,history:old.history||[],mode:old.mode,revision:randomUUID()},etag)
      return res.json({enabled:false})
    }
    if(b.action==='test'){
      if(!old?.enabled || !old.tgOn || !old.tg)invalid('فعّل تيليجرام واحفظ الإعدادات أولًا.')
      await telegram(old.tg,'sendMessage','مرقاب البيتكوين · رسالة اختبار لربط تيليجرام ✅')
      return res.json({sent:true})
    }
    if(b.action!=='save'||!Object.hasOwn(modes,b.mode))invalid('اختر وضع الاستراتيجية.')
    if(!b.verified&&!old?.enabled)invalid('اربط الحساب لبدء المراقبة.')
    let tg=old?.tg
    if(b.tgOn && (b.botToken || b.chat || !tg)){
      if(!/^\d{5,16}:[\w-]{20,100}$/.test(b.botToken||'')||!/^(-?\d{1,20}|@[a-zA-Z0-9_]{5,32})$/.test(b.chat||''))invalid('أدخل Bot Token وChat ID كاملين.')
      tg={token:b.botToken,chat:b.chat}
      await telegram(tg,'getChat')
    }
    const state={...old,...b.verified,enabled:true,revision:randomUUID(),started:Date.now(),mode:b.mode,tgOn:b.tgOn===true,tg,history:old?.history||[]}
    await write(id,state,etag)
    res.setHeader('Set-Cookie',cookie(id))
    try {await enqueue(id,state.revision,(Math.floor(Date.now()/60000)+1)*60000)}
    catch{
      const current=await read(id,true)
      if(current.value?.revision===state.revision)await write(id,{...state,enabled:false},current.etag)
      invalid('تعذر جدولة المراقبة السحابية. أعد تشغيلها من الموقع.')
    }
    return res.json(await status(id))
  }catch(err){
    const safe=err.expose||/^(cTrader · [A-Z_]+$|تيليجرام رفض|رمز BTCUSD|تعذر فتح اتصال cTrader|تعذر تحديد دقة)/.test(err.message)
    return res.status(safe?400:503).json({error:safe?err.message:'تعذر تحديث المراقبة السحابية. أعد المحاولة.'})
  }
}

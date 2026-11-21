import {connect} from '../public/feed.js'
import {analyse,closedBars,modes} from '../public/engine.js'
export const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)))
export async function broker(c,task,onSpot=()=>{}){
  const ws=await connect(c.env==='demo',onSpot,()=>{})
  const base={ctidTraderAccountId:c.account}
  const request=(type,extra={})=>ws.request(type,{...base,...extra})
  try{
    await ws.request(2100,{clientId:c.clientId,clientSecret:c.clientSecret})
    await request(2102,{accessToken:c.accessToken})
    return await task(request)
  }finally{ws.close()}
}
export async function identify(c){
  return broker(c,async request=>{
    const {symbol=[]}=await request(2114)
    const active=symbol.filter(s=>s.enabled!==false)
    const btc=active.find(s=>s.symbolName.toUpperCase()==='BTCUSD')??active.find(s=>/^(BTC|XBT)[\s/._-]*USD(?:$|[._-]|m$)/i.test(s.symbolName))
    if(!btc) throw Error('رمز BTCUSD غير متاح في الحساب.')
    const details=await request(2116,{symbolId:[btc.symbolId]})
    const digits=Number(details.symbol?.[0]?.digits)
    if(!Number.isInteger(digits)||digits<0||digits>10)throw Error('تعذر تحديد دقة السعر.')
    return {symbolId:btc.symbolId,digits}
  })
}
export async function scan(c,due){
  let bid,ask,bidAt=0,askAt=0
  return broker(c,async request=>{
    await request(2127,{symbolId:[c.symbolId],subscribeToSpotTimestamp:true})
    await sleep(due+800-Date.now())
    const bars=async period=>closedBars((await request(2137,{symbolId:c.symbolId,period,count:125,fromTimestamp:due-period*60000*190,toTimestamp:due-1})).trendbar??[],period,due)
    const [m1,m5]=await Promise.all([bars(1),bars(5)])
    if(m1.at(-1)?.t!==due-60000 || m5.at(-1)?.t!==Math.floor(due/300000)*300000-300000)return {note:'بانتظار شموع الوسيط'}
    const s=analyse(m1,m5,10**-c.digits,c.mode)
    if(s.phase!=='signal')return {note:({trend:'بانتظار اتجاه واضح',break:'مراقبة الاختراق',retest:'بانتظار إعادة الاختبار'})[s.phase]}
    const end=due+12000
    while(Date.now()<end && (!(bid>0&&ask>=bid)||Date.now()-Math.min(bidAt,askAt)>15000))await sleep(180)
    if(Date.now()>end || !(bid>0 && ask>=bid) || Date.now()-Math.min(bidAt,askAt)>15000 || (s.trend>0?bid<=s.stop:ask>=s.stop))return {note:'انتهت صلاحية السعر أو الإشارة'}
    return {note:'اكتملت إشارة الدخول',signal:{due,buy:s.trend>0,entry:s.trend>0?ask:bid,stop:s.stop,mode:c.mode}}
  },p=>{
    if(String(p.symbolId)!==String(c.symbolId))return
    const ts=Number(p.timestamp)
    if(ts>0 && p.bid && ts>=bidAt){bid=Number(p.bid)/1e5;bidAt=ts}
    if(ts>0 && p.ask && ts>=askAt){ask=Number(p.ask)/1e5;askAt=ts}
  })
}
export function message(s){
  return ['BTCUSD · '+(s.buy?'شراء':'بيع')+' · '+modes[s.mode],'سعر التنبيه '+s.entry,'وقف إعادة الاختبار '+Number(s.stop.toFixed(8)),new Date(s.due).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour12:false})+' بتوقيت الرياض'].join('\n')
}
export async function telegram(tg,method,text){
  const r=await fetch('https://api.telegram.org/bot'+tg.token+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:tg.chat,...(text?{text}:{})}),signal:AbortSignal.timeout(5000)})
  const data=await r.json()
  if(!data.ok)throw Error('تيليجرام رفض الطلب. تحقق من Bot Token وChat ID واضغط Start في البوت.')
}

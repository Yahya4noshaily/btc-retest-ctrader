import {analyse,closedBars,modes} from './engine.js'
import {connect} from './feed.js'
const el = id => document.getElementById(id)
const write = (id,value) => {el(id).textContent = value}
const fmt = n => Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:5}) : '—'
const time = n => new Date(n).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour12:false})
const feedback = value => write('feedback',value)
const callback = location.origin + '/callback.html'
write('callback',callback)
let feed,epoch=0,interval,symbol,quote={},lastBar=0,active=false,deadline=0
let refreshToken='', expiresAt=0
const seen = new Set()
function reset() {
  epoch++
  feed?.close()
  feed=null
  clearInterval(interval)
  interval=null
  active=false
  symbol=null
  lastBar=0
  quote={}
  deadline=0
  el('signal').className=''
  el('selection').hidden=true
  el('off').hidden=true
  el('list').disabled=false
  el('monitor').disabled=false
  write('signal','بانتظار الاتصال')
  write('reason','تبدأ المراقبة بعد اختيار الحساب.')
  write('badge','غير متصل')
  write('stamp','بانتظار بيانات الوسيط')
  for (const id of ['bid','ask','trend']) write(id,'—')
}
el('off').onclick = () => {reset(); el('token').value=''; el('secret').value=''; feedback('تم قطع الاتصال')}
el('token').oninput=()=>{refreshToken='';expiresAt=0}
el('env').onchange = () => {reset(); feedback('اختر الحساب في البيئة الجديدة')}
el('authorize').onclick = () => {
  if (!el('client').value.trim() || !el('secret').value.trim()) return feedback('أدخل معرّف التطبيق ومفتاحه أولًا.')
  const url = new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/')
  url.search = new URLSearchParams({client_id:el('client').value.trim(),redirect_uri:callback,scope:'accounts',product:'web'})
  try {
    sessionStorage.setItem('btc.auth.pending',JSON.stringify({
      client:el('client').value.trim(), secret:el('secret').value.trim(),
      env:el('env').value, expires:Date.now()+10*60*1000
    }))
    location.assign(url)
  } catch {feedback('تعذر حفظ جلسة التفويض. افتح الموقع في Safari وأعد المحاولة.')}
}
async function resumeAuthorization() {
  const returned=location.hash==='#authorization'
  if (returned) history.replaceState(null,'','/')
  try {
    const pending=sessionStorage.getItem('btc.auth.pending')
    const result=sessionStorage.getItem('btc.auth.result')
    sessionStorage.removeItem('btc.auth.pending')
    sessionStorage.removeItem('btc.auth.result')
    if (!returned) return
    const attempt=pending && JSON.parse(pending)
    if (!attempt || Date.now()>=attempt.expires) throw new Error('انتهت جلسة الربط. اضغط تفويض الحساب لبدء جلسة جديدة.')
    el('env').value=attempt.env
    el('client').value=attempt.client
    el('secret').value=attempt.secret
    const reply=result && JSON.parse(result)
    if (!reply?.code) throw new Error(reply?.denied?'تم إلغاء التفويض. يمكنك المحاولة من جديد.':'عاد cTrader دون رمز تفويض. أعد التفويض من هذه الصفحة.')
    feedback('جاري إكمال تفويض الحساب…')
    const r=await fetch('/api/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client:attempt.client,secret:attempt.secret,code:reply.code})})
    const data=await r.json()
    if (!r.ok || !data.accessToken) throw new Error(data.error || 'تعذر إكمال التفويض')
    el('token').value=data.accessToken
    refreshToken=data.refreshToken || ''
    expiresAt=Date.now()+Number(data.expiresIn || 0)*1000
    await list()
  } catch(err){if(returned){feedback(err.message);el('feedback').scrollIntoView({block:'center'})}}
}
function spot(p) {
  if (!symbol || String(p.symbolId)!==String(symbol.symbolId)) return
  const stamp = Number(p.timestamp)
  if (!Number.isFinite(stamp) || stamp <= 0) return
  if (Number(p.bid)>0 && stamp >= (quote.bidAt||0)) {quote.bid=Number(p.bid)/1e5;quote.bidAt=stamp}
  if (Number(p.ask)>0 && stamp >= (quote.askAt||0)) {quote.ask=Number(p.ask)/1e5;quote.askAt=stamp}
  write('bid',fmt(quote.bid));write('ask',fmt(quote.ask))
}
async function list() {
  reset()
  const id=epoch,demo=el('env').value==='demo'
  try {
    const accessToken=el('token').value.trim(),clientId=el('client').value.trim(),clientSecret=el('secret').value.trim()
    if (!(accessToken && clientId && clientSecret)) throw new Error('أكمل التفويض أو أدخل رمز الوصول ومفاتيح التطبيق.')
    el('list').disabled=true
    feedback('جاري الاتصال بالوسيط…')
    const ws=await connect(demo,p=>{if(id===epoch) spot(p)},()=>{if(id===epoch){reset();feedback('انقطع الاتصال. اضغط عرض الحسابات لإعادة الربط.')}})
    if (id!==epoch) {ws.close();return}
    feed=ws
    await ws.request(2100,{clientId,clientSecret})
    const data=await ws.request(2149,{accessToken})
    if(id!==epoch)return
    const accounts=(data.ctidTraderAccount??[]).filter(a=>Boolean(a.isLive)===!demo)
    if (!accounts.length) throw new Error('لا يوجد حساب مفوض في هذه البيئة. تحقق من اختيار حقيقي أو تجريبي.')
    el('accounts').replaceChildren(...accounts.map(a=>new Option(String(a.traderLogin??a.ctidTraderAccountId),String(a.ctidTraderAccountId))))
    el('selection').hidden=false
    el('off').hidden=false
    write('badge','متصل بالمنصة')
    feedback('تم ربط الحساب. اختر الحساب ثم ابدأ المراقبة.')
    el('selection').scrollIntoView({block:'center'})
  } catch(err){if(id===epoch){reset();feedback(err.message)}}
}
el('list').onclick=list
async function monitor() {
  const id=epoch,ws=feed,account=Number(el('accounts').value),base={ctidTraderAccountId:account}
  el('monitor').disabled=true
  try{
    await ws.request(2102,{...base,accessToken:el('token').value.trim()})
    const data=await ws.request(2114,base)
    if(id!==epoch)return
    const options=(data.symbol??[]).filter(s=>s.enabled!==false && /^(BTC|XBT)[\s/._-]*USD(?:$|[._-]|m$)/i.test(s.symbolName))
    if(!options.length)throw new Error('رمز BTCUSD غير موجود ضمن رموز هذا الحساب.')
    const found=options.find(s=>s.symbolName.toUpperCase()==='BTCUSD')??options[0]
    const details=await ws.request(2116,{...base,symbolId:[found.symbolId]})
    if(id!==epoch)return
    const digits=Number(details.symbol?.[0]?.digits)
    if (!Number.isInteger(digits)) throw new Error('تعذر تحديد دقة سعر البيتكوين.')
    symbol=found
    await ws.request(2127,{...base,symbolId:[found.symbolId],subscribeToSpotTimestamp:true})
    if(id!==epoch)return
    el('selection').hidden=true
    feedback('مراقبة '+found.symbolName+' · الحساب '+el('accounts').selectedOptions[0].text)
    const started=Date.now()
    let busy=false
    const refresh=async()=>{
      if(busy || id!==epoch)return
      busy=true
      try {
        const now=Date.now(),closed=Math.floor(now/60000)*60000
        const ready=quote.ask>=quote.bid && quote.bid>0 && now-Math.min(quote.bidAt,quote.askAt)<15000
        write('badge',ready?'متصل · مراقبة':'بانتظار سعر حديث')
        if(deadline && now>deadline){deadline=0;el('signal').className='';write('signal','انتهت نافذة الدخول');write('reason','الإشارة السابقة محفوظة في سجل الجلسة.')}
        if(lastBar===closed-60000 && active)return
        if(now-closed<650)return
        const get=async period=>closedBars((await ws.request(2137,{...base,symbolId:found.symbolId,period,count:125,fromTimestamp:closed-period*60000*190,toTimestamp:closed-1})).trendbar??[],period,closed)
        const [m1,m5]=await Promise.all([get(1),get(5)])
        if(id!==epoch)return
        if(!m1.length || !m5.length || m1.at(-1).t!==closed-60000 || m5.at(-1).t!==Math.floor(closed/300000)*300000-300000){
          write('signal','بانتظار اكتمال الشموع');write('reason','لم تصل آخر شمعة مغلقة من الوسيط.');return
        }
        const profile=el('mode').value
        const s=analyse(m1,m5,10**-digits,profile)
        write('trend',s.trend>0?'صاعد':s.trend<0?'هابط':'عرضي')
        write('stamp','آخر إغلاق · '+time(closed))
        const key=[account,found.symbolId,s.t].join('/')
        const fresh=Date.now()-Math.min(quote.bidAt,quote.askAt)<15000 && quote.bid>0 && quote.ask>=quote.bid
        if(s.phase==='signal' && closed>=started && Date.now()-closed<=12000 && !fresh){write('signal','بانتظار سعر حديث');return}
        active=true
        lastBar=closed-60000
        deadline=0
        el('signal').className=''
        if(s.phase==='signal' && closed>=started && Date.now()-closed<=12000 && fresh && !seen.has(key)){
          const buy=s.trend>0,entry=buy?quote.ask:quote.bid
          if ((buy?quote.bid<=s.stop:quote.ask>=s.stop)){write('signal','انتهت صلاحية الفرصة');write('reason','تجاوز السعر وقف إعادة الاختبار.');return}
          seen.add(key);deadline=closed+12000
          const side=buy?'شراء':'بيع', summary=modes[profile]+' · '+side+' · '+fmt(entry)+' | الوقف '+fmt(s.stop)
          el('signal').className=buy?'buy':'sell'
          write('signal',side+' BTCUSD · '+modes[profile]);write('reason','سعر التنبيه '+fmt(entry)+' · وقف إعادة الاختبار '+fmt(s.stop))
          const item=document.createElement('li');item.textContent=time(closed)+' · '+summary
          if(!el('history').dataset.started){el('history').replaceChildren();el('history').dataset.started='1'}
          el('history').prepend(item)
          navigator.vibrate?.(180)
          if ('Notification' in window && Notification.permission==='granted') {try{new Notification('BTC Retest',{body:summary,tag:key})}catch{}}
        }else{
          write('signal',({trend:'بانتظار اتجاه واضح',break:'مراقبة الاختراق',retest:'بانتظار إعادة الاختبار',signal:'انتهت نافذة الدخول'})[s.phase])
          write('reason',s.level?'مستوى الاختراق '+fmt(s.level):'متابعة قمم وقيعان السعر على M5 وM1.')
        }
      }catch(err){if(id===epoch){write('badge','تعذر تحديث الشموع');write('signal','توقف تحليل البيانات');write('reason',err.message)}}
      finally{busy=false}
    }
    interval=setInterval(refresh,2300)
    void refresh()
  }catch(err){if(id===epoch){reset();feedback(err.message)}}
}
el('monitor').onclick=()=>{if('Notification' in window && Notification.permission==='default') Notification.requestPermission().catch(()=>{});void monitor()}

export function localMonitorRunning(){return interval!=null}
export function cloudCredentials(){
  const account=Number(el('accounts').value)
  if (!account || !feed) return null
  return {account,env:el('env').value,clientId:el('client').value.trim(),clientSecret:el('secret').value.trim(),accessToken:el('token').value.trim(),refreshToken,expiresAt}
}
void resumeAuthorization()

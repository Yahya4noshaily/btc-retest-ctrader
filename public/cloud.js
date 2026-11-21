import {cloudCredentials,localMonitorRunning} from './app.js'
import {modes} from './engine.js'
const el=id=>document.getElementById(id)
const mode=el('mode'), toggle=el('tgOn'), feedback=el('cloudFeedback')
const descriptions={
  aggressive:'يقبل اقتراب السعر من المستوى ضمن 15٪ من مدى الشمعة السابقة.',
  balanced:'ينتظر لمس المستوى وإغلاق شمعة الدقيقة في جهة الاختراق.',
  conservative:'يشترط أيضًا شمعة في اتجاه الصفقة تُغلق ضمن أعلى أو أدنى 30٪ من مداها.'
}
let enabled=false,changed=false,busy=false,loaded=false
const clock=t=>new Date(t).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour12:false})
function describe(){el('modeDesc').textContent=descriptions[mode.value];el('tgFields').hidden=!toggle.checked}
try{const saved=localStorage.getItem('btc.mode');if(Object.hasOwn(modes,saved))mode.value=saved}catch{}
describe()
mode.onchange=()=>{
  try{localStorage.setItem('btc.mode',mode.value)}catch{}
  changed=true;describe()
  if(enabled)feedback.textContent='اضغط حفظ الإعدادات لتطبيق الوضع على المراقبة السحابية.'
}
toggle.onchange=()=>{changed=true;describe()}
for(const id of ['tgToken','tgChat'])el(id).oninput=()=>{changed=true}
async function api(body){
  const r=await fetch('/api/cloud',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'})
  const data=await r.json()
  if(!r.ok)throw Error(data.error||'تعذر الوصول إلى المراقبة السحابية.')
  return data
}
let expiryTimer, pollTimer, pollVersion=0
function showCloudCard(s,delayed){
  if(localMonitorRunning())return
  const latest=s.history?.[0], age=latest ? Date.now()-latest.due : Infinity
  const fresh=age>=0 && age<12000 && latest.mode===s.mode && latest.due>=s.started
  const card=el('signal')
  el('badge').textContent=delayed?'تحديث الخادم متأخر':'متابعة من الخادم'
  card.className=fresh?(latest.buy?'buy':'sell'):''
  if(fresh){
    card.textContent=(latest.buy?'شراء':'بيع')+' BTCUSD · '+modes[latest.mode]
    el('reason').textContent='سعر التنبيه '+latest.entry+' · الوقف '+Number(latest.stop.toFixed(8))+' · '+clock(latest.due)
    expiryTimer=setTimeout(()=>showCloudCard(s,delayed),12000-age)
  }else{
    card.textContent=s.note==='اكتملت إشارة الدخول'?'انتهت نافذة الدخول':s.note||'بانتظار أول فحص سحابي'
    el('reason').textContent=latest?'آخر إشارة مسجلة · '+modes[latest.mode]+' · '+(latest.buy?'شراء':'بيع')+' · '+clock(latest.due):'الوضع السحابي · '+modes[s.mode]
  }
}
function draw(s){
  clearTimeout(expiryTimer)
  enabled=s.enabled
  el('cloudSave').textContent=enabled?'حفظ إعدادات المراقبة':'تشغيل المراقبة السحابية'
  el('testTg').hidden=!enabled||!s.tgOn
  el('cloudOff').hidden=!enabled
  if(!changed && s.enabled){mode.value=s.mode;toggle.checked=s.tgOn;describe()}
  el('tgToken').placeholder=s.hasTelegram?'محفوظ · أدخل قيمة لتغييره':'Bot Token'
  el('tgChat').placeholder=s.hasTelegram?'محفوظ · أدخل قيمة لتغييره':'Chat ID'
  const delayed=Date.now()-(s.lastCheck||s.started)>150000
  const status=s.enabled
    ? (delayed?'تأخر تحديث الخادم':s.lastCheck?'المراقبة السحابية مفعّلة':'تمت الجدولة · بانتظار أول فحص')+' · '+modes[s.mode]+' · '+s.account
    : 'المراقبة السحابية متوقفة'
  el('cloudStatus').textContent=status
  el('cloudTime').textContent=s.lastCheck?'آخر فحص '+clock(s.lastCheck)+' بتوقيت الرياض · '+(s.note||''):''
  if(s.enabled)showCloudCard(s,delayed)
  else if(!localMonitorRunning() && ['متابعة من الخادم','تحديث الخادم متأخر'].includes(el('badge').textContent)){
    el('badge').textContent='غير متصل';el('signal').textContent='اربط حسابك للبدء';el('reason').textContent='';el('signal').className=''
  }
  el('cloudHistory').replaceChildren(...(s.history||[]).map(row=>{
    const li=document.createElement('li')
    li.textContent=clock(row.due)+' · '+modes[row.mode]+' · '+(row.buy?'شراء':'بيع')+' '+row.entry+' · الوقف '+Number(row.stop.toFixed(8))
    return li
  }))
}
function schedulePoll(){
  clearTimeout(pollTimer)
  if(document.hidden || busy || (!enabled && loaded))return
  let delay=30000
  if(enabled && !localMonitorRunning()){
    const elapsed=Date.now()%60000
    const next=[1200,4200,7200,10200,14500,31000,61200].find(offset=>offset>elapsed)
    delay=next-elapsed
  }
  pollTimer=setTimeout(update,delay)
}
async function update(){
  clearTimeout(pollTimer)
  if(busy||document.hidden)return
  const version=++pollVersion
  try{const s=await api();if(version===pollVersion){draw(s);loaded=true}}
  catch{if(version===pollVersion)el('cloudStatus').textContent='تعذر التحقق من حالة الخادم.'}
  finally{if(version===pollVersion)schedulePoll()}
}
async function submit(action){
  if(busy)return
  busy=true
  pollVersion++
  clearTimeout(pollTimer)
  for(const id of ['cloudSave','testTg','cloudOff'])el(id).disabled=true
  feedback.textContent='جاري تنفيذ الطلب…'
  try{
    let body={action}
    if(action==='save'){
      const c=cloudCredentials()
      if(!c&&!enabled)throw Error('اربط cTrader واضغط عرض الحسابات ثم اختر الحساب.')
      body={...body,credentials:c,mode:mode.value,tgOn:toggle.checked,botToken:el('tgToken').value.trim(),chat:el('tgChat').value.trim()}
    }
    const s=await api(body)
    if(action==='test')feedback.textContent='قبل تيليجرام رسالة الاختبار.'
    else{changed=false;draw(s);el('tgToken').value='';el('tgChat').value='';feedback.textContent=action==='save'?'حُفظت الإعدادات وتمت جدولة الفحص.':'أُوقفت المراقبة السحابية.'}
  }catch(e){feedback.textContent=e.message}
  finally{busy=false;for(const id of ['cloudSave','testTg','cloudOff'])el(id).disabled=false;schedulePoll()}
}
el('cloudSave').onclick=()=>submit('save')
el('cloudOff').onclick=()=>submit('stop')
el('testTg').onclick=()=>submit('test')
void update()
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void update()})

import {cloudCredentials} from './app.js'
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
function draw(s){
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
  if(!cloudCredentials() && s.enabled){
    el('badge').textContent=delayed?'تحديث الخادم متأخر':'متابعة من الخادم'
    el('signal').textContent=s.note || 'بانتظار أول فحص سحابي'
    el('reason').textContent='وضع '+modes[s.mode]+' · الأسعار اللحظية تظهر عند فتح الاتصال المباشر.'
  }else if(!s.enabled && ['متابعة من الخادم','تحديث الخادم متأخر'].includes(el('badge').textContent)){
    el('badge').textContent='غير متصل';el('signal').textContent='اربط حسابك للبدء';el('reason').textContent=''
  }
  el('cloudHistory').replaceChildren(...(s.history||[]).map(row=>{
    const li=document.createElement('li')
    li.textContent=clock(row.due)+' · '+modes[row.mode]+' · '+(row.buy?'شراء':'بيع')+' '+row.entry+' · الوقف '+Number(row.stop.toFixed(8))
    return li
  }))
}
async function update(){
  if(busy||document.hidden)return
  try{const s=await api();if(!busy){draw(s);loaded=true}}
  catch{el('cloudStatus').textContent='تعذر التحقق من حالة الخادم.'}
}
async function submit(action){
  if(busy)return
  busy=true
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
  finally{busy=false;for(const id of ['cloudSave','testTg','cloudOff'])el(id).disabled=false}
}
el('cloudSave').onclick=()=>submit('save')
el('cloudOff').onclick=()=>submit('stop')
el('testTg').onclick=()=>submit('test')
void update()
setInterval(()=>{if(enabled||!loaded)void update()},30000)
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void update()})

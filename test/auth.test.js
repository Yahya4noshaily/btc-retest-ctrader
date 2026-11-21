import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
const callback=readFileSync(new URL('../public/callback.js',import.meta.url),'utf8')
function browser() {
  const items=new Map(),fields=new Map(), requests=[]
  const document={getElementById(id){
    if(!fields.has(id)) fields.set(id,{value:'',hidden:true,replaceChildren(...options){this.options=options},scrollIntoView(){}})
    return fields.get(id)
  }}
  const location={origin:'https://dashboard.example',hash:'',search:'',
    assign(url){this.destination=String(url)},replace(url){this.hash=new URL(url,this.origin).hash}}
  const ctx={document,location,URL,URLSearchParams,Date,JSON,clearInterval,
    history:{replaceState(){}},sessionStorage:{setItem:(k,v)=>items.set(k,v),getItem:k=>items.get(k),removeItem:k=>items.delete(k)},
    Option:class{constructor(text){this.text=text}},connect:async()=>({request:async(type)=>{
      requests.push(type)
      return type===2149?{ctidTraderAccount:[{isLive:true,ctidTraderAccountId:1}]}:{}
    }}),fetch:async()=>({ok:true,json:async()=>({accessToken:'sample'})})}
  const load=()=>vm.runInNewContext(app,{...ctx})
  const redirect=()=>vm.runInNewContext(callback,{...ctx})
  return {load,redirect,el:document.getElementById,items,requests,location}
}
for(const mode of ['success','denied','expired']) test('same-tab callback without opener: '+mode,async()=>{
  const b=browser()
  b.load()
  b.el('client').value='sample-client'
  b.el('secret').value='sample-key'
  b.el('env').value='live'
  b.el('authorize').onclick()
  assert.equal(new URL(b.location.destination).searchParams.get('scope'),'accounts')
  if(mode==='expired') b.items.delete('btc.auth.pending')
  b.location.search=mode==='denied'?'?error=access_denied':'?code=sample-code'
  b.redirect()
  assert.equal(b.location.hash,'#authorization')
  b.load()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(b.items.size,0)
  if(mode==='success'){
    assert.deepEqual(b.requests,[2100,2149])
    assert.equal(b.el('selection').hidden,false)
  }else{
    assert.equal(b.requests.length,0)
    assert.match(b.el('feedback').textContent,mode==='denied'?/إلغاء/:/انتهت/)
  }
})

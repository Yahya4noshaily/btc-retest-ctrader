import { createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual } from 'node:crypto'
import { get,put } from '@vercel/blob'
import { getCache } from '@vercel/functions'
const cache=()=>getCache({namespace:'btc-retest-v3'})
const key=()=>Buffer.from(process.env.MONITOR_KEY,'base64')
const sign=value=>createHmac('sha256',key()).update(value).digest('hex')
export const idFor=c=>sign('account/'+c.env+'/'+c.account)
export function cookie(id){return '__Host-btc_monitor='+id+'.'+sign('cookie/'+id)+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000'}
export function owner(req){
  const raw=(req.headers.cookie||'').match(/(?:^|;\s*)__Host-btc_monitor=([a-f0-9]{64})\.([a-f0-9]{64})(?:;|$)/)
  return raw && timingSafeEqual(Buffer.from(sign('cookie/'+raw[1])),Buffer.from(raw[2])) ? raw[1] : null
}
function encode(value){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv)
  const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()])
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64')
}
function decode(body){
  const b=Buffer.from(body,'base64'),c=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12))
  c.setAuthTag(b.subarray(12,28))
  return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString())
}
export async function read(id,fresh=false){
  if(!fresh){
    const item=await cache().get('config/'+id).catch(()=>null)
    if(item) return {value:decode(item.body),etag:item.etag}
  }
  const result=await get('monitors/'+id,{access:'private',useCache:false})
  if(!result)return {}
  const body=await new Response(result.stream).text(),etag=result.blob.etag
  await cache().set('config/'+id,{body,etag},{ttl:600}).catch(()=>{})
  return {value:decode(body),etag}
}
export async function write(id,value,etag){
  const body=encode(value)
  const r=await put('monitors/'+id,body,{access:'private',addRandomSuffix:false,allowOverwrite:Boolean(etag),...(etag?{ifMatch:etag}:{})})
  await cache().set('config/'+id,{body,etag:r.etag},{ttl:600}).catch(()=>{})
}
export const pulse=(id,data)=>cache().set('pulse/'+id,data,{ttl:600}).catch(()=>{})
export const heartbeat=id=>cache().get('pulse/'+id).catch(()=>null)

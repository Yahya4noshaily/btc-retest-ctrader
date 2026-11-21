export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  if (req.method !== 'POST') return res.status(405).end()
  const origin = 'https://' + req.headers.host
  if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return res.status(403).end()
  const {client,secret,code} = req.body ?? {}
  if (![client,secret,code].every(s=>typeof s==='string' && s.length>0 && s.length<2048)) return res.status(400).end()
  const url = new URL('https://openapi.ctrader.com/apps/token')
  url.search = new URLSearchParams({grant_type:'authorization_code',client_id:client,client_secret:secret,code,redirect_uri:origin+'/callback.html'})
  try {
    const response = await fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(9000)})
    const data = await response.json()
    if (!response.ok || !data.accessToken) return res.status(400).json({error:'فشل التفويض. تحقق من بيانات التطبيق ورابط التحويل.'})
    return res.json({accessToken:data.accessToken})
  } catch {return res.status(502).json({error:'تعذر الوصول إلى خدمة التفويض'})}
}

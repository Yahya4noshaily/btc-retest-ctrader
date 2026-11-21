export async function connect(demo, onSpot, onClose) {
  const ws = new WebSocket('wss://' + (demo ? 'demo' : 'live') + '.ctraderapi.com:5036')
  await new Promise((resolve, reject) => {
    const fail = () => { clearTimeout(timer); reject(new Error('تعذر فتح اتصال cTrader. تحقق من الشبكة والسماح بمنفذ 5036.')) }
    const timer = setTimeout(() => {ws.close(); fail()}, 10000)
    ws.onopen = () => { clearTimeout(timer); resolve() }
    ws.onerror = fail
  })
  let seq = 0
  const pending = new Map()
  const send = (type, payload, id) => ws.send(JSON.stringify({payloadType:type,payload,clientMsgId:id}))
  const heartbeat = setInterval(() => {if (ws.readyState === WebSocket.OPEN) send(51,{},'heartbeat')},9000)
  ws.onmessage = e => {
    const {payloadType:type,payload:p,clientMsgId:id} = JSON.parse(e.data)
    if (type === 2131) return onSpot(p)
    if ([2147,2148,2164].includes(type)) return ws.close()
    const req = pending.get(id)
    if (!req) return
    pending.delete(id)
    clearTimeout(req.timer)
    if (p?.errorCode || type === 2142 || type === 50) req.reject(new Error('cTrader · ' + (p?.errorCode ?? 'ERROR')))
    else req.resolve(p)
  }
  ws.onclose = () => {
    clearInterval(heartbeat)
    for (const req of pending.values()) {clearTimeout(req.timer); req.reject(new Error('انقطع الاتصال'))}
    pending.clear()
    onClose()
  }
  return {close:() => ws.close(), request(type,payload) {
    return new Promise((resolve,reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error('الاتصال مغلق'))
      const id = 'btc-' + (++seq)
      const timer = setTimeout(() => {pending.delete(id); reject(new Error('انتهت مهلة استجابة cTrader'))},12000)
      pending.set(id,{resolve,reject,timer})
      send(type,payload,id)
    })
  }}
}

// A pivot is known only after two bars on either side have closed.
function swings(bars, field, sign) {
  return bars.filter((bar, i) => i >= 2 && i + 2 < bars.length &&
    [-2, -1, 1, 2].every(offset => sign * (bar[field] - bars[i + offset][field]) > 0))
}
function direction(bars) {
  const highs = swings(bars, 'high', 1).slice(-2)
  const lows = swings(bars, 'low', -1).slice(-2)
  if (highs.length + lows.length !== 4) return 0
  const h = Math.sign(highs[1].high - highs[0].high)
  const l = Math.sign(lows[1].low - lows[0].low)
  return h === l ? h : 0
}
export function analyse(minutes, fives, tick = 0.01) {
  let last = {trend:0, phase:'trend'}, pending
  const consumed = new Set()
  for (let i = 5; i < minutes.length; i++) {
    const bar = minutes[i], prev = minutes[i-1]
    const trend = direction(fives.filter(b => b.t + 300000 <= bar.t + 60000))
    last = {trend, phase:trend ? 'break' : 'trend'}
    if (!trend || bar.t !== prev.t + 60000 || pending?.side !== trend) pending = null
    if (!trend || bar.t !== prev.t + 60000) continue
    if (pending) {
      const {side, level, start} = pending
      if (bar.t - start > 5 * 60000 || side * (bar.close - level) <= 0) pending = null
      else {
        const touched = side > 0 ? bar.low <= level : bar.high >= level
        if (touched) {
          last = {trend, phase:'signal', level, t:bar.t, close:bar.close,
            stop:side > 0 ? bar.low - tick : bar.high + tick}
          pending = null
        } else last = {trend, phase:'retest', level}
        continue
      }
    }
    const field = trend > 0 ? 'high' : 'low'
    const pivot = swings(minutes.slice(0,i), field, trend).at(-1)
    if (!pivot) continue
    const level = pivot[field], key = trend + '/' + pivot.t
    if (!consumed.has(key) && trend * (prev.close - level) <= 0 && trend * (bar.close - level) > 0) {
      consumed.add(key)
      pending = {side:trend, level, start:bar.t}
      last = {trend, phase:'retest', level}
    }
  }
  return last
}
export function closedBars(raw, period, now) {
  const bars = new Map()
  for (const b of raw) {
    const t = Number(b.utcTimestampInMinutes) * 60000
    const low = Number(b.low)
    const price = delta => (low + Number(delta ?? 0)) / 100000
    const bar = {t, low:price(0), high:price(b.deltaHigh), open:price(b.deltaOpen), close:price(b.deltaClose)}
    if (t + period * 60000 <= now && Object.values(bar).every(Number.isFinite) && bar.low > 0 &&
      bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close)) bars.set(t, bar)
  }
  return [...bars.values()].sort((a,b) => a.t-b.t)
}

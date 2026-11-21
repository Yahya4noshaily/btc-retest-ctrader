const query = new URLSearchParams(location.search)
history.replaceState(null,'','/callback.html')
try {
  sessionStorage.setItem('btc.auth.result',JSON.stringify({
    code:query.get('code'),denied:query.get('error')==='access_denied'
  }))
  location.replace('/#authorization')
} catch {
  document.getElementById('message').textContent='تعذر استعادة جلسة التفويض. افتح صفحة المراقبة في Safari ثم أعد التفويض.'
}

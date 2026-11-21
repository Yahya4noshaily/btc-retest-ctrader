const query = new URLSearchParams(location.search)
history.replaceState(null,'','/callback.html')
if (window.opener) {
  window.opener.postMessage({type:'ctrader-callback',code:query.get('code')},location.origin)
  window.close()
}
document.getElementById('message').textContent = 'ارجع لصفحة المراقبة. إذا لم يكتمل الربط أعد فتح التفويض منها.'

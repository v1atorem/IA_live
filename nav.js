/* Invictus · общее меню страниц. Подключение: <nav id="ianav"></nav><script src="nav.js"></script>
   Новая страница — одна строка в PAGES. */
(function(){
  var PAGES = [
    {href:'./',           file:'index.html',  label:'Разбор направлений'},
    {href:'report.html',  file:'report.html', label:'Аналитика лидов'},
    {href:'audit.html',   file:'audit.html',  label:'Аудит креативов'}
  ];
  var css = '.ianav{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px;margin:0 0 4px;background:var(--surface,#fff);'
    + 'border:1px solid var(--border,#e2e7ed);border-radius:12px;font:500 13.5px "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif}'
    + '.ianav .ianav-b{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent,#e35d2b);color:#fff;'
    + 'font:700 12px "Barlow Semi Condensed","Arial Narrow",sans-serif;letter-spacing:.4px;margin-right:4px}'
    + '.ianav a{padding:6px 12px;border-radius:8px;color:var(--ink,#161a20);text-decoration:none;white-space:nowrap}'
    + '.ianav a:hover{background:var(--surface2,#f8fafb)}'
    + '.ianav a[aria-current=page]{background:var(--accent-soft,#fdeee7);color:var(--accent,#e35d2b);font-weight:600}'
    + '.ianav a:focus-visible{outline:2px solid var(--accent,#e35d2b);outline-offset:1px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var path = location.pathname.split('/').pop() || 'index.html';
  var el = document.getElementById('ianav');
  if(!el){ el = document.createElement('nav'); el.id = 'ianav'; var w = document.querySelector('.wrap') || document.body; w.insertBefore(el, w.firstChild); }
  el.className = 'ianav'; el.setAttribute('aria-label', 'Разделы');
  el.innerHTML = '<span class="ianav-b" aria-hidden="true">IA</span>' + PAGES.map(function(p){
    var cur = (path === p.file) ? ' aria-current="page"' : '';
    return '<a href="' + p.href + '"' + cur + '>' + p.label + '</a>';
  }).join('');
})();

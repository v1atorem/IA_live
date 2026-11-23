/************************************************************************
 * Invictus — аудит креативов для страницы audit.html.
 *
 * Запросы (через doGet → route_ в Code.gs):
 *   ?action=audit&from=YYYY-MM-DD&to=YYYY-MM-DD[&force=1]
 *        → креативы периода: метрики Meta (hook/hold, досмотры), лиды amo с ответами квиза, оплаты
 *   ?action=gettags                     → {tags:{ключ креатива:{разметка}}}
 *   ?action=settag&k=<ключ>&t=<json>    → сохранить разметку одного креатива (t пустой — удалить)
 *
 * Подключение:
 *   1. Apps Script → Файлы → «+» → Скрипт → audit → вставить этот файл целиком.
 *   2. В Code.gs, в route_(), рядом с остальными action добавить 3 строки (см. README).
 *   3. Deploy → Manage deployments → Edit → New version.
 *   4. Один раз запустить installAuditTrigger(): каждую ночь докачивает лиды amo по месяцам.
 *
 * Креатив = название объявления (utm_content), без учёта регистра и пробелов.
 * Лиды amo кэшируются на Диске по месяцам (папка «Invictus · отчёт (служебное)»):
 *   свежие месяцы обновляются раз в 6 часов, старые — раз в 7 дней, поэтому запрос за год быстрый.
 ************************************************************************/

var AUD_KEY_ = 'aud3_';
var AUD_DEADLINE_ = 0;

function iaAudit_(fromISO, toISO, force){
  if(!fromISO || !toISO) throw new Error('нужны from и to (YYYY-MM-DD)');
  var key = AUD_KEY_ + fromISO + '_' + toISO;
  if(!force){ var c = cacheGet_(key); if(c) return c; }
  AUD_DEADLINE_ = Date.now() + 270000;               // 4,5 минуты — с запасом до лимита Apps Script
  var doc = iaAuditBuild_(fromISO, toISO, force);
  var s = JSON.stringify(doc);
  if(!doc.partial){ try{ cachePut_(key, s, 21600); }catch(e){} }
  return s;
}

function iaAuditBuild_(fromISO, toISO, force){
  var A = iaAudAds_(fromISO, toISO);                  // объявления Meta с видеометриками
  var L = iaAudLeads_(fromISO, toISO, force);         // лиды amo (компактно, по месяцам)
  var pay = {};
  try{ pay = payments_(); }catch(e){}
  var cr = {}, byAd = {};
  for(var id in A.ads){
    var a = A.ads[id], k = audNorm_(a.n); if(!k) continue;
    byAd[id] = k;
    var o = cr[k] || (cr[k] = {k:k, n:a.n, ids:[], camps:{}, sp:0, im:0, cl:0, v3:0, th:0, p25:0, p50:0, p75:0, p100:0, avw:0, fl:0, act:0,
                               vid:'', th_url:'', link:'', top:0,
                               ld:0, q:0, s:0, rev:0, ans:0, core:0, sport:0, beg:0, dirs:{}});
    o.ids.push([id, a.sp]); o.camps[a.c] = 1;
    o.sp += a.sp; o.im += a.im; o.cl += a.cl; o.v3 += a.v3; o.th += a.th;
    o.p25 += a.p25; o.p50 += a.p50; o.p75 += a.p75; o.p100 += a.p100; o.avw += a.avg * a.im; o.fl += a.ld;
    if(a.sp >= o.top){ o.top = a.sp; if(a.vid) o.vid = a.vid; if(a.t) o.th_url = a.t; if(a.p) o.link = a.p; }
    if(!o.vid && a.vid) o.vid = a.vid; if(!o.th_url && a.t) o.th_url = a.t; if(!o.link && a.p) o.link = a.p;
  }
  var matched = 0, unmatched = 0;
  for(var i = 0; i < L.recs.length; i++){
    var r = L.recs[i];     // [id, дата, класс 0/1/2, utm_medium, utm_content, utm_term, направление, опыт]
    var tdig = (String(r[5] || '').match(/\d{10,}/) || [''])[0];
    var k = (tdig && byAd[tdig]) || '';
    if(!k){ var ak = audNorm_(r[4]); if(ak && cr[ak]) k = ak; }
    if(!k){ if(r[4]) unmatched++; continue; }
    matched++;
    var o = cr[k];
    o.ld++; if(r[2] >= 1) o.q++;
    var p = pay[r[0]];
    if(r[2] === 2 || (p && p.paid > 0)){ o.s++; if(p) o.rev += p.paid || 0; }
    if(r[7]){ o.ans++; if(r[7] === 'p' || r[7] === 'y') o.core++; if(r[7] === 'p') o.sport++; if(r[7] === 'b') o.beg++; }
    if(r[6]) o.dirs[r[6]] = (o.dirs[r[6]] || 0) + 1;
  }
  var out = [];
  for(var k in cr){
    var o = cr[k];
    if(o.sp < 1 && !o.ld) continue;
    o.ids.sort(function(x, y){ return y[1] - x[1]; });
    o.ids = o.ids.slice(0, 20).map(function(x){ return x[0]; });
    o.camps = Object.keys(o.camps).slice(0, 6);
    o.avg = o.im ? Math.round(o.avw / o.im * 10) / 10 : 0;
    delete o.avw; delete o.top;
    ['sp','rev'].forEach(function(f){ o[f] = Math.round(o[f] * 100) / 100; });
    out.push(o);
  }
  out.sort(function(a, b){ return b.sp - a.sp; });
  return {updatedAt: new Date().toISOString(), from: fromISO, to: toISO, cur: A.cur, acc: prop_('FB_ACCOUNT'),
          creatives: out, matched: matched, unmatched: unmatched, leads: L.recs.length,
          partial: L.partial, missing: L.missing, fbErr: A.err || ''};
}

function audNorm_(s){ return String(s == null ? '' : s).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase(); }

/* ============ Meta: объявления за период, одной строкой на объявление ============ */
function iaAudAds_(fromISO, toISO){
  var acc = prop_('FB_ACCOUNT'), tok = prop_('FB_TOKEN');
  if(!acc || !tok) return {ads:{}, cur:'usd', err:'FB_ACCOUNT / FB_TOKEN не заданы'};
  var cur = 'usd';
  try{ var c = JSON.parse(UrlFetchApp.fetch(FB_API + acc + '?fields=currency&access_token=' + encodeURIComponent(tok), {muteHttpExceptions:true}).getContentText()); if(c.currency) cur = String(c.currency).toLowerCase(); }catch(e){}
  var tr = encodeURIComponent(JSON.stringify({since: fromISO, until: toISO}));
  var fields = 'ad_id,ad_name,campaign_name,spend,impressions,inline_link_clicks,actions,video_thruplay_watched_actions,'
             + 'video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions';
  var url = FB_API + acc + '/insights?level=ad&fields=' + fields + '&time_range=' + tr + '&limit=500&access_token=' + encodeURIComponent(tok);
  var ads = {}, guard = 0, err = '';
  while(url && guard++ < 100){
    Utilities.sleep(250);
    var d = JSON.parse(fetchRetry_(url, {muteHttpExceptions:true}).getContentText());
    if(d.error){ err = 'Facebook: ' + d.error.message; break; }
    (d.data || []).forEach(function(row){
      var id = String(row.ad_id || ''); if(!id) return;
      ads[id] = {n: String(row.ad_name || '').trim(), c: String(row.campaign_name || '').trim(),
        sp: parseFloat(row.spend || 0), im: parseInt(row.impressions || 0, 10), cl: parseInt(row.inline_link_clicks || 0, 10),
        v3: audAct_(row.actions, 'video_view'), ld: audAct_(row.actions, 'lead'),
        th: audAct_(row.video_thruplay_watched_actions), p25: audAct_(row.video_p25_watched_actions), p50: audAct_(row.video_p50_watched_actions),
        p75: audAct_(row.video_p75_watched_actions), p100: audAct_(row.video_p100_watched_actions), avg: audAct_(row.video_avg_time_watched_actions)};
    });
    url = (d.paging && d.paging.next) || '';
  }
  // креативы: видео, превью, ссылка на пост — только для объявлений с расходом
  var ids = Object.keys(ads).filter(function(id){ return ads[id].sp > 0; });
  var F = ['creative.thumbnail_width(360).thumbnail_height(640){video_id,thumbnail_url,instagram_permalink_url,effective_object_story_id}',
           'creative{video_id,thumbnail_url,instagram_permalink_url,effective_object_story_id}'];
  for(var i = 0; i < ids.length; i += 50){
    if(Date.now() > AUD_DEADLINE_ - 60000) break;
    var part = ids.slice(i, i + 50).join(',');
    for(var f = 0; f < F.length; f++){
      try{
        var r = JSON.parse(UrlFetchApp.fetch(FB_API + '?ids=' + part + '&fields=' + encodeURIComponent(F[f]) + '&access_token=' + encodeURIComponent(tok), {muteHttpExceptions:true}).getContentText());
        if(r.error) continue;
        for(var id in r){ var cr = (r[id] || {}).creative || {}, a = ads[id]; if(!a) continue;
          if(cr.video_id) a.vid = String(cr.video_id);
          if(cr.thumbnail_url) a.t = cr.thumbnail_url;
          if(cr.instagram_permalink_url) a.p = cr.instagram_permalink_url;
          else if(cr.effective_object_story_id) a.p = 'https://www.facebook.com/' + cr.effective_object_story_id; }
        break;
      }catch(e){}
    }
  }
  return {ads: ads, cur: cur, err: err};
}
function audAct_(arr, type){
  if(!arr) return 0; var s = 0;
  for(var i = 0; i < arr.length; i++){ if(!type || arr[i].action_type === type) s += parseFloat(arr[i].value || 0); }
  return s;
}

/* ============ amoCRM: лиды по месяцам с кэшем на Диске ============ */
function iaAudLeads_(fromISO, toISO, force){
  var months = audMonths_(fromISO, toISO), recs = [], missing = [], today = Utilities.formatDate(new Date(), 'Asia/Almaty', 'yyyy-MM-dd');
  for(var i = 0; i < months.length; i++){
    var m = months[i], file = 'aud_leads_' + m + '.json', st = iaLoadJson_(file);
    var monthEnd = audMonthEnd_(m), oldMonth = audDays_(monthEnd, today) > 35;
    var maxAge = oldMonth ? 7 * 864e5 : 6 * 3600e3;
    var fresh = st && st.ts && (Date.now() - st.ts) < maxAge && !(force && !oldMonth);
    if(!fresh){
      if(Date.now() > AUD_DEADLINE_ - 45000){ if(st && st.recs){ recs = recs.concat(st.recs); } else missing.push(m); continue; }
      try{ st = {ts: Date.now(), recs: audFetchMonth_(m)}; iaSaveJson_(file, st); }
      catch(e){ if(!(st && st.recs)){ missing.push(m); continue; } }
    }
    recs = recs.concat(st.recs || []);
  }
  recs = recs.filter(function(r){ return r[1] >= fromISO && r[1] <= toISO; });
  return {recs: recs, partial: missing.length > 0, missing: missing};
}
function audMonths_(a, b){ var out = [], y = +a.slice(0,4), m = +a.slice(5,7), Y = +b.slice(0,4), M = +b.slice(5,7);
  while(y < Y || (y === Y && m <= M)){ out.push(y + '-' + ('0' + m).slice(-2)); m++; if(m > 12){ m = 1; y++; } } return out; }
function audMonthEnd_(m){ var y = +m.slice(0,4), mo = +m.slice(5,7); return m + '-' + ('0' + new Date(Date.UTC(y, mo, 0)).getUTCDate()).slice(-2); }
function audDays_(a, b){ return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }

function audFetchMonth_(m){
  var sub = prop_('AMO_SUBDOMAIN'), tok = prop_('AMO_TOKEN');
  if(!sub || !tok) return [];
  var base = 'https://' + sub + '.amocrm.ru', hdr = {'Authorization': 'Bearer ' + tok};
  var statuses = amoStatuses_(base, hdr);
  var since = Math.floor(new Date(m + '-01T00:00:00+05:00').getTime() / 1000);
  var until = Math.floor(new Date(audMonthEnd_(m) + 'T23:59:59+05:00').getTime() / 1000);
  var out = [], page = 1, guard = 0;
  while(guard++ < 200){
    if(Date.now() > AUD_DEADLINE_) throw new Error('не успели');
    var url = base + '/api/v4/leads?limit=250&page=' + page + '&with=loss_reason'
      + '&filter[created_at][from]=' + since + '&filter[created_at][to]=' + until + '&order[id]=asc';
    Utilities.sleep(180);                               // amo: не больше 7 запросов в секунду
    var resp = fetchRetry_(url, {headers: hdr, muteHttpExceptions: true}), code = resp.getResponseCode();
    if(code === 204) break;
    if(code !== 200) throw new Error('amoCRM HTTP ' + code);
    var body = resp.getContentText(); if(!body) break;
    var leads = ((JSON.parse(body)._embedded) || {}).leads || [];
    if(!leads.length) break;
    leads.forEach(function(L){ out.push(audLead_(L, statuses)); });
    if(leads.length < 250) break;
    page++;
  }
  return out;
}
/* компактная запись: [id, дата, класс (0 — нет, 1 — квал, 2 — продажа), utm_medium, utm_content, utm_term, направление, опыт] */
function audLead_(L, statuses){
  var cf = cfMap_(L);
  var st = statuses[L.status_id] || '';
  var lr = (L._embedded && L._embedded.loss_reason && L._embedded.loss_reason[0] && L._embedded.loss_reason[0].name) || cfPick_(cf, 'причина отказа', 'причина');
  var m = cfPick_(cf, 'utm_medium');
  var dir = audDir_(cfExact_(cf, 'курс', 'пакет', 'пакет обучения') || cfPick_(cf, 'курс', 'пакет'),
                    cfQuiz_(cf, 'TILDA_PRODUCT_FIELDS', ['направлен', 'квиз', 'quiz'], []), cfPick_(cf, 'formname', 'форма'), m);
  return [String(L.id),
          L.created_at ? Utilities.formatDate(new Date(L.created_at * 1000), 'Asia/Almaty', 'yyyy-MM-dd') : '',
          audClass_(st, lr), m, cfPick_(cf, 'utm_content'), cfPick_(cf, 'utm_term'), dir,
          audExp_(cfPick_(cf, 'как_давно', 'как давно', 'қанша уақыт'))];
}
function audExp_(t){ var s = String(t || '').toLowerCase(); if(!s) return '';
  if(s.indexOf('профессиональн') >= 0 || s.indexOf('кәсіби') >= 0) return 'p';
  if(s.indexOf('давно') >= 0 || s.indexOf('несколько лет') >= 0 || s.indexOf('около года') >= 0 || s.indexOf('бір жыл') >= 0 || s.indexOf('жылдан') >= 0) return 'y';
  if(s.indexOf('время от времени') >= 0) return 'o';
  return 'b'; }

/* те же правила, что в report.html (classify / pkgDir / formDir / autoDir) — менять вместе */
var AUD_QS_ = ['ответилил на рассылку','ответил на рассылку','оффер озвучен + дедлайн','наработка','счет выставлен','счёт выставлен','отказ банка','предоплата / траншевая оплата','успешно реализовано'];
var AUD_SS_ = ['предоплата / траншевая оплата','успешно реализовано'];
var AUD_QR_ = ['дорого (не смог продать)','пропала потребность','в следующий раз','гасится','выбрали других','отказ рассрочки от банка'];
function audClass_(st, rs){
  var n = audNorm_(st), b = n.indexOf('закрыто и не реализовано') === 0 ? 'закрыто и не реализовано' : n;
  var mm = n.match(/^закрыто и не реализовано\s*\((.*)\)\s*$/), r = mm ? mm[1].trim() : audNorm_(rs);
  if(AUD_SS_.indexOf(b) >= 0) return 2;
  if(AUD_QS_.indexOf(b) >= 0 || AUD_QR_.indexOf(r) >= 0) return 1;
  return 0;
}
function audDir_(crs, pq, fn, m){
  var p = audNorm_(crs);
  if(p){ if(p.indexOf('каз') >= 0) return 'ТЗ_каз'; if(p.indexOf('career boost') >= 0 || p.indexOf('сам себе тренер') >= 0) return 'ТЗ';
         if(p.indexOf('будь как') >= 0 || p.indexOf('bust') >= 0 || p.indexOf('буст') >= 0) return 'Bust_plus'; return 'ГП'; }
  var q = audNorm_(pq);
  if(q){ if(q.indexOf('казахск') >= 0 || q.indexOf('қазақ') >= 0) return 'ТЗ_каз'; if(q.indexOf('групп') >= 0 || q.indexOf('стретч') >= 0 || q.indexOf('пилатес') >= 0) return 'ГП';
         if(q.indexOf('тренажер') >= 0 || q.indexOf('карьер') >= 0) return 'ТЗ'; }
  var f = audNorm_(fn);
  if(f){ if(f.indexOf('tzkz') >= 0 || (f.indexOf('tz') >= 0 && f.indexOf('kz') >= 0)) return 'ТЗ_каз';
         if(f.indexOf('выпускник') >= 0 || f.indexOf('cbplus') >= 0 || f.indexOf('будь как') >= 0) return 'Bust_plus';
         if(f.indexOf('tz') >= 0) return 'ТЗ'; if(f.indexOf('quiz') >= 0 || f.indexOf('popupinvictus') >= 0) return 'ГП'; }
  var n = audNorm_(m);
  if(n.indexOf('bust') >= 0 || n.indexOf('буст') >= 0) return 'Bust_plus';
  if(n.indexOf('kaz') >= 0 || n.indexOf('каз') >= 0) return 'ТЗ_каз';
  if(/(^|[^a-z])tz|_tz|tz_/.test(n)) return 'ТЗ';
  if(/(^|[^a-z])gp|gp_|_gp/.test(n) || n.indexOf('гп') >= 0) return 'ГП';
  return '';
}

/* ============ разметка креативов (хранится на Диске, ad_tags.json) ============ */
function iaGetTags_(){
  var saved = iaLoadJson_('ad_tags.json') || {}, out = {};
  var seed = JSON.parse(AUD_SEED_);
  for(var k in seed) out[k] = seed[k];
  for(var k2 in saved){ if(saved[k2] === null) delete out[k2]; else out[k2] = saved[k2]; }
  return out;
}
function iaSetTag_(k, t){
  k = audNorm_(k); if(!k) throw new Error('нет ключа креатива');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var saved = iaLoadJson_('ad_tags.json') || {};
    saved[k] = t ? JSON.parse(t) : null;
    iaSaveJson_('ad_tags.json', saved);
  } finally { lock.releaseLock(); }
  return true;
}

/* ============ ночная докачка лидов (запустить installAuditTrigger один раз) ============ */
function warmAudit(){
  var tz = 'Asia/Almaty', now = new Date(), to = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), from = now.getFullYear() + '-01-01';
  AUD_DEADLINE_ = Date.now() + 300000;
  var L = iaAudLeads_(from, to, false);
  Logger.log('Лидов за год: %s. Не докачано месяцев: %s', L.recs.length, L.missing.join(', ') || '0');
}
function installAuditTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction() === 'warmAudit') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('warmAudit').timeBased().everyHours(6).create();
  Logger.log('Готово: warmAudit будет запускаться каждые 6 часов.');
}
function testAudit(){
  var to = Utilities.formatDate(new Date(), 'Asia/Almaty', 'yyyy-MM-dd'), from = Utilities.formatDate(new Date(Date.now() - 13 * 864e5), 'Asia/Almaty', 'yyyy-MM-dd');
  var d = JSON.parse(iaAudit_(from, to, true));
  Logger.log('Креативов: %s, лидов: %s, привязано: %s, без пары: %s, ошибка FB: %s', d.creatives.length, d.leads, d.matched, d.unmatched, d.fbErr || '—');
  d.creatives.slice(0, 5).forEach(function(c){ Logger.log('%s | $%s | hook %s%% | лидов %s | ядро %s/%s', c.n, c.sp, c.im ? (c.v3 / c.im * 100).toFixed(1) : '—', c.ld, c.core, c.ans); });
}

/* ============ стартовая разметка: 59 роликов, просмотренных в ноябре 2026 ============ */
var AUD_SEED_ = "{\"гп_01_01\":{\"ht\":\"Развенчание мифа\",\"txt\":\"«Чтобы стать тренером, не обязательно быть моделью / с идеальной растяжкой»\",\"ff\":\"Тренер ГП сидит на мате\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Не нужно быть идеальной\",\"offer\":\"\",\"seg\":\"Без спортивного опыта\"},\"v42\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим, ты станешь фитнес-тренером всего за 12 недель»\",\"ff\":\"Тренер в зале, жест, без текста\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"12 недель\",\"seg\":\"Широкий / не адресован\"},\"гп_kamilla2\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Профессия для девушек, которые хотят вести людей и вдохновлять»\",\"ff\":\"Тренер в выпаде на коврике\",\"fmt\":\"Говорящая голова без крупного текста\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Вдохновлять людей\",\"offer\":\"\",\"seg\":\"Мотив «вдохновлять»\"},\"v20\":{\"ht\":\"Спор / вызов\",\"txt\":\"«А давай поспорим: станешь фитнес-тренером за 12 недель»\",\"ff\":\"Тренер Ж в зале, руки на поясе\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"12 недель, работа в клубах\",\"seg\":\"Широкий / не адресован\"},\"sporim_026\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим, ты станешь… всего за 12 недель»\",\"ff\":\"Тренер Ж в зале, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"12 недель, Invictus Fitness\",\"seg\":\"Широкий / не адресован\"},\"video23\":{\"ht\":\"Выгоды профессии\",\"txt\":\"Тренер выходит из офиса: «Ты можешь зарабатывать не сидя в офисе»\",\"ff\":\"Мужчина выходит из стеклянной двери офиса\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Офис → зал, доход\",\"offer\":\"Доход\",\"seg\":\"Смена профессии\"},\"смотри_он_стал\":{\"ht\":\"История героя\",\"txt\":\"«Смотри, он стал фитнес-тренером» → «500 000 ₸ зарабатывает»\",\"ff\":\"Ведущая в зале, без текста\",\"fmt\":\"Говорящая голова без крупного текста\",\"hero\":\"Ведущая Ж + выпускник М\",\"mean\":\"Доход в новой профессии\",\"offer\":\"Доход 500 000 ₸\",\"seg\":\"Широкий / не адресован\"},\"v_creo_wanted\":{\"ht\":\"Вопрос-желание + «досмотри»\",\"txt\":\"«Хочешь стать фитнес-тренером? Тогда досмотри»\",\"ff\":\"Тренер Ж на мате, улыбается\",\"fmt\":\"Говорящая голова без крупного текста\",\"hero\":\"Тренер Ж\",\"mean\":\"Возможность профессии\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"gp_how_to\":{\"ht\":\"Как-то / инструкция\",\"txt\":\"«Как стать тренером групповых»\",\"ff\":\"Девушка в студии, без текста\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Путь в профессию\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"таргет\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Ты КМС и спорт — твоя жизнь?» (медаль, кимоно, мяч)\",\"ff\":\"Мужчина в зале, говорит\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Монетизировать спортивный опыт\",\"offer\":\"Доход от 500 000 ₸\",\"seg\":\"Бывшие спортсмены\"},\"давно_мечтаешь\":{\"ht\":\"Боль / мечта\",\"txt\":\"«Давно мечтаешь о карьере, но не понимаешь, как превратить её…»\",\"ff\":\"Мужчина лежит на мате\",\"fmt\":\"Говорящая голова без крупного текста\",\"hero\":\"Тренер М\",\"mean\":\"Хобби → карьера\",\"offer\":\"\",\"seg\":\"Уже тренируются\"},\"2708\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Ты здесь каждую неделю? Что если зал станет твоим местом работы?»\",\"ff\":\"Тренер в зале, жест\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Зал как работа\",\"offer\":\"\",\"seg\":\"Уже тренируются\"},\"cпорим_02.02\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим? Ты станешь фитнес-тренером всего за 12 недель»\",\"ff\":\"Тренер Ж крупно, удивление\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"12 недель, работа в клубах\",\"seg\":\"Широкий / не адресован\"},\"sporim_77\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим, ты станешь фитнес-тренером за 4 месяца» (тренер в планке)\",\"ff\":\"Тренер в упоре лёжа, крупно\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"4 месяца\",\"seg\":\"Широкий / не адресован\"},\"cr_bustplus_tired\":{\"ht\":\"Боль / страх\",\"txt\":\"«Устал пахать с утра до ночи на нелюбимой работе?»\",\"ff\":\"Тренер с штангой, без текста\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Уйти с нелюбимой работы\",\"offer\":\"\",\"seg\":\"Смена профессии\"},\"lid1\":{\"ht\":\"История героя\",\"txt\":\"«Как я стал востребованным и начал зарабатывать от 1 000 000 ₸ в месяц»\",\"ff\":\"Тренер у беговых дорожек\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М (история)\",\"mean\":\"Доход тренера\",\"offer\":\"Доход 1 000 000 ₸\",\"seg\":\"Широкий / не адресован\"},\"гп_03_03\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Ты любишь стретчинг, но пока не зарабатываешь на нём»\",\"ff\":\"Девушка в растяжке на мате\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Хобби → профессия\",\"offer\":\"\",\"seg\":\"Ходят на групповые\"},\"гп_kamilla\":{\"ht\":\"Вопрос-желание\",\"txt\":\"«Хочешь вести групповые тренировки, но не знаешь, с чего начать?»\",\"ff\":\"Тренер Ж говорит в камеру\",\"fmt\":\"Говорящая голова без крупного текста\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"С чего начать\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"крео1_tz\":{\"ht\":\"Развенчание мифа\",\"txt\":\"«У фитнес-тренеров очень тяжёлая судьба…» (ирония → работа, зарплата)\",\"ff\":\"Тренер Ж сидит на тренажёре\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Плюсы профессии через иронию\",\"offer\":\"Зарплата\",\"seg\":\"Широкий / не адресован\"},\"p14\":{\"ht\":\"История героя\",\"txt\":\"«Как я стал фитнес-тренером за 4 месяца» → «работал баристой»\",\"ff\":\"Парень-тренер в зале, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Выпускник М\",\"mean\":\"Смена профессии (бариста → тренер)\",\"offer\":\"4 месяца\",\"seg\":\"Смена профессии\"},\"благодаря_этой\":{\"ht\":\"Выгоды профессии\",\"txt\":\"«Благодаря этой профессии ты укрепляешь здоровье… и зарабатываешь»\",\"ff\":\"Мускулистый тренер в неоновом зале\",\"fmt\":\"Говорящая голова без крупного текста\",\"hero\":\"Тренер М\",\"mean\":\"Здоровье + доход vs офис\",\"offer\":\"Доход\",\"seg\":\"Уже тренируются\"},\"v62\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Я бросаю тебе вызов: сможешь стать фитнес-тренером всего за 4 месяца?»\",\"ff\":\"Тренер крупно на тренажёре\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"4 месяца\",\"seg\":\"Широкий / не адресован\"},\"гп_stretch\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Любишь стретчинг? Не думала сама проводить занятия?»\",\"ff\":\"Девушка в студии, движение\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Хобби → профессия\",\"offer\":\"\",\"seg\":\"Ходят на групповые\"},\"0808_tz_bezstazh\":{\"ht\":\"Боль / страх\",\"txt\":\"«Хочешь уйти в фитнес? Но страшно»\",\"ff\":\"Тренер в упоре лёжа, взгляд в камеру\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Смена профессии без стажа\",\"offer\":\"\",\"seg\":\"Смена профессии\"},\"v52\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Тренируешься и понимаешь, что можешь больше?»\",\"ff\":\"Атлетка на кроссовере, без текста\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Атлетка Ж\",\"mean\":\"Тренируешься → можешь больше\",\"offer\":\"\",\"seg\":\"Уже тренируются\"},\"wait_till_end\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Ждёшь конца рабочего дня, чтобы наконец пойти в зал?» → «за 4 месяца»\",\"ff\":\"Тренер указывает в камеру\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Зал после работы → зал как работа\",\"offer\":\"4 месяца обучения\",\"seg\":\"Уже тренируются\"},\"гп_10_10\":{\"ht\":\"Факт / определение\",\"txt\":\"«Силовые программы — это когда ты не просто…, а становишься…»\",\"ff\":\"Тренер Ж говорит в камеру\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Объяснение направления\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"v2\":{\"ht\":\"Как-то / инструкция\",\"txt\":\"«Как стать фитнес-тренером с нуля и зарабатывать от 500 000 ₸»\",\"ff\":\"Тренер Ж с клиенткой в зале\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"С нуля → доход\",\"offer\":\"Доход 500 000 ₸\",\"seg\":\"Без спортивного опыта\"},\"0808_stazh\":{\"ht\":\"Возражение\",\"txt\":\"«Возможно ли стать тренером, если нет спортивного прошлого?»\",\"ff\":\"Тренер крупно, со штангой\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Можно без спортивного прошлого\",\"offer\":\"\",\"seg\":\"Без спортивного опыта\"},\"гп_09_09\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Если тебе нравится атмосфера зала — ты можешь работать в ней каждый день»\",\"ff\":\"Тренер Ж со штангой в студии\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Атмосфера зала как работа\",\"offer\":\"\",\"seg\":\"Уже тренируются\"},\"1109\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Вложил годы в фитнес? Тогда преврати его в профессию с доходом»\",\"ff\":\"Парень сидит в зале\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Молодой атлет М\",\"mean\":\"Монетизировать годы тренировок\",\"offer\":\"Доход\",\"seg\":\"Уже тренируются\"},\"сейчас_покажу\":{\"ht\":\"Обещание-инструкция\",\"txt\":\"«Сейчас покажу, как за 4 месяца пройти путь от любителя до фитнес-тренера»\",\"ff\":\"Тренер крупно с гантелей, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М, 40+\",\"mean\":\"Путь любитель → тренер\",\"offer\":\"4 месяца\",\"seg\":\"Уже тренируются\"},\"video_rus_02_03\":{\"ht\":\"Выгоды профессии\",\"txt\":\"«Когда любимое дело становится стабильным и начинает приносить…»\",\"ff\":\"Парень на тяге, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Хобби → стабильный доход\",\"offer\":\"Доход\",\"seg\":\"Уже тренируются\"},\"v1\":{\"ht\":\"Сценка\",\"txt\":\"Клиентка платит тренеру деньгами в зале — без текста в первые секунды\",\"ff\":\"Крупно: деньги в руке\",\"fmt\":\"Сценка\",\"hero\":\"Пара М + Ж\",\"mean\":\"Тренер получает деньги\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"img_2101\":{\"ht\":\"Оффер в первом кадре\",\"txt\":\"«Преврати любовь к групповым тренировкам в свою профессию за 8 недель»\",\"ff\":\"Плашки с оффером поверх нарезки\",\"fmt\":\"Моушн-шаблон\",\"hero\":\"Без героя\",\"mean\":\"Хобби → профессия\",\"offer\":\"Бесплатная консультация, 8 недель\",\"seg\":\"Ходят на групповые\"},\"p8\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Ты уже долго тренируешься, но всё ещё платишь за зал?»\",\"ff\":\"Мускулистый тренер крупно\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Тренируешься → зарабатывай на этом\",\"offer\":\"4 месяца\",\"seg\":\"Уже тренируются\"},\"фитнесчасть_жизни\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Фитнес уже часть твоей жизни? Преврати хобби в профессию»\",\"ff\":\"Парень в ТЦ, без текста\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Хобби → профессия\",\"offer\":\"\",\"seg\":\"Уже тренируются\"},\"гп_qqqqqq\":{\"ht\":\"Развенчание мифа\",\"txt\":\"«Не умеешь садиться на шпагат? Я тоже… это не мешает»\",\"ff\":\"Тренер в шпагате, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Не нужно быть гибкой\",\"offer\":\"\",\"seg\":\"Без спортивного опыта\"},\"а_ты_знал\":{\"ht\":\"Факт / «а ты знал»\",\"txt\":\"«А ты знал, что профессия фитнес-тренера считается востребованной? Спрос растёт»\",\"ff\":\"Тренер Ж на тренажёре\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Востребованность профессии\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"v40\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим? Ты станешь фитнес-тренером всего за 12 недель»\",\"ff\":\"Тренер Ж крупно, удивление\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"12 недель, работа в клубах\",\"seg\":\"Широкий / не адресован\"},\"tz_oct_хз\":{\"ht\":\"Боль / усталость\",\"txt\":\"«…наконец отдохнуть от работы» → работа = зал\",\"ff\":\"Тренер в зале, говорит\",\"fmt\":\"Говорящая голова без крупного текста\",\"hero\":\"Тренер М\",\"mean\":\"Работа в удовольствие\",\"offer\":\"\",\"seg\":\"Смена профессии\"},\"гп_05_05\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Ты приходишь на тренировки, но уже готова… за 8 недель»\",\"ff\":\"Тренер Ж входит в студию\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Из клиентки — в тренеры\",\"offer\":\"8 недель\",\"seg\":\"Ходят на групповые\"},\"tz_2810_2\":{\"ht\":\"Боль / усталость\",\"txt\":\"«5 дней пашешь… только суббота твоя» (календарь недели)\",\"ff\":\"Ведущая крупно у логотипа\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Работа 5/2 → работа в зале\",\"offer\":\"\",\"seg\":\"Смена профессии\"},\"хочешь_тз\":{\"ht\":\"Боль / страх\",\"txt\":\"«Давно хочешь стать фитнес-тренером, но боишься потерять стабильный доход?»\",\"ff\":\"Пустой зал, герой входит в кадр на 1 с\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Страх потерять доход\",\"offer\":\"\",\"seg\":\"Смена профессии\"},\"поспорим_tz\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Давай поспорим: станешь фитнес-тренером за 12 недель»\",\"ff\":\"Тренер Ж в зале, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер Ж\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"12 недель\",\"seg\":\"Широкий / не адресован\"},\"v10\":{\"ht\":\"Разоблачение / «правда»\",\"txt\":\"«Правда, о которой все… фитнес… всего…»\",\"ff\":\"Тренер в движении, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Правда о профессии\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"крео2_tz\":{\"ht\":\"Развенчание мифа\",\"txt\":\"«У фитнес-тренеров не жизнь, а сплошные проблемы…» (ирония)\",\"ff\":\"Тренер крупно, жестикулирует\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Плюсы профессии через иронию\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"гп_07_07\":{\"ht\":\"Боль / страх\",\"txt\":\"«Хочешь стать тренером групповых, но боишься вести группы?»\",\"ff\":\"Тренер Ж со штангой, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Страх вести группу\",\"offer\":\"\",\"seg\":\"Ходят на групповые\"},\"годами_ходим_взал\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Мы годами ходим в зал, учимся понимать своё тело… это не должно оставаться просто хобби»\",\"ff\":\"Девушка с гирей, размыто\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Атлетка Ж\",\"mean\":\"Хобби → профессия\",\"offer\":\"\",\"seg\":\"Уже тренируются\"},\"qaaa_сценка2\":{\"ht\":\"Сценка\",\"txt\":\"Сценка в машине, текст появляется после 3 с\",\"ff\":\"Парень в машине, без текста\",\"fmt\":\"Сценка\",\"hero\":\"Актёр М\",\"mean\":\"Сценка-диалог\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"гп_спорим\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим, ты станешь тренером всего за 8 недель»\",\"ff\":\"Тренер Ж в студии, общий план\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"8 недель\",\"seg\":\"Широкий / не адресован\"},\"любители фитнеса_03\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Если фитнес — твоё… почему он… в месяц»\",\"ff\":\"Тренер в зале, без текста\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М\",\"mean\":\"Хобби → доход\",\"offer\":\"Доход\",\"seg\":\"Уже тренируются\"},\"rus_tz_bezstazh\":{\"ht\":\"Обращение к сегменту\",\"txt\":\"«Тратишь деньги на зал? А мог бы зарабатывать в нём от 500 000 ₸»\",\"ff\":\"Селфи тренера в зале\",\"fmt\":\"Селфи / кружок\",\"hero\":\"Тренер М\",\"mean\":\"Тренируешься → зарабатывай на этом\",\"offer\":\"12 недель, 500 000 ₸\",\"seg\":\"Уже тренируются\"},\"img_2099\":{\"ht\":\"Оффер в первом кадре\",\"txt\":\"«Хочешь вдохновлять и вести людей? Стань тренером групповых программ за 8 недель»\",\"ff\":\"Плашки с оффером поверх нарезки\",\"fmt\":\"Моушн-шаблон\",\"hero\":\"Без героя\",\"mean\":\"Вдохновлять людей\",\"offer\":\"Заявка, 8 недель\",\"seg\":\"Мотив «вдохновлять»\"},\"гп_1111\":{\"ht\":\"Нестандартный кадр\",\"txt\":\"Кружок в мессенджере: «Студия пилатеса… идёшь… Что если…»\",\"ff\":\"Телефон с видеосообщением\",\"fmt\":\"Селфи / кружок\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Из клиентки студии — в тренеры\",\"offer\":\"\",\"seg\":\"Ходят на групповые\"},\"гп_qaaaaaa\":{\"ht\":\"Как-то / инструкция\",\"txt\":\"«Как стать тренером групповых… тебе понадобится теория»\",\"ff\":\"Селфи-видео в рамке телефона\",\"fmt\":\"Селфи / кружок\",\"hero\":\"Тренер ГП, Ж\",\"mean\":\"Путь в профессию\",\"offer\":\"\",\"seg\":\"Широкий / не адресован\"},\"спорим_1409\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим, ты станешь фитнес-тренером всего за 12 недель»\",\"ff\":\"Тренер жестикулирует, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М, 40+\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"12 недель, работа в Invictus\",\"seg\":\"Широкий / не адресован\"},\"final1\":{\"ht\":\"Спор / вызов\",\"txt\":\"«Спорим, ты станешь фитнес-тренером всего за 4 месяца»\",\"ff\":\"Тренер жестикулирует, текст сразу\",\"fmt\":\"Говорящая голова + крупный текст\",\"hero\":\"Тренер М, 40+\",\"mean\":\"Быстрый вход в профессию\",\"offer\":\"4 месяца, работа в Invictus\",\"seg\":\"Широкий / не адресован\"},\"твоя_очередь\":{\"ht\":\"Сценка\",\"txt\":\"Два парня у входа в Invictus GO: «Твоя очередь… тренеры… ты же тренируешься»\",\"ff\":\"Двое у входа в клуб, общий план\",\"fmt\":\"Сценка\",\"hero\":\"Двое М\",\"mean\":\"Ты и так тренируешься → стань тренером\",\"offer\":\"\",\"seg\":\"Уже тренируются\"}}";

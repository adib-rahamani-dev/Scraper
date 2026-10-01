const $ = (selector) => document.querySelector(selector);
const formData = (form) => Object.fromEntries(new FormData(form).entries());
let noticeTimer;
function notice(message, error = false) {
  const element = $('#notice');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { element.hidden = true; }, 6500);
}
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'درخواست ناموفق بود.');
  return data;
}
async function action(callback) {
  try { await callback(); }
  catch (error) { notice(error.message || 'خطایی رخ داد.', true); }
}
async function refreshState() {
  const state = await api('/api/state');
  $('#count').textContent = state.count.toLocaleString('fa-IR');
  for (const item of state.sources) {
    const el = $(`#${item.source}-state`);
    el.textContent = item.open ? 'باز' : 'بسته';
    el.classList.toggle('open', item.open);
  }
  const citySelect = $('#search-city');
  if (!citySelect.options.length) for (const city of state.cities) citySelect.add(new Option(city, city));
}
async function refreshTabs() {
  const source = $('#save-source').value;
  const data = await api(`/api/browser/${source}/tabs`);
  const select = $('#save-tab');
  select.replaceChildren(new Option(data.tabs.length ? 'برگهٔ آگهی را انتخاب کن' : 'مرورگر بسته یا بدون برگه است', ''));
  for (const tab of data.tabs) {
    const option = new Option(`${tab.eligible ? '✓' : '—'} ${tab.title || tab.url}`.slice(0, 130), String(tab.index));
    option.disabled = !tab.eligible;
    select.add(option);
  }
  if (data.tabs.filter(tab => tab.eligible).length === 1) select.value = String(data.tabs.find(tab => tab.eligible).index);
}
async function refreshCaptureTabs() {
  const source = $('#capture-source').value;
  const { tabs } = await api(`/api/browser/${source}/tabs`);
  const select = $('#capture-tab');
  select.replaceChildren(new Option(tabs.length ? 'برگه را انتخاب کن' : 'مرورگر بسته یا بدون برگه است', ''));
  for (const tab of tabs) select.add(new Option(`${tab.title || tab.url}`.slice(0, 130), String(tab.index)));
  if (tabs.length === 1) select.value = String(tabs[0].index);
}
function filterQuery() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData($('#filters'))) if (String(value).trim()) params.set(key, String(value).trim());
  return params.toString();
}
async function refreshListings() {
  const query = filterQuery();
  $('#export').href = `/api/export.csv${query ? `?${query}` : ''}`;
  $('#export-xlsx').href = `/api/export.xlsx${query ? `?${query}` : ''}`;
  const { listings } = await api(`/api/listings${query ? `?${query}` : ''}`);
  $('#result-count').textContent = `${listings.length.toLocaleString('fa-IR')} آگهی در این فیلتر · ${listings.filter(ad=>ad.phone).length.toLocaleString('fa-IR')} شمارهٔ ثبت‌شده`;
  const root = $('#listings');
  root.replaceChildren();
  if (!listings.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'آگهی‌ای با این فیلتر پیدا نشد.'; root.append(empty); return; }
  const statuses = [['new','جدید'],['reviewing','در بررسی'],['contacted','تماس گرفته شد'],['done','انجام‌شده']];
  for (const ad of listings) {
    const item = document.createElement('article'); item.className = 'item';
    const main = document.createElement('div');
    const link = document.createElement('a'); link.className = 'item-title'; link.href = ad.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ad.title;
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${ad.source === 'divar' ? 'دیوار' : 'شیپور'} · ${[ad.topic, ad.city, ad.region, ad.price].filter(Boolean).join(' · ') || 'بدون دسته‌بندی'}${ad.phone ? ` · ${ad.contact_source === 'visible' ? 'شمارهٔ نمایانِ تأییدشده' : 'شمارهٔ دستی'}: ${ad.phone}` : ''}`;
    main.append(link, meta);
    try {const attrs=JSON.parse(ad.attributes||'[]');if(attrs.length){const detail=document.createElement('details');const summary=document.createElement('summary');summary.textContent=`مشخصات ${ad.category||'آگهی'} (${attrs.length})`;const info=document.createElement('p');info.textContent=attrs.map(a=>`${a.label}: ${a.value}`).join(' · ');detail.append(summary,info);main.append(detail);}}catch{}
    const actions = document.createElement('div'); actions.className = 'item-actions';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `وضعیت ${ad.title}`);
    for (const [value,label] of statuses) select.add(new Option(label,value));
    select.value = ad.status;
    select.addEventListener('change', () => action(async () => { await api(`/api/listings/${ad.id}`, 'PATCH', { status: select.value, note: ad.note }); notice('وضعیت ذخیره شد.'); }));
    const edit = document.createElement('button'); edit.className = 'ghost'; edit.textContent = 'یادداشت';
    edit.addEventListener('click', () => action(async () => { const note = prompt('یادداشت آگهی', ad.note); if (note === null) return; await api(`/api/listings/${ad.id}`, 'PATCH', { status: select.value, note }); ad.note = note; await refreshListings(); notice('یادداشت ذخیره شد.'); }));
    const enrich = document.createElement('button'); enrich.className = 'secondary'; enrich.textContent = 'بازکردن و تکمیل';
    enrich.addEventListener('click', () => action(async () => { enrich.disabled = true; try { await api(`/api/listings/${ad.id}/enrich`, 'POST'); $('#capture-source').value = ad.source; await refreshCaptureTabs(); await refreshListings(); notice('صفحهٔ اصلی آگهی باز شد و جزئیات نمایان تکمیل شد.'); } finally { enrich.disabled = false; } }));
    actions.append(select, edit, enrich);
    item.append(main, actions);
    if (ad.description) { const detail=document.createElement('details');detail.className='item-note';const summary=document.createElement('summary');summary.textContent='توضیحات کامل آگهی';const desc=document.createElement('p');desc.textContent=ad.description;detail.append(summary,desc);item.append(detail); }
    if (ad.note) { const note = document.createElement('div'); note.className = 'item-note'; note.textContent = `یادداشت: ${ad.note}`; item.append(note); }
    root.append(item);
  }
}
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => action(async () => {
  button.disabled = true;
  try { await api(`/api/browser/${button.dataset.open}/open`, 'POST'); await refreshState(); if ($('#save-source').value === button.dataset.open) await refreshTabs(); if ($('#capture-source').value === button.dataset.open) await refreshCaptureTabs(); notice('مرورگر باز شد. شماره و کد تأیید را در خود سایت وارد کن.'); }
  finally { button.disabled = false; }
})));
document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => action(async () => {
  button.disabled = true;
  try { const result = await api(`/api/browser/${button.dataset.login}/login`, 'POST',{phone:$('#login-phone').value}); await refreshState(); notice(result.message); }
  finally { button.disabled = false; }
})));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => action(async () => { await api(`/api/browser/${button.dataset.close}/close`, 'POST'); await refreshState(); await refreshTabs(); await refreshCaptureTabs(); notice('مرورگر بسته شد؛ نشست محلی برای بار بعد باقی است.'); })));
document.querySelectorAll('[data-tabs]').forEach(button => button.addEventListener('click', () => action(async () => { $('#save-source').value = button.dataset.tabs; await refreshTabs(); $('#manual-edit').open=true; $('#save-form').scrollIntoView({ behavior: 'smooth' }); })));
$('#refresh-tabs').addEventListener('click', () => action(refreshTabs));
$('#save-source').addEventListener('change', () => action(refreshTabs));
$('#search-form').addEventListener('submit', event => { event.preventDefault(); const data=formData(event.currentTarget);action(async () => { const result=await api(`/api/browser/${data.source}/search`, 'POST', { topic: data.topic, city: data.city });$('#capture-source').value=data.source;await refreshCaptureTabs();const tab=result.tabs.find(t=>t.url===result.url);if(tab)$('#capture-tab').value=String(tab.index);await beginExtraction();await refreshState(); }); });
$('#link-form').addEventListener('submit', event => { event.preventDefault(); action(async () => { const data = formData(event.currentTarget); await api(`/api/browser/${data.source}/navigate`, 'POST', { url: data.url }); $('#capture-source').value = data.source; await refreshCaptureTabs(); await refreshState(); notice('لینک فیلترشده در مرورگر اصلی باز شد.'); }); });
$('#capture-source').addEventListener('change', () => action(refreshCaptureTabs));
$('#capture-refresh').addEventListener('click', () => action(refreshCaptureTabs));
async function capture(kind) {
  const source = $('#capture-source').value;
  const tabIndex = $('#capture-tab').value;
  if (tabIndex === '') throw new Error('برگهٔ مرورگر را انتخاب کن.');
  if (kind === 'search' && !confirm('آگهی‌های بارگذاری‌شدهٔ همین صفحه، بدون شماره تماس، ثبت شوند؟')) return;
  const result = await api(`/api/browser/${source}/capture`, 'POST', { kind, tabIndex: Number(tabIndex) });
  notice(kind === 'search' ? `${result.saved} آگهی تازه و ${result.duplicate} مورد تکراری ثبت شد.` : result.duplicate ? 'آگهی قبلی با جزئیات تازه تکمیل شد.' : 'جزئیات آگهی ذخیره شد.');
  await refreshState(); await refreshListings();
}
$('#capture-search').addEventListener('click', () => action(() => capture('search')));
$('#capture-detail').addEventListener('click', () => action(() => capture('detail')));
$('#capture-contact').addEventListener('click', () => action(async () => {
  const source = $('#capture-source').value;
  const tabIndex = $('#capture-tab').value;
  const basis = $('#visible-contact-basis').value;
  if (tabIndex === '') throw new Error('برگهٔ آگهی را انتخاب کن.');
  if (!basis || !$('#visible-contact-confirm').checked) throw new Error('مبنای مجاز ارتباط و تأیید ثبت لازم است.');
  const button = $('#capture-contact'); button.disabled = true;
  try {
    const result = await api(`/api/browser/${source}/capture-contact`, 'POST', { tabIndex: Number(tabIndex), basis, confirmed: true });
    notice(`شمارهٔ نمایان ${result.phone} برای همین آگهی ثبت شد.`);
    await refreshState(); await refreshListings();
  } finally { button.disabled = false; }
}));
$('#save-form').addEventListener('submit', event => { event.preventDefault(); action(async () => { const form = event.currentTarget; const data = formData(form); if (data.tabIndex === '') throw new Error('یک برگهٔ آگهی انتخاب کن.'); const result = await api('/api/listings', 'POST', { ...data, tabIndex: Number(data.tabIndex), contactConfirmed: Boolean(data.contactConfirmed) }); notice(result.duplicate ? 'این لینک یا شماره قبلاً ذخیره شده؛ مورد تکراری اضافه نشد.' : 'آگهی ذخیره شد.'); await refreshState(); await refreshListings(); }); });
$('#filters').addEventListener('input', event => action(async()=>{if(event.target===$('#run-filter'))await refreshRuns();await refreshListings();}));
let activeRun='';
let runsInitialized=false;
let historyBatch='';
async function refreshRuns(selectId) {
  const [runs,history]=await Promise.all([api('/api/capture-runs'),api('/api/capture-runs/history')]);const select=$('#run-filter');const selected=selectId||(!runsInitialized?runs[0]?.id||'':select.value);runsInitialized=true;
  select.replaceChildren(new Option('همهٔ بانک آگهی‌ها',''));
  for(const run of runs)select.add(new Option(`${run.topic||'جست‌وجو'} · ${run.city} · ${new Date(run.created_at).toLocaleString('fa-IR')} · ${run.processed}/${run.total}`,run.id));
  if(selectId || runs.some(r=>r.id===selected))select.value=selected;
  const selectedRun=runs.find(r=>r.id===select.value);
  $('#delete-run').disabled=!selectedRun||['running','queued','paused'].includes(selectedRun.status);
  $('#clear-history').disabled=!history.removable;
  $('#restore-history').hidden=!history.archived;
  $('#restore-history').textContent=`بازیابی تاریخچه (${history.archived.toLocaleString('fa-IR')})`;
  const current=runs.find(r=>r.id===(activeRun||select.value));
  $('#run-progress').textContent=current?`${current.topic} · ${current.processed}/${current.total} · ${current.message}`:'برای شروع، جست‌وجو را باز کن.';
  $('#stop-extraction').disabled=!runs.some(r=>r.id===activeRun&&r.status==='running');
  if(current?.status!=='running'&&current?.id===activeRun)activeRun='';
}
async function beginExtraction(){const source=$('#capture-source').value;const index=$('#capture-tab').value;if(index==='')throw new Error('برگهٔ جست‌وجو را انتخاب کن.');const run=await api(`/api/browser/${source}/extract`,'POST',{tabIndex:Number(index),limit:Number($('#detail-limit').value)});activeRun=run.id;await refreshRuns(run.id);await refreshListings();notice(`استخراج ${run.total} آگهی شروع شد؛ پیشرفت در بخش اجرای جست‌وجو نمایش داده می‌شود.`);}
$('#extract-details').onclick=()=>action(beginExtraction);
$('#stop-extraction').onclick=()=>action(async()=>{if(activeRun)await api(`/api/capture-runs/${activeRun}/cancel`,'POST');notice('درخواست توقف ارسال شد.');});
$('#login-form').onsubmit=event=>{event.preventDefault();const phone=$('#login-phone').value;const button=event.currentTarget.querySelector('button');action(async()=>{button.disabled=true;try{const results=await Promise.allSettled(['divar','sheypoor'].map(source=>api(`/api/browser/${source}/login`,'POST',{phone})));$('#login-phone').value='';notice(results.map((r,i)=>`${i?'شیپور':'دیوار'}: ${r.status==='fulfilled'?r.value.message:r.reason.message}`).join(' · '));await refreshState();}finally{button.disabled=false;}});};
setInterval(()=>{if(activeRun)void action(async()=>{await refreshRuns();await refreshListings();await refreshState();});},2500);
// Keep the common workflow up front and progressively disclose the manual tools.
function improveLayout(){
  const nav=document.createElement('nav');nav.className='quick-nav';nav.setAttribute('aria-label','دسترسی سریع');
  for(const [text,href] of [['جست‌وجو و استخراج','#discover'],['ورود به سایت‌ها','#login-section'],['نتایج و اکسل','#results'],['دانلود افزونه ↓','/lead-radar-extension.zip']]){const link=document.createElement('a');link.textContent=text;link.href=href;if(href.endsWith('.zip'))link.download='';nav.append(link);}
  $('.top').after(nav);
  nav.addEventListener('click',event=>{const href=event.target.closest('a')?.getAttribute('href');if(href==='#login-section')$('#login-section').open=true;});
  const search=$('#search-form').closest('section');search.id='discover';search.classList.add('discover-card');search.style.order='1';
  const extract=$('#extract-details').closest('section');extract.id='execution';extract.style.order='2';
  const results=$('#filters').closest('section');results.id='results';results.style.order='4';
  for(const [section,id,title,subtitle,order] of [[$('#login-form').closest('section'),'login-section','ورود با شمارهٔ خودت','کد پیامکی فقط در سایت اصلی',3],[$('.sources'),'browser-tools','مدیریت مرورگرهای دیوار و شیپور','بازکردن، ورود، برگه‌ها و بستن مرورگر',5],[$('#capture-source').closest('section'),'manual-tools','ابزارهای برداشت دستی و تماس','انتخاب برگه، جزئیات یا شمارهٔ نمایان',6],[$('#save-form').closest('section'),'manual-edit','تکمیل دستی اطلاعات آگهی','موضوع، منطقه، یادداشت و شمارهٔ مجاز',7]]){
    const details=document.createElement('details');details.id=id;details.className='card disclosure';details.style.order=String(order);
    const summary=document.createElement('summary');summary.textContent=title;const small=document.createElement('small');small.textContent=subtitle;summary.append(small);
    section.before(details);section.classList.remove('card');section.classList.add('disclosure-body');details.append(summary,section);
  }
  $('.hint').style.order='8';
  // Match keyboard/assistive-technology order to the visual workflow.
  const main=$('main');[...main.children].sort((a,b)=>Number(a.style.order)-Number(b.style.order)).forEach(section=>main.append(section));
  const history=document.createElement('details');history.className='inline-disclosure history-disclosure';
  history.innerHTML='<summary>مدیریت و پاک‌سازی تاریخچه</summary><div class="history-actions"><button id="delete-run" class="ghost danger" disabled>حذف این اجرا از تاریخچه</button><button id="clear-history" class="ghost danger" disabled>پاک‌سازی تاریخچه</button><button id="restore-history" class="secondary" hidden>بازیابی تاریخچه</button></div><p class="inline-hint">فقط تاریخچه خلوت می‌شود؛ آگهی‌ها، شماره‌ها و خروجی‌های قبلی محفوظ‌اند. اجراهای فعال حذف نمی‌شوند.</p><div id="history-feedback" role="status" hidden><span id="history-message"></span><button id="undo-history" class="secondary" hidden>واگرد</button></div>';
  const count=document.createElement('p');count.id='result-count';count.className='result-count';count.setAttribute('role','status');$('#listings').before(history,count);
}
improveLayout();
const bulkDialog=document.createElement('dialog');bulkDialog.className='history-confirm-dialog';bulkDialog.setAttribute('aria-labelledby','bulk-confirm-title');
bulkDialog.innerHTML='<form id="bulk-confirm-form"><h2 id="bulk-confirm-title">پاک‌سازی کلی تاریخچه</h2><p>همهٔ اجراهای غیرفعال از تاریخچه کنار گذاشته می‌شوند. آگهی‌ها و شماره‌ها باقی می‌مانند و تاریخچه قابل بازیابی است.</p><label>برای تأیید بنویس: <strong>من تایید میکنم</strong><input id="bulk-confirm-text" autocomplete="off" placeholder="من تایید میکنم" required></label><p id="bulk-confirm-error" role="alert" hidden></p><div class="history-actions"><button id="bulk-confirm-cancel" type="button" class="ghost">انصراف</button><button id="bulk-confirm-submit" type="submit" class="ghost danger" disabled>تأیید پاک‌سازی کلی</button></div></form>';
document.body.append(bulkDialog);
$('#clear-history').textContent='پاک‌سازی کلی تاریخچه';
$('#bulk-confirm-text').oninput=()=>{$('#bulk-confirm-submit').disabled=$('#bulk-confirm-text').value!=='من تایید میکنم';};
$('#bulk-confirm-cancel').onclick=()=>bulkDialog.close();
$('#bulk-confirm-form').onsubmit=event=>{event.preventDefault();action(async()=>{$('#bulk-confirm-submit').disabled=true;$('#bulk-confirm-text').readOnly=true;try{await changeHistory(false,true,$('#bulk-confirm-text').value);bulkDialog.close();}catch(error){$('#bulk-confirm-error').hidden=false;$('#bulk-confirm-error').textContent=error.message;}finally{$('#bulk-confirm-text').readOnly=false;$('#bulk-confirm-submit').disabled=$('#bulk-confirm-text').value!=='من تایید میکنم';}});};
async function changeHistory(restore,all,confirmText=''){
  if(!restore&&all&&confirmText!=='من تایید میکنم'){bulkDialog.showModal();$('#bulk-confirm-text').value='';$('#bulk-confirm-submit').disabled=true;$('#bulk-confirm-error').hidden=true;$('#bulk-confirm-text').focus();return;}
  if(!restore&&!all&&!confirm('این اجرا از تاریخچه حذف شود؟ آگهی‌ها و شماره‌ها باقی می‌مانند و تاریخچه قابل بازیابی است.'))return;
  if(restore&&all&&!confirm('تمام تاریخچهٔ حذف‌شده دوباره نمایش داده شود؟'))return;
  const buttons=document.querySelectorAll('.history-actions button,#undo-history');buttons.forEach(b=>{b.disabled=true;});
  try{
    const result=await api(`/api/capture-runs/history/${restore?'restore':'delete'}`,'POST',{confirm:true,...(all?{all:true,...(!restore?{confirmText}:{})}:restore?{batch:historyBatch}:{ids:[$('#run-filter').value]})});
    historyBatch=restore?'':result.changed?result.batch:'';
    $('#history-feedback').hidden=false;$('#history-message').textContent=`${result.changed.toLocaleString('fa-IR')} اجرا ${restore?'بازیابی شد.':'از تاریخچه حذف شد؛ بانک اطلاعاتی حفظ شد.'}`;$('#undo-history').hidden=!historyBatch;
    await refreshRuns();await refreshListings();
  }finally{buttons.forEach(b=>{b.disabled=false;});await refreshRuns();}
}
$('#delete-run').onclick=()=>action(()=>changeHistory(false,false));
$('#clear-history').onclick=()=>action(()=>changeHistory(false,true));
$('#restore-history').onclick=()=>action(()=>changeHistory(true,true));
$('#undo-history').onclick=()=>action(()=>changeHistory(true,false));
action(async () => {$('#search-form button').textContent='جست‌وجو و استخراج جزئیات';await refreshState(); await refreshTabs(); await refreshCaptureTabs(); await refreshRuns(); await refreshListings(); });

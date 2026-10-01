const CLOUD_API = 'https://lead-radar-jade.vercel.app';
const LOCAL_API = 'http://127.0.0.1:4300';
const hosts = { divar: ['divar.ir','www.divar.ir'], sheypoor: ['sheypoor.com','www.sheypoor.com'] };
let chain = Promise.resolve();
const serial = fn => { const result=chain.then(fn); chain=result.catch(()=>{}); return result; };
function official(raw,source,kind) {
  const u=new URL(raw); if(u.protocol!=='https:' || u.username || u.password || u.port || !hosts[source]?.includes(u.hostname) || (kind && !u.pathname.startsWith(`/${kind}/`))) throw new Error('آدرس رسمی نامعتبر است.');
  if(kind==='v'){u.search='';u.hash='';} return u.href;
}
async function api(path,body,method='POST') {
  const {leadRadarToken,leadRadarEndpoint}=await chrome.storage.local.get(['leadRadarToken','leadRadarEndpoint']);
  if(!leadRadarToken)throw new Error('کلید اتصال را در تنظیمات افزونه وارد کن.');
  const response=await fetch((leadRadarEndpoint===LOCAL_API?LOCAL_API:CLOUD_API)+path,{method,credentials:'omit',headers:{'content-type':'application/json',authorization:`Bearer ${leadRadarToken}`},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  const data=await response.json().catch(()=>({})); if(!response.ok)throw new Error(data.error||`خطای سرور (${response.status})`);return data;
}
const jobGet=async()=> (await chrome.storage.local.get('captureJob')).captureJob;
const jobSave=job=>chrome.storage.local.set({captureJob:job});
async function badge(paused){try{await chrome.action.setBadgeText({text:paused?'!':''});if(paused)await chrome.action.setBadgeBackgroundColor({color:'#B87524'});}catch{}}
async function runUpdate(job) { await api(`/api/extension/runs/${job.id}`,{status:job.status,processed:job.processed,failed:job.failed,message:job.message},'PATCH'); }
async function pause(job,error) {
  const wasPaused=job.status==='paused';job.status='paused';job.stage='idle';job.message=error?.message||String(error);if(!wasPaused)job.pausedAt=new Date().toISOString();await jobSave(job);await badge(true);
  await chrome.alarms.clear('capture-step');await chrome.alarms.clear('capture-watch');
  await runUpdate(job).catch(()=>{});
}
async function startRun(source,search,limit) {
  const previous=await jobGet();if(previous && ['running','paused'].includes(previous.status))throw new Error('اجرای قبلی را تمام یا متوقف کن.');
  const searchUrl=official(search.context.searchUrl,source,'s');
  const urls=[...new Set(search.items.map(i=>official(i.url,source,'v')))].slice(0,Math.max(1,Math.min(20,Number(limit)||20)));
  if(!urls.length)throw new Error('نتیجه‌ای بارگذاری نشده است.');
  const run=await api('/api/extension/runs',{source,...search.context,searchUrl,total:urls.length});
  const job={...run,context:{...search.context,searchUrl},urls,index:0,stage:'idle',tabId:null,api:(await chrome.storage.local.get('leadRadarEndpoint')).leadRadarEndpoint||CLOUD_API};
  await jobSave(job);await badge(false);await chrome.alarms.create('capture-step',{when:Date.now()+1000});return job;
}
async function next() {
  const job=await jobGet();if(!job||job.status!=='running'||job.stage!=='idle')return;
  if(job.index>=job.urls.length){job.status=job.failed?'partial':'completed';job.message=`پایان: ${job.processed} آگهی کامل، ${job.failed} ناموفق`;await jobSave(job);await badge(false);await runUpdate(job);return;}
  if(((await chrome.storage.local.get('leadRadarEndpoint')).leadRadarEndpoint||CLOUD_API)!==job.api){await pause(job,new Error('مقصد اتصال تغییر کرده؛ اجرا متوقف شد.'));return;}
  const paceKey=`capture-next-${job.source}`;
  const nextAt=Number((await chrome.storage.local.get(paceKey))[paceKey]||0);
  if(nextAt>Date.now()){job.message='انتظار برای فاصلهٔ ثابت ۳۰ ثانیه‌ای';await jobSave(job);await chrome.alarms.create('capture-step',{when:nextAt});return;}
  await chrome.storage.local.set({[paceKey]:Date.now()+30000});
  job.stage='loading';job.message=`بازکردن آگهی ${job.index+1} از ${job.total}`;await jobSave(job);
  await chrome.alarms.create('capture-watch',{when:Date.now()+45000});
  try {
    if(job.reuseTab&&job.tabId!==null){
      job.reuseTab=false;let tab;try{tab=await chrome.tabs.get(job.tabId);}catch{job.tabId=null;}
      await jobSave(job);let matching=false;try{matching=Boolean(tab&&official(tab.url,job.source,'v')===job.urls[job.index]);}catch{}
      if(matching){await chrome.tabs.update(tab.id,{active:true});await collect(tab.id,tab.url);return;}
    }
    if(job.tabId!==null)await chrome.tabs.update(job.tabId,{url:job.urls[job.index],active:true});
    else {const tab=await chrome.tabs.create({url:'about:blank',active:true});job.tabId=tab.id;await jobSave(job);await chrome.tabs.update(tab.id,{url:job.urls[job.index]});}
  }catch(error){await pause(job,error);}
}
async function collect(tabId,url) {
  const job=await jobGet();if(!job||job.status!=='running'||job.stage!=='loading'||job.tabId!==tabId)return;
  let actual;try{actual=official(url,job.source,'v');}catch{return;}
  if(actual!==job.urls[job.index])return;
  job.stage='reading';await jobSave(job);
  try {
    const result=await chrome.tabs.sendMessage(tabId,{command:'detail',context:job.context});
    if(result?.error)throw new Error(result.error);if(!result?.ad||official(result.ad.url,job.source,'v')!==actual)throw new Error('اطلاعات برگه با آگهی انتخابی تطابق ندارد.');
    await api('/api/extension/capture',{source:job.source,mode:'detail',runId:job.id,items:[result.ad]});
    job.processed++;job.index++;job.stage='idle';job.message=`${job.processed} آگهی کامل از ${job.total}`;
    await jobSave(job);await runUpdate(job);await chrome.alarms.clear('capture-watch');await chrome.alarms.create('capture-step',{when:Date.now()+1000});
  }catch(error){await pause(job,error);}
}
async function dispatchLogin(tabId) {
  const key=`login-${tabId}`;const stored=await chrome.storage.session.get(key);const task=stored[key];
  if(!task||task.state!=='pending')return;
  if(Date.now()>task.expires){await chrome.storage.session.remove(key);return;}
  task.state='dispatching';await chrome.storage.session.set({[key]:task});
  let result;try{result=await chrome.tabs.sendMessage(tabId,{command:'login',phone:task.phone});}catch(error){result={error:error.message};}
  await chrome.storage.session.remove(key);await chrome.alarms.clear(`login-expire-${tabId}`);
  await chrome.storage.local.set({[`loginState-${task.source}`]:{state:result?.state||'error',message:result?.message||result?.error||'پیام سایت را بررسی کن.',updatedAt:Date.now()}});
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  (async()=>{
    const own=sender.id===chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
    let panel=false;try{panel=sender.id===chrome.runtime.id&&['https://lead-radar-jade.vercel.app','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4300'].includes(new URL(sender.url).origin);}catch{}
    let source;try{const host=new URL(sender.url).hostname;source=Object.keys(hosts).find(s=>hosts[s].includes(host));}catch{}
    if(!own&&!source&&!panel)throw new Error('فرستنده نامعتبر است.');
    const action=message?.action;
    if(action==='contact-permit'&&source&&sender.tab&&message.payload?.source===source)return serial(async()=>{
      if(message.payload.confirmed!==true||!['direct-consent','public-business'].includes(message.payload.basis))throw new Error('تأیید و مبنای مجاز ثبت تماس لازم است.');
      if(official(sender.url,source,'v')!==official(message.payload.url,source,'v'))throw new Error('برگه با آگهی انتخاب‌شده تطابق ندارد.');
      const job=await jobGet();if(job?.source===source&&['running','paused'].includes(job.status))throw new Error('ابتدا صف این سایت را تمام یا متوقف کن.');
      const key=`capture-next-${source}`;const next=Number((await chrome.storage.local.get(key))[key]||0);
      if(next>Date.now())throw new Error(`برای رعایت ریت‌لیمیت، ${Math.ceil((next-Date.now())/1000)} ثانیه دیگر تلاش کن.`);
      await chrome.storage.local.set({[key]:Date.now()+30000});return {allowed:true};
    });
    if(panel&&!['status','configure','login','search','stop','resume','focus','options'].includes(action))throw new Error('دستور پنل نامعتبر است.');
    if(action==='status'&&(own||panel)){const state=await chrome.storage.local.get(['captureJob','leadRadarToken','leadRadarEndpoint']);const job=state.captureJob;return {connected:Boolean(state.leadRadarToken),endpoint:state.leadRadarEndpoint,job:job?{id:job.id,source:job.source,status:job.status,processed:job.processed,total:job.total,index:job.index,message:job.message,pausedAt:job.pausedAt||'',resumable:job.status==='paused'}:null};}
if(action==='configure'&&panel){if(typeof message.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(message.token))throw new Error('کلید اتصال نامعتبر است.');const endpoint=new URL(sender.url).hostname==='lead-radar-jade.vercel.app'?CLOUD_API:LOCAL_API;const job=await jobGet();if(job&&['running','paused'].includes(job.status))throw new Error('ابتدا اجرای فعال را متوقف کن.');await chrome.storage.local.set({leadRadarToken:message.token,leadRadarEndpoint:endpoint});return {connected:true};}
    if(action==='options'){await chrome.runtime.openOptionsPage();return {};}
    if(action==='dashboard'){const {leadRadarEndpoint}=await chrome.storage.local.get('leadRadarEndpoint');await chrome.tabs.create({url:leadRadarEndpoint===LOCAL_API?'http://127.0.0.1:5173/':CLOUD_API});return {};}
    if(action==='ready'&&sender.tab&&source){
      // Login never retries SMS automatically. The phone stays in session storage only until dispatch.
      await dispatchLogin(sender.tab.id);
      await serial(async()=>{const pending=(await chrome.storage.local.get('pendingSearch')).pendingSearch;
        if(pending?.tabId===sender.tab.id){await chrome.storage.local.remove('pendingSearch');try{const found=await chrome.tabs.sendMessage(sender.tab.id,{command:'search'});if(found.error)throw new Error(found.error);await startRun(pending.source,found.search,pending.limit);}catch(error){await chrome.storage.local.set({searchError:error.message});}}
        await collect(sender.tab.id,sender.url);
      });return {};
    }
    if(action==='login'&&(own||panel)){
      const phone=String(message.phone||'').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[\s-]/g,'');if(!/^09\d{9}$/.test(phone))throw new Error('شمارهٔ همراه معتبر وارد کن.');
      for(const s of message.source==='both'?['divar','sheypoor']:[message.source]){
        if(!hosts[s])throw new Error('سایت نامعتبر است.');
        const tab=await chrome.tabs.create({url:'about:blank',active:true});
        await chrome.storage.session.set({[`login-${tab.id}`]:{source:s,phone,state:'pending',expires:Date.now()+120000}});
        await chrome.alarms.create(`login-expire-${tab.id}`,{when:Date.now()+120000});
        await chrome.storage.local.set({[`loginState-${s}`]:{state:'opening',message:'در حال بازکردن فرم رسمی…',updatedAt:Date.now()}});
        await chrome.tabs.update(tab.id,{url:s==='divar'?'https://divar.ir/':'https://www.sheypoor.com/session/myAccount/myListings/all'});
      }return {};
    }
    if(action==='search'&&(own||panel)){const s=message.source;if(!hosts[s])throw new Error('سایت نامعتبر است.');
      const topic=String(message.topic||'').trim().slice(0,80);if(topic.length<2)throw new Error('موضوع را وارد کن.');
      const city=/^[a-z-]+$/.test(message.city)?message.city:'iran';const raw=message.url|| (s==='divar'?`https://divar.ir/s/${city}?q=${encodeURIComponent(topic)}`:`https://www.sheypoor.com/s/${city==='iran'?'iran':city}?q=${encodeURIComponent(topic)}`);
      const url=official(raw,s,'s');await api('/api/extension/ping',undefined,'GET');
      const previous=await jobGet();if(previous&&['running','paused'].includes(previous.status))throw new Error('ابتدا اجرای قبلی را متوقف یا تمام کن.');
      const tab=await chrome.tabs.create({url:'about:blank',active:true});await chrome.storage.local.set({pendingSearch:{tabId:tab.id,source:s,limit:message.limit},searchError:''});await chrome.tabs.update(tab.id,{url});return {};
    }
    if(action==='start-run'&&source && message.search?.source===source)return serial(()=>startRun(source,message.search,message.limit));
    if(action==='focus'&&(own||panel))return serial(async()=>{
      const job=await jobGet();if(job?.status!=='paused')throw new Error('صف متوقف‌شده پیدا نشد.');
      const url=official(job.urls[job.index],job.source,'v');
      let tab;try{if(job.tabId!==null)tab=await chrome.tabs.get(job.tabId);}catch{}
      let matching=false;try{matching=Boolean(tab&&official(tab.url,job.source,'v')===url);}catch{}
      if(matching){await chrome.tabs.update(tab.id,{active:true});return {url};}
      tab=await chrome.tabs.create({url:'about:blank',active:true});job.tabId=tab.id;await jobSave(job);await chrome.tabs.update(tab.id,{url});return {url};
    });
    if(['stop','resume'].includes(action))return serial(async()=>{const job=await jobGet();if(!job)return {};
      if(action==='resume'&&job.status!=='paused')throw new Error('فقط اجرای متوقف‌شده قابل ادامه است.');
      job.status=action==='stop'?'cancelled':'running';job.stage='idle';job.pausedAt='';job.reuseTab=action==='resume';job.message=action==='stop'?'اجرا متوقف شد':'ادامه از محل توقف پس از حل دستی';await jobSave(job);await badge(false);await runUpdate(job);
      await chrome.alarms.clear('capture-watch');if(action==='resume')await chrome.alarms.create('capture-step',{when:Date.now()+1000});return job;});
    if(['capture','contact'].includes(action)&&source&&message.payload?.source===source)return api(action==='capture'?'/api/extension/capture':'/api/extension/contact',message.payload);
    throw new Error('درخواست نامعتبر است.');
  })().then(result=>respond({result})).catch(error=>respond({error:error.message||'ارتباط ممکن نشد.'}));return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{void serial(async()=>{
  if(alarm.name.startsWith('login-expire-')){const id=Number(alarm.name.slice('login-expire-'.length));const key=`login-${id}`;const task=(await chrome.storage.session.get(key))[key];await chrome.storage.session.remove(key);if(task)await chrome.storage.local.set({[`loginState-${task.source}`]:{state:'error',message:'فرم ورود در زمان مقرر آماده نشد؛ شمارهٔ موقت پاک شد. سایت را بررسی و دوباره شروع کن.',updatedAt:Date.now()}});return;}
  const job=await jobGet();if(alarm.name==='capture-step')await next();
  else if(alarm.name==='capture-watch'&&job?.status==='running')await pause(job,new Error('برگه آماده نشد؛ سایت و اتصال را بررسی کن، سپس ادامه بده.'));
}).catch(async error=>{const job=await jobGet();if(job?.status==='running')await pause(job,error);});});
chrome.tabs.onRemoved.addListener(id=>{void chrome.storage.session.remove(`login-${id}`);void chrome.alarms.clear(`login-expire-${id}`);void serial(async()=>{const job=await jobGet();if(job?.tabId===id&&['running','paused'].includes(job.status)){job.tabId=null;await pause(job,new Error('برگهٔ استخراج بسته شد؛ ادامه یک برگهٔ تازه باز می‌کند.'));}});});
chrome.runtime.onStartup.addListener(()=>{void serial(async()=>{const job=await jobGet();if(job?.status==='running')await pause(job,new Error('مرورگر دوباره باز شده؛ برای ادامه دکمهٔ ادامه را بزن.'));});});

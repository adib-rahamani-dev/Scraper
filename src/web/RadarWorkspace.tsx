import { useEffect, useState } from 'react';
import { Download, Play, Radar, Phone, Square, Activity, CircleCheck, TriangleAlert } from 'lucide-react';
import CloudCaptureView from './CloudCaptureView';
import DataResetControls from './DataResetControls';
import CaptureAlerts from './CaptureAlerts';
import type { PausedCaptureRun } from '../shared/capture-alerts';
import { browserCommand } from './browser-bridge';
import type { Lead } from '../shared/types';
import './radar-workspace.css';

type Runtime={local:boolean};
type Run=PausedCaptureRun;
const cities=[['iran','کل ایران'],['tehran','تهران'],['qazvin','قزوین'],['rasht','رشت'],['karaj','کرج'],['mashhad','مشهد'],['isfahan','اصفهان'],['shiraz','شیراز'],['tabriz','تبریز'],['qom','قم'],['ahvaz','اهواز']];
async function api<T=unknown>(path:string,body?:unknown):Promise<T>{
  const res=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'ارتباط ممکن نشد.');return data as T;
}
export default function RadarWorkspace({onPublicSearch,onChanged,publicLeads,campaignId}:{onPublicSearch:(topic:string,city:string)=>Promise<void>;onChanged:()=>void;publicLeads:Lead[];campaignId:number|null}){
  const [runtime,setRuntime]=useState<Runtime|null>(null);
  const [connected,setConnected]=useState(false);
  const [topic,setTopic]=useState('');const [city,setCity]=useState('iran');
  const [source,setSource]=useState('all');const [url,setUrl]=useState('');
  const [limit,setLimit]=useState(20);const [phone,setPhone]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const [progress,setProgress]=useState('');const [version,setVersion]=useState(0);
  const [includePublic,setIncludePublic]=useState(true);const [publicVisible,setPublicVisible]=useState(false);
  const [runs,setRuns]=useState<Run[]>([]);
  const [resultView,setResultView]=useState('all');
  const [extensionVersion,setExtensionVersion]=useState('');
  const [lastSync,setLastSync]=useState<string>('');
  const [loginStatus,setLoginStatus]=useState<Array<{source:string;state:string;message:string}>>([]);
  const [installedVersion,setInstalledVersion]=useState('');
  const [sessionContext,setSessionContext]=useState('');
  const checkLogin=async(useExtension=false)=>{
    setSessionContext(runtime?.local&&!useExtension?'مرورگر همراه محلی':'مرورگر شخصیِ دارای افزونه');
    if(runtime?.local&&!useExtension){const results=await Promise.allSettled(['divar','sheypoor'].map(site=>api<{source:string;state:string;message:string}>(`/api/companion/browser/${site}/login-status`,{})));setLoginStatus(results.map((result,index)=>result.status==='fulfilled'?result.value:{source:['divar','sheypoor'][index]!,state:'unknown',message:String(result.reason?.message||'بررسی ورود ممکن نشد')}));}
    else {const result=await browserCommand<{sites:Array<{source:string;state:string;message:string}>;version:string}>('login-status');setLoginStatus(result.sites);setInstalledVersion(result.version);}
  };
  const latestRuns=['divar','sheypoor'].map(site=>runs.find(run=>run.source===site)).filter(Boolean) as Run[];
  const activeRuns=latestRuns.filter(run=>run.status==='running');
  const pausedRuns=latestRuns.filter(run=>run.status==='paused');
  const visibleSources=source==='all'?['divar','sheypoor']:[source];
  const publicContacts=publicLeads.filter(lead=>Boolean(lead.phone?.trim()));
  const cityLabel=cities.find(c=>c[0]===city)?.[1]||'کل ایران';
  useEffect(()=>{void api<Runtime>('/api/runtime').then(value=>{setRuntime(value);if(!value.local)setSource('divar');}).catch(error=>setMessage(error.message));},[]);
  useEffect(()=>{void fetch('/lead-radar-extension.json',{cache:'no-store'}).then(response=>response.json()).then(value=>{if(/^\d+(?:\.\d+){1,3}$/.test(value.version))setExtensionVersion(value.version);}).catch(()=>{});},[]);
  useEffect(()=>{
    if(!runtime)return;let alive=true;
    const refresh=async()=>{
      try{
        if(runtime.local){
          await api('/api/companion/state');const history=await api<Run[]>('/api/companion/capture-runs');
          if(alive){setConnected(true);setLastSync(new Date().toLocaleTimeString('fa-IR'));setRuns(history);const latest=['divar','sheypoor'].map(site=>history.find(run=>run.source===site)).filter(Boolean) as Run[];setProgress(latest.map(run=>`${run.source==='divar'?'دیوار':'شیپور'}: ${run.message}`).join(' · ')||'آمادهٔ جست‌وجو');}
        }else{
          const state=await browserCommand<{connected:boolean;job?:Run}>('status');
          if(alive){setConnected(state.connected);setLastSync(new Date().toLocaleTimeString('fa-IR'));setRuns(state.job?[state.job]:[]);setProgress(state.job?.message||'آمادهٔ جست‌وجو');}
        }
      }catch{if(alive)setConnected(false);}
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),5000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[runtime]);
  const perform=async(fn:()=>Promise<void>)=>{
    setBusy(true);setMessage('');try{await fn();}catch(error){setMessage(error instanceof Error?error.message:'درخواست انجام نشد.');}finally{setBusy(false);}
  };
  const startSite=async(site:string)=>{
    if(!runtime)throw new Error('در حال آماده‌سازی پنل');
    if(runtime.local){
      const result=await api<{url:string;tabs:Array<{index:number;url:string}>}>(`/api/companion/browser/${site}/${url&&source!=='all'?'navigate':'search'}`,url&&source!=='all'?{url}:{topic,city:cityLabel});
      const index=result.tabs.find(tab=>tab.url===result.url)?.index;
      if(index===undefined)throw new Error('برگهٔ جست‌وجو پیدا نشد.');
      await api(`/api/companion/browser/${site}/extract`,{tabIndex:index,limit});
    }else await browserCommand('search',{source:site,topic,city,url,limit});
    setVersion(v=>v+1);
  };
  const launch=async()=>{
    const tasks:Array<{label:string;run:()=>Promise<void>}>=[];
    if(source!=='public')for(const site of source==='all'?['divar','sheypoor']:[source])tasks.push({label:site==='divar'?'دیوار':'شیپور',run:()=>startSite(site)});
    const usePublic=source==='public'||includePublic;setPublicVisible(usePublic);
    if(usePublic)tasks.push({label:'منابع عمومی',run:()=>onPublicSearch(topic,cityLabel)});
    setMessage('در حال شروع منابع مستقل؛ هر منبع وضعیت و خروجی جدا دارد.');
    const results=await Promise.allSettled(tasks.map(task=>task.run()));
    setMessage(results.map((result,index)=>`${tasks[index]!.label}: ${result.status==='fulfilled'?'درخواست اجرا پذیرفته شد':result.reason instanceof Error?result.reason.message:'شروع ناموفق'}`).join(' · '));
  };
  const login=async()=>{
    if(!runtime)throw new Error('پنل هنوز آماده نیست.');
    if(runtime.local){
      const results=await Promise.allSettled(['divar','sheypoor'].map(site=>api(`/api/companion/browser/${site}/login`,{phone})));
      const errors=results.filter(r=>r.status==='rejected') as PromiseRejectedResult[];
      if(errors.length)throw new Error(errors.map(r=>r.reason.message).join(' · '));
    }else await browserCommand('login',{source:'both',phone});
    setPhone('');setMessage('فرم ورود سایت‌ها آماده می‌شود؛ کد پیامکی را در همان برگه وارد کن.');
  };
  const stop=async()=>{
    const errors:string[]=[];
    if(source==='public'||includePublic){
      try{const history=await api<Array<{id:number;status:string}>>('/api/runs');for(const run of history.filter(r=>['running','queued'].includes(r.status)))await api(`/api/runs/${run.id}/cancel`,{});onChanged();}catch(error){errors.push(String(error));}
    }
    if(source!=='public'){
      try{if(runtime?.local){const history=await api<Run[]>('/api/companion/capture-runs');for(const run of history.filter(r=>['running','paused'].includes(r.status)))await api(`/api/companion/capture-runs/${run.id}/cancel`,{});}else await browserCommand('stop');}catch(error){errors.push(String(error));}
    }
    setMessage(errors.length?errors.join(' · '):'درخواست توقف تمام منابع ارسال شد.');
  };
  return <div className="radar-workspace">
    <section className="radar-hero">
      <div className="radar-kicker"><Radar size={18}/> رادار یکپارچهٔ بازار ایران <span className={connected?'connected':''}>{connected?'مرورگر متصل':'نیازمند اتصال مرورگر'}</span></div>
      <h1>یک موضوع. چند منبع. آگهی‌ها و تماس‌های ثبت‌شده.</h1>
      <p>حالت محلی: دو مرورگر مستقل برای دیوار و شیپور، همراه با پویش منابع عمومی؛ هیچ شماره‌ای حدس زده نمی‌شود.</p>
      <div className="radar-overview" aria-label="وضعیت لحظه‌ای منابع"><div><Activity size={18}/><strong>{activeRuns.length.toLocaleString('fa-IR')}</strong><span>صف در حال اجرا</span></div><div className={pausedRuns.length?'needs-action':''}><TriangleAlert size={18}/><strong>{pausedRuns.length.toLocaleString('fa-IR')}</strong><span>صف منتظر اقدام</span></div><div><CircleCheck size={18}/><strong>{latestRuns.reduce((sum,run)=>sum+(Number(run.processed)||0),0).toLocaleString('fa-IR')}</strong><span>بررسی در آخرین صف‌ها</span></div><div><Radar size={18}/><strong>{runtime?.local?'محلی':'افزونه'}</strong><span>{connected&&lastSync?`آخرین اتصال ${lastSync}`:'در انتظار اتصال'}</span></div></div>
      <form className="radar-launch" onSubmit={event=>{event.preventDefault();void perform(launch);}}>
        <label>موضوع<input aria-label="موضوع" value={topic} onChange={event=>setTopic(event.target.value)} required minLength={2} placeholder="مثلاً موبایل، دوچرخه یا کابینت"/></label>
        <label>شهر<select aria-label="شهر" value={city} onChange={event=>setCity(event.target.value)}>{cities.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
        <label>منبع<select aria-label="منبع جست‌وجو" value={source} onChange={event=>setSource(event.target.value)}><option value="all" disabled={!runtime?.local}>دیوار + شیپور هم‌زمان (محلی)</option><option value="divar">دیوار</option><option value="sheypoor">شیپور</option><option value="public">منابع عمومی رادار</option></select></label>
        <button type="submit" className="primary-button" disabled={busy||!runtime}><Play size={18}/> {busy?'در حال شروع…':'جست‌وجو و استخراج'}</button>
        <details><summary>فیلترهای بیشتر</summary><label>تعداد آگهی در هر سایت<input aria-label="تعداد آگهی در هر سایت" type="number" min={1} max={20} value={limit} onChange={event=>setLimit(Number(event.target.value))}/></label><p>سقف هر اجرا ۲۰ آگهی؛ حداقل فاصلهٔ بازکردن آگهی‌ها در هر سایت ۳۰ ثانیه، حتی بین اجراها. کپچا باعث توقف می‌شود.</p>{source!=='all'&&<label>لینک جست‌وجوی فیلترشده<input type="url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://divar.ir/s/..."/></label>}</details>
      </form>
      <div className="radar-presets"><span>موضوع‌های سریع</span>{['لوازم تحریر','کیف مدرسه','اسباب بازی','موبایل'].map(value=><button type="button" key={value} disabled={busy} onClick={()=>setTopic(value)}>{value}</button>)}</div>
      {source!=='public'&&<label className="phone-only-control"><input type="checkbox" checked={includePublic} disabled={busy} onChange={event=>setIncludePublic(event.target.checked)}/> منابع عمومی رادار هم هم‌زمان فعال شوند</label>}
      <div className="radar-progress" role="status"><span>{progress||'در حال بررسی اتصال…'}</span><button className="ghost-button" onClick={()=>void stop()}><Square size={14}/> توقف همه</button></div>
      {message&&<p className="radar-message" role="status">{message}</p>}
      <div className="radar-progress"><button className="ghost-button" disabled={busy||!runtime} onClick={()=>void perform(()=>checkLogin())}>{runtime?.local?'بررسی ورود مرورگر همراه':'بررسی ورود قبلی دیوار و شیپور'}</button>{runtime?.local&&<button className="ghost-button" disabled={busy} onClick={()=>void perform(()=>checkLogin(true))}>بررسی ورود مرورگر شخصی با افزونه</button>}{installedVersion&&<span>نسخهٔ واقعاً نصب‌شده: {installedVersion}</span>}</div>
      {sessionContext&&<small>محل بررسی: {sessionContext}؛ نشست مرورگر همراه با Chrome شخصی جداست.</small>}
      {loginStatus.map(site=><p className="radar-message" role="status" key={site.source}>{site.source==='divar'?'دیوار':'شیپور'}: {site.message}</p>)}
      <CaptureAlerts runs={runs} busy={busy} onFocus={run=>void perform(async()=>{if(runtime?.local)await api(`/api/companion/capture-runs/${run.id}/focus`,{});else await browserCommand('focus');})} onResume={run=>void perform(async()=>{if(runtime?.local)await api(`/api/companion/capture-runs/${run.id}/resume`,{});else await browserCommand('resume');setMessage('ادامه از محل توقف درخواست شد؛ اگر کپچا باقی مانده باشد صف دوباره متوقف می‌شود.');})}/>
    </section>
    <details className="panel radar-login"><summary><Phone size={16}/> ورود به دیوار و شیپور</summary><form onSubmit={event=>{event.preventDefault();void perform(login);}}><label>شمارهٔ همراه خودت<input type="tel" inputMode="tel" value={phone} onChange={event=>setPhone(event.target.value)} required autoComplete="tel" placeholder="0912…"/></label><button className="primary-button" disabled={busy||!runtime}>آماده‌کردن ورود هر دو سایت</button><p>کد پیامکی را در سایت اصلی وارد کن. نمایش و ثبت تماس یک آگهی همچنان نیازمند اقدام و تأیید خودت است.</p></form></details>
    <div className="radar-connect panel"><div><strong>افزونهٔ مرورگر {extensionVersion&&<span dir="ltr">{extensionVersion}</span>}</strong><p>{!connected?(runtime?.local?'همراه محلی را با npm run companion اجرا کن.':'افزونه را نصب یا Reload کن و صفحه را تازه کن.'):runtime?.local?'همراه محلی متصل است؛ برای استفاده از Vercel افزونه را در مرورگر شخصی نصب کن.':'افزونه به پنل متصل است.'} برای به‌روزرسانی دستی، فایل‌های بسته را در همان پوشه جایگزین کن و در chrome://extensions دکمهٔ Reload را بزن؛ سپس برگه‌ها را تازه کن.</p><small>شمارهٔ بالا نسخهٔ بستهٔ دانلود است، نه تأیید نسخهٔ نصب‌شده؛ نسخهٔ نصب‌شده در پنجرهٔ افزونه نمایش داده می‌شود.</small></div><a className="primary-button" href="/lead-radar-extension.zip" download><Download size={16}/> دانلود آخرین افزونه</a></div>
    {runtime&&<section className="panel radar-cleanup"><h2>مدیریت بانک و حذف همهٔ اطلاعات</h2><DataResetControls localMode={runtime.local} onChanged={()=>{setVersion(v=>v+1);onChanged();}}/></section>}
    {source==='all'&&<nav className="radar-result-tabs" aria-label="نمایش نتایج منابع">{[['all','هر دو سایت'],['divar','فقط دیوار'],['sheypoor','فقط شیپور']].map(([value,label])=><button type="button" key={value} aria-pressed={resultView===value} onClick={()=>setResultView(value!)}>{label}</button>)}</nav>}
    {source!=='public'&&runtime&&visibleSources.map(site=><section className="source-workspace" key={site} hidden={source==='all'&&resultView!=='all'&&resultView!==site}><h2>{site==='divar'?'دیوار':'شیپور'} · آگهی‌ها و اطلاعات تماس</h2><CloudCaptureView key={`${runtime.local}:${version}:${site}`} localMode={runtime.local} sourceFilter={site}/></section>)}
    {(source==='public'||publicVisible)&&<section className="panel public-results"><div className="capture-results-heading"><h2>شماره‌های منابع عمومی ({publicContacts.length.toLocaleString('fa-IR')})</h2><a className="primary-button" href={`/api/export.xlsx${campaignId?`?campaignId=${campaignId}`:''}`}><Download size={16}/> دریافت اکسل</a></div>{publicContacts.length?publicContacts.map(lead=><article key={lead.id}><div><h3>{lead.title}</h3><span>{lead.city} · {lead.source}</span></div><a href={`tel:${lead.phone}`} dir="ltr">{lead.phone}</a><a href={lead.url} target="_blank" rel="noreferrer">مشاهدهٔ آگهی</a></article>):<p>هنوز شمارهٔ عمومی در این پویش یافت نشده است.</p>}</section>}
  </div>;
}

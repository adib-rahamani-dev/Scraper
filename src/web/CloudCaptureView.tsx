import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import HistoryControls from './HistoryControls';
import { browserCommand } from './browser-bridge';

type Ad = { id: number; source: 'divar' | 'sheypoor'; title: string; url: string; topic: string; city: string; region: string; price: string; description: string; phone: string | null; contact_basis: string; note: string; status: 'new' | 'reviewing' | 'contacted' | 'done'; saved_at: string };
type TokenStatus = { active: boolean; createdAt: string | null; expiresAt: string | null };
type CaptureRun = {id:string;source:string;topic:string;city:string;status:string;total:number;processed:number;failed:number;message:string;created_at:string;search_url:string};
const runStatus: Record<string, string> = { running: 'در حال اجرا', paused: 'متوقف', completed: 'تکمیل‌شده', partial: 'تکمیل ناقص', cancelled: 'لغوشده', failed: 'ناموفق' };

async function globalRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'ارتباط با سرور برقرار نشد.');
  return data as T;
}

export default function CloudCaptureView({localMode=false,sourceFilter=''}:{localMode?:boolean;sourceFilter?:string}) {
  const request=async<T,>(path:string,options?:RequestInit):Promise<T>=>{
    if(!localMode)return await globalRequest<T>(path,options);
    const mapped=path.replace('/api/captured-ads','/api/listings').replace('/api/','/api/companion/');
    const data=await globalRequest<unknown>(mapped,options);
    if(path.startsWith('/api/captured-ads?'))return (data as {listings:T}).listings;
    if(options?.method==='PATCH')return (data as {ad:T}).ad;
    return data as T;
  };
  const exportPath=localMode?'/api/companion/export':'/api/captured-ads/export';
  const [ads, setAds] = useState<Ad[]>([]);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [freshToken, setFreshToken] = useState('');
  const [source, setSource] = useState(sourceFilter);
  const [phoneOnly,setPhoneOnly]=useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runs,setRuns]=useState<CaptureRun[]>([]);
  const [runId,setRunId]=useState('');
  const [followLatest,setFollowLatest]=useState(true);
  const requestGeneration=useRef(0);
  const query = useMemo(() => new URLSearchParams({ source:sourceFilter||source, status, search,runId,phoneOnly:phoneOnly?'1':'0' }), [source,sourceFilter,status,search,runId,phoneOnly]);

  const refresh = async () => {
    const generation=++requestGeneration.current;
    try {
      const history=(await request<CaptureRun[]>('/api/capture-runs')).filter(run=>!sourceFilter||run.source===sourceFilter);
      if(generation!==requestGeneration.current)return;
      const activeId=followLatest?(history[0]?.id||''):history.some(run=>run.id===runId)?runId:'';
      const activeQuery=new URLSearchParams(query);activeQuery.set('runId',activeId);
      if(activeId!==runId){setLoading(true);setRunId(activeId);}
      const [list, token] = await Promise.all([request<Ad[]>(`/api/captured-ads?${activeQuery}`), localMode?Promise.resolve(null):request<TokenStatus>('/api/extension-token')]);
      if(generation!==requestGeneration.current)return;
      setAds(list); setTokenStatus(token);setRuns(history); setError('');
    } catch (caught) { if(generation===requestGeneration.current)setError(caught instanceof Error ? caught.message : 'خطا در دریافت داده'); }
    finally { if(generation===requestGeneration.current)setLoading(false); }
  };
  useEffect(() => {setLoading(true); void refresh();return ()=>{requestGeneration.current++;}; }, [query,followLatest]);
  useEffect(()=>{const timer=window.setInterval(()=>void refresh(),5000);return ()=>window.clearInterval(timer);},[query,followLatest]);

  const createToken = async () => {
    if (!window.confirm('کلید قبلی افزونه باطل شود و کلید جدید ساخته شود؟')) return;
    setBusy(true); setNotice('');
    try {
      const result = await request<{ token: string; expiresAt: string }>('/api/extension-token', { method: 'POST', body: JSON.stringify({ confirm: true }) });
      setFreshToken(result.token); setNotice('کلید را همین حالا در تنظیمات افزونه ذخیره کن؛ بعداً دوباره نمایش داده نمی‌شود.'); await refresh();
      try{await browserCommand('configure',{token:result.token});setNotice('افزونه مستقیماً به همین پنل متصل شد.');}catch{/* Manual connection remains available. */}
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'ساخت کلید ممکن نشد.'); }
    finally { setBusy(false); }
  };
  const revokeToken = async () => {
    if (!window.confirm('کلید فعلی باطل شود؟ افزونه تا ساخت کلید جدید دیگر متصل نمی‌شود.')) return;
    setBusy(true);
    try { await request('/api/extension-token', { method: 'DELETE' }); setFreshToken(''); setNotice('کلید باطل شد.'); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'لغو کلید ممکن نشد.'); }
    finally { setBusy(false); }
  };
  const updateAd = async (ad: Ad, nextStatus: Ad['status'], note: string) => {
    try { const result = await request<Ad>(`/api/captured-ads/${ad.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, note }) }); setAds(items => items.map(item => item.id === ad.id ? {...item,status:result.status,note:result.note} : item)); setNotice('آگهی به‌روزرسانی شد.'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'ذخیره ممکن نشد.'); }
  };
  const importLocal = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_800_000) { setError('فایل بزرگ‌تر از حد مجاز است؛ آن را به دسته‌های کوچک‌تر تقسیم کن.'); return; }
    try {
      const parsed = JSON.parse(await file.text()) as { format?: string; items?: unknown[] };
      if (parsed.format !== 'lead-radar-local-ads-v1' || !Array.isArray(parsed.items) || !parsed.items.length) throw new Error('این فایل، خروجی JSON همراه محلی رادار نیست.');
      const phoneCount = parsed.items.filter(item => Boolean((item as { phone?: unknown })?.phone)).length;
      if (!window.confirm(`آیا ${parsed.items.length} آگهی، شامل ${phoneCount} شماره، از فایل محلی به پایگاه ابری خصوصی منتقل شوند؟`)) return;
      setBusy(true); setError('');
      const result = await request<{ saved: number; duplicate: number; phones: number }>('/api/captured-ads/import', { method: 'POST', body: JSON.stringify({ confirm: true, items: parsed.items }) });
      setNotice(`${result.saved} آگهی تازه، ${result.duplicate} تکراری و ${result.phones} شماره از فایل محلی پردازش شد.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'انتقال فایل ممکن نشد.'); }
    finally { setBusy(false); }
  };

  const totalPhones = ads.filter(ad => ad.phone).length;
  const openLocalAd=async(ad:Ad)=>{try{await request(`/api/captured-ads/${ad.id}/enrich`,{method:'POST',body:'{}'});setNotice('آگهی در مرورگر اصلی باز شد؛ اطلاعات تماس را آنجا نمایش بده.');}catch(error){setError(error instanceof Error?error.message:'بازکردن ممکن نشد.');}};
  const captureLocalContact=async(ad:Ad,basis:string)=>{await request(`/api/captured-ads/${ad.id}/reveal-contact`,{method:'POST',body:JSON.stringify({basis,confirmed:true})});setNotice('تماس همین آگهی باز و شمارهٔ نمایان ثبت شد.');await refresh();};
  const selectedRun=runs.find(run=>run.id===runId);
  return <div className="cloud-view">
    <div className="page-head"><div><p>افزونهٔ مرورگر + ذخیره‌سازی ابری</p><h1>آگهی‌های مرورگر</h1><span>جست‌وجو، بازکردن آگهی‌ها و استخراج جزئیات در مرورگر شخصی؛ خروجی جدا برای هر جست‌وجو.</span></div><div className="page-actions"><button className="ghost-button" onClick={() => void refresh()}><RefreshCw size={16} /> تازه‌سازی</button><a className="primary-button" href={`${exportPath}.xlsx?${query}`}><Download size={17} /> اکسل XLSX</a><a className="ghost-button" href={`${exportPath}.csv?${query}`}>CSV</a></div></div>
    {error && <div className="cloud-message cloud-error" role="alert">{error}</div>}{notice && <div className="cloud-message" role="status">{notice}</div>}
    <section className="capture-welcome panel"><div><span className="capture-connection"><i className={tokenStatus?.active?'connected':''} />{tokenStatus?.active?'کلید اتصال فعال':'افزونه را متصل کن'}</span><h2>از جست‌وجو تا فایل اکسل</h2><p>۱. ورود در افزونه · ۲. انتخاب موضوع و شهر · ۳. دریافت خروجی همین جست‌وجو</p></div><a className="primary-button" href="/lead-radar-extension.zip" download><Download size={17} /> دانلود افزونهٔ نسخهٔ ۲</a></section>
    <details hidden={localMode} className="panel capture-disclosure" open={Boolean(freshToken)||tokenStatus?.active===false}><summary><KeyRound size={19} /> راه‌اندازی و مدیریت اتصال افزونه</summary><div className="cloud-setup"><div><p>۱. <a href="/lead-radar-extension.zip" download>فایل افزونه را دانلود کن</a> و از حالت فشرده خارج کن. ۲. در Chrome/Edge صفحهٔ افزونه‌ها را باز کن، Developer mode را فعال کن و پوشه را با Load unpacked انتخاب کن. ۳. در تنظیمات افزونه «لوکال» یا «Vercel» را مطابق همین پنل انتخاب و کلید زیر را وارد کن.</p><p>۴. آیکون افزونه را باز کن، شمارهٔ خودت را بده و ورود را بزن؛ فقط کد پیامکی را در سایت اصلی وارد کن. سپس موضوع و شهر یا لینک فیلترشده را بده و استخراج را شروع کن. مرورگر باید باز بماند. کد و نشست سایت به پنل ابری ارسال نمی‌شوند.</p></div><div className="cloud-key-actions"><div className="cloud-token-state">{tokenStatus?.active ? `کلید فعال تا ${new Date(tokenStatus.expiresAt!).toLocaleDateString('fa-IR')}` : 'هنوز کلید فعالی وجود ندارد.'}</div><button className="primary-button" disabled={busy} onClick={() => void createToken()}><KeyRound size={16} /> {tokenStatus?.active ? 'ساخت کلید جدید' : 'ساخت کلید اتصال'}</button>{tokenStatus?.active && <button className="ghost-button" disabled={busy} onClick={() => void revokeToken()}><Trash2 size={16} /> لغو کلید</button>}</div>{freshToken && <div className="cloud-fresh-token"><code dir="ltr">{freshToken}</code><button className="ghost-button" onClick={() => void navigator.clipboard.writeText(freshToken)}><Copy size={16} /> کپی</button></div>}</div></details>
    <details hidden={localMode} className="panel capture-disclosure"><summary>انتقال داده‌های همراه محلی</summary><div className="cloud-import"><div><p>اگر قبلاً در نسخهٔ محلی آگهی ذخیره کرده‌ای، همراه محلی را اجرا کن، <a href="http://127.0.0.1:4311/api/export.json" target="_blank" rel="noreferrer">خروجی JSON محلی</a> را بگیر و اینجا انتخاب کن. داده‌ها فقط پس از تأیید صریح تو به ابر منتقل می‌شوند.</p></div><label>انتخاب فایل JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importLocal(file); }} /></label></div></details>
    <div className="cloud-stats"><span>آگهی‌های این فیلتر: <b>{ads.length.toLocaleString('fa-IR')}</b></span><span>شمارهٔ ثبت‌شده: <b>{totalPhones.toLocaleString('fa-IR')}</b></span><span><ShieldCheck size={15} /> شماره فقط پس از نمایان‌شدن و تأیید دستی ثبت می‌شود.</span></div>
<section className="panel capture-results-toolbar"><div className="capture-results-heading"><h2>نتایج و تاریخچهٔ جست‌وجو</h2><div className="history-actions"><a className="primary-button" href={`${exportPath}.xlsx?${query}`}><Download size={16}/> دریافت اکسل</a><a className="ghost-button" href={`${exportPath}.csv?${query}`}>CSV</a></div><span>{runs.length.toLocaleString('fa-IR')} اجرا در تاریخچه</span></div><label>خروجی جست‌وجو <select aria-label="اجرای جست‌وجو" value={followLatest?'latest':runId} onChange={event=>{setFollowLatest(event.target.value==='latest');if(event.target.value!=='latest')setRunId(event.target.value);}}><option value="latest">آخرین جست‌وجو — به‌روزرسانی خودکار</option><option value="">همهٔ بانک آگهی‌ها</option>{runs.map(run=><option key={run.id} value={run.id}>{run.topic||'جست‌وجو'} · {run.city} · {new Date(run.created_at).toLocaleString('fa-IR')} · {run.processed}/{run.total}</option>)}</select></label>{selectedRun&&<div className="capture-run-progress" role="status"><div><strong>{runStatus[selectedRun.status]||selectedRun.status}</strong><span>{selectedRun.processed.toLocaleString('fa-IR')} / {selectedRun.total.toLocaleString('fa-IR')} آگهی · {selectedRun.message}</span><a href={selectedRun.search_url} target="_blank" rel="noreferrer">صفحهٔ جست‌وجو <ExternalLink size={13}/></a></div><progress aria-label="پیشرفت استخراج" max={selectedRun.total} value={selectedRun.processed+selectedRun.failed}/></div>}<details className="history-disclosure"><summary>مدیریت و پاک‌سازی تاریخچه</summary><HistoryControls path={localMode?"/api/companion/capture-runs":"/api/capture-runs"} selectedId={selectedRun?.id} selectedStatus={selectedRun?.status} refreshKey={runs.map(run=>`${run.id}:${run.status}`).join(',')} onChanged={refresh} /></details></section>
    <div className="cloud-filters"><input aria-label="جست‌وجو" placeholder="عنوان، موضوع، شهر یا شماره…" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="منبع" value={source} onChange={event => setSource(event.target.value)}><option value="">همهٔ منابع</option><option value="divar">دیوار</option><option value="sheypoor">شیپور</option></select><select aria-label="وضعیت" value={status} onChange={event => setStatus(event.target.value)}><option value="">همهٔ وضعیت‌ها</option><option value="new">جدید</option><option value="reviewing">در بررسی</option><option value="contacted">تماس‌گرفته</option><option value="done">پایان‌یافته</option></select></div>
    <label className="phone-only-control"><input type="checkbox" checked={phoneOnly} onChange={event=>setPhoneOnly(event.target.checked)}/> فقط آگهی‌های دارای شمارهٔ ثبت‌شده</label>
    <p className="muted">{phoneOnly?'اکسل و CSV فقط شماره‌های ثبت‌شدهٔ همین فیلتر را دارند.':'اکسل و CSV شامل تمام آگهی‌های نمایش‌داده‌شده‌اند؛ خانهٔ شمارهٔ ثبت‌نشده خالی می‌ماند.'}</p>
    {!loading&&ads.length===0&&phoneOnly&&<button className="ghost-button" onClick={()=>setPhoneOnly(false)}>نمایش آگهی‌ها برای ثبت تماس و خروجی کامل</button>}
{loading ? <div className="cloud-empty">در حال دریافت…</div> : !ads.length ? <div className="cloud-empty">{phoneOnly?'در این جست‌وجو هنوز شمارهٔ تأییدشده‌ای ثبت نشده؛ آگهی بدون شماره سرنخ تماس محسوب نمی‌شود.':'هنوز آگهی‌ای در این جست‌وجو ثبت نشده است.'}</div> : <div className="cloud-list">{ads.map(ad => <AdCard key={ad.id} ad={ad} onSave={updateAd} onOpen={localMode?openLocalAd:undefined} onContact={localMode?captureLocalContact:undefined} />)}</div>}
  </div>;
}

function AdCard({ ad, onSave, onOpen, onContact }: { ad: Ad; onSave: (ad: Ad, status: Ad['status'], note: string) => Promise<void>;onOpen?:(ad:Ad)=>Promise<void>;onContact?:(ad:Ad,basis:string)=>Promise<void> }) {
  const [status, setStatus] = useState<Ad['status']>(ad.status);
  const [note, setNote] = useState(ad.note);
  const [basis,setBasis]=useState('');const [confirmed,setConfirmed]=useState(false);const [contactBusy,setContactBusy]=useState(false);const [contactError,setContactError]=useState('');
  const contact=async()=>{setContactBusy(true);setContactError('');try{await onContact?.(ad,basis);}catch(error){setContactError(error instanceof Error?error.message:'ثبت شماره ممکن نشد.');}finally{setContactBusy(false);}};
  let attributes:Array<{label:string;value:string}>=[];
  try{const value=JSON.parse((ad as Ad & {attributes?:string}).attributes||'[]');if(Array.isArray(value))attributes=value;}catch{}
  return <article className="cloud-ad panel">
    {onContact&&<details className="contact-card" open><summary>ثبت شمارهٔ این آگهی</summary><button className="ghost-button" disabled={contactBusy} onClick={()=>{setContactBusy(true);void onOpen?.(ad).finally(()=>setContactBusy(false));}}>بازکردن آگهی در مرورگر همراه</button><label>مبنای ارتباط<select value={basis} onChange={event=>setBasis(event.target.value)}><option value="">انتخاب کن</option><option value="direct-consent">رضایت مستقیم</option><option value="public-business">شمارهٔ عمومی کسب‌وکار</option></select></label><label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> مجاز به نمایش و ثبت تماس همین آگهی هستم.</label><button className="primary-button" disabled={contactBusy||!basis||!confirmed} onClick={()=>void contact()}>{contactBusy?'در حال بررسی همین آگهی…':'نمایش و ثبت تماس همین آگهی'}</button><p>فقط با کلیک تو اجرا می‌شود؛ اگر سایت ورود یا کپچا خواست، آن مرحله را در سایت انجام بده و دوباره همین دکمه را بزن.</p>{contactError&&<div className="cloud-message cloud-error" role="alert">{contactError}</div>}</details>}
    <div className="cloud-ad-main">
      <div className="cloud-ad-tags"><span>{ad.source==='divar'?'دیوار':'شیپور'}</span>{ad.city&&<span>{ad.city}</span>}{ad.region&&<span>{ad.region}</span>}{ad.topic&&<span>{ad.topic}</span>}</div>
      <h3>{ad.title}</h3>{ad.description?<details className="ad-description"><summary>توضیحات کامل آگهی</summary><p style={{whiteSpace:'pre-wrap'}}>{ad.description}</p></details>:<p>{ad.price||'جزئیات بیشتر در صفحهٔ آگهی'}</p>}
      {attributes.length>0&&<details><summary>مشخصات آگهی ({attributes.length})</summary><dl>{attributes.map(a=><div key={a.label}><dt>{a.label}</dt><dd>{a.value}</dd></div>)}</dl></details>}
      <div className="cloud-ad-meta">{ad.price&&<span>{ad.price}</span>}<span>{new Date(ad.saved_at).toLocaleDateString('fa-IR')}</span><a href={ad.url} target="_blank" rel="noreferrer">مشاهدهٔ آگهی <ExternalLink size={13}/></a></div>
    </div>
    <div className="cloud-ad-side"><strong dir="ltr">{ad.phone||'شماره ثبت نشده'}</strong><small>{ad.phone?`مبنای ثبت: ${ad.contact_basis==='direct-consent'?'رضایت مستقیم':'شمارهٔ عمومی کسب‌وکار'}`:'شماره‌ای حدس زده نمی‌شود.'}</small><select aria-label={`وضعیت ${ad.title}`} value={status} onChange={event=>setStatus(event.target.value as Ad['status'])}><option value="new">جدید</option><option value="reviewing">در بررسی</option><option value="contacted">تماس‌گرفته</option><option value="done">پایان‌یافته</option></select><textarea aria-label={`یادداشت ${ad.title}`} rows={2} placeholder="یادداشت پیگیری" value={note} onChange={event=>setNote(event.target.value)}/><button className="ghost-button" onClick={()=>void onSave(ad,status,note)}>ذخیرهٔ وضعیت</button></div>
  </article>;
}

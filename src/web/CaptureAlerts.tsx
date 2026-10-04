import { useEffect, useRef, useState } from 'react';
import { Bell, TriangleAlert, ExternalLink, RefreshCw } from 'lucide-react';
import { captureAlertKey, captureAlertText, pausedCaptureRuns, type PausedCaptureRun } from '../shared/capture-alerts';
import { playAlertTone } from '../shared/alert-tone';

export default function CaptureAlerts({runs,busy,onFocus,onResume}:{runs:PausedCaptureRun[];busy:boolean;onFocus:(run:PausedCaptureRun)=>void;onResume:(run:PausedCaptureRun)=>void}) {
  const paused=pausedCaptureRuns(runs);
  const [permission,setPermission]=useState<NotificationPermission| 'unsupported'>(()=>typeof Notification==='undefined'?'unsupported':Notification.permission);
  const [notice,setNotice]=useState('');
  const [enabled,setEnabled]=useState(()=>{try{return localStorage.getItem('radar-notifications-enabled')==='1';}catch{return false;}});
  const seen=useRef(new Set<string>());
  const audio=useRef<AudioContext|null>(null);
  const [soundEnabled,setSoundEnabled]=useState(false);
  const [acknowledged,setAcknowledged]=useState<Set<string>>(()=>{try{return new Set(JSON.parse(localStorage.getItem('radar-alerts-acknowledged')||'[]'));}catch{return new Set();}});
  const pending=paused.filter(run=>!acknowledged.has(captureAlertKey(run)));
  const pendingSignal=pending.map(captureAlertKey).sort().join('|');
  useEffect(()=>()=>{void audio.current?.close().catch(()=>{});},[]);
  useEffect(()=>{
    if(!soundEnabled||!pendingSignal)return;
    const ring=()=>{try{if(audio.current)playAlertTone(audio.current);}catch{setNotice('مرورگر پخش صدا را متوقف کرده؛ دوباره فعال‌کردن صدا را بزن.');setSoundEnabled(false);}};
    ring();const timer=window.setInterval(ring,30000);
    return()=>window.clearInterval(timer);
  },[soundEnabled,pendingSignal]);
  const activateSound=async()=>{
    if(soundEnabled){setSoundEnabled(false);setNotice('صدای هشدار خاموش شد؛ پیام داخل پنل باقی می‌ماند.');return;}
    try{
      audio.current??=new AudioContext();await audio.current.resume();playAlertTone(audio.current);
      setSoundEnabled(true);setNotice('صدای هشدار فعال شد. برای توقف تازه، تا تأیید تو هر ۳۰ ثانیه تکرار می‌شود.');
    }catch{setSoundEnabled(false);setNotice('فعال‌کردن صدا ممکن نشد؛ تنظیمات صدای این برگه را بررسی کن.');}
  };
  const acknowledge=(run:PausedCaptureRun)=>{
    const next=new Set(acknowledged);next.add(captureAlertKey(run));setAcknowledged(next);
    try{localStorage.setItem('radar-alerts-acknowledged',JSON.stringify([...next].slice(-100)));}catch{}
  };
  useEffect(()=>{try{seen.current=new Set(JSON.parse(localStorage.getItem('radar-alerts-seen')||'[]'));}catch{}},[]);
  useEffect(()=>{
    const original=document.title;
    if(paused.length)document.title=`⚠ ${paused.length} صف منتظر اقدام | رادار لید`;
    return()=>{document.title=original;};
  },[paused.length]);
  useEffect(()=>{
    for(const run of paused) {
      const key=captureAlertKey(run);
      if(!enabled||permission!=='granted'||seen.current.has(key))continue;
      try{
        const notification=new Notification('رادار لید · صف متوقف شد',{body:captureAlertText(run),tag:`radar-${run.id}`});
        notification.onclick=()=>{window.focus();onFocus(run);notification.close();};
        seen.current.add(key);
      }catch{setNotice('اعلان سیستم در این مرورگر در دسترس نیست؛ هشدار داخل پنل فعال است.');}
    }
    try{localStorage.setItem('radar-alerts-seen',JSON.stringify([...seen.current].slice(-100)));}catch{}
  },[runs,permission,enabled]);
  const enable=async()=>{
    if(enabled){setEnabled(false);try{localStorage.setItem('radar-notifications-enabled','0');}catch{}setNotice('اعلان سیستم خاموش شد؛ هشدار پنل فعال است.');return;}
    try{const value=await Notification.requestPermission();setPermission(value);setEnabled(value==='granted');try{localStorage.setItem('radar-notifications-enabled',value==='granted'?'1':'0');}catch{}setNotice(value==='granted'?'اعلان فعال شد؛ برای دریافت آن پنل را باز نگه دار.':'اعلان اجازه نگرفت؛ هشدار داخل پنل همچنان فعال است.');}
    catch{setNotice('مرورگر اجازهٔ اعلان نداد؛ هشدار داخل پنل فعال است.');}
  };
  return <section className="capture-alerts" aria-label="هشدار و حفظ صف">
    <div className="capture-alert-settings"><span><Bell size={16}/> هشدار توقف صف</span><button className="ghost-button" disabled={permission==='unsupported'} onClick={()=>void enable()}>{enabled&&permission==='granted'?'خاموش‌کردن اعلان سیستم':permission==='unsupported'?'اعلان سیستم در دسترس نیست':permission==='denied'?'اجازهٔ اعلان در تنظیمات مرورگر':'فعال‌کردن اعلان سیستم'}</button></div>
    <div className="capture-alert-actions"><button className="ghost-button" aria-pressed={soundEnabled} onClick={()=>void activateSound()}>{soundEnabled?'خاموش‌کردن صدای هشدار':'فعال‌کردن صدای هشدار'}</button><button className="ghost-button" disabled={!soundEnabled} onClick={()=>{try{if(audio.current)playAlertTone(audio.current);setNotice('صدای آزمایشی پخش شد؛ اگر نمی‌شنوی، صدای برگه و سیستم را بررسی کن.');}catch{setSoundEnabled(false);setNotice('پخش صدا ممکن نشد؛ دوباره آن را فعال کن.');}}}>تست صدا</button></div>
    <small>صدا نیاز به یک‌بار فعال‌سازی با کلیک دارد و مستقل از اجازهٔ اعلان است. برای هشدار، همین صفحهٔ رادار را باز و سیستم را بیدار نگه دار؛ مرورگرِ بسته یا سیستمِ خواب هشدار نمی‌دهد.</small>
    {enabled&&permission==='granted'&&<button className="ghost-button" onClick={()=>{try{const test=new Notification('رادار لید · تست اعلان',{body:'اعلان فعال است؛ پنل را باز و سیستم را بیدار نگه دار.',tag:'radar-notification-test'});test.onclick=()=>test.close();setNotice('اعلان آزمایشی ارسال شد؛ اگر دیده نمی‌شود تنظیمات اعلان سیستم را بررسی کن.');}catch{setNotice('ارسال اعلان آزمایشی ممکن نشد؛ هشدار داخل پنل فعال است.');}}}>تست اعلان</button>}
    {notice&&<p role="status">{notice}</p>}
    {paused.map(run=><article className="capture-pause-alert" role="alert" key={run.id}><TriangleAlert size={20}/><div><strong>{run.source==='divar'?'دیوار':'شیپور'} · نیازمند اقدام دستی</strong><p>{captureAlertText(run)}</p><small>{run.message}</small><div className="capture-alert-actions"><button className="ghost-button" disabled={acknowledged.has(captureAlertKey(run))} onClick={()=>acknowledge(run)}>{acknowledged.has(captureAlertKey(run))?'هشدار دیده شد':'هشدار را دیدم؛ قطع صدا'}</button><button className="ghost-button" disabled={busy||run.resumable===false} onClick={()=>onFocus(run)}><ExternalLink size={15}/> بازکردن محل توقف</button><button className="primary-button" disabled={busy||run.resumable===false} onClick={()=>onResume(run)}><RefreshCw size={15}/> حل کردم؛ ادامهٔ صف</button></div>{run.resumable===false&&<small>این اجرای قدیمی صف ذخیره‌شده ندارد؛ متوقفش کن و جست‌وجوی تازه بساز.</small>}</div></article>)}
  </section>;
}

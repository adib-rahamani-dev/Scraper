export async function browserCommand<T=unknown>(action:string,payload:Record<string,unknown>={}):Promise<T>{
  if(['login-status','reveal-contact'].includes(action)){
    const installed=await browserCommand<{capabilities?:string[];version?:string}>('status');
    if(!installed.capabilities?.includes(action))throw new Error(`افزونهٔ نصب‌شده ${installed.version||'قدیمی'} این فرمان را ندارد؛ بستهٔ ۲.۹.۰ یا جدیدتر را نصب و Reload کن، سپس برگه‌های سایت و پنل را تازه کن.`);
  }
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const timeout=action==='status'?1800:action==='reveal-contact'?60000:action==='login-status'?45000:30000;
    const timer=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('آخرین افزونه را نصب یا Reload کن و این صفحه را تازه کن.'));},timeout);
    function receive(event:MessageEvent){if(event.source!==window||event.origin!==location.origin||event.data?.type!=='lead-radar-response'||event.data.id!==id)return;window.clearTimeout(timer);window.removeEventListener('message',receive);if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.result as T);}
    window.addEventListener('message',receive);window.postMessage({type:'lead-radar-command',id,action,payload},location.origin);
  });
}

export function browserCommand<T=unknown>(action:string,payload:Record<string,unknown>={}):Promise<T>{
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const timer=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('افزونهٔ نسخهٔ ۲.۶ را نصب یا Reload کن و این صفحه را تازه کن.'));},action==='status'?1800:30000);
    function receive(event:MessageEvent){if(event.source!==window||event.origin!==location.origin||event.data?.type!=='lead-radar-response'||event.data.id!==id)return;window.clearTimeout(timer);window.removeEventListener('message',receive);if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.result as T);}
    window.addEventListener('message',receive);window.postMessage({type:'lead-radar-command',id,action,payload},location.origin);
  });
}

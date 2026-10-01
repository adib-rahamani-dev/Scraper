import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';
function worker(initial:Record<string,unknown>={}){
  const local:Record<string,any>={leadRadarToken:'test-key',...initial};const session:Record<string,any>={};const listeners:Record<string,Function>={};const requests:Array<{path:string;body:any}>=[];const alarms:Record<string,unknown>={};
  const store=(items:Record<string,any>)=>({get:async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(items[k])])),set:async(value:any)=>Object.assign(items,structuredClone(value)),remove:async(key:string)=>{delete items[key];}});
  const chrome={runtime:{id:'test',getURL:(p:string)=>`chrome-extension://test/${p}`,openOptionsPage:async()=>{},onMessage:{addListener:(fn:Function)=>listeners.message=fn},onStartup:{addListener:(fn:Function)=>listeners.startup=fn}},storage:{local:store(local),session:store(session)},tabs:{create:vi.fn(async()=>({id:12})),update:vi.fn(async()=>({id:12})),sendMessage:vi.fn(async()=>({ad:{source:'divar',url:'https://divar.ir/v/item/1',title:'موبایل',description:'جزئیات'}})),onRemoved:{addListener:(fn:Function)=>listeners.removed=fn}},alarms:{create:async(name:string,value:any)=>{alarms[name]=value;},clear:async(name:string)=>{delete alarms[name];},onAlarm:{addListener:(fn:Function)=>listeners.alarm=fn}}};
  const fetch=async(url:string,options:any)=>{requests.push({path:new URL(url).pathname,body:options.body?JSON.parse(options.body):null});return {ok:true,json:async()=>url.endsWith('/runs')?{id:'run-1',source:'divar',status:'running',processed:0,failed:0,total:1,topic:'موبایل'}:{saved:1}};};
  runInNewContext(readFileSync('extension/background.js','utf8'),{chrome,URL,AbortSignal,fetch,Date,Set,Promise,Error});
  const send=(message:any,sender:any={id:'test',url:'chrome-extension://test/popup.html'})=>new Promise<any>(resolve=>listeners.message!(message,sender,resolve));
  const settle=async()=>{await new Promise(r=>setTimeout(r,25));};
  return {local,session,requests,chrome,send,listeners,settle,alarms};
}
it('rejects a foreign sender and keeps login phones out of persistent storage and backend',async()=>{
  const w=worker();expect((await w.send({action:'login',phone:'09123456789',source:'divar'},{url:'https://evil.example',id:'test'})).error).toBeTruthy();
  await w.send({action:'login',phone:'09123456789',source:'divar'});expect(JSON.stringify(w.local)).not.toContain('09123456789');expect(w.requests).toHaveLength(0);expect(w.session['login-12'].phone).toBe('09123456789');
  w.chrome.tabs.sendMessage.mockResolvedValueOnce({state:'awaiting-code',message:'کد را در سایت وارد کن'} as any);
  await w.send({action:'ready'},{id:'test',url:'https://divar.ir/s/iran',tab:{id:12}});expect(w.session['login-12']).toBeUndefined();expect(w.local['loginState-divar'].state).toBe('awaiting-code');expect(w.requests).toHaveLength(0);
});
it('persists the queue and can collect a matching detail after the worker is recreated',async()=>{
  const w=worker();const result=await w.send({action:'start-run',limit:2,search:{source:'divar',context:{topic:'موبایل',searchUrl:'https://divar.ir/s/qazvin?q=mobile'},items:[{url:'https://divar.ir/v/item/1'},{url:'https://divar.ir/v/item/1'}]}},{id:'test',url:'https://divar.ir/s/qazvin?q=mobile',tab:{id:5}});
  expect(result.result.urls).toHaveLength(1);w.listeners.alarm!({name:'capture-step'});await w.settle();expect(w.local.captureJob.stage).toBe('loading');
  const restored=worker(w.local);await restored.send({action:'ready'},{id:'test',url:'https://divar.ir/v/item/1',tab:{id:12}});
  expect(restored.local.captureJob.processed).toBe(1);expect(restored.requests.find(r=>r.path.endsWith('/capture'))?.body.runId).toBe('run-1');
  restored.listeners.alarm!({name:'capture-step'});await restored.settle();expect(restored.local.captureJob.status).toBe('completed');
});

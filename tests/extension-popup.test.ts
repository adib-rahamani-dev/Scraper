import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';

async function popup(state:Record<string,unknown>) {
  const ids=['installed-version','connection','progress','run-progress','resume','stop','login-state','status','options','dashboard','login','search'];
  const elements=Object.fromEntries(ids.map(id=>[id,{textContent:'',hidden:false,max:0,value:0,onclick:null,onsubmit:null}]));
  const chrome={runtime:{getManifest:()=>({version:'2.8.0'}),sendMessage:vi.fn()},storage:{local:{get:async()=>state},onChanged:{addListener:vi.fn()}}};
  runInNewContext(readFileSync('extension/popup.js','utf8'),{document:{getElementById:(id:string)=>elements[id]},chrome});
  await Promise.resolve();await Promise.resolve();
  return elements;
}
it('shows the actual installed version and a clear disconnected state without inventing a queue',async()=>{
  const ui=await popup({});expect(ui['installed-version']!.textContent).toBe('v2.8.0');expect(ui.connection!.textContent).toContain('اتصال تنظیم نشده');expect(ui['run-progress']!.hidden).toBe(true);expect(ui.resume!.hidden).toBe(true);expect(ui.stop!.hidden).toBe(true);
});
it('shows paused queue progress and exposes resume only for a paused job',async()=>{
  const ui=await popup({leadRadarToken:'fixture',leadRadarEndpoint:'http://127.0.0.1:4300',captureJob:{source:'divar',topic:'کیف',processed:4,total:12,status:'paused',message:'نیازمند حل دستی'}});
  expect(ui.connection!.textContent).toContain('پنل محلی');expect(ui.progress!.textContent).toContain('دیوار');expect(ui['run-progress']).toMatchObject({hidden:false,max:12,value:4});expect(ui.resume!.hidden).toBe(false);expect(ui.stop!.hidden).toBe(false);
});
it('does not expose a resume action for an active queue',async()=>{
  const ui=await popup({captureJob:{source:'sheypoor',topic:'کیف',processed:0,total:0,status:'running',message:'در حال اجرا'}});expect(ui['run-progress']!.max).toBe(1);expect(ui.resume!.hidden).toBe(true);expect(ui.stop!.hidden).toBe(false);
});

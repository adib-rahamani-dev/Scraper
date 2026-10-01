import { setTimeout as pause } from 'node:timers/promises';
import { openBrowser, selectedPage } from './browser.js';
import { captureCurrentDetail, readCurrentSearch } from './capture.js';
import { db } from './store.js';
import { createCaptureRun, getCaptureRun, linkCaptureRun, updateCaptureRun } from '../shared/capture-data.js';
import type { BrowserSource } from './policy.js';

const active=new Map<string,boolean>();
let starting=false;
export async function startDetailJob(source:BrowserSource,tabIndex:number,limit=20) {
  if(starting||[...active.values()].some(Boolean))throw new Error('یک استخراج در حال اجراست؛ ابتدا آن را متوقف کن یا منتظر پایانش بمان.');
  starting=true;
  try {
  const search=await readCurrentSearch(source,selectedPage(source,tabIndex));
  const items=search.items.slice(0,Math.max(1,Math.min(40,limit)));
  const run=createCaptureRun(db,'saved_ads',source,{...search.context,total:items.length});
  active.set(run.id,true);
  void collect(run.id,source,items,search.context).catch(error=>{
    const current=getCaptureRun(db,'saved_ads',run.id)!;updateCaptureRun(db,'saved_ads',run.id,{status:'failed',processed:current.processed,failed:current.failed,message:error instanceof Error?error.message:'خطای استخراج'});active.delete(run.id);
  });
  return run;
  }finally{starting=false;}
}
async function collect(id:string,source:BrowserSource,items:Array<{url:string}>,context:{topic:string;city:string;region:string}) {
  const browser=await openBrowser(source);const page=await browser.newPage();await page.bringToFront();
  let processed=0;let failed=0;
  for(const item of items) {
    if(!active.get(id))break;
    try {
      await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30_000});
      const capture=await captureCurrentDetail(source,page,context);
      if(!active.get(id))break;
      linkCaptureRun(db,'saved_ads',id,capture.ad);processed++;
    }catch(error){failed++;const message=error instanceof Error?error.message:'آگهی خوانده نشد';
      if(/امنیتی|محدودیت|دسترسی/.test(message)){updateCaptureRun(db,'saved_ads',id,{status:'paused',processed,failed,message});active.delete(id);return;}
    }
    updateCaptureRun(db,'saved_ads',id,{processed,failed,message:`${processed} آگهی کامل، ${failed} ناموفق`});
    if(active.get(id))await pause(5000);
  }
  const status=active.get(id)?(failed?'partial':'completed'):'cancelled';active.delete(id);
  updateCaptureRun(db,'saved_ads',id,{status,processed,failed,message:status==='cancelled'?'استخراج متوقف شد':`استخراج تمام شد؛ ${processed} آگهی کامل، ${failed} ناموفق`});
}
export function cancelDetailJob(id:string){if(!active.has(id))return false;active.set(id,false);return true;}

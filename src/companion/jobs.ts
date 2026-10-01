import { setTimeout as pause } from 'node:timers/promises';
import { openBrowser, selectedPage } from './browser.js';
import { captureCurrentDetail, readCurrentSearch } from './capture.js';
import { db } from './store.js';
import { createCaptureRun, getCaptureRun, linkCaptureRun, updateCaptureRun } from '../shared/capture-data.js';
import type { BrowserSource } from './policy.js';
import {MAX_BROWSER_ADS,waitForBrowserSlot} from '../shared/browser-rate-limit.js';

type Job={id:string;source:BrowserSource;items:Array<{url:string}>;context:{topic:string;city:string;region:string};index:number;processed:number;failed:number;running:boolean;cancelled:boolean};
const jobs=new Map<string,Job>();
const starting=new Set<BrowserSource>();
export function assertSourceAvailable(source:BrowserSource){
  if(starting.has(source)||[...jobs.values()].some(job=>job.source===source))throw new Error('این سایت اجرای فعال یا منتظر حل کپچا دارد؛ ابتدا ادامه بده یا متوقف کن.');
}
export async function runSingleContact<T>(source:BrowserSource,action:()=>Promise<T>){assertSourceAvailable(source);starting.add(source);try{return await action();}finally{starting.delete(source);}}
export async function startDetailJob(source:BrowserSource,tabIndex:number,limit=20) {
  assertSourceAvailable(source);starting.add(source);
  try {
  const search=await readCurrentSearch(source,selectedPage(source,tabIndex));
  const items=search.items.slice(0,Math.max(1,Math.min(MAX_BROWSER_ADS,Number(limit)||MAX_BROWSER_ADS)));
  const run=createCaptureRun(db,'saved_ads',source,{...search.context,total:items.length});
  const job:Job={id:run.id,source,items,context:search.context,index:0,processed:0,failed:0,running:true,cancelled:false};
  jobs.set(run.id,job);dispatch(job);
  return run;
  }finally{starting.delete(source);}
}
function dispatch(job:Job){void collect(job).catch(error=>{updateCaptureRun(db,'saved_ads',job.id,{status:job.cancelled?'cancelled':'failed',message:error instanceof Error?error.message:'خطای استخراج'});jobs.delete(job.id);});}
async function collect(job:Job) {
  const {id,source,items,context}=job;
  const browser=await openBrowser(source);const page=await browser.newPage();await page.bringToFront();
  for(;job.index<items.length;job.index++) {
    const item=items[job.index]!;
    if(job.cancelled)break;
    try {
      const permitted=await waitForBrowserSlot(source,
        site=>Number((db.prepare('SELECT next_at FROM browser_rate_limits WHERE source=?').get(site) as {next_at:number}|undefined)?.next_at??0),
        (site,next)=>{db.prepare('INSERT INTO browser_rate_limits(source,next_at) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET next_at=excluded.next_at').run(site,next);},
        ()=>job.cancelled,pause);
      if(!permitted)break;
      await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30_000});
      const capture=await captureCurrentDetail(source,page,context);
      if(job.cancelled)break;
      linkCaptureRun(db,'saved_ads',id,capture.ad);job.processed++;
    }catch(error){const message=error instanceof Error?error.message:'آگهی خوانده نشد';
      if(!job.cancelled&&/کپچا|captcha|امنیتی|محدودیت|دسترسی/i.test(message)){job.running=false;updateCaptureRun(db,'saved_ads',id,{status:'paused',processed:job.processed,failed:job.failed,message:'نیازمند اقدام شما در مرورگر؛ پس از حل دستی ادامه را بزن. '+message});return;}
      if(!job.cancelled)job.failed++;
    }
    if(job.cancelled)break;
    updateCaptureRun(db,'saved_ads',id,{processed:job.processed,failed:job.failed,message:`${job.processed} آگهی بررسی‌شده، ${job.failed} ناموفق؛ خروجی فقط شماره‌های ثبت‌شده`});
  }
  const status=job.cancelled?'cancelled':job.failed?'partial':'completed';jobs.delete(id);
  updateCaptureRun(db,'saved_ads',id,{status,processed:job.processed,failed:job.failed,message:status==='cancelled'?'استخراج متوقف شد':`پایان بررسی: ${job.processed} آگهی، ${job.failed} ناموفق؛ خروجی فقط شماره‌های ثبت‌شده`});
}
export function resumeDetailJob(id:string){const job=jobs.get(id);if(!job||job.cancelled)throw new Error('اجرای قابل‌ادامه در این نشست وجود ندارد؛ پس از راه‌اندازی مجدد همراه جست‌وجوی تازه بساز.');if(job.running||getCaptureRun(db,'saved_ads',id)?.status!=='paused')throw new Error('اجرا منتظر ادامه نیست.');job.running=true;updateCaptureRun(db,'saved_ads',id,{status:'running',message:'ادامه پس از تأیید حل دستی محدودیت'});dispatch(job);return getCaptureRun(db,'saved_ads',id);}
export function cancelDetailJob(id:string){const job=jobs.get(id);if(!job)return false;job.cancelled=true;if(!job.running){jobs.delete(id);updateCaptureRun(db,'saved_ads',id,{status:'cancelled',message:'اجرا متوقف شد'});}return true;}

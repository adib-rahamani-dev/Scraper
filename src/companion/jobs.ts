import { setTimeout as pause } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import { openBrowser, selectedPage } from './browser.js';
import { captureCurrentDetail, readCurrentSearch } from './capture.js';
import { db } from './store.js';
import { createCaptureRun, getCaptureRun, linkCaptureRun, updateCaptureRun } from '../shared/capture-data.js';
import { detailUrl, type BrowserSource } from './policy.js';
import {MAX_BROWSER_ADS,waitForBrowserSlot} from '../shared/browser-rate-limit.js';
import { clearJobCheckpoint, initializeJobCheckpoints, readJobCheckpoints, saveJobCheckpoint, type JobCheckpoint } from './job-checkpoint.js';

type Job=JobCheckpoint & {running:boolean;cancelled:boolean;page?:Page};
const jobs=new Map<string,Job>();
const starting=new Set<BrowserSource>();
export function restoreDetailJobs() {
  initializeJobCheckpoints(db);
  for(const stored of readJobCheckpoints(db)) {
    if(jobs.has(stored.id))continue;
    const job:Job={...stored,running:false,cancelled:false,pausedAt:stored.pausedAt||new Date().toISOString(),pauseReason:stored.pauseReason||'restart'};
    jobs.set(job.id,job);
    updateCaptureRun(db,'saved_ads',job.id,{status:'paused',message:`صف از محل توقف بازیابی شد (${job.index}/${job.items.length})؛ سایت را بررسی کن و ادامه پس از حل دستی را بزن.`});
    saveJobCheckpoint(db,job);
  }
}
export function detailJobProgress(id:string) {
  const job=jobs.get(id);
  return job?{index:job.index,currentUrl:job.items[job.index]?.url||'',pausedAt:job.pausedAt||'',pauseReason:job.pauseReason||'',resumable:!job.running&&!job.cancelled}:{resumable:false};
}
export async function focusDetailJob(id:string) {
  const job=jobs.get(id);
  if(!job||job.running||job.cancelled)throw new Error('صف متوقف‌شده پیدا نشد.');
  const url=job.items[job.index]?.url;if(!url)throw new Error('صف آگهی باقیمانده ندارد.');
  const browser=await openBrowser(job.source);
  const page=job.page&&!job.page.isClosed()?job.page:browser.pages().find(page=>detailUrl(job.source,page.url())===url)??await browser.newPage();
  job.page=page;await page.bringToFront();
  if(detailUrl(job.source,page.url())!==url)await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  return {url:page.url()};
}
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
  saveJobCheckpoint(db,job);jobs.set(run.id,job);dispatch(job);
  return run;
  }finally{starting.delete(source);}
}
function dispatch(job:Job){void collect(job).catch(error=>{updateCaptureRun(db,'saved_ads',job.id,{status:job.cancelled?'cancelled':'failed',message:error instanceof Error?error.message:'خطای استخراج'});clearJobCheckpoint(db,job.id);jobs.delete(job.id);});}
async function collect(job:Job) {
  const {id,source,items,context}=job;
  const browser=await openBrowser(source);const page=job.page&&!job.page.isClosed()?job.page:await browser.newPage();job.page=page;await page.bringToFront();
  while(job.index<items.length) {
    const item=items[job.index]!;
    if(job.cancelled)break;
    try {
      const permitted=await waitForBrowserSlot(source,
        site=>Number((db.prepare('SELECT next_at FROM browser_rate_limits WHERE source=?').get(site) as {next_at:number}|undefined)?.next_at??0),
        (site,next)=>{db.prepare('INSERT INTO browser_rate_limits(source,next_at) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET next_at=excluded.next_at').run(site,next);},
        ()=>job.cancelled,pause);
      if(!permitted)break;
      // Keep the manually solved tab intact instead of refreshing its challenge on resume.
      if(detailUrl(source,page.url())!==item.url)await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30_000});
      const capture=await captureCurrentDetail(source,page,context);
      if(job.cancelled)break;
      linkCaptureRun(db,'saved_ads',id,capture.ad);job.processed++;
    }catch(error){const message=error instanceof Error?error.message:'آگهی خوانده نشد';
      if(!job.cancelled&&/کپچا|captcha|امنیتی|محدودیت|دسترسی/i.test(message)){job.running=false;job.pausedAt=new Date().toISOString();job.pauseReason='challenge';updateCaptureRun(db,'saved_ads',id,{status:'paused',processed:job.processed,failed:job.failed,message:`نیازمند حل دستی؛ صف روی آگهی ${job.index+1} از ${items.length} حفظ شد. `+message});saveJobCheckpoint(db,job);return;}
      if(!job.cancelled)job.failed++;
    }
    if(job.cancelled)break;
    job.index++;
    db.exec('BEGIN IMMEDIATE');
    try{updateCaptureRun(db,'saved_ads',id,{processed:job.processed,failed:job.failed,message:`${job.processed} آگهی بررسی‌شده، ${job.failed} ناموفق؛ خروجی فقط شماره‌های ثبت‌شده`});saveJobCheckpoint(db,job);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  const status=job.cancelled?'cancelled':job.failed?'partial':'completed';jobs.delete(id);
  updateCaptureRun(db,'saved_ads',id,{status,processed:job.processed,failed:job.failed,message:status==='cancelled'?'استخراج متوقف شد':`پایان بررسی: ${job.processed} آگهی، ${job.failed} ناموفق؛ خروجی فقط شماره‌های ثبت‌شده`});clearJobCheckpoint(db,id);
}
export function resumeDetailJob(id:string){const job=jobs.get(id);if(!job||job.cancelled)throw new Error('صف قابل‌ادامه در این نشست موجود نیست؛ برای اجراهای نسخهٔ قبلی جست‌وجوی تازه بساز.');if(job.running||getCaptureRun(db,'saved_ads',id)?.status!=='paused')throw new Error('اجرا منتظر ادامه نیست.');job.running=true;job.pausedAt='';job.pauseReason='';updateCaptureRun(db,'saved_ads',id,{status:'running',message:'ادامه از محل توقف پس از تأیید حل دستی'});saveJobCheckpoint(db,job);dispatch(job);return getCaptureRun(db,'saved_ads',id);}
export function cancelDetailJob(id:string){const job=jobs.get(id);if(!job)return false;job.cancelled=true;if(!job.running){jobs.delete(id);updateCaptureRun(db,'saved_ads',id,{status:'cancelled',message:'اجرا متوقف شد'});clearJobCheckpoint(db,id);}return true;}

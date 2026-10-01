import type { DatabaseSync } from 'node:sqlite';
import { detailUrl, type BrowserSource } from './policy.js';

export type JobCheckpoint = {
  id:string; source:BrowserSource; items:Array<{url:string}>;
  context:{topic:string;city:string;region:string}; index:number; processed:number; failed:number;
  pausedAt?:string; pauseReason?:string;
};
export function initializeJobCheckpoints(db:DatabaseSync) {
  const columns=db.prepare('PRAGMA table_info(saved_ads_runs)').all() as Array<{name:string}>;
  if(!columns.some(column=>column.name==='queue_state'))db.exec("ALTER TABLE saved_ads_runs ADD COLUMN queue_state TEXT NOT NULL DEFAULT ''");
}
export function saveJobCheckpoint(db:DatabaseSync,job:JobCheckpoint) {
  // Only URLs and progress: no browser cookies, login phone or OTP.
  const {id,source,items,context,index,processed,failed,pausedAt,pauseReason}=job;
  db.prepare('UPDATE saved_ads_runs SET queue_state=? WHERE id=?').run(JSON.stringify({id,source,items,context,index,processed,failed,pausedAt,pauseReason}),id);
}
export function readJobCheckpoints(db:DatabaseSync):JobCheckpoint[] {
  const rows=db.prepare("SELECT id,source,processed,failed,total,queue_state FROM saved_ads_runs WHERE status IN ('running','paused') AND queue_state != ''").all() as Array<{id:string;source:string;processed:number;failed:number;total:number;queue_state:string}>;
  return rows.flatMap(row=>{
    try {
      const job=JSON.parse(row.queue_state) as JobCheckpoint;
      if(job.id!==row.id||job.source!==row.source||!['divar','sheypoor'].includes(job.source)||!Array.isArray(job.items)||!job.items.length||job.items.length>20||job.items.length!==row.total||job.items.some(item=>!item||!detailUrl(job.source,item.url))||!Number.isSafeInteger(job.index)||job.index<0||job.index>job.items.length||job.processed!==row.processed||job.failed!==row.failed||job.index!==job.processed+job.failed||!job.context||['topic','city','region'].some(key=>typeof job.context[key as keyof typeof job.context]!=='string'))return [];
      return [job];
    }catch{return [];}
  });
}
export function clearJobCheckpoint(db:DatabaseSync,id:string) {
  db.prepare("UPDATE saved_ads_runs SET queue_state='' WHERE id=?").run(id);
}

export type PausedCaptureRun = {id:string;source:string;status:string;message:string;processed?:number;total?:number;index?:number;pausedAt?:string;updated_at?:string;resumable?:boolean};
export function pausedCaptureRuns(runs:PausedCaptureRun[]) {return runs.filter(run=>run.status==='paused');}
export function captureAlertKey(run:PausedCaptureRun) {return `${run.id}:${run.pausedAt||run.updated_at||`${run.index??run.processed??0}:${run.message}`}`;}
export function captureAlertText(run:PausedCaptureRun) {
  const site=run.source==='divar'?'دیوار':'شیپور';
  const cursor=run.index??run.processed??0;
  return `${site} منتظر اقدام توست؛ ${cursor} از ${run.total??'؟'} آگهی بررسی شده. صف حفظ شده؛ سایت را بررسی و پس از حل دستی، ادامه را بزن.`;
}

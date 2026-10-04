import { expect,it } from 'vitest';
import { captureAlertKey,captureAlertText,pausedCaptureRuns } from '../src/shared/capture-alerts.js';
const run={id:'r',source:'divar',status:'paused',message:'captcha',index:3,processed:3,total:10,pausedAt:'2026-10-01T12:00:00Z'};
it('alerts only paused queues and keeps subsequent pauses distinguishable',()=>{expect(pausedCaptureRuns([run,{...run,id:'other',status:'running'}])).toEqual([run]);expect(captureAlertKey(run)).toBe(captureAlertKey({...run}));expect(captureAlertKey({...run,pausedAt:'later'})).not.toBe(captureAlertKey(run));});
it('notification text includes source and cursor but never arbitrary page text',()=>{expect(captureAlertText({...run,message:'sensitive page text'})).toContain('دیوار');expect(captureAlertText(run)).toContain('3 از 10');expect(captureAlertText(run)).toContain('صف حفظ شده');expect(captureAlertText(run)).not.toContain('captcha');expect(captureAlertText({...run,source:'sheypoor'})).toContain('شیپور');});
it('distinguishes repeated local pauses using their persisted timestamps',()=>{
  const local={...run,pausedAt:undefined,updated_at:'2026-10-05T12:00:00Z'};
  expect(captureAlertKey(local)).toBe(captureAlertKey({...local}));
  expect(captureAlertKey(local)).not.toBe(captureAlertKey({...local,updated_at:'2026-10-05T12:01:00Z'}));
});

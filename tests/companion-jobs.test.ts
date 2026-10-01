import { beforeEach,describe,expect,it,vi } from 'vitest';

const fixture=vi.hoisted(()=>{
  const runs=new Map<string,Record<string,unknown>>();
  return {runs,checkpoints:new Map<string,any>(),pages:[] as any[],goto:vi.fn(async(_url:string,_options?:unknown)=>{}),bringToFront:vi.fn(async()=>{}),capture:vi.fn(),search:vi.fn(),link:vi.fn()};
});
vi.mock('../src/companion/store.js',()=>({db:{exec:vi.fn()}}));
vi.mock('../src/companion/job-checkpoint.js',()=>({initializeJobCheckpoints:vi.fn(),saveJobCheckpoint:(_db:unknown,job:any)=>{const {page:_,...state}=job;fixture.checkpoints.set(job.id,structuredClone(state));},clearJobCheckpoint:(_db:unknown,id:string)=>fixture.checkpoints.delete(id),readJobCheckpoints:()=>[...fixture.checkpoints.values()].filter(job=>['running','paused'].includes(String(fixture.runs.get(job.id)?.status)))}));
vi.mock('../src/shared/browser-rate-limit.js',()=>({MAX_BROWSER_ADS:20,waitForBrowserSlot:async()=>true}));
vi.mock('../src/companion/browser.js',()=>({selectedPage:()=>({}),openBrowser:async()=>({pages:()=>fixture.pages,newPage:async()=>{let current='about:blank';const page={goto:async(url:string,options:unknown)=>{await fixture.goto(url,options);current=url;},bringToFront:fixture.bringToFront,url:()=>current,isClosed:()=>false};fixture.pages.push(page);return page;}})}));
vi.mock('../src/companion/capture.js',()=>({captureCurrentDetail:fixture.capture,readCurrentSearch:fixture.search}));
vi.mock('../src/shared/capture-data.js',()=>({
  createCaptureRun:(_db:unknown,_table:unknown,source:string,raw:Record<string,unknown>)=>{const run={id:`${source}-${fixture.runs.size}`,source,status:'running',processed:0,failed:0,...raw};fixture.runs.set(run.id,run);return run;},
  getCaptureRun:(_db:unknown,_table:unknown,id:string)=>fixture.runs.get(id),
  updateCaptureRun:(_db:unknown,_table:unknown,id:string,raw:Record<string,unknown>)=>{Object.assign(fixture.runs.get(id)!,raw);return fixture.runs.get(id);},
  linkCaptureRun:fixture.link,
}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();fixture.runs.clear();fixture.checkpoints.clear();fixture.pages.length=0;fixture.search.mockImplementation(async(source:string)=>({items:[{url:`https://${source==='divar'?'divar.ir':'sheypoor.com'}/v/1`}],context:{topic:'موضوع',city:'قزوین',region:'',searchUrl:`https://${source==='divar'?'divar.ir':'sheypoor.com'}/s/qazvin`}}));fixture.capture.mockReset();});
describe('independent local source queues',()=>{
  it('runs two sources concurrently but never overlaps jobs on one source',async()=>{
    const pending:Array<(value:unknown)=>void>=[];
    fixture.capture.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
    const jobs=await import('../src/companion/jobs.js');
    const divar=await jobs.startDetailJob('divar',0,1);
    const sheypoor=await jobs.startDetailJob('sheypoor',0,1);
    await vi.waitFor(()=>expect(pending).toHaveLength(2));
    await expect(jobs.startDetailJob('divar',0,1)).rejects.toThrow('فعال');
    expect(()=>jobs.assertSourceAvailable('sheypoor')).toThrow();
    pending.forEach(resolve=>resolve({ad:{id:1}}));
    await vi.waitFor(()=>{expect(fixture.runs.get(divar.id)?.status).toBe('completed');expect(fixture.runs.get(sheypoor.id)?.status).toBe('completed');});
  });
  it('pauses on CAPTCHA without losing an item, then retries only after explicit resume',async()=>{
    fixture.capture.mockRejectedValueOnce(new Error('captcha / بررسی امنیتی')).mockResolvedValue({ad:{id:1}});
    const jobs=await import('../src/companion/jobs.js');const run=await jobs.startDetailJob('divar',0,1);
    await vi.waitFor(()=>expect(fixture.runs.get(run.id)).toMatchObject({status:'paused',processed:0,failed:0}));
    expect(fixture.capture).toHaveBeenCalledTimes(1);
    jobs.resumeDetailJob(run.id);
    await vi.waitFor(()=>expect(fixture.runs.get(run.id)).toMatchObject({status:'completed',processed:1,failed:0}));
    expect(fixture.goto.mock.calls.map(call=>call[0])).toEqual(['https://divar.ir/v/1']);
    expect(fixture.link).toHaveBeenCalledTimes(1);
  });
  it('cancels a paused run and releases only its source',async()=>{
    fixture.capture.mockRejectedValue(new Error('محدودیت دسترسی'));
    const jobs=await import('../src/companion/jobs.js');const run=await jobs.startDetailJob('sheypoor',0,1);
    await vi.waitFor(()=>expect(fixture.runs.get(run.id)?.status).toBe('paused'));
    expect(jobs.cancelDetailJob(run.id)).toBe(true);expect(fixture.runs.get(run.id)?.status).toBe('cancelled');
    expect(()=>jobs.assertSourceAvailable('sheypoor')).not.toThrow();
    expect(()=>jobs.resumeDetailJob(run.id)).toThrow('نشست');
  });
  it('recovers a paused cursor after restart without dispatching until explicit resume',async()=>{
    fixture.search.mockResolvedValue({items:[{url:'https://divar.ir/v/first/1'},{url:'https://divar.ir/v/second/2'}],context:{topic:'کیف',city:'قزوین',region:''}});
    fixture.capture.mockResolvedValueOnce({ad:{id:1}}).mockRejectedValueOnce(new Error('captcha'));
    const jobs=await import('../src/companion/jobs.js');const run=await jobs.startDetailJob('divar',0,2);
    await vi.waitFor(()=>expect(fixture.runs.get(run.id)?.status).toBe('paused'));
    expect(fixture.checkpoints.get(run.id)).toMatchObject({index:1,processed:1,failed:0,pauseReason:'challenge'});
    fixture.capture.mockClear();vi.resetModules();const restored=await import('../src/companion/jobs.js');restored.restoreDetailJobs();
    expect(fixture.capture).not.toHaveBeenCalled();expect(()=>restored.assertSourceAvailable('divar')).toThrow();
    expect(restored.detailJobProgress(run.id)).toMatchObject({index:1,currentUrl:'https://divar.ir/v/second/2',resumable:true});
    await restored.focusDetailJob(run.id);expect(fixture.goto).toHaveBeenCalledTimes(2); // Existing challenge tab, no refresh.
    fixture.capture.mockResolvedValue({ad:{id:2}});restored.resumeDetailJob(run.id);
    await vi.waitFor(()=>expect(fixture.runs.get(run.id)).toMatchObject({status:'completed',processed:2,failed:0}));
    expect(fixture.goto).toHaveBeenCalledTimes(2);expect(fixture.checkpoints.has(run.id)).toBe(false);
  });
  it('keeps the other source running when one source meets a challenge',async()=>{
    fixture.capture.mockImplementation(async(source:string)=>{if(source==='divar')throw new Error('captcha');return {ad:{id:2}};});
    const jobs=await import('../src/companion/jobs.js');const divar=await jobs.startDetailJob('divar',0,1);const sheypoor=await jobs.startDetailJob('sheypoor',0,1);
    await vi.waitFor(()=>{expect(fixture.runs.get(divar.id)?.status).toBe('paused');expect(fixture.runs.get(sheypoor.id)?.status).toBe('completed');});
    expect(fixture.checkpoints.get(divar.id)?.index).toBe(0);expect(fixture.checkpoints.has(sheypoor.id)).toBe(false);
  });
});

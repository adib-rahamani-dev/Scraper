import { beforeEach,describe,expect,it,vi } from 'vitest';

const fixture=vi.hoisted(()=>{
  const runs=new Map<string,Record<string,unknown>>();
  return {runs,goto:vi.fn(async(_url:string,_options?:unknown)=>{}),bringToFront:vi.fn(async()=>{}),capture:vi.fn(),search:vi.fn(),link:vi.fn()};
});
vi.mock('../src/companion/store.js',()=>({db:{}}));
vi.mock('../src/shared/browser-rate-limit.js',()=>({MAX_BROWSER_ADS:20,waitForBrowserSlot:async()=>true}));
vi.mock('../src/companion/browser.js',()=>({selectedPage:()=>({}),openBrowser:async()=>({newPage:async()=>({goto:fixture.goto,bringToFront:fixture.bringToFront})})}));
vi.mock('../src/companion/capture.js',()=>({captureCurrentDetail:fixture.capture,readCurrentSearch:fixture.search}));
vi.mock('../src/shared/capture-data.js',()=>({
  createCaptureRun:(_db:unknown,_table:unknown,source:string,raw:Record<string,unknown>)=>{const run={id:`${source}-${fixture.runs.size}`,source,status:'running',processed:0,failed:0,...raw};fixture.runs.set(run.id,run);return run;},
  getCaptureRun:(_db:unknown,_table:unknown,id:string)=>fixture.runs.get(id),
  updateCaptureRun:(_db:unknown,_table:unknown,id:string,raw:Record<string,unknown>)=>{Object.assign(fixture.runs.get(id)!,raw);return fixture.runs.get(id);},
  linkCaptureRun:fixture.link,
}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();fixture.runs.clear();fixture.search.mockImplementation(async(source:string)=>({items:[{url:`https://${source}.test/v/1`}],context:{topic:'موضوع',city:'قزوین',region:'',searchUrl:`https://${source}.test/s/qazvin`}}));fixture.capture.mockReset();});
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
    expect(fixture.goto.mock.calls.map(call=>call[0])).toEqual(['https://divar.test/v/1','https://divar.test/v/1']);
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
});

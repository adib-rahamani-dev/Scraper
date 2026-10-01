import {expect,it} from 'vitest';
import {BROWSER_INTERVAL_MS,MAX_BROWSER_ADS,waitForBrowserSlot} from '../src/shared/browser-rate-limit.js';
it('keeps a fixed per-source delay across runs and respects existing persisted deadlines',async()=>{
  let time=1000;const deadlines=new Map([['divar',31000]]);
  const read=(site:string)=>deadlines.get(site)||0;const write=(site:string,next:number)=>{deadlines.set(site,next);};
  const sleep=async(ms:number)=>{time+=ms;};
  await waitForBrowserSlot('sheypoor',read,write,()=>false,sleep,()=>time);
  expect(time).toBe(1000);expect(read('sheypoor')).toBe(31000);
  await waitForBrowserSlot('divar',read,write,()=>false,sleep,()=>time);
  expect(time).toBe(31000);expect(read('divar')).toBe(61000);
  await waitForBrowserSlot('divar',read,write,()=>false,sleep,()=>time);
  expect(time).toBe(61000);expect(BROWSER_INTERVAL_MS).toBe(30000);expect(MAX_BROWSER_ADS).toBe(20);
});
it('can cancel while waiting without consuming a slot',async()=>{
  let stopped=false;let wrote=false;
  expect(await waitForBrowserSlot('divar',()=>30000,()=>{wrote=true;},()=>stopped,async()=>{stopped=true;},()=>0)).toBe(false);
  expect(wrote).toBe(false);
});

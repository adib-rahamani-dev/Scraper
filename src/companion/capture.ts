import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { cleanText, detailUrl, type BrowserSource } from './policy.js';
import { captureExtras } from '../shared/capture-data.js';
import { saveAd, type AdInput } from './store.js';

const readerScript=readFileSync(resolve('extension/page-reader.js'),'utf8');
type ReadAd={source:BrowserSource;title:string;url:string;topic:string;city:string;region:string;price:string;description:string;category:string;attributes:unknown[];images:string[];published_at:string};
type Reader={ready:(kind:string,timeout?:number)=>Promise<ReadAd|{source:BrowserSource;context:{topic:string;city:string;region:string;searchUrl:string};items:ReadAd[]}>;detail:(context:Partial<AdInput>)=>ReadAd;contactPhones:()=>string[]};

export async function readCurrentSearch(source:BrowserSource,page:Page) {
  // Official search pages may redirect to a category after DOMContentLoaded.
  // Retry only that navigation race; never retry access restrictions.
  const read=async()=>{await page.evaluate(readerScript);return await page.evaluate(async()=>await (globalThis as unknown as {LeadRadarReader:Reader}).LeadRadarReader.ready('search',30000));};
  let result;
  try{result=await read();}catch(error){if(!/Execution context was destroyed/.test(String(error)))throw error;await page.waitForLoadState('domcontentloaded',{timeout:15000});result=await read();}
  if(!('items' in result)||result.source!==source)throw new Error('منبع جست‌وجو نامعتبر است.');
  return result;
}
export async function captureCurrentDetail(source:BrowserSource,page:Page,manual:Partial<AdInput>={}) {
  if(!detailUrl(source,page.url()))throw new Error('این صفحه آگهی معتبر نیست.');
  await page.evaluate(readerScript);
  await page.evaluate(async()=>await (globalThis as unknown as {LeadRadarReader:Reader}).LeadRadarReader.ready('detail'));
  const data=await page.evaluate(ctx=>(globalThis as unknown as {LeadRadarReader:Reader}).LeadRadarReader.detail(ctx),manual);
  const result=saveAd({...data,...captureExtras(data),title:cleanText(manual.title,240)||data.title,topic:cleanText(manual.topic,80)||data.topic,city:data.city||cleanText(manual.city,80),region:data.region||cleanText(manual.region,80),phone:manual.phone??null,contact_basis:manual.contact_basis??'',contact_source:manual.contact_source??'',note:cleanText(manual.note,2000)},{replaceTitle:true,replaceDescription:true,refreshMetadata:true});
  return {saved:result.duplicate?0:1,duplicate:result.duplicate?1:0,ad:result.ad};
}
export async function captureCurrentSearch(source:BrowserSource,page:Page) {
  const result=await readCurrentSearch(source,page);let saved=0;let duplicate=0;
  for(const item of result.items){const stored=saveAd({...item,...captureExtras(item),phone:null,contact_basis:'',note:''},{refreshMetadata:true});if(stored.duplicate)duplicate++;else saved++;}
  return {saved,duplicate,scanned:result.items.length,sourceUrl:page.url()};
}
export async function captureVisibleContact(source:BrowserSource,page:Page,basis:string) {
  if(!detailUrl(source,page.url()))throw new Error('ابتدا صفحهٔ یک آگهی را باز کن.');
  if(basis!=='direct-consent'&&basis!=='public-business')throw new Error('مبنای مجاز ارتباط را انتخاب کن.');
  await page.evaluate(readerScript);
  const candidates=await page.evaluate(()=>(globalThis as unknown as {LeadRadarReader:Reader}).LeadRadarReader.contactPhones());
  if(candidates.length!==1)throw new Error(candidates.length?'چند شماره نمایان است؛ شمارهٔ درست را دستی ثبت کن.':'شماره‌ای در بخش تماسِ نمایان پیدا نشد. ابتدا اطلاعات تماس را خودت باز کن.');
  const metadata=await captureCurrentDetail(source,page);
  const ad=saveAd({...metadata.ad,phone:candidates[0]!,contact_basis:basis,contact_source:'visible'}).ad;
  return {ad,phone:candidates[0]!,contactSource:'visible'};
}

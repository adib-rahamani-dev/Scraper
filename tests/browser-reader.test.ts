import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,expect,it} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright-core';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
afterAll(async()=>{await browser?.close();});
async function fixture(url:string,html:string):Promise<Page>{const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8">'+html}));await page.goto(url);return page;}
const reader=readFileSync('extension/page-reader.js','utf8');const login=readFileSync('extension/login.js','utf8');
const contactOptions={confirmed:true,basis:'public-business',expectedUrl:'https://divar.ir/v/contact-fixture/1',timeout:1000};
it('reveals exactly one selected Divar contact on explicit confirmation and never reads description numbers',async()=>{
  const page=await fixture(contactOptions.expectedUrl,'<main><h1>فروشندهٔ نمونه</h1><button id="contact">اطلاعات تماس</button><section><h2>توضیحات</h2><p>عدد نامرتبط ۰۹۹۹۹۹۹۹۹۹۹</p></section><div id="row"></div></main>');
  await page.evaluate(()=>{(globalThis as any).clicks=0;(globalThis as any).document.querySelector('#contact')!.addEventListener('click',()=>{(globalThis as any).clicks++;(globalThis as any).document.querySelector('#row')!.innerHTML='<span>شماره موبایل</span><b>۰۹۱۲۳۴۵۶۷۸۹</b>';});});
  await page.evaluate(reader);
  expect(await page.evaluate(options=>(globalThis as any).LeadRadarReader.revealContact(options),contactOptions)).toBe('09123456789');
  expect(await page.evaluate(()=>(globalThis as any).clicks)).toBe(1);
  expect(await page.evaluate(options=>(globalThis as any).LeadRadarReader.revealContact(options),contactOptions)).toBe('09123456789');
  expect(await page.evaluate(()=>(globalThis as any).clicks)).toBe(1);await page.close();
});
it('reveals a Sheypoor contact from a single seller-contact control',async()=>{
  const url='https://www.sheypoor.com/v/contact-fixture-1.html';
  const page=await fixture(url,'<main><h1>کارگاه نمونه</h1><button id="contact">تماس با فروشنده</button><div id="row"></div></main>');
  await page.evaluate(()=>{(globalThis as any).document.querySelector('#contact')!.addEventListener('click',()=>{(globalThis as any).document.querySelector('#row')!.innerHTML='<a href="tel:09123456789">09123456789</a>';});});
  await page.evaluate(reader);expect(await page.evaluate(options=>(globalThis as any).LeadRadarReader.revealContact(options),{...contactOptions,expectedUrl:url})).toBe('09123456789');await page.close();
});
it('rejects missing confirmation, a wrong ad and ambiguous contact buttons before clicking',async()=>{
  const page=await fixture(contactOptions.expectedUrl,'<main><h1>نمونه</h1><button>اطلاعات تماس</button><button>تماس</button></main>');await page.evaluate(reader);
  await page.evaluate(()=>{(globalThis as any).clicks=0;(globalThis as any).document.querySelectorAll('button').forEach((button:any)=>button.addEventListener('click',()=>{(globalThis as any).clicks++;}));});
  await expect(page.evaluate(options=>(globalThis as any).LeadRadarReader.revealContact(options),{...contactOptions,confirmed:false})).rejects.toThrow('تأیید');
  await expect(page.evaluate(options=>(globalThis as any).LeadRadarReader.revealContact(options),{...contactOptions,expectedUrl:'https://divar.ir/v/different/2'})).rejects.toThrow('تطابق');
  await expect(page.evaluate(options=>(globalThis as any).LeadRadarReader.revealContact(options),contactOptions)).rejects.toThrow('چند دکمه');
  expect(await page.evaluate(()=>(globalThis as any).clicks)).toBe(0);await page.close();
});
it.each(['captcha','login','ambiguous'])('stops after one click when contact reveal encounters %s',async(kind)=>{
  const page=await fixture(contactOptions.expectedUrl,'<main><h1>نمونه</h1><button id="contact">اطلاعات تماس</button><div id="row"></div></main>');
  await page.evaluate(value=>{(globalThis as any).clicks=0;(globalThis as any).document.querySelector('#contact')!.addEventListener('click',()=>{(globalThis as any).clicks++;(globalThis as any).document.querySelector('#row')!.innerHTML=value==='captcha'?'<p>کپچا</p>':value==='login'?'<input autocomplete="one-time-code">':'<span>شماره موبایل</span><b>09123456789 و 09123456001</b>';});},kind);
  await page.evaluate(reader);
  await expect(page.evaluate(options=>(globalThis as any).LeadRadarReader.revealContact(options),contactOptions)).rejects.toThrow(kind==='captcha'?'کپچا':kind==='login'?'ورود':'چند شماره');
  expect(await page.evaluate(()=>(globalThis as any).clicks)).toBe(1);await page.close();
});
it('detects a visible CAPTCHA but ignores dormant hidden challenge widgets',async()=>{
  const page=await fixture('https://divar.ir/v/fixture/1','<h1>آگهی</h1><div class="g-recaptcha" hidden>widget</div>');
  await page.evaluate(reader);expect(await page.evaluate(()=>(globalThis as any).LeadRadarReader.blocked())).toBe(false);await page.close();
  const challenge=await fixture('https://divar.ir/s/qazvin','<div class="h-captcha" style="width:200px;height:100px">verification</div>');
  await challenge.evaluate(reader);expect(await challenge.evaluate(()=>(globalThis as any).LeadRadarReader.blocked())).toBe(true);await challenge.close();
});
it('reads Divar description following the description heading, not the publication row',async()=>{
  const page=await fixture('https://divar.ir/v/fixture/1',`<h1>موبایل واقعی</h1><div class="kt-info-row__title">دقایقی پیش در قزوین، خ فضیلت</div><div class="kt-description-row">تاریخ انتشار</div><section><div><div class="kt-title-row"><h2>توضیحات</h2></div></div><div class="kt-description-row">رم ۶ و حافظه ۲۵۶<br>تماس ۰۹۱۲۳۴۵۶۷۸۹</div></section><div class="kt-unexpandable-row"><span class="kt-unexpandable-row__title">حافظه</span><span class="kt-unexpandable-row__value">۲۵۶ گیگابایت</span></div>`);
  await page.evaluate(reader);const result=await page.evaluate(()=> (globalThis as any).LeadRadarReader.detail({topic:'موبایل'}));
  expect(result.description).toContain('رم ۶');expect(result.description).not.toContain('تاریخ انتشار');expect(result.description).not.toContain('۰۹۱۲۳۴۵۶۷۸۹');expect(result.attributes).toEqual([{label:'حافظه',value:'۲۵۶ گیگابایت'}]);expect(result.city).toBe('قزوین');expect(result.region).toBe('خ فضیلت');await page.close();
});
it('reads Sheypoor dynamic attributes and visible description only, with the city not province',async()=>{
  const page=await fixture('https://www.sheypoor.com/v/fixture-1.html',`<main><h1>آپارتمان</h1><div>۲ روز پیش، گیلان، لنگرود، جاده لیلاکوه</div><strong>۲,۰۰۰,۰۰۰,۰۰۰</strong><div><h3>متراژ</h3><span>۶۳</span></div><div><h3>تعداد اتاق</h3><span>۲</span></div><div><span>توضیحات:</span><div aria-hidden="true">نسخهٔ مخفی</div><div>متن کامل و واقعی ملک</div></div></main>`);
  await page.evaluate(reader);const result=await page.evaluate(()=> (globalThis as any).LeadRadarReader.detail());expect(result.description).toBe('متن کامل و واقعی ملک');expect(result.city).toBe('لنگرود');expect(result.region).toBe('جاده لیلاکوه');expect(result.attributes).toHaveLength(2);await page.close();
});
it('deduplicates loaded search cards and ignores unrelated links',async()=>{
  const page=await fixture('https://divar.ir/s/qazvin?q=mobile',`<a href="/v/mobile/1"><h2>موبایل</h2><div>۱۲,۰۰۰,۰۰۰ تومان</div></a><a href="/v/mobile/1"><h2>موبایل</h2></a><a href="https://evil.example/v/x"><h2>خارجی</h2></a>`);await page.evaluate(reader);const result=await page.evaluate(()=> (globalThis as any).LeadRadarReader.search());expect(result.items).toHaveLength(1);expect(result.context.topic).toBe('mobile');await page.close();
});
it('reads a manually revealed Divar phone from the labeled row and ignores description numbers',async()=>{
  const page=await fixture('https://divar.ir/v/fixture-contact/2',`<main><h1>زین</h1><div><span>شماره موبایل</span><button>۰۹۱۲۳۴۵۶۷۸۹</button></div><section><h2>توضیحات</h2><p>عدد نامرتبط ۰۹۹۹۹۹۹۹۹۹۹</p></section><div hidden><span>شماره تماس</span><b>۰۹۱۱۱۱۱۱۱۱۱</b></div></main>`);
  await page.evaluate(reader);expect(await page.evaluate(()=> (globalThis as any).LeadRadarReader.contactPhones())).toEqual(['09123456789']);await page.close();
});
it('does not climb from a closed contact row into the ad description',async()=>{const page=await fixture('https://divar.ir/v/fixture-contact/3','<main><h1>آگهی</h1><div><div><span>شماره موبایل</span><button>نمایش شماره</button></div></div><section><h2>توضیحات</h2><p>۰۹۱۲۳۴۵۶۷۸۹</p></section></main>');await page.evaluate(reader);expect(await page.evaluate(()=>(globalThis as any).LeadRadarReader.contactPhones())).toEqual([]);await page.close();});
it('fills the official phone field, submits once, and leaves the OTP entry to the user',async()=>{
  const page=await fixture('https://www.sheypoor.com/session',`<form><input name="username"><button type="submit">ورود یا ثبت نام در شیپور</button></form>`);
  await page.evaluate(()=>{const doc=(globalThis as any).document;(globalThis as any).submits=0;doc.querySelector('form').onsubmit=(e:{preventDefault:()=>void})=>{e.preventDefault();(globalThis as any).submits++;doc.querySelector('form').innerHTML='<input autocomplete="one-time-code" name="otp"><p>کد تأیید را وارد کنید</p>';};});
  await page.evaluate(login);const result=await page.evaluate(()=> (globalThis as any).LeadRadarLogin.login('۰۹۱۲۳۴۵۶۷۸۹'));expect(result.state).toBe('awaiting-code');
  await page.evaluate(()=> (globalThis as any).LeadRadarLogin.login('09123456789'));expect(await page.evaluate(()=> (globalThis as any).submits)).toBe(1);expect(await page.locator('input[name="otp"]').inputValue()).toBe('');await page.close();
});

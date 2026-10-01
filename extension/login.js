(() => {
  const visible=e=>Boolean(e && e.getClientRects().length && !e.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(e).visibility!=='hidden');
  const label=e=>(e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
  const phoneField=()=>[...document.querySelectorAll('input')].find(e=>visible(e) && (e.name==='phone'||e.name==='username'||e.autocomplete==='tel-national'||e.type==='tel') && e.autocomplete!=='one-time-code');
  const otp=()=>[...document.querySelectorAll('input')].some(e=>visible(e) && (e.autocomplete==='one-time-code'||/otp|verification|code/i.test(e.name))) || /کد (?:تأیید|تایید|فعال.?سازی).*(?:وارد|ارسال)|کد پیامک/.test(document.body.innerText);
  async function wait(check, timeout=10000) {const start=Date.now();while(Date.now()-start<timeout){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,200));}return null;}
  async function login(phone, options={}) {
    const source=/^(www\.)?divar\.ir$/.test(location.hostname)?'divar':/^(www\.)?sheypoor\.com$/.test(location.hostname)?'sheypoor':null;
    if(!source) throw new Error('ورود فقط در دامنهٔ رسمی سایت انجام می‌شود.');
    if(otp()) return {state:'awaiting-code',message:'فرم کد تأیید باز است؛ کد را همین‌جا در سایت وارد کن.'};
    let field=phoneField();
    if(!field) {
      if(source==='divar') {
        const menu=[...document.querySelectorAll('button')].find(e=>visible(e)&&label(e).includes('دیوار من'));
        if(!menu) throw new Error('منوی حساب دیوار پیدا نشد؛ صفحه هنوز آماده نیست.');
        menu.click();
        const entry=await wait(()=>[...document.querySelectorAll('button,[role="button"]')].find(e=>visible(e)&&label(e).includes('ورود به حساب کاربری')) || (document.body.innerText.includes('خروج از حساب کاربری')?'signed-in':null));
        if(entry==='signed-in') return {state:'signed-in',message:'نشست ورود دیوار فعال است.'};
        if(!entry) throw new Error('گزینهٔ ورود در منوی دیوار پیدا نشد.');
        entry.click();
      } else {
        const entry=[...document.querySelectorAll('a,button')].find(e=>visible(e)&&label(e)==='حساب من');
        if(!entry) throw new Error('ورودی حساب شیپور پیدا نشد.');
        entry.click();
      }
      field=await wait(phoneField,12000);
    }
    if(!field) {
      if(/خروج از حساب|آگهی‌های من|آگهی های من/.test(document.body.innerText)) return {state:'signed-in',message:'نشست ورود سایت فعال است.'};
      throw new Error('فرم شماره نمایش داده نشد؛ ممکن است سایت نیاز به بررسی دستی داشته باشد.');
    }
    if(!phone) return {state:'phone-form',message:'فرم رسمی شماره آماده است.'};
    const normalized=String(phone).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/\s|-/g,'');
    if(!/^09\d{9}$/.test(normalized)) throw new Error('شماره همراه باید ۱۱ رقم و با 09 شروع شود.');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(field,normalized);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
    if(options.submit===false) return {state:'phone-filled',message:'شماره در فرم رسمی قرار گرفت.'};
    const submit=await wait(()=>[...document.querySelectorAll('button')].find(e=>visible(e)&&!e.disabled&&(/^(بعدی|ادامه|ارسال کد|دریافت کد)$/.test(label(e)) || (source==='sheypoor'&&label(e)==='ورود یا ثبت نام در شیپور'))),4000);
    if(!submit) throw new Error('دکمهٔ ارسال کد آماده نیست؛ شماره یا پیام سایت را بررسی کن.');
    submit.click();
    if(await wait(otp,15000)) return {state:'awaiting-code',message:'کد ارسال شد؛ فقط کد را در فرم رسمی سایت وارد کن.'};
    throw new Error('ارسال کد از سمت سایت تأیید نشد. ارسال خودکار تکرار نمی‌شود؛ پیام سایت را بررسی کن.');
  }
  globalThis.LeadRadarLogin={login};
})();

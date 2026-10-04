(() => {
  const visible=e=>Boolean(e && e.getClientRects().length && !e.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(e).visibility!=='hidden');
  const label=e=>(e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
  const phoneField=()=>[...document.querySelectorAll('input')].find(e=>visible(e) && (e.name==='phone'||e.name==='username'||e.autocomplete==='tel-national'||e.type==='tel') && e.autocomplete!=='one-time-code');
  const otp=()=>[...document.querySelectorAll('input')].some(e=>visible(e) && (e.autocomplete==='one-time-code'||/otp|verification|code/i.test(e.name))) || /کد (?:تأیید|تایید|فعال.?سازی).*(?:وارد|ارسال)|کد پیامک/.test(document.body.innerText);
  const site=()=>/^(www\.)?divar\.ir$/.test(location.hostname)?'divar':/^(www\.)?sheypoor\.com$/.test(location.hostname)?'sheypoor':null;
  function currentStatus() {
    if(!site())throw new Error('بررسی ورود فقط در سایت اصلی مجاز است.');
    if(otp())return {state:'awaiting-code',message:'منتظر کد تأیید در سایت اصلی'};
    if(phoneField())return {state:'signed-out',message:'فرم ورود باز است؛ وارد نشده‌ای'};
    const controls=[...document.querySelectorAll('button,a,[role="button"]')].filter(visible).map(label);
    if(controls.some(value=>/^(خروج|خروج از حساب(?: کاربری)?|خروج از شیپور)$/.test(value)))return {state:'signed-in',message:'ورود فعال است؛ دکمهٔ خروج حساب دیده شد'};
    if(controls.some(value=>/^(ورود به حساب کاربری|ورود یا ثبت نام|ورود یا ثبت نام در شیپور)$/.test(value)))return {state:'signed-out',message:'وارد نشده‌ای؛ سایت گزینهٔ ورود نشان می‌دهد'};
    return {state:'unknown',message:'ورود هنوز قابل تأیید نیست؛ بررسی حساب را بزن',accountControls:diagnostics()};
  }
  async function status({inspect=false,waitReady=false}={}) {
    let result=currentStatus();
    if(waitReady&&result.state==='unknown')result=await wait(()=>{const value=currentStatus();return value.state!=='unknown'?value:null;},8000)||result;
    if(result.state!=='unknown'||!inspect)return result;
    const findMenu=()=>[...document.querySelectorAll('button,[role="button"]')].find(e=>visible(e)&&(site()==='divar'?label(e)==='دیوار من':label(e)==='حساب من'));
    const menu=findMenu()||await wait(findMenu,3000);
    if(!menu)return result;
    menu.click();
    result=await wait(()=>{const value=currentStatus();return value.state!=='unknown'?value:null;},2000)||currentStatus();
    // Restore only the menu we opened. Never navigate, submit or inspect cookies.
    if(visible(menu)&&menu.getAttribute('aria-expanded')!=='false')menu.click();
    return result;
  }
  async function wait(check, timeout=10000) {const start=Date.now();while(Date.now()-start<timeout){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,200));}return null;}
  async function login(phone, options={}) {
    const source=/^(www\.)?divar\.ir$/.test(location.hostname)?'divar':/^(www\.)?sheypoor\.com$/.test(location.hostname)?'sheypoor':null;
    if(!source) throw new Error('ورود فقط در دامنهٔ رسمی سایت انجام می‌شود.');
    const existing=currentStatus();
    if(existing.state==='signed-in'||existing.state==='awaiting-code')return existing;
    let field=phoneField();
    if(!field) {
      if(source==='divar') {
        const menu=[...document.querySelectorAll('button')].find(e=>visible(e)&&label(e).includes('دیوار من'));
        if(!menu) throw new Error('منوی حساب دیوار پیدا نشد؛ صفحه هنوز آماده نیست.');
        menu.click();
        const entry=await wait(()=>[...document.querySelectorAll('button,[role="button"]')].find(e=>visible(e)&&label(e).includes('ورود به حساب کاربری')) || (currentStatus().state==='signed-in'?'signed-in':null));
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
      if(currentStatus().state==='signed-in') return {state:'signed-in',message:'نشست ورود سایت فعال است.'};
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
  const diagnostics=()=>[...document.querySelectorAll('button,a,[role="button"]')].filter(e=>visible(e)&&/دیوار من|حساب|ورود|خروج/.test(label(e))&&label(e).length<100).map(e=>({tag:e.tagName,label:label(e).replace(/[0-9۰-۹]/g,'*')})).slice(0,12);
  globalThis.LeadRadarLogin={login,status,diagnostics};
})();

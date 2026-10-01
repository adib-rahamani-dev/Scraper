(() => {
  const clean = (v, max = 300) => String(v || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const labelText=v=>clean(v,100).replace(/[\u064b-\u065f\u0670]/g,'').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[:：]$/,'').trim();
  const digits = v => String(v || '').replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const redact = v => String(v || '').replace(/(?:\+98|0098|0|۰)?[9۹][0-9۰-۹](?:[\s\-().]*[0-9۰-۹]){8}|[0۰][1-8۱-۸][0-9۰-۹](?:[\s\-().]*[0-9۰-۹]){8}/g, '[شماره حذف شد]');
  const visible = e => Boolean(e && e.getClientRects().length && !e.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
  const text = (e, max = 300) => visible(e) ? clean(e.innerText, max) : '';
  const first = (root, selectors, max) => [...root.querySelectorAll(selectors)].map(e => text(e, max)).find(Boolean) || '';
  function source() { return /^(www\.)?divar\.ir$/.test(location.hostname) ? 'divar' : /^(www\.)?sheypoor\.com$/.test(location.hostname) ? 'sheypoor' : null; }
  function url(raw) {
    try { const u = new URL(raw, location.href); if (u.protocol !== 'https:' || u.username || u.password || u.port || !/^\/v\/[^/]+/.test(u.pathname) || u.hostname.replace(/^www\./,'') !== location.hostname.replace(/^www\./,'')) return null; u.search=''; u.hash=''; return u.href; } catch { return null; }
  }
  function context() {
    const u = new URL(location.href); const slug = u.pathname.match(/^\/s\/([^/]+)/)?.[1];
    const cities = {iran:'کل ایران',tehran:'تهران',qazvin:'قزوین',karaj:'کرج',mashhad:'مشهد',isfahan:'اصفهان',shiraz:'شیراز',tabriz:'تبریز',qom:'قم',rasht:'رشت',ahvaz:'اهواز'};
    return { topic: clean(u.searchParams.get('q'),80), city: cities[slug] || clean(slug,80), region:'', searchUrl:u.href };
  }
  function search(limit = 40) {
    if (!source() || !location.pathname.startsWith('/s/')) throw new Error('صفحهٔ نتایج جست‌وجو را باز کن.');
    const items=[]; const seen=new Set();
    for (const anchor of document.querySelectorAll('a[href*="/v/"]')) {
      if (!visible(anchor) || anchor.closest('[aria-label*="ویترین"]')) continue;
      const link=url(anchor.href); if (!link || seen.has(link)) continue;
      const heading=anchor.querySelector('h2,h3,.kt-post-card__title'); const title=redact(text(heading,240));
      if (!title) continue;
      const lines=(anchor.innerText || '').split('\n').map(v=>clean(v,400)).filter(Boolean);
      const price=lines.find(v=>/تومان|ریال|توافقی|رایگان|^رهن:|^اجاره:/.test(v) || /^[۰-۹0-9]{1,3}(?:[,٬][۰-۹0-9]{3})+$/.test(v)) || '';
      items.push({source:source(),url:link,title,...context(),price:clean(redact(price),200),description:'',category:'',attributes:[],images:[],published_at:''}); seen.add(link);
      if(items.length >= Math.max(1,Math.min(40,Number(limit)||40))) break;
    }
    if(!items.length) throw new Error('کارت آگهی بارگذاری نشده است. پس از نمایش نتایج دوباره تلاش کن.');
    return {source:source(),context:context(),items};
  }
  function blocked() {
    const body=document.body?.innerText || '';
    return /کپچا|تعداد درخواست.*زیاد|دسترسی.*محدود|access denied|verify you are human|too many requests/i.test(body) || [...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenge"],.g-recaptcha,.h-captcha')].some(visible);
  }
  function contactPhones() {
    if(!url(location.href)) throw new Error('ابتدا صفحهٔ یک آگهی را باز کن.');
    const parts=[];const add=node=>{if(!visible(node)||node.closest('#lead-radar-extension,#lead-radar-floating-panel,.kt-description-row,[data-testid="post-description"],[itemprop="description"]'))return;const value=clean(node.innerText||node.textContent,3000);if(value)parts.push(value);};
    for(const node of document.querySelectorAll('[role="dialog"],.post-actions,[class*="contact-info"],[class*="contact-modal"],[class*="post-contact"],[data-testid*="contact"]'))add(node);
    for(const link of document.querySelectorAll('a[href^="tel:"]'))if(visible(link)&&!link.closest('.kt-description-row,[data-testid="post-description"],[itemprop="description"]')){try{parts.push(decodeURIComponent(link.getAttribute('href')||''));}catch{parts.push(link.getAttribute('href')||'');}}
    // The official Sheypoor masked-phone widget becomes a plain numeric span
    // inside the description. Read only that widget, not the description itself.
    if(source()==='sheypoor')for(const node of document.querySelectorAll('span.text-main.cursor-pointer.text-heading-4-bolder')){
      const value=digits(text(node,80));
      if(visible(node)&&!node.closest('#lead-radar-extension,#lead-radar-floating-panel')&&/^0[1-9]\d{9}$/.test(value.replace(/[\s\-().]/g,'')))parts.push(value);
    }
    // Divar can render the revealed number as a normal row beside the label "شماره موبایل".
    for(const label of document.querySelectorAll('span,dt,label,div,p,strong')) {
      if(!visible(label)||!/^(شماره موبایل|شماره همراه|شماره تماس(?: تایید شده| تأیید شده)?|تلفن تماس|تلفن|mobile number|phone number)$/i.test(labelText(label.textContent)))continue;
      let row=label.parentElement;
      for(let level=0;row&&level<3;level++,row=row.parentElement){if(row.matches('main,body,[role="main"]')||row.querySelector('h1,h2'))break;add(row);if(/(?:\+98|0098|0|۰)[9۹]/.test(clean(row.innerText,500)))break;}
    }
    const phones=new Set();
    for(const part of parts)for(const match of digits(clean(part,3000)).matchAll(/(?<!\d)(?:(?:\+98|0098|98|0)?9\d(?:[\s\-().]*\d){8}|(?:\+98|0098|98|0)[1-8]\d(?:[\s\-().]*\d){8})(?!\d)/g)){
      const num=match[0].replace(/\D/g,'');const phone=num.startsWith('0098')?'0'+num.slice(4):num.startsWith('98')?'0'+num.slice(2):num.startsWith('9')?'0'+num:num;
      if(/^0[1-9]\d{9}$/.test(phone))phones.add(phone);
    }
    return [...phones];
  }
  async function revealContact({confirmed,basis,expectedUrl,timeout=8000}={}) {
    if(confirmed!==true||!['direct-consent','public-business'].includes(basis))throw new Error('تأیید و مبنای مجاز ثبت تماس همین آگهی لازم است.');
    const original=url(location.href);
    if(!source()||!original||url(expectedUrl)!==original)throw new Error('برگه با آگهی انتخاب‌شده تطابق ندارد.');
    const assertReady=()=>{
      if(url(location.href)!==original)throw new Error('آدرس آگهی تغییر کرد؛ ثبت تماس انجام نشد.');
      if(blocked())throw new Error('کپچا یا محدودیت نمایش داده شد؛ آن را در سایت دستی حل کن و دوباره همین دکمه را بزن.');
      if(source()==='divar'&&[...document.querySelectorAll('.post-actions')].some(node=>/شماره مخفی شده است/.test(text(node.parentElement,3000))))throw new Error('آگهی‌گذار شماره را مخفی کرده است؛ این آگهی فقط امکان چت دارد و شماره‌ای برای ثبت وجود ندارد.');
      if([...document.querySelectorAll('input[autocomplete="one-time-code"],input[name="otp"],input[name="username"],input[type="tel"]')].some(visible))throw new Error('ورود یا کد تأیید در سایت لازم است؛ شماره ثبت نشد.');
    };
    assertReady();
    let numbers=contactPhones();
    if(numbers.length>1)throw new Error('چند شماره نمایان است؛ برای جلوگیری از ثبت اشتباه چیزی ذخیره نشد.');
    if(numbers.length===1)return numbers[0];
    let candidates=[...document.querySelectorAll('button,[role="button"],a')].filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&!node.closest('#lead-radar-extension,#lead-radar-floating-panel')&&(!node.matches('a')||!node.getAttribute('href')||node.getAttribute('href').startsWith('#'))&&/^(اطلاعات\s*تماس|نمایش\s*(?:اطلاعات\s*تماس|شماره(?:\s*تماس)?)|تماس\s*با\s*(?:فروشنده|آگهی[\s‌]*دهنده)|شماره\s*تماس|تماس)$/.test(labelText(node.innerText||node.getAttribute('aria-label'))));
    // Sheypoor's real contact control is a clickable span, not a button.
    // Require the masked-phone shape; never click an arbitrary description expander.
    if(!candidates.length&&source()==='sheypoor')candidates=[...document.querySelectorAll('span')].filter(node=>visible(node)&&!node.closest('#lead-radar-extension,#lead-radar-floating-panel')&&/^09\d{2}[Xx*]{3}\d{4}\s*\(نمایش\s*کامل\)$/.test(digits(labelText(node.innerText))));
    if(candidates.length!==1)throw new Error(candidates.length?'چند دکمهٔ تماس نمایان است؛ بخش تماس را خودت در سایت باز کن.':'دکمهٔ اطلاعات تماس شناخته نشد؛ آن را خودت در سایت باز کن.');
    candidates[0].click(); // One explicitly selected ad, one click, no retry or bulk queue.
    const deadline=Date.now()+Math.min(8000,Math.max(200,Number(timeout)||8000));
    while(Date.now()<deadline){
      assertReady();numbers=contactPhones();
      if(numbers.length>1)throw new Error('چند شماره نمایان است؛ چیزی ذخیره نشد.');
      if(numbers.length===1)return numbers[0];
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw new Error('شماره نمایان نشد؛ پیام سایت را بررسی کن. هیچ شماره‌ای ثبت نشد.');
  }
  function detail(extra = {}) {
    if(blocked()) throw new Error('سایت درخواست بررسی یا محدودیت دسترسی نشان داده؛ اجرا متوقف شد.');
    const link=url(location.href); if(!link) throw new Error('این صفحه یک آگهی معتبر نیست.');
    const s=source(); const title=redact(first(document,'h1',240)); if(!title) throw new Error('عنوان آگهی هنوز بارگذاری نشده است.');
    const attributes=[]; const keys=new Set();
    const add=(label,value)=>{label=clean(label,100);value=clean(redact(value),500);if(label && value && label!==value && !keys.has(label)){attributes.push({label,value});keys.add(label);}};
    for(const row of document.querySelectorAll('.kt-unexpandable-row,.kt-group-row-item,dl')) {
      if(!visible(row)) continue;
      const label=first(row,'.kt-unexpandable-row__title,.kt-group-row-item__title,dt',100);
      const value=first(row,'.kt-unexpandable-row__value,.kt-unexpandable-row__action,.kt-group-row-item__value,.kt-group-row-item__subtitle,dd',500);
      add(label,value);
    }
    if(s==='sheypoor') for(const h of document.querySelectorAll('main h3')) {
      const row=h.parentElement; if(!visible(h) || /مشابه|امنیت|گزارش/.test(text(h))) continue;
      if(row?.children.length <= 4) add(text(h),[...row.children].filter(e=>e!==h).map(e=>text(e,500)).filter(Boolean).join(' '));
    }
    let description='';
    const headings=[...document.querySelectorAll('h2,h3,span')].filter(e=>visible(e) && /^توضیحات[:：]?$/.test(clean(e.innerText)));
    for(const heading of headings) {
      if(s==='divar') {
        const row=heading.closest('.kt-title-row');
        // Divar sometimes wraps the heading in an extra div. Search only its nearby section.
        let scope=row;
        for(let level=0;scope && level<3;level++,scope=scope.parentElement) {
          let next=scope.nextElementSibling;
          for(let i=0;next && i<3;i++,next=next.nextElementSibling) {
            const target=next.matches('.kt-description-row') ? next : next.querySelector('.kt-description-row');
            if(visible(target)) { description=target.innerText;break; }
          }
          if(description.trim())break;
        }
      } else {
        const siblings=[...heading.parentElement.children].filter(e=>e!==heading && visible(e));
        description=siblings.map(e=>e.innerText).filter(Boolean).join('\n');
      }
      if(description.trim()) break;
    }
    if(!description) description=first(document,'[data-testid="post-description"],[data-test-id="description"],[itemprop="description"]',10000);
    description=redact(description).replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim().slice(0,10000);
    const price=attributes.find(a=>a.label==='قیمت')?.value || (s==='sheypoor' ? first(document,'main strong',200) : '');
    const breadcrumbs=[...new Set([...document.querySelectorAll('[aria-label="breadcrumb"] a,[data-testid="breadcrumbs"] a,.kt-breadcrumbs a,[class*="breadcrumb"] a')].map(e=>text(e,100)).filter(Boolean))];
    const locationText=s==='divar' ? first(document,'.kt-info-row__title',240) : [...document.querySelectorAll('main div,main span')].filter(e=>e.children.length===0 && visible(e)).map(e=>text(e,240)).find(v=>/پیش[،,]|لحظاتی پیش[،,]/.test(v)) || '';
    const area=locationText.split(/\sدر\s|پیش[،,]\s*/).at(-1)?.split(/[،,]/).map(v=>clean(v,80)) || [];
    const images=[...new Set([...document.querySelectorAll(s==='divar'?'img.kt-image-block__image,img[class*="post-image"],img[class*="carousel"]':'img[alt^="slider-img"]')].filter(visible).map(e=>e.currentSrc || e.src).filter(v=>/^https:\/\//.test(v)&&!v.includes('mapimage.divarcdn.com')))].slice(0,30);
    const category=s==='divar' ? breadcrumbs.slice(0,3).join(' / ') : breadcrumbs.slice(2,4).join(' / ');
    const city=area[s==='sheypoor'?1:0]||'';
    return {source:s,url:link,title,topic:clean(extra.topic,80),city:city||clean(extra.city,80),region:area.length>(s==='sheypoor'?2:1)?area.at(-1)||'':clean(extra.region,80),price:clean(redact(price),200),description,category,attributes:attributes.slice(0,60),images,published_at:locationText,searchUrl:extra.searchUrl||'',captured_at:new Date().toISOString()};
  }
  async function ready(kind='detail', timeout=15000) {
    const start=Date.now(); let previous=''; let stableSince=Date.now();let lastError='';
    while(Date.now()-start<timeout) {
      if(blocked()) throw new Error('سایت بررسی امنیتی یا محدودیت دسترسی نشان داده است.');
      try { const result=kind==='search'?search():detail(); const signature=JSON.stringify(result.title?{title:result.title,description:result.description,attributes:result.attributes}:result.items.map(i=>i.url));
        if(signature!==previous){previous=signature;stableSince=Date.now();}
        const descriptionPending=kind==='detail'&&!result.description&&[...document.querySelectorAll('h2,h3,span')].some(e=>visible(e)&&/^توضیحات[:：]?$/.test(clean(e.innerText)));
        if(Date.now()-stableSince>=800 && !descriptionPending && (kind==='search'||result.description||result.attributes.length&&Date.now()-start>2000||Date.now()-start>5000)) return result;
      } catch(error) { lastError=error.message;if(blocked()) throw error; }
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw new Error(kind==='search'?(lastError||'نتایج جست‌وجو بارگذاری نشد؛ برگهٔ واقعی سایت را بررسی کن.'):'آگهی به‌طور کامل بارگذاری نشد یا حذف شده است؛ دادهٔ ناقص ثبت نشد.');
  }
  function contactDiagnostics() {
    if(!url(location.href))throw new Error('ابتدا صفحهٔ یک آگهی را باز کن.');
    const controls=[...document.querySelectorAll('button,[role="button"],a,span')].filter(node=>visible(node)&&!node.closest('#lead-radar-extension,#lead-radar-floating-panel')&&/تماس|نمایش کامل|شماره|ورود|تأیید|تایید/.test(labelText(node.innerText||node.getAttribute('aria-label')))&&clean(node.innerText,1000).length<150).slice(0,30).map(node=>({tag:node.tagName,label:redact(text(node,150)),className:clean(node.className,150),parentTag:node.parentElement?.tagName,parentClass:clean(node.parentElement?.className,150),parentText:redact(text(node.parentElement,500))}));
    const notices=[...document.querySelectorAll('[role="alert"],[role="dialog"]')].filter(visible).map(node=>redact(text(node,800))).slice(0,5);
    const contactArea=[...document.querySelectorAll('.post-actions')].filter(visible).map(node=>redact(text(node.parentElement,3000))).slice(0,2);
    const numberNodes=[...document.querySelectorAll('span,a,button')].filter(node=>visible(node)&&!node.closest('#lead-radar-extension,#lead-radar-floating-panel')&&/^0[1-9]\d{9}$/.test(digits(labelText(node.innerText)).replace(/[\s\-().]/g,''))).slice(0,10).map(node=>({tag:node.tagName,className:clean(node.className,150),parentTag:node.parentElement?.tagName,parentClass:clean(node.parentElement?.className,150),hasTel:node.getAttribute('href')?.startsWith('tel:')||false}));
    return {controls,notices,contactArea,numberNodes};
  }
  globalThis.LeadRadarReader={search,detail,context,ready,blocked,visible,text,digits,redact,contactPhones,revealContact,contactDiagnostics};
})();

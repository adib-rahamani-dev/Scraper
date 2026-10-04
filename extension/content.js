(() => {
  if(window!==window.top||document.getElementById('lead-radar-extension'))return;
  const reader=globalThis.LeadRadarReader;
  const source=location.hostname.includes('divar.ir')?'divar':'sheypoor';
  const send=(action,extra={})=>chrome.runtime.sendMessage({action,...extra}).then(response=>{if(response?.error)throw new Error(response.error);return response?.result;});
  let loginAttempt=null;
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id)return;
    const execute=async()=>{
      if(message.command==='login') {loginAttempt ||= globalThis.LeadRadarLogin.login(message.phone).finally(()=>{loginAttempt=null;});return await loginAttempt;}
      if(message.command==='login-status')return {...await globalThis.LeadRadarLogin.status({inspect:message.inspect===true,waitReady:message.waitReady===true}),source,version:chrome.runtime.getManifest().version};
      if(message.command==='contact-ready')return {ready:Boolean(reader.detail()),url:location.href};
      if(message.command==='reveal-contact')return await revealAndSave(message);
      if(message.command==='search'){await reader.ready('search',20000);return {search:reader.search()};}
      if(message.command==='detail'){await reader.ready('detail');return {ad:reader.detail(message.context||{})};}
      throw new Error('دستور نامعتبر است.');
    };
    execute().then(respond).catch(error=>respond({error:error.message}));return true;
  });
  function visiblePhone() {
    const phones=reader.contactPhones();
    if(phones.length!==1)throw new Error(phones.length?'چند شماره نمایان است؛ برای جلوگیری از ثبت اشتباه چیزی ثبت نشد.':'ابتدا خودت بخش اطلاعات تماسِ همین آگهی را در سایت باز کن.');return phones[0];
  }
  async function revealAndSave({basis,confirmed,expectedUrl}) {
    if(confirmed!==true||!['direct-consent','public-business'].includes(basis))throw new Error('تأیید و مبنای ثبت تماس همین آگهی لازم است.');
    const ad=reader.detail();if(!ad)throw new Error('آگهی هنوز آماده نیست؛ پس از بارگذاری دوباره تلاش کن.');if(ad.url!==expectedUrl)throw new Error('برگه با آگهی انتخاب‌شده تطابق ندارد.');
    await send('contact-permit',{payload:{source,url:ad.url,basis,confirmed:true}});
    await reader.revealContact({basis,confirmed:true,expectedUrl:ad.url});
    const phone=visiblePhone();await send('contact',{payload:{source,ad,phone,basis,confirmed:true,contactSource:'visible-after-selected-reveal'}});
    return {saved:true,source,url:ad.url};
  }
  const host=document.createElement('div');host.id='lead-radar-extension';host.style.cssText='position:fixed!important;left:18px!important;bottom:18px!important;z-index:2147483647!important;direction:rtl!important';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>*{box-sizing:border-box}.box{width:258px;background:#102131;color:#eaf7f6;border:1px solid #4e7480;border-radius:15px;box-shadow:0 12px 38px #0008;padding:13px;font:12px/1.7 Tahoma,Arial;direction:rtl}.top{display:flex;justify-content:space-between;color:#7de2c4;font-weight:bold}.body p{color:#acc2cd;margin:8px 0;font-size:11px}button{width:100%;border:0;border-radius:8px;background:#55d7af;color:#09211e;font:bold 12px Tahoma;padding:9px;margin:3px 0;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button.secondary{background:#2a4557;color:#eaf7f6}button.small{width:auto;background:none;color:#a4c0ca;padding:0}input[type=number]{width:100%;background:#1a3749;color:#fff;border:1px solid #476575;padding:7px;border-radius:6px}.status{color:#b9cbd2;white-space:pre-wrap;font-size:11px}.error{color:#ffa3aa!important}details{margin-top:8px}summary{cursor:pointer;color:#b9cbd2}button[hidden],div[hidden]{display:none!important}</style><div class="box"><div class="top">◉ رادار لید ${chrome.runtime.getManifest().version}<button class="small" id="min">−</button></div><div class="body"><p id="mode"></p><div id="batch"><button id="extract">جمع‌آوری جزئیات نتایج</button><details><summary>تعداد آگهی</summary><input aria-label="تعداد آگهی" id="limit" type="number" min="1" max="20" value="20"></details></div><div id="contact"><p>تماس همین آگهی — دکمه را فقط با مبنای واقعی آن بزن:</p><button id="phone">تماس عمومیِ کسب‌وکار است؛ ثبت کن</button><button class="secondary" id="consented-phone">رضایت مستقیم دارم؛ ثبت کن</button></div><button class="secondary" id="resume">حل کردم؛ ادامهٔ صف</button><button class="secondary" id="stop">توقف صف</button><button class="secondary" id="dashboard">پنل و اکسل</button><details><summary>ابزارهای بیشتر</summary><button id="capture" class="secondary">ثبت جزئیات همین صفحه</button><button class="secondary" id="settings">تنظیم اتصال</button></details><div id="progress" role="status"></div><div class="status" id="status"></div></div></div>`;
  document.body.append(host);
  const find=id=>root.querySelector(id);const status=(msg,error=false)=>{find('#status').textContent=msg;find('#status').classList.toggle('error',error);};
  const action=(id,fn)=>find(id).addEventListener('click',async event=>{find(id).disabled=true;try{await fn(event);}catch(error){status(error.message,true);}finally{find(id).disabled=false;}});
  action('#extract',async()=>{status('در حال خواندن نتایج…');await reader.ready('search');const job=await send('start-run',{search:reader.search(),limit:Number(find('#limit').value)});status(`استخراج ${job.total} آگهی شروع شد؛ برگه‌های سایت را باز نگه دار.`);});
  action('#capture',async()=>{const detail=location.pathname.startsWith('/v/');await reader.ready(detail?'detail':'search');const result=await send('capture',{payload:{source,mode:detail?'detail':'search',items:detail?[reader.detail()]:reader.search().items}});status(`${result.saved} تازه؛ ${result.duplicate} تکراری به‌روز شد.`);});
  for(const [id,basis] of [['#phone','public-business'],['#consented-phone','direct-consent']])action(id,async event=>{if(!event.isTrusted)throw new Error('نمایش تماس فقط با کلیک خودت انجام می‌شود.');const ad=reader.detail();if(!ad)throw new Error('آگهی هنوز آماده نیست.');find('#phone').disabled=true;find('#consented-phone').disabled=true;try{status('در حال نمایش و ذخیرهٔ تماس…');await revealAndSave({basis,confirmed:true,expectedUrl:ad.url});status('شمارهٔ همین آگهی در پنل متصل ذخیره شد.');}finally{find('#phone').disabled=false;find('#consented-phone').disabled=false;}});
  for(const id of ['settings','dashboard','stop','resume'])action('#'+id,async()=>{await send(id==='settings'?'options':id);});
  find('#min').onclick=()=>{find('.body').hidden=!find('.body').hidden;find('#min').textContent=find('.body').hidden?'+':'−';};
  function mode(){const detail=location.pathname.startsWith('/v/');const search=location.pathname.startsWith('/s/');find('#batch').hidden=!search;find('#capture').hidden=!detail&&!search;find('#contact').hidden=!detail;find('#mode').textContent=search?'صف جزئیات؛ شماره‌ها خودکار در این صف گرفته نمی‌شوند.':detail?'دکمهٔ زیر، تماس سایت را باز و شمارهٔ نمایان را ذخیره می‌کند.':'ورود از آیکون افزونه؛ کد فقط در سایت اصلی.';status('');}
  function progress(job){find('#progress').textContent=job?`${job.topic} · ${job.processed}/${job.total} · ${job.message}`:'';find('#resume').hidden=job?.status!=='paused';find('#stop').hidden=!job||!['running','paused'].includes(job.status);}
  chrome.storage.local.get('captureJob').then(data=>progress(data.captureJob));chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.captureJob)progress(changes.captureJob.newValue);});
  const ready=()=>setTimeout(()=>send('ready').catch(error=>status(error.message,true)),1000);
  mode();ready();let lastUrl=location.href;setInterval(()=>{if(lastUrl!==location.href){lastUrl=location.href;mode();ready();}},1000);
})();

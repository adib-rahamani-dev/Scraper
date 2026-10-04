(() => {
  const panel=document.createElement('section');panel.style.cssText='border:1px solid #466474;border-radius:9px;padding:10px;margin:12px 0;font:12px/1.8 Tahoma;color:#c0d2da';
  const status=document.createElement('div');status.setAttribute('role','status');status.textContent='در حال بررسی نسخهٔ افزونه…';
  const link=document.createElement('a');link.textContent='دانلود نسخهٔ جدید';link.target='_blank';link.rel='noreferrer';link.style.cssText='color:#71e1bd;display:none';
  const button=document.createElement('button');button.type='button';button.textContent='بررسی به‌روزرسانی';
  panel.append(status,link,button);(document.querySelector('header')||document.querySelector('h1')).after(panel);
  const valid=info=>info&&/^\d+(?:\.\d+){1,3}$/.test(info.version)&&/^[a-f0-9]{64}$/.test(info.build);
  const check=async()=>{
    button.disabled=true;link.style.display='none';
    try{
      const {leadRadarEndpoint}=await chrome.storage.local.get('leadRadarEndpoint');
      const endpoint=leadRadarEndpoint==='http://127.0.0.1:4300'?leadRadarEndpoint:'https://lead-radar-jade.vercel.app';
      const read=async(url)=>{const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('نسخه قابل بررسی نیست.');return response.json();};
      const [installed,latest]=await Promise.all([read(chrome.runtime.getURL('build-info.json')),read(endpoint+'/lead-radar-extension.json')]);
      if(!valid(installed)||!valid(latest))throw new Error('اطلاعات نسخه نامعتبر است.');
      if(installed.build===latest.build){status.textContent=`نسخهٔ ${installed.version} به‌روز است.`;return;}
      status.textContent=`بستهٔ ${latest.version} موجود است؛ پس از پایان اجرا، فایل‌ها را در همان پوشه جایگزین و افزونه را Reload کن. سپس برگه‌ها را تازه کن.`;
      link.href=endpoint+'/lead-radar-extension.zip?build='+latest.build;link.style.display='block';
    }catch(error){status.textContent='بررسی به‌روزرسانی انجام نشد؛ '+(error.message||'اتصال را بررسی کن.');}
    finally{button.disabled=false;}
  };
  button.addEventListener('click',()=>void check());void check();
})();

import {useState} from 'react';
import {Download,FileSpreadsheet} from 'lucide-react';

export default function CombinedExportControl(){
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  async function download(){setBusy(true);setMessage('');try{
    const response=await fetch('/api/export/all.xlsx');
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'دریافت خروجی کلی ممکن نشد.');}
    if(!response.headers.get('content-type')?.includes('spreadsheetml'))throw new Error('پاسخ، فایل اکسل معتبر نیست.');
    const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='lead-radar-all.xlsx';document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    setMessage('فایل اکسل کلی آمادهٔ دانلود شد.');
  }catch(error){setMessage(error instanceof Error?error.message:'خروجی ساخته نشد.');}finally{setBusy(false);}}
  return <section className="panel combined-export"><div><strong><FileSpreadsheet size={18}/> اکسل کلی تمام بانک‌ها</strong><p>منابع عمومی + دیوار و شیپور؛ بدون فیلتر پویش یا وضعیت. شمارهٔ ثبت‌نشده خالی می‌ماند. در Vercel فقط داده‌های ذخیره‌شده در همان پنل ابری صادر می‌شوند.</p>{message&&<p role="status">{message}</p>}</div><button className="primary-button" disabled={busy} onClick={()=>void download()}><Download size={18}/>{busy?'در حال ساخت اکسل کلی…':'دریافت اکسل کلی'}</button></section>;
}

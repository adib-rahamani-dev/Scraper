import ExcelJS from 'exceljs';
import { safeJson } from '../shared/capture-data.js';

export type ExportAd = { title:string;url:string;source:string;topic:string;city:string;region:string;price:string;description:string;phone:string|null;status:string;note:string;saved_at:string;category?:string;attributes?:string;images?:string;published_at?:string;search_url?:string;origin?:string };
export async function adsWorkbook(ads: ExportAd[], title='آگهی‌ها'):Promise<Buffer> {
  const book=new ExcelJS.Workbook();book.creator='Lead Radar';book.created=new Date();
  const sheet=book.addWorksheet('آگهی‌ها',{views:[{state:'frozen',ySplit:1,rightToLeft:true}]});
  const fields:[keyof ExportAd,string,number][]=[['title','عنوان',40],['source','سایت',12],['topic','موضوع جست‌وجو',22],['city','شهر',16],['region','منطقه',20],['category','دسته‌بندی',32],['price','قیمت نمایان',25],['description','توضیحات کامل',65],['attributes','مشخصات آگهی',50],['phone','شمارهٔ ثبت‌شده',19],['url','لینک آگهی',45],['search_url','لینک جست‌وجو',45],['published_at','زمان و محل انتشار',30],['images','لینک تصاویر',45],['status','وضعیت پیگیری',16],['note','یادداشت',35],['saved_at','تاریخ ثبت',22]];
  if(ads.some(ad=>ad.origin))fields.push(['origin','بانک مبدأ',30]);
  sheet.columns=fields.map(([key,header,width])=>({key,header,width}));
  for(const ad of ads) {
    const attributes=safeJson(ad.attributes || '[]').map(v=>{const a=v as {label:string;value:string};return `${a.label}: ${a.value}`;}).join('\n');
    const sourceNames:Record<string,string>={divar:'دیوار',sheypoor:'شیپور','iran-tejarat':'ایران تجارت',niyazban:'نیازبان'};
    const row=sheet.addRow({...ad,source:sourceNames[ad.source]||ad.source,attributes,images:safeJson(ad.images||'[]').join('\n'),saved_at:new Date(ad.saved_at)});
    row.alignment={vertical:'top',wrapText:true};row.height=ads.length>100?44:70;row.font={name:'Tahoma',size:10};
    row.getCell('phone').numFmt='@';row.getCell('saved_at').numFmt='yyyy-mm-dd hh:mm';
    row.getCell('url').value={text:ad.url,hyperlink:ad.url};row.getCell('url').font={color:{argb:'FF156B8A'},underline:true,name:'Tahoma',size:10};
  }
  const header=sheet.getRow(1);header.font={name:'Tahoma',bold:true,color:{argb:'FFFFFFFF'},size:11};header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF12384A'}};header.height=30;header.alignment={vertical:'middle',wrapText:true};
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,ads.length+1),column:fields.length}};
  book.title=title;return Buffer.from(await book.xlsx.writeBuffer());
}

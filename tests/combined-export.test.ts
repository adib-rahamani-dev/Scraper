import {expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import {combineExportAds,companionExportAds} from '../src/server/combined-export.js';
import {adsWorkbook,type ExportAd} from '../src/server/excel-export.js';
const ad:ExportAd={title:'fixture',source:'divar',url:'https://divar.ir/v/fixture/1',topic:'کیف',city:'',region:'',price:'',description:'',phone:null,status:'new',note:'',saved_at:'2026-10-01T10:00:00Z'};
it('supports old companions without truncating a combined export',async()=>{
  const fake=(count:number)=>(async(input:unknown)=>String(input).endsWith('/export-records')?new Response('<html>',{headers:{'content-type':'text/html'}}):Response.json(String(input).endsWith('/state')?{count}:{listings:[ad]})) as typeof fetch;
  expect(await companionExportAds(fake(1))).toEqual([ad]);await expect(companionExportAds(fake(5001))).rejects.toThrow('ناقص');
});
it('combines banks, retains richer metadata, suppresses empty-phone duplicates and preserves conflicting real contacts',()=>{
  const rows=combineExportAds([{origin:'عمومی',ads:[{...ad,phone:'09123456789'}]},{origin:'محلی',ads:[{...ad,description:'full details'},{...ad,phone:'09123456789'},{...ad,phone:'09123456001'}]}]);
  expect(rows).toHaveLength(2);expect(rows.map(row=>row.phone)).toEqual(['09123456789','09123456001']);expect(rows.every(row=>row.description==='full details')).toBe(true);expect(rows[0]!.origin).toBe('عمومی · محلی');expect(ad.phone).toBeNull();
});
it('exports all banks in one worksheet with source-bank labels and blank unregistered contacts',async()=>{
  const rows=combineExportAds([{origin:'عمومی',ads:[{...ad,phone:'09123456789'}]},{origin:'محلی',ads:[{...ad,url:'https://www.sheypoor.com/v/fixture-1.html',source:'sheypoor'}]}]);const bytes=await adsWorkbook(rows);const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);expect(book.worksheets).toHaveLength(1);const sheet=book.worksheets[0]!;expect(sheet.rowCount).toBe(3);expect(sheet.getCell('J2').value).toBe('09123456789');expect(sheet.getCell('J3').value).toBeNull();expect(sheet.getCell('R1').value).toBe('بانک مبدأ');expect(sheet.getCell('R3').value).toBe('محلی');
});

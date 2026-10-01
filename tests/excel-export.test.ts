import {expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import {adsWorkbook} from '../src/server/excel-export.js';
it('exports a real RTL XLSX preserving phone zeros, full details, and literal formula-looking text',async()=>{
  const bytes=await adsWorkbook([{title:'=HYPERLINK("bad")',source:'divar',url:'https://divar.ir/v/example/123',topic:'موبایل',city:'قزوین',region:'فضیلت',price:'۱۲ میلیون تومان',description:'خط اول\nخط دوم',phone:'09123456789',attributes:JSON.stringify([{label:'رم',value:'8 GB'}]),status:'new',note:'',saved_at:'2026-10-01T10:00:00Z'}]);
  expect(bytes.subarray(0,2).toString()).toBe('PK');
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet=book.worksheets[0]!;expect(sheet.rowCount).toBe(2);expect(sheet.views[0]?.rightToLeft).toBe(true);
  expect(sheet.getCell('A2').value).toBe('=HYPERLINK("bad")');expect(sheet.getCell('J2').value).toBe('09123456789');expect(sheet.getCell('J2').numFmt).toBe('@');
  expect(sheet.getCell('H2').value).toBe('خط اول\nخط دوم');expect(sheet.getCell('I2').value).toContain('رم: 8 GB');
  expect(sheet.getCell('K2').value).toMatchObject({hyperlink:'https://divar.ir/v/example/123'});
});

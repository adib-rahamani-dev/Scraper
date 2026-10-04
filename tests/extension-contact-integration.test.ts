import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'radar-contact-contract-')), 'test.db');
const { saveCapturedContact, listCapturedAds } = await import('../src/server/cloud-capture.js');
const { adsWorkbook } = await import('../src/server/excel-export.js');
const { default: ExcelJS } = await import('exceljs');
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
afterAll(async () => { await browser?.close(); });

it.each(['divar', 'sheypoor'] as const)('saves a selected %s business contact through the actual content-script/backend contract', async source => {
  const url = source === 'divar' ? 'https://divar.ir/v/fixture-business/1' : 'https://www.sheypoor.com/v/fixture-business-2.html';
  const phone = source === 'divar' ? '09123456780' : '09123456781';
  const page = await browser.newPage();
  const sent: Array<{ action: string; payload?: any }> = [];
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<main><h1>فروشگاه نمونهٔ آزمون</h1><button id="contact">${source === 'divar' ? 'اطلاعات تماس' : 'تماس با فروشنده'}</button><div id="row"></div></main>` }));
  await page.goto(url);
  await page.exposeFunction('testBackend', async (message: any) => {
    sent.push(message);
    if (message.action === 'contact') {
      // Real validation and persistence, rather than a mock that always says "saved".
      const ad = saveCapturedContact(message.payload.source, message.payload);
      return { result: { saved: true, id: ad.id } };
    }
    return { result: {} };
  });
  await page.evaluate(value => {
    const g = globalThis as any;
    const doc = g.document;
    doc.querySelector('#contact')!.addEventListener('click', () => {
      g.clicks = (g.clicks || 0) + 1;
      doc.querySelector('#row')!.innerHTML = `<span>شماره موبایل</span><b>${value}</b>`;
    });
    const attach = g.Element.prototype.attachShadow;
    g.Element.prototype.attachShadow = function (options: unknown) { const root = attach.call(this, options); g.testRadarRoot = root; return root; };
    g.chrome = {
      runtime: { id: 'fixture', getManifest: () => ({ version: '2.9.1' }), onMessage: { addListener: (fn: unknown) => { g.testCommand = fn; } }, sendMessage: (message: unknown) => g.testBackend(message) },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => {} } },
    };
  }, phone);
  await page.evaluate(readFileSync('extension/page-reader.js', 'utf8'));
  await page.evaluate(readFileSync('extension/content.js', 'utf8'));
  expect(await page.evaluate(() => (globalThis as any).testRadarRoot.querySelectorAll('select,input[type=checkbox]').length)).toBe(0);
  const result = await page.evaluate(expectedUrl => new Promise<any>(resolve => {
    (globalThis as any).testCommand({ command: 'reveal-contact', basis: 'public-business', confirmed: true, expectedUrl }, { id: 'fixture' }, resolve);
  }), url);
  expect(result).toMatchObject({ saved: true, url, source });
  expect(await page.evaluate(() => (globalThis as any).clicks)).toBe(1);
  expect(sent.filter(message => message.action === 'contact')).toHaveLength(1);
  const saved = listCapturedAds().find(ad => ad.url === url)!;
  expect(saved).toMatchObject({ phone, contact_source: 'visible-after-selected-reveal', contact_basis: 'public-business' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await adsWorkbook([saved]) as any);
  const row = workbook.worksheets[0]!.getRow(2);
  expect((row.values as unknown[]).includes(phone)).toBe(true);
  await page.close();
});

it('still rejects unknown contact origins and missing explicit selected-ad confirmation', () => {
  const input = { ad: { title: 'فروشگاه نمونه', url: 'https://divar.ir/v/fixture-business/1' }, phone: '09123456780', basis: 'public-business', confirmed: true, contactSource: 'visible-after-selected-reveal' };
  expect(() => saveCapturedContact('divar', { ...input, confirmed: false })).toThrow();
  expect(() => saveCapturedContact('divar', { ...input, contactSource: 'hidden-api' })).toThrow();
});

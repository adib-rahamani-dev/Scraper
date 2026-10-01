import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'lead-radar-capture-')), 'test.db');
const { capturedCsv, importCapturedAds, issueExtensionToken, listCapturedAds, revokeExtensionTokens, saveCapturedBatch, saveCapturedContact, validExtensionToken } = await import('../src/server/cloud-capture.js');
const { dashboard,db } = await import('../src/server/db.js');
const {createCaptureRun,updateCaptureRun}=await import('../src/shared/capture-data.js');

const ad = { source: 'divar', title: 'گوشی تست', url: 'https://divar.ir/v/sample-ad/test', topic: 'موبایل', city: 'قزوین', region: '', price: '۱۲ میلیون تومان', description: 'تماس ۰۹۱۲۳۴۵۶۷۸۹' };

describe('cloud capture', () => {
  it('keeps search-specific snapshots for an ad reused across two runs',()=>{
    const first=createCaptureRun(db,'captured_ads','divar',{searchUrl:'https://divar.ir/s/qazvin?q=mobile',topic:'موبایل',total:1});
    const second=createCaptureRun(db,'captured_ads','divar',{searchUrl:'https://divar.ir/s/qazvin?q=samsung',topic:'سامسونگ',total:1});
    const item={...ad,url:'https://divar.ir/v/run-specific/789',description:'نسخهٔ اول',attributes:[{label:'حافظه',value:'256 GB'}]};
    expect(saveCapturedBatch('divar',[item],'detail',first.id).saved).toBe(1);
    expect(saveCapturedBatch('divar',[{...item,topic:'سامسونگ',description:'نسخهٔ دوم'}],'detail',second.id).duplicate).toBe(1);
    expect(listCapturedAds({runId:first.id})[0]).toMatchObject({topic:'موبایل',description:'نسخهٔ اول'});
    expect(listCapturedAds({runId:second.id})[0]).toMatchObject({topic:'سامسونگ',description:'نسخهٔ دوم'});
    expect(listCapturedAds().filter(a=>a.url===item.url)).toHaveLength(1);
    updateCaptureRun(db,'captured_ads',first.id,{processed:1,status:'completed'});
    expect(()=>updateCaptureRun(db,'captured_ads',first.id,{processed:0})).toThrow();
    db.prepare('DELETE FROM captured_ads_members WHERE run_id IN (?,?)').run(first.id,second.id);
    db.prepare('DELETE FROM captured_ads_runs WHERE id IN (?,?)').run(first.id,second.id);
    db.prepare('DELETE FROM captured_ads WHERE url=?').run(item.url);
  });
  it('deduplicates detail URLs and redacts phone-looking text from metadata', () => {
    expect(saveCapturedBatch('divar', [ad], 'search').saved).toBe(1);
    expect(saveCapturedBatch('divar', [ad], 'search').duplicate).toBe(1);
    expect(listCapturedAds()[0]?.description).not.toContain('09123456789');
    expect(dashboard().stats.totalLeads).toBe(1);
    expect(() => saveCapturedBatch('sheypoor', [ad], 'search')).toThrow();
  });
  it('requires manual confirmation and a valid contact basis', () => {
    const input = { source: 'divar', ad, phone: '۰۹۱۲۳۴۵۶۷۸۹', basis: 'public-business', contactSource: 'visible-after-manual-reveal', confirmed: true };
    expect(() => saveCapturedContact('divar', { ...input, confirmed: false })).toThrow();
    expect(() => saveCapturedContact('divar', { ...input, basis: '' })).toThrow();
    expect(saveCapturedContact('divar', input).phone).toBe('09123456789');
    expect(dashboard().stats.uniquePhones).toBe(1);
    expect(capturedCsv(listCapturedAds())).toContain('09123456789');
  });
  it('issues revocable tokens and never exposes token hashes in status', () => {
    const first = issueExtensionToken();
    expect(validExtensionToken(`Bearer ${first.token}`)).toBe(true);
    issueExtensionToken();
    expect(validExtensionToken(`Bearer ${first.token}`)).toBe(false);
    revokeExtensionTokens();
  });
  it('imports explicitly selected local records without duplicate URLs', () => {
    const local = { ...ad, url: 'https://divar.ir/v/local-import/456', phone: null, contact_basis: '', note: 'پیگیری بعدی', status: 'reviewing' };
    expect(importCapturedAds([local]).saved).toBe(1);
    expect(importCapturedAds([local]).duplicate).toBe(1);
    expect(listCapturedAds().find(item => item.url === local.url)?.note).toBe('پیگیری بعدی');
  });
});

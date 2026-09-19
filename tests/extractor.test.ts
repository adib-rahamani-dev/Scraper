import { describe, expect, it } from 'vitest';
import { extractPage, extractPhones, normalizeIranianPhone, scoreLead, toEnglishDigits } from '../src/server/extractor.js';

describe('phone normalization', () => {
  it('converts Persian and Arabic digits', () => {
    expect(toEnglishDigits('۰۹۱۲ ٣٤٥ ۶۷۸۹')).toBe('0912 345 6789');
  });

  it('normalizes Iranian mobile formats', () => {
    expect(normalizeIranianPhone('+98 912 345 6789')).toBe('09123456789');
    expect(normalizeIranianPhone('0098-933-111-2233')).toBe('09331112233');
    expect(normalizeIranianPhone('0912-345-6789')).toBe('09123456789');
  });

  it('extracts unique public phone numbers and ignores invalid ones', () => {
    expect(extractPhones('تماس ۰۹۱۲ ۳۴۵ ۶۷۸۹ یا 021-88776655. تکرار: 09123456789')).toEqual([
      '09123456789', '02188776655',
    ]);
    expect(extractPhones('کد 12345 و شماره ناقص 0912')).toEqual([]);
  });
});

describe('page extraction', () => {
  it('extracts metadata, tel links and same-page signals', () => {
    const page = extractPage(`
      <html><head><meta property="og:title" content="شرکت تولیدی نمونه" />
      <meta name="description" content="فروش مستقیم تجهیزات صنعتی با ضمانت" /></head>
      <body><div class="city">تهران</div><a href="tel:+989121234567">تماس</a>
      <a href="/ad/42">جزئیات</a></body></html>
    `, new URL('https://example.com/list'));
    expect(page.title).toBe('شرکت تولیدی نمونه');
    expect(page.phones).toContain('09121234567');
    expect(page.city).toBe('تهران');
    expect(page.links[0]?.toString()).toBe('https://example.com/ad/42');
    expect(page.isBusiness).toBe(true);
    expect(scoreLead(page, ['تجهیزات'], 'تهران')).toBeGreaterThanOrEqual(70);
  });

  it('keeps Iran Tejarat result-card phones attached to their listing', () => {
    const page = extractPage(`
      <html><head><title>موبایل</title></head><body>
        <div class="SKNM RW"><div class="TitleAdsK"><a href="/Ads1602/Sch3012327/موبایل.html">خرید ضایعات موبایل</a></div><span>تماس: 0912 345 6789</span></div>
        <div class="SKNS RW"><div class="TitleAdsK"><a href="/Ads2114/Sch14779208/موبایل.html">فروش عمده گوشی</a></div><span>0935-111-2233</span></div>
      </body></html>
    `, new URL('https://iran-tejarat.com/k-موبایل.html'));
    expect(page.leadCandidates).toHaveLength(2);
    expect(page.leadCandidates[0]).toMatchObject({ title: 'خرید ضایعات موبایل', phones: ['09123456789'] });
    expect(page.leadCandidates[1]?.url.pathname).toContain('/Ads2114/Sch14779208/');
  });
});

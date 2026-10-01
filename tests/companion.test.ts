import { describe, expect, it } from 'vitest';
import { contactCandidates, csvCell, detailUrl, parseSource, redactPossiblePhones, searchPageContext, searchUrl } from '../src/companion/policy.js';

describe('local companion safety boundaries', () => {
  it('accepts only selected sources', () => {
    expect(parseSource('divar')).toBe('divar');
    expect(parseSource('sheypoor')).toBe('sheypoor');
    expect(() => parseSource('other')).toThrow();
  });
  it('requires an official detail page URL', () => {
    expect(detailUrl('divar', 'https://divar.ir/v/example/ABC?foo=1#part')).toBe('https://divar.ir/v/example/ABC');
    expect(detailUrl('sheypoor', 'https://www.sheypoor.com/v/example-123.html')).toBe('https://www.sheypoor.com/v/example-123.html');
    expect(detailUrl('divar', 'https://divar.ir/s/tehran?q=test')).toBeNull();
    expect(detailUrl('divar', 'https://divar.ir.evil.test/v/example')).toBeNull();
    expect(detailUrl('divar', 'http://divar.ir/v/example')).toBeNull();
    expect(detailUrl('divar', 'https://sheypoor.com/v/example')).toBeNull();
  });
  it('builds a visible search destination', () => {
    expect(searchUrl('divar', 'کابینت', 'تهران')).toContain('/s/tehran?q=');
    expect(searchUrl('sheypoor', 'طراحی سایت', 'مشهد')).toContain('/s/mashhad?q=');
  });
  it('quotes spreadsheet cells and prevents formula evaluation', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('normal,"text"')).toBe('"normal,""text"""');
  });
  it('recognizes filtered search pages without accepting another host', () => {
    const url = 'https://divar.ir/s/qazvin/mobile-phones?q=%D9%85%D9%88%D8%A8%D8%A7%DB%8C%D9%84';
    expect(searchPageContext('divar', url)).toEqual({ topic: 'موبایل', city: 'قزوین' });
    expect(searchPageContext('divar', 'https://evil.example/s/qazvin')).toBeNull();
    expect(searchPageContext('divar', 'https://divar.ir/v/example/token')).toBeNull();
  });
  it('does not keep phone-looking text in extracted descriptions', () => {
    expect(redactPossiblePhones('تماس ۰۹۱۲۳۴۵۶۷۸۹')).not.toContain('09123456789');
    expect(redactPossiblePhones('قیمت ۱۲,۰۰۰,۰۰۰ تومان')).toContain('12,000,000');
  });
  it('normalizes and deduplicates only recognizable contact numbers', () => {
    expect(contactCandidates(['شماره ۰۹۱۲۳۴۵۶۷۸۹', 'tel:+989123456789', 'قیمت ۱۲۰,۰۰۰,۰۰۰ تومان'])).toEqual(['09123456789']);
  });
});

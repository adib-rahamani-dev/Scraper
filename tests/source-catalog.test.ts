import { describe, expect, it } from 'vitest';
import { buildSourceSearchUrl, normalizeCity, normalizeTopic, sourceCatalog } from '../src/server/source-catalog.js';

describe('Iranian source catalog', () => {
  it('ships four verified built-in sources', () => {
    expect(sourceCatalog.map((source) => source.id)).toEqual(['divar', 'sheypoor', 'iran-tejarat', 'niyazban']);
  });

  it('builds the verified search routes', () => {
    expect(buildSourceSearchUrl('divar', 'کابینت', 'تهران')).toContain('/s/tehran?q=');
    expect(buildSourceSearchUrl('sheypoor', 'کابینت', 'مشهد')).toContain('/s/mashhad?q=');
    expect(buildSourceSearchUrl('iran-tejarat', 'دستگاه صنعتی')).toContain('/k-');
    expect(buildSourceSearchUrl('niyazban', 'طراحی سایت')).toContain('/search?q=');
  });

  it('keeps the one-field workflow safe and predictable', () => {
    expect(normalizeTopic('  طراحی   سایت ')).toBe('طراحی سایت');
    expect(normalizeCity('شهر ناشناخته')).toBe('کل ایران');
    expect(() => normalizeTopic('')).toThrow();
  });
});

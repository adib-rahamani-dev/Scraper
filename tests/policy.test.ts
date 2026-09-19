import { describe, expect, it } from 'vitest';
import { isSafeCrawlPath, isSameSite, validatePublicUrl } from '../src/server/policy.js';

describe('crawl URL policy', () => {
  it('accepts normal public HTTP(S) targets', () => {
    expect(validatePublicUrl('https://divar.ir/s/tehran').hostname).toBe('divar.ir');
    expect(validatePublicUrl('http://example.com/list#top').hash).toBe('');
  });

  it('blocks local/private targets and credential URLs', () => {
    for (const value of ['http://localhost/a', 'http://127.0.0.1/a', 'http://192.168.1.4/a', 'ftp://example.com/a', 'https://user:pass@example.com']) {
      expect(() => validatePublicUrl(value)).toThrow();
    }
  });

  it('keeps traversal on the same site and away from stateful paths', () => {
    expect(isSameSite(new URL('https://www.example.com/a'), new URL('https://example.com/b'))).toBe(true);
    expect(isSameSite(new URL('https://evil.example/a'), new URL('https://example.com/b'))).toBe(false);
    expect(isSafeCrawlPath(new URL('https://example.com/ad/12'))).toBe(true);
    expect(isSafeCrawlPath(new URL('https://example.com/account/delete'))).toBe(false);
  });
});

import { buildSourceSearchUrl, normalizeCity, normalizeTopic } from '../server/source-catalog.js';
import { extractPhones, toEnglishDigits } from '../server/extractor.js';

export type BrowserSource = 'divar' | 'sheypoor';
export const sources: BrowserSource[] = ['divar', 'sheypoor'];
export const homepages: Record<BrowserSource, string> = {
  divar: 'https://divar.ir',
  sheypoor: 'https://www.sheypoor.com',
};

export function parseSource(value: unknown): BrowserSource {
  if (value === 'divar' || value === 'sheypoor') return value;
  throw new Error('منبع نامعتبر است.');
}

export function searchUrl(source: BrowserSource, topic: unknown, city: unknown): string {
  return buildSourceSearchUrl(source, normalizeTopic(topic), normalizeCity(city));
}

export function detailUrl(source: BrowserSource, input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (source === 'divar' && host !== 'divar.ir' && host !== 'www.divar.ir') return null;
    if (source === 'sheypoor' && host !== 'sheypoor.com' && host !== 'www.sheypoor.com') return null;
    if (!/^\/v\/[^/]+/.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function csvCell(value: unknown): string {
  let text = String(value ?? '').replace(/\u0000/g, '');
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const cityNames: Record<string, string> = {
  tehran: 'تهران', qazvin: 'قزوین', karaj: 'کرج', mashhad: 'مشهد',
  isfahan: 'اصفهان', shiraz: 'شیراز', tabriz: 'تبریز', qom: 'قم',
  rasht: 'رشت', ahvaz: 'اهواز', iran: 'کل ایران',
};

export function searchPageContext(source: BrowserSource, input: string): { topic: string; city: string } | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (source === 'divar' && !['divar.ir', 'www.divar.ir'].includes(host)) return null;
    if (source === 'sheypoor' && !['sheypoor.com', 'www.sheypoor.com'].includes(host)) return null;
    const match = url.pathname.match(/^\/s\/([^/]+)(?:\/|$)/);
    if (!match) return null;
    return { topic: cleanText(url.searchParams.get('q'), 80), city: cityNames[match[1] ?? ''] ?? cleanText(match[1], 80) };
  } catch { return null; }
}

export function redactPossiblePhones(value: string): string {
  return toEnglishDigits(value).replace(/(?:\+98|0098|0)?9\d(?:[\s\-().]*\d){8}|0[1-8]\d(?:[\s\-().]*\d){8}/g, '[شماره حذف شد]');
}

export function contactCandidates(visibleParts: string[]): string[] {
  return [...new Set(visibleParts.flatMap(part => extractPhones(part)))];
}

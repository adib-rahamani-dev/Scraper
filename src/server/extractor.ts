import * as cheerio from 'cheerio';

const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

export function toEnglishDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (digit) => {
    const p = persianDigits.indexOf(digit);
    return String(p >= 0 ? p : arabicDigits.indexOf(digit));
  });
}

export function normalizeIranianPhone(raw: string): string | null {
  let digits = toEnglishDigits(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+98')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0098')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('98') && digits.length >= 12) digits = `0${digits.slice(2)}`;
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^0(?:[1-8]\d)\d{8}$/.test(digits)) return digits;
  return null;
}

export function extractPhones(text: string): string[] {
  const normalizedText = toEnglishDigits(text);
  const matches = normalizedText.match(/(?:\+98|0098|98|0)?[\s\-().]*9\d(?:[\s\-().]*\d){8}|0[1-8]\d(?:[\s\-().]*\d){8}/g) ?? [];
  return [...new Set(matches.map(normalizeIranianPhone).filter((phone): phone is string => Boolean(phone)))];
}

export type PageData = {
  title: string;
  description: string;
  phones: string[];
  city: string;
  category: string;
  links: URL[];
  isBusiness: boolean;
  leadCandidates: Array<{
    title: string;
    description: string;
    phones: string[];
    city: string;
    category: string;
    url: URL;
    isBusiness: boolean;
  }>;
};

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function extractPage(html: string, pageUrl: URL): PageData {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const title = clean($('meta[property="og:title"]').attr('content')) || clean($('h1').first().text()) || clean($('title').text()) || 'بدون عنوان';
  const description = clean($('meta[property="og:description"]').attr('content')) || clean($('meta[name="description"]').attr('content'));
  const bodyText = clean($('body').text());
  const phoneCandidates = [bodyText];
  $('a[href^="tel:"]').each((_, element) => {
    phoneCandidates.push($(element).attr('href')?.slice(4) ?? '');
  });
  const phones = extractPhones(phoneCandidates.join(' '));
  const city = clean($('[data-city], .city, [class*="location"]').first().text()).slice(0, 80);
  const category = clean($('[data-category], .category, [class*="breadcrumb"] a').last().text()).slice(0, 80);
  const links: URL[] = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const link = new URL(href, pageUrl);
      link.hash = '';
      links.push(link);
    } catch { /* malformed links are ignored */ }
  });
  const businessWords = /(شرکت|فروشگاه|تولید|خدمات|نمایندگی|کارگاه|مجموعه|گروه|صنایع|بازرگانی|مهندس|دفتر)/;
  const leadCandidates: PageData['leadCandidates'] = [];
  $('div.SKNM.RW, div.SKNS.RW').each((_, element) => {
    const card = $(element);
    const anchor = card.find('a[href*="/Sch"]').filter((__, item) => clean($(item).text()).length > 2).first();
    const href = anchor.attr('href');
    const cardTitle = clean(anchor.text());
    const cardText = clean(card.text());
    const cardPhones = extractPhones(cardText);
    if (!href || !cardTitle || !cardPhones.length) return;
    try {
      leadCandidates.push({
        title: cardTitle.slice(0, 240),
        description: cardText.slice(0, 500),
        phones: cardPhones,
        city: clean(card.find('[class*="city"], [class*="City"], [class*="state"], [class*="State"]').first().text()).slice(0, 80),
        category,
        url: new URL(href, pageUrl),
        isBusiness: businessWords.test(cardText),
      });
    } catch { /* malformed listing URLs are ignored */ }
  });
  return { title: title.slice(0, 240), description: description.slice(0, 500), phones, city, category, links, isBusiness: businessWords.test(`${title} ${description} ${bodyText.slice(0, 1500)}`), leadCandidates };
}

export function scoreLead(data: Pick<PageData, 'title' | 'description' | 'city' | 'category' | 'isBusiness'>, keywords: string[], wantedCity: string): number {
  let score = 42;
  if (data.isBusiness) score += 18;
  if (data.description.length > 80) score += 8;
  if (data.category) score += 5;
  if (wantedCity && data.city.includes(wantedCity)) score += 10;
  const haystack = `${data.title} ${data.description}`.toLowerCase();
  score += Math.min(15, keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length * 5);
  return Math.min(100, score);
}

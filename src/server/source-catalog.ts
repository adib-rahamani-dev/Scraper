import type { BuiltInSourceId, SourceCatalogItem } from '../shared/types.js';

export const sourceCatalog: SourceCatalogItem[] = [
  {
    id: 'divar',
    label: 'دیوار',
    description: 'آگهی‌های محلی کالا، خدمات و کسب‌وکار',
    homepage: 'https://divar.ir',
    supportsCity: true,
    access: 'login-may-be-required',
  },
  {
    id: 'sheypoor',
    label: 'شیپور',
    description: 'بازار آگهی‌های شهری و خدمات محلی',
    homepage: 'https://www.sheypoor.com',
    supportsCity: true,
    access: 'login-may-be-required',
  },
  {
    id: 'iran-tejarat',
    label: 'ایران تجارت',
    description: 'آگهی‌های تجاری، صنعتی و خدماتی',
    homepage: 'https://iran-tejarat.com',
    supportsCity: false,
    access: 'public-phone',
  },
  {
    id: 'niyazban',
    label: 'نیازبان',
    description: 'آگهی‌های عمومی و نیازمندی‌های ایران',
    homepage: 'https://niyazban.ir',
    supportsCity: false,
    access: 'login-may-be-required',
  },
];

const citySlugs: Record<string, string> = {
  'کل ایران': 'iran', ایران: 'iran', 'همه شهرها': 'iran',
  تهران: 'tehran', مشهد: 'mashhad', اصفهان: 'isfahan', شیراز: 'shiraz', کرج: 'karaj',
  تبریز: 'tabriz', اهواز: 'ahvaz', قم: 'qom', رشت: 'rasht', ارومیه: 'urmia',
  همدان: 'hamedan', کرمان: 'kerman', یزد: 'yazd', اراک: 'arak', قزوین: 'qazvin',
  ساری: 'sari', بابل: 'babol', آمل: 'amol', اردبیل: 'ardabil', گرگان: 'gorgan',
};

export const campaignCities = Object.keys(citySlugs);

export function normalizeTopic(value: unknown): string {
  const topic = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (topic.length < 2) throw new Error('موضوع باید حداقل ۲ نویسه باشد.');
  if (topic.length > 80) throw new Error('موضوع نباید بیشتر از ۸۰ نویسه باشد.');
  return topic;
}

export function normalizeCity(value: unknown): string {
  const city = String(value ?? 'کل ایران').replace(/\s+/g, ' ').trim() || 'کل ایران';
  return citySlugs[city] ? city : 'کل ایران';
}

export function buildSourceSearchUrl(source: BuiltInSourceId, topic: string, city = 'کل ایران'): string {
  const cleanTopic = normalizeTopic(topic);
  const citySlug = citySlugs[normalizeCity(city)] ?? 'iran';
  const query = encodeURIComponent(cleanTopic);

  switch (source) {
    case 'divar': return `https://divar.ir/s/${citySlug}?q=${query}`;
    case 'sheypoor': return `https://www.sheypoor.com/s/${citySlug}?q=${query}`;
    case 'iran-tejarat': return `https://iran-tejarat.com/k-${encodeURIComponent(cleanTopic.replace(/\s+/g, '-'))}.html`;
    case 'niyazban': return `https://niyazban.ir/search?q=${query}`;
  }
}

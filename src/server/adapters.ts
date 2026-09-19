import type { SourceId } from '../shared/types.js';

export type SourceAdapter = {
  id: Exclude<SourceId, 'auto'>;
  label: string;
  matches: (url: URL) => boolean;
  isLikelyDetail: (url: URL) => boolean;
  shouldFollow: (url: URL) => boolean;
};

const adapters: SourceAdapter[] = [
  {
    id: 'divar', label: 'دیوار',
    matches: (url) => /(^|\.)divar\.ir$/i.test(url.hostname),
    isLikelyDetail: (url) => /\/v\//.test(url.pathname),
    shouldFollow: (url) => /\/s\/|\/v\//.test(url.pathname),
  },
  {
    id: 'sheypoor', label: 'شیپور',
    matches: (url) => /(^|\.)sheypoor\.com$/i.test(url.hostname),
    isLikelyDetail: (url) => /\/v\//.test(url.pathname),
    shouldFollow: (url) => /\/s\/|\/v\//.test(url.pathname),
  },
  {
    id: 'iran-tejarat', label: 'ایران تجارت',
    matches: (url) => /(^|\.)irantejarat\.com$/i.test(url.hostname),
    isLikelyDetail: (url) => /\/Ads\d+\/Sch\d+\//i.test(url.pathname),
    shouldFollow: (url) => /\/Ads\d+\/Sch\d+\//i.test(url.pathname) || /^\/k-[^/]+(?:\.html|\/k-\d+\.html)$/i.test(url.pathname),
  },
  {
    id: 'niyazban', label: 'نیازبان',
    matches: (url) => /(^|\.)niyazban\.ir$/i.test(url.hostname),
    isLikelyDetail: (url) => /\/v\//.test(url.pathname),
    shouldFollow: (url) => /\/search|\/c\/|\/v\//.test(url.pathname),
  },
  {
    id: 'niaz', label: 'نیاز',
    matches: (url) => /(^|\.)(?:niaz|niyaz)[\w-]*\.(?:ir|com)$/i.test(url.hostname),
    isLikelyDetail: (url) => /(?:ad|ads|agahi|advert|listing|\d{3,})/i.test(url.pathname + url.search),
    shouldFollow: (url) => !/\.(?:jpg|jpeg|png|gif|webp|pdf|zip)$/i.test(url.pathname),
  },
  {
    id: 'generic', label: 'سایت عمومی',
    matches: () => true,
    isLikelyDetail: () => true,
    shouldFollow: (url) => !/\.(?:jpg|jpeg|png|gif|webp|pdf|zip|mp4|mp3)$/i.test(url.pathname),
  },
];

export function resolveAdapter(url: URL, requested: SourceId): SourceAdapter {
  if (requested !== 'auto') return adapters.find((adapter) => adapter.id === requested) ?? adapters.at(-1)!;
  return adapters.find((adapter) => adapter.id !== 'generic' && adapter.matches(url)) ?? adapters.at(-1)!;
}

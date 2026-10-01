import type {ExportAd} from './excel-export.js';

export async function companionExportAds(fetcher:typeof fetch=fetch):Promise<ExportAd[]> {
  const response=await fetcher('http://127.0.0.1:4311/api/export-records',{signal:AbortSignal.timeout(15000)});
  if(response.ok&&response.headers.get('content-type')?.includes('application/json')){
    const data=await response.json() as {ads:ExportAd[]};if(!Array.isArray(data.ads))throw new Error('دادهٔ همراه محلی نامعتبر است.');return data.ads;
  }
  // Support an already-running older companion without closing its login tabs.
  const [stateResponse,listResponse]=await Promise.all(['state','listings?phoneOnly=0'].map(path=>fetcher('http://127.0.0.1:4311/api/'+path,{signal:AbortSignal.timeout(15000)})));
  if(!stateResponse?.ok||!listResponse?.ok)throw new Error('همراه محلی پاسخ نداد؛ خروجی ناقص ساخته نشد.');
  const state=await stateResponse.json() as {count:number};const list=await listResponse.json() as {listings:ExportAd[]};
  if(!Array.isArray(list.listings)||state.count!==list.listings.length)throw new Error('بانک همراه محلی تغییر کرده یا از سقف نسخهٔ قدیمی بزرگ‌تر است؛ همراه را دوباره اجرا کن. خروجی ناقص ساخته نشد.');
  return list.listings;
}

// Keep conflicting registered numbers as separate rows. Never infer a phone.
export function combineExportAds(groups:Array<{origin:string;ads:ExportAd[]}>) {
  const rows=new Map<string,ExportAd>();
  const metadata:Array<{ad:ExportAd;origin:string}>=[];
  const enrich=(existing:ExportAd,ad:ExportAd,origin:string)=>{
    for(const field of ['description','price','city','region','topic','category','attributes','images','published_at','search_url','note'] as const)if((!existing[field]||existing[field]==='[]')&&ad[field])existing[field]=ad[field];
    existing.origin=[...new Set([...(existing.origin||'').split(' · '),origin])].join(' · ');
  };
  const phoneUrls=new Set(groups.flatMap(group=>group.ads.filter(ad=>ad.phone?.trim()).map(ad=>ad.url)));
  for(const group of groups)for(const ad of group.ads){
    if(!ad.phone?.trim()&&phoneUrls.has(ad.url)){metadata.push({ad,origin:group.origin});continue;}
    const key=JSON.stringify([ad.url,ad.phone?.trim()||'']);
    const existing=rows.get(key);
    if(!existing){rows.set(key,{...ad,origin:group.origin});continue;}
    enrich(existing,ad,group.origin);
  }
  for(const {ad,origin} of metadata)for(const existing of rows.values())if(existing.url===ad.url)enrich(existing,ad,origin);
  return [...rows.values()];
}

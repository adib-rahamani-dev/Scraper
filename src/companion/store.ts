import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { csvCell, type BrowserSource } from './policy.js';
import { captureExtras, captureRunAds, initializeCaptureData, type CaptureExtras } from '../shared/capture-data.js';

mkdirSync(resolve('data'), { recursive: true });
export const db = new DatabaseSync(resolve('data/companion.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS saved_ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL CHECK(source IN ('divar', 'sheypoor')),
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    topic TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    price TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    phone TEXT,
    contact_basis TEXT NOT NULL DEFAULT '',
    contact_source TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewing', 'contacted', 'done')),
    saved_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_saved_ads_saved ON saved_ads(saved_at DESC);
  CREATE INDEX IF NOT EXISTS idx_saved_ads_source ON saved_ads(source);
`);
const columns = db.prepare('PRAGMA table_info(saved_ads)').all() as unknown as Array<{ name: string }>;
if (!columns.some(column => column.name === 'price')) db.exec("ALTER TABLE saved_ads ADD COLUMN price TEXT NOT NULL DEFAULT ''");
if (!columns.some(column => column.name === 'description')) db.exec("ALTER TABLE saved_ads ADD COLUMN description TEXT NOT NULL DEFAULT ''");
if (!columns.some(column => column.name === 'contact_source')) db.exec("ALTER TABLE saved_ads ADD COLUMN contact_source TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE saved_ads SET contact_source = 'manual' WHERE phone IS NOT NULL AND contact_source = ''");
initializeCaptureData(db,'saved_ads');
// Earlier versions briefly placed item condition in the price column.
db.exec(`
  UPDATE saved_ads SET description = price
  WHERE description = '' AND price IN ('نو', 'در حد نو', 'کارکرده', 'نیازمند تعمیر');
  UPDATE saved_ads SET price = ''
  WHERE price IN ('نو', 'در حد نو', 'کارکرده', 'نیازمند تعمیر');
  UPDATE saved_ads SET description = ''
  WHERE (description LIKE 'انتشار آگهی:%آخرین نردبان:%'
    OR (description LIKE 'آگهی % در دیوار%' AND length(description) < 200));
`);

export type SavedAd = CaptureExtras & {
  id: number; source: BrowserSource; title: string; url: string; topic: string;
  city: string; region: string; price: string; description: string;
  phone: string | null; contact_basis: string; contact_source: string;
  note: string; status: 'new' | 'reviewing' | 'contacted' | 'done';
  saved_at: string; updated_at: string;
};

export type AdInput = Pick<SavedAd, 'source' | 'title' | 'url' | 'topic' | 'city' | 'region' | 'price' | 'description' | 'phone' | 'contact_basis' | 'note'> & Partial<CaptureExtras> & { contact_source?: string };

export function saveAd(ad: AdInput, options: { replaceTitle?: boolean; refreshMetadata?: boolean; replaceDescription?: boolean } = {}): { ad: SavedAd; duplicate: boolean } {
  const extras=captureExtras(ad);
  const existing = db.prepare('SELECT * FROM saved_ads WHERE url = ?').get(ad.url) as SavedAd | undefined;
  if (existing) {
    if (ad.phone && existing.phone && existing.phone !== ad.phone) throw new Error('این آگهی قبلاً با شمارهٔ دیگری ثبت شده است.');
    if (ad.phone && !existing.phone) {
      const sameContact = db.prepare('SELECT id FROM saved_ads WHERE phone = ? AND id <> ?').get(ad.phone, existing.id);
      if (sameContact) throw new Error('این شماره قبلاً برای آگهی دیگری ثبت شده است.');
    }
    const merged = {
      title: options.replaceTitle && ad.title ? ad.title : existing.title,
      topic: options.refreshMetadata && ad.topic ? ad.topic : existing.topic || ad.topic,
      city: existing.city || ad.city,
      region: existing.region || ad.region,
      price: options.refreshMetadata && ad.price ? ad.price : existing.price || ad.price,
      description: options.replaceDescription && ad.description ? ad.description : existing.description || ad.description,
      phone: existing.phone || ad.phone,
      contact_basis: existing.contact_basis || ad.contact_basis,
      contact_source: existing.contact_source || ad.contact_source || '',
      note: existing.note || ad.note,
    };
    db.prepare(`UPDATE saved_ads SET title=?, topic=?, city=?, region=?, price=?, description=?, phone=?, contact_basis=?, contact_source=?, note=?, updated_at=? WHERE id=?`)
      .run(merged.title, merged.topic, merged.city, merged.region, merged.price, merged.description, merged.phone, merged.contact_basis, merged.contact_source, merged.note, new Date().toISOString(), existing.id);
    db.prepare(`UPDATE saved_ads SET category=CASE WHEN ?!='' THEN ? ELSE category END,attributes=CASE WHEN ?!='[]' THEN ? ELSE attributes END,images=CASE WHEN ?!='[]' THEN ? ELSE images END,published_at=CASE WHEN ?!='' THEN ? ELSE published_at END WHERE id=?`).run(extras.category,extras.category,extras.attributes,extras.attributes,extras.images,extras.images,extras.published_at,extras.published_at,existing.id);
    return { ad: db.prepare('SELECT * FROM saved_ads WHERE id = ?').get(existing.id) as SavedAd, duplicate: true };
  }
  if (ad.phone) {
    const sameContact = db.prepare('SELECT * FROM saved_ads WHERE phone = ?').get(ad.phone) as SavedAd | undefined;
    if (sameContact) throw new Error('این شماره قبلاً برای آگهی دیگری ثبت شده است.');
  }
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO saved_ads (source,title,url,topic,city,region,price,description,phone,contact_basis,contact_source,note,saved_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(ad.source, ad.title, ad.url, ad.topic, ad.city, ad.region, ad.price, ad.description, ad.phone, ad.contact_basis, ad.contact_source ?? '', ad.note, now, now);
  db.prepare('UPDATE saved_ads SET category=?,attributes=?,images=?,published_at=? WHERE id=?').run(extras.category,extras.attributes,extras.images,extras.published_at,Number(result.lastInsertRowid));
  return { ad: db.prepare('SELECT * FROM saved_ads WHERE id = ?').get(Number(result.lastInsertRowid)) as SavedAd, duplicate: false };
}

export function getAds(filters: { source?: string; status?: string; search?: string;runId?:string;phoneOnly?:boolean } = {}): SavedAd[] {
  if(filters.runId)return captureRunAds<SavedAd>(db,'saved_ads',filters.runId).filter(ad=>(!filters.phoneOnly||Boolean(ad.phone?.trim()))&&(!filters.source||ad.source===filters.source)&&(!filters.status||ad.status===filters.status)&&(!filters.search||`${ad.title} ${ad.topic} ${ad.city} ${ad.region}`.includes(filters.search)));
  const clauses: string[] = [];
  const params: string[] = [];
  if(filters.phoneOnly)clauses.push("phone IS NOT NULL AND TRIM(phone) <> ''");
  if (filters.source === 'divar' || filters.source === 'sheypoor') { clauses.push('source = ?'); params.push(filters.source); }
  if (['new', 'reviewing', 'contacted', 'done'].includes(filters.status ?? '')) { clauses.push('status = ?'); params.push(filters.status!); }
  if (filters.search) {
    clauses.push('(title LIKE ? OR topic LIKE ? OR city LIKE ? OR region LIKE ? OR price LIKE ? OR description LIKE ? OR phone LIKE ? OR note LIKE ?)');
    const pattern = `%${filters.search.replace(/[%_]/g, '')}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  return db.prepare(`SELECT * FROM saved_ads ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY saved_at DESC LIMIT 5000`).all(...params) as SavedAd[];
}

export function getAd(id: number): SavedAd | undefined {
  return db.prepare('SELECT * FROM saved_ads WHERE id = ?').get(id) as SavedAd | undefined;
}

export function updateAd(id: number, status: string, note: string): SavedAd | undefined {
  db.prepare('UPDATE saved_ads SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(status, note, new Date().toISOString(), id);
  return db.prepare('SELECT * FROM saved_ads WHERE id = ?').get(id) as SavedAd | undefined;
}

export function adsCsv(ads: SavedAd[]): string {
  const keys: Array<keyof SavedAd> = ['id', 'source', 'title', 'url', 'topic', 'city', 'region', 'price', 'description', 'phone', 'contact_basis', 'contact_source', 'note', 'status', 'saved_at'];
  return `\uFEFF${keys.join(',')}\r\n${ads.map(ad => keys.map(key => csvCell(ad[key])).join(',')).join('\r\n')}`;
}

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { initializeHistory } from './history.js';
import { cleanText, parseSource, redactPossiblePhones, searchPageContext, type BrowserSource } from '../companion/policy.js';

export type CaptureExtras = { category: string; attributes: string; images: string; published_at: string };
export type CaptureRun = { id: string; source: BrowserSource; topic: string; city: string; region: string; search_url: string; status: string; total: number; processed: number; failed: number; message: string; created_at: string; updated_at: string };
type CaptureTable = 'captured_ads' | 'saved_ads';

export function captureExtras(raw: Record<string, unknown>): CaptureExtras {
  const attrs = Array.isArray(raw.attributes) ? raw.attributes : typeof raw.attributes === 'string' ? safeJson(raw.attributes) : [];
  const images = Array.isArray(raw.images) ? raw.images : typeof raw.images === 'string' ? safeJson(raw.images) : [];
  return {
    category: cleanText(raw.category, 300), published_at: cleanText(raw.published_at, 300),
    attributes: JSON.stringify(attrs.slice(0,60).flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const label = cleanText(item.label,100); const text = cleanText(redactPossiblePhones(String(item.value ?? '')),500);
      return label && text ? [{ label, value:text }] : [];
    })),
    images: JSON.stringify(images.map(String).filter(value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port; } catch { return false; } }).slice(0,30)),
  };
}
export function safeJson(value: string): unknown[] { try { const result: unknown = JSON.parse(value); return Array.isArray(result) ? result : []; } catch { return []; } }

export function initializeCaptureData(db: DatabaseSync, table: CaptureTable) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;
  for(const [name, value] of Object.entries({category:'',attributes:'[]',images:'[]',published_at:''})) {
    if(!columns.some(c=>c.name===name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${value}'`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ${table}_runs (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, topic TEXT NOT NULL, city TEXT NOT NULL, region TEXT NOT NULL,
    search_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', total INTEGER NOT NULL,
    processed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS ${table}_members (
    run_id TEXT NOT NULL REFERENCES ${table}_runs(id), ad_id INTEGER NOT NULL REFERENCES ${table}(id),
    snapshot TEXT NOT NULL, PRIMARY KEY(run_id,ad_id)
  );`);
  initializeHistory(db, `${table}_runs`);
}
export function createCaptureRun(db: DatabaseSync, table: CaptureTable, sourceValue: unknown, raw: Record<string,unknown>): CaptureRun {
  const source=parseSource(sourceValue); const searchUrl=String(raw.searchUrl ?? ''); const ctx=searchPageContext(source,searchUrl);
  if(!ctx) throw new Error('آدرس جست‌وجوی رسمی نامعتبر است.');
  const total=Number(raw.total); if(!Number.isSafeInteger(total)||total<1||total>40) throw new Error('هر اجرا باید ۱ تا ۴۰ آگهی داشته باشد.');
  const run:CaptureRun={id:randomUUID(),source,topic:cleanText(raw.topic,80)||ctx.topic,city:cleanText(raw.city,80)||ctx.city,region:cleanText(raw.region,80),search_url:searchUrl.slice(0,3000),status:'running',total,processed:0,failed:0,message:'در حال استخراج جزئیات',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  db.prepare(`INSERT INTO ${table}_runs (id,source,topic,city,region,search_url,status,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(run.id,run.source,run.topic,run.city,run.region,run.search_url,run.status,run.total,run.created_at,run.updated_at);
  return run;
}
export function getCaptureRun(db:DatabaseSync,table:CaptureTable,id:string):CaptureRun|undefined {return db.prepare(`SELECT * FROM ${table}_runs WHERE id=?`).get(id) as CaptureRun|undefined;}
export function listCaptureRuns(db:DatabaseSync,table:CaptureTable):CaptureRun[] {return db.prepare(`SELECT * FROM ${table}_runs WHERE history_batch = '' ORDER BY created_at DESC LIMIT 100`).all() as CaptureRun[];}
export function updateCaptureRun(db:DatabaseSync,table:CaptureTable,id:string,raw:Record<string,unknown>) {
  const run=getCaptureRun(db,table,id);if(!run)throw new Error('اجرای جست‌وجو پیدا نشد.');
  const status=String(raw.status??run.status);if(!['running','paused','completed','partial','cancelled','failed'].includes(status))throw new Error('وضعیت اجرا نامعتبر است.');
  const processed=Number(raw.processed??run.processed);const failed=Number(raw.failed??run.failed);
  if(!Number.isSafeInteger(processed)||!Number.isSafeInteger(failed)||processed<run.processed||failed<run.failed||processed+failed>run.total)throw new Error('شمارندهٔ اجرا نامعتبر است.');
  db.prepare(`UPDATE ${table}_runs SET status=?,processed=?,failed=?,message=?,updated_at=? WHERE id=?`).run(status,processed,failed,cleanText(raw.message,500),new Date().toISOString(),id);
  return getCaptureRun(db,table,id)!;
}
export function linkCaptureRun(db:DatabaseSync,table:CaptureTable,id:string,ad:Record<string,unknown>) {
  const run=getCaptureRun(db,table,id);if(!run||run.source!==ad.source)throw new Error('آگهی با اجرای جست‌وجو تطابق ندارد.');
  const count=Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}_members WHERE run_id=?`).get(id) as {n:number}).n);
  const existing=db.prepare(`SELECT 1 FROM ${table}_members WHERE run_id=? AND ad_id=?`).get(id,Number(ad.id));
  if(!existing&&count>=run.total)throw new Error('تعداد آگهی‌ها از ظرفیت اجرا بیشتر است.');
  const snapshot={...ad,topic:run.topic,search_url:run.search_url};
  db.prepare(`INSERT INTO ${table}_members (run_id,ad_id,snapshot) VALUES (?,?,?) ON CONFLICT(run_id,ad_id) DO UPDATE SET snapshot=excluded.snapshot`).run(id,Number(ad.id),JSON.stringify(snapshot));
}
export function captureRunAds<T>(db:DatabaseSync,table:CaptureTable,id:string):T[] {
  const rows=db.prepare(`SELECT a.*,m.snapshot FROM ${table}_members m JOIN ${table} a ON a.id=m.ad_id WHERE m.run_id=? ORDER BY a.id`).all(id) as Array<Record<string,unknown>>;
  return rows.map(row=>{const snapshot=JSON.parse(String(row.snapshot)) as Record<string,unknown>;return {...snapshot,phone:row.phone,contact_basis:row.contact_basis,contact_source:row.contact_source,status:row.status,note:row.note} as T;});
}

import { createHash, randomBytes } from 'node:crypto';
import { normalizeIranianPhone } from './extractor.js';
import { db } from './db.js';
import { cleanText, csvCell, detailUrl, parseSource, redactPossiblePhones, type BrowserSource } from '../companion/policy.js';
import { captureExtras, captureRunAds, getCaptureRun, linkCaptureRun, type CaptureExtras } from '../shared/capture-data.js';

export type CapturedAd = CaptureExtras & {
  id: number; source: BrowserSource; title: string; url: string; topic: string; city: string;
  region: string; price: string; description: string; phone: string | null;
  contact_basis: string; contact_source: string; note: string;
  status: 'new' | 'reviewing' | 'contacted' | 'done'; saved_at: string; updated_at: string;
};

type CaptureInput = CaptureExtras & Pick<CapturedAd, 'source' | 'title' | 'url' | 'topic' | 'city' | 'region' | 'price' | 'description'>;

function normalizeCapture(source: BrowserSource, raw: unknown): CaptureInput {
  if (!raw || typeof raw !== 'object') throw new Error('آگهی نامعتبر است.');
  const item = raw as Record<string, unknown>;
  const url = detailUrl(source, String(item.url ?? ''));
  if (!url) throw new Error('لینک آگهی باید متعلق به همان سایت باشد.');
  const title = cleanText(redactPossiblePhones(String(item.title??'')), 240);
  if (title.length < 2) throw new Error('عنوان آگهی خالی است.');
  return {
    source, title, url,
    topic: cleanText(item.topic, 80), city: cleanText(item.city, 80),
    region: cleanText(item.region, 80), price: cleanText(redactPossiblePhones(String(item.price ?? '')), 100),
    description: redactPossiblePhones(String(item.description ?? '')).trim().slice(0,10000),
    ...captureExtras(item),
  };
}

function insertOrEnrich(item: CaptureInput, mode: 'search' | 'detail'): boolean {
  const existing = db.prepare('SELECT id FROM captured_ads WHERE url = ?').get(item.url);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE captured_ads SET
        title = ?,
        topic = CASE WHEN ? != '' THEN ? ELSE topic END,
        city = CASE WHEN city = '' THEN ? ELSE city END,
        region = CASE WHEN region = '' THEN ? ELSE region END,
        price = CASE WHEN ? != '' THEN ? ELSE price END,
        description = CASE WHEN ? = 'detail' AND ? != '' THEN ? WHEN description = '' THEN ? ELSE description END,
        category = CASE WHEN ? != '' THEN ? ELSE category END,
        attributes = CASE WHEN ? != '[]' THEN ? ELSE attributes END,
        images = CASE WHEN ? != '[]' THEN ? ELSE images END,
        published_at = CASE WHEN ? != '' THEN ? ELSE published_at END,
        updated_at = ?
      WHERE url = ?
    `).run(item.title,item.topic,item.topic, item.city, item.region, item.price, item.price,
      mode, item.description, item.description, item.description,item.category,item.category,item.attributes,item.attributes,item.images,item.images,item.published_at,item.published_at, now, item.url);
    return false;
  }
  db.prepare(`INSERT INTO captured_ads (source,title,url,topic,city,region,price,description,category,attributes,images,published_at,saved_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(item.source, item.title, item.url, item.topic, item.city, item.region, item.price, item.description,item.category,item.attributes,item.images,item.published_at, now, now);
  return true;
}

export function saveCapturedBatch(sourceValue: unknown, itemsValue: unknown, modeValue: unknown, runId?:string) {
  const source = parseSource(sourceValue);
  const mode = modeValue === 'detail' ? 'detail' : modeValue === 'search' ? 'search' : null;
  if (!mode) throw new Error('نوع برداشت نامعتبر است.');
  if (!Array.isArray(itemsValue) || itemsValue.length < 1 || itemsValue.length > (mode === 'detail' ? 1 : 40)) {
    throw new Error('تعداد آگهی‌های این برداشت نامعتبر است.');
  }
  const items = itemsValue.map(item => normalizeCapture(source, item));
  if(runId && getCaptureRun(db,'captured_ads',runId)?.source !== source) throw new Error('اجرای جست‌وجو نامعتبر است.');
  let saved = 0;
  db.exec('BEGIN');
  try {
    for (const item of items) {
      if (insertOrEnrich(item, mode)) saved++;
      if(runId) linkCaptureRun(db,'captured_ads',runId,db.prepare('SELECT * FROM captured_ads WHERE url=?').get(item.url)!);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { saved, duplicate: items.length - saved, count: items.length };
}

export function saveCapturedContact(sourceValue: unknown, raw: unknown) {
  const source = parseSource(sourceValue);
  if (!raw || typeof raw !== 'object') throw new Error('ورودی نامعتبر است.');
  const input = raw as Record<string, unknown>;
  if (input.confirmed !== true) throw new Error('تأیید مجاز بودن ارتباط لازم است.');
  const basis = input.basis === 'direct-consent' || input.basis === 'public-business' ? input.basis : null;
  if (!basis) throw new Error('مبنای مجاز ارتباط را انتخاب کن.');
  if (input.contactSource !== 'visible-after-manual-reveal') throw new Error('شماره باید ابتدا به‌صورت دستی در سایت نمایان شده باشد.');
  const phone = normalizeIranianPhone(String(input.phone ?? ''));
  if (!phone) throw new Error('شمارهٔ تماس معتبر نیست.');
  const item = normalizeCapture(source, input.ad);
  const samePhone = db.prepare('SELECT url FROM captured_ads WHERE phone = ?').get(phone) as { url: string } | undefined;
  if (samePhone && samePhone.url !== item.url) throw new Error('این شماره قبلاً برای آگهی دیگری ثبت شده است.');
  db.exec('BEGIN');
  try {
    insertOrEnrich(item, 'detail');
    const current = db.prepare('SELECT phone FROM captured_ads WHERE url = ?').get(item.url) as { phone: string | null };
    if (current.phone && current.phone !== phone) throw new Error('این آگهی قبلاً شمارهٔ دیگری دارد.');
    db.prepare(`UPDATE captured_ads SET phone = ?, contact_basis = ?, contact_source = 'visible-after-manual-reveal', updated_at = ? WHERE url = ?`)
      .run(phone, basis, new Date().toISOString(), item.url);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return db.prepare('SELECT * FROM captured_ads WHERE url = ?').get(item.url) as CapturedAd;
}

export function importCapturedAds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw new Error('فایل انتقال باید بین ۱ تا ۵۰۰ آگهی داشته باشد.');
  const records = value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('رکورد نامعتبر در فایل انتقال.');
    const input = raw as Record<string, unknown>;
    const ad = normalizeCapture(parseSource(input.source), input);
    const phone = input.phone ? normalizeIranianPhone(String(input.phone)) : null;
    if (input.phone && !phone) throw new Error('شمارهٔ نامعتبر در فایل انتقال.');
    const basis = input.contact_basis === 'direct-consent' || input.contact_basis === 'public-business' ? input.contact_basis : '';
    if (phone && !basis) throw new Error('برای انتقال شماره، مبنای مجاز ارتباط باید در رکورد ثبت شده باشد.');
    const status = ['new', 'reviewing', 'contacted', 'done'].includes(String(input.status)) ? String(input.status) : 'new';
    return { ad, phone, basis, status, note: cleanText(input.note, 2000) };
  });
  let saved = 0;
  let phones = 0;
  db.exec('BEGIN');
  try {
    for (const record of records) {
      if (insertOrEnrich(record.ad, 'detail')) saved++;
      if (record.phone) {
        const previous = db.prepare('SELECT url FROM captured_ads WHERE phone = ?').get(record.phone) as { url: string } | undefined;
        if (previous && previous.url !== record.ad.url) throw new Error('یک شماره برای دو آگهی متفاوت در فایل یا بانک وجود دارد.');
        const current = db.prepare('SELECT phone FROM captured_ads WHERE url = ?').get(record.ad.url) as { phone: string | null };
        if (current.phone && current.phone !== record.phone) throw new Error('شمارهٔ این آگهی با بانک ابری متفاوت است.');
        db.prepare("UPDATE captured_ads SET phone = ?, contact_basis = ?, contact_source = 'local-import', updated_at = ? WHERE url = ?")
          .run(record.phone, record.basis, new Date().toISOString(), record.ad.url);
        phones++;
      }
      db.prepare('UPDATE captured_ads SET status = ?, note = CASE WHEN ? != \'\' THEN ? ELSE note END, updated_at = ? WHERE url = ?')
        .run(record.status, record.note, record.note, new Date().toISOString(), record.ad.url);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { saved, duplicate: records.length - saved, phones };
}

export function listCapturedAds(filters: { source?: string; status?: string; search?: string; runId?:string;phoneOnly?:boolean } = {}): CapturedAd[] {
  if(filters.runId) return captureRunAds<CapturedAd>(db,'captured_ads',filters.runId).filter(ad=>(!filters.phoneOnly||Boolean(ad.phone?.trim()))&&(!filters.source||ad.source===filters.source)&&(!filters.status||ad.status===filters.status)&&(!filters.search||`${ad.title} ${ad.topic} ${ad.city} ${ad.region} ${ad.phone??''}`.includes(filters.search)));
  const where: string[] = [];
  const params: string[] = [];
  if(filters.phoneOnly)where.push("phone IS NOT NULL AND TRIM(phone) <> ''");
  if (filters.source === 'divar' || filters.source === 'sheypoor') { where.push('source = ?'); params.push(filters.source); }
  if (['new', 'reviewing', 'contacted', 'done'].includes(filters.status ?? '')) { where.push('status = ?'); params.push(filters.status!); }
  if (filters.search) {
    const pattern = `%${filters.search.replace(/[%_]/g, '').slice(0, 80)}%`;
    where.push('(title LIKE ? OR topic LIKE ? OR city LIKE ? OR region LIKE ? OR phone LIKE ? OR note LIKE ?)');
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  return db.prepare(`SELECT * FROM captured_ads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY saved_at DESC LIMIT 5000`).all(...params) as CapturedAd[];
}

export function updateCapturedAd(id: number, status: string, note: string): CapturedAd | null {
  if (!Number.isSafeInteger(id) || id < 1 || !['new', 'reviewing', 'contacted', 'done'].includes(status)) throw new Error('ورودی نامعتبر است.');
  db.prepare('UPDATE captured_ads SET status = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(status, cleanText(note, 2000), new Date().toISOString(), id);
  return db.prepare('SELECT * FROM captured_ads WHERE id = ?').get(id) as CapturedAd | undefined ?? null;
}

export function capturedCsv(ads: CapturedAd[]): string {
  const keys: Array<keyof CapturedAd> = ['id', 'source', 'title', 'url', 'topic', 'city', 'region', 'price', 'description', 'phone', 'contact_basis', 'contact_source', 'note', 'status', 'saved_at'];
  return `\uFEFF${keys.join(',')}\r\n${ads.map(ad => keys.map(key => csvCell(ad[key])).join(',')).join('\r\n')}`;
}

function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export function issueExtensionToken() {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 90 * 24 * 60 * 60 * 1000);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE extension_tokens SET revoked_at = ? WHERE revoked_at IS NULL').run(createdAt.toISOString());
    db.prepare('INSERT INTO extension_tokens (token_hash, created_at, expires_at) VALUES (?,?,?)')
      .run(tokenHash(token), createdAt.toISOString(), expiresAt.toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { token, expiresAt: expiresAt.toISOString() };
}

export function revokeExtensionTokens(): void {
  db.prepare('UPDATE extension_tokens SET revoked_at = ? WHERE revoked_at IS NULL').run(new Date().toISOString());
}

export function extensionTokenStatus() {
  const row = db.prepare('SELECT created_at, expires_at FROM extension_tokens WHERE revoked_at IS NULL ORDER BY id DESC LIMIT 1').get() as { created_at: string; expires_at: string } | undefined;
  return { active: Boolean(row && Date.parse(row.expires_at) > Date.now()), createdAt: row?.created_at ?? null, expiresAt: row?.expires_at ?? null };
}

export function validExtensionToken(header: string | undefined): boolean {
  const match = /^Bearer ([A-Za-z0-9_-]{40,60})$/.exec(header ?? '');
  if (!match) return false;
  const row = db.prepare('SELECT expires_at FROM extension_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(tokenHash(match[1]!)) as { expires_at: string } | undefined;
  return Boolean(row && Date.parse(row.expires_at) > Date.now());
}

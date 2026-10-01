import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type HistoryTable = 'runs' | 'captured_ads_runs' | 'saved_ads_runs';
const tables: HistoryTable[] = ['runs', 'captured_ads_runs', 'saved_ads_runs'];
function checkedTable(table: HistoryTable) {
  if (!tables.includes(table)) throw new Error('تاریخچه نامعتبر است.');
  return table;
}

export function initializeHistory(db: DatabaseSync, table: HistoryTable) {
  checkedTable(table);
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'history_batch')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN history_batch TEXT NOT NULL DEFAULT ''`);
  }
}

export function historyCounts(db: DatabaseSync, table: HistoryTable) {
  checkedTable(table);
  return db.prepare(`SELECT
    COUNT(CASE WHEN history_batch != '' THEN 1 END) AS archived,
    COUNT(CASE WHEN history_batch = '' AND status NOT IN ('running','queued','paused') THEN 1 END) AS removable
    FROM ${table}`).get() as { archived: number; removable: number };
}

// Only visibility changes: rows, relationships, contacts and search snapshots remain intact.
export function deleteHistory(db: DatabaseSync, table: HistoryTable, raw: Record<string, unknown>) {
  checkedTable(table);
  if (raw.confirm !== true) throw new Error('تأیید حذف از تاریخچه لازم است.');
  if (raw.all === true && raw.confirmText !== 'من تایید میکنم') {
    throw new Error('برای پاک‌سازی کلی، عبارت «من تایید میکنم» را دقیقاً بنویس.');
  }
  const ids = raw.ids;
  if (raw.all !== true && (!Array.isArray(ids) || !ids.length || ids.length > 100 ||
    ids.some(id => typeof id !== 'string' && typeof id !== 'number'))) {
    throw new Error('اجراهای موردنظر را انتخاب کن.');
  }
  const batch = randomUUID();
  const scope = raw.all === true ? '' : ` AND id IN (${(ids as unknown[]).map(() => '?').join(',')})`;
  const values = raw.all === true ? [] : ids as Array<string | number>;
  const result = db.prepare(`UPDATE ${table} SET history_batch = ?
    WHERE history_batch = '' AND status NOT IN ('running','queued','paused')${scope}`).run(batch, ...values);
  return { batch, changed: Number(result.changes), ...historyCounts(db, table) };
}

export function restoreHistory(db: DatabaseSync, table: HistoryTable, raw: Record<string, unknown>) {
  checkedTable(table);
  if (raw.confirm !== true) throw new Error('تأیید بازیابی تاریخچه لازم است.');
  if (raw.all !== true && (typeof raw.batch !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.batch))) {
    throw new Error('شناسهٔ بازیابی نامعتبر است.');
  }
  const result = raw.all === true
    ? db.prepare(`UPDATE ${table} SET history_batch = '' WHERE history_batch != ''`).run()
    : db.prepare(`UPDATE ${table} SET history_batch = '' WHERE history_batch = ?`).run(String(raw.batch));
  return { changed: Number(result.changes), ...historyCounts(db, table) };
}

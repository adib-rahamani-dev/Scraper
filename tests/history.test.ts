import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { deleteHistory, historyCounts, initializeHistory, restoreHistory, type HistoryTable } from '../src/shared/history.js';
import { createCaptureRun, initializeCaptureData, listCaptureRuns, captureRunAds, linkCaptureRun, updateCaptureRun } from '../src/shared/capture-data.js';

describe('reversible history cleanup', () => {
  for (const table of ['runs', 'captured_ads_runs', 'saved_ads_runs'] as HistoryTable[]) {
    it(`only hides inactive ${table} rows and restores the exact batch`, () => {
      const db = new DatabaseSync(':memory:');
      db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, status TEXT NOT NULL);
        INSERT INTO ${table} VALUES ('a','completed'),('b','failed'),('c','running'),('d','paused'),('e','queued')`);
      initializeHistory(db, table); initializeHistory(db, table);
      expect(() => deleteHistory(db, table, { all: true })).toThrow('تأیید');
      expect(() => deleteHistory(db, table, { confirm: true, ids: [] })).toThrow();
      const first = deleteHistory(db, table, { confirm: true, ids: ['a', 'c', 'd', 'e'] });
      expect(first.changed).toBe(1);
      expect(() => deleteHistory(db, table, { confirm: true, all: true })).toThrow('من تایید میکنم');
      expect(() => deleteHistory(db, table, { confirm: true, all: true, confirmText: 'اشتباه' })).toThrow();
      const second = deleteHistory(db, table, { confirm: true, all: true, confirmText: 'من تایید میکنم' });
      expect(second.changed).toBe(1);
      expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toMatchObject({ n: 5 });
      expect(restoreHistory(db, table, { confirm: true, batch: first.batch }).changed).toBe(1);
      expect(historyCounts(db, table)).toEqual({ archived: 1, removable: 1 });
      expect(restoreHistory(db, table, { confirm: true, batch: first.batch }).changed).toBe(0);
      expect(() => restoreHistory(db, table, { all: true })).toThrow('تأیید');
      expect(restoreHistory(db, table, { confirm: true, all: true }).changed).toBe(1);
      expect(historyCounts(db, table)).toEqual({ archived: 0, removable: 2 });
      db.close();
    });
  }
  it('preserves saved ads, confirmed contacts, memberships and search snapshots', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE saved_ads(id INTEGER PRIMARY KEY, source TEXT, title TEXT, phone TEXT, status TEXT, note TEXT, contact_basis TEXT, contact_source TEXT);
      INSERT INTO saved_ads VALUES (1,'divar','fixture','09123456789','new','keep','public-business','visible')`);
    initializeCaptureData(db, 'saved_ads');
    const run = createCaptureRun(db, 'saved_ads', 'divar', { searchUrl: 'https://divar.ir/s/qazvin?q=mobile', total: 1 });
    const ad = db.prepare('SELECT * FROM saved_ads WHERE id=1').get()!;
    linkCaptureRun(db, 'saved_ads', run.id, ad);
    updateCaptureRun(db, 'saved_ads', run.id, { processed: 1, status: 'completed' });
    const before = captureRunAds(db, 'saved_ads', run.id);
    const deleted = deleteHistory(db, 'saved_ads_runs', { confirm: true, all: true, confirmText: 'من تایید میکنم' });
    expect(listCaptureRuns(db, 'saved_ads')).toEqual([]);
    expect(captureRunAds(db, 'saved_ads', run.id)).toEqual(before);
    expect(db.prepare('SELECT phone FROM saved_ads').get()).toMatchObject({ phone: '09123456789' });
    restoreHistory(db, 'saved_ads_runs', { confirm: true, batch: deleted.batch });
    expect(listCaptureRuns(db, 'saved_ads')).toHaveLength(1);
    expect(captureRunAds(db, 'saved_ads', run.id)).toEqual(before);
    db.close();
  });
  it('does not accept arbitrary table identifiers', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => initializeHistory(db, 'leads' as HistoryTable)).toThrow();
    db.close();
  });
});

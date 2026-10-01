import type { DatabaseSync } from 'node:sqlite';

const mainTables = ['campaigns','projects','runs','leads','captured_ads','captured_ads_runs','captured_ads_members'];
const companionTables = ['saved_ads','saved_ads_runs','saved_ads_members'];
export function dataResetStatus(db:DatabaseSync,kind:'main'|'companion') {
  const tables=kind==='main'?mainTables:companionTables;
  const runTables=kind==='main'?['runs','captured_ads_runs']:['saved_ads_runs'];
  return {rows:tables.reduce((sum,table)=>sum+Number((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n),0),
    active:runTables.reduce((sum,table)=>sum+Number((db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE status IN ('running','queued','paused')`).get() as {n:number}).n),0)};
}
export function resetData(db:DatabaseSync,kind:'main'|'companion',raw:Record<string,unknown>) {
  if(raw.confirm!==true||raw.confirmText!=='من تایید میکنم')throw new Error('عبارت «من تایید میکنم» را دقیقاً بنویس.');
  const tables=kind==='main'?mainTables:companionTables;
  const runTables=kind==='main'?['runs','captured_ads_runs']:['saved_ads_runs'];
  if(runTables.some(table=>Number((db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE status IN ('running','queued','paused')`).get() as {n:number}).n)))throw new Error('ابتدا اجراهای فعال را متوقف کن؛ حذف همه هنگام اجرا ممکن نیست.');
  db.exec('CREATE TABLE IF NOT EXISTS data_trash(id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL, created_at TEXT NOT NULL)');
  const snapshot=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));
  const count=Object.values(snapshot).reduce((sum,rows)=>sum+rows.length,0);
  if(!count)return {changed:0};
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT OR REPLACE INTO data_trash VALUES (1,?,?)').run(JSON.stringify(snapshot),new Date().toISOString());
    for(const table of [...tables].reverse())db.exec(`DELETE FROM ${table}`);
    db.exec('COMMIT');return {changed:count};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function restoreData(db:DatabaseSync,kind:'main'|'companion',raw:Record<string,unknown>) {
  if(raw.confirm!==true)throw new Error('تأیید بازیابی لازم است.');
  db.exec('CREATE TABLE IF NOT EXISTS data_trash(id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL, created_at TEXT NOT NULL)');
  const stored=db.prepare('SELECT snapshot FROM data_trash WHERE id=1').get() as {snapshot:string}|undefined;
  if(!stored)return {changed:0};
  const tables=kind==='main'?mainTables:companionTables;
  if(tables.some(table=>Number((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n)))throw new Error('بانک فعلی خالی نیست؛ بازیابی کامل برای جلوگیری از تداخل انجام نشد.');
  const snapshot=JSON.parse(stored.snapshot) as Record<string,Record<string,unknown>[]>;let changed=0;
  db.exec('BEGIN IMMEDIATE');
  try{for(const table of tables)for(const row of snapshot[table]??[]){const columns=Object.keys(row);db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(row) as Array<string|number|null>);changed++;}
    db.exec('DELETE FROM data_trash');db.exec('COMMIT');return {changed};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

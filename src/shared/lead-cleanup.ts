import type {DatabaseSync} from 'node:sqlite';

export function clearLeadBank(db:DatabaseSync,raw:Record<string,unknown>) {
  if(raw.confirm!==true||raw.confirmText!=='من تایید میکنم')throw new Error('عبارت «من تایید میکنم» را دقیقاً بنویس.');
  if(Number((db.prepare("SELECT COUNT(*) n FROM runs WHERE status IN ('running','queued')").get() as {n:number}).n))throw new Error('ابتدا پویش‌های فعال منابع عمومی را متوقف کن.');
  db.exec('CREATE TABLE IF NOT EXISTS lead_bank_trash(id INTEGER PRIMARY KEY CHECK(id=1),snapshot TEXT NOT NULL)');
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows=db.prepare('SELECT * FROM leads').all();
    if(rows.length){db.prepare('INSERT OR REPLACE INTO lead_bank_trash VALUES(1,?)').run(JSON.stringify(rows));db.exec('DELETE FROM leads');}
    db.exec('COMMIT');return {changed:rows.length};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function restoreLeadBank(db:DatabaseSync,raw:Record<string,unknown>) {
  if(raw.confirm!==true)throw new Error('تأیید بازیابی لازم است.');
  db.exec('CREATE TABLE IF NOT EXISTS lead_bank_trash(id INTEGER PRIMARY KEY CHECK(id=1),snapshot TEXT NOT NULL)');
  db.exec('BEGIN IMMEDIATE');
  try {
    if(Number((db.prepare('SELECT COUNT(*) n FROM leads').get() as {n:number}).n))throw new Error('بانک سرنخ‌ها خالی نیست؛ بازیابی برای جلوگیری از تداخل انجام نشد.');
    const stored=db.prepare('SELECT snapshot FROM lead_bank_trash WHERE id=1').get() as {snapshot:string}|undefined;
    const rows=stored?JSON.parse(stored.snapshot) as Record<string,string|number|null>[]:[];
    for(const row of rows){const keys=Object.keys(row);db.prepare(`INSERT INTO leads (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}
    db.exec('DELETE FROM lead_bank_trash');db.exec('COMMIT');return {changed:rows.length};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

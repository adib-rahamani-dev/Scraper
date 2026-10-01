import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync('./data/lead-radar.db');
database.exec(`
  UPDATE runs
  SET status = 'cancelled', finished_at = COALESCE(finished_at, datetime('now')),
      message = 'اجرای نیمه‌کاره هنگام انتقال به نسخه آنلاین متوقف شد؛ برای شروع مجدد اجرا کنید'
  WHERE status IN ('queued', 'running');
  UPDATE projects SET status = 'ready' WHERE status = 'running';
  PRAGMA wal_checkpoint(TRUNCATE);
`);
database.close();

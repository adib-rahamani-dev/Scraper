import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { get, put } from '@vercel/blob';
import type { BuiltInSourceId, Campaign, Lead, Project, Run, SourceId } from '../shared/types.js';
import { initializeCaptureData } from '../shared/capture-data.js';
import { initializeHistory } from '../shared/history.js';

const isVercel = Boolean(process.env.VERCEL);
const databasePath = resolve(process.env.DATABASE_PATH ?? (isVercel ? '/tmp/lead-radar.db' : './data/lead-radar.db'));
let snapshotEtag: string | undefined;
mkdirSync(dirname(databasePath), { recursive: true });

if (isVercel && process.env.BLOB_READ_WRITE_TOKEN) {
  try {
    const stored = await get('lead-radar/database.db', { access: 'private', useCache: false });
    if (stored?.statusCode === 200) {
      const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());
      writeFileSync(databasePath, bytes);
      snapshotEtag = stored.blob.etag;
    }
  } catch (error) {
    throw new Error('Could not restore the private database snapshot.',{cause:error});
  }
}

export let db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    sources TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    target_url TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    city TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    max_pages INTEGER NOT NULL DEFAULT 25,
    delay_ms INTEGER NOT NULL DEFAULT 1500,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    pages_scanned INTEGER NOT NULL DEFAULT 0,
    leads_found INTEGER NOT NULL DEFAULT 0,
    duplicates_skipped INTEGER NOT NULL DEFAULT 0,
    blocked_pages INTEGER NOT NULL DEFAULT 0,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT 'در صف اجرا',
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 50,
    status TEXT NOT NULL DEFAULT 'new',
    is_business INTEGER NOT NULL DEFAULT 0,
    discovered_at TEXT NOT NULL,
    UNIQUE(project_id, phone)
  );

  CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project_id);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(discovered_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);

  CREATE TABLE IF NOT EXISTS captured_ads (
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
  CREATE INDEX IF NOT EXISTS idx_captured_ads_saved ON captured_ads(saved_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_captured_ads_phone ON captured_ads(phone) WHERE phone IS NOT NULL;

  CREATE TABLE IF NOT EXISTS extension_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
`);

initializeCaptureData(db, 'captured_ads');
initializeHistory(db, 'runs');
const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as unknown as Array<{ name: string }>;
if (!projectColumns.some((column) => column.name === 'campaign_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_projects_campaign ON projects(campaign_id);');

// Keep the most useful existing record for each phone, then enforce uniqueness
// across all projects and campaigns (not just within one project).
const duplicatesBeforeMigration = Number((db.prepare('SELECT COUNT(*) - COUNT(DISTINCT phone) AS count FROM leads').get() as { count: number }).count);
const manualFailuresBeforeMigration = Number((db.prepare(`
  SELECT COUNT(*) AS count FROM runs WHERE status = 'failed' AND pages_scanned = 0 AND leads_found = 0
    AND project_id IN (SELECT id FROM projects WHERE source IN ('divar', 'sheypoor'))
`).get() as { count: number }).count);
db.exec(`
  DELETE FROM leads WHERE id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY phone ORDER BY
          CASE status WHEN 'contacted' THEN 0 WHEN 'qualified' THEN 1 WHEN 'new' THEN 2 ELSE 3 END,
          score DESC, discovered_at DESC, id DESC
      ) AS row_number FROM leads
    ) WHERE row_number > 1
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_unique ON leads(phone);
  UPDATE runs SET status = 'skipped', progress = 100,
    message = 'این منبع برای شماره‌های محافظت‌شده نیازمند دسترسی رسمی است؛ بررسی دستی در سایت اصلی'
  WHERE status = 'failed' AND pages_scanned = 0 AND leads_found = 0
    AND project_id IN (SELECT id FROM projects WHERE source IN ('divar', 'sheypoor'));
`);

if (isVercel) {
  db.exec(`
    UPDATE runs
    SET status = 'cancelled', finished_at = COALESCE(finished_at, datetime('now')),
        message = 'اجرای نیمه‌کاره هنگام انتقال به نسخه آنلاین متوقف شد؛ برای شروع مجدد اجرا کنید'
    WHERE status IN ('queued', 'running');
    UPDATE projects SET status = 'ready' WHERE status = 'running';
  `);
}

let refreshRequired=false;
export async function refreshDatabase():Promise<void> {
  if(!isVercel)return;
  if(!process.env.BLOB_READ_WRITE_TOKEN)throw new Error('ذخیره‌سازی ابری پروژه تنظیم نشده است.');
  const stored=await get('lead-radar/database.db',{access:'private',useCache:false,...(snapshotEtag&&!refreshRequired?{ifNoneMatch:snapshotEtag}:{})});
  if(stored?.statusCode!==200)return;
  // Each serverless instance reads the latest snapshot; conditional writes prevent lost updates.
  if(stored.blob.etag===snapshotEtag&&!refreshRequired){await stored.stream.cancel();return;}
  const bytes=new Uint8Array(await new Response(stored.stream).arrayBuffer());
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');db.close();writeFileSync(databasePath,bytes);
  db=new DatabaseSync(databasePath);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  initializeCaptureData(db,'captured_ads');initializeHistory(db,'runs');snapshotEtag=stored.blob.etag;refreshRequired=false;
}
export async function persistDatabase(): Promise<void> {
  if (!isVercel) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('ذخیره‌سازی ابری پروژه تنظیم نشده است.');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  try {const result = await put('lead-radar/database.db', readFileSync(databasePath), {
    access: 'private',
    allowOverwrite: Boolean(snapshotEtag),
    ...(snapshotEtag ? { ifMatch: snapshotEtag } : {}),
    addRandomSuffix: false,
    contentType: 'application/x-sqlite3',
  });
  snapshotEtag = result.etag;
  }catch(error){refreshRequired=true;throw new Error('ذخیرهٔ ابری انجام نشد؛ اتصال یا تغییر هم‌زمان را بررسی و درخواست را دوباره اجرا کن.',{cause:error});}
}

if (isVercel && (duplicatesBeforeMigration > 0 || manualFailuresBeforeMigration > 0)) {
  try {
    await persistDatabase();
  } catch (error) {
    // Another instance may already have saved the same migration. The local
    // database remains deduplicated; later writes must pass the ETag check.
    console.warn('Could not persist deduplication migration.', error);
  }
}

type ProjectRow = {
  id: number;
  campaign_id: number | null;
  name: string;
  target_url: string;
  source: SourceId;
  city: string;
  keywords: string;
  max_pages: number;
  delay_ms: number;
  status: Project['status'];
  created_at: string;
  updated_at: string;
};

type LeadRow = {
  id: number;
  project_id: number;
  source: string;
  title: string;
  phone: string;
  city: string;
  category: string;
  url: string;
  score: number;
  status: Lead['status'];
  is_business: number;
  discovered_at: string;
};

type RunRow = {
  id: number;
  project_id: number;
  project_name: string;
  status: Run['status'];
  pages_scanned: number;
  leads_found: number;
  duplicates_skipped: number;
  blocked_pages: number;
  progress: number;
  message: string;
  started_at: string | null;
  finished_at: string | null;
};

type CampaignRow = {
  id: number;
  topic: string;
  city: string;
  region: string;
  sources: string;
  project_count: number;
  active_runs: number;
  queued_runs: number;
  completed_runs: number;
  failed_runs: number;
  progress: number;
  leads_found: number;
  created_at: string;
};

export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}•••${phone.slice(-4)}`;
}

function mapProject(row: ProjectRow): Project {
  let keywords: string[] = [];
  try {
    keywords = JSON.parse(row.keywords) as string[];
  } catch {
    keywords = [];
  }
  return {
    id: row.id,
    campaignId: row.campaign_id ?? null,
    name: row.name,
    targetUrl: row.target_url,
    source: row.source,
    city: row.city,
    keywords,
    maxPages: row.max_pages,
    delayMs: row.delay_ms,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLead(row: LeadRow): Lead {
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    title: row.title,
    phone: row.phone,
    phoneMasked: maskPhone(row.phone),
    city: row.city,
    category: row.category,
    url: row.url,
    score: row.score,
    status: row.status,
    isBusiness: Boolean(row.is_business),
    discoveredAt: row.discovered_at,
  };
}

function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    status: row.status,
    pagesScanned: row.pages_scanned,
    leadsFound: row.leads_found,
    duplicatesSkipped: row.duplicates_skipped,
    blockedPages: row.blocked_pages,
    progress: row.progress,
    message: row.message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapCampaign(row: CampaignRow): Campaign {
  let sources: BuiltInSourceId[] = [];
  try { sources = JSON.parse(row.sources) as BuiltInSourceId[]; } catch { sources = []; }
  const status: Campaign['status'] = row.active_runs > 0
    ? (row.queued_runs === row.active_runs ? 'queued' : 'running')
    : row.failed_runs > 0 && row.completed_runs > 0 ? 'partial'
      : row.failed_runs > 0 ? 'failed' : 'completed';
  return {
    id: row.id,
    topic: row.topic,
    city: row.city,
    region: row.region,
    sources,
    projectCount: row.project_count,
    runningRuns: row.active_runs,
    completedRuns: row.completed_runs,
    failedRuns: row.failed_runs,
    progress: Math.round(row.progress ?? 0),
    leadsFound: row.leads_found,
    status,
    createdAt: row.created_at,
  };
}

const campaignSelect = `
  SELECT campaigns.*,
    (SELECT COUNT(*) FROM projects WHERE projects.campaign_id = campaigns.id) AS project_count,
    (SELECT COUNT(*) FROM runs JOIN projects ON projects.id = runs.project_id WHERE projects.campaign_id = campaigns.id AND runs.status IN ('queued','running')) AS active_runs,
    (SELECT COUNT(*) FROM runs JOIN projects ON projects.id = runs.project_id WHERE projects.campaign_id = campaigns.id AND runs.status = 'queued') AS queued_runs,
    (SELECT COUNT(*) FROM runs JOIN projects ON projects.id = runs.project_id WHERE projects.campaign_id = campaigns.id AND runs.status IN ('completed','skipped')) AS completed_runs,
    (SELECT COUNT(*) FROM runs JOIN projects ON projects.id = runs.project_id WHERE projects.campaign_id = campaigns.id AND runs.status IN ('failed','cancelled')) AS failed_runs,
    COALESCE((SELECT AVG(runs.progress) FROM runs JOIN projects ON projects.id = runs.project_id WHERE projects.campaign_id = campaigns.id), 0) AS progress,
    COALESCE((SELECT COUNT(DISTINCT leads.phone) FROM leads JOIN projects ON projects.id = leads.project_id WHERE projects.campaign_id = campaigns.id), 0) AS leads_found
  FROM campaigns`;

export function createCampaign(input: { topic: string; city: string; region?: string; sources: BuiltInSourceId[] }): Campaign {
  const result = db.prepare('INSERT INTO campaigns (topic, city, region, sources, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(input.topic, input.city, input.region ?? '', JSON.stringify(input.sources), new Date().toISOString());
  return getCampaign(Number(result.lastInsertRowid))!;
}

export function getCampaign(id: number): Campaign | null {
  const row = db.prepare(`${campaignSelect} WHERE campaigns.id = ?`).get(id) as unknown as CampaignRow | undefined;
  return row ? mapCampaign(row) : null;
}

export function listCampaigns(): Campaign[] {
  return (db.prepare(`${campaignSelect} ORDER BY campaigns.id DESC`).all() as unknown as CampaignRow[]).map(mapCampaign);
}

export function listProjects(): Project[] {
  return (db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as unknown as ProjectRow[]).map(mapProject);
}

export function getProject(id: number): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function createProject(input: Omit<Project, 'id' | 'campaignId' | 'status' | 'createdAt' | 'updatedAt'> & { campaignId?: number | null }): Project {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO projects (campaign_id, name, target_url, source, city, keywords, max_pages, delay_ms, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
  `).run(input.campaignId ?? null, input.name, input.targetUrl, input.source, input.city, JSON.stringify(input.keywords), input.maxPages, input.delayMs, now, now);
  return getProject(Number(result.lastInsertRowid))!;
}

export function createRun(projectId: number): Run {
  const result = db.prepare('INSERT INTO runs (project_id) VALUES (?)').run(projectId);
  return getRun(Number(result.lastInsertRowid))!;
}

export function getRun(id: number): Run | null {
  const row = db.prepare(`
    SELECT runs.*, projects.name AS project_name
    FROM runs JOIN projects ON projects.id = runs.project_id
    WHERE runs.id = ?
  `).get(id) as unknown as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function listRuns(limit = 30): Run[] {
  return (db.prepare(`
    SELECT runs.*, projects.name AS project_name
    FROM runs JOIN projects ON projects.id = runs.project_id
    WHERE runs.history_batch = ''
    ORDER BY runs.id DESC LIMIT ?
  `).all(limit) as unknown as RunRow[]).map(mapRun);
}

export function updateRun(id: number, fields: Partial<Pick<Run, 'status' | 'pagesScanned' | 'leadsFound' | 'duplicatesSkipped' | 'blockedPages' | 'progress' | 'message' | 'startedAt' | 'finishedAt'>>): void {
  const mapping: Record<string, string> = {
    status: 'status', pagesScanned: 'pages_scanned', leadsFound: 'leads_found',
    duplicatesSkipped: 'duplicates_skipped', blockedPages: 'blocked_pages',
    progress: 'progress', message: 'message', startedAt: 'started_at', finishedAt: 'finished_at',
  };
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `${mapping[key]} = ?`).join(', ');
  db.prepare(`UPDATE runs SET ${assignments} WHERE id = ?`).run(...entries.map(([, value]) => value), id);
}

export function setProjectStatus(id: number, status: Project['status']): void {
  db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
}

export type NewLead = Omit<Lead, 'id' | 'phoneMasked' | 'status' | 'discoveredAt'> & { runId: number };

export function insertLead(input: NewLead): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO leads
      (project_id, run_id, source, title, phone, city, category, url, score, status, is_business, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
  `).run(input.projectId, input.runId, input.source, input.title, input.phone, input.city, input.category,
    input.url, input.score, input.isBusiness ? 1 : 0, new Date().toISOString());
  return result.changes > 0;
}

export function listLeads(filters: { projectId?: number; campaignId?: number; search?: string; status?: string; limit?: number } = {}): Lead[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filters.projectId) { where.push('project_id = ?'); params.push(filters.projectId); }
  if (filters.campaignId) { where.push('project_id IN (SELECT id FROM projects WHERE campaign_id = ?)'); params.push(filters.campaignId); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.search) {
    where.push('(title LIKE ? OR phone LIKE ? OR city LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }
  const sql = `SELECT * FROM leads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY discovered_at DESC LIMIT ?`;
  params.push(Math.min(filters.limit ?? 200, 100_000));
  return (db.prepare(sql).all(...params) as unknown as LeadRow[]).map(mapLead);
}

export function updateLeadStatus(id: number, status: Lead['status']): boolean {
  return db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

export function dashboard() {
  const scalar = (sql: string) => Number((db.prepare(sql).get() as unknown as { value: number }).value ?? 0);
  const recentLeads = listLeads({ limit: 7 });
  const recentRuns = listRuns(6);
  const sourceCounts = db.prepare(`SELECT source, COUNT(*) AS count FROM (
    SELECT source FROM leads UNION ALL SELECT source FROM captured_ads
  ) GROUP BY source ORDER BY count DESC`).all() as unknown as Array<{ source: string; count: number }>;
  const dailyCounts = db.prepare(`
    WITH RECURSIVE dates(day) AS (
      SELECT date('now', '-6 day') UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < date('now')
    )
    SELECT dates.day, COUNT(records.day) AS count FROM dates
    LEFT JOIN (
      SELECT date(discovered_at) AS day FROM leads
      UNION ALL SELECT date(saved_at) AS day FROM captured_ads
    ) records ON records.day = dates.day GROUP BY dates.day ORDER BY dates.day
  `).all() as unknown as Array<{ day: string; count: number }>;
  return {
    stats: {
      totalLeads: scalar('SELECT (SELECT COUNT(*) FROM leads) + (SELECT COUNT(*) FROM captured_ads) AS value'),
      todayLeads: scalar("SELECT (SELECT COUNT(*) FROM leads WHERE date(discovered_at) = date('now')) + (SELECT COUNT(*) FROM captured_ads WHERE date(saved_at) = date('now')) AS value"),
      activeProjects: scalar("SELECT COUNT(*) AS value FROM projects WHERE status != 'paused'"),
      runningJobs: scalar("SELECT COUNT(*) AS value FROM runs WHERE status IN ('queued','running')"),
      uniquePhones: scalar('SELECT COUNT(DISTINCT phone) AS value FROM (SELECT phone FROM leads UNION ALL SELECT phone FROM captured_ads WHERE phone IS NOT NULL)'),
      averageScore: Math.round(scalar('SELECT COALESCE(AVG(score), 0) AS value FROM leads')),
    },
    recentLeads,
    recentRuns,
    sourceCounts,
    dailyCounts,
  };
}

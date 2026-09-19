import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BuiltInSourceId, Campaign, Lead, Project, Run, SourceId } from '../shared/types.js';

const databasePath = resolve(process.env.DATABASE_PATH ?? './data/lead-radar.db');
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
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
`);

const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as unknown as Array<{ name: string }>;
if (!projectColumns.some((column) => column.name === 'campaign_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_projects_campaign ON projects(campaign_id);');

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
    (SELECT COUNT(*) FROM runs JOIN projects ON projects.id = runs.project_id WHERE projects.campaign_id = campaigns.id AND runs.status = 'completed') AS completed_runs,
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
  const rows = (db.prepare(sql).all(...params) as unknown as LeadRow[]).map(mapLead);
  const seenPhones = new Set<string>();
  return rows.filter((lead) => {
    if (seenPhones.has(lead.phone)) return false;
    seenPhones.add(lead.phone);
    return true;
  });
}

export function updateLeadStatus(id: number, status: Lead['status']): boolean {
  return db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

export function dashboard() {
  const scalar = (sql: string) => Number((db.prepare(sql).get() as unknown as { value: number }).value ?? 0);
  const recentLeads = listLeads({ limit: 7 });
  const recentRuns = listRuns(6);
  const sourceCounts = db.prepare('SELECT source, COUNT(*) AS count FROM leads GROUP BY source ORDER BY count DESC').all() as unknown as Array<{ source: string; count: number }>;
  const dailyCounts = db.prepare(`
    WITH RECURSIVE dates(day) AS (
      SELECT date('now', '-6 day') UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < date('now')
    )
    SELECT dates.day, COUNT(leads.id) AS count FROM dates
    LEFT JOIN leads ON date(leads.discovered_at) = dates.day GROUP BY dates.day ORDER BY dates.day
  `).all() as unknown as Array<{ day: string; count: number }>;
  return {
    stats: {
      totalLeads: scalar('SELECT COUNT(*) AS value FROM leads'),
      todayLeads: scalar("SELECT COUNT(*) AS value FROM leads WHERE date(discovered_at) = date('now')"),
      activeProjects: scalar("SELECT COUNT(*) AS value FROM projects WHERE status != 'paused'"),
      runningJobs: scalar("SELECT COUNT(*) AS value FROM runs WHERE status IN ('queued','running')"),
      uniquePhones: scalar('SELECT COUNT(DISTINCT phone) AS value FROM leads'),
      averageScore: Math.round(scalar('SELECT COALESCE(AVG(score), 0) AS value FROM leads')),
    },
    recentLeads,
    recentRuns,
    sourceCounts,
    dailyCounts,
  };
}

export function seedDemo(): void {
  if (scalarCount('projects') > 0) return;
  const samples = [
    createProject({ name: 'خدمات ساختمانی تهران', targetUrl: 'https://example.com/tehran/services', source: 'generic', city: 'تهران', keywords: ['بازسازی', 'کابینت'], maxPages: 30, delayMs: 1500 }),
    createProject({ name: 'تجهیزات صنعتی', targetUrl: 'https://example.com/industry', source: 'iran-tejarat', city: 'کرج', keywords: ['دستگاه', 'تولید'], maxPages: 40, delayMs: 1800 }),
  ];
  const titles = ['طراحی و اجرای کابینت مدرن', 'فروش دستگاه بسته‌بندی', 'خدمات بازسازی ساختمان', 'تولید تجهیزات کارگاهی', 'نصب دوربین مداربسته', 'خدمات برق صنعتی', 'فروش عمده ابزارآلات', 'طراحی دکوراسیون داخلی'];
  const demoRuns = samples.map((project, index) => {
    const run = createRun(project.id);
    updateRun(run.id, { status: 'completed', progress: 100, pagesScanned: 18 + index * 7, leadsFound: 4, startedAt: new Date(Date.now() - 3_600_000).toISOString(), finishedAt: new Date(Date.now() - 3_000_000).toISOString(), message: 'با موفقیت تکمیل شد' });
    return run;
  });
  titles.forEach((title, index) => {
    const project = samples[index % samples.length]!;
    const run = demoRuns[index % demoRuns.length]!;
    insertLead({ projectId: project.id, runId: run.id, source: project.source, title, phone: `09${12 + index}555${String(1100 + index).slice(-4)}`, city: project.city, category: index % 2 ? 'صنعت' : 'خدمات', url: `https://example.com/ad/${index + 1}`, score: 62 + index * 4, isBusiness: index % 3 !== 0 });
  });
}

function scalarCount(table: 'projects' | 'leads' | 'runs'): number {
  return Number((db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as unknown as { value: number }).value);
}

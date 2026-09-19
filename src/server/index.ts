import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuiltInSourceId, Lead, SourceId } from '../shared/types.js';
import { cancelRun, startRun } from './crawler.js';
import { createCampaign, createProject, createRun, dashboard, getCampaign, getProject, getRun, listCampaigns, listLeads, listProjects, listRuns, seedDemo, updateLeadStatus } from './db.js';
import { validatePublicUrl } from './policy.js';
import { buildSourceSearchUrl, normalizeCity, normalizeTopic, sourceCatalog } from './source-catalog.js';

const app = express();
const port = Number(process.env.PORT ?? 4300);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] }));
app.use(express.json({ limit: '128kb' }));

app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'lead-radar', time: new Date().toISOString() }));
app.get('/api/dashboard', (_request, response) => response.json(dashboard()));
app.get('/api/projects', (_request, response) => response.json(listProjects()));
app.get('/api/sources', (_request, response) => response.json(sourceCatalog));
app.get('/api/campaigns', (_request, response) => response.json(listCampaigns()));

app.post('/api/campaigns/topic', (request, response) => {
  try {
    const body = request.body as Record<string, unknown>;
    if (body.complianceAccepted !== true) return response.status(400).json({ error: 'پذیرش قوانین استفاده مسئولانه الزامی است.' });
    const topic = normalizeTopic(body.topic);
    const city = normalizeCity(body.city);
    const allowed = new Set(sourceCatalog.map((source) => source.id));
    const requested = Array.isArray(body.sources) ? body.sources.map(String) : sourceCatalog.map((source) => source.id);
    const sourceIds = [...new Set(requested.filter((source): source is BuiltInSourceId => allowed.has(source as BuiltInSourceId)))];
    if (!sourceIds.length) return response.status(400).json({ error: 'حداقل یک منبع باید انتخاب شود.' });
    const maxPages = Math.max(1, Math.min(40, Number(body.maxPages ?? 40)));
    const campaign = createCampaign({ topic, city, region: String(body.region ?? '').trim().slice(0, 80), sources: sourceIds });
    const projects = sourceIds.map((sourceId) => {
      const source = sourceCatalog.find((item) => item.id === sourceId)!;
      const targetUrl = validatePublicUrl(buildSourceSearchUrl(sourceId, topic, city)).toString();
      return createProject({
        campaignId: campaign.id,
        name: `${topic} • ${source.label}${city === 'کل ایران' ? '' : ` • ${city}`}`,
        targetUrl,
        source: sourceId,
        city: city === 'کل ایران' ? '' : city,
        keywords: [topic],
        maxPages,
        delayMs: 1750,
      });
    });
    const runs = projects.map((project) => {
      const run = createRun(project.id);
      startRun(run.id);
      return run;
    });
    response.status(202).json({ topic, city, campaign: getCampaign(campaign.id)!, projects, runs });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'ورودی نامعتبر است.' });
  }
});

app.post('/api/campaigns/:id/run', (request, response) => {
  const campaign = getCampaign(Number(request.params.id));
  if (!campaign) return response.status(404).json({ error: 'پویش پیدا نشد.' });
  const projects = listProjects().filter((project) => project.campaignId === campaign.id);
  const runnable = projects.filter((project) => project.status !== 'running');
  if (!runnable.length) return response.status(409).json({ error: 'منابع این پویش همین حالا در حال اجرا هستند.' });
  const runs = runnable.map((project) => {
    const run = createRun(project.id);
    startRun(run.id);
    return run;
  });
  response.status(202).json({ campaign: getCampaign(campaign.id), runs });
});

app.post('/api/projects', (request, response) => {
  try {
    const body = request.body as Record<string, unknown>;
    if (body.complianceAccepted !== true) return response.status(400).json({ error: 'پذیرش قوانین استفاده مسئولانه الزامی است.' });
    const name = String(body.name ?? '').trim();
    if (name.length < 3 || name.length > 100) return response.status(400).json({ error: 'نام پروژه باید بین ۳ تا ۱۰۰ نویسه باشد.' });
    const targetUrl = validatePublicUrl(String(body.targetUrl ?? '')).toString();
    const allowedSources: SourceId[] = ['auto', 'divar', 'sheypoor', 'iran-tejarat', 'niyazban', 'niaz', 'generic'];
    const source = allowedSources.includes(body.source as SourceId) ? body.source as SourceId : 'auto';
    const keywords = Array.isArray(body.keywords) ? body.keywords.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12) : String(body.keywords ?? '').split(/[،,]/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
    const maxPages = Math.max(1, Math.min(200, Number(body.maxPages ?? 25)));
    const delayMs = Math.max(750, Math.min(15_000, Number(body.delayMs ?? 1500)));
    const project = createProject({ name, targetUrl, source, city: String(body.city ?? '').trim().slice(0, 80), keywords, maxPages, delayMs });
    response.status(201).json(project);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'ورودی نامعتبر است.' });
  }
});

app.post('/api/projects/:id/run', (request, response) => {
  const project = getProject(Number(request.params.id));
  if (!project) return response.status(404).json({ error: 'پروژه پیدا نشد.' });
  if (project.status === 'running') return response.status(409).json({ error: 'این پروژه همین حالا در حال اجراست.' });
  const run = createRun(project.id);
  startRun(run.id);
  response.status(202).json(run);
});

app.get('/api/runs', (_request, response) => response.json(listRuns()));
app.get('/api/runs/:id', (request, response) => {
  const run = getRun(Number(request.params.id));
  if (!run) return response.status(404).json({ error: 'اجرا پیدا نشد.' });
  response.json(run);
});
app.post('/api/runs/:id/cancel', (request, response) => {
  const stopped = cancelRun(Number(request.params.id));
  response.status(stopped ? 202 : 409).json({ ok: stopped, error: stopped ? undefined : 'این اجرا فعال نیست.' });
});

app.get('/api/leads', (request, response) => {
  const projectId = request.query.projectId ? Number(request.query.projectId) : undefined;
  const campaignId = request.query.campaignId ? Number(request.query.campaignId) : undefined;
  response.json(listLeads({ projectId, campaignId, search: String(request.query.search ?? ''), status: request.query.status ? String(request.query.status) : undefined, limit: Number(request.query.limit ?? 300) }));
});

app.patch('/api/leads/:id', (request, response) => {
  const allowed: Lead['status'][] = ['new', 'qualified', 'contacted', 'excluded'];
  const status = request.body?.status as Lead['status'];
  if (!allowed.includes(status)) return response.status(400).json({ error: 'وضعیت نامعتبر است.' });
  const updated = updateLeadStatus(Number(request.params.id), status);
  response.status(updated ? 200 : 404).json(updated ? { ok: true } : { error: 'سرنخ پیدا نشد.' });
});

function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function sendCsv(response: express.Response, leads: Lead[], name: string): void {
  const header = ['عنوان', 'شماره تماس', 'شهر', 'دسته‌بندی', 'منبع', 'امتیاز', 'وضعیت', 'لینک', 'تاریخ'];
  const rows = leads.map((lead) => [lead.title, lead.phone, lead.city, lead.category, lead.source, lead.score, lead.status, lead.url, lead.discoveredAt]);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  response.setHeader('content-type', 'text/csv; charset=utf-8');
  response.setHeader('content-disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  response.send(csv);
}

app.get('/api/export.csv', (request, response) => {
  const projectId = request.query.projectId ? Number(request.query.projectId) : undefined;
  sendCsv(response, listLeads({ projectId, limit: 100_000 }), 'lead-radar');
});

app.get('/api/campaigns/:id/export.csv', (request, response) => {
  const campaign = getCampaign(Number(request.params.id));
  if (!campaign) return response.status(404).json({ error: 'پویش پیدا نشد.' });
  sendCsv(response, listLeads({ campaignId: campaign.id, limit: 100_000 }), `lead-radar-campaign-${campaign.id}`);
});

app.post('/api/demo/seed', (_request, response) => {
  seedDemo();
  response.json(dashboard());
});

const webRoot = resolve('dist/web');
if (existsSync(webRoot)) {
  app.use(express.static(webRoot));
  app.get(/.*/, (_request, response) => response.sendFile(resolve(webRoot, 'index.html')));
}

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: 'خطای داخلی سرویس' });
});

const server = app.listen(port, '127.0.0.1', () => console.log(`Lead Radar API: http://127.0.0.1:${port}`));
server.ref();

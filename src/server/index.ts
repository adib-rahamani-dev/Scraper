import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuiltInSourceId, Lead, SourceId } from '../shared/types.js';
import { cancelRun, runNow, startRun } from './crawler.js';
import { db, createCampaign, createProject, createRun, dashboard, getCampaign, getProject, getRun, listCampaigns, listLeads, listProjects, listRuns, persistDatabase, updateLeadStatus } from './db.js';
import { validatePublicUrl } from './policy.js';
import { buildSourceSearchUrl, normalizeCity, normalizeTopic, sourceCatalog } from './source-catalog.js';
import { capturedCsv, extensionTokenStatus, importCapturedAds, issueExtensionToken, listCapturedAds, revokeExtensionTokens, saveCapturedBatch, saveCapturedContact, updateCapturedAd, validExtensionToken } from './cloud-capture.js';
import { createCaptureRun, listCaptureRuns, updateCaptureRun } from '../shared/capture-data.js';
import { adsWorkbook, type ExportAd } from './excel-export.js';
import { combineExportAds,companionExportAds } from './combined-export.js';
import {clearLeadBank,restoreLeadBank} from '../shared/lead-cleanup.js';
import { refreshDatabase } from './db.js';
import { updateRun, setProjectStatus } from './db.js';
import { dataResetStatus, resetData, restoreData } from '../shared/data-reset.js';
import { exportPhoneOnly } from '../shared/export-filter.js';
import { deleteHistory, restoreHistory, historyCounts, type HistoryTable } from '../shared/history.js';

const app = express();
const port = Number(process.env.PORT ?? 4300);
const isVercel = Boolean(process.env.VERCEL);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] }));
app.use(express.json({ limit: '2mb' }));
let databaseQueue=Promise.resolve();
app.use('/api',async(request,response,next)=>{
  if(!isVercel||request.path==='/health'||request.path==='/auth/login')return next();
  const previous=databaseQueue;let release!:()=>void;
  databaseQueue=new Promise<void>(resolve=>{release=resolve;});await previous;
  let released=false;const done=()=>{if(!released){released=true;release();}};
  response.once('finish',done);response.once('close',done);
  try{await refreshDatabase();if(response.destroyed){done();return;}next();}catch{response.status(503).json({error:'پایگاه ابری فعلاً در دسترس نیست؛ دادهٔ خالی جایگزین آن نشده است.'});}
});

app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'lead-radar', time: new Date().toISOString() }));

const passwordHash = process.env.APP_PASSWORD_SHA256;
const sessionSecret = process.env.APP_SESSION_SECRET;
const authConfigured = Boolean(passwordHash && sessionSecret);
const sessionCookie = 'lead_radar_session';
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;

function equalHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function isAuthenticated(request: express.Request): boolean {
  if (!authConfigured) return !isVercel;
  const raw = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  if (!raw) return false;
  const [expiresText, signature] = raw.split('.');
  const expires = Number(expiresText);
  if (!expiresText || !signature || !Number.isSafeInteger(expires) || expires <= Date.now()) return false;
  const expected = createHmac('sha256', sessionSecret!).update(expiresText).digest('hex');
  return equalHex(signature, expected);
}

app.post('/api/auth/login', (request, response) => {
  if (!authConfigured) return response.status(isVercel ? 503 : 200).json(isVercel ? { error: 'ورود مدیریتی هنوز تنظیم نشده است.' } : { ok: true });
  const submittedHash = createHash('sha256').update(String(request.body?.password ?? '')).digest('hex');
  if (!equalHex(submittedHash, passwordHash!)) return response.status(401).json({ error: 'رمز ورود نادرست است.' });
  const expires = Date.now() + sessionLifetime;
  const signature = createHmac('sha256', sessionSecret!).update(String(expires)).digest('hex');
  response.cookie(sessionCookie, `${expires}.${signature}`, { httpOnly: true, secure: isVercel, sameSite: 'strict', maxAge: sessionLifetime, path: '/' });
  response.json({ ok: true });
});

app.use('/api/extension', (request, response, next) => {
  if (!validExtensionToken(request.headers.authorization)) return response.status(401).json({ error: 'کلید افزونه معتبر نیست یا منقضی شده است.' });
  next();
});
app.get('/api/extension/ping', (_request, response) => response.json({ ok: true }));
app.post('/api/extension/runs',async(request,response)=>{
  try{const run=createCaptureRun(db,'captured_ads',request.body?.source,request.body);await persistDatabase();response.json(run);}
  catch(error){response.status(400).json({error:error instanceof Error?error.message:'ساخت اجرا ممکن نشد.'});}
});
app.patch('/api/extension/runs/:id',async(request,response)=>{
  try{const run=updateCaptureRun(db,'captured_ads',String(request.params.id),request.body);await persistDatabase();response.json(run);}
  catch(error){response.status(400).json({error:error instanceof Error?error.message:'ذخیرهٔ وضعیت ممکن نشد.'});}
});
app.post('/api/extension/capture', async (request, response) => {
  try {
    const result = saveCapturedBatch(request.body?.source, request.body?.items, request.body?.mode,request.body?.runId?String(request.body.runId):undefined);
    await persistDatabase();
    response.json(result);
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'ثبت آگهی ممکن نشد.' }); }
});
app.post('/api/extension/contact', async (request, response) => {
  try {
    const result = saveCapturedContact(request.body?.source, request.body);
    await persistDatabase();
    response.json({ id: result.id, phone: result.phone, saved: true });
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'ثبت شماره ممکن نشد.' }); }
});

app.use('/api', (request, response, next) => {
  if (isVercel && !authConfigured) return response.status(503).json({ error: 'ورود مدیریتی هنوز تنظیم نشده است.' });
  if (!isAuthenticated(request)) return response.status(401).json({ error: 'برای دیدن بانک شماره‌ها وارد پنل شوید.' });
  next();
});

app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie(sessionCookie, { path: '/' });
  response.json({ ok: true });
});

app.get('/api/dashboard', (_request, response) => response.json(dashboard()));
app.get('/api/runtime',(_request,response)=>response.json({local:!isVercel}));
app.get('/api/data/status',(_request,response)=>response.json(dataResetStatus(db,'main')));
for(const [action,handler] of [['reset',resetData],['restore',restoreData]] as const)app.post(`/api/data/${action}`,async(request,response)=>{
  try{const result=handler(db,'main',request.body??{});await persistDatabase();response.json(result);}catch(error){response.status(400).json({error:error instanceof Error?error.message:'تغییر بانک ممکن نشد.'});}
});
app.use('/api/companion',async(request,response)=>{
  if(isVercel)return response.status(400).json({error:'در نسخهٔ آنلاین از افزونه استفاده کن.'});
  if(!/^\/(?:state|capture-runs(?:\/history(?:\/(?:delete|restore))?|\/[a-z0-9-]+\/(?:cancel|resume|focus))?|listings(?:\/\d+(?:\/(?:enrich|reveal-contact))?)?|export\.(?:csv|xlsx)|data\/(?:status|reset|restore)|browser\/(?:divar|sheypoor)\/(?:search|navigate|login|tabs|extract|capture-contact))$/.test(request.path))return response.status(404).json({error:'مسیر نامعتبر است.'});
  try{const target=new URL('http://127.0.0.1:4311/api'+request.url);const result=await fetch(target,{method:request.method,headers:{'content-type':'application/json'},body:['GET','HEAD'].includes(request.method)?undefined:JSON.stringify(request.body??{}),signal:AbortSignal.timeout(60000)});
    response.status(result.status);for(const name of ['content-type','content-disposition']){const value=result.headers.get(name);if(value)response.setHeader(name,value);}response.send(Buffer.from(await result.arrayBuffer()));
  }catch{response.status(503).json({error:'همراه مرورگر فعال نیست. npm run companion را اجرا کن.'});}
});
for (const [path, table] of [['runs', 'runs'], ['capture-runs', 'captured_ads_runs']] as Array<[string, HistoryTable]>) {
  app.get(`/api/${path}/history`, (_request, response) => response.json(historyCounts(db, table)));
  for (const [action, handler] of [['delete', deleteHistory], ['restore', restoreHistory]] as const) {
    app.post(`/api/${path}/history/${action}`, async (request, response) => {
      try { const result = handler(db, table, request.body ?? {}); await persistDatabase(); response.json(result); }
      catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'تغییر تاریخچه ممکن نشد.' }); }
    });
  }
}
app.get('/api/capture-runs',(_request,response)=>response.json(listCaptureRuns(db,'captured_ads')));
app.get('/api/captured-ads', (request, response) => response.json(listCapturedAds({
  source: String(request.query.source ?? ''), status: String(request.query.status ?? ''), search: String(request.query.search ?? ''),runId:String(request.query.runId??''),phoneOnly:request.query.phoneOnly==='1',
})));
app.post('/api/captured-ads/import', async (request, response) => {
  if (request.body?.confirm !== true) return response.status(400).json({ error: 'تأیید انتقال داده به ابر لازم است.' });
  try { const result = importCapturedAds(request.body?.items); await persistDatabase(); response.json(result); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'انتقال ممکن نشد.' }); }
});
app.patch('/api/captured-ads/:id', async (request, response) => {
  try {
    const result = updateCapturedAd(Number(request.params.id), String(request.body?.status ?? ''), String(request.body?.note ?? ''));
    if (!result) return response.status(404).json({ error: 'آگهی پیدا نشد.' });
    await persistDatabase();
    response.json(result);
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'به‌روزرسانی ممکن نشد.' }); }
});
app.get('/api/captured-ads/export.csv', (request, response) => {
  const ads = listCapturedAds({ source: String(request.query.source ?? ''), status: String(request.query.status ?? ''), search: String(request.query.search ?? ''),runId:String(request.query.runId??''),phoneOnly:exportPhoneOnly(request.query.phoneOnly) });
  response.setHeader('content-type', 'text/csv; charset=utf-8');
  response.setHeader('content-disposition', 'attachment; filename="lead-radar-captured.csv"');
  response.send(capturedCsv(ads));
});
app.get('/api/captured-ads/export.xlsx',async(request,response)=>{
  const ads=listCapturedAds({source:String(request.query.source??''),status:String(request.query.status??''),search:String(request.query.search??''),runId:String(request.query.runId??''),phoneOnly:exportPhoneOnly(request.query.phoneOnly)});
  response.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('content-disposition','attachment; filename="lead-radar-ads.xlsx"');
  response.send(await adsWorkbook(ads));
});
app.get('/api/extension-token', (_request, response) => response.json(extensionTokenStatus()));
app.post('/api/extension-token', async (request, response) => {
  if (request.body?.confirm !== true) return response.status(400).json({ error: 'تأیید ساخت کلید لازم است.' });
  try { const result = issueExtensionToken(); await persistDatabase(); response.json(result); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : 'ساخت کلید ممکن نشد.' }); }
});
app.delete('/api/extension-token', async (_request, response) => {
  try { revokeExtensionTokens(); await persistDatabase(); response.json({ ok: true }); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : 'لغو کلید ممکن نشد.' }); }
});
app.get('/api/projects', (_request, response) => response.json(listProjects()));
app.get('/api/sources', (_request, response) => response.json(sourceCatalog));
app.get('/api/campaigns', (_request, response) => response.json(listCampaigns()));

app.post('/api/campaigns/topic', async (request, response) => {
  try {
    const body = request.body as Record<string, unknown>;
    if (body.complianceAccepted !== true) return response.status(400).json({ error: 'پذیرش قوانین استفاده مسئولانه الزامی است.' });
    const topic = normalizeTopic(body.topic);
    const city = normalizeCity(body.city);
    const allowed = new Set(sourceCatalog.map((source) => source.id));
    const requested = Array.isArray(body.sources) ? body.sources.map(String) : sourceCatalog.map((source) => source.id);
    const sourceIds = [...new Set(requested.filter((source): source is BuiltInSourceId => allowed.has(source as BuiltInSourceId)))];
    if (!sourceIds.length) return response.status(400).json({ error: 'حداقل یک منبع باید انتخاب شود.' });
    const maxPages = Math.max(1, Math.min(isVercel ? 7 : 40, Number(body.maxPages ?? (isVercel ? 7 : 40))));
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
        delayMs: 20_000,
      });
    });
    const runs = projects.map((project) => {
      const run = createRun(project.id);
      if (!isVercel) startRun(run.id);
      return run;
    });
    if (isVercel) {
      await Promise.all(runs.map((run) => runNow(run.id)));
      await persistDatabase();
    }
    response.status(isVercel ? 200 : 202).json({ topic, city, campaign: getCampaign(campaign.id)!, projects, runs: runs.map((run) => getRun(run.id)!) });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'ورودی نامعتبر است.' });
  }
});

app.post('/api/campaigns/:id/run', async (request, response) => {
  const campaign = getCampaign(Number(request.params.id));
  if (!campaign) return response.status(404).json({ error: 'پویش پیدا نشد.' });
  const projects = listProjects().filter((project) => project.campaignId === campaign.id);
  const runnable = projects.filter((project) => project.status !== 'running');
  if (!runnable.length) return response.status(409).json({ error: 'منابع این پویش همین حالا در حال اجرا هستند.' });
  const runs = runnable.map((project) => {
    const run = createRun(project.id);
    if (!isVercel) startRun(run.id);
    return run;
  });
  if (isVercel) {
    await Promise.all(runs.map((run) => runNow(run.id)));
    await persistDatabase();
  }
  response.status(isVercel ? 200 : 202).json({ campaign: getCampaign(campaign.id), runs: runs.map((run) => getRun(run.id)!) });
});

app.post('/api/projects', async (request, response) => {
  try {
    const body = request.body as Record<string, unknown>;
    if (body.complianceAccepted !== true) return response.status(400).json({ error: 'پذیرش قوانین استفاده مسئولانه الزامی است.' });
    const name = String(body.name ?? '').trim();
    if (name.length < 3 || name.length > 100) return response.status(400).json({ error: 'نام پروژه باید بین ۳ تا ۱۰۰ نویسه باشد.' });
    const targetUrl = validatePublicUrl(String(body.targetUrl ?? '')).toString();
    const allowedSources: SourceId[] = ['auto', 'divar', 'sheypoor', 'iran-tejarat', 'niyazban', 'niaz', 'generic'];
    const source = allowedSources.includes(body.source as SourceId) ? body.source as SourceId : 'auto';
    const keywords = Array.isArray(body.keywords) ? body.keywords.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12) : String(body.keywords ?? '').split(/[،,]/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
    const maxPages = Math.max(1, Math.min(isVercel ? 7 : 200, Number(body.maxPages ?? (isVercel ? 7 : 25))));
    const delayMs = Math.max(20_000, Math.min(30_000, Number(body.delayMs ?? 20_000)));
    const project = createProject({ name, targetUrl, source, city: String(body.city ?? '').trim().slice(0, 80), keywords, maxPages, delayMs });
    await persistDatabase();
    response.status(201).json(project);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'ورودی نامعتبر است.' });
  }
});

app.post('/api/projects/:id/run', async (request, response) => {
  const project = getProject(Number(request.params.id));
  if (!project) return response.status(404).json({ error: 'پروژه پیدا نشد.' });
  if (project.status === 'running') return response.status(409).json({ error: 'این پروژه همین حالا در حال اجراست.' });
  const run = createRun(project.id);
  if (isVercel) {
    await runNow(run.id);
    await persistDatabase();
  } else {
    startRun(run.id);
  }
  response.status(isVercel ? 200 : 202).json(getRun(run.id));
});

app.get('/api/runs', (_request, response) => response.json(listRuns()));
app.get('/api/runs/:id', (request, response) => {
  const run = getRun(Number(request.params.id));
  if (!run) return response.status(404).json({ error: 'اجرا پیدا نشد.' });
  response.json(run);
});
app.post('/api/runs/:id/cancel', async (request, response) => {
  const id=Number(request.params.id);let stopped = cancelRun(id);
  const run=getRun(id);
  if(!stopped&&run&&['running','queued'].includes(run.status)){updateRun(id,{status:'cancelled',finishedAt:new Date().toISOString(),message:'اجرای باقی‌مانده از نشست قبلی لغو شد'});setProjectStatus(run.projectId,'ready');stopped=true;}
  if(stopped)await persistDatabase();
  response.status(stopped ? 202 : 409).json({ ok: stopped, error: stopped ? undefined : 'این اجرا فعال نیست.' });
});

app.get('/api/leads', (request, response) => {
  const projectId = request.query.projectId ? Number(request.query.projectId) : undefined;
  const campaignId = request.query.campaignId ? Number(request.query.campaignId) : undefined;
  response.json(listLeads({ projectId, campaignId, search: String(request.query.search ?? ''), status: request.query.status ? String(request.query.status) : undefined, limit: Number(request.query.limit ?? 300) }));
});
for(const [action,handler] of [['clear',clearLeadBank],['restore',restoreLeadBank]] as const)app.post(`/api/leads/bank/${action}`,async(request,response)=>{
  try{const result=handler(db,request.body??{});await persistDatabase();response.json(result);}catch(error){response.status(400).json({error:error instanceof Error?error.message:'تغییر بانک سرنخ‌ها ممکن نشد.'});}
});

app.patch('/api/leads/:id', async (request, response) => {
  const allowed: Lead['status'][] = ['new', 'qualified', 'contacted', 'excluded'];
  const status = request.body?.status as Lead['status'];
  if (!allowed.includes(status)) return response.status(400).json({ error: 'وضعیت نامعتبر است.' });
  const updated = updateLeadStatus(Number(request.params.id), status);
  if (updated) await persistDatabase();
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
app.get('/api/export/all.xlsx',async(_request,response)=>{
  try {
    const count=Number((db.prepare('SELECT COUNT(*) n FROM leads').get() as {n:number}).n);
    if(count>100000)throw new Error('بانک منابع عمومی بیش از سقف خروجی یکجا است؛ خروجی ناقص ساخته نشد.');
    const groups=[{origin:'منابع عمومی',ads:listLeads({limit:100000}).map(lead=>({...lead,topic:lead.category,region:'',price:'',description:'',note:'',saved_at:lead.discoveredAt}))},{origin:'بانک افزونه',ads:db.prepare('SELECT * FROM captured_ads ORDER BY saved_at DESC').all() as unknown as ExportAd[]}];
    if(!isVercel){
      groups.push({origin:'مرورگر محلی',ads:await companionExportAds()});
    }
    const bytes=await adsWorkbook(combineExportAds(groups),'خروجی کلی تمام بانک‌ها');
    response.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('content-disposition','attachment; filename="lead-radar-all.xlsx"');response.send(bytes);
  }catch(error){response.status(503).json({error:error instanceof Error&&/خروجی|بانک|داده/.test(error.message)?error.message:'همراه محلی در دسترس نیست؛ آن را اجرا کن تا خروجی کلی کامل ساخته شود.'});}
});
app.get('/api/export.xlsx',async(request,response)=>{const leads=listLeads({campaignId:request.query.campaignId?Number(request.query.campaignId):undefined,limit:100000});response.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('content-disposition','attachment; filename="lead-radar.xlsx"');response.send(await adsWorkbook(leads.map(lead=>({...lead,topic:lead.category,region:'',price:'',description:'',note:'',saved_at:lead.discoveredAt}))));});

app.get('/api/campaigns/:id/export.csv', (request, response) => {
  const campaign = getCampaign(Number(request.params.id));
  if (!campaign) return response.status(404).json({ error: 'پویش پیدا نشد.' });
  sendCsv(response, listLeads({ campaignId: campaign.id, limit: 100_000 }), `lead-radar-campaign-${campaign.id}`);
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

if (!isVercel) {
  const server = app.listen(port, '127.0.0.1', () => console.log(`Lead Radar API: http://127.0.0.1:${port}`));
  server.ref();
}

export default app;

import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { closeAllBrowsers, closeBrowser, browserOpen, browserLoginStatus, navigateSearch, openBrowser, openDetail, selectedPage, startOfficialLogin, tabs } from './browser.js';
import { adsCsv, db, getAd, getAds, updateAd } from './store.js';
import { cleanText, detailUrl, parseSource, searchPageContext, searchUrl, sources } from './policy.js';
import { normalizeIranianPhone } from '../server/extractor.js';
import { campaignCities } from '../server/source-catalog.js';
import { captureCurrentDetail, captureCurrentSearch, captureVisibleContact, requestSelectedContact, visibleContactStatus } from './capture.js';
import { assertSourceAvailable, cancelDetailJob, resumeDetailJob, startDetailJob, restoreDetailJobs, detailJobProgress, focusDetailJob } from './jobs.js';
import { listCaptureRuns, getCaptureRun, updateCaptureRun } from '../shared/capture-data.js';
import { adsWorkbook } from '../server/excel-export.js';
import { dataResetStatus, resetData, restoreData } from '../shared/data-reset.js';
import { exportPhoneOnly } from '../shared/export-filter.js';
import { deleteHistory, restoreHistory, historyCounts } from '../shared/history.js';

const app = express();
const port = Number(process.env.COMPANION_PORT ?? 4311);
restoreDetailJobs();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use((req, res, next) => {
  const host = req.headers.host?.split(':')[0]?.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') { res.status(403).json({ error: 'دسترسی فقط از همین دستگاه مجاز است.' }); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) {
      res.status(403).json({ error: 'درخواست از مبدأ دیگری مجاز نیست.' }); return;
    }
  }
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/lead-radar-extension.zip',(_req,res)=>res.download(resolve('src/web/public/lead-radar-extension.zip')));
app.get('/api/state', (_req, res) => {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM saved_ads').get() as { n: number }).n;
  res.json({ sources: sources.map(source => ({ source, open: browserOpen(source) })), count, cities: campaignCities });
});
app.get('/api/data/status',(_req,res)=>res.json(dataResetStatus(db,'companion')));
app.get('/api/export-records',(_req,res)=>res.json({ads:db.prepare('SELECT * FROM saved_ads ORDER BY saved_at DESC').all()}));
app.post('/api/data/reset',(req,res)=>res.json(resetData(db,'companion',req.body??{})));
app.post('/api/data/restore',(req,res)=>res.json(restoreData(db,'companion',req.body??{})));
app.post('/api/browser/:source/open', async (req, res) => {
  const source = parseSource(req.params.source);
  await openBrowser(source);
  res.json({ open: true, tabs: await tabs(source) });
});
app.post('/api/browser/:source/open-ad',async(req,res)=>{
  const source=parseSource(req.params.source);assertSourceAvailable(source);
  const page=await openDetail(source,String(req.body.url??''));
  const result=await captureCurrentDetail(source,page);
  res.json({ad:result.ad,tabs:await tabs(source)});
});
app.post('/api/browser/:source/close', async (req, res) => {
  await closeBrowser(parseSource(req.params.source));
  res.json({ open: false });
});
app.post('/api/browser/:source/login', async (req, res) => {
  res.json({ message: await startOfficialLogin(parseSource(req.params.source),String(req.body.phone??'')) });
});
app.post('/api/browser/:source/login-status',async(req,res)=>{
  const source=parseSource(req.params.source);assertSourceAvailable(source);
  res.json(await browserLoginStatus(source));
});
app.get('/api/capture-runs',(_req,res)=>res.json(listCaptureRuns(db,'saved_ads').map(run=>{const {queue_state:_,...visible}=run as typeof run & {queue_state?:string};return {...visible,...detailJobProgress(run.id)};})));
app.get('/api/capture-runs/history',(_req,res)=>res.json(historyCounts(db,'saved_ads_runs')));
app.post('/api/capture-runs/history/delete',(req,res)=>res.json(deleteHistory(db,'saved_ads_runs',req.body??{})));
app.post('/api/capture-runs/history/restore',(req,res)=>res.json(restoreHistory(db,'saved_ads_runs',req.body??{})));
app.post('/api/browser/:source/extract',async(req,res)=>res.status(202).json(await startDetailJob(parseSource(req.params.source),Number(req.body.tabIndex),Number(req.body.limit??20))));
app.post('/api/capture-runs/:id/resume',(req,res)=>res.json(resumeDetailJob(String(req.params.id))));
app.post('/api/capture-runs/:id/focus',async(req,res)=>res.json(await focusDetailJob(String(req.params.id))));
app.post('/api/capture-runs/:id/cancel',(req,res)=>{const id=String(req.params.id);let ok=cancelDetailJob(id);const run=getCaptureRun(db,'saved_ads',id);if(!ok&&run&&['running','paused'].includes(run.status)){updateCaptureRun(db,'saved_ads',id,{status:'cancelled',message:'اجرا متوقف شد'});ok=true;}res.json({ok});});
app.post('/api/browser/:source/search', async (req, res) => {
  const source = parseSource(req.params.source);
  assertSourceAvailable(source);
  const url = searchUrl(source, req.body.topic, req.body.city);
  res.json({ url: await navigateSearch(source, url), tabs: await tabs(source) });
});
app.post('/api/browser/:source/navigate', async (req, res) => {
  const source = parseSource(req.params.source);
  assertSourceAvailable(source);
  const url = String(req.body.url ?? '');
  if (!searchPageContext(source, url)) throw new Error('لینک باید صفحهٔ جست‌وجوی همان سایت باشد.');
  res.json({ url: await navigateSearch(source, url), tabs: await tabs(source) });
});
app.get('/api/browser/:source/tabs', async (req, res) => {
  res.json({ tabs: await tabs(parseSource(req.params.source)) });
});
app.get('/api/browser/:source/contact-status',async(req,res)=>{
  const source=parseSource(req.params.source);
  res.json(await visibleContactStatus(source,selectedPage(source,Number(req.query.tabIndex))));
});
app.post('/api/browser/:source/focus', async (req, res) => {
  const page = selectedPage(parseSource(req.params.source), Number(req.body.tabIndex));
  await page.bringToFront();
  res.json({ url: page.url() });
});
app.post('/api/browser/:source/capture', async (req, res) => {
  const source = parseSource(req.params.source);
  const page = selectedPage(source, Number(req.body.tabIndex));
  if (req.body.kind === 'search') { res.json(await captureCurrentSearch(source, page)); return; }
  if (req.body.kind === 'detail') { res.json(await captureCurrentDetail(source, page)); return; }
  throw new Error('نوع برداشت نامعتبر است.');
});
app.post('/api/browser/:source/capture-contact', async (req, res) => {
  if (req.body.confirmed !== true) throw new Error('تأیید مجاز بودن ثبت شماره لازم است.');
  const source = parseSource(req.params.source);
  const page = selectedPage(source, Number(req.body.tabIndex));
  res.json(await captureVisibleContact(source, page, String(req.body.basis ?? '')));
});
app.post('/api/listings', async (req, res) => {
  const source = parseSource(req.body.source);
  const page = selectedPage(source, Number(req.body.tabIndex));
  const url = detailUrl(source, page.url());
  if (!url) throw new Error('ابتدا در مرورگر خودت صفحهٔ یک آگهی دیوار یا شیپور را باز کن.');
  const enteredPhone = cleanText(req.body.phone, 32);
  let phone: string | null = null;
  let contactBasis = '';
  if (enteredPhone) {
    if (req.body.contactBasis !== 'direct-consent' && req.body.contactBasis !== 'public-business') {
      throw new Error('برای ثبت شماره، مبنای مجاز ارتباط را انتخاب کن.');
    }
    if (req.body.contactConfirmed !== true) throw new Error('تأیید دستیِ مجاز بودن ثبت شماره لازم است.');
    phone = normalizeIranianPhone(enteredPhone);
    if (!phone) throw new Error('شمارهٔ تماس ایرانی معتبر نیست.');
    contactBasis = req.body.contactBasis;
  }
  const result = await captureCurrentDetail(source, page, {
    title: cleanText(req.body.title, 240),
    topic: cleanText(req.body.topic, 80), city: cleanText(req.body.city, 80),
    region: cleanText(req.body.region, 80), note: cleanText(req.body.note, 2000),
    phone, contact_basis: contactBasis, contact_source: phone ? 'manual' : '',
  });
  res.status(result.duplicate ? 200 : 201).json({ ad: result.ad, duplicate: Boolean(result.duplicate) });
});
app.get('/api/listings', (req, res) => {
  res.json({ listings: getAds({ source: String(req.query.source ?? ''), status: String(req.query.status ?? ''), search: cleanText(req.query.search, 80),runId:String(req.query.runId??''),phoneOnly:req.query.phoneOnly==='1' }) });
});
app.post('/api/listings/:id/enrich', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('شناسه نامعتبر است.');
  const ad = getAd(id);
  if (!ad) { res.status(404).json({ error: 'آگهی پیدا نشد.' }); return; }
  const page = await openDetail(ad.source, ad.url);
  res.json(await captureCurrentDetail(ad.source, page));
});
app.post('/api/listings/:id/reveal-contact',async(req,res)=>{
  if(req.body.confirmed!==true||!['direct-consent','public-business'].includes(req.body.basis))throw new Error('تأیید و مبنای مجاز ثبت تماس لازم است.');
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)throw new Error('شناسه نامعتبر است.');
  const ad=getAd(id);if(!ad)return res.status(404).json({error:'آگهی پیدا نشد.'});
  const result=await requestSelectedContact(ad.source,String(req.body.basis),ad.url,async()=>{
    const existing=(await tabs(ad.source)).find(tab=>detailUrl(ad.source,tab.url)===ad.url);
    return existing?selectedPage(ad.source,existing.index):await openDetail(ad.source,ad.url);
  });
  return res.json(result);
});
app.patch('/api/listings/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('شناسه نامعتبر است.');
  const status = String(req.body.status ?? 'new');
  if (!['new', 'reviewing', 'contacted', 'done'].includes(status)) throw new Error('وضعیت نامعتبر است.');
  const ad = updateAd(id, status, cleanText(req.body.note, 2000));
  if (!ad) { res.status(404).json({ error: 'آگهی پیدا نشد.' }); return; }
  res.json({ ad });
});
app.get('/api/export.csv', (req, res) => {
  const csv = adsCsv(getAds({ source: String(req.query.source ?? ''), status: String(req.query.status ?? ''), search: cleanText(req.query.search, 80),runId:String(req.query.runId??''),phoneOnly:exportPhoneOnly(req.query.phoneOnly) }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="saved-ads.csv"');
  res.send(csv);
});
app.get('/api/export.xlsx',async(req,res)=>{
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="saved-ads.xlsx"');
  res.send(await adsWorkbook(getAds({source:String(req.query.source??''),status:String(req.query.status??''),search:cleanText(req.query.search,80),runId:String(req.query.runId??''),phoneOnly:exportPhoneOnly(req.query.phoneOnly)})));
});
app.get('/api/export.json', (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="saved-ads.json"');
  res.json({ format: 'lead-radar-local-ads-v1', items: getAds() });
});
app.get('/',async(_req,res,next)=>{try{const health=await fetch('http://127.0.0.1:4300/api/health',{signal:AbortSignal.timeout(1500)});if(health.ok)return res.redirect('http://127.0.0.1:4300/');}catch{}next();});
app.get('/legacy',(_req,res)=>res.sendFile(resolve('src/companion/ui/index.html')));
app.use(express.static(resolve('src/companion/ui')));
app.get('/{*path}', (_req, res) => res.sendFile(resolve('src/companion/ui/index.html')));
const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const message = error instanceof Error ? error.message : 'خطای نامشخص';
  console.error('[companion]', message);
  res.status(400).json({ error: message });
};
app.use(errors);

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Lead Radar Companion: http://127.0.0.1:${port}`);
});
async function shutdown() {
  await closeAllBrowsers();
  db.close();
  server.close();
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

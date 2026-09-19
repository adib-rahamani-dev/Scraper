import { lookup } from 'node:dns/promises';
import { extractPage, scoreLead } from './extractor.js';
import { getProject, getRun, insertLead, setProjectStatus, updateRun } from './db.js';
import { isSafeCrawlPath, isSameSite, validatePublicUrl } from './policy.js';
import { resolveAdapter } from './adapters.js';

const activeJobs = new Map<number, AbortController>();
const pendingJobs: number[] = [];
const robotsCache = new Map<string, { at: number; text: string }>();
const userAgent = process.env.CRAWLER_USER_AGENT ?? 'LeadRadar/0.1 (+local research tool; respects robots.txt)';
const maxConcurrentJobs = Math.max(1, Math.min(4, Number(process.env.MAX_CONCURRENT_JOBS ?? 1)));

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
  });
}

async function assertPublicDns(url: URL): Promise<void> {
  const results = await lookup(url.hostname, { all: true });
  for (const result of results) {
    const host = result.family === 6 ? `[${result.address}]` : result.address;
    validatePublicUrl(`${url.protocol}//${host}`);
  }
}

async function safeFetch(url: URL, init: RequestInit, maxRedirects = 5): Promise<Response> {
  const root = url;
  let current = url;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await assertPublicDns(current);
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    const next = validatePublicUrl(new URL(location, current).toString());
    if (!isSameSite(next, root)) throw new Error('تغییر مسیر به دامنه دیگر مجاز نیست');
    current = next;
  }
  throw new Error('تعداد تغییر مسیر بیش از حد مجاز است');
}

function pathMatchesRobots(rule: string, path: string): boolean {
  if (!rule) return false;
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$');
  return new RegExp(`^${escaped}`).test(path);
}

async function robotsAllows(url: URL, signal: AbortSignal): Promise<boolean> {
  const origin = url.origin;
  let cached = robotsCache.get(origin);
  if (!cached || Date.now() - cached.at > 60 * 60 * 1000) {
    try {
      const response = await safeFetch(new URL(`${origin}/robots.txt`), { headers: { 'user-agent': userAgent }, signal });
      cached = { at: Date.now(), text: response.ok ? await response.text() : '' };
    } catch {
      cached = { at: Date.now(), text: '' };
    }
    robotsCache.set(origin, cached);
  }
  const groups = cached.text.split(/(?=^user-agent\s*:)/gim);
  const applicable = groups.filter((group) => /user-agent\s*:\s*(?:\*|leadradar)/i.test(group));
  const path = `${url.pathname}${url.search}`;
  const rules = applicable.flatMap((group) => [...group.matchAll(/^\s*(allow|disallow)\s*:\s*(.*?)\s*$/gim)].map((match) => ({ allow: match[1]!.toLowerCase() === 'allow', path: match[2]! })));
  const matches = rules.filter((rule) => pathMatchesRobots(rule.path, path)).sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.allow ?? true;
}

async function fetchHtml(url: URL, signal: AbortSignal): Promise<string> {
  const response = await safeFetch(url, {
    signal,
    headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml', 'accept-language': 'fa-IR,fa;q=0.9,en;q=0.5' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('صفحه HTML نیست');
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > 2_500_000) throw new Error('حجم صفحه بیش از حد مجاز است');
  const html = await response.text();
  if (html.length > 2_500_000) throw new Error('حجم صفحه بیش از حد مجاز است');
  return html;
}

export function isRunActive(runId: number): boolean { return activeJobs.has(runId) || pendingJobs.includes(runId); }

export function cancelRun(runId: number): boolean {
  const controller = activeJobs.get(runId);
  if (controller) {
    controller.abort();
    return true;
  }
  const queuedIndex = pendingJobs.indexOf(runId);
  if (queuedIndex < 0) return false;
  pendingJobs.splice(queuedIndex, 1);
  updateRun(runId, { status: 'cancelled', finishedAt: new Date().toISOString(), message: 'اجرا پیش از شروع لغو شد' });
  return true;
}

export function startRun(runId: number): void {
  if (isRunActive(runId)) return;
  pendingJobs.push(runId);
  pumpQueue();
}

function pumpQueue(): void {
  while (activeJobs.size < maxConcurrentJobs && pendingJobs.length) {
    const runId = pendingJobs.shift()!;
    const controller = new AbortController();
    activeJobs.set(runId, controller);
    void executeRun(runId, controller.signal).finally(() => {
      activeJobs.delete(runId);
      pumpQueue();
    });
  }
}

async function executeRun(runId: number, signal: AbortSignal): Promise<void> {
  const run = getRun(runId);
  const project = run ? getProject(run.projectId) : null;
  if (!run || !project) return;
  setProjectStatus(project.id, 'running');
  updateRun(runId, { status: 'running', startedAt: new Date().toISOString(), progress: 2, message: 'در حال بررسی قوانین منبع…' });
  let pagesScanned = 0;
  let leadsFound = 0;
  let duplicatesSkipped = 0;
  let blockedPages = 0;
  let lastPageError = '';
  try {
    const root = validatePublicUrl(project.targetUrl);
    const adapter = resolveAdapter(root, project.source);
    const queue: URL[] = [root];
    const visited = new Set<string>();
    while (queue.length && pagesScanned < project.maxPages) {
      if (signal.aborted) throw new Error('cancelled');
      const current = queue.shift()!;
      const key = current.toString().replace(/\/$/, '');
      if (visited.has(key)) continue;
      visited.add(key);
      if (!isSameSite(current, root) || !isSafeCrawlPath(current)) continue;
      const allowed = await robotsAllows(current, signal);
      if (!allowed) {
        blockedPages++;
        lastPageError = `robots.txt دسترسی به ${current.pathname} را مجاز نمی‌داند`;
        updateRun(runId, { blockedPages, message: 'یک صفحه طبق robots.txt کنار گذاشته شد' });
        continue;
      }
      try {
        const html = await fetchHtml(current, signal);
        const data = extractPage(html, current);
        pagesScanned++;
        const candidates = data.leadCandidates.length ? data.leadCandidates : [{
          title: data.title, description: data.description, phones: data.phones, city: data.city,
          category: data.category, url: current, isBusiness: data.isBusiness,
        }];
        if (adapter.isLikelyDetail(current) || data.phones.length || data.leadCandidates.length) {
          for (const candidate of candidates) for (const phone of candidate.phones) {
            const inserted = insertLead({
              projectId: project.id, runId, source: adapter.id, title: candidate.title, phone,
              city: candidate.city || project.city, category: candidate.category, url: candidate.url.toString(),
              score: scoreLead(candidate, project.keywords, project.city), isBusiness: candidate.isBusiness,
            });
            if (inserted) leadsFound++; else duplicatesSkipped++;
          }
        }
        const eligibleLinks = data.links.filter((link) => isSameSite(link, root) && isSafeCrawlPath(link) && adapter.shouldFollow(link));
        eligibleLinks.sort((a, b) => Number(adapter.isLikelyDetail(b)) - Number(adapter.isLikelyDetail(a)));
        for (const link of eligibleLinks) {
          if (queue.length + visited.size >= project.maxPages * 5) break;
          if (!visited.has(link.toString().replace(/\/$/, ''))) queue.push(link);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        blockedPages++;
        const reason = error instanceof Error ? error.message : 'خطای ناشناخته دریافت صفحه';
        lastPageError = `${current.hostname}: ${reason}`;
        updateRun(runId, { blockedPages, message: `خطا در دریافت صفحه: ${reason}` });
      }
      const progress = Math.min(96, Math.max(5, Math.round((pagesScanned / project.maxPages) * 100)));
      updateRun(runId, { pagesScanned, leadsFound, duplicatesSkipped, blockedPages, progress, message: `بررسی ${pagesScanned} صفحه • ${leadsFound} سرنخ تازه` });
      if (queue.length && pagesScanned < project.maxPages) await wait(project.delayMs, signal);
    }
    if (pagesScanned === 0) throw new Error(lastPageError ? `هیچ صفحه‌ای دریافت نشد — ${lastPageError}` : 'هیچ صفحه‌ای برای بررسی در دسترس نبود');
    updateRun(runId, { status: 'completed', progress: 100, pagesScanned, leadsFound, duplicatesSkipped, blockedPages, finishedAt: new Date().toISOString(), message: leadsFound ? 'خزش با موفقیت تکمیل شد' : 'اجرا کامل شد؛ در HTML عمومی این منبع شماره‌ای دیده نشد' });
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof Error && error.message === 'cancelled');
    updateRun(runId, { status: cancelled ? 'cancelled' : 'failed', pagesScanned, leadsFound, duplicatesSkipped, blockedPages, finishedAt: new Date().toISOString(), message: cancelled ? 'اجرا توسط کاربر متوقف شد' : error instanceof Error ? error.message : 'خطای ناشناخته' });
  } finally {
    setProjectStatus(project.id, 'ready');
  }
}

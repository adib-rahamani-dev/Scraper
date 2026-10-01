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
const manualOnlySources = new Set(['divar', 'sheypoor']);

class SourceAccessError extends Error {}
class ManualSourceError extends SourceAccessError {}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
}

function matchesProjectTopic(candidate: { title: string; description: string; category: string }, keywords: string[]): boolean {
  if (!keywords.length) return true;
  // A broad category/breadcrumb can describe the search page rather than the
  // individual listing. Relevance must therefore be proven by the ad title.
  const haystack = normalizeForMatch(candidate.title);
  const synonymGroups: Record<string, string[]> = {
    'موبایل': ['موبایل', 'گوشی', 'تلفن همراه', 'اسمارت فون', 'آیفون', 'سامسونگ', 'شیائومی'],
    'خودرو': ['خودرو', 'ماشین', 'اتومبیل'],
    'املاک': ['املاک', 'ملک', 'آپارتمان', 'خانه', 'زمین'],
  };
  return keywords.some((keyword) => {
    const normalized = normalizeForMatch(keyword);
    const alternatives = synonymGroups[normalized] ?? [normalized];
    return alternatives.some((term) => term.length >= 2 && haystack.includes(term));
  });
}

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
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
    const response = await fetch(current, { ...init, signal, redirect: 'manual' });
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
      if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
      cached = { at: Date.now(), text: response.ok ? await response.text() : '' };
    } catch {
      throw new SourceAccessError('قوانین robots.txt منبع در دسترس نیست؛ خزش برای احتیاط متوقف شد');
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
  if ([401, 403, 429].includes(response.status)) throw new SourceAccessError(`منبع دسترسی را محدود کرده است (HTTP ${response.status})؛ اجرا متوقف شد`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('صفحه HTML نیست');
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > 2_500_000) throw new Error('حجم صفحه بیش از حد مجاز است');
  const html = await response.text();
  if (html.length > 2_500_000) throw new Error('حجم صفحه بیش از حد مجاز است');
  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  if (/(?:captcha|کپچا|ورود به حساب|تأیید هویت|login|sign in)/i.test(pageTitle)) {
    throw new SourceAccessError('صفحه ورود یا چالش امنیتی نمایش داده شد؛ اجرا متوقف شد');
  }
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

export async function runNow(runId: number): Promise<void> {
  if (isRunActive(runId)) return;
  const controller = new AbortController();
  activeJobs.set(runId, controller);
  try {
    await executeRun(runId, controller.signal);
  } finally {
    activeJobs.delete(runId);
  }
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
    if (manualOnlySources.has(adapter.id) || manualOnlySources.has(project.source)
      || /(^|\.)(?:divar\.ir|sheypoor\.com)$/i.test(root.hostname)) {
      throw new ManualSourceError('این منبع برای شماره‌های محافظت‌شده نیازمند دسترسی رسمی است؛ صفحه هدف را برای بررسی دستی باز کنید. کد تأیید را در سایت اصلی وارد کنید.');
    }
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
        const candidates = data.leadCandidates.length ? data.leadCandidates : adapter.id === 'iran-tejarat' ? [] : [{
          title: data.title, description: data.description, phones: data.phones, city: data.city,
          category: data.category, url: current, isBusiness: data.isBusiness,
        }];
        if (adapter.isLikelyDetail(current) || data.phones.length || data.leadCandidates.length) {
          for (const candidate of candidates) {
            if (!matchesProjectTopic(candidate, project.keywords)) continue;
            for (const phone of candidate.phones) {
            const inserted = insertLead({
              projectId: project.id, runId, source: adapter.id, title: candidate.title, phone,
              city: candidate.city || project.city, category: candidate.category, url: candidate.url.toString(),
              score: scoreLead(candidate, project.keywords, project.city), isBusiness: candidate.isBusiness,
            });
            if (inserted) leadsFound++; else duplicatesSkipped++;
          }
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
        if (error instanceof SourceAccessError) throw error;
        blockedPages++;
        const reason = error instanceof Error ? error.message : 'خطای ناشناخته دریافت صفحه';
        lastPageError = `${current.hostname}: ${reason}`;
        updateRun(runId, { blockedPages, message: `خطا در دریافت صفحه: ${reason}` });
      }
      const progress = Math.min(96, Math.max(5, Math.round((pagesScanned / project.maxPages) * 100)));
      updateRun(runId, { pagesScanned, leadsFound, duplicatesSkipped, blockedPages, progress, message: `بررسی ${pagesScanned} صفحه • ${leadsFound} سرنخ تازه` });
      if (queue.length && pagesScanned < project.maxPages) await wait(Math.max(20_000, project.delayMs) + Math.floor(Math.random() * 10_001), signal);
    }
    if (pagesScanned === 0) throw new Error(lastPageError ? `هیچ صفحه‌ای دریافت نشد — ${lastPageError}` : 'هیچ صفحه‌ای برای بررسی در دسترس نبود');
    updateRun(runId, { status: 'completed', progress: 100, pagesScanned, leadsFound, duplicatesSkipped, blockedPages, finishedAt: new Date().toISOString(), message: leadsFound ? 'خزش با موفقیت تکمیل شد' : 'اجرا کامل شد؛ در HTML عمومی این منبع شماره‌ای دیده نشد' });
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof Error && error.message === 'cancelled');
    updateRun(runId, { status: cancelled ? 'cancelled' : error instanceof ManualSourceError ? 'skipped' : 'failed', progress: error instanceof ManualSourceError ? 100 : undefined, pagesScanned, leadsFound, duplicatesSkipped, blockedPages, finishedAt: new Date().toISOString(), message: cancelled ? 'اجرا توسط کاربر متوقف شد' : error instanceof Error ? error.message : 'خطای ناشناخته' });
  } finally {
    setProjectStatus(project.id, 'ready');
  }
}

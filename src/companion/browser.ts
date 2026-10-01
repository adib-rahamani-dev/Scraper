import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { detailUrl, homepages, type BrowserSource } from './policy.js';
import { captureCurrentDetail, captureCurrentSearch, captureVisibleContact } from './capture.js';

const contexts = new Map<BrowserSource, BrowserContext>();
const launches = new Map<BrowserSource, Promise<BrowserContext>>();
const overlayScript = readFileSync(resolve('src/companion/overlay.js'), 'utf8');

export async function openBrowser(source: BrowserSource): Promise<BrowserContext> {
  const current = contexts.get(source);
  if (current) return current;
  const launching = launches.get(source);
  if (launching) return launching;
  const start = (async () => {
    const profile = resolve('data/browser-profiles', source);
    mkdirSync(profile, { recursive: true });
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chrome', headless: false, viewport: null,
        args: ['--start-maximized'],
      });
    } catch (chromeError) {
      try {
        context = await chromium.launchPersistentContext(profile, {
          channel: 'msedge', headless: false, viewport: null,
          args: ['--start-maximized'],
        });
      } catch {
        throw new Error(`مرورگر Chrome یا Edge نصب‌شده پیدا نشد یا پروفایل باز است. ${String(chromeError)}`);
      }
    }
    contexts.set(source, context);
    context.on('close', () => contexts.delete(source));
    await context.exposeBinding('__leadRadarBridge', async ({ page }, command: unknown) => {
      if (command === 'detail') return captureCurrentDetail(source, page);
      if (command === 'search') return captureCurrentSearch(source, page);
      if (command && typeof command === 'object' && 'kind' in command && command.kind === 'contact' && 'basis' in command && 'confirmed' in command && command.confirmed === true) {
        return captureVisibleContact(source, page, String(command.basis));
      }
      throw new Error('دستور نامعتبر است.');
    });
    await context.addInitScript({ content: overlayScript });
    await Promise.all(context.pages().map(page => page.evaluate(overlayScript).catch(() => {})));
    const page = context.pages()[0] ?? await context.newPage();
    if (page.url() === 'about:blank') {
      try { await page.goto(homepages[source], { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
      catch { /* The visible browser remains available when the site is unreachable. */ }
    }
    return context;
  })();
  launches.set(source, start);
  try { return await start; }
  finally { launches.delete(source); }
}

export function browserOpen(source: BrowserSource): boolean {
  return contexts.has(source);
}

export async function closeBrowser(source: BrowserSource): Promise<void> {
  await contexts.get(source)?.close();
  contexts.delete(source);
}

export async function closeAllBrowsers(): Promise<void> {
  await Promise.all([...contexts.keys()].map(closeBrowser));
}

export async function tabs(source: BrowserSource): Promise<Array<{ index: number; title: string; url: string; eligible: boolean; overlay: boolean }>> {
  const context = contexts.get(source);
  if (!context) return [];
  return Promise.all(context.pages().map(async (page, index) => ({
    index,
    title: (await page.title().catch(() => 'بدون عنوان')).slice(0, 180),
    url: page.url(),
    eligible: Boolean(detailUrl(source, page.url())),
    overlay: await page.locator('#lead-radar-floating-panel').count().then(count => count > 0).catch(() => false),
  })));
}

export function selectedPage(source: BrowserSource, tabIndex: number): Page {
  const context = contexts.get(source);
  if (!context) throw new Error('مرورگر این منبع هنوز باز نشده است.');
  const page = context.pages()[tabIndex];
  if (!page || page.isClosed()) throw new Error('برگه انتخاب‌شده پیدا نشد.');
  return page;
}

export async function navigateSearch(source: BrowserSource, url: string): Promise<string> {
  const context = await openBrowser(source);
  const page = context.pages().at(-1) ?? await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.bringToFront();
  return page.url();
}

export async function openDetail(source: BrowserSource, input: string): Promise<Page> {
  const url = detailUrl(source, input);
  if (!url) throw new Error('لینک آگهی معتبر نیست.');
  const context = await openBrowser(source);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.bringToFront();
  return page;
}

export async function startOfficialLogin(source: BrowserSource, phone=''): Promise<string> {
  const context = await openBrowser(source);
  const page = context.pages().at(-1) ?? await context.newPage();
  await page.bringToFront();
  if(source==='sheypoor') {
    await page.goto('https://www.sheypoor.com/session/myAccount/myListings/all',{waitUntil:'domcontentloaded',timeout:30_000});
    await page.locator('input[name="username"], input[autocomplete="one-time-code"], main a[href*="myListings"]').first().waitFor({state:'visible',timeout:15000}).catch(()=>{});
  }
  await page.evaluate(readFileSync(resolve('extension/login.js'),'utf8'));
  const result=await page.evaluate(async number=>await (globalThis as unknown as {LeadRadarLogin:{login:(phone:string)=>Promise<{state:string;message:string}>}}).LeadRadarLogin.login(number),phone);
  return result.message;
}

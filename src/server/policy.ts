import { isIP } from 'node:net';

const blockedHostnames = new Set(['localhost', 'localhost.localdomain', '0.0.0.0']);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

export function validatePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('لینک هدف معتبر نیست.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('فقط لینک HTTP یا HTTPS مجاز است.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const ipHostname = hostname.replace(/^\[|\]$/g, '');
  if (blockedHostnames.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('نشانی‌های محلی یا داخلی قابل خزش نیستند.');
  }
  if (isIP(ipHostname) && (isPrivateIpv4(ipHostname) || ipHostname === '::1' || ipHostname.startsWith('fc') || ipHostname.startsWith('fd') || ipHostname.startsWith('fe80'))) {
    throw new Error('آدرس IP خصوصی قابل خزش نیست.');
  }
  if (url.username || url.password) throw new Error('لینک دارای نام کاربری یا رمز عبور مجاز نیست.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('فقط پورت‌های استاندارد وب مجاز هستند.');
  url.hash = '';
  return url;
}

export function isSameSite(candidate: URL, root: URL): boolean {
  const normalize = (host: string) => host.toLowerCase().replace(/^www\./, '');
  return normalize(candidate.hostname) === normalize(root.hostname);
}

export function isSafeCrawlPath(url: URL): boolean {
  const value = `${url.pathname}${url.search}`.toLowerCase();
  const blocked = ['/login', '/signin', '/signup', '/register', '/account', '/profile', '/settings', '/logout', '/payment', '/checkout', '/delete', '/edit', '/create', '/new-ad', '/post-ad'];
  return !blocked.some((part) => value.includes(part));
}

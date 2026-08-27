/**
 * First-party cookie access.
 *
 * Writes are attempted on the registrable-domain first so the referral survives
 * across subdomains, then verified: on public-suffix hosts (`*.vercel.app`,
 * `*.github.io`, ...) the browser silently drops the domained cookie, so we
 * fall back to a host-only cookie.
 */

export function getRootDomain(): string | null {
  const hostname = location.hostname;

  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return null;
  }

  const segments = hostname.split('.');
  return segments.length > 2 ? '.' + segments.slice(-2).join('.') : '.' + hostname;
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'),
  );
  const value = match ? match[1] : undefined;
  return value === undefined ? null : decodeURIComponent(value);
}

export function setCookie(name: string, value: string, days: number): void {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 86400000);

  const base = [
    name + '=' + encodeURIComponent(value),
    'expires=' + expires.toUTCString(),
    'path=/',
    'samesite=lax',
  ];

  if (location.protocol === 'https:') {
    base.push('secure');
  }

  const domain = getRootDomain();
  if (domain) {
    document.cookie = base.concat('domain=' + domain).join('; ');
    if (getCookie(name) === value) {
      return;
    }
  }

  document.cookie = base.join('; ');
}

export function deleteCookie(name: string): void {
  const base = [name + '=', 'expires=Thu, 01 Jan 1970 00:00:00 GMT', 'path=/'];

  document.cookie = base.join('; ');

  const domain = getRootDomain();
  if (domain) {
    document.cookie = base.concat('domain=' + domain).join('; ');
  }
}

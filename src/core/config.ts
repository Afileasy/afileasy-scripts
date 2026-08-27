import { CDN_HOSTS, FALLBACK_API_URL } from './constants';

export interface RuntimeConfig {
  publicKey: string | null;
  apiUrl: string;
}

export const config: RuntimeConfig = {
  publicKey: null,
  apiUrl: FALLBACK_API_URL,
};

export function findInstallScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>('script[data-afileasy]');
}

/**
 * Resolves the API base URL, in order:
 *   1. explicit `data-api-url` attribute
 *   2. the origin serving the script — self-hosted installs talk to their own
 *      backend. Known CDN hosts are excluded, otherwise the script would try to
 *      call the CDN itself.
 *   3. the build-time default.
 */
export function resolveApiUrl(scriptEl: HTMLScriptElement): string {
  const override = scriptEl.getAttribute('data-api-url');
  if (override && override.trim()) {
    return override.trim().replace(/\/+$/, '');
  }

  try {
    const src = scriptEl.src || scriptEl.getAttribute('src') || '';
    if (src) {
      const url = new URL(src, location.href);
      if (CDN_HOSTS.indexOf(url.hostname) === -1) {
        return url.origin + '/api/v1';
      }
    }
  } catch {
    // Malformed src — fall through to the default endpoint.
  }

  return FALLBACK_API_URL;
}

/**
 * Afileasy — Zouti plugin (optional).
 *
 * Zouti's checkout accepts no scripts and its webhook carries no metadata, so
 * the only channel from the click to the paid order is the checkout's
 * `utm_data`, captured from the checkout URL. This plugin, loaded on the
 * merchant's sales page, stamps the referral id as `utm_term` on every link to
 * the Zouti checkout; the order webhook brings it back.
 *
 * Load after the core script.
 */
const CHECKOUT_DOMAIN = 'zouti.com.br';
const LINK_PARAM = 'utm_term';

/** Re-runs after page builders have had time to render their buttons. */
const RETRY_DELAYS = [800, 2000, 4000];

function getReferralId(): string | null {
  const api = window.Afileasy;
  if (api && typeof api.getReferral === 'function') {
    return api.getReferral();
  }
  return null;
}

function isCheckoutHost(hostname: string): boolean {
  return hostname === CHECKOUT_DOMAIN || hostname.slice(-(CHECKOUT_DOMAIN.length + 1)) === '.' + CHECKOUT_DOMAIN;
}

function patch(): void {
  const eventId = getReferralId();
  if (!eventId) {
    return;
  }

  const links = document.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link || !isCheckoutHost(link.hostname)) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }

    if (url.searchParams.get(LINK_PARAM) === eventId) {
      continue;
    }

    url.searchParams.set(LINK_PARAM, eventId);
    link.href = url.toString();
  }
}

for (const delay of RETRY_DELAYS) {
  setTimeout(patch, delay);
}

document.addEventListener('afileasy:ready', patch);

export {};

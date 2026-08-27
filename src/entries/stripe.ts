/**
 * Afileasy — Stripe plugin (optional).
 *
 * Stamps the referral id onto Stripe checkouts so the webhook can attribute the
 * sale to the right affiliate:
 *   • Payment Links → adds ?client_reference_id=<id> to a[href*="buy.stripe.com"]
 *   • Buy Button    → sets client-reference-id on <stripe-buy-button>
 *
 * Load after the core script.
 */
const LINK_SELECTOR = 'a[href*="buy.stripe.com"]';
const LINK_PARAM = 'client_reference_id';
const BUTTON_SELECTOR = 'stripe-buy-button';
const BUTTON_ATTR = 'client-reference-id';

/** Re-runs after Stripe's own embed script has had time to render. */
const RETRY_DELAYS = [800, 2000, 4000];

function getReferralId(): string | null {
  const api = window.Afileasy;
  if (api && typeof api.getReferral === 'function') {
    return api.getReferral();
  }
  return null;
}

function patch(): void {
  const eventId = getReferralId();
  if (!eventId) {
    return;
  }

  const links = document.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR);
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link || link.href.indexOf(LINK_PARAM) !== -1) {
      continue;
    }
    const glue = link.href.indexOf('?') === -1 ? '?' : '&';
    link.href += glue + LINK_PARAM + '=' + encodeURIComponent(eventId);
  }

  const buttons = document.querySelectorAll<HTMLElement>(BUTTON_SELECTOR);
  for (let j = 0; j < buttons.length; j++) {
    buttons[j]?.setAttribute(BUTTON_ATTR, eventId);
  }
}

for (const delay of RETRY_DELAYS) {
  setTimeout(patch, delay);
}

document.addEventListener('afileasy:ready', patch);

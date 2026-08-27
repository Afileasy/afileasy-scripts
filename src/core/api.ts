import { COOKIE_NAME, COUPON_COOKIE_NAME, VERSION } from './constants';
import { deleteCookie, getCookie } from './cookie';
import { dispatch } from './events';
import { bindLeadForms, trackLead } from './lead';
import { appendRef, applyHiddenFields, findReferralInUrl } from './referral';
import type { AfileasyApi, ReadyEventDetail } from '../types/public';

/**
 * Publishes `window.Afileasy`, wires the declarative integrations and fires
 * `afileasy:ready`. Called exactly once per page load, with the attributed
 * EventLink id when there is one.
 */
export function expose(eventId: string | null): AfileasyApi {
  function getReferral(): string | null {
    return getCookie(COOKIE_NAME) || eventId || null;
  }

  function getReferralCode(): string | null {
    const referral = findReferralInUrl();
    return referral ? referral.code : null;
  }

  /**
   * Read from the cookie rather than from this page's click response: a visitor
   * who landed through the affiliate link earlier still gets the coupon on the
   * page where they finally check out.
   */
  function getCoupon(): string | null {
    return getCookie(COUPON_COOKIE_NAME);
  }

  const api: AfileasyApi = {
    getReferral,
    getReferralCode,
    getCoupon,
    appendRef,
    applyHiddenFields,
    trackLead,
    clear() {
      deleteCookie(COOKIE_NAME);
      deleteCookie(COUPON_COOKIE_NAME);
    },
    version: VERSION,
  };

  window.Afileasy = api;

  applyHiddenFields();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyHiddenFields);
  }

  bindLeadForms();

  dispatch<ReadyEventDetail>('afileasy:ready', { eventId: getReferral() });

  return api;
}

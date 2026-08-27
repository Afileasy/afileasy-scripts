/**
 * Afileasy Referral Tracking Script — entry point.
 *
 * Registers the referral click, stores the EventLink id in a first-party cookie
 * and exposes `window.Afileasy`. See README.md for the install snippet.
 */
import { expose } from '../core/api';
import { config, findInstallScript, resolveApiUrl } from '../core/config';
import { COOKIE_NAME, COUPON_COOKIE_NAME, DEFAULT_COOKIE_DAYS } from '../core/constants';
import { getCookie, setCookie } from '../core/cookie';
import { postJSON } from '../core/http';
import { error, warn } from '../core/log';
import { findReferralInUrl } from '../core/referral';
import type { TrackClickPayload, TrackClickResponse } from '../types/public';

function init(): void {
  const scriptEl = findInstallScript();
  if (!scriptEl) {
    warn('Missing <script data-afileasy="...">. Tracking disabled.');
    return;
  }

  const publicKey = scriptEl.getAttribute('data-afileasy');
  if (!publicKey || !publicKey.trim()) {
    warn('data-afileasy attribute is empty. Tracking disabled.');
    return;
  }

  config.publicKey = publicKey.trim();
  config.apiUrl = resolveApiUrl(scriptEl);

  // Already attributed — keep the first-touch referral, do not overwrite it.
  const existing = getCookie(COOKIE_NAME);
  if (existing) {
    expose(existing);
    return;
  }

  const referral = findReferralInUrl();
  if (!referral) {
    expose(null);
    return;
  }

  const payload: TrackClickPayload = {
    public_key: config.publicKey,
    code: referral.code,
    param: referral.param,
    page: location.href,
    referrer: document.referrer || null,
  };

  postJSON<TrackClickResponse>(config.apiUrl + '/track/click', payload)
    .then((response) => {
      if (response && response.event_id) {
        const days = response.cookie_duration || DEFAULT_COOKIE_DAYS;
        setCookie(COOKIE_NAME, response.event_id, days);

        // Stored beside the referral so a storefront integration can apply the
        // affiliate's coupon at checkout without the customer typing it. Only a
        // resolved code is written: the API sends null when there is none.
        if (response.coupon_code) {
          setCookie(COUPON_COOKIE_NAME, response.coupon_code, days);
        }

        expose(response.event_id);
      } else {
        expose(null);
      }
    })
    .catch((err) => {
      error('Failed to register click:', err);
      expose(null);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

import { COOKIE_NAME, REF_QUERY_PARAM, REFERRAL_PARAMS } from './constants';
import { getCookie } from './cookie';
import type { ReferralMatch } from '../types/public';

export function findReferralInUrl(): ReferralMatch | null {
  const params = new URLSearchParams(location.search);

  for (const param of REFERRAL_PARAMS) {
    const value = params.get(param);
    if (value && value.trim()) {
      return { param, code: value.trim() };
    }
  }

  return null;
}

export function applyHiddenFields(): void {
  const value = getCookie(COOKIE_NAME);
  if (!value) {
    return;
  }

  const inputs = document.querySelectorAll<HTMLInputElement>('[data-afileasy-ref]');
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (input) {
      input.value = value;
    }
  }
}

export function appendRef(url: string): string {
  const value = getCookie(COOKIE_NAME);
  if (!value) {
    return url;
  }

  try {
    const parsed = new URL(url, location.origin);
    parsed.searchParams.set(REF_QUERY_PARAM, value);
    return parsed.toString();
  } catch {
    return url;
  }
}

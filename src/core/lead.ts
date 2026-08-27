import { COOKIE_NAME, LOG_PREFIX } from './constants';
import { config } from './config';
import { getCookie } from './cookie';
import { dispatch } from './events';
import { postJSON } from './http';
import { error } from './log';
import { findReferralInUrl } from './referral';
import type {
  LeadEventDetail,
  LeadInput,
  RequestOptions,
  TrackLeadPayload,
  TrackLeadResponse,
} from '../types/public';

function resolveLeadUrl(): string {
  return config.apiUrl.replace(/\/v1$/, '') + '/track/lead';
}

/**
 * Registers a lead against the current referral.
 *
 * Resolves with `null` (not an error) when the visit carries no referral —
 * unattributed signups are a normal outcome, not a failure.
 */
export function trackLead(
  data?: LeadInput,
  options?: RequestOptions,
): Promise<TrackLeadResponse | null> {
  const input = data || ({} as LeadInput);

  if (!input.email || !String(input.email).trim()) {
    return Promise.reject(new Error(LOG_PREFIX + ' trackLead requires an email.'));
  }

  if (!config.publicKey) {
    return Promise.reject(new Error(LOG_PREFIX + ' trackLead unavailable: missing public key.'));
  }

  const urlReferral = findReferralInUrl();
  const code = getCookie(COOKIE_NAME) || (urlReferral && urlReferral.code);
  if (!code) {
    return Promise.resolve(null);
  }

  const payload: TrackLeadPayload = {
    public_key: config.publicKey,
    code,
    email: String(input.email).trim(),
    name: input.name ? String(input.name).trim() : null,
  };

  return postJSON<TrackLeadResponse>(resolveLeadUrl(), payload, options).then((response) => {
    dispatch<LeadEventDetail>('afileasy:lead', {
      customerId: response && response.customer_id,
      email: payload.email,
    });
    return response;
  });
}

interface LeadFields {
  email: string | null;
  name: string | null;
}

function extractLeadFields(form: HTMLFormElement): LeadFields {
  const emailInput =
    form.querySelector<HTMLInputElement>('[data-afileasy-email]') ||
    form.querySelector<HTMLInputElement>('input[type="email"]');
  const nameInput =
    form.querySelector<HTMLInputElement>('[data-afileasy-name]') ||
    form.querySelector<HTMLInputElement>('input[name="name"]');

  return {
    email: emailInput && emailInput.value ? emailInput.value.trim() : null,
    name: nameInput && nameInput.value ? nameInput.value.trim() : null,
  };
}

/**
 * Captures `<form data-afileasy-lead>` submissions. Listens on the capture
 * phase so the lead is sent even when the page cancels the submit, and never
 * blocks the submission itself.
 */
export function bindLeadForms(): void {
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || typeof form.hasAttribute !== 'function' || !form.hasAttribute('data-afileasy-lead')) {
        return;
      }

      const fields = extractLeadFields(form);
      if (!fields.email) {
        return;
      }

      trackLead({ email: fields.email, name: fields.name }, { keepalive: true }).catch((err) => {
        error('Failed to register lead:', err);
      });
    },
    true,
  );
}

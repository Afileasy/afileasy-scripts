import type { AfileasyApi, LeadEventDetail, ReadyEventDetail } from './public';

declare global {
  interface Window {
    Afileasy?: AfileasyApi;
  }

  interface DocumentEventMap {
    'afileasy:ready': CustomEvent<ReadyEventDetail>;
    'afileasy:lead': CustomEvent<LeadEventDetail>;
  }

  /** Injected by scripts/build.mjs from package.json. */
  const __AFILEASY_VERSION__: string;
  /** Injected by scripts/build.mjs — API base used when the host is a known CDN. */
  const __AFILEASY_API_URL__: string;
  /** Injected by scripts/build.mjs — hosts that must never be treated as the API origin. */
  const __AFILEASY_CDN_HOSTS__: readonly string[];
}

export {};

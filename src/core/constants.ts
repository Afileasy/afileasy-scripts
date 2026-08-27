export const COOKIE_NAME = 'afileasy_ref';

/** Coupon the affiliate's link applies on its own, when the API resolves one. */
export const COUPON_COOKIE_NAME = 'afileasy_coupon';

/** Query parameter appended by `appendRef()`. */
export const REF_QUERY_PARAM = 'afileasy_ref';

/** Query parameters scanned for an affiliate code, in priority order. */
export const REFERRAL_PARAMS = ['ref', 'afi', 'aff', 'via'] as const;

export const DEFAULT_COOKIE_DAYS = 30;

export const LOG_PREFIX = '[Afileasy]';

/** Build-time constants — see scripts/build.mjs. */
export const VERSION = __AFILEASY_VERSION__;
export const FALLBACK_API_URL = __AFILEASY_API_URL__;
export const CDN_HOSTS = __AFILEASY_CDN_HOSTS__;

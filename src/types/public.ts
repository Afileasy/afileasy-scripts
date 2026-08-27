/**
 * Public contract of the Afileasy tracking script.
 *
 * Anything exported here is either exposed on `window.Afileasy` or travels over
 * the wire to the Afileasy API, so changes are breaking changes.
 */

export interface LeadInput {
  email: string;
  name?: string | null;
}

export interface RequestOptions {
  /** Let the request outlive the page (used on form submit). */
  keepalive?: boolean;
}

export interface ReferralMatch {
  /** Query-string parameter the code was found in (`ref`, `afi`, ...). */
  param: string;
  code: string;
}

export interface TrackClickPayload {
  public_key: string;
  code: string;
  param: string;
  page: string;
  referrer: string | null;
}

export interface TrackClickResponse {
  event_id?: string;
  /** Cookie lifetime in days, decided by the API. */
  cookie_duration?: number;
  /**
   * Coupon the storefront should apply for this affiliate. Null when the
   * organization has no coupon tracking or the affiliate has no usable code —
   * and absent on APIs that predate coupon autofill.
   */
  coupon_code?: string | null;
}

export interface TrackLeadPayload {
  public_key: string;
  code: string;
  email: string;
  name: string | null;
}

export interface TrackLeadResponse {
  customer_id?: string;
}

export interface ReadyEventDetail {
  eventId: string | null;
}

export interface LeadEventDetail {
  customerId: string | undefined;
  email: string;
}

/** Surface exposed on `window.Afileasy` once the script has booted. */
export interface AfileasyApi {
  /** EventLink id used for attribution, from the cookie or the current click. */
  getReferral(): string | null;
  /** Raw referral code present in the current URL, if any. */
  getReferralCode(): string | null;
  /** Affiliate coupon to apply at checkout, when the API resolved one. */
  getCoupon(): string | null;
  /** Adds `afileasy_ref=<id>` to a URL. Returns the URL untouched when unattributed. */
  appendRef(url: string): string;
  /** Fills every `[data-afileasy-ref]` input with the current referral id. */
  applyHiddenFields(): void;
  /** Registers a lead. Resolves with `null` when the visit is not attributed. */
  trackLead(data: LeadInput, options?: RequestOptions): Promise<TrackLeadResponse | null>;
  /** Removes the tracking cookie. */
  clear(): void;
  readonly version: string;
}

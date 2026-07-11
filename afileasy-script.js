/**
 * Afileasy Referral Tracking Script v1.0.1
 *
 * Tracks affiliate referral clicks, stores the EventLink id in a first-party
 * cookie, and exposes a public API for checkout / payment-gateway integration.
 *
 * Installation (served minified via jsDelivr CDN, pinned to a release tag):
 *   <script src="https://cdn.jsdelivr.net/gh/Afileasy/afileasy-scripts@v1.0.1/afileasy-script.min.js" data-afileasy="YOUR_PUBLIC_KEY"></script>
 *
 * Optional attributes:
 *   data-api-url="https://custom-api.example.com/api/v1"  (override API base URL)
 *
 * Public API (available after the afileasy:ready event):
 *   window.Afileasy.getReferral()      → string | null  (EventLink id for attribution)
 *   window.Afileasy.getReferralCode()  → string | null  (raw referral code from URL)
 *   window.Afileasy.appendRef(url)     → string         (adds afileasy_ref=<id> to a URL)
 *   window.Afileasy.applyHiddenFields()→ void           (fills [data-afileasy-ref] inputs)
 *   window.Afileasy.clear()            → void           (removes tracking cookie)
 *   window.Afileasy.version            → string
 */
(function () {
  'use strict';

  // ─── Configuration ───────────────────────────────────────────────────
  var COOKIE_NAME = 'afileasy_ref';
  var FALLBACK_API_URL = 'https://afileasy.com/api/v1';
  var REFERRAL_PARAMS = ['ref', 'afi', 'aff', 'via'];
  // Public CDN hosts the script may be served from. When loaded from one of
  // these, we must NOT derive the API URL from the script origin (the API
  // does not live on the CDN) — fall back to FALLBACK_API_URL instead.
  var CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'fastly.jsdelivr.net',
    'unpkg.com',
    'cdn.statically.io',
    'raw.githack.com',
    'rawcdn.githack.com',
    'raw.githubusercontent.com',
  ];
  var DEFAULT_COOKIE_DAYS = 30;
  var VERSION = '1.0.1';

  // ─── Cookie Helpers ──────────────────────────────────────────────────

  /**
   * Read a cookie value by name.
   * @param {string} name
   * @returns {string|null}
   */
  function getCookie(name) {
    var match = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Set a first-party cookie.
   * @param {string} name
   * @param {string} value
   * @param {number} days
   */
  function setCookie(name, value, days) {
    var expires = new Date();
    expires.setTime(expires.getTime() + days * 86400000);

    // Attributes shared by both the domain-scoped and host-only variants.
    var base = [
      name + '=' + encodeURIComponent(value),
      'expires=' + expires.toUTCString(),
      'path=/',
      'samesite=lax',
    ];

    // Secure flag only on HTTPS (avoid breaking local dev on HTTP)
    if (location.protocol === 'https:') {
      base.push('secure');
    }

    // Prefer a root-domain cookie so it is shared across subdomains
    // (e.g. example.com ↔ checkout.example.com). But many hosts sit on a
    // public suffix (*.vercel.app, *.github.io, *.pages.dev, *.netlify.app, …)
    // where the browser silently rejects a domain-scoped cookie. Set it, read
    // it back, and fall back to a host-only cookie when the domain variant
    // didn't stick — this avoids shipping the whole Public Suffix List.
    var domain = getRootDomain();
    if (domain) {
      document.cookie = base.concat('domain=' + domain).join('; ');
      if (getCookie(name) === value) {
        return;
      }
    }

    // Host-only fallback (no domain attribute) — always accepted.
    document.cookie = base.join('; ');
  }

  /**
   * Delete a cookie by setting its expiry in the past.
   * @param {string} name
   */
  function deleteCookie(name) {
    var base = [
      name + '=',
      'expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'path=/',
    ];

    // Clear the host-only variant and, when present, the root-domain one —
    // setCookie may have written either, so expire both.
    document.cookie = base.join('; ');

    var domain = getRootDomain();
    if (domain) {
      document.cookie = base.concat('domain=' + domain).join('; ');
    }
  }

  // ─── Domain Helpers ──────────────────────────────────────────────────

  /**
   * Extract the root domain for cookie scope.
   * Returns null for localhost/IP (let browser use the current hostname).
   * @returns {string|null}
   */
  function getRootDomain() {
    var hostname = location.hostname;

    // Localhost or IP address — don't set domain attribute
    if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return null;
    }

    var segments = hostname.split('.');
    // For "app.example.com" → ".example.com"
    // For "example.com" → ".example.com"
    return segments.length > 2
      ? '.' + segments.slice(-2).join('.')
      : '.' + hostname;
  }

  // ─── API URL Resolution ──────────────────────────────────────────────

  /**
   * Resolve the API base URL.
   * Order of precedence:
   *   1. data-api-url attribute (explicit override)
   *   2. the origin the script was served from + "/api/v1"
   *      (skipped when served from a public CDN — the API isn't hosted there)
   *   3. FALLBACK_API_URL
   *
   * Deriving from the script's own src (instead of document.currentScript)
   * keeps it working when the tag is loaded async (e.g. the WooCommerce plugin).
   *
   * @param {HTMLScriptElement} scriptEl
   * @returns {string}
   */
  function resolveApiUrl(scriptEl) {
    var override = scriptEl.getAttribute('data-api-url');
    if (override && override.trim()) {
      return override.trim().replace(/\/+$/, '');
    }

    try {
      var src = scriptEl.src || (scriptEl.getAttribute('src') || '');
      if (src) {
        var url = new URL(src, location.href);
        // Only trust the script origin when it's not a public CDN.
        if (CDN_HOSTS.indexOf(url.hostname) === -1) {
          return url.origin + '/api/v1';
        }
      }
    } catch (e) {
      // fall through to fallback
    }

    return FALLBACK_API_URL;
  }

  // ─── URL Helpers ─────────────────────────────────────────────────────

  /**
   * Find the first matching referral parameter in the current URL.
   * @returns {{ param: string, code: string } | null}
   */
  function findReferralInUrl() {
    var params = new URLSearchParams(location.search);

    for (var i = 0; i < REFERRAL_PARAMS.length; i++) {
      var value = params.get(REFERRAL_PARAMS[i]);
      if (value && value.trim()) {
        return { param: REFERRAL_PARAMS[i], code: value.trim() };
      }
    }

    return null;
  }

  // ─── API ─────────────────────────────────────────────────────────────

  /**
   * Send a POST request with JSON body.
   * Uses fetch (supported by all modern browsers).
   *
   * @param {string} url
   * @param {object} data
   * @returns {Promise<object>}
   */
  function postJSON(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data),
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error('API ' + response.status + ': ' + text);
        });
      }
      return response.json();
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Fill every <input data-afileasy-ref> with the referral id so it travels
   * inside the merchant's order form without any extra JS.
   */
  function applyHiddenFields() {
    var value = getCookie(COOKIE_NAME);
    if (!value) {
      return;
    }
    var inputs = document.querySelectorAll('[data-afileasy-ref]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].value = value;
    }
  }

  /**
   * Append the referral id as `afileasy_ref=<id>` to a URL (e.g. a checkout
   * redirect). No-op when there is no referral.
   * @param {string} url
   * @returns {string}
   */
  function appendRef(url) {
    var value = getCookie(COOKIE_NAME);
    if (!value) {
      return url;
    }
    try {
      var parsed = new URL(url, location.origin);
      parsed.searchParams.set('afileasy_ref', value);
      return parsed.toString();
    } catch (e) {
      return url;
    }
  }

  /**
   * Build the public API objects and dispatch the ready events.
   * @param {string|null} eventId
   */
  function expose(eventId) {
    /** @returns {string|null} re-reads the cookie to capture post-init updates */
    function currentId() {
      return getCookie(COOKIE_NAME) || eventId || null;
    }

    function currentCode() {
      var ref = findReferralInUrl();
      return ref ? ref.code : null;
    }

    // Public namespace.
    window.Afileasy = {
      getReferral: currentId,
      getReferralCode: currentCode,
      appendRef: appendRef,
      applyHiddenFields: applyHiddenFields,
      clear: function () {
        deleteCookie(COOKIE_NAME);
      },
      version: VERSION,
    };

    // Surface the id into the merchant's order form right away, and again once
    // the DOM is parsed in case the inputs render after this script runs.
    applyHiddenFields();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyHiddenFields);
    }

    // Notify integrations that tracking is ready.
    if (typeof CustomEvent === 'function') {
      var detail = { eventId: currentId() };
      document.dispatchEvent(new CustomEvent('afileasy:ready', { detail: detail }));
    }
  }

  // ─── Initialization ──────────────────────────────────────────────────

  function init() {
    // 1. Locate our script tag
    var scriptEl = document.querySelector('script[data-afileasy]');

    if (!scriptEl) {
      console.warn('[Afileasy] Missing <script data-afileasy="...">. Tracking disabled.');
      return;
    }

    var publicKey = scriptEl.getAttribute('data-afileasy');
    if (!publicKey || !publicKey.trim()) {
      console.warn('[Afileasy] data-afileasy attribute is empty. Tracking disabled.');
      return;
    }

    var apiUrl = resolveApiUrl(scriptEl);

    // 2. If we already have a cookie, just expose and exit
    var existing = getCookie(COOKIE_NAME);
    if (existing) {
      expose(existing);
      return;
    }

    // 3. Check URL for referral parameters
    var referral = findReferralInUrl();
    if (!referral) {
      expose(null);
      return;
    }

    // 4. Register the click with the Afileasy API
    var payload = {
      public_key: publicKey.trim(),
      code: referral.code,
      param: referral.param,
      page: location.href,
      referrer: document.referrer || null,
    };

    postJSON(apiUrl + '/track/click', payload)
      .then(function (response) {
        if (response && response.event_id) {
          var cookieDays = response.cookie_duration || DEFAULT_COOKIE_DAYS;
          setCookie(COOKIE_NAME, response.event_id, cookieDays);
          expose(response.event_id);
        } else {
          // 204 (bot) or empty response — nothing to store.
          expose(null);
        }
      })
      .catch(function (err) {
        console.error('[Afileasy] Failed to register click:', err.message || err);
        expose(null);
      });
  }

  // ─── Boot ────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

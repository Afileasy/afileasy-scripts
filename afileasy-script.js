/**
 * Afileasy Referral Tracking Script v1.1.0
 *
 * Tracks affiliate referral clicks, stores the EventLink id in a first-party
 * cookie, and exposes a public API for checkout / payment-gateway integration
 * and lead registration (signup forms).
 *
 * Installation (served minified via jsDelivr CDN, pinned to a release tag):
 *   <script src="https://cdn.jsdelivr.net/gh/Afileasy/afileasy-scripts@v1.1.0/afileasy-script.min.js" data-afileasy="YOUR_PUBLIC_KEY"></script>
 *
 * Optional attributes:
 *   data-api-url="https://custom-api.example.com/api/v1"  (override API base URL)
 *
 * Public API (available after the afileasy:ready event):
 *   window.Afileasy.getReferral()      → string | null  (EventLink id for attribution)
 *   window.Afileasy.getReferralCode()  → string | null  (raw referral code from URL)
 *   window.Afileasy.appendRef(url)     → string         (adds afileasy_ref=<id> to a URL)
 *   window.Afileasy.applyHiddenFields()→ void           (fills [data-afileasy-ref] inputs)
 *   window.Afileasy.trackLead(data)    → Promise        (registers a lead: {email, name?})
 *   window.Afileasy.clear()            → void           (removes tracking cookie)
 *   window.Afileasy.version            → string
 *
 * Lead capture (declarative, no extra JS):
 *   Add data-afileasy-lead to any <form>. On submit, the visitor's email
 *   (input[data-afileasy-email], falling back to the first input[type=email])
 *   and optional name (input[data-afileasy-name], falling back to
 *   input[name=name]) are sent to the Afileasy lead endpoint — only when the
 *   visit is attributed to a referral. Submission is never blocked.
 *
 *   Successful registration dispatches an `afileasy:lead` event on document
 *   with detail = { customerId, email }.
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
  var VERSION = '1.1.0';

  // Captured at init so the public API (trackLead) can reach the backend.
  var config = { publicKey: null, apiUrl: FALLBACK_API_URL };

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
   * @param {{ keepalive?: boolean }} [options]
   * @returns {Promise<object>}
   */
  function postJSON(url, data, options) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data),
      // keepalive lets the request outlive a page navigation (form submits).
      keepalive: !!(options && options.keepalive),
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error('API ' + response.status + ': ' + text);
        });
      }
      return response.json();
    });
  }

  // ─── Lead Registration ───────────────────────────────────────────────

  /**
   * The lead endpoint lives at /api/track/lead — outside the versioned
   * /api/v1 prefix the rest of the script talks to.
   * @returns {string}
   */
  function resolveLeadUrl() {
    return config.apiUrl.replace(/\/v1$/, '') + '/track/lead';
  }

  /**
   * Register a lead conversion (signup without purchase) attributed to the
   * current referral. Sends the EventLink id from the cookie (or the raw
   * referral code from the URL) — the backend accepts either.
   *
   * Resolves with the API response ({ customer_id }) or null when the visit
   * has no referral to attribute (registering the lead would be meaningless).
   *
   * @param {{ email: string, name?: string }} data
   * @param {{ keepalive?: boolean }} [options]
   * @returns {Promise<object|null>}
   */
  function trackLead(data, options) {
    data = data || {};

    if (!data.email || !String(data.email).trim()) {
      return Promise.reject(new Error('[Afileasy] trackLead requires an email.'));
    }

    if (!config.publicKey) {
      return Promise.reject(new Error('[Afileasy] trackLead unavailable: missing public key.'));
    }

    var urlReferral = findReferralInUrl();
    var code = getCookie(COOKIE_NAME) || (urlReferral && urlReferral.code);
    if (!code) {
      return Promise.resolve(null);
    }

    var payload = {
      public_key: config.publicKey,
      code: code,
      email: String(data.email).trim(),
      name: data.name ? String(data.name).trim() : null,
    };

    return postJSON(resolveLeadUrl(), payload, options).then(function (response) {
      if (typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('afileasy:lead', {
          detail: { customerId: response && response.customer_id, email: payload.email },
        }));
      }
      return response;
    });
  }

  /**
   * Find the lead email/name inputs inside a form.
   * @param {HTMLFormElement} form
   * @returns {{ email: string|null, name: string|null }}
   */
  function extractLeadFields(form) {
    var emailInput =
      form.querySelector('[data-afileasy-email]') ||
      form.querySelector('input[type="email"]');
    var nameInput =
      form.querySelector('[data-afileasy-name]') ||
      form.querySelector('input[name="name"]');

    return {
      email: emailInput && emailInput.value ? emailInput.value.trim() : null,
      name: nameInput && nameInput.value ? nameInput.value.trim() : null,
    };
  }

  /**
   * Fire-and-forget lead capture for <form data-afileasy-lead> submissions.
   * Listens in the capture phase on document so forms added after init are
   * covered, and never blocks or delays the merchant's own submit handling.
   */
  function bindLeadForms() {
    document.addEventListener(
      'submit',
      function (event) {
        var form = event.target;
        if (!form || !form.hasAttribute || !form.hasAttribute('data-afileasy-lead')) {
          return;
        }

        var fields = extractLeadFields(form);
        if (!fields.email) {
          return;
        }

        trackLead({ email: fields.email, name: fields.name }, { keepalive: true })
          .catch(function (err) {
            console.error('[Afileasy] Failed to register lead:', err.message || err);
          });
      },
      true
    );
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
      trackLead: trackLead,
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

    // Declarative lead capture for <form data-afileasy-lead>.
    bindLeadForms();

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

    config.publicKey = publicKey.trim();
    config.apiUrl = apiUrl;

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

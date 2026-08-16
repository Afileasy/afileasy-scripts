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

  var COOKIE_NAME = 'afileasy_ref';
  var FALLBACK_API_URL = 'https://api.afileasy.com/v1';
  var REFERRAL_PARAMS = ['ref', 'afi', 'aff', 'via'];
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

  var config = { publicKey: null, apiUrl: FALLBACK_API_URL };

  function getCookie(name) {
    var match = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    var expires = new Date();
    expires.setTime(expires.getTime() + days * 86400000);

    var base = [
      name + '=' + encodeURIComponent(value),
      'expires=' + expires.toUTCString(),
      'path=/',
      'samesite=lax',
    ];

    if (location.protocol === 'https:') {
      base.push('secure');
    }

    var domain = getRootDomain();
    if (domain) {
      document.cookie = base.concat('domain=' + domain).join('; ');
      if (getCookie(name) === value) {
        return;
      }
    }

    document.cookie = base.join('; ');
  }

  function deleteCookie(name) {
    var base = [
      name + '=',
      'expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'path=/',
    ];

    document.cookie = base.join('; ');

    var domain = getRootDomain();
    if (domain) {
      document.cookie = base.concat('domain=' + domain).join('; ');
    }
  }

  function getRootDomain() {
    var hostname = location.hostname;

    if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return null;
    }

    var segments = hostname.split('.');
    return segments.length > 2
      ? '.' + segments.slice(-2).join('.')
      : '.' + hostname;
  }

  function resolveApiUrl(scriptEl) {
    var override = scriptEl.getAttribute('data-api-url');
    if (override && override.trim()) {
      return override.trim().replace(/\/+$/, '');
    }

    try {
      var src = scriptEl.src || (scriptEl.getAttribute('src') || '');
      if (src) {
        var url = new URL(src, location.href);
        if (CDN_HOSTS.indexOf(url.hostname) === -1) {
          return url.origin + '/api/v1';
        }
      }
    } catch (e) {
      // fall through to fallback, ignore the error
    }

    return FALLBACK_API_URL;
  }

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

  function postJSON(url, data, options) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data),
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

  function resolveLeadUrl() {
    return config.apiUrl.replace(/\/v1$/, '') + '/track/lead';
  }

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

  function expose(eventId) {
    function currentId() {
      return getCookie(COOKIE_NAME) || eventId || null;
    }

    function currentCode() {
      var ref = findReferralInUrl();
      return ref ? ref.code : null;
    }

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

    applyHiddenFields();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyHiddenFields);
    }

    bindLeadForms();

    if (typeof CustomEvent === 'function') {
      var detail = { eventId: currentId() };
      document.dispatchEvent(new CustomEvent('afileasy:ready', { detail: detail }));
    }
  }

  function init() {
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

    var existing = getCookie(COOKIE_NAME);
    if (existing) {
      expose(existing);
      return;
    }

    var referral = findReferralInUrl();
    if (!referral) {
      expose(null);
      return;
    }

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
          expose(null);
        }
      })
      .catch(function (err) {
        console.error('[Afileasy] Failed to register click:', err.message || err);
        expose(null);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

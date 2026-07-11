/**
 * Afileasy — Stripe Plugin (optional)
 *
 * Stamps the referral id onto Stripe checkouts so the webhook can attribute the
 * sale to the right affiliate:
 *   • Payment Links      → adds ?client_reference_id=<id> to a[href*="buy.stripe.com"]
 *   • Buy Button         → sets client-reference-id on <stripe-buy-button>
 *
 * Load after afileasy-script.js (served minified via jsDelivr CDN, pinned to a release tag):
 *   <script src="https://cdn.jsdelivr.net/gh/Afileasy/afileasy-scripts@v1.0.1/afileasy-script.min.js" data-afileasy="YOUR_PUBLIC_KEY"></script>
 *   <script src="https://cdn.jsdelivr.net/gh/Afileasy/afileasy-scripts@v1.0.1/afileasy-script-stripe.min.js"></script>
 */
(function () {
  'use strict';

  var LINK_SELECTOR = 'a[href*="buy.stripe.com"]';
  var LINK_PARAM = 'client_reference_id';
  var BUTTON_SELECTOR = 'stripe-buy-button';
  var BUTTON_ATTR = 'client-reference-id';

  /**
   * Read the referral id from the Afileasy namespace.
   * @returns {string|null}
   */
  function getReferralId() {
    if (window.Afileasy && typeof window.Afileasy.getReferral === 'function') {
      return window.Afileasy.getReferral();
    }
    return null;
  }

  function patch() {
    var eventId = getReferralId();
    if (!eventId) {
      return;
    }

    // Payment Links
    var links = document.querySelectorAll(LINK_SELECTOR);
    for (var i = 0; i < links.length; i++) {
      if (links[i].href.indexOf(LINK_PARAM) !== -1) {
        continue;
      }
      var glue = links[i].href.indexOf('?') === -1 ? '?' : '&';
      links[i].href += glue + LINK_PARAM + '=' + encodeURIComponent(eventId);
    }

    // Buy Button
    var buttons = document.querySelectorAll(BUTTON_SELECTOR);
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute(BUTTON_ATTR, eventId);
    }
  }

  // Retry a few times to catch late-rendered elements.
  var delays = [800, 2000, 4000];
  for (var k = 0; k < delays.length; k++) {
    setTimeout(patch, delays[k]);
  }

  // Also run when the main Afileasy script signals it's ready.
  document.addEventListener('afileasy:ready', patch);
})();

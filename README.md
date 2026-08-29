# Afileasy Scripts

Browser scripts for Afileasy referral tracking. Written in TypeScript, bundled
with esbuild into self-contained minified IIFEs, and served from Cloudflare R2
at `https://cdn.afileasy.com`.

## Install

Pin an exact version — released paths are immutable and cached for a year:

```html
<script src="https://cdn.afileasy.com/v1.2.0/script.min.js"
        integrity="sha384-…"
        crossorigin="anonymous"
        data-afileasy="YOUR_PUBLIC_KEY"></script>
```

The `integrity` hash for every file is in `dist/manifest.json` after a build,
and is printed by `npm run deploy`.

Optional Stripe plugin — stamps the referral id onto Payment Links and
`<stripe-buy-button>`. Load it **after** the core script:

```html
<script src="https://cdn.afileasy.com/v1.2.0/script-stripe.min.js"></script>
```

`https://cdn.afileasy.com/v1/…` also resolves to the latest 1.x build with a
10-minute edge cache, for installs that prefer automatic patch updates.

### Script attributes

| Attribute | Required | Description |
| --- | --- | --- |
| `data-afileasy` | yes | Public key. Its presence is how the script finds its own tag. |
| `data-api-url` | no | Overrides the API base URL (staging, self-hosted). |

## Public API

Available on `window.Afileasy` once the `afileasy:ready` event has fired on
`document`.

| Method | Returns | Description |
| --- | --- | --- |
| `getReferral()` | `string \| null` | EventLink id used for attribution. |
| `getReferralCode()` | `string \| null` | Raw referral code in the current URL. |
| `getCoupon()` | `string \| null` | Affiliate coupon to apply at checkout, when the API resolved one. |
| `appendRef(url)` | `string` | Adds `afileasy_ref=<id>` to a URL. |
| `applyHiddenFields()` | `void` | Fills every `[data-afileasy-ref]` input. |
| `trackLead(data, options?)` | `Promise` | Registers a lead — `{ email, name? }`. |
| `clear()` | `void` | Removes the tracking cookies. |
| `version` | `string` | Build version. |

Events dispatched on `document`:

- `afileasy:ready` — `detail: { eventId: string \| null }`
- `afileasy:lead` — `detail: { customerId: string \| undefined, email: string }`

### Coupon autofill

`POST /track/click` may answer with a `coupon_code` — the single coupon the
affiliate's link should apply on its own. When it does, the script stores it in
the `afileasy_coupon` cookie beside `afileasy_ref`, with the same lifetime, and
exposes it as `getCoupon()`.

The script never applies the coupon itself: it has no idea what the checkout
looks like. Storefront integrations read it and apply it — the WooCommerce
plugin reads the cookie server-side, the Nuvemshop app reads the click response
directly. A code only reaches the cookie when the API resolved one, so an
organization without coupon tracking never sees this cookie.

### Declarative lead capture

Add `data-afileasy-lead` to any `<form>`. On submit the visitor's email
(`input[data-afileasy-email]`, falling back to the first `input[type=email]`)
and optional name (`input[data-afileasy-name]`, falling back to
`input[name=name]`) are sent to the lead endpoint — only when the visit is
attributed. The submission is never blocked.

## Architecture

```
src/
  types/
    public.ts      Public contract — window.Afileasy + wire payloads
    global.d.ts    window/DocumentEventMap augmentation, build-time constants
  core/
    constants.ts   Cookie names, referral params, injected build constants
    config.ts      Runtime config + API base resolution from the <script> tag
    cookie.ts      First-party cookie read/write with public-suffix fallback
    http.ts        postJSON
    referral.ts    URL parsing, appendRef, hidden fields
    lead.ts        trackLead + declarative form capture
    events.ts      CustomEvent dispatch
    log.ts         Prefixed console output
    api.ts         Builds and publishes window.Afileasy
  entries/
    core.ts        → script.min.js
    stripe.ts      → script-stripe.min.js
scripts/
  build.mjs        esbuild bundle + SRI/size manifest
  deploy.mjs       Upload to R2, one prefix per release channel
```

Each entry bundles to a standalone IIFE targeting ES2017 — no shared runtime,
no module loader, nothing on the page's global scope beyond `window.Afileasy`.

### Build-time constants

`scripts/build.mjs` injects three values via esbuild `define`, declared in
`src/types/global.d.ts`:

| Constant | Source | Purpose |
| --- | --- | --- |
| `__AFILEASY_VERSION__` | `package.json` | `Afileasy.version`, banner, deploy paths |
| `__AFILEASY_API_URL__` | `AFILEASY_API_URL` env, default `https://api.afileasy.com/v1` | Default API base |
| `__AFILEASY_CDN_HOSTS__` | built-in list + `AFILEASY_CDN_HOSTS` env | Hosts excluded from origin-based API resolution |

`resolveApiUrl()` derives the API base from the origin serving the script, so
self-hosted installs talk to their own backend without configuration. Any host
that only *serves* the script must be in `__AFILEASY_CDN_HOSTS__` — otherwise
the script would try to call the CDN as if it were the API. **Adding a new CDN
domain means adding it to that list.**

Note: the click endpoint is `<apiUrl>/track/click` while the lead endpoint
strips the version segment — `<apiUrl minus /v1>/track/lead`. This matches the
API as deployed since v1.1.0.

## Development

```bash
npm install
npm run dev         # watch, unminified output in dist/
npm run typecheck   # tsc --noEmit
npm run build       # minified bundles + dist/manifest.json
```

## Release

1. Bump `version` in `package.json`.
2. `npm run check` (typecheck + build).
3. `npm run deploy:dry` to review the uploads.
4. Commit, tag `vX.Y.Z`, push — the `Release` workflow builds and uploads.

Manual upload:

```bash
export CLOUDFLARE_ACCOUNT_ID=…
export CLOUDFLARE_API_TOKEN=…      # needs Workers R2 Storage: Edit
npm run release
```

`deploy.mjs` refuses to overwrite an existing exact-version object; bump the
version instead, or pass `--force` for a deliberate overwrite.

### Channels

| Prefix | Cache-Control | Use |
| --- | --- | --- |
| `v1.2.0/` | `public, max-age=31536000, immutable` | Production installs |
| `v1/` | `public, max-age=600, s-maxage=600, stale-while-revalidate=86400` | Auto-updating installs |

Each prefix holds `script.min.js`, `script-stripe.min.js`,
their `.map` files, and `manifest.json`.

## Cloudflare setup (once)

```bash
wrangler r2 bucket create afileasy-cdn
wrangler r2 bucket cors put afileasy-cdn --file cloudflare/r2-cors.json
```

Then, in the Cloudflare dashboard, attach the custom domain
`cdn.afileasy.com` to the bucket (R2 → afileasy-cdn → Settings → Public access
→ Custom domains). Traffic is served through the CDN with the `Cache-Control`
values set on each object at upload time.

CORS is only needed because the install snippet uses `crossorigin="anonymous"`
for Subresource Integrity; a plain `<script src>` would not require it.

## Distribution history

Versions up to and including v1.1.1 were also published to jsDelivr from the
repository root (`cdn.jsdelivr.net/gh/Afileasy/afileasy-scripts@v1.1.1/…`).
Those tags remain intact, so existing installs keep working, but new releases
ship only to `cdn.afileasy.com`.

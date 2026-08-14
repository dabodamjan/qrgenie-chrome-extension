# Browser ports: Chrome, Firefox, Edge

One codebase ships to all three stores. This file records what differs per
browser, how to produce each store's zip, and what each store's submission
needs. Facts marked **verified** were checked against the linked docs on
2026-08-14; anything marked **UNVERIFIED** could not be checked live (the
session could only reach developer.mozilla.org and learn.microsoft.com) and
should be confirmed against the linked page before first submission.

## What differs per browser

| | Chrome | Edge | Firefox |
|---|---|---|---|
| Background model | service worker | service worker | non-persistent event page |
| Manifest key used | `background.service_worker` | `background.service_worker` | `background.scripts` |
| Promise-style APIs | `chrome.*` | `chrome.*` | guaranteed only on `browser.*` |
| Store package | `dist/qr-decoder-chrome-*.zip` | `dist/qr-decoder-edge-*.zip` | `dist/qr-decoder-firefox-*.zip` |
| Minimum version | 123 (`minimum_chrome_version`, see below) | Chromium 123 equivalent | 140 (`strict_min_version`) |

Three code-level accommodations, all in place:

1. **Dual `background` key.** The repo `manifest.json` declares both
   `service_worker` (Chrome/Edge) and `scripts` (Firefox). Each browser uses
   its key and ignores the other — Chrome ignores `scripts` since Chrome 121,
   and Firefox starts the event page despite a `service_worker` key since
   Firefox 121. This is MDN's recommended cross-browser pattern. **Verified:**
   <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background>
   (Firefox does not support `background.service_worker` at all — Bugzilla
   1573659.)
2. **`importScripts` guard.** In the Chrome/Edge worker, `background.js` pulls
   in jsQR, the payload classifier and the crop mapper via `importScripts`.
   Firefox's event page has no `importScripts`, so the same files are listed
   before `background.js` in `background.scripts` and the call is skipped
   (`typeof importScripts === 'function'`). `test/manifest.test.js` pins the
   two lists to each other.
3. **`api` alias.** Every script uses
   `const api = globalThis.browser ?? globalThis.chrome`. MDN documents
   Firefox's `chrome.*` namespace as a callback-style porting aid and promises
   as a `browser.*` feature, and the code awaits its API calls, so it goes
   through `browser` where that exists. **Verified:**
   <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API>,
   <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities>

Behavior that needed checking but not changing:

- **`activeTab` + `captureVisibleTab`** (the whole screenshot decode path):
  in Firefox a context-menu click and a toolbar click both grant `activeTab`,
  and `captureVisibleTab` works with only `activeTab` from **Firefox 126**
  (125 and earlier required `<all_urls>`). **Verified:**
  <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions>,
  <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab>
- **Context menus** created inside `runtime.onInstalled` persist across
  restarts for non-persistent backgrounds in both browsers (the menu ids make
  re-creation idempotent). **Verified:**
  <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/create>
- **`scripting.executeScript`** (`func`/`args` and `files` forms) exists in
  Firefox MV3 since Firefox 101. One documented difference: with partial
  permissions Firefox can succeed partially where Chrome refuses entirely —
  irrelevant here, we inject only into the invoked tab. **Verified:**
  <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript>
- **`browser_specific_settings`** is ignored by Chrome ("Chrome doesn't use
  this key and ignores it if present"). **Verified:**
  <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings>

### The `gecko` block

```json
"browser_specific_settings": {
  "gecko": {
    "id": "qr-decoder@qrgenie.app",
    "strict_min_version": "140.0",
    "data_collection_permissions": { "required": ["none"] }
  }
}
```

- `id` is **mandatory for signing MV3 extensions** — AMO does not assign one.
  Email-like format, ≤80 chars. **Verified:** the `browser_specific_settings`
  page above.
- `data_collection_permissions` is **mandatory for new AMO submissions since
  2025-11-03**; `required: ["none"]` is the formal "collects no data"
  declaration, and Firefox shows it in the install prompt — it is the
  zero-tracking claim made machine-readable. **Verified:** same page.
- `strict_min_version: "140.0"` is a deliberately conservative floor. The hard
  functional minimum is Firefox 126 (`captureVisibleTab` with `activeTab`);
  121 is needed for the dual background key. 140 (an ESR) was chosen because
  the Firefox version that started *parsing* `data_collection_permissions`
  could not be verified this session (MDN's compat table doesn't render over
  the tooling used), and 140 is safely past its mid-2025 introduction. If a
  lower floor matters, check the compat table on the page above and lower it
  to 126.

## Producing the store zips

```
npm run build            # all three
npm run build firefox    # one target
```

`scripts/build.js` (node, no dependencies; zipping shells out to the system
`zip`) stages `dist/chrome/`, `dist/firefox/`, `dist/edge/` and writes
`dist/qr-decoder-<browser>-<version>.zip`. Each package contains exactly what
the browser loads (plus the license files); tests, docs and scripts stay out.
Per-target manifest: Chrome and Edge get the repo manifest minus
`background.scripts` and `browser_specific_settings`; Firefox gets it minus
`background.service_worker` and `minimum_chrome_version`. So store validators only ever see keys their
browser reads — whether the Chrome Web Store or Partner Center tolerate the
extra keys is **UNVERIFIED**, and stripping them makes the question moot.

For development, the repo root itself loads unpacked in all three browsers
(Chrome/Edge ≥123 per `minimum_chrome_version`; Firefox ignores
`service_worker` and warns about the Chrome-only keys): see README → Install.

## Firefox Add-ons (AMO) submission

Submission portal: <https://addons.mozilla.org/developers/>

- **Developer account:** a Mozilla account; no registration fee (AMO has
  never charged one). **UNVERIFIED live** — confirm at
  <https://extensionworkshop.com/documentation/publish/submitting-an-add-on/>
- **Manifest requirements:** `gecko.id` and `data_collection_permissions`
  as above — both **verified**, see the `gecko` block section.
- **Listing fields:** name comes from the manifest; Summary is a separate
  field commonly limited to 250 characters (**UNVERIFIED** — the Chrome short
  description is 118 chars, so it fits under any plausible limit); full
  description, categories, tags, support email/site, screenshots. Ready-made
  copy: STORE_LISTING.md → "Firefox Add-ons (AMO) deltas".
- **Privacy policy:** AMO accepts inline text or a URL. Use the same text
  planned for Chrome (STORE_LISTING.md). The extension collects nothing, but
  a policy is still the honest place to say so. Field specifics
  **UNVERIFIED** — see submission guide above.
- **Source code / third-party libraries:** `vendor/jsQR.js` is the
  **unmodified, unminified** `dist/jsQR.js` from npm `jsqr@1.4.0`
  (documented in LICENSES.md). Mozilla's policy requires third-party
  libraries to match official release files, which this does; unminified
  code should not trigger the source-submission requirement. Policy page to
  confirm against (**UNVERIFIED** live):
  <https://extensionworkshop.com/documentation/publish/source-code-submission/>
- **Review:** new listed add-ons pass automated validation and typically
  publish quickly, with human review possible after the fact; an extension
  that captures the visible tab should expect reviewer attention on exactly
  that — the permission justifications in STORE_LISTING.md answer it.
  Timing **UNVERIFIED** live:
  <https://extensionworkshop.com/documentation/publish/add-on-policies/>

## Microsoft Edge Add-ons submission

Submission portal: Partner Center,
<https://partner.microsoft.com/dashboard/microsoftedge/>

- **Package compatibility:** Edge accepts Chrome MV3 packages; Microsoft's
  porting guidance is to remove any `update_url` (we have none — updates go
  only through Partner Center) and to **rebrand "Chrome" wording in name and
  description** to pass certification. **Verified:**
  <https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension>
  All APIs this extension uses (`contextMenus`, `scripting`, `tabs`,
  `runtime`) are on Edge's supported list. **Verified:**
  <https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support>
- **Developer account:** **free** — "There is no registration fee for
  submitting extensions to the Microsoft Edge program." Requires a personal
  Microsoft account; Individual accounts verify faster than Company ones.
  **Verified:**
  <https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account>
- **Listing fields** (**verified**, same publish page as below): name and
  short description come from the manifest; full description **min 250 / max
  10,000 characters** (the Chrome full description qualifies, but needs the
  Edge rebrand — see STORE_LISTING.md → "Edge Add-ons deltas"); up to **7
  search terms**, each ≤30 chars, ≤21 words combined; category; optional
  support/website URLs.
- **Assets** (**verified**): logo required, 1:1, recommended 300×300 (min
  128×128) — the 300×300 needs generating, `scripts/make-icons.js` currently
  tops out at 128; screenshots optional, max 6, **640×480 or 1280×800**;
  promo tiles optional (440×280, 1400×560 PNG).
- **Privacy / certification** (**verified**):
  <https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension>
  Partner Center asks for a single-purpose description, a written
  justification per permission, a data-usage declaration, and a privacy
  policy URL where personal information is accessed. Reuse the Chrome
  justifications from STORE_LISTING.md; declare zero data collection. Plan to
  supply <https://qrgenie.app/extension-privacy> anyway (same pre-submission
  item as Chrome). Review takes **up to seven business days**. Policy areas
  that will get scrutiny for a screenshot-capturing extension: single purpose
  (§1.1.1), minimum permissions (§1.6), personal-information handling (§1.5):
  <https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies>

## Chrome Web Store (unchanged by this port)

The Chrome package is byte-identical in behavior to v1; `npm run build`
merely strips the two keys Chrome ignores anyway. Chrome's one-time $5
developer fee and listing flow are as before (STORE_LISTING.md). The manifest
now declares `minimum_chrome_version: "123"`, covering two stacked floors:

- **121** — first Chrome to tolerate the dual `background` key; ≤120 rejects
  a manifest carrying `background.scripts` outright.
- **123** — first Chrome where `chrome.contextMenus` methods return promises.
  `background.js` calls `contextMenus.removeAll().then(...)`; on 121–122 that
  call returns undefined and the menus are never recreated. **UNVERIFIED
  live** (this session had no reach to developer.chrome.com) — the version
  comes from an external cross-model review citing the API reference; confirm
  at <https://developer.chrome.com/docs/extensions/reference/api/contextMenus>
  if it ever matters. `test/manifest.test.js` pins the declared floor.

Chrome 123 shipped March 2024, far below any realistic user floor.

## Still open before submission

- Host the privacy policy at <https://qrgenie.app/extension-privacy>
  (pre-existing Chrome item; Firefox and Edge listings want it too).
- Generate a 300×300 logo for Partner Center.
- Screenshots per store (Edge: 640×480 or 1280×800; AMO also wants at least
  one).
- Confirm the three **UNVERIFIED** AMO items above against Extension
  Workshop before the first AMO upload.
- Smoke-test the Firefox build once in a real Firefox (≥140): load
  `dist/firefox/` via `about:debugging` → This Firefox → Load Temporary
  Add-on, decode `test/fixtures/url.png` both ways. The port follows
  documented behavior throughout, but no Firefox run happened in this
  environment.

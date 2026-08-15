# QR Decoder by QRGenie

Browser extension (Chrome, Firefox, Edge) that reads QR codes you see on screen. Chrome and Edge can generate a QR code for the current page but cannot read one, and Firefox can do neither; this fills that gap. One codebase serves all three browsers — the differences and the store packaging live in `PORTS.md`.

Made by [QRGenie](https://qrgenie.app), our iOS QR code app. Everything decodes on your device: no analytics, no accounts. Decoding itself never makes a network request; the only network activity the extension can cause is navigation you trigger yourself (opening a decoded link, or clicking the QRGenie link in the card footer).

## What it does

- Right-click any image on a page and choose **Decode QR code in this image**.
- Right-click anywhere (or use the toolbar popup) and choose **Scan area for QR code**, then drag a box around the code. This works for QR codes that are not images: video frames, canvas drawings, PDFs rendered in the page, shared screens.
- While a scan runs, a small indicator sits in the top right of the page. Stylized codes (dots, rounded modules, mild skew) take a second or two because the extension retries them with several image treatments.
- The result appears in a small card on the page with the decoded content, a **Copy** button and, for web links, an **Open link** button. Links are always shown in full first and never opened automatically.
- Wi-Fi, contact, email, phone, SMS, location and calendar payloads are recognized and their fields shown.

## How decoding works

All decoding runs locally with a vendored copy of [jsQR](https://github.com/cozmo/jsQR) (see `LICENSES.md`). For a right-clicked image the extension first asks the page for the image pixels at natural resolution; if the page's security rules do not allow that (cross-origin images), it falls back to capturing the visible tab and cropping to the image's on-screen rectangle. The area scan always uses the capture path and decodes only the region you selected. Captures happen locally, stay in memory and are discarded after decoding; nothing leaves the device.

If the right-clicked image itself cannot be read at all, the extension scans the whole visible tab as a last resort and the result card says the code was found on the visible tab, not read from the image.

Because of the screenshot fallback, a very small QR code on screen may fail to decode; zooming the page and scanning again fixes that.

## Known limits

- Browsers block extensions on their own pages, so scanning does not work on `chrome://` / `edge://` / `about:` pages, extension stores or the built-in PDF viewer. The extension tells you when a page blocked it.
- Decoded payloads are trimmed of leading and trailing whitespace before classification.
- Right-clicking an image inside a cross-origin iframe may decode from the whole visible tab when the image itself cannot be located (the result card says so when that happens).

## Install (load unpacked)

1. Clone or download this repository.
2. Load the repository folder as an unpacked extension:
   - **Chrome:** open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**.
   - **Edge:** open `edge://extensions`, turn on **Developer mode** (left sidebar), click **Load unpacked**.
   - **Firefox (140+):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `manifest.json`. Temporary add-ons last until Firefox restarts.
3. Pin the extension if you want the toolbar button visible.

To try it, open any https page that shows a QR code (a QR generator site works well), right-click the code image and choose **Decode QR code in this image**. The committed fixtures in `test/fixtures/` work too, but opening them as `file://` pages requires the **Allow access to file URLs** toggle on `chrome://extensions` — Chrome blocks extensions on file URLs by default.

## Permissions

- `contextMenus`: the two right-click menu items.
- `activeTab`: capture the visible part of the current tab, locally, only after you invoke the extension — this is the screenshot decode path.
- `scripting`: inject the selection overlay and the result card into the page, on demand.

No host permissions, no content scripts running in the background, no storage. Decoding makes no network requests; the extension never transmits anything.

## Project layout

```
manifest.json          Cross-browser Manifest V3 definition (see PORTS.md)
background.js          Background script (service worker in Chrome/Edge,
                       event page in Firefox): menus, capture, decoding, routing
common/payload.js      Classifies decoded payloads (URL, Wi-Fi, contact, ...)
common/preprocess.js   Retry ladder for stylized codes (dots, rounded, skew)
content/overlay.js     Result card and decoding indicator, injected on demand
content/area-select.js Drag-to-select overlay for the area scan
popup/                 Toolbar popup
viewer/                Fallback result page for pages we cannot inject into
vendor/jsQR.js         Vendored decoder (Apache 2.0, see LICENSES.md)
icons/                 Extension icons, generated by scripts/make-icons.js
scripts/               Icon/fixture generators and the store package builder
test/                  Node test suite and committed fixture images
PORTS.md               Per-browser differences and store submission notes
```

## Development

- `npm test` runs the test suite (Node 18 or newer, no dependencies): jsQR against the committed fixture images, the payload classifier, the cross-browser manifest invariants, and the message protocol between the background script and the injected overlay, with the overlay itself running against a small DOM stub so two overlapping scans in one tab are tested for real.
- `npm run check` syntax-checks every script.
- `npm run build` stages `dist/<browser>/` and writes the three store zips (see PORTS.md).
- `npm run make:icons` regenerates the icons (no dependencies).
- `npm run make:fixtures` regenerates the fixtures; the clean base fixtures need `npm install --no-save qrcode` first, the stylized variants regenerate from the committed clean PNGs without it.

There is no build step for development. The files in the repository are exactly what the browser loads; `npm run build` only re-packages them per store.

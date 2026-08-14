# Chrome Web Store listing draft

Ready to paste at submission. Everything below is true of the extension as built; if behavior changes, update the claims.

## Title

QR Decoder by QRGenie

## Short description (under 132 characters)

Read QR codes on your screen. Right-click an image or select an area. Decodes on your device, nothing is sent anywhere.

## Full description

Chrome can create a QR code for the current page, but it cannot read one. This extension fills that gap.

Two ways to decode:

1. Right-click any image on a page and choose "Decode QR code in this image".
2. Click the toolbar button or right-click the page, choose "Scan area for QR code", and drag a box around the code. This also works for codes inside videos, canvas graphics, embedded PDFs and shared screens.

Chrome does not allow extensions on its own pages, so scanning is not available on chrome:// pages, the Chrome Web Store or the built-in PDF viewer; the extension tells you when a page blocked it.

The result appears in a small card on the page. You can copy the decoded content with one click. If the code contains a web link, we show you the full URL first and open it only when you choose to; we never open anything automatically. Wi-Fi codes show the network name and password, and contact, email, phone, SMS, location and calendar codes show their details too.

Private by design:

- Decoding happens entirely on your device, using a well-known open source decoder (jsQR) bundled with the extension.
- Decoding never makes a network request. Your pages, images and decoded results never leave your browser; the only network activity the extension can cause is navigation you choose yourself, such as opening a decoded link.
- No analytics, no tracking, no accounts, no stored data.
- No host permissions. The extension can only see a page after you invoke it there, through Chrome's activeTab permission.

To find the code, the extension captures an image of the visible tab on your device. That capture is processed locally, stays in memory and is discarded right after decoding.

Made by the team behind QRGenie, the QR code app for iPhone: https://qrgenie.app

## Category

Tools (Productivity)

## Single purpose description

Decodes QR codes visible on the current page, either from a right-clicked image or from a user-selected area of the screen, and shows the decoded content.

## Permission justifications

- contextMenus: Adds the two right-click entries the user invokes decoding with: "Decode QR code in this image" and "Scan area for QR code".
- activeTab: Lets the extension read the tab the user just invoked it on, so it can capture the visible area (or the right-clicked image) for local decoding. Used only after an explicit user gesture; no host permissions are requested.
- scripting: Injects, on demand and only into the invoked tab, the small overlay for drag-selecting an area and the card that displays the decoded result.

## Data usage disclosures

- To decode, the extension captures the visible tab (or the right-clicked image) on the user's device. The capture is processed locally, kept only in memory and discarded after decoding.
- Does not collect, store or transmit any user data. Nothing leaves the device.
- No analytics or tracking of any kind.

## Privacy policy

Draft text: this extension captures the visible tab locally to find and decode QR codes; the capture and the decoded result are processed on your device, never stored and never transmitted. It does not collect any data.

**Pre-submission item:** host this at https://qrgenie.app/extension-privacy — the page does not exist yet, and the store requires a privacy policy URL at submission.

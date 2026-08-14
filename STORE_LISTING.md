# Chrome Web Store listing draft

Ready to paste at submission. Everything below is true of the extension as built; if behavior changes, update the claims.

## Title

QR Decoder by QRGenie

## Short description (under 132 characters)

Read any QR code on your screen. Right-click an image or select an area. Decodes on your device, nothing is sent anywhere.

## Full description

Chrome can create a QR code for the current page, but it cannot read one. This extension fills that gap.

Two ways to decode:

1. Right-click any image on a page and choose "Decode QR code in this image".
2. Click the toolbar button or right-click the page, choose "Scan area for QR code", and drag a box around the code. This also works for codes inside videos, canvas graphics, embedded PDFs and shared screens.

The result appears in a small card on the page. You can copy the decoded content with one click. If the code contains a web link, we show you the full URL first and open it only when you choose to; we never open anything automatically. Wi-Fi codes show the network name and password, and contact, email, phone, SMS, location and calendar codes show their details too.

Private by design:

- Decoding happens entirely on your device, using a well-known open source decoder (jsQR) bundled with the extension.
- No network requests at runtime. Your pages, images and decoded results never leave your browser.
- No analytics, no tracking, no accounts, no stored data.
- No host permissions. The extension can only see a page after you invoke it there, through Chrome's activeTab permission.

The screenshot used for area scans stays in memory and is discarded right after decoding.

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

- Does not collect or transmit any user data.
- No analytics or tracking of any kind.
- All processing is local to the user's device.

## Privacy policy

The extension collects nothing, so the policy is one line: this extension does not collect, store or transmit any data; all QR decoding happens locally on your device. Host a copy at https://qrgenie.app/extension-privacy (page needs to exist before submission; the store requires a privacy policy URL when the item declares data handling).

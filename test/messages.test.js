'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The background script and the injected overlay only ever meet through
// message type strings. Nothing at runtime checks that the two lists agree:
// a renamed type on one side is silently ignored on the other, which shows up
// as a spinner that never stops or a result that never appears. These tests
// pin the protocol instead.

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const overlay = fs.readFileSync(path.join(root, 'content', 'overlay.js'), 'utf8');

// Everything the background script sends to content/overlay.js.
const TO_PAGE = [
  'qrgenie:show-busy',
  'qrgenie:hide-for-capture',
  'qrgenie:restore-after-capture',
  'qrgenie:show-result'
];

test('the overlay handles every message the background sends it', () => {
  for (const type of TO_PAGE) {
    assert.ok(background.includes(`'${type}'`), `background.js sends ${type}`);
    assert.ok(overlay.includes(`'${type}'`), `overlay.js handles ${type}`);
  }
});

test('the background answers every message the overlay sends it', () => {
  // The overlay asks the worker to open decoded links; content scripts cannot
  // open a tab themselves.
  assert.ok(overlay.includes("'qrgenie:open-url'"));
  assert.ok(background.includes("'qrgenie:open-url'"));
});

test('the decoding indicator is resolved by the result path', () => {
  // Both entry points end in showResult, and showing a result must clear the
  // indicator, or a failed decode leaves the page spinning forever.
  const start = overlay.indexOf('function show(result)');
  const end = overlay.indexOf('api.runtime.onMessage', start);
  assert.ok(start !== -1, 'overlay.js defines show(result)');
  assert.ok(end > start, 'show(result) comes before the message listener');
  assert.match(overlay.slice(start, end), /removeBusy\(\)/);
});

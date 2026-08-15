'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadOverlay } = require('./helpers/overlay-harness.js');

// The background script and the injected overlay only ever meet through
// message type strings. Nothing at runtime checks that the two lists agree:
// a renamed type on one side is silently ignored on the other, which shows up
// as a spinner that never stops or a result that never appears. These tests
// pin the protocol instead.
//
// The source-level tests read sending and dispatching code, never whole files:
// every type name also appears in the comments that document the protocol, so
// a plain substring search still passes with the handler deleted.

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

// The overlay's message dispatch: everything from its listener down.
function overlayDispatch() {
  const start = overlay.indexOf('api.runtime.onMessage.addListener');
  assert.ok(start !== -1, 'overlay.js registers a message listener');
  return overlay.slice(start);
}

// Every message object the background script builds for a given type.
function sentMessages(type) {
  const pattern = new RegExp(`\\{[^{}]*type: '${type}'[^{}]*\\}`, 'g');
  return background.match(pattern) || [];
}

test('the overlay dispatches every message the background sends it', () => {
  const dispatch = overlayDispatch();
  for (const type of TO_PAGE) {
    assert.ok(sentMessages(type).length > 0, `background.js sends ${type}`);
    assert.match(
      dispatch,
      new RegExp(`msg\\.type === '${type}'`),
      `overlay.js dispatches ${type}`
    );
  }
});

test('every message to the page names the scan it belongs to', () => {
  // Without the scan id the overlay cannot tell a stale message from a live
  // one, and two scans racing in one tab undo each other's work.
  for (const type of TO_PAGE) {
    for (const msg of sentMessages(type)) {
      assert.match(msg, /\bop\b/, `${type} carries a scan id: ${msg}`);
    }
  }
});

test('the background answers the message the overlay sends it', () => {
  // The overlay asks the worker to open decoded links; content scripts cannot
  // open a tab themselves.
  assert.match(overlay, /sendMessage\(\{ type: 'qrgenie:open-url'/);
  assert.match(background, /msg\.type === 'qrgenie:open-url'/);
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

// ---------------------------------------------------------------------------
// The overlay running for real against a DOM stub (test/helpers). These are
// the orderings two overlapping scans in one tab actually produce.

test('a capture hides the indicator and answers only then', async () => {
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 1 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);

  // The answer is what authorizes the screenshot, so it must say hidden.
  const ack = await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });
  assert.strictEqual(ack.hidden, true);
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: true }]);

  page.send({ type: 'qrgenie:restore-after-capture', op: 1 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('an older scan does not uncover the page for a newer capture', async () => {
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 2 });

  // Scan 1's restore lands between scan 2's hide and scan 2's capture.
  page.send({ type: 'qrgenie:restore-after-capture', op: 1 });
  assert.deepStrictEqual(
    page.hosts(),
    [{ kind: 'pill', hidden: true }],
    'the page stays clear until the newest capture is done'
  );

  page.send({ type: 'qrgenie:restore-after-capture', op: 2 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('an indicator raised during a capture stays out of it', async () => {
  const page = loadOverlay();
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 5 });

  // A second scan starts while the first one is being photographed.
  page.send({ type: 'qrgenie:show-busy', source: 'area', op: 6 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: true }]);

  page.send({ type: 'qrgenie:restore-after-capture', op: 5 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('a late result never clears a newer scan indicator', () => {
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 1 });
  page.send({ type: 'qrgenie:show-busy', source: 'area', op: 2 });

  page.send({
    type: 'qrgenie:show-result',
    op: 1,
    result: { ok: false, source: 'image', reason: null }
  });
  assert.deepStrictEqual(
    page.hosts(),
    [{ kind: 'pill', hidden: false }],
    'scan 2 keeps the corner'
  );

  page.send({
    type: 'qrgenie:show-result',
    op: 2,
    result: { ok: false, source: 'area', reason: null }
  });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'card', hidden: false }]);
});

test('a superseded scan cannot raise its indicator over a fresh result', () => {
  const page = loadOverlay();
  page.send({
    type: 'qrgenie:show-result',
    op: 4,
    result: { ok: false, source: 'area', reason: 'page-busy' }
  });
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 3 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'card', hidden: false }]);
});

test('the forced hide hook hides what the message would have hidden', () => {
  // What the worker falls back to when the listener does not answer in time.
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 7 });
  assert.strictEqual(page.hideNow(8), true);
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: true }]);

  page.send({ type: 'qrgenie:restore-after-capture', op: 8 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

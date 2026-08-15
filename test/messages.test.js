'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadOverlay } = require('./helpers/overlay-harness.js');
const { loadBackground } = require('./helpers/background-harness.js');

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

test('captures that finish out of order each hold the page on their own', async () => {
  // The ordering a shared record loses. Scan 2 hides first, scan 1 hides while
  // its own answer is still on the way, and scan 2 is photographed and
  // restores. Scan 1's screenshot is still to come, so the page must stay
  // clear: the alternative is scan 1 photographing everything scan 2 drew.
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'area', op: 2 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 2 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });

  page.send({ type: 'qrgenie:restore-after-capture', op: 2 });
  assert.deepStrictEqual(
    page.hosts(),
    [{ kind: 'pill', hidden: true }],
    'the older capture still holds the page'
  );

  page.send({ type: 'qrgenie:restore-after-capture', op: 1 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('a restore is only ever good for its own capture', async () => {
  // Restoring twice for one capture must not release another one's hold.
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 2 });

  page.send({ type: 'qrgenie:restore-after-capture', op: 1 });
  page.send({ type: 'qrgenie:restore-after-capture', op: 1 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: true }]);

  page.send({ type: 'qrgenie:restore-after-capture', op: 2 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('a capture nobody ever restores lets go on its own', async () => {
  // The worker died mid-capture: no restore is ever coming, and the page must
  // not keep an invisible indicator forever.
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: true }]);

  assert.strictEqual(page.runTimers(5000), 1, 'the capture armed a give-up timer');
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('one lease running out does not uncover the page for the others', async () => {
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 2 });

  // Both leases were armed at the same delay; firing them one at a time is
  // what a real pair of captures a few hundred ms apart does.
  const fired = page.runTimers(5000);
  assert.strictEqual(fired, 2, 'each capture armed its own give-up timer');
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('a capture keeps its hold when the same scan hides again', async () => {
  // The worker retries a hide (the first answer was late), which renews the
  // lease rather than opening a second one.
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });
  await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 1 });

  page.send({ type: 'qrgenie:restore-after-capture', op: 1 });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }]);
});

test('the overlay names the newest scan it has seen in every answer', async () => {
  // How a worker whose ids fell behind the page finds out: it seeds them from
  // the clock, and a clock can be set back.
  // Field by field: the answers are built inside the vm and carry that
  // realm's Object.prototype, which deepStrictEqual counts as a difference.
  const page = loadOverlay();
  const busy = page.send({ type: 'qrgenie:show-busy', source: 'image', op: 40 });
  assert.strictEqual(busy.applied, true);
  assert.strictEqual(busy.op, 40);

  const stale = page.send({ type: 'qrgenie:show-busy', source: 'area', op: 7 });
  assert.strictEqual(stale.applied, false, 'a dropped message says so');
  assert.strictEqual(stale.op, 40, 'and names the id that beat it');

  const ack = await page.sendAsync({ type: 'qrgenie:hide-for-capture', op: 41 });
  assert.strictEqual(ack.hidden, true);
  assert.strictEqual(ack.op, 41);
});

test('id-less messages stop counting once a scan has named itself', () => {
  // They come from a worker that predates scan ids. Before any id-carrying
  // scan they are all there is; after one, they can only be older than what is
  // already on screen, and applying them would undo a live scan's work.
  const page = loadOverlay();
  page.send({ type: 'qrgenie:show-busy', source: 'image' });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'pill', hidden: false }], 'honoured on their own');

  page.send({
    type: 'qrgenie:show-result',
    op: 3,
    result: { ok: false, source: 'image', reason: null }
  });
  assert.deepStrictEqual(page.hosts(), [{ kind: 'card', hidden: false }]);

  const answer = page.send({ type: 'qrgenie:show-busy', source: 'image' });
  assert.strictEqual(answer, undefined, 'nothing to answer for');
  assert.deepStrictEqual(
    page.hosts(),
    [{ kind: 'card', hidden: false }],
    'the result keeps the corner'
  );
});

// ---------------------------------------------------------------------------
// The worker side of the same handshake, running against a stubbed extension
// API (test/helpers). What is at stake here is the invariant the whole dance
// exists for: never decode a screenshot that could contain our own UI.
//
// Everything the worker returns is built inside the vm and carries that
// realm's Object.prototype, so these read fields rather than compare objects.

test('only the overlay saying it is hidden authorizes a capture', async () => {
  // Everything that is not that literal answer has to fall through to the
  // forced hide. An overlay too old to know about hiding, or a handler that
  // dropped the message, fulfils the promise with no value at all.
  for (const answer of [undefined, null, {}, { hidden: false }, { hidden: 'yes' }]) {
    const bg = loadBackground({
      sendMessage: (msg) => (msg.type === 'qrgenie:hide-for-capture' ? answer : undefined),
      // The page has no hook of ours, so the forced hide reports nothing hidden.
      executeScript: () => [{ result: false }]
    });
    const capture = await bg.get('captureTabForDecode')(1, 1, { op: 5 });
    const why = `answer ${JSON.stringify(answer)} must not authorize a capture`;
    assert.strictEqual(capture.held, true, why);
    assert.strictEqual(capture.dataUrl, null, why);
    assert.strictEqual(bg.executed.length, 1, 'the forced hide was tried instead');
  }
});

test('a hidden overlay authorizes the capture', async () => {
  const bg = loadBackground({
    sendMessage: (msg) =>
      msg.type === 'qrgenie:hide-for-capture' ? { hidden: true, op: 5 } : undefined
  });
  const capture = await bg.get('captureTabForDecode')(1, 1, { op: 5 });
  assert.strictEqual(capture.held, false);
  assert.match(capture.dataUrl, /^data:image\/png/);
});

test('a screenshot that lands after the hold could have lapsed is thrown away', async () => {
  // captureVisibleTab can sit in a queue for seconds. The overlay uncovers
  // itself 5s after it hid, so by the time this one arrives the page may
  // already show our indicator again, and decoding it is exactly the thing
  // none of this is allowed to do.
  const bg = loadBackground({
    sendMessage: (msg) =>
      msg.type === 'qrgenie:hide-for-capture' ? { hidden: true, op: 5 } : undefined,
    capture: () => {
      bg.advance(6000);
      return 'data:image/png;base64,AAAA';
    }
  });
  const capture = await bg.get('captureTabForDecode')(1, 1, { op: 5 });
  assert.strictEqual(capture.held, true);
  assert.strictEqual(capture.dataUrl, null, 'the screenshot itself is dropped');

  // Held or not, the page is told to put its UI back.
  const restores = bg.sent.filter((m) => m.type === 'qrgenie:restore-after-capture');
  assert.strictEqual(restores.length, 1);
  assert.strictEqual(restores[0].op, 5);
});

test('a wall clock stepping backwards mid-capture cannot revive a stale screenshot', async () => {
  // The hold is measured on monotonic time for exactly this: the lease really
  // has lapsed, and an NTP correction lands while captureVisibleTab is still
  // queued. On the wall clock the capture now looks like it came back in
  // negative time, which would wave through a screenshot of our own indicator.
  const bg = loadBackground({
    sendMessage: (msg) =>
      msg.type === 'qrgenie:hide-for-capture' ? { hidden: true, op: 5 } : undefined,
    capture: () => {
      bg.advance(6000);
      bg.stepWallClock(-30000);
      return 'data:image/png;base64,AAAA';
    }
  });
  const capture = await bg.get('captureTabForDecode')(1, 1, { op: 5 });
  assert.strictEqual(capture.held, true);
  assert.strictEqual(capture.dataUrl, null, 'the screenshot itself is dropped');
});

test('the restore quotes the id the capture was hidden under', async () => {
  // The hold in the page is keyed on that id. Quoting a different one leaves
  // the page covered until the hold runs out.
  const bg = loadBackground({
    sendMessage: (msg) =>
      msg.type === 'qrgenie:hide-for-capture' ? { hidden: true, op: 5 } : undefined
  });
  const scan = { op: 5 };
  await bg.get('captureTabForDecode')(1, 1, scan);
  const hides = bg.sent.filter((m) => m.type === 'qrgenie:hide-for-capture');
  const restores = bg.sent.filter((m) => m.type === 'qrgenie:restore-after-capture');
  assert.strictEqual(hides[0].op, restores[0].op);
});

test('the worker catches up when the page has ids it could not have issued', async () => {
  // A clock set backwards plus a worker restart seeds ids below the ones
  // already in the page, and every message would be dropped there in silence.
  const ahead = 9e12;
  const bg = loadBackground({
    sendMessage: () => ({ applied: false, op: ahead })
  });
  const scan = bg.get('newScan')();
  const first = scan.op;
  assert.ok(first < ahead);

  await bg.get('showBusy')(1, 'image', scan);

  const busy = bg.sent.filter((m) => m.type === 'qrgenie:show-busy');
  assert.strictEqual(busy.length, 2, 'the dropped message is sent again');
  assert.strictEqual(busy[0].op, first);
  assert.ok(scan.op > ahead, 'the new id is above everything the page has seen');
  assert.strictEqual(busy[1].op, scan.op);
});

test('catching up keeps overlapping scans in the order they started', async () => {
  // Two scans are in flight and the page is ahead of both. The older one's
  // answer is what uncovers that, and correcting it alone would push it above
  // the newer one — the newer scan would still be sitting under an id the page
  // has outgrown, so every message it sent from then on would be dropped there
  // while the older scan owned the corner.
  const ahead = 9e12;
  const bg = loadBackground({ sendMessage: () => ({ applied: false, op: ahead }) });
  const older = bg.get('newScan')();
  const newer = bg.get('newScan')();
  assert.ok(newer.op > older.op, 'the second scan starts above the first');

  await bg.get('showBusy')(1, 'image', older);

  assert.ok(older.op > ahead, 'the older scan caught up with the page');
  assert.ok(newer.op > older.op, 'and the newer scan still outranks it');
});

test('a scan that has finished is left out of the catch-up', async () => {
  // Its flow is over: it has nothing left to send, and dragging it along would
  // put a settled scan above the ones still running.
  let pageOp = 9e12;
  const bg = loadBackground({ sendMessage: () => ({ applied: false, op: pageOp }) });
  const done = bg.get('newScan')();
  const running = bg.get('newScan')();

  await bg.get('showResult')(1, { ok: false, source: 'image', reason: null }, done);
  const settledAt = done.op;

  // The page moves further ahead, so the next answer triggers a second
  // catch-up while only one of the two scans is still going.
  pageOp = 9e13;
  await bg.get('showBusy')(1, 'image', running);

  assert.strictEqual(done.op, settledAt, 'the finished scan was not reissued');
  assert.ok(running.op > pageOp, 'the live scan caught up with the page');
});

test('a genuinely newer scan of our own never hands the corner back', async () => {
  // The page answering with a higher id is ordinary when a second scan of ours
  // is already running. Only an id this worker could not have issued means the
  // clock moved, and only that may restart a scan.
  let newerOp = 0;
  const bg = loadBackground({ sendMessage: () => ({ applied: false, op: newerOp }) });
  const older = bg.get('newScan')();
  newerOp = bg.get('newScan')().op; // a newer scan takes the corner

  await bg.get('showBusy')(1, 'image', older);

  const busy = bg.sent.filter((m) => m.type === 'qrgenie:show-busy');
  assert.strictEqual(busy.length, 1, 'the older scan stays dropped');
});

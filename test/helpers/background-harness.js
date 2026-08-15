/*
 * Runs background.js in a vm context with a stubbed extension API, so the
 * capture handshake can be tested the way it actually runs instead of by
 * reading the source.
 *
 * background.js is not wrapped in a function, so every top-level declaration
 * lands in the context and the tests can call hideForCapture,
 * captureTabForDecode and showBusy directly.
 *
 * The clocks are ours, and there are two of them, because background.js reads
 * two: Date.now() seeds scan ids, and performance.now() measures how long a
 * capture has been pending. A test needs to move time without spending it, and
 * needs to move the wall clock on its own — a wall clock that steps backwards
 * mid-capture is the thing the monotonic one is there to survive.
 *
 * loadBackground(stubs) -> { get, sent, executed, advance, stepWallClock }
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const START_MS = 1000000;

/*
 * The worker arms 1s and 1.5s give-up timers on every capture, and the race
 * they belong to is long settled by the time they fire. Left pending they only
 * hold the test process open, so they are unref'd; the short ones (a repaint
 * beat) are real waits and are not.
 */
const LONG_TIMER_MS = 1000;

function armTimer(fn, ms) {
  const t = setTimeout(fn, ms);
  if (ms >= LONG_TIMER_MS && typeof t.unref === 'function') t.unref();
  return t;
}

/*
 * stubs.sendMessage(msg, tabId)   what the page answers; throw to reject
 * stubs.executeScript(arg)        what an injection returns
 * stubs.capture()                 what captureVisibleTab returns
 */
function loadBackground(stubs = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'background.js'),
    'utf8'
  );

  let now = START_MS;
  let mono = 0;
  const sent = [];
  const executed = [];
  let nonces = 0;

  const noopEvent = { addListener() {} };

  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    crypto: { randomUUID: () => `nonce-${++nonces}` },
    Date: { now: () => now },
    performance: { now: () => mono },
    setTimeout: (fn, ms) => armTimer(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    chrome: {
      runtime: {
        onInstalled: noopEvent,
        onMessage: noopEvent,
        getURL: (p) => `chrome-extension://qrgenie/${p}`
      },
      contextMenus: {
        onClicked: noopEvent,
        create() {},
        removeAll: () => Promise.resolve()
      },
      tabs: {
        async sendMessage(tabId, msg) {
          sent.push(msg);
          if (typeof stubs.sendMessage === 'function') return stubs.sendMessage(msg, tabId);
          return undefined;
        },
        async get(tabId) {
          return { id: tabId, windowId: 1 };
        },
        async captureVisibleTab() {
          if (typeof stubs.capture === 'function') return stubs.capture();
          return 'data:image/png;base64,AAAA';
        },
        async create() {}
      },
      scripting: {
        async executeScript(arg) {
          executed.push(arg);
          if (typeof stubs.executeScript === 'function') return stubs.executeScript(arg);
          return [{ result: true }];
        }
      }
    }
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'background.js' });

  return {
    sent,
    executed,

    // Any function background.js declared at top level.
    get(name) {
      return vm.runInContext(name, context);
    },

    // Time passes: both clocks move, without the test spending the time.
    advance(ms) {
      now += ms;
      mono += ms;
    },

    // The wall clock alone jumps, forwards or backwards, the way an NTP
    // correction moves it under a running worker. Monotonic time is untouched.
    stepWallClock(ms) {
      now += ms;
    }
  };
}

module.exports = { loadBackground };

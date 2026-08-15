/*
 * Runs content/overlay.js in a vm context with a DOM stub, so the message
 * protocol can be tested for real instead of by reading the source. The stub
 * is deliberately tiny: the overlay only ever creates elements, sets styles,
 * appends and removes, and the tests only ever ask what is on screen and
 * whether it is displayed.
 *
 * loadOverlay() -> { send, sendAsync, hosts, hideNow, runTimers, document }
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElement(tagName) {
  const el = {
    tagName,
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    children: [],
    parent: null,
    shadow: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    attachShadow() {
      el.shadow = makeElement('#shadow-root');
      return el.shadow;
    },
    appendChild(child) {
      if (child.parent) child.parent.removeChild(child);
      el.children.push(child);
      child.parent = el;
      return child;
    },
    append(...kids) {
      for (const kid of kids) el.appendChild(kid);
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      child.parent = null;
      return child;
    },
    remove() {
      if (el.parent) el.parent.removeChild(el);
    },
    // Every lookup the overlay makes is on markup it just wrote; the tests
    // never assert through it, so one inert element is answer enough.
    querySelector() {
      return makeElement('stub');
    },
    addEventListener() {},
    removeEventListener() {},
    select() {}
  };
  return el;
}

/*
 * The overlay arms give-up timers of 5 and 20 seconds that no test waits for,
 * and a pending timer keeps the process alive: those get unref'd. The short
 * ones must not be, or the run could exit before the answer a test is
 * awaiting ever fires.
 */
const LONG_TIMER_MS = 1000;

/*
 * Every timer the overlay arms is also recorded, so a test can fire the long
 * give-up ones (a capture lease running out, the indicator giving up) without
 * sitting through five real seconds. Firing one cancels the real timer, so it
 * never runs twice.
 */
function makeClock() {
  const pending = new Set();

  function arm(fn, ms) {
    const entry = { ms, fn, handle: null };
    entry.handle = setTimeout(() => {
      pending.delete(entry);
      fn();
    }, ms);
    if (ms >= LONG_TIMER_MS && typeof entry.handle.unref === 'function') entry.handle.unref();
    pending.add(entry);
    return entry.handle;
  }

  function cancel(handle) {
    clearTimeout(handle);
    for (const entry of pending) {
      if (entry.handle === handle) pending.delete(entry);
    }
  }

  // Fires every pending timer armed with exactly this delay, in the order they
  // were armed. Returns how many ran, so a test can assert it armed anything.
  function run(ms) {
    const due = [...pending].filter((entry) => entry.ms === ms);
    let fired = 0;
    for (const entry of due) {
      // One of these can cancel another (a give-up timer being renewed), and a
      // cancelled timer must not fire.
      if (!pending.has(entry)) continue;
      pending.delete(entry);
      clearTimeout(entry.handle);
      fired++;
      entry.fn();
    }
    return fired;
  }

  return { arm, cancel, run };
}

function loadOverlay() {
  const clock = makeClock();
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'content', 'overlay.js'),
    'utf8'
  );

  const body = makeElement('body');
  const document = {
    body,
    documentElement: body,
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
    removeEventListener() {}
  };

  let listener = null;
  const sandbox = {
    document,
    navigator: {},
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            listener = fn;
          }
        },
        sendMessage() {}
      }
    },
    setTimeout: (fn, ms) => clock.arm(fn, ms),
    clearTimeout: (t) => clock.cancel(t),
    requestAnimationFrame: (fn) => clock.arm(fn, 0)
  };

  const context = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis;', context);
  vm.runInContext(source, context, { filename: 'overlay.js' });

  if (typeof listener !== 'function') {
    throw new Error('overlay.js did not register a message listener');
  }

  return {
    document,

    // For the messages the overlay answers on the spot. Returns what the
    // worker would receive, which is undefined when it answered nothing.
    send(msg) {
      let answer;
      listener(msg, {}, (value) => {
        answer = value;
      });
      return answer;
    },

    // For qrgenie:hide-for-capture, which answers once the page would have
    // painted without us. Resolves with what the worker would receive.
    sendAsync(msg) {
      return new Promise((resolve, reject) => {
        const kept = listener(msg, {}, resolve);
        if (kept !== true) reject(new Error(`${msg.type} did not keep the channel open`));
      });
    },

    // The worker's forced-hide hook, published on the content script's window.
    hideNow(op) {
      return sandbox.__qrgenieHideNow(op);
    },

    // Fires the overlay's own give-up timers without waiting for them.
    runTimers(ms) {
      return clock.run(ms);
    },

    /*
     * What the page shows, oldest first: one entry per host element the
     * overlay put in the body. `kind` is 'pill' for the decoding indicator and
     * 'card' for the result card; `hidden` is what the capture path sets.
     */
    hosts() {
      return body.children.map((host) => {
        const drawn = (host.shadow ? host.shadow.children : []).find(
          (child) => child.className === 'pill' || child.className === 'card'
        );
        return {
          kind: drawn ? drawn.className : null,
          hidden: host.style.display === 'none'
        };
      });
    }
  };
}

module.exports = { loadOverlay };

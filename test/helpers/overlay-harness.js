/*
 * Runs content/overlay.js in a vm context with a DOM stub, so the message
 * protocol can be tested for real instead of by reading the source. The stub
 * is deliberately tiny: the overlay only ever creates elements, sets styles,
 * appends and removes, and the tests only ever ask what is on screen and
 * whether it is displayed.
 *
 * loadOverlay() -> { send, sendAsync, hosts, hideNow, document }
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

function armTimer(fn, ms) {
  const t = setTimeout(fn, ms);
  if (ms >= LONG_TIMER_MS && typeof t.unref === 'function') t.unref();
  return t;
}

function loadOverlay() {
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
    setTimeout: (fn, ms) => armTimer(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    requestAnimationFrame: (fn) => armTimer(fn, 0)
  };

  const context = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis;', context);
  vm.runInContext(source, context, { filename: 'overlay.js' });

  if (typeof listener !== 'function') {
    throw new Error('overlay.js did not register a message listener');
  }

  return {
    document,

    // Fire and forget, for the messages the overlay does not answer.
    send(msg) {
      listener(msg, {}, () => {});
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

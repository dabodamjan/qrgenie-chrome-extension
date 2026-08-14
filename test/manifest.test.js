'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The manifest is the cross-browser superset (see PORTS.md): Chrome/Edge run
// background.service_worker, Firefox runs background.scripts. These tests pin
// the invariants that keep the two halves in sync, because nothing at runtime
// checks them — a drifted manifest only fails later, inside a browser.

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('service worker and event page run the same code', () => {
  assert.strictEqual(manifest.background.service_worker, 'background.js');
  const scripts = manifest.background.scripts;
  assert.ok(Array.isArray(scripts) && scripts.length > 0);
  assert.strictEqual(scripts[scripts.length - 1], 'background.js');
});

test('firefox script list matches the worker importScripts list', () => {
  // Chrome loads dependencies via importScripts in background.js; Firefox
  // loads them from background.scripts. Both lists must name the same files
  // in the same order or one browser silently runs without a dependency.
  const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const call = source.match(/importScripts\(([^)]*)\)/);
  assert.ok(call, 'background.js calls importScripts');
  const imported = call[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual(manifest.background.scripts.slice(0, -1), imported);
});

test('every listed background script exists', () => {
  for (const file of manifest.background.scripts) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
  }
});

test('gecko settings satisfy AMO submission requirements', () => {
  const gecko = manifest.browser_specific_settings.gecko;
  // MV3 signing requires an explicit id (AMO does not assign one).
  assert.match(gecko.id, /^[a-z0-9.-]+@[a-z0-9.-]+$/i);
  assert.match(gecko.strict_min_version, /^\d+\.\d+$/);
  // Mandatory for new AMO submissions since 2025-11-03; "none" is the
  // zero-collection declaration and is load-bearing store copy.
  assert.deepStrictEqual(gecko.data_collection_permissions.required, ['none']);
});

test('permissions stay minimal', () => {
  assert.deepStrictEqual(manifest.permissions, ['contextMenus', 'activeTab', 'scripting']);
  assert.strictEqual(manifest.host_permissions, undefined);
});

test('version matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(manifest.version, pkg.version);
});

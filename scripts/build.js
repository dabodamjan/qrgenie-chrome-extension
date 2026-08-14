/*
 * Builds the per-store packages into dist/. No dependencies; zipping shells
 * out to the system `zip` (present on macOS and Linux).
 *
 * The repository manifest is the cross-browser superset: Chrome and Edge run
 * background.service_worker and ignore background.scripts and
 * browser_specific_settings; Firefox runs background.scripts (an event page)
 * and ignores service_worker. Each package gets that manifest with the keys
 * the target browser does not use removed, so store validators see only what
 * their browser reads. Everything else ships identically. See PORTS.md.
 *
 *   node scripts/build.js            all three targets
 *   node scripts/build.js firefox    one target
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Everything a browser loads, plus the license files (Apache 2.0 asks for the
// license text to travel with jsQR). Repo docs, tests and this script stay out.
const INCLUDE = [
  'background.js',
  'common',
  'content',
  'popup',
  'viewer',
  'vendor',
  'icons',
  'LICENSE',
  'LICENSES.md'
];

const TARGETS = {
  chrome: (manifest) => {
    delete manifest.background.scripts;
    delete manifest.browser_specific_settings;
    return manifest;
  },
  firefox: (manifest) => {
    delete manifest.background.service_worker;
    return manifest;
  },
  edge: (manifest) => {
    delete manifest.background.scripts;
    delete manifest.browser_specific_settings;
    return manifest;
  }
};

function build(target) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const outDir = path.join(DIST, target);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of INCLUDE) {
    fs.cpSync(path.join(ROOT, entry), path.join(outDir, entry), {
      recursive: true,
      filter: (src) => path.basename(src) !== '.DS_Store'
    });
  }
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(TARGETS[target](manifest), null, 2) + '\n'
  );

  const zipName = `qr-decoder-${target}-${manifest.version}.zip`;
  const zipPath = path.join(DIST, zipName);
  fs.rmSync(zipPath, { force: true });
  // -X: no platform extra fields (resource forks etc.) in the archive.
  const zip = spawnSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: outDir });
  if (zip.error || zip.status !== 0) {
    console.error(`${target}: staged ${path.relative(ROOT, outDir)}, but zip failed` +
      (zip.error ? ` (${zip.error.message})` : ''));
    console.error(`  package it manually: cd ${path.relative(ROOT, outDir)} && zip -r -X ../${zipName} .`);
    return false;
  }
  const kb = Math.round(fs.statSync(zipPath).size / 1024);
  console.log(`${target}: dist/${zipName} (${kb} KB)`);
  return true;
}

const requested = process.argv[2] ? [process.argv[2]] : Object.keys(TARGETS);
for (const target of requested) {
  if (!TARGETS[target]) {
    console.error(`Unknown target "${target}". Use: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}
const results = requested.map(build);
process.exit(results.every(Boolean) ? 0 : 1);

#!/usr/bin/env node
'use strict';

/**
 * apply.cjs — Apply porter output to the target IDE config directory.
 *
 * Reads:  ./output/.gemini/{skills,agents,settings.json}
 * Writes: <OUT_TARGET>/skills/        (existing tree backed up)
 *         <OUT_TARGET>/agents/        (existing tree backed up)
 *         <OUT_TARGET>/settings.json  (merged with existing, hooks subkey union)
 *
 * Resolution order for OUT_TARGET:
 *   1. process.env.OUT_TARGET
 *   2. ~/.gemini (created if missing)
 *
 * The shim command paths in settings.json are rewritten on-the-fly to point
 * at this repo's actual location (OMC_PORTER_ROOT, defaulting to __dirname).
 *
 * Re-run after every `node port-omc.cjs` to push fresh content to the IDE.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(function loadDotenv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const line = raw.replace(/^\s*#.*$/, '').trim();
      if (!line) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v.startsWith('~/') || v === '~') v = path.join(os.homedir(), v.slice(1));
      process.env[m[1]] = v;
    }
  } catch { /* silent — .env is optional */ }
})();

const OUT_DIR = path.join(__dirname, 'output', '.gemini');
const PORTER_ROOT = process.env.OMC_PORTER_ROOT || __dirname;

function resolveTarget() {
  if (process.env.OUT_TARGET) {
    const t = process.env.OUT_TARGET;
    if (!fs.existsSync(t)) fs.mkdirSync(t, { recursive: true });
    return t;
  }
  const def = path.join(os.homedir(), '.gemini');
  if (!fs.existsSync(def)) fs.mkdirSync(def, { recursive: true });
  return def;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function mergeAndCopy(srcDir, dstDir, label) {
  // Per-entry merge: only the incoming entries from srcDir overwrite
  // existing entries with the same name in dstDir. Any other content in
  // dstDir (user-authored skills/agents not shipped by OMC) is preserved.
  // Conflicting entries are backed up under `<dstDir>.backup-<ts>/`.
  if (!fs.existsSync(srcDir)) {
    console.log(`(skip ${label}: ${srcDir} not found — run port-omc.cjs first)`);
    return 0;
  }
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

  const incoming = fs.readdirSync(srcDir);
  const overwriting = incoming.filter(n => fs.existsSync(path.join(dstDir, n)));

  if (overwriting.length > 0) {
    const bk = `${dstDir}.backup-${ts()}`;
    fs.mkdirSync(bk, { recursive: true });
    for (const name of overwriting) {
      copyRecursive(path.join(dstDir, name), path.join(bk, name));
    }
    console.log(`  ↳ backed up ${overwriting.length} conflicting ${label} → ${bk}`);
  }

  for (const name of incoming) {
    const dst = path.join(dstDir, name);
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    copyRecursive(path.join(srcDir, name), dst);
  }

  const added = incoming.length - overwriting.length;
  console.log(`Applied ${incoming.length} ${label} → ${dstDir} (${overwriting.length} overwritten, ${added} added, user content preserved)`);
  return incoming.length;
}

/**
 * Rewrite the absolute shim paths in settings.json so they point at this
 * repo's actual location instead of whatever was hard-coded at port time.
 */
function rewriteShimPaths(settings) {
  if (!settings.hooks) return settings;
  const shimDir = path.join(PORTER_ROOT, 'shims').replace(/\\/g, '/');
  const cmdPattern = /node\s+"[^"]*[\\/]shims[\\/]([a-z-]+\.cjs)"/i;

  for (const eventName of Object.keys(settings.hooks)) {
    const groups = settings.hooks[eventName];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!Array.isArray(g.hooks)) continue;
      for (const h of g.hooks) {
        if (typeof h.command !== 'string') continue;
        const m = h.command.match(cmdPattern);
        if (m) h.command = `node "${shimDir}/${m[1]}"`;
      }
    }
  }
  return settings;
}

function mergeSettings(target) {
  const src = path.join(OUT_DIR, 'settings.json');
  const dst = path.join(target, 'settings.json');
  if (!fs.existsSync(src)) {
    console.log(`(skip settings.json: ${src} not found)`);
    return;
  }

  let incoming = JSON.parse(fs.readFileSync(src, 'utf-8'));
  incoming = rewriteShimPaths(incoming);

  let existing = {};
  if (fs.existsSync(dst)) {
    try { existing = JSON.parse(fs.readFileSync(dst, 'utf-8')); } catch {}
    fs.copyFileSync(dst, `${dst}.backup-${ts()}`);
    console.log(`  ↳ backed up existing settings.json`);
  }

  const merged = { ...existing, ...incoming };
  if (existing.hooks || incoming.hooks) {
    merged.hooks = { ...(existing.hooks || {}), ...(incoming.hooks || {}) };
  }

  fs.writeFileSync(dst, JSON.stringify(merged, null, 2));
  console.log(`Merged settings.json → ${dst}`);
  console.log(`  shim paths rewritten to: ${path.join(PORTER_ROOT, 'shims')}`);
}

function main() {
  const target = resolveTarget();
  console.log(`Target: ${target}`);
  console.log(`Porter root: ${PORTER_ROOT}\n`);

  mergeAndCopy(path.join(OUT_DIR, 'skills'), path.join(target, 'skills'), 'skills');
  mergeAndCopy(path.join(OUT_DIR, 'agents'), path.join(target, 'agents'), 'agents');
  mergeSettings(target);

  console.log('\nDone. Restart your IDE / CLI to pick up the new hooks and skills.');
  if (!process.env.OMC_PORTER_FORCE_LEGACY_SESSION) {
    console.log('Tip: export OMC_PORTER_FORCE_LEGACY_SESSION=1 in your shell profile');
    console.log('     until you know your IDE\'s session-ID convention.');
  }
}

main();

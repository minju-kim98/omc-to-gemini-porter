#!/usr/bin/env node
'use strict';

/**
 * install-probe.cjs — register/unregister hook-probe.cjs in a Codex-family
 * CODEX_HOME so we can learn which hook events the host actually fires.
 *
 * Usage:
 *   node probe/install-probe.cjs                 # install into ~/.ditcode
 *   node probe/install-probe.cjs --home ~/.codex # install elsewhere
 *   node probe/install-probe.cjs --uninstall     # restore the backup
 *
 * Any pre-existing hooks.json is backed up to hooks.json.probe-bak before we
 * write, and restored on --uninstall. We never merge into a live hooks.json:
 * the probe owns the file for the duration of the test, then hands it back.
 * (~/.codex already has a gctree-managed hooks.json — do not target it.)
 *
 * Note: Codex hook `timeout` is in SECONDS (Gemini's settings.json used ms).
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'Notification',
];

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const HOME = path.resolve(expandHome(argValue('--home', '~/.ditcode')));
const HOOKS = path.join(HOME, 'hooks.json');
const BACKUP = path.join(HOME, 'hooks.json.probe-bak');
const PROBE = path.join(__dirname, 'hook-probe.cjs');

function uninstall() {
  if (!fs.existsSync(HOOKS)) {
    console.log(`nothing to remove: ${HOOKS}`);
    return;
  }
  // Only reclaim a file we own — never delete a hooks.json someone else wrote.
  let owned = false;
  try {
    owned = fs.readFileSync(HOOKS, 'utf-8').includes('hook-probe.cjs');
  } catch { /* unreadable — treat as not ours */ }

  if (!owned) {
    console.error(`refusing to touch ${HOOKS} — it is not the probe's file.`);
    process.exit(1);
  }

  if (fs.existsSync(BACKUP)) {
    fs.copyFileSync(BACKUP, HOOKS);
    fs.rmSync(BACKUP);
    console.log(`restored original hooks.json from backup`);
  } else {
    fs.rmSync(HOOKS);
    console.log(`removed probe hooks.json (there was no original)`);
  }
}

function install() {
  if (!fs.existsSync(HOME)) {
    console.error(`CODEX_HOME not found: ${HOME}`);
    console.error(`pass --home <dir> if your install lives elsewhere.`);
    process.exit(1);
  }
  if (!fs.existsSync(PROBE)) {
    console.error(`probe script missing: ${PROBE}`);
    process.exit(1);
  }

  if (fs.existsSync(HOOKS) && !fs.existsSync(BACKUP)) {
    fs.copyFileSync(HOOKS, BACKUP);
    console.log(`backed up existing hooks.json -> ${BACKUP}`);
  }

  const hooks = {};
  for (const event of EVENTS) {
    hooks[event] = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${PROBE}" --event ${event}`,
            timeout: 10,
          },
        ],
      },
    ];
  }

  fs.writeFileSync(HOOKS, JSON.stringify({ hooks }, null, 2) + '\n');
  console.log(`installed probe for ${EVENTS.length} events -> ${HOOKS}`);
  console.log(`\nNext:`);
  console.log(`  1. Launch DIT Code Agent, send one prompt, let it run a tool, then quit.`);
  console.log(`  2. node probe/report.cjs`);
  console.log(`  3. node probe/install-probe.cjs --uninstall`);
}

if (process.argv.includes('--uninstall')) uninstall();
else install();

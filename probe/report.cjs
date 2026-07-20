#!/usr/bin/env node
'use strict';

/**
 * report.cjs — summarise what the probe captured.
 *
 * Answers the three questions that gate the Codex port:
 *   1. Which hook events does the host actually fire?
 *   2. Does the payload carry `session_id`? (decides whether we still need
 *      OMC_PORTER_FORCE_LEGACY_SESSION)
 *   3. Do payload field names match OMC's Claude Code expectations?
 */

const fs = require('node:fs');
const path = require('node:path');

const LOG = process.env.OMC_PROBE_LOG ||
  path.join(__dirname, '..', '.scratch', 'probe.jsonl');

const EXPECTED = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'Notification',
];

// Fields OMC's hook scripts read off the Claude Code payload.
const OMC_FIELDS = ['session_id', 'transcript_path', 'cwd', 'prompt',
  'hook_event_name', 'tool_name', 'tool_input'];

if (!fs.existsSync(LOG)) {
  console.error(`no probe log at ${LOG}`);
  console.error(`did the host run at all? was the probe installed?`);
  process.exit(1);
}

const records = fs.readFileSync(LOG, 'utf-8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

if (records.length === 0) {
  console.error(`probe log is empty — no hook ever fired.`);
  console.error(`=> this host likely does not support hooks. Stop the port here.`);
  process.exit(2);
}

const byEvent = new Map();
for (const r of records) {
  if (!byEvent.has(r.event)) byEvent.set(r.event, []);
  byEvent.get(r.event).push(r);
}

console.log(`probe log: ${LOG}`);
console.log(`records:   ${records.length}\n`);

console.log(`EVENTS`);
for (const event of EXPECTED) {
  const hits = byEvent.get(event) || [];
  const mark = hits.length ? 'FIRED  ' : 'silent ';
  const note = !hits.length && event === 'Stop'
    ? '   <-- ralph/autopilot auto-loop depends on this'
    : '';
  console.log(`  ${mark} ${event.padEnd(18)} ${String(hits.length).padStart(3)}${note}`);
}

const unexpected = [...byEvent.keys()].filter(e => !EXPECTED.includes(e));
if (unexpected.length) {
  console.log(`\n  host-specific events not in the Claude Code set:`);
  for (const e of unexpected) console.log(`    ${e} (${byEvent.get(e).length})`);
}

console.log(`\nPAYLOAD FIELDS (per event)`);
for (const [event, hits] of byEvent) {
  const keys = new Set();
  for (const h of hits) for (const k of h.keys || []) keys.add(k);
  console.log(`  ${event}`);
  console.log(`    present: ${[...keys].sort().join(', ') || '(none — payload not JSON?)'}`);
  const missing = OMC_FIELDS.filter(f => !keys.has(f));
  if (missing.length) console.log(`    OMC expects but absent: ${missing.join(', ')}`);
}

const sawSession = records.some(r => (r.keys || []).includes('session_id'));
console.log(`\nVERDICT`);
console.log(`  hooks supported:        ${records.length > 0 ? 'YES' : 'NO'}`);
console.log(`  Stop event (auto-loop): ${byEvent.has('Stop') ? 'YES' : 'NO'}`);
console.log(`  session_id in payload:  ${sawSession ? 'YES — full multi-session isolation possible'
  : 'NO — keep OMC_PORTER_FORCE_LEGACY_SESSION=1'}`);

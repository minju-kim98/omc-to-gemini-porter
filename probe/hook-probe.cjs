#!/usr/bin/env node
'use strict';

/**
 * hook-probe.cjs — passive Codex hook probe.
 *
 * Registered for every Codex hook event by install-probe.cjs. Records the
 * event name and the raw stdin payload, then exits cleanly so the host IDE
 * is never affected.
 *
 * Contract guarantees (do not weaken — this runs inside the user's IDE):
 *   - always exits 0
 *   - always writes `{}` to stdout (no-op for every known hook schema)
 *   - never throws: every step is wrapped
 *
 * Log: ../.scratch/probe.jsonl  (override with OMC_PROBE_LOG)
 */

const fs = require('node:fs');
const path = require('node:path');

const LOG = process.env.OMC_PROBE_LOG ||
  path.join(__dirname, '..', '.scratch', 'probe.jsonl');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : '';
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf-8'); } catch { /* no stdin */ }

  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* not JSON — keep raw */ }

  const record = {
    at: new Date().toISOString(),
    event: argValue('--event') || '(unknown)',
    cwd: process.cwd(),
    // Field *names* are what matter for porting; values may hold prompt text,
    // so keep the parsed payload but note the raw length for truncation checks.
    stdin_len: raw.length,
    stdin_is_json: parsed !== null,
    keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
    payload: parsed !== null ? parsed : raw.slice(0, 2000),
  };

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(record) + '\n');
} catch { /* probe must never break the host */ }

process.stdout.write('{}');
process.exit(0);

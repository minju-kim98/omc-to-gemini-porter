#!/usr/bin/env node
'use strict';

/**
 * Gemini CLI AfterAgent → OMC Stop hook shim
 *
 * Wraps OMC's persistent-mode.cjs (the engine behind ralph/autopilot/
 * ultrawork/ultraqa/pipeline/team auto-loops). Translates the Gemini
 * AfterAgent stdin/stdout contract to Claude Code's Stop hook contract.
 *
 * Mapping (key idea):
 *   OMC stdout {"decision":"block","reason":"..."}  ─►  Gemini stdout
 *   {"decision":"deny","reason":"..."}  (triggers a retry turn)
 *
 *   OMC stdout {"continue":true}  ─►  Gemini stdout {}  (proceed normally)
 *
 *   OMC stdout {"continue":false,...}  ─►  Gemini stdout
 *   {"continue":false,"stopReason":"..."}  (halt session)
 *
 * Env:
 *   OMC_ROOT  Optional override of the OMC install path. Falls back to
 *             CLAUDE_PLUGIN_ROOT, then the default npm-global location.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  resolveOmcRoot,
  readStdinSync,
  parseJsonSafe,
  emit,
  exitPassthrough,
} = require('./_common.cjs');

const OMC_ROOT = resolveOmcRoot();
if (!OMC_ROOT) exitPassthrough();

const geminiInput = parseJsonSafe(readStdinSync());

// PoC convenience: when set, shim passes an empty session_id so that OMC
// matches state files that omit the `session_id` key (legacy contract).
// This lets users seed `ralph-state.json` without knowing the IDE-issued
// session id in advance. Leave unset (default) for accurate multi-session
// isolation once the IDE's session id is known.
const FORCE_LEGACY_SESSION =
  process.env.OMC_PORTER_FORCE_LEGACY_SESSION === '1';

const claudeInput = {
  hook_event_name: 'Stop',
  session_id: FORCE_LEGACY_SESSION ? '' : (geminiInput.session_id || ''),
  transcript_path: geminiInput.transcript_path || '',
  cwd: geminiInput.cwd || process.cwd(),
  stop_hook_active: geminiInput.stop_hook_active === true,
};

const runner = path.join(OMC_ROOT, 'scripts', 'run.cjs');
const target = path.join(OMC_ROOT, 'scripts', 'persistent-mode.cjs');

const result = spawnSync(
  process.execPath,
  [runner, target],
  {
    input: JSON.stringify(claudeInput),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: OMC_ROOT },
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 15_000,
  }
);

const claudeOut = parseJsonSafe((result.stdout || '').trim());

let geminiOut = {};
if (claudeOut.decision === 'block' && typeof claudeOut.reason === 'string') {
  geminiOut = { decision: 'deny', reason: claudeOut.reason };
  if (typeof claudeOut.systemMessage === 'string') {
    geminiOut.systemMessage = claudeOut.systemMessage;
  }
} else if (claudeOut.continue === false) {
  geminiOut = {
    continue: false,
    stopReason: claudeOut.reason || claudeOut.systemMessage || 'OMC halt',
  };
}

emit(geminiOut);
process.exit(0);

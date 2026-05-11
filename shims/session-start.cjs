#!/usr/bin/env node
'use strict';

/**
 * Gemini SessionStart → OMC SessionStart shim
 *
 * Invokes the matching set of OMC scripts based on the session source.
 * The Gemini SessionStart `source` field maps onto OMC's matcher convention
 * (startup → "*", and init/maintenance variants pass through unchanged).
 */

const {
  resolveOmcRoot,
  readStdinSync,
  parseJsonSafe,
  emit,
  exitPassthrough,
  getLegacySession,
  runOmcScript,
  translateClaudeOutToGemini,
  mergeGeminiOutputs,
} = require('./_common.cjs');

const OMC_ROOT = resolveOmcRoot();
if (!OMC_ROOT) exitPassthrough();

const gi = parseJsonSafe(readStdinSync());
const source = (gi.source || 'startup').toLowerCase();

const ci = {
  hook_event_name: 'SessionStart',
  session_id: getLegacySession() ? '' : (gi.session_id || ''),
  transcript_path: gi.transcript_path || '',
  cwd: gi.cwd || process.cwd(),
  source,
};

const outs = [];
outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'session-start.mjs', ci, [], 5_000), 'SessionStart'));
outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'project-memory-session.mjs', ci, [], 5_000), 'SessionStart'));

if (source === 'init') {
  outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'setup-init.mjs', ci, [], 30_000), 'SessionStart'));
} else if (source === 'maintenance') {
  outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'setup-maintenance.mjs', ci, [], 60_000), 'SessionStart'));
}

emit(mergeGeminiOutputs(...outs));
process.exit(0);

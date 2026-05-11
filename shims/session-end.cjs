#!/usr/bin/env node
'use strict';

/**
 * Gemini SessionEnd → OMC SessionEnd shim
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
} = require('./_common.cjs');

const OMC_ROOT = resolveOmcRoot();
if (!OMC_ROOT) exitPassthrough();

const gi = parseJsonSafe(readStdinSync());
const ci = {
  hook_event_name: 'SessionEnd',
  session_id: getLegacySession() ? '' : (gi.session_id || ''),
  transcript_path: gi.transcript_path || '',
  cwd: gi.cwd || process.cwd(),
  reason: gi.reason || 'exit',
};

const out = translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'session-end.mjs', ci, [], 30_000), 'SessionEnd');
emit(out);
process.exit(0);

#!/usr/bin/env node
'use strict';

/**
 * Gemini PreCompress → OMC PreCompact shim
 *
 * Invokes:
 *   - pre-compact.mjs                  (always)
 *   - project-memory-precompact.mjs    (always)
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
const ci = {
  hook_event_name: 'PreCompact',
  session_id: getLegacySession() ? '' : (gi.session_id || ''),
  transcript_path: gi.transcript_path || '',
  cwd: gi.cwd || process.cwd(),
  trigger: gi.trigger || 'auto',
};

const out1 = translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'pre-compact.mjs', ci, [], 10_000), 'PreCompress');
const out2 = translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'project-memory-precompact.mjs', ci, [], 5_000), 'PreCompress');

emit(mergeGeminiOutputs(out1, out2));
process.exit(0);

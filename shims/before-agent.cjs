#!/usr/bin/env node
'use strict';

/**
 * Gemini BeforeAgent → OMC UserPromptSubmit shim
 *
 * Invokes:
 *   - keyword-detector.mjs  (OMC magic-keyword → skill auto-invoke)
 *   - skill-injector.mjs    (OMC skill instruction injection)
 *
 * Both scripts may produce additionalContext that gets concatenated and
 * surfaced to the model as a single BeforeAgent additionalContext.
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
  hook_event_name: 'UserPromptSubmit',
  session_id: getLegacySession() ? '' : (gi.session_id || ''),
  transcript_path: gi.transcript_path || '',
  cwd: gi.cwd || process.cwd(),
  prompt: gi.prompt || '',
};

const out1 = translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'keyword-detector.mjs', ci, [], 5_000), 'BeforeAgent');
const out2 = translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'skill-injector.mjs', ci, [], 3_000), 'BeforeAgent');

const merged = mergeGeminiOutputs(out1, out2);

// Strip the "oh-my-claudecode:" / "oh-my-claudecode-" namespace from any
// skill references so the host IDE's skill registry matches by bare slug.
// OMC's keyword-detector emits e.g. "Skill: oh-my-claudecode:ralph"; most
// Gemini CLI environments only know "ralph". Without this rewrite the model
// sees an unresolvable id.
function stripNamespace(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/oh-my-claudecode:([a-z0-9_-]+)/gi, '$1')
    .replace(/oh-my-claudecode-([a-z0-9_-]+)/gi, '$1');
}

if (merged.hookSpecificOutput?.additionalContext) {
  merged.hookSpecificOutput.additionalContext = stripNamespace(merged.hookSpecificOutput.additionalContext);
}
if (merged.systemMessage) {
  merged.systemMessage = stripNamespace(merged.systemMessage);
}
if (merged.reason) {
  merged.reason = stripNamespace(merged.reason);
}

emit(merged);
process.exit(0);

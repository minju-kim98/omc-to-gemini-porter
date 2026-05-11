#!/usr/bin/env node
'use strict';

/**
 * Gemini BeforeTool → OMC PreToolUse (+SubagentStart) shim
 *
 * Invokes:
 *   - pre-tool-enforcer.mjs            (always)
 *   - subagent-tracker.mjs start       (only when tool_name === "agent_run")
 *
 * Rationale: Gemini has no native SubagentStart event. We treat any
 * agent_run tool call as a subagent invocation and fire OMC's tracker
 * for the start side of the lifecycle.
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
  hook_event_name: 'PreToolUse',
  session_id: getLegacySession() ? '' : (gi.session_id || ''),
  transcript_path: gi.transcript_path || '',
  cwd: gi.cwd || process.cwd(),
  tool_name: gi.tool_name || '',
  tool_input: gi.tool_input || {},
};

const out1 = translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'pre-tool-enforcer.mjs', ci, [], 3_000), 'BeforeTool');

let out2 = {};
if (ci.tool_name === 'agent_run') {
  out2 = translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'subagent-tracker.mjs', ci, ['start'], 3_000), 'BeforeTool');
}

emit(mergeGeminiOutputs(out1, out2));
process.exit(0);

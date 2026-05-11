#!/usr/bin/env node
'use strict';

/**
 * Gemini AfterTool → OMC PostToolUse (+ PostToolUseFailure + SubagentStop) shim
 *
 * Invokes:
 *   - post-tool-verifier.mjs           (always)
 *   - project-memory-posttool.mjs      (always)
 *   - post-tool-use-failure.mjs        (only when tool_response.error exists)
 *   - subagent-tracker.mjs stop        (only when tool_name === "agent_run")
 *   - verify-deliverables.mjs          (only when tool_name === "agent_run")
 *
 * Rationale:
 *   - Gemini has no PostToolUseFailure event; we detect failure by
 *     inspecting tool_response.error in the AfterTool payload.
 *   - Gemini has no SubagentStop event; we treat the end of an agent_run
 *     tool call as the subagent lifecycle stop boundary.
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
const toolResponse = gi.tool_response || {};
const hasError =
  toolResponse.error != null ||
  (typeof toolResponse.error === 'string' && toolResponse.error.length > 0);

const baseCi = {
  session_id: getLegacySession() ? '' : (gi.session_id || ''),
  transcript_path: gi.transcript_path || '',
  cwd: gi.cwd || process.cwd(),
  tool_name: gi.tool_name || '',
  tool_input: gi.tool_input || {},
  tool_response: toolResponse,
};

const ciSuccess = { ...baseCi, hook_event_name: 'PostToolUse' };
const ciFailure = { ...baseCi, hook_event_name: 'PostToolUseFailure' };

const outs = [];
outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'post-tool-verifier.mjs', ciSuccess, [], 3_000), 'AfterTool'));
outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'project-memory-posttool.mjs', ciSuccess, [], 3_000), 'AfterTool'));

if (hasError) {
  outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'post-tool-use-failure.mjs', ciFailure, [], 3_000), 'AfterTool'));
}

if (baseCi.tool_name === 'agent_run') {
  const ciSubagent = { ...baseCi, hook_event_name: 'SubagentStop' };
  outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'subagent-tracker.mjs', ciSubagent, ['stop'], 5_000), 'AfterTool'));
  outs.push(translateClaudeOutToGemini(runOmcScript(OMC_ROOT, 'verify-deliverables.mjs', ciSubagent, [], 5_000), 'AfterTool'));
}

emit(mergeGeminiOutputs(...outs));
process.exit(0);

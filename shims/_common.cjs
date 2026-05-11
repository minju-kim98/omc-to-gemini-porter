#!/usr/bin/env node
'use strict';

/**
 * Shared utilities for OMC→Gemini hook shims.
 *
 * Provides:
 *   - OMC install path discovery
 *   - synchronous stdin reader + safe JSON parser
 *   - runOmcScript()       — invokes an OMC hook script via OMC's run.cjs
 *   - translateClaudeOutToGemini() — Claude Code stdout → Gemini stdout
 *   - mergeGeminiOutputs() — combines outputs when multiple OMC scripts
 *                            fire for a single Gemini event
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const DEFAULT_OMC_ROOT_WIN = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'npm',
  'node_modules',
  'oh-my-claude-sisyphus'
);

function resolveOmcRoot() {
  const env = process.env.OMC_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
  if (env && fs.existsSync(env)) return env;
  if (fs.existsSync(DEFAULT_OMC_ROOT_WIN)) return DEFAULT_OMC_ROOT_WIN;
  return null;
}

function readStdinSync() {
  try { return fs.readFileSync(0, 'utf-8'); } catch { return ''; }
}

function parseJsonSafe(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj || {}));
}

function exitPassthrough() {
  emit({});
  process.exit(0);
}

function getLegacySession() {
  return process.env.OMC_PORTER_FORCE_LEGACY_SESSION === '1';
}

function runOmcScript(omcRoot, scriptName, claudeInput, extraArgs = [], timeoutMs = 10_000) {
  const runner = path.join(omcRoot, 'scripts', 'run.cjs');
  const target = path.join(omcRoot, 'scripts', scriptName);
  if (!fs.existsSync(target)) return {};

  const result = spawnSync(
    process.execPath,
    [runner, target, ...extraArgs],
    {
      input: JSON.stringify(claudeInput),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: omcRoot },
      encoding: 'utf-8',
      windowsHide: true,
      timeout: timeoutMs,
    }
  );
  return parseJsonSafe((result.stdout || '').trim());
}

function translateClaudeOutToGemini(claudeOut, geminiEvent) {
  if (!claudeOut || typeof claudeOut !== 'object') return {};
  const out = {};

  if (claudeOut.decision === 'block' && typeof claudeOut.reason === 'string') {
    out.decision = 'deny';
    out.reason = claudeOut.reason;
  }

  if (claudeOut.continue === false) {
    out.continue = false;
    out.stopReason = claudeOut.reason || claudeOut.systemMessage || 'OMC halt';
  }

  if (typeof claudeOut.systemMessage === 'string') {
    out.systemMessage = claudeOut.systemMessage;
  }

  const addCtx = claudeOut.hookSpecificOutput?.additionalContext;
  if (typeof addCtx === 'string' && addCtx.length > 0) {
    out.hookSpecificOutput = { hookEventName: geminiEvent, additionalContext: addCtx };
  }

  if (claudeOut.suppressOutput === true) out.suppressOutput = true;

  return out;
}

function mergeGeminiOutputs(...outputs) {
  const merged = {};
  for (const o of outputs) {
    if (!o || typeof o !== 'object') continue;

    if (o.decision === 'deny') {
      merged.decision = 'deny';
      merged.reason = [merged.reason, o.reason].filter(Boolean).join('\n---\n');
    }
    if (o.continue === false) {
      merged.continue = false;
      merged.stopReason = [merged.stopReason, o.stopReason].filter(Boolean).join('\n');
    }
    if (o.systemMessage) {
      merged.systemMessage = [merged.systemMessage, o.systemMessage].filter(Boolean).join('\n');
    }
    if (o.hookSpecificOutput?.additionalContext) {
      const ev = o.hookSpecificOutput.hookEventName;
      const existing = merged.hookSpecificOutput?.additionalContext || '';
      merged.hookSpecificOutput = {
        hookEventName: ev,
        additionalContext: [existing, o.hookSpecificOutput.additionalContext].filter(Boolean).join('\n'),
      };
    }
    if (o.suppressOutput) merged.suppressOutput = true;
  }
  return merged;
}

module.exports = {
  resolveOmcRoot,
  readStdinSync,
  parseJsonSafe,
  emit,
  exitPassthrough,
  getLegacySession,
  runOmcScript,
  translateClaudeOutToGemini,
  mergeGeminiOutputs,
};

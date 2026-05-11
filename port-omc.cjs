#!/usr/bin/env node
'use strict';

/**
 * port-omc.cjs — Convert OMC skills/agents into a Gemini-compatible layout.
 *
 * Reads:  the OMC npm install (OMC_ROOT env, or auto-detected from npm root)
 * Writes: ./output/.gemini/{skills,agents}  (or OUT_BASE env)
 *
 * Skills:
 *   - Whole directory copied as-is (preserves config/, scripts/, prompts/...)
 *   - SKILL.md frontmatter sanitised (OMC-specific `level` stripped)
 *
 * Agents:
 *   - Single .md file; frontmatter rewritten with Gemini schema (kind,
 *     max_turns, timeout_mins). OMC `level` stripped.
 *
 * Re-run safe: output dirs are wiped first.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(function loadDotenv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const line = raw.replace(/^\s*#.*$/, '').trim();
      if (!line) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v.startsWith('~/') || v === '~') v = path.join(os.homedir(), v.slice(1));
      process.env[m[1]] = v;
    }
  } catch { /* silent — .env is optional */ }
})();

const OMC_ROOT = process.env.OMC_ROOT || path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'npm', 'node_modules', 'oh-my-claude-sisyphus'
);
const OUT_BASE = process.env.OUT_BASE || path.join(
  __dirname, 'output', '.gemini'
);

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: raw, hasFm: false };
  const fm = {};
  const order = [];
  for (const line of m[1].split(/\r?\n/)) {
    const lm = line.match(/^([^:]+):\s?(.*)$/);
    if (lm) {
      const k = lm[1].trim();
      fm[k] = lm[2];
      order.push(k);
    }
  }
  return { fm, body: m[2], hasFm: true, order };
}

const LIST_KEYS = new Set(['tools']);

function emitFrontmatter(fm, order) {
  const keys = order && order.length ? order.filter(k => k in fm) : Object.keys(fm);
  for (const k of Object.keys(fm)) if (!keys.includes(k)) keys.push(k);
  return '---\n' + keys.map(k => {
    const v = fm[k];
    if (LIST_KEYS.has(k) && Array.isArray(v)) {
      return `${k}:\n${v.map(x => `  - "${String(x).replace(/"/g, '\\"')}"`).join('\n')}`;
    }
    return `${k}: ${v}`;
  }).join('\n') + '\n---\n';
}

function sanitizeSkillFm(fm, order) {
  const out = { ...fm };
  const newOrder = [...order];
  for (const k of ['level']) {
    delete out[k];
    const i = newOrder.indexOf(k);
    if (i >= 0) newOrder.splice(i, 1);
  }
  return { fm: out, order: newOrder };
}

// Whitelist of fields Gemini's subagent spec accepts. Unknown Claude Code-only
// fields (color, disallowedTools, level, etc.) cause some IDE builds to reject
// the agent entirely during schema validation.
const ALLOWED_AGENT_FIELDS = new Set([
  'name',
  'description',
  'kind',
  'tools',
  'temperature',
  'max_turns',
  'timeout_mins',
]);

function sanitizeAgentFm(fm, order) {
  const out = {};
  const newOrder = [];

  // Pass 1: keep only allowed fields, preserving order.
  for (const k of order) {
    if (ALLOWED_AGENT_FIELDS.has(k) && k in fm) {
      out[k] = fm[k];
      newOrder.push(k);
    }
  }
  // Catch any allowed field that wasn't in `order`.
  for (const k of Object.keys(fm)) {
    if (ALLOWED_AGENT_FIELDS.has(k) && !(k in out)) {
      out[k] = fm[k];
      newOrder.push(k);
    }
  }

  // Pass 2: ensure Gemini-required defaults present.
  // `kind` defaults to "local" per Gemini spec; make it explicit.
  if (!('kind' in out)) {
    out.kind = 'local';
    const after = newOrder.indexOf('description');
    newOrder.splice(after >= 0 ? after + 1 : newOrder.length, 0, 'kind');
  }
  // `tools` as a YAML list so the IDE's YAML parser reads it as an array,
  // not a string. ["*"] grants the full inherited toolset.
  if (!('tools' in out)) {
    out.tools = ['*'];
    newOrder.push('tools');
  } else if (typeof out.tools === 'string') {
    // Convert any string form ("[\"*\"]", "All tools", "*") into an array.
    const s = out.tools.trim();
    if (/^\*$/.test(s) || /^all tools/i.test(s) || /^\[\s*"\*"\s*\]$/.test(s)) {
      out.tools = ['*'];
    } else {
      out.tools = s.split(/[,\n]/).map(x => x.trim().replace(/^["'\[]|["'\]]$/g, '')).filter(Boolean);
    }
  }
  if (!('max_turns' in out)) {
    out.max_turns = '50';
    newOrder.push('max_turns');
  }
  if (!('timeout_mins' in out)) {
    out.timeout_mins = '10';
    newOrder.push('timeout_mins');
  }
  return { fm: out, order: newOrder };
}

function portSkill(name) {
  const src = path.join(OMC_ROOT, 'skills', name);
  const dst = path.join(OUT_BASE, 'skills', name);

  if (!fs.statSync(src).isDirectory()) return null;
  const skillSrc = path.join(src, 'SKILL.md');
  if (!fs.existsSync(skillSrc)) return null;

  copyRecursive(src, dst);

  const skillDst = path.join(dst, 'SKILL.md');
  const raw = fs.readFileSync(skillDst, 'utf-8');
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasFm) return name;

  const { fm, order } = sanitizeSkillFm(parsed.fm, parsed.order);
  fs.writeFileSync(skillDst, emitFrontmatter(fm, order) + parsed.body);
  return name;
}

function portAgent(filename) {
  const src = path.join(OMC_ROOT, 'agents', filename);
  const dst = path.join(OUT_BASE, 'agents', filename);

  const raw = fs.readFileSync(src, 'utf-8');
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasFm) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return filename;
  }

  const { fm, order } = sanitizeAgentFm(parsed.fm, parsed.order);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, emitFrontmatter(fm, order) + parsed.body);
  return filename;
}

// Skills/agents that we hand-rewrote for Gemini compatibility. After OMC is
// re-ported (which overwrites OUT_BASE), the overrides in `overrides/` are
// laid down on top so our manual rewrites survive.
const OVERRIDES_DIR = path.join(__dirname, 'overrides');

function applyOverrides() {
  if (!fs.existsSync(OVERRIDES_DIR)) return [];
  const applied = [];
  function walk(rel) {
    const src = path.join(OVERRIDES_DIR, rel);
    const dst = path.join(OUT_BASE, rel);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      for (const name of fs.readdirSync(src)) walk(path.join(rel, name));
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      applied.push(rel.replace(/\\/g, '/'));
    }
  }
  for (const name of fs.readdirSync(OVERRIDES_DIR)) walk(name);
  return applied;
}

function main() {
  if (!fs.existsSync(OMC_ROOT)) {
    console.error(`OMC_ROOT not found: ${OMC_ROOT}`);
    process.exit(1);
  }

  fs.rmSync(path.join(OUT_BASE, 'skills'), { recursive: true, force: true });
  fs.rmSync(path.join(OUT_BASE, 'agents'), { recursive: true, force: true });

  const skillNames = [];
  const skillsDir = path.join(OMC_ROOT, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      const ported = portSkill(name);
      if (ported) skillNames.push(ported);
    }
  }

  const agentNames = [];
  const agentsDir = path.join(OMC_ROOT, 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (file.endsWith('.md')) agentNames.push(portAgent(file));
    }
  }

  const overrides = applyOverrides();

  console.log(`Ported ${skillNames.length} skills to ${path.join(OUT_BASE, 'skills')}`);
  for (const n of skillNames) console.log(`  - ${n}`);
  console.log(`\nPorted ${agentNames.length} agents to ${path.join(OUT_BASE, 'agents')}`);
  for (const n of agentNames) console.log(`  - ${n}`);
  if (overrides.length > 0) {
    console.log(`\nApplied ${overrides.length} overrides (hand-rewrites preserved):`);
    for (const f of overrides) console.log(`  - ${f}`);
  }
}

main();

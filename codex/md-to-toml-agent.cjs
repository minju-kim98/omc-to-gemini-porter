#!/usr/bin/env node
'use strict';

/**
 * md-to-toml-agent.cjs — convert OMC agent .md (Claude Code frontmatter) into
 * the Codex-fork subagent .toml schema.
 *
 * WHY THIS EXISTS
 * ---------------
 * On a Codex-based host (e.g. DIT Code Agent, CODEX_HOME=~/.ditcode), enabling
 * the OMC plugin auto-registers skills, hooks and the "t" MCP server — but NOT
 * subagents. OMC's plugin.json declares `skills`/`mcpServers`/`commands` and
 * has no `agents` key; Claude Code auto-discovers the agents/ directory by
 * convention, Codex's plugin loader does not. So the 19 agent definitions ship
 * inside the plugin but never surface.
 *
 * The fix is to materialise them as user-level subagents. The Codex fork reads
 * subagents from `$CODEX_HOME/agents/<name>.toml` with this schema (confirmed
 * from the codex-app-server binary + the subagent editor UI):
 *
 *   name                    string
 *   description             string
 *   developer_instructions  string   <- the agent prompt (the .md body)
 *   model                   string   (empty = host default)
 *   reasoning_effort        string   (empty = host default)
 *   nickname_candidates     string[]
 *
 * Note this is a DIFFERENT schema from the old Gemini fork, which used .md with
 * `kind`/`tools`/`max_turns`/`timeout_mins` frontmatter (see port-omc.cjs).
 *
 * USAGE
 *   node codex/md-to-toml-agent.cjs <src-agents-dir> <out-dir> [only-name]
 *
 * e.g.
 *   node codex/md-to-toml-agent.cjs \
 *     ~/.ditcode/plugins/cache/omc/oh-my-claudecode/<ver>/agents \
 *     ~/.ditcode/agents
 */

const fs = require('node:fs');
const path = require('node:path');

const [SRC, OUT, ONLY] = process.argv.slice(2);
if (!SRC || !OUT) {
  console.error('usage: md-to-toml-agent.cjs <src-dir> <out-dir> [only-name]');
  process.exit(1);
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw.trim() };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const lm = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (lm) fm[lm[1].trim()] = lm[2];
  }
  return { fm, body: m[2].trim() };
}

// TOML basic-string escape for single-line values.
function tomlBasic(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r/g, '').replace(/\n/g, '\\n') + '"';
}

// TOML multi-line literal ('''...''') carries the body verbatim — no escaping
// of ", \, ${} etc. Only hazard is a literal ''' in the body; guard against it
// by falling back to a basic multi-line string with the triple-quote escaped.
function tomlMultiline(s) {
  const body = String(s).replace(/\r\n/g, '\n');
  if (body.includes("'''")) {
    const esc = body.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
    return '"""\n' + esc + '\n"""';
  }
  // The newline right after ''' is trimmed by the TOML spec — intended.
  return "'''\n" + body + "\n'''";
}

function convert(file) {
  const raw = fs.readFileSync(path.join(SRC, file), 'utf-8');
  const { fm, body } = parseFrontmatter(raw);
  const name = fm.name || path.basename(file, '.md');
  const desc = fm.description || '';

  const lines = [
    `name = ${tomlBasic(name)}`,
    `description = ${tomlBasic(desc)}`,
    // Left empty so the host applies its own default model/effort. OMC's own
    // model routing (haiku/sonnet/opus) still applies once the agent runs
    // through the plugin, so pinning here would only fight it.
    `model = ""`,
    `reasoning_effort = ""`,
    `nickname_candidates = []`,
    `developer_instructions = ${tomlMultiline(body)}`,
    '',
  ];
  return { name, toml: lines.join('\n') };
}

fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const file of fs.readdirSync(SRC)) {
  if (!file.endsWith('.md')) continue;
  if (ONLY && path.basename(file, '.md') !== ONLY) continue;
  const { name, toml } = convert(file);
  fs.writeFileSync(path.join(OUT, `${name}.toml`), toml);
  console.log(`  ${name}.toml`);
  n++;
}
console.log(`wrote ${n} agent .toml file(s) to ${OUT}`);

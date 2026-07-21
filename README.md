<h1 align="center">omc-to-gemini-porter</h1>

<p align="center">
  <b>Run <a href="https://github.com/Yeachan-Heo/oh-my-claudecode">oh-my-claudecode</a> inside any <a href="https://github.com/google-gemini/gemini-cli">Gemini CLI</a>-based environment.</b><br>
  <sub>Skills, agents, and hooks ported without modifying OMC itself.</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-archived-lightgrey.svg" alt="Archived">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-43853d.svg" alt="Node 20+">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  <img src="https://img.shields.io/badge/built%20on-OMC-orange.svg" alt="Built on OMC">
  <img src="https://img.shields.io/badge/runtime-Gemini%20CLI-4285f4.svg" alt="Gemini CLI">
</p>

---

> [!WARNING]
> **This project is archived. If your environment is Codex-based, you do not need it.**
>
> OMC now ships **native Codex support** and is distributed through Codex's
> plugin marketplace system. Codex consumes OMC's *unmodified* Claude Code
> `hooks/hooks.json` directly — the stdin/stdout translation this porter exists
> to provide is not needed there.
>
> This repo remains useful only for **Gemini CLI**-based hosts, which have no
> such native path. It is no longer maintained.

## Migrating to a Codex-based host

Codex's hook contract *is* the Claude Code hook contract — same event names
(`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
`SubagentStop`, `PreCompact`, `Notification`), same payload fields, same
`$CLAUDE_PLUGIN_ROOT` expansion. No shim, no frontmatter rewriting, no
`agent_run` substitution.

Install OMC as a plugin instead:

```toml
# $CODEX_HOME/config.toml
[marketplaces.omc]
source_type = "git"
source = "https://github.com/Yeachan-Heo/oh-my-claudecode.git"

[plugins."oh-my-claudecode@omc"]
enabled = true
```

`$CODEX_HOME` defaults to `~/.codex`; vendor forks override it (e.g. a fork
may use `~/.ditcode`). Check which directory the host actually writes
`config.toml` and `sessions/` into.

### Three gotchas that cost us a debugging cycle

1. **Hooks are gated behind a trust hash.** Codex records every approved hook
   in `config.toml` as
   `[hooks.state.'<path>:<event>:<idx>:<idx>'] trusted_hash = "sha256:…"`.
   A syntactically valid `hooks.json` that has not been trusted is **silently
   ignored** — no error, no log. If your hooks appear dead, check this first.
   The trust keys for a plugin's hooks are plugin-relative
   (`oh-my-claudecode@omc:hooks/hooks.json:stop:0:0`), so they carry across
   `CODEX_HOME`s unchanged — but they are keyed on `hooks.json` *content*, so
   a plugin update that changes `hooks.json` invalidates them and the hooks go
   silent again until re-approved.
2. **Hook `timeout` is in seconds**, not milliseconds as in Gemini's
   `settings.json`.
3. **Subagents are NOT auto-registered from the plugin.** Enabling the plugin
   surfaces skills, hooks and the `t` MCP server, but not OMC's agents. OMC's
   `plugin.json` declares `skills`/`mcpServers`/`commands` and has no `agents`
   key; Claude Code auto-discovers the `agents/` directory by convention,
   Codex's plugin loader does not. You must materialise them as user-level
   subagents at `$CODEX_HOME/agents/<name>.toml` (a different schema from the
   old Gemini fork's `.md` agents) — see [`codex/`](codex/).

`probe/` contains the instrumentation used to establish gotchas #1–#2; see
`probe/install-probe.cjs`. Note that it is itself subject to gotcha #1 — an
installed probe stays silent until its hash is trusted. [`codex/`](codex/)
carries the subagent converter for gotcha #3.

### Materialising subagents (gotcha #3)

The Codex subagent `.toml` schema — captured from a file the fork's own
subagent editor wrote, which is the only reliable source (its `AgentRoleToml`
loader rejects unknown fields):

```toml
# $CODEX_HOME/agents/<name>.toml
name = "explore"
description = "Codebase search specialist for finding files and code patterns"

developer_instructions = '''
<the agent prompt — i.e. the OMC agent .md body>
'''
```

Only those three keys. **Do not emit `model` or `reasoning_effort`**: in the
editor they default to *inherit*, and the server then omits the keys entirely
rather than writing them empty. A stray `reasoning_effort = ""` makes the
loader reject the whole file (`unknown field 'reasoning_effort'`) and the
subagent silently disappears — no error in the UI, only in the app log. Leave
both out to inherit; pin a model per-agent in the editor later if you want.
`nickname_candidates = ["…"]` is accepted but optional.

Convert OMC's shipped agent `.md` files into it:

```bash
node codex/md-to-toml-agent.cjs \
  "$CODEX_HOME/plugins/cache/omc/oh-my-claudecode/<ver>/agents" \
  "$CODEX_HOME/agents"
```

Re-run after any plugin update so the subagents track the version whose skills
and hooks you are running.

### Updating OMC later

The fork **cannot auto-update** OMC (its bundled git has a build-machine CA
path, so the startup marketplace refresh fails every launch). Updating is a
manual, repeatable procedure — placing the new version dir, repointing the
marketplace revision, and only re-doing hook trust / subagents if those files
actually changed between versions. The full runbook with commands is in
[`codex/UPDATING.md`](codex/UPDATING.md).

---

## Overview

[**oh-my-claudecode (OMC)**](https://github.com/Yeachan-Heo/oh-my-claudecode) is a multi-agent orchestration layer for Claude Code — it adds ralph (auto-loop), autopilot, ultrawork, team coordination, deep-interview, code-reviewer agent delegation, magic-keyword skill activation, and a lot more.

This porter is a **thin compatibility layer** that lets OMC run unchanged inside [**Gemini CLI**](https://github.com/google-gemini/gemini-cli) and any IDE built on top of it. It does **not** fork OMC; it wraps OMC's Claude Code hook scripts in shim processes that translate the stdin/stdout contracts on the fly.

### What you get

| Capability | Notes |
|---|---|
| **ralph auto-loop** | "Boulder never stops" auto-retry, full PRD workflow |
| **autopilot / ultrawork / ultraqa** | Phase orchestration, parallel execution, QA cycling |
| **31 skills** | ai-slop-cleaner, ask, autopilot, cancel, ccg, deep-dive, deep-interview, deepinit, plan, ralph, ralplan, team, ultraqa, ultrawork, writer-memory, … |
| **19 agents** | analyst, architect, code-reviewer, code-simplifier, critic, debugger, designer, document-specialist, executor, explore, git-master, planner, qa-tester, scientist, security-reviewer, test-engineer, tracer, verifier, writer |
| **Magic-keyword auto-activation** | UserPromptSubmit keyword detection wired through BeforeAgent |
| **Project memory injection** | SessionStart context loading + PostToolUse memory updates |
| **Hand-rewritten `team` skill** | `Team*`/`SendMessage` (Claude Code-only) replaced with parallel `agent_run` calls |

### What it doesn't do

- Does **not** fork OMC — your OMC install stays canonical
- Does **not** intercept the user's prompts at the LLM level
- Does **not** support OMC's tmux-based Codex / Gemini CLI worker mode in the `team` skill (use OMC's `/ccg` directly instead)
- Cannot magically add primitives the host IDE lacks (`Team*`, `SendMessage`) — the `team` skill is rewritten to use the fan-out/fan-in pattern that fits Gemini's `agent_run`

---

## Quick start

### 1. Install OMC globally

```bash
npm i -g oh-my-claude-sisyphus
```

This is the canonical OMC distribution. The porter calls its scripts unchanged.

### 2. Clone this repo

```bash
git clone https://github.com/minju-kim98/omc-to-gemini-porter.git
cd omc-to-gemini-porter
```

### 3. Configure for your IDE

```bash
cp .env.example .env
```

Open `.env` and set **`OUT_TARGET`** to your IDE's user-config directory.

```ini
# Stock Gemini CLI
OUT_TARGET=~/.gemini

# Vendor fork (replace folder name with whatever your IDE actually uses)
OUT_TARGET=~/.<vendor-folder>

# Or any custom path
OUT_TARGET=~/my-ide-config
```

> **How to find your IDE's config dir:** look for an existing `skills/` or `agents/` directory under your home folder. Common patterns are `~/.gemini`, `~/.<vendor-name>`, or `~/.config/<vendor-name>`. If your IDE shows skill / agent settings in its UI, the path is typically displayed there.

### 4. Port + apply

```bash
node port-omc.cjs    # OMC → output/.gemini/{skills,agents,settings.json}
node apply.cjs       # output/.gemini → $OUT_TARGET, backing up any existing files
```

### 5. Restart your IDE

That's it. Try one of these inside the IDE to confirm:

```
ralph 모드로 hello를 5번 출력해줘
/team 3:executor "create three files: a.txt, b.txt, c.txt"
/agents
```

If you see the ralph PRD workflow kick in and the agent catalogue appear, **you're done**.

---

## Architecture

### The translation layer

```
┌──────────────────────────────────────────────────────────────────┐
│                  Gemini CLI / IDE Runtime                        │
│  (hooks: BeforeAgent, BeforeTool, AfterTool, AfterAgent, …)      │
└─────────────────────┬────────────────────────────────────────────┘
                      │  stdin (Gemini hook payload)
                      ▼
            ┌──────────────────────┐
            │   Porter shim        │   shims/<event>.cjs
            │   (this repo)        │   • read Gemini stdin
            │                      │   • translate → Claude shape
            │                      │   • spawn OMC script
            │                      │   • read OMC stdout
            │                      │   • translate → Gemini shape
            └──────────┬───────────┘
                       │  stdin (Claude Code hook payload)
                       ▼
            ┌──────────────────────┐
            │  OMC hook script     │   <OMC_ROOT>/scripts/*.mjs
            │  (unchanged)         │   persistent-mode, keyword-detector, …
            └──────────────────────┘
```

Each translation is small and orthogonal. The Stop → AfterAgent mapping is the most consequential — that's the engine behind ralph / autopilot / ultrawork's auto-loop.

### Hook event mapping

| OMC (Claude Code) | Gemini CLI | Shim | Role |
|---|---|---|---|
| `UserPromptSubmit` | `BeforeAgent` | `before-agent.cjs` | keyword-detector + skill-injector |
| `PreToolUse` | `BeforeTool` | `before-tool.cjs` | pre-tool-enforcer + subagent-tracker (start) |
| `PostToolUse` + `Failure` | `AfterTool` | `after-tool.cjs` | post-tool-verifier + memory + subagent-tracker (stop) |
| `Stop` | `AfterAgent` | `after-agent.cjs` | **persistent-mode (ralph auto-loop)** |
| `SessionStart` | `SessionStart` | `session-start.cjs` | project memory + setup hooks |
| `SessionEnd` | `SessionEnd` | `session-end.cjs` | telemetry / cleanup |
| `PreCompact` | `PreCompress` | `pre-compress.cjs` | checkpoint before compression |
| `SubagentStart` / `Stop` | matcher in BeforeTool / AfterTool on `agent_run` | — | emulated via tool name match |
| `PermissionRequest` | (skipped) | — | most IDEs handle this natively |

### Override system

`overrides/` holds hand-rewrites that are laid down on top of the auto-ported output after every `node port-omc.cjs` run. This is how the Gemini-native `team` skill survives OMC version bumps.

```
overrides/
├── settings.json                       hook registration template
└── skills/team/SKILL.md                 Gemini-native team rewrite
```

To add your own override, mirror the path structure (e.g. `overrides/agents/my-agent.md`).

---

## Configuration

All configuration lives in `.env` (gitignored, per-machine). The porter and apply scripts auto-load it.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OUT_TARGET` | **yes** | `~/.gemini` | Where `apply.cjs` writes skills/agents/settings.json |
| `OMC_PORTER_FORCE_LEGACY_SESSION` | recommended | unset | `1` = bypass session-ID matching during OMC state lookup |
| `OMC_ROOT` | no | auto-detected | Path to OMC install (`$(npm root -g)/oh-my-claude-sisyphus`) |
| `OMC_PORTER_ROOT` | no | repo directory | Absolute path apply.cjs writes into settings.json shim paths |

Inline env still works if you prefer per-command overrides:

```bash
OUT_TARGET=~/.my-ide-config node apply.cjs
```

---

## Updating OMC

When OMC ships a new version:

```bash
npm i -g oh-my-claude-sisyphus@latest
node port-omc.cjs       # re-port from the new OMC release
node apply.cjs          # push to your IDE
```

The override system preserves your hand-rewrites. The `apply.cjs` script backs up any existing skills/agents/settings.json before overwriting (timestamped `.backup-*` siblings).

If a new OMC release adds a new hook event, you'll need a new shim — see [Contributing](#-contributing).

---

## Verifying the install

After applying and restarting your IDE, run:

```
ralph 모드로 hello를 5번 출력해줘
```

Expected: ralph activates, generates a PRD, runs an iteration, verifier approves, ralph completes. The auto-loop is driven by the `AfterAgent → persistent-mode` translation.

```
/team 3:executor "create three files a.txt, b.txt, c.txt with different greetings"
```

Expected: three `agent_run` calls in a single lead turn (parallel), three results collected, verifier runs once, summary returned. The team skill is the Gemini-native rewrite from `overrides/`.

```
/agents
```

Expected: 19 agents listed (analyst through writer).

---

## Troubleshooting

<details>
<summary><b>ralph doesn't auto-loop</b></summary>

- Check that the AfterAgent hook fired (your IDE usually has a hook execution log).
- Verify OMC is reachable:
  ```bash
  echo '{}' | node shims/after-agent.cjs
  ```
  This should emit `{}` cleanly.
- Verify ralph state exists in your workspace: `cat .omc/state/ralph-state.json`.
- Verify session matching: ensure `OMC_PORTER_FORCE_LEGACY_SESSION=1` is in `.env` or your shell env.
</details>

<details>
<summary><b>Skills show up but agents don't appear in <code>/agents</code></b></summary>

- Confirm the target directory: `ls "$OUT_TARGET/agents"` should list 19 `.md` files.
- Check frontmatter validity — `name`, `description`, `kind`, `tools` should be present, with `tools` as a YAML list (not an inline JSON string).
- Some IDE forks require `"experimental": {"enableAgents": true}` in the user settings.json. Add it if `/agents` returns empty.
</details>

<details>
<summary><b>Magic-keyword skill activation doesn't fire</b></summary>

- Confirm the `BeforeAgent` hook is registered in your IDE's `settings.json`.
- Verify the OMC keyword-detector works:
  ```bash
  echo '{"prompt":"ralph"}' | node shims/before-agent.cjs
  ```
  You should see `additionalContext` mentioning the ralph skill.
- The shim strips `oh-my-claudecode:` and `oh-my-claudecode-` prefixes so the host IDE's bare-slug registry matches.
</details>

<details>
<summary><b>Hook event names don't match my IDE</b></summary>

The shim logic is event-name agnostic. If your IDE uses different names (e.g. older `OnTool` / `AfterPrompt`), edit `overrides/settings.json` to remap them, then re-run `node port-omc.cjs && node apply.cjs`.
</details>

<details>
<summary><b>team skill behaves differently than in Claude Code</b></summary>

By design — the Gemini-native rewrite trades inter-agent messaging (`SendMessage`) for fan-out/fan-in via parallel `agent_run` calls in one lead turn. Most multi-agent tasks fit this pattern; tasks needing mid-flight coordination should be split into sequential phases. See `overrides/skills/team/SKILL.md` for the full design.
</details>

---

## File layout

```
omc-to-gemini-porter/
├── README.md                this file
├── LICENSE                  MIT
├── .gitignore               output/, .env, test-tmp-*, *.backup-* excluded
├── .env.example             template — copy to .env
│
├── port-omc.cjs             OMC → output/.gemini/
├── apply.cjs                output/.gemini → $OUT_TARGET (with backups)
│
├── shims/                   hook translation layer (7 events + helper)
│   ├── _common.cjs            shared helpers
│   ├── before-agent.cjs       UserPromptSubmit → BeforeAgent
│   ├── before-tool.cjs        PreToolUse → BeforeTool
│   ├── after-tool.cjs         PostToolUse + Failure → AfterTool
│   ├── after-agent.cjs        Stop → AfterAgent (ralph auto-loop engine)
│   ├── session-start.cjs      SessionStart
│   ├── session-end.cjs        SessionEnd
│   └── pre-compress.cjs       PreCompact → PreCompress
│
├── overrides/               hand-rewrites (preserved across re-ports)
│   ├── settings.json          hook registration template
│   └── skills/team/SKILL.md   Gemini-native team rewrite
│
└── output/                  re-generated by port-omc.cjs (gitignored)
    └── .gemini/
        ├── skills/
        ├── agents/
        └── settings.json
```

---

## Limitations

- **`Team*` primitives don't exist in Gemini CLI.** The `team` skill is rewritten to use parallel `agent_run` calls instead. Trade-off: no inter-worker `SendMessage`. Most teams don't need it.
- **`SubagentStart` / `SubagentStop` events have no direct equivalent.** They are emulated by watching for `agent_run` tool calls in `BeforeTool` / `AfterTool`.
- **`PermissionRequest`** is dropped — most Gemini CLI environments have their own permission UI.
- **Session ID format varies by IDE.** Use `OMC_PORTER_FORCE_LEGACY_SESSION=1` until you know your IDE's session-ID convention.
- **CLI workers in OMC's `team`** (tmux + Codex/Gemini CLI) aren't supported in the Gemini-native rewrite — use OMC's `/ccg` skill directly for tri-model orchestration.

---

## Contributing

PRs welcome, especially for:

- Adapter overrides for Gemini CLI forks with different hook event names
- Rewrites for OMC skills that depend on Claude Code-only primitives
- Bug reports with `stderr` output from the failing shim

When adding a new shim, follow `shims/after-agent.cjs` as a template:

1. Read Gemini-shape stdin (`readStdinSync` + `parseJsonSafe`)
2. Build the Claude-shape input object
3. Call `runOmcScript(OMC_ROOT, '<omc-script>.mjs', claudeInput)`
4. Translate via `translateClaudeOutToGemini` and `emit`

The helpers in `shims/_common.cjs` should cover most cases.

---

## Credits

This project is a thin compatibility layer that depends on, and is made possible by:

- **[oh-my-claudecode (OMC)](https://github.com/Yeachan-Heo/oh-my-claudecode)** by [Yeachan Heo](https://github.com/Yeachan-Heo) — the multi-agent orchestration layer all the skills, agents, and hook scripts come from. Every workflow this porter exposes (ralph, autopilot, ultrawork, team, deep-interview, …) is OMC's design. The npm package is published as [`oh-my-claude-sisyphus`](https://www.npmjs.com/package/oh-my-claude-sisyphus).
- **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** by Google — the agentic shell whose hook contract this porter targets.
- **[oh-my-openagent (omo)](https://github.com/code-yeongyu/oh-my-openagent)** by [code-yeongyu](https://github.com/code-yeongyu) — inspiration for the broader Sisyphus-named persona used across OMC.

If you find this useful, **please star the OMC repo** as well — none of this exists without the upstream project.

---

## License

[MIT](./LICENSE). OMC is © Yeachan Heo, MIT-licensed. Gemini CLI is © Google, Apache 2.0.

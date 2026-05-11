---
name: team
description: Coordinate N specialized agents on a shared task via parallel agent_run delegation (Gemini-native rewrite of OMC team)
---

# Team Skill (Gemini-native)

Spawn N specialist agents working in parallel on subtasks of a single user task. Each agent runs in its own isolated context via `agent_run`, executing concurrently during the same lead turn. The lead orchestrates decomposition, spawning, collection, and verification.

This is a **Gemini-native rewrite** of OMC's original `team` skill. The Claude Code primitives (`TeamCreate`, `TeamDelete`, `SendMessage`, `Task(team_name=...)`, `TaskList`) do not exist in the Gemini CLI runtime; this skill achieves the same fan-out/fan-in outcomes with `agent_run` + `write_todos` + filesystem handoffs.

## Usage

```
/oh-my-claudecode:team N:agent-type "task description"
/oh-my-claudecode:team "task description"
/oh-my-claudecode:team ralph "task description"
```

### Parameters

- **N** — Number of teammate agents (1-10). Optional; defaults to auto-sizing based on decomposition.
- **agent-type** — Specialist agent for the execution stage (`executor`, `debugger`, `designer`, `writer`, `test-engineer`, etc.). Optional; defaults to per-subtask stage-aware routing.
- **task** — High-level task to decompose and distribute.
- **ralph** — Optional modifier. Wraps the pipeline in ralph's persistence loop (retry-on-failure + architect verification before completion).

### Examples

```
/team 3:executor "fix TypeScript errors in src/auth, src/api, src/utils"
/team "refactor auth module with security review"
/team ralph "build a complete REST API for user management"
```

## Architecture

```
User: "/team 3:executor fix all TypeScript errors"
              │
              ▼
      ┌────────────────┐
      │  LEAD ORCH.    │
      └────────────────┘
              │
              ├─ Phase 1: Analyze
              │     agent_run(explore, "map codebase, find error sites")
              │
              ├─ Phase 2: Decompose
              │     write_todos with N entries
              │     write .omc/handoffs/team-plan.md
              │
              ├─ Phase 3: Parallel Spawn  ◀── core of Gemini fan-out
              │     agent_run(executor, subtask 1)  ┐
              │     agent_run(executor, subtask 2)  │  same tool_use block
              │     agent_run(executor, subtask 3)  ┘  → concurrent execution
              │
              ├─ Phase 4: Collect
              │     read each agent_run response
              │     update todos
              │
              ├─ Phase 5: Verify
              │     agent_run(verifier, "verify subtask outputs vs criteria")
              │     if fail → generate fix subtasks, loop to Phase 3
              │
              └─ Phase 6: Report
                    summary to user
                    optional state cleanup
```

## Why Parallel Spawn Works on Gemini

Unlike Claude Code's native team primitives, Gemini's `agent_run` is a single-shot delegation. **Parallelism is achieved by issuing multiple `agent_run` tool calls in the same lead turn.** The runtime executes them concurrently and returns all results together in the next turn.

The lead must:

1. Plan all subtasks BEFORE spawning (no mid-flight adjustment within a phase)
2. Issue all `agent_run` calls in a single tool_use block
3. Wait for ALL results in the next turn before deciding next steps

This trades the rich inter-agent messaging of Claude teams for simpler fan-out/fan-in. Most real team tasks fit this pattern.

## Workflow

### Phase 1: Parse Input

- Extract **N**, validate 1-10
- Extract **agent-type**, validate against the agent catalog (`explore`, `analyst`, `planner`, `architect`, `debugger`, `executor`, `verifier`, `tracer`, `security-reviewer`, `code-reviewer`, `test-engineer`, `designer`, `writer`, `qa-tester`, `scientist`, `document-specialist`, `git-master`, `code-simplifier`, `critic`)
- Extract **task** description

### Phase 2: Analyze & Decompose

Use `agent_run` with the `explore` agent to map the codebase and break the task into N independent subtasks. For complex tasks, also spawn `planner` or `architect` to challenge the decomposition.

Decomposition rules:

- Each subtask is **file-scoped** or **module-scoped** to avoid conflicts (no inter-agent messaging to coordinate concurrent writes)
- Subtasks are independent (no dependency ordering enforced at runtime — sequence dependent work across phases instead)
- Each subtask has a concise `subject` and a detailed `description`

### Phase 3: Plan Handoff

Write `.omc/handoffs/team-plan.md` so a future stage / restart can see the lead's reasoning:

```markdown
## Handoff: team-plan → team-exec
- **Decided**: [key decisions made during decomposition]
- **Rejected**: [alternatives considered and why]
- **Subtasks**:
  1. [subject] (agent: executor, scope: src/auth/)
  2. [subject] (agent: debugger, scope: src/api/)
  3. [subject] (agent: executor, scope: src/utils/)
- **Risks**: [known risks for the execution stage]
```

### Phase 4: Parallel Execution

**CRITICAL: issue all `agent_run` calls in a single tool_use block.** This is the only way to achieve parallelism on Gemini.

```
agent_run(agent_name="executor", prompt="<worker-preamble + subtask 1>")
agent_run(agent_name="executor", prompt="<worker-preamble + subtask 2>")
agent_run(agent_name="executor", prompt="<worker-preamble + subtask 3>")
```

Each prompt prepends the **Worker Preamble** (below) and appends the specific subtask description.

### Phase 5: Collect & Decide

When all agent_run results arrive in the next turn:

1. Read each result; classify as `success` / `partial` / `failed`
2. Update `write_todos` to reflect completion status
3. Decide next step:
   - All success → proceed to Phase 6
   - Partial failures → respawn fix agents in Phase 4 (max 3 rounds)
   - All failures → terminal `failed`, report to user

### Phase 6: Verify

```
agent_run(agent_name="verifier", prompt="Verify subtask outputs against acceptance criteria. Files: <list>. Criteria: <list>.")
```

If verifier reports failures → generate fix subtasks and loop back to Phase 4.

For security-sensitive or large changes, run verifier alongside specialists in the same tool_use block:

```
agent_run(agent_name="verifier", ...)
agent_run(agent_name="security-reviewer", ...)
agent_run(agent_name="code-reviewer", ...)
```

### Phase 7: Report

Summarise:

- What was completed
- Files changed
- Any unresolved issues
- (If linked_ralph) iteration count

Optionally clean `.omc/handoffs/` (kept by default for resume / debugging).

## Worker Preamble

Prepend to every `agent_run` prompt:

```
You are a TEAM WORKER. You report back via your final response only — there is no inter-worker channel.

== WORK PROTOCOL ==

1. Read your assigned subtask carefully.
2. Execute using your tools (Read, Write, Edit, Bash, etc.).
3. Do NOT spawn sub-agents. Do NOT delegate.
4. Stay within the file scope specified. Do not modify files outside it.
5. Return a structured response:
   - SUMMARY: <what was done>
   - FILES_CHANGED: [<list of files modified>]
   - STATUS: success | partial | failed
   - REASON: (if partial/failed) <why>

== RULES ==

- Absolute file paths only
- Do NOT call agent_run (no nested delegation)
- Do NOT modify files outside the assigned scope
- Return your final report as the agent_run response body
```

## Stage Routing

Match agent to subtask type (`executor` is the default):

| Subtask Type | Agent | Why |
|---|---|---|
| Iterative multi-file work | `executor` | Tool-mediated iteration |
| Type / build errors | `debugger` | Root-cause analysis |
| UI / frontend | `designer` | UX expertise |
| Documentation | `writer` | Concise content |
| Test creation | `test-engineer` | Regression coverage |
| Security review | `security-reviewer` | Trust boundaries |
| Code quality review | `code-reviewer` | Severity-rated feedback |
| Codebase mapping | `explore` | Fast search |
| Plan / architecture review | `architect` | Long-horizon tradeoffs |
| Decomposition challenge | `critic` | Plan / design challenge |

## Fix Loop

`Phase 4 (execute) → Phase 6 (verify) → Phase 4 (fix)` continues until:

1. verifier approves and no fix tasks remain, OR
2. `fix_loop_count` exceeds `max_fix_loops` (default: 3) → terminal `failed`

Track `fix_loop_count` in lead memory (`write_todos` or state file).

## Team + Ralph Composition

When invoked as `/team ralph "task"` (or the prompt contains both `team` and `ralph` keywords):

1. Set ralph state so the AfterAgent shim keeps the lead alive across turns:

   ```
   write_file(".omc/state/ralph-state.json", {
     "active": true,
     "iteration": 1,
     "max_iterations": 10,
     "prompt": "<original task>",
     "started_at": "<ISO-8601>",
     "last_checked_at": "<ISO-8601>",
     "project_path": "<cwd>",
     "linked_team": true
   })
   ```

2. Run the standard team pipeline (Phases 1-7).
3. After Phase 7 success, run architect verification:

   ```
   agent_run(agent_name="architect", prompt="Final verification of completed work. Files: <list>. Original task: <task>.")
   ```

4. If architect approves → invoke `/oh-my-claudecode:cancel` to clear state.
5. If architect rejects → generate fix subtasks and loop back to Phase 4. Increment `fix_loop_count`.
6. If ralph `iteration` exceeds `max_iterations` → terminal `failed`.

The AfterAgent shim (`shims/after-agent.cjs`) is what keeps the lead looping while ralph state is active. Without it, the lead would stop after one turn.

## State (cancellation / resume)

Persist team state to `.omc/state/team-state.json`:

```json
{
  "active": true,
  "current_phase": "team-exec",
  "task": "<original task description>",
  "agent_count": 3,
  "fix_loop_count": 0,
  "max_fix_loops": 3,
  "linked_ralph": false,
  "started_at": "<ISO-8601>",
  "last_checked_at": "<ISO-8601>",
  "project_path": "<cwd>"
}
```

This enables `/oh-my-claudecode:cancel` to clean up cleanly and the AfterAgent shim's persistent-mode logic to keep the loop alive while team is active.

On terminal phase (`complete`, `failed`, `cancelled`): set `active=false`.

## Idempotent Recovery

If the lead crashes mid-run:

1. Read `.omc/state/team-state.json`
2. If `active=true` and `current_phase` is non-terminal:
   - Read the most recent handoff in `.omc/handoffs/`
   - Resume from the phase indicated by `current_phase`
3. If no state file exists, start fresh

## Limitations vs. Claude Code Native Team

| Capability | Claude Code Team | Gemini Team (this) |
|---|---|---|
| Persistent workers across turns | ✅ | ❌ (one-shot per `agent_run`) |
| Inter-worker messaging | ✅ (`SendMessage`) | ❌ |
| Atomic task claiming | ⚠️ (pre-assigned owner) | N/A (no shared task list) |
| Parallel execution | ✅ (background workers) | ✅ (multi `agent_run` in one turn) |
| Live progress polling | ✅ (`TaskList`) | ❌ (lead reads all at once) |
| Graceful shutdown protocol | ✅ | N/A (workers are one-shot) |
| Task dependencies | ✅ (`blocks` / `blockedBy`) | ⚠️ (lead sequences phases) |

**When this fits:** Most multi-agent tasks that decompose into independent subtasks fit Gemini's fan-out/fan-in model. Complex coordination requiring mid-flight messaging does not — for those, decompose into sequential phases instead.

## Error Handling

### Worker reports failure

The agent_run response will have `STATUS: failed` and a `REASON`. The lead:

1. Updates todos to reflect the failure
2. Decides retry vs. skip vs. abort
3. On retry: respawn a fresh `agent_run` with the same scope + the failure reason as additional context

### Lead gets no response from agent_run

If the response is empty or the IDE reports a timeout, treat as failed and retry once. If still failing, mark terminal `failed` and report.

### Dependency between subtasks

There is no runtime dependency tracking. Sequence dependent work as separate phases:

```
Phase 4a: agent_run(executor, "fix shared types")
   ↓ wait for result
Phase 4b: agent_run(executor, "fix consumers a") ┐
          agent_run(executor, "fix consumers b") │ parallel
          agent_run(executor, "fix consumers c") ┘
```

## Notes

- The `Team*` primitives, `SendMessage`, and `TaskList` exist in Claude Code but not in Gemini CLI. Any reference to them in older OMC documentation should be ignored when running here.
- `agent_run` is the universal sub-agent invocation tool in Gemini CLI / Gemini CLI. It corresponds to OMC's `Task(subagent_type=...)`.
- The original OMC team skill supported tmux-based Codex / Gemini CLI workers via `omc team api ... --json`. This Gemini-native rewrite drops that mode — use `/ccg` directly for tri-model orchestration instead.

# Updating OMC on a Codex-based host (manual runbook)

The DIT Code Agent fork **cannot auto-update the OMC marketplace**: its bundled
git ships a CA-bundle path hardcoded to the build machine
(`c:/Users/DIT-974/Desktop/…/ca-bundle.crt`), so the startup `git ls-remote`
auto-upgrade fails with `exit 128` on every launch. Manual placement is the
only update path — and, conversely, nothing the fork does will overwrite a
version you place by hand.

This runbook takes a host from OMC version `OLD` to `NEW`.

> Set `CODEX_HOME` first. On DIT Code Agent it is `~/.ditcode`; stock Codex is
> `~/.codex`. Every path below is relative to it.
>
> ```bash
> CODEX_HOME=~/.ditcode
> PLUG="$CODEX_HOME/plugins/cache/omc/oh-my-claudecode"
> ```

## 0. Back up

```bash
cp "$CODEX_HOME/config.toml" "$CODEX_HOME/config.toml.bak-$(date +%Y%m%d)"
```

## 1. Get the new version's git object

The version dirs under `$PLUG/` are git checkouts. Fetch tags into the existing
one (network permitting — if the fork's broken CA blocks you, run this fetch
from a **normal** git install / shell, pointing at the same repo):

```bash
cd "$PLUG/OLD"
git fetch --tags origin
git rev-parse "vNEW^{commit}"      # note this commit sha -> $SHA
```

If you have no working checkout at all, clone fresh:

```bash
git clone https://github.com/Yeachan-Heo/oh-my-claudecode.git "$PLUG/NEW"
cd "$PLUG/NEW" && git checkout "vNEW"
```

## 2. Lay down the new version directory

```bash
cp -r "$PLUG/OLD" "$PLUG/NEW"
cd "$PLUG/NEW"
git checkout main && git reset --hard "vNEW"
node -e 'console.log("version:", require("./.claude-plugin/plugin.json").version)'  # must print NEW
```

## 3. Point the install marker + config at the new commit

The fork resolves which dir to load by matching `config.toml`'s marketplace
`last_revision` against each dir's `.codex-marketplace-install.json` `revision`.
Both must be the **commit sha** (not the annotated-tag sha).

```bash
SHA=$(git -C "$PLUG/NEW" rev-parse HEAD)
# marker
node -e 'const fs=require("fs"),p=process.argv[2]+"/.codex-marketplace-install.json";const m=JSON.parse(fs.readFileSync(p));m.revision=process.argv[1];fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n")' "$SHA" "$PLUG/NEW"
```

Then edit `$CODEX_HOME/config.toml` `[marketplaces.omc]`:

```toml
last_updated  = "<the vNEW commit date, ISO>"
last_revision = "<$SHA>"
```

## 4. Check what actually changed (decides the next two steps)

```bash
cd "$PLUG/NEW"
git diff --stat "vOLD" "vNEW" -- hooks/hooks.json   # empty = hooks unchanged
git diff --stat "vOLD" "vNEW" -- agents/            # empty = agents unchanged
```

- **hooks/hooks.json unchanged** → the existing `[hooks.state."oh-my-claudecode@omc:…"]`
  trust hashes in `config.toml` stay valid; do nothing.
  **hooks/hooks.json changed** → the hashes no longer match and hooks go
  silently dead. They are keyed on file content, so you must re-approve. The
  reliable way is to let the fork/stock-codex re-prompt for hook trust on next
  launch and harvest the new `[hooks.state.…]` entries it writes (as was done
  for the initial install by copying them from `~/.codex`).
- **agents/ unchanged** → your `$CODEX_HOME/agents/*.toml` subagents are still
  current; skip step 5.
  **agents/ changed** → regenerate them (step 5).

## 5. Regenerate subagents (only if agents/ changed)

Subagents are NOT auto-registered from the plugin — see the main README. Convert
the new version's agent definitions:

```bash
node <porter-repo>/codex/md-to-toml-agent.cjs "$PLUG/NEW/agents" "$CODEX_HOME/agents"
```

Schema reminder: the converter emits **only** `name` / `description` /
`developer_instructions`. Never add `model` or `reasoning_effort` — the loader
rejects the whole file (`unknown field`) and the subagent silently disappears.

## 6. Remove the old version dir

Only after the new dir is fully in place and the marker/config point at it:

```bash
rm -rf "$PLUG/OLD"
```

## 7. Restart and verify

Fully quit and relaunch DIT Code Agent, then confirm from the app log which
version actually loaded (the plugin path is logged only when a skill/subagent
runs, so trigger one OMC skill first):

```bash
python - <<'PY'
import sqlite3, re, datetime, os
db = os.path.expanduser("~/.ditcode/logs_2.sqlite")
cur = sqlite3.connect(db).cursor()
rows = cur.execute("SELECT ts,feedback_log_body FROM logs "
                   "WHERE feedback_log_body LIKE '%oh-my-claudecode%4.%' "
                   "ORDER BY ts DESC LIMIT 200").fetchall()
for ts, b in rows:
    m = re.search(r'oh-my-claudecode[\\/]+(\d+\.\d+\.\d+)', b or '')
    if m:
        print("loaded:", m.group(1), "at", datetime.datetime.fromtimestamp(ts)); break
# and confirm no subagent load errors this session:
n = cur.execute("SELECT COUNT(*) FROM logs WHERE feedback_log_body "
                "LIKE '%malformed agent role%' AND ts > ?",
                (int(datetime.datetime.now().timestamp())-900,)).fetchone()[0]
print("malformed-agent errors (last 15 min):", n)
PY
```

`loaded:` should print NEW and the error count should be 0.

## Rollback

```bash
cp "$CODEX_HOME/config.toml.bak-<date>" "$CODEX_HOME/config.toml"
rm -rf "$PLUG/NEW"           # if it was newly created
# (restore $PLUG/OLD from git if you removed it in step 6)
```

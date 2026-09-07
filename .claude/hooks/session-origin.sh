#!/bin/sh
# SessionStart observer — records WHO started this session (issue #3144).
#
# The Now view lists live sessions and claimed issues, and until this hook
# existed neither could say whether an unattended AFK driver pass
# (`loop-drain.sh` → `claude -p`) or a human at a terminal was behind them.
# That is the first question asked of a claim that looks stuck: is a robot on
# it, or is somebody typing?
#
# THE SIGNAL IS RECORDED, NOT DERIVED — the same reasoning `claim-ledger.sh`
# spells out for its `owner` join (#2627). `loop-drain.sh` already exports
# `TOLARIA_LOOP_DRAIN=1` on every pass it launches, and `loop-handoff.sh`'s
# `blocked_reason` already trusts exactly that variable to know a pass was
# driver-started. Hooks inherit the session process's environment, so reading
# it HERE, inside the session, at the moment it starts, is the truth. After
# the fact there is nothing to look it up in: the variable is gone with the
# process, and the session UUID appears in no argv.
#
# The transcript's own `entrypoint` field (`sdk-cli` for a headless `claude
# -p`, `cli` for an interactive terminal) is the FALLBACK, applied by
# `scripts/lib/session-origin.ts` to sessions that have no row here — every
# session that started before this hook existed. It is an inference: a
# `claude -p` typed by hand reads as headless too. This row is what makes the
# answer exact going forward.
#
# Observer only: always exits 0, never blocks, prints nothing on stdout (a
# SessionStart hook's stdout is injected into the session as context, and
# this one has nothing to say to the model).

set -u

payload=$(cat)
session=$(printf '%s' "$payload" | jq -r '.session_id // ""')
[ -n "$session" ] || exit 0

# `${CLAUDE_PROJECT_DIR:-.}` — the same root `claim-ledger.sh` writes to, so
# both journals live in one place. In a `/next-issue` session that is the
# PRIMARY checkout even after the session cd's into its worktree: the harness
# fixes the variable at session start.
dir="${CLAUDE_PROJECT_DIR:-.}/.claude/telemetry"
mkdir -p "$dir" 2>/dev/null || exit 0

# The whole discrimination, in one line. Any non-empty value counts: the
# driver sets it to `1`, and a future value ("2", "drain") must not silently
# read as interactive.
if [ -n "${TOLARIA_LOOP_DRAIN:-}" ]; then
    origin="afk"
else
    origin="interactive"
fi

jq -nc \
    --argjson ts "$(date +%s)" \
    --arg session "$session" \
    --arg origin "$origin" \
    --arg cwd "$(pwd)" \
    '{ts: $ts, session: $session, origin: $origin, cwd: $cwd}' \
    >>"$dir/sessions.jsonl" 2>/dev/null

exit 0

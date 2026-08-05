#!/bin/sh
# SubagentStop hook — a subagent that leaves no receipt is RECORDED as leaving
# none (issue #2182, PRD #2180).
#
# The receipt itself is written by the subagent (`scripts/lib/receipt.ts`), and
# that is deliberate: only the subagent knows its outcome, its PR, the paths its
# diff touched and what it broke to prove a test. The hook does not parse the
# transcript to reconstruct any of that — the hook is the GUARANTEE, the
# subagent's write is the PAYLOAD.
#
# What the hook guarantees is the one thing the subagent cannot: that a
# subagent which crashed, was interrupted, or simply forgot leaves a fact behind
# instead of an absence. Without it, "no receipt for #123" and "the orchestrator
# never spawned anything for #123" look identical afterwards, and both look
# exactly like a clean run in which nothing was expected.
#
# Accounting is by filename, not by count: every receipt this session has
# already seen is appended to `.accounted`, so a stop is charged as missing only
# when NOTHING new appeared since the previous stop. That survives a subagent
# writing two receipts (implement + a later fixup) and a subagent writing none.
#
# Always exits 0. A SubagentStop hook that fails must not take the run with it.

set -u

payload=$(cat 2>/dev/null || printf '{}')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null)
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // ""' 2>/dev/null)
[ -n "$session" ] || exit 0

dir="${CLAUDE_PROJECT_DIR:-.}/.claude/receipts/$session"
mkdir -p "$dir" 2>/dev/null || exit 0

accounted="$dir/.accounted"
[ -f "$accounted" ] || : >"$accounted"

# Receipts present now, excluding the hook's own missing markers.
new=""
for file in "$dir"/*.json; do
    [ -e "$file" ] || continue
    name=$(basename "$file")
    case "$name" in
    missing-*) continue ;;
    esac
    grep -Fxq "$name" "$accounted" 2>/dev/null && continue
    new="$new$name
"
done

if [ -n "$new" ]; then
    printf '%s' "$new" >>"$accounted"
    exit 0
fi

ts=$(date +%s)
if [ "$transcript" = "" ] || [ "$transcript" = "null" ]; then
    transcript_json=null
else
    transcript_json=$(printf '%s' "$transcript" | jq -R .)
fi

printf '{\n  "version": 1,\n  "role": "missing",\n  "outcome": "missing",\n  "session": %s,\n  "transcript": %s,\n  "ts": %s\n}\n' \
    "$(printf '%s' "$session" | jq -R .)" "$transcript_json" "$ts" \
    >"$dir/missing-$ts.json" 2>/dev/null

printf 'subagent stopped with no receipt — recorded %s\n' "missing-$ts.json" >&2
exit 0

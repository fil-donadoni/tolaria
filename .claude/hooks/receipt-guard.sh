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
# ─────────────────────────────────────────────────────────────────────────────
# ONE MARKER PER SUBAGENT, NOT ONE PER STOP.
#
# `SubagentStop` does NOT fire once per subagent. It fires from the subagent
# query-loop's `finally`, so a background/async agent emits one on EVERY yield —
# every time it goes idle awaiting its next nudge. Measured: 131 events across a
# 94-minute run that spawned 4 subagents, one every ~33s. A stop-charging hook
# therefore charged ~47 "missing" markers for a single agent that did write its
# receipt, at the end. Worst session on disk: 676 markers, 0 receipts.
#
# That is not a cosmetic leak — it destroyed the guarantee. `missing` stopped
# meaning "a subagent left no receipt" and came to mean "an agent yielded", at a
# ~97% noise floor, so a real crash was indistinguishable from the rumble beside
# it, and `train-order.ts` / `scorecard.ts` counted the rumble.
#
# The fix is to key the marker on `agent_id` (present on every SubagentStop
# payload) and OVERWRITE it: a yielding agent rewrites its own marker instead of
# minting a new one, so a session accrues at most one marker per subagent, and
# the marker that survives to the end of the run is the one that means something.
# A stop that DOES see a new receipt clears that agent's marker.
#
# Crediting a new receipt to the stopping agent is a heuristic — receipts carry
# no agent id, so a receipt written by a CONCURRENT agent can clear this one's
# marker. It is self-correcting: this agent's next yield finds no new receipt
# and rewrites the marker. What matters is the state at the end of the run, and
# there the only way to hold a cleared marker is to have produced a receipt.
#
# With no `agent_id` in the payload (an older harness), fall back to the
# original timestamped marker: noisy, but never silent.
#
# Accounting is by filename: every receipt this session has already seen is
# appended to `.accounted`, so a stop is charged only when NOTHING new appeared
# since the previous stop. That survives a subagent writing two receipts
# (implement + a later fixup) and a subagent writing none.
#
# Always exits 0. A SubagentStop hook that fails must not take the run with it.

set -u

payload=$(cat 2>/dev/null || printf '{}')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null)
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // ""' 2>/dev/null)
agent_id=$(printf '%s' "$payload" | jq -r '.agent_id // ""' 2>/dev/null)
agent_type=$(printf '%s' "$payload" | jq -r '.agent_type // ""' 2>/dev/null)
agent_transcript=$(printf '%s' "$payload" | jq -r '.agent_transcript_path // ""' 2>/dev/null)
[ -n "$session" ] || exit 0

dir="${CLAUDE_PROJECT_DIR:-.}/.claude/receipts/$session"
mkdir -p "$dir" 2>/dev/null || exit 0

# The agent id lands in a filename — keep it to characters that cannot escape
# the directory or collide with the `missing-<ts>` fallback.
key=$(printf '%s' "$agent_id" | tr -c 'A-Za-z0-9_-' '_' | cut -c1-64)
case "$key" in
*[!_]*) ;;          # keeps at least one non-underscore character
*) key="" ;;        # empty, or scrubbed to nothing → treat as absent
esac

accounted="$dir/.accounted"
[ -f "$accounted" ] || : >"$accounted"

# Receipts present now, excluding the hook's own missing markers. A second
# review/fixup round (`scripts/lib/receipt.ts`'s `round` field) lands as its
# own filename (`12-review-2.json`, never a rewrite of `12-review.json`), so
# it needs no special case here: it is just another distinct name the glob
# below sees once and accounts for once, exactly like round 1.
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
    # This agent (best guess — see the header) delivered: drop its marker.
    [ -n "$key" ] && rm -f "$dir/missing-$key.json"
    exit 0
fi

ts=$(date +%s)
if [ "$transcript" = "" ] || [ "$transcript" = "null" ]; then
    transcript_json=null
else
    transcript_json=$(printf '%s' "$transcript" | jq -R .)
fi

if [ -n "$key" ]; then
    marker="missing-$key.json"
    agent_json=$(printf '%s' "$agent_id" | jq -R .)
else
    # No agent id — one marker per stop, as before. Noisy, never silent.
    marker="missing-$ts.json"
    agent_json=null
fi

if [ -n "$agent_type" ] && [ "$agent_type" != "null" ]; then
    agent_type_json=$(printf '%s' "$agent_type" | jq -R .)
else
    agent_type_json=null
fi
if [ -n "$agent_transcript" ] && [ "$agent_transcript" != "null" ]; then
    agent_transcript_json=$(printf '%s' "$agent_transcript" | jq -R .)
else
    agent_transcript_json=null
fi

printf '{\n  "version": 1,\n  "role": "missing",\n  "outcome": "missing",\n  "session": %s,\n  "transcript": %s,\n  "agentId": %s,\n  "agentType": %s,\n  "agentTranscript": %s,\n  "ts": %s\n}\n' \
    "$(printf '%s' "$session" | jq -R .)" "$transcript_json" \
    "$agent_json" "$agent_type_json" "$agent_transcript_json" "$ts" \
    >"$dir/$marker" 2>/dev/null

printf 'subagent stopped with no receipt — recorded %s\n' "$marker" >&2
exit 0

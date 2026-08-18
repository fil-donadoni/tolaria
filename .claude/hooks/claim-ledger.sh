#!/bin/sh
# PreToolUse observer — records which issues THIS session claimed
# (issue #2183, PRD #2180).
#
# The Release rule ("a claimed issue must be released on every exit path") is
# the one the loop is least likely to honour on the path that matters: a user
# interrupt or a crash leaves the claim behind, and an orphaned `in-progress`
# label hides ready work from every later pass until someone stumbles on it.
#
# A blind sweep cannot fix that, because several sessions run under the SAME
# GitHub account: their claims are indistinguishable by assignee, so releasing
# "my" claims by assignee would unclaim somebody else's live work. The ledger is
# what makes the sweep safe — it records the claim at the moment this session
# makes it, keyed by session id, so `claim-sweep.sh` can release exactly what
# this session took and nothing else.
#
# Observer only: always exits 0, never blocks. Denial is `deny-guard.sh`'s job.
#
# ── Plan join (issue #2518) ─────────────────────────────────────────────────
# Nothing checked that the batch a pass claimed WAS the batch `queue:plan`
# produced, and nothing recorded which plan a claim came from — a hand-picked
# batch was indistinguishable from a planned one, after the fact. Every claim
# row now names the plan in force for this session (the latest file
# `queue-plan.ts` wrote to `.claude/telemetry/plans/<session>-<ts>.json`, or
# `null` when none preceded it) and, when the claimed issue is absent from
# that plan's admitted batch, a `planMismatch` naming both the claimed issue
# and what the plan admitted instead.
#
# Report, never block: a legitimate same-pass replan
# (`TOLARIA_ALLOW_REPLAN=1`, deny-guard.sh §5) needs no special case here —
# it produces a NEWER plan file for the same session, and "latest plan for
# this session" is exactly what this hook reads, so a real replan simply
# joins clean against its own, more recent, plan.

set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""')
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""')

[ "$tool" = "Bash" ] || exit 0

# `gh issue edit N --add-label in-progress` is the claim. Match the label
# explicitly: an edit that adds some other label is not a claim.
printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+issue[[:space:]]+edit' || exit 0
printf '%s' "$cmd" | grep -Eq -- '--add-label[[:space:]]+in-progress' || exit 0

issue=$(printf '%s' "$cmd" | sed -nE 's/.*gh[[:space:]]+issue[[:space:]]+edit[[:space:]]+#?([0-9]+).*/\1/p')
[ -n "$issue" ] || exit 0

dir="${CLAUDE_PROJECT_DIR:-.}/.claude/telemetry"
mkdir -p "$dir" 2>/dev/null || exit 0

# Latest plan file for THIS session. `queue-plan.ts` names each artefact
# `<session>-<epoch-ms>.json`, so a plain lexicographic sort of one session's
# own files is a chronological sort too — no JSON parsing needed to find it.
plans_dir="$dir/plans"
plan_file=""
if [ -n "$session" ] && [ -d "$plans_dir" ]; then
    plan_file=$(ls -1 "$plans_dir/$session"-*.json 2>/dev/null | sort | tail -1)
fi

plan_json="null"
mismatch_json="null"
if [ -n "$plan_file" ] && [ -f "$plan_file" ]; then
    plan_id=$(basename "$plan_file")
    plan_json=$(printf '%s' "$plan_id" | jq -R .)
    in_plan=$(jq --argjson n "$issue" \
        '([.plan.batch[].number] | index($n)) != null' \
        "$plan_file" 2>/dev/null)
    if [ "$in_plan" != "true" ]; then
        planned=$(jq -c '[.plan.batch[].number]' "$plan_file" 2>/dev/null)
        [ -n "$planned" ] || planned="[]"
        mismatch_json=$(jq -n --argjson issue "$issue" --argjson planned "$planned" \
            '{claimed: $issue, planned: $planned}')
        printf 'queue-plan mismatch: claimed #%s is not in session %s'\''s latest plan (%s) — plan admitted %s\n' \
            "$issue" "$session" "$plan_id" "$planned" >&2
    fi
else
    printf 'queue-plan mismatch: claimed #%s with no preceding plan for session %s\n' \
        "$issue" "$session" >&2
fi

jq -nc \
    --argjson ts "$(date +%s)" \
    --arg session "$session" \
    --argjson issue "$issue" \
    --argjson plan "$plan_json" \
    --argjson planMismatch "$mismatch_json" \
    '{ts: $ts, session: $session, issue: $issue, event: "claim", plan: $plan, planMismatch: $planMismatch}' \
    >>"$dir/claims.jsonl" 2>/dev/null

exit 0

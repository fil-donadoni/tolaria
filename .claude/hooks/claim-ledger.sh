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

# `gh issue edit N … --add-label in-progress` is the claim. Match the label
# explicitly: an edit that adds some other label is not a claim.
#
# EVERY issue in the command has to be recorded, not the first one. A batch is
# claimed in ONE Bash call — `gh issue edit 2445 1969 1851 1852 --add-label
# in-progress`, or the same four edits chained with `&&`, or a `for` loop — and
# the old single `sed -nE` captured only the first number in the whole string.
# The other three were never in the ledger, so `claim-sweep.sh` could not
# release them: it releases exactly what the ledger says this session took.
#
# Observed 2026-08-17: a headless pass claimed #2445, #1969, #1851 and #1852,
# died, and left all four labelled `in-progress` with no branch, no PR and no
# ledger row. Nothing releases those — every later pass skips them as "somebody
# else's live work", permanently.
#
# So: split into segments (the same shapes deny-guard.sh splits on), and for
# each segment that IS a claim, take every issue number between `edit` and the
# first flag.
segments=$(printf '%s' "$cmd" | sed -e 's/&&/\
/g' -e 's/||/\
/g' -e 's/;/\
/g')

issues=$(printf '%s\n' "$segments" | awk '
    # A claim segment names both the edit and the label.
    !/gh[ \t]+issue[ \t]+edit/ { next }
    !/--add-label[ \t]+in-progress/ { next }
    {
        # Everything between `edit` and the first option is the issue list.
        sub(/.*gh[ \t]+issue[ \t]+edit[ \t]+/, "")
        sub(/[ \t]+-.*/, "")
        n = split($0, parts, /[ \t]+/)
        for (i = 1; i <= n; i++) {
            token = parts[i]
            sub(/^#/, "", token)
            if (token ~ /^[0-9]+$/) print token
        }
    }
' | sort -un)
[ -n "$issues" ] || exit 0

dir="${CLAUDE_PROJECT_DIR:-.}/.claude/telemetry"
mkdir -p "$dir" 2>/dev/null || exit 0

# Latest plan file for THIS session. `queue-plan.ts` names each artefact
# `<session>-<epoch-ms>.json`, so a plain lexicographic sort of one session's
# own files is a chronological sort too — no JSON parsing needed to find it.
#
# Read ONCE, outside the loop: a batch claim writes N rows and they all join to
# the same plan, so re-reading it per issue would be N jq invocations for one
# answer.
plans_dir="$dir/plans"
plan_file=""
if [ -n "$session" ] && [ -d "$plans_dir" ]; then
    plan_file=$(ls -1 "$plans_dir/$session"-*.json 2>/dev/null | sort | tail -1)
fi

plan_json="null"
plan_id=""
planned="[]"
if [ -n "$plan_file" ] && [ -f "$plan_file" ]; then
    plan_id=$(basename "$plan_file")
    plan_json=$(printf '%s' "$plan_id" | jq -R .)
    planned=$(jq -c '[.plan.batch[].number]' "$plan_file" 2>/dev/null)
    [ -n "$planned" ] || planned="[]"
fi

now=$(date +%s)
for issue in $issues; do
    mismatch_json="null"
    if [ -n "$plan_id" ]; then
        in_plan=$(jq -n --argjson n "$issue" --argjson planned "$planned" \
            '($planned | index($n)) != null' 2>/dev/null)
        if [ "$in_plan" != "true" ]; then
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
        --argjson ts "$now" \
        --arg session "$session" \
        --argjson issue "$issue" \
        --argjson plan "$plan_json" \
        --argjson planMismatch "$mismatch_json" \
        '{ts: $ts, session: $session, issue: $issue, event: "claim", plan: $plan, planMismatch: $planMismatch}' \
        >>"$dir/claims.jsonl" 2>/dev/null
done

exit 0

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
#
# ── Owner join (issue #2627) ────────────────────────────────────────────────
# A claim row said WHICH SESSION took the claim but never which OS PROCESS, so
# nothing downstream could ask the one question that separates "a pass is still
# working on this" from "the pass that took this died": is the owner alive?
# The session UUID is not a join key onto a process — it appears in no argv,
# and Claude Code holds no open descriptor on its own transcript (measured
# 2026-08-25), so there is nothing to look it up in after the fact.
#
# It has to be recorded at claim time, and this hook is the only code that runs
# INSIDE the claiming session at that moment. It walks its own process ancestry
# to the nearest `claude` process and stamps the row with that pid plus the
# process's start time. The start time is not decoration: a pid alone is
# worthless once the OS recycles it, and a recycled pid would make a dead pass
# read as alive forever — the exact failure this fact exists to prevent.
#
# Best-effort by construction: if the walk finds nothing (an unusual spawn
# chain, no `ps`), the row carries `owner: null` and `loop:doctor` reads that
# as "unknown", which changes no verdict it would have reached before.

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
    # A claim segment IS a `gh issue edit` invocation — it does not merely
    # CONTAIN those words. Prose travels inside commands (commit bodies, PR
    # bodies, echoed explanations), and matching anywhere in the string wrote a
    # phantom claim on #2445 into the ledger from a commit MESSAGE that quoted
    # the command shape while explaining this very hook. A phantom claim is not
    # cosmetic: `claim-sweep.sh` releases what the ledger says this session
    # took, so it can unclaim another session live work. (That time it survived
    # only because the in-flight probe found the other session pushed branch.)
    # Anchoring at the start of the segment — allowing an env-var prefix — is
    # what separates running the command from talking about it.
    !/^[ \t]*([A-Za-z_][A-Za-z0-9_]*=[^ \t]*[ \t]+)*gh[ \t]+issue[ \t]+edit/ { next }
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

# ── owner join (#2627) ──────────────────────────────────────────────────────
# Nearest ancestor process whose command basename is `claude` — this hook is a
# descendant of the session that is making the claim, so the walk terminates on
# the session's own process. Depth-bounded (a runaway `ps` loop in a PreToolUse
# hook would stall every Bash call) and silent on failure: printing nothing
# means "unknown owner", which downstream reads as "changes no verdict".
#
# `TOLARIA_CLAIM_OWNER_COMM` is the injection seam the tests use — the same
# role `isAlive` plays in `lib/loop-status.ts`. A vitest-spawned hook has no
# `claude` ancestor, so without a seam the recording path could only ever be
# asserted against a real Claude Code process, i.e. never.
owner_comm="${TOLARIA_CLAIM_OWNER_COMM:-claude}"
resolve_owner_pid() {
    _p=$$
    _depth=0
    while [ "$_depth" -lt 16 ]; do
        _depth=$((_depth + 1))
        _info=$(ps -o ppid=,comm= -p "$_p" 2>/dev/null) || return 1
        [ -n "$_info" ] || return 1
        _ppid=$(printf '%s\n' "$_info" | awk 'NR==1 {print $1}')
        _comm=$(printf '%s\n' "$_info" | awk 'NR==1 {print $2}')
        if [ "${_comm##*/}" = "$owner_comm" ]; then
            printf '%s' "$_p"
            return 0
        fi
        case "$_ppid" in
            '' | 0 | 1) return 1 ;;
            *[!0-9]*) return 1 ;;
        esac
        _p=$_ppid
    done
    return 1
}

# The PID-reuse discriminator. A pid on its own is a number the OS reissues;
# paired with the process's start time it identifies one specific process, so a
# dead pass cannot read as alive because something else inherited its number.
owner_json="null"
owner_pid=$(resolve_owner_pid) || owner_pid=""
if [ -n "$owner_pid" ]; then
    owner_started=$(ps -o lstart= -p "$owner_pid" 2>/dev/null | sed -e 's/^ *//' -e 's/ *$//')
    if [ -n "$owner_started" ]; then
        owner_json=$(jq -n --argjson pid "$owner_pid" --arg startedAt "$owner_started" \
            '{pid: $pid, startedAt: $startedAt}')
    fi
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
        --argjson owner "$owner_json" \
        '{ts: $ts, session: $session, issue: $issue, event: "claim", plan: $plan, planMismatch: $planMismatch, owner: $owner}' \
        >>"$dir/claims.jsonl" 2>/dev/null
done

exit 0

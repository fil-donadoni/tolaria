#!/bin/sh
# scripts/loop-drain.sh — the AFK driver for `/process-gh-issues` (ADR 0097).
#
# `/process-gh-issues` runs exactly ONE batch per process — MAX_PASSES=1 is
# enforced by the skill itself, and `.claude/hooks/deny-guard.sh` denies a
# second `queue:plan` inside the same conversation. That is deliberate: the
# context reset between batches IS the cost-containment mechanism. Continuous
# draining is therefore an OUT-OF-PROCESS loop — this script — around a fresh
# `claude -p "/process-gh-issues"` per pass. All the state a resumed pass
# needs already survives a process boundary: the `in-progress` GitHub label,
# the branch/PR, and `.claude/telemetry/green-sha`.
#
# This is the "Ralph" pattern: a shell `while` loop around an ephemeral agent
# process. See ADR 0097 for the full rationale, including why the budget
# guard below is a LOCAL PROXY and not a real Anthropic quota reading.
#
# POSIX sh, macOS-safe: no `timeout`, no `find -newermt`, no `date -d`, no
# GNU-only flags (see the mtime-filter feedback note the repo carries — the
# equivalent trap here is solved in TypeScript, in usage-window.ts, not here).
#
# Run relative to the repo root (`bun run loop:drain` or
# `sh scripts/loop-drain.sh` from the repo root) — every path below is
# relative to the caller's cwd, deliberately, so this script is trivially
# testable against a throwaway scratch directory (see
# scripts/__tests__/loop-drain.test.ts).

set -eu

# ── flags / env fallbacks ───────────────────────────────────────────────────
BUDGET="${TOLARIA_LOOP_TOKEN_BUDGET:-}"
MAX_PCT=80
WINDOW_HOURS=5
MAX_PASSES=0
STOP_FILE=".claude/telemetry/loop-stop"
CLAUDE_ARGS=""
DRY_RUN=0

while [ $# -gt 0 ]; do
    case "$1" in
        --budget)
            BUDGET="$2"
            shift 2
            ;;
        --max-pct)
            MAX_PCT="$2"
            shift 2
            ;;
        --window-hours)
            WINDOW_HOURS="$2"
            shift 2
            ;;
        --max-passes)
            MAX_PASSES="$2"
            shift 2
            ;;
        --stop-file)
            STOP_FILE="$2"
            shift 2
            ;;
        --claude-args)
            CLAUDE_ARGS="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        *)
            echo "loop-drain: unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

# ── numeric argument validation — every one of these gates a spend-bounding
# guard downstream (max passes, budget pct threshold, the budget itself). A
# `test`/`awk` numeric comparison on a non-numeric value does NOT error
# loudly: `[ "abc" -gt 0 ]` just returns false, and `awk`'s `x+0` silently
# coerces garbage to 0. Both shapes previously turned a typo into "the guard
# never fires" instead of a visible failure — validate here, once, so a bad
# value is an exit-2 at startup, never a guard that quietly does nothing.
is_uint() {
    case "$1" in
        '' | *[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

is_number() {
    awk -v s="$1" \
        'BEGIN { exit (s ~ /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/) ? 0 : 1 }'
}

if ! is_uint "$MAX_PASSES"; then
    echo "loop-drain: --max-passes must be a non-negative integer, got: '$MAX_PASSES'" >&2
    exit 2
fi

if ! is_number "$MAX_PCT"; then
    echo "loop-drain: --max-pct must be numeric, got: '$MAX_PCT'" >&2
    exit 2
fi

if [ -n "$BUDGET" ] && ! is_number "$BUDGET"; then
    echo "loop-drain: --budget must be a plain number (e.g. 200000000 — no suffix like '2M', no separators like '2_000_000'), got: '$BUDGET'" >&2
    exit 2
fi

LOG_DIR=".claude/telemetry/loop-drain"
LOG_FILE=".claude/telemetry/loop-drain.log"
GREEN_SHA_FILE=".claude/telemetry/green-sha"

mkdir -p "$LOG_DIR"
STOP_FILE_DIR=$(dirname "$STOP_FILE")
[ "$STOP_FILE_DIR" = "." ] || mkdir -p "$STOP_FILE_DIR"

# ── rate-limit detection — one place, easy to extend when a new wording
# shows up. Case-insensitive `grep -E` alternation over shapes the `claude`
# CLI is known to emit when it hits Anthropic's usage limit.
#
# Known trade-off (deliberately NOT narrowed): this greps the WHOLE pass
# transcript, so ordinary English in an agent's own summary — e.g. the word
# "quota" used in an unrelated sentence — can false-positive a stop. Accepted
# on purpose: this fails SAFE (an unattended run stops and reports rather
# than continuing to spend), and narrowing the pattern risks the expensive
# direction — missing a real limit message and spinning past it unattended.
RATE_LIMIT_PATTERNS='rate limit|usage limit|quota|limit reached'

# ── permission mode is the USER's call, never a baked-in default (security-
# relevant) — but an empty --claude-args means the first tool-use permission
# prompt blocks forever with nobody watching, so say so loudly, once.
if [ -z "$CLAUDE_ARGS" ]; then
    echo "loop-drain: WARNING — --claude-args is empty. An unattended pass" >&2
    echo "  will BLOCK on the first permission prompt unless you pass a" >&2
    echo "  permission mode, e.g. --claude-args '--dangerously-skip-permissions'." >&2
    echo "  That is a security-relevant choice this driver will not default for you." >&2
fi

# ── budget guard is opt-in: no budget configured -> disabled, said once. A
# silently-disabled guard is the failure mode to avoid (see the PRD). Once
# opted in, the guard must FAIL CLOSED: if the pct can't be read back (the
# reader is missing, crashes, or emits something we can't parse a number
# from), that is treated exactly like "budget exceeded" — see stop reason
# `usage-error` below — never "skip the check and run anyway."
BUDGET_ENABLED=1
case "$BUDGET" in
    "" | 0 | 0.0 | -*)
        BUDGET_ENABLED=0
        echo "loop-drain: no --budget / TOLARIA_LOOP_TOKEN_BUDGET configured — the token-budget guard is DISABLED for this run." >&2
        ;;
esac

# count OPEN ready-for-agent issues NOT carrying in-progress. `gh search`'s
# `-label:` negation avoids a separate JSON-filtering step (no jq dependency).
# `--limit 500` is comfortably above the real backlog (~179 unclaimed as of
# writing) — `--limit N` on `gh` returns the N NEWEST, not "the first N", so
# under-sizing this silently truncates the count rather than erroring.
count_unclaimed() {
    gh issue list \
        --search 'is:open is:issue label:ready-for-agent -label:in-progress' \
        --json number --limit 500 --jq 'length'
}

# count ALL open ready-for-agent issues, claimed or not. Claiming an issue
# (adding `in-progress`) does not change this count; only a real landing
# (issue closed, or the label dropped) does. This is the PROGRESS signal —
# see the no-progress check below — deliberately distinct from
# `count_unclaimed`, which stays the QUEUE-EMPTY signal. Conflating the two
# let a pass that claims work and lands nothing look like progress (the
# unclaimed count drops on a claim alone), resetting the no-progress streak
# forever.
count_total_open() {
    gh issue list \
        --search 'is:open is:issue label:ready-for-agent' \
        --json number --limit 500 --jq 'length'
}

read_green_sha() {
    if [ -f "$GREEN_SHA_FILE" ]; then
        cat "$GREEN_SHA_FILE"
    else
        echo ""
    fi
}

pass=0
no_progress_streak=0
stop_reason=""
pct="n/a"
first_queue_count=""
last_queue_count=""

while :; do
    # 1. stop-file — the user's kill switch for a run already in flight.
    if [ -f "$STOP_FILE" ]; then
        stop_reason="stop-file"
        break
    fi

    # 2. max-passes. MAX_PASSES is already validated numeric above, so this
    # is a plain comparison — no error-swallowing redirect needed.
    if [ "$MAX_PASSES" -gt 0 ] && [ "$pass" -ge "$MAX_PASSES" ]; then
        stop_reason="max-passes"
        break
    fi

    # 3. budget — a local proxy for relative burn, not a real quota reading
    # (see ADR 0097 and scripts/lib/usage-window.ts). FAILS CLOSED: a
    # non-zero exit, unparsable output, or a non-numeric/`null` pct all stop
    # the run with reason `usage-error` rather than silently skipping the
    # check and running the pass anyway.
    if [ "$BUDGET_ENABLED" -eq 1 ]; then
        usage_json=$(bun run usage:window --hours "$WINDOW_HOURS" --budget "$BUDGET" 2>&1) && usage_rc=0 || usage_rc=$?
        pct=$(printf '%s' "$usage_json" | grep -o '"pct":[0-9.eE+-]*' | head -1 | cut -d: -f2)
        weighted=$(printf '%s' "$usage_json" | grep -o '"weighted":[0-9.eE+-]*' | head -1 | cut -d: -f2)
        if [ "$usage_rc" -ne 0 ] || [ -z "$pct" ] || ! is_number "$pct"; then
            stop_reason="usage-error"
            pct="n/a"
            echo "loop-drain: budget guard FAILED CLOSED — could not read a usable pct from 'bun run usage:window' (exit ${usage_rc}). This stops the run rather than skipping the check, per ADR 0097. Reader output was:" >&2
            printf '%s\n' "$usage_json" >&2
            break
        fi
        over=$(awk -v p="$pct" -v m="$MAX_PCT" 'BEGIN { print (p + 0 >= m + 0) ? 1 : 0 }')
        if [ "$over" -eq 1 ]; then
            stop_reason="budget"
            echo "loop-drain: budget guard tripped — ${pct}% of budget (weighted ${weighted:-?}) >= --max-pct ${MAX_PCT}%." >&2
            break
        fi
    fi

    # 4. queue — nothing unclaimed left to do.
    queue_before=$(count_unclaimed 2>/dev/null) || queue_before=""
    if ! is_uint "$queue_before"; then
        stop_reason="gh-error"
        echo "loop-drain: could not read the ready-for-agent queue count via gh — stopping." >&2
        break
    fi
    [ -n "$first_queue_count" ] || first_queue_count="$queue_before"
    last_queue_count="$queue_before"
    if [ "$queue_before" -eq 0 ]; then
        stop_reason="queue-empty"
        break
    fi

    # ── run one pass ────────────────────────────────────────────────────────
    pass=$((pass + 1))
    epoch=$(date +%s)
    pass_log="$LOG_DIR/pass-${pass}-${epoch}.log"
    green_before=$(read_green_sha)
    total_before=$(count_total_open 2>/dev/null) || total_before=""

    if [ "$DRY_RUN" -eq 1 ]; then
        echo "loop-drain: [dry-run] pass $pass would run: claude -p \"/process-gh-issues\" $CLAUDE_ARGS" >&2
        : >"$pass_log"
        claude_exit=0
    else
        rc_file=$(mktemp)
        # A pipeline's exit status in POSIX sh is the LAST command's (tee),
        # not claude's — capture claude's real exit code via the rc_file
        # rather than `$?` after the pipe (no PIPESTATUS in POSIX sh).
        set +e
        (
            # shellcheck disable=SC2086  # intentional word-splitting of a
            # user-supplied flag string, documented above.
            claude -p "/process-gh-issues" $CLAUDE_ARGS 2>&1
            echo $? >"$rc_file"
        ) | tee "$pass_log"
        set -e
        claude_exit=$(cat "$rc_file" 2>/dev/null || echo "")
        rm -f "$rc_file"
        # If the subshell died before it could write $rc_file (killed,
        # crashed before `echo $?` ran), default to a generic non-zero code
        # rather than leaving claude_exit empty — an empty field breaks the
        # 7-field log-line invariant and `[ "" -ne 0 ]` errors under `-eu`.
        is_uint "$claude_exit" || claude_exit=1
    fi

    # 5. rate limit / claude error -> stop and report (never sleep-and-retry
    # — the user chose this explicitly). Two DISTINCT reasons, so the one
    # telemetry field a human reads the next morning doesn't conflate a real
    # usage limit with an ordinary crash, a bad `--claude-args` string, or a
    # hook denial:
    #   - `rate-limit`: the transcript matched a rate-limit/usage-limit shape
    #   - `claude-error`: `claude` exited non-zero with NO such match — some
    #     other failure, still worth stopping for, but not a rate limit
    rate_limited=0
    claude_errored=0
    if grep -iE "$RATE_LIMIT_PATTERNS" "$pass_log" >/dev/null 2>&1; then
        rate_limited=1
    fi
    if [ "$claude_exit" -ne 0 ] && [ "$rate_limited" -eq 0 ]; then
        claude_errored=1
    fi

    queue_after=$(count_unclaimed 2>/dev/null) || queue_after=""
    total_after=$(count_total_open 2>/dev/null) || total_after=""
    green_after=$(read_green_sha)
    if is_uint "$queue_after"; then
        last_queue_count="$queue_after"
    else
        # gh can fail AFTER a pass just as easily as before one (transient
        # API error, rate limit). An empty queue_after breaks the 7-field
        # log-line invariant the same way an empty claude_exit did — default
        # to a placeholder rather than leaving the field empty. This does
        # NOT stop the run (post-pass gh failures are not fatal the way a
        # pre-pass one is, see queue_before above) — it only keeps the log
        # line well-formed.
        queue_after="-"
    fi

    reason_field="-"
    stop_now=0
    if [ "$rate_limited" -eq 1 ]; then
        reason_field="rate-limit"
        stop_now=1
    elif [ "$claude_errored" -eq 1 ]; then
        reason_field="claude-error"
        stop_now=1
    elif [ "$total_after" = "$total_before" ] && [ "$green_after" = "$green_before" ]; then
        # 6. no-progress — neither the TOTAL open ready-for-agent count nor
        # main's tip moved. Deliberately NOT `queue_after`/`queue_before`
        # (the unclaimed count): a pass that only CLAIMS issues (adds
        # `in-progress`) drops the unclaimed count without landing anything,
        # which would otherwise look like progress and reset this streak
        # forever. `total_*` only moves when an issue actually closes (or
        # loses the label) — a real landing — or green-sha moves.
        no_progress_streak=$((no_progress_streak + 1))
        if [ "$no_progress_streak" -ge 2 ]; then
            reason_field="no-progress"
            stop_now=1
        fi
    else
        no_progress_streak=0
    fi

    # 7. one line per pass: epoch pass claude_exit pct queue_before queue_after reason
    echo "$epoch $pass $claude_exit $pct $queue_before $queue_after $reason_field" >>"$LOG_FILE"

    if [ "$stop_now" -eq 1 ]; then
        stop_reason="$reason_field"
        if [ "$reason_field" = "rate-limit" ] || [ "$reason_field" = "claude-error" ]; then
            echo "loop-drain: ${reason_field} (claude exit $claude_exit) detected on pass $pass — stopping. Log tail:" >&2
            tail -n 40 "$pass_log" >&2
        fi
        break
    fi
done

echo ""
echo "loop-drain summary: passes=$pass reason=${stop_reason:-unknown} queue_start=${first_queue_count:-?} queue_end=${last_queue_count:-?} final_pct=${pct:-n/a}"

case "$stop_reason" in
    stop-file | max-passes | queue-empty | budget)
        exit 0
        ;;
    *)
        exit 1
        ;;
esac

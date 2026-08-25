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

# This script's OWN directory, absolute — resolved from `$0` rather than
# `pwd`, because every other path in this file is deliberately relative to
# the CALLER's cwd (see the header above), which the tests exploit by
# running with `cwd` pointed at a scratch directory. `claims_held_check`
# (below) needs to `import` `lib/loop-status.ts` regardless of where the
# caller's cwd happens to be, so it is the one thing in this script anchored
# to the script's own location instead.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# ── flags / env fallbacks ───────────────────────────────────────────────────
BUDGET="${TOLARIA_LOOP_TOKEN_BUDGET:-}"
MAX_PCT=80
WINDOW_HOURS=5
MAX_PASSES=0
STOP_FILE=".claude/telemetry/loop-stop"
CLAUDE_ARGS=""
# The prompt each pass runs. Default = the whole queue, drained by board
# priority — byte-identical to what this driver has always run. `--prompt`
# SCOPES a run instead: `/process-gh-issues` takes free-text args that narrow
# which issues a pass considers (e.g. "figli di 2405" = only that PRD's
# children), and without this flag an unattended run could never express that
# — `--claude-args` appends CLI FLAGS to the `claude` invocation, not prompt
# text. Unlike CLAUDE_ARGS this is ONE argument and stays quoted at the call
# site: word-splitting it would turn "figli di 2405" into three prompts' worth
# of stray argv.
PASS_PROMPT="/process-gh-issues"
DRY_RUN=0
# A single `claude` crash used to end an overnight run outright. It is now
# retried with a doubling backoff, bounded by CONSECUTIVE failures — a
# successful pass resets the streak, so a flaky environment cannot spin here
# forever, and a genuinely broken one still stops after MAX_CONSECUTIVE_ERRORS
# with reason `claude-error`. Rate limits are NOT part of this: they still stop
# the run immediately (ADR 0097 — never sleep-and-retry a quota we cannot poll).
MAX_CONSECUTIVE_ERRORS=3
ERROR_BACKOFF_SECS=60
ERROR_BACKOFF_MAX_SECS=900
PID_FILE=".claude/telemetry/loop-drain.pid"
SINGLE_INSTANCE=0
# Grace period before the FIRST pass. The handoff (scripts/loop-handoff.sh)
# detaches this driver from inside a pass that is still finishing its own
# Release step; starting pass N+1 the same second would race that pass's
# `--remove-label in-progress` calls and re-select issues it is still holding.
START_DELAY=0

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
        --prompt)
            PASS_PROMPT="$2"
            shift 2
            ;;
        --max-consecutive-errors)
            MAX_CONSECUTIVE_ERRORS="$2"
            shift 2
            ;;
        --error-backoff-secs)
            ERROR_BACKOFF_SECS="$2"
            shift 2
            ;;
        --error-backoff-max-secs)
            ERROR_BACKOFF_MAX_SECS="$2"
            shift 2
            ;;
        --pid-file)
            PID_FILE="$2"
            shift 2
            ;;
        --single-instance)
            SINGLE_INSTANCE=1
            shift
            ;;
        --start-delay)
            START_DELAY="$2"
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

# An empty prompt is `claude -p ""` — a pass that does nothing, forever, with
# nobody watching. Reject it at startup rather than discovering it in the
# morning's telemetry as N passes of `no-progress`.
if [ -z "$PASS_PROMPT" ]; then
    echo "loop-drain: --prompt must not be empty (omit it for the default '/process-gh-issues')" >&2
    exit 2
fi

if ! is_uint "$MAX_PASSES"; then
    echo "loop-drain: --max-passes must be a non-negative integer, got: '$MAX_PASSES'" >&2
    exit 2
fi

for _pair in "max-consecutive-errors:$MAX_CONSECUTIVE_ERRORS" \
    "error-backoff-secs:$ERROR_BACKOFF_SECS" \
    "error-backoff-max-secs:$ERROR_BACKOFF_MAX_SECS" \
    "start-delay:$START_DELAY"; do
    _name=${_pair%%:*}
    _value=${_pair#*:}
    if ! is_uint "$_value"; then
        echo "loop-drain: --$_name must be a non-negative integer, got: '$_value'" >&2
        exit 2
    fi
done

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
PID_FILE_DIR=$(dirname "$PID_FILE")
[ "$PID_FILE_DIR" = "." ] || mkdir -p "$PID_FILE_DIR"

# ── liveness advertisement. The pid file is how `scripts/loop-handoff.sh`
# answers "does a driver already own this checkout?" before detaching another
# one — two drivers over one queue double the spend and interleave
# merge-trains. Written unconditionally (so `--status` is informative even for
# a hand-started run); ENFORCED as a lock only under --single-instance, which
# the handoff always passes. A stale pid file (driver killed with -9) is not a
# lock: `kill -0` proves liveness, the file's existence alone never does.
driver_alive() {
    _pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
    is_uint "$_pid" || return 1
    [ "$_pid" = "$$" ] && return 1
    kill -0 "$_pid" 2>/dev/null
}

if [ "$SINGLE_INSTANCE" -eq 1 ] && driver_alive; then
    echo "loop-drain: a driver is already running (pid $(cat "$PID_FILE")) — refusing to start a second one over the same queue." >&2
    echo ""
    echo "loop-drain summary: passes=0 reason=already-running queue_start=? queue_end=? final_pct=n/a"
    exit 0
fi

echo "$$" >"$PID_FILE"
# Only ever remove a pid file that is still OURS: a driver that exits while a
# newer one already claimed the file must not delete the newer one's claim.
cleanup_pid_file() {
    _owner=$(cat "$PID_FILE" 2>/dev/null || echo "")
    [ "$_owner" = "$$" ] && rm -f "$PID_FILE"
    return 0
}
trap cleanup_pid_file EXIT INT TERM

# Sleep in short chunks so the stop-file kill switch is honoured DURING a
# backoff, not only between passes — a 15-minute backoff that ignores the kill
# switch is a run the user cannot stop. Returns 1 if the stop file appeared.
interruptible_sleep() {
    _remaining="$1"
    while [ "$_remaining" -gt 0 ]; do
        [ -f "$STOP_FILE" ] && return 1
        if [ "$_remaining" -gt 5 ]; then
            sleep 5
            _remaining=$((_remaining - 5))
        else
            sleep "$_remaining"
            _remaining=0
        fi
    done
    return 0
}

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

# `claims-held` discriminator (#2626 / #2624 AC). A pass that is forcibly
# terminated exits 0, so it looks identical to a pass that genuinely found
# nothing to do — both leave `total_open`/green-sha unchanged. The only
# durable signal that distinguishes them is whether the CLAIM count (issues
# labelled `in-progress`) rose while nothing landed, which is exactly the
# `claimsHeld` predicate the verdict engine exports
# (`scripts/lib/loop-status.ts`). It is CONSUMED here via `bun -e`, never
# re-implemented as a shell comparison, so this log and the dashboard's
# `claims-held` alarm can never disagree about what happened (AC: "imported
# from the verdict engine, not re-implemented in shell or duplicated in
# TypeScript"). A failure to invoke `bun` (missing binary, crash) fails
# CLOSED to "false" — the pre-existing no-progress streak is always a safe
# fallback, never a driver crash.
claims_held_check() {
    _before="$1"
    _after="$2"
    _merges="$3"
    _lib_path="$SCRIPT_DIR/lib/loop-status"
    if _out=$(CLAIMS_BEFORE="$_before" CLAIMS_AFTER="$_after" CLAIMS_MERGES="$_merges" \
        bun -e "
import { claimsHeld } from \"$_lib_path\";
const claimsBefore = Number(process.env.CLAIMS_BEFORE);
const claimsAfter = Number(process.env.CLAIMS_AFTER);
const merges = Number(process.env.CLAIMS_MERGES);
process.stdout.write(
    claimsHeld({ claimsBefore, claimsAfter, merges }) ? \"true\" : \"false\"
);
" 2>/dev/null); then
        printf '%s' "$_out"
    else
        # Fail CLOSED (see the comment above) but never SILENT — this is a
        # discriminator whose whole purpose is diagnosability, so a swallowed
        # failure here would defeat #2626 as quietly as the bug it fixed.
        echo "loop-drain: claims-held discriminator unavailable (bun -e lib/loop-status failed) — falling back to no-progress" >&2
        echo "false"
    fi
}

# ── orphan-claim reap (#2627) ───────────────────────────────────────────────
# A pass that dies holding claims leaves `in-progress` on issues nothing will
# ever release, and every later pass skips them as somebody else's live work.
# In a dependency tree that is not merely unlucky, it is systematically the
# worst case: the loop schedules UNBLOCKED candidates first, the unblocked
# nodes of a tree are its roots, and the roots are what everything else is
# blocked by — so the passes that die orphan the highest-fan-out issues first,
# every time. On 2026-08-19 two such claims froze nine children and the driver
# stopped, because every remaining candidate was blocked by them.
#
# WHY HERE AND NOT IN THE PASS. The skill has asked its pass to run this
# "every pass, unconditionally, before selection" (SKILL.md §1a) since it was
# written — as PROSE, which an LLM pass follows or does not. CLAUDE.md states
# the project rule: a rule that CAN be enforced mechanically belongs in a
# script the gate runs. The driver is the only place with that property here:
# it is the thing that decides a pass happens at all, so a sweep it runs is a
# sweep that ran, whatever the pass then chooses to do.
#
# WHY BEFORE THE QUEUE COUNT, specifically. Releasing a claim puts the issue
# back into `count_unclaimed`. Check 4 below stops the whole RUN with
# `queue-empty` when that count is zero — which is exactly the state the
# 2026-08-19 incident produced. Sweeping after it would let the driver quit on
# a queue that the sweep was about to refill.
#
# NON-FATAL BY CONSTRUCTION. This is a janitor, not a guard: a failure to
# invoke it (no bun, no script, a `gh` outage) must never take down an
# unattended run that is otherwise fine. Anything it cannot classify it leaves
# claimed — `classifyClaim` in loop-doctor.ts is the SOLE authority on that,
# and this script deliberately contains no age rule, no branch scan and no
# second opinion of its own.
reap_orphan_claims() {
    _doctor="$SCRIPT_DIR/loop-doctor.ts"
    if [ ! -f "$_doctor" ]; then
        echo "loop-drain: orphan-claim sweep skipped — $_doctor not found." >&2
        return 0
    fi
    if _reap_out=$(bun "$_doctor" --release 2>&1); then
        printf 'loop-drain: orphan-claim sweep —\n%s\n' "$_reap_out" >&2
    else
        # Never silent: a janitor that stops running without saying so is how
        # the prose version of this rule failed in the first place.
        echo "loop-drain: orphan-claim sweep FAILED (bun loop-doctor.ts --release) — continuing without it." >&2
        printf '%s\n' "$_reap_out" >&2
    fi
    return 0
}

if [ "$START_DELAY" -gt 0 ]; then
    echo "loop-drain: waiting ${START_DELAY}s before the first pass (handoff grace period)." >&2
    interruptible_sleep "$START_DELAY" || {
        echo ""
        echo "loop-drain summary: passes=0 reason=stop-file queue_start=? queue_end=? final_pct=n/a"
        exit 0
    }
fi

pass=0
no_progress_streak=0
error_streak=0
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

    # 3b. reap orphaned claims — BEFORE the queue is counted and before the
    # pass builds its batch, so anything reclaimed here is selectable by the
    # pass that is about to run. See `reap_orphan_claims` for why it lives in
    # the driver rather than in the pass's own prompt.
    reap_orphan_claims

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
        echo "loop-drain: [dry-run] pass $pass would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p \"$PASS_PROMPT\" $CLAUDE_ARGS" >&2
        : >"$pass_log"
        claude_exit=0
    else
        rc_file=$(mktemp)
        # A pipeline's exit status in POSIX sh is the LAST command's (tee),
        # not claude's — capture claude's real exit code via the rc_file
        # rather than `$?` after the pipe (no PIPESTATUS in POSIX sh).
        set +e
        (
            # TOLARIA_LOOP_DRAIN marks the pass as ALREADY driven: the
            # skill's end-of-pass handoff (scripts/loop-handoff.sh) no-ops on
            # it, so a driver-launched pass never detaches a second driver.
            # Without it, every pass would fork its own driver and the fan-out
            # would be exponential, not sequential.
            #
            # CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 disables `claude -p`'s
            # own background-wait ceiling (default 600000ms/600s — the CLI
            # terminates any still-running background tasks once print mode's
            # main turn ends and this ceiling elapses). Verified against the
            # installed CLI bundle (2.1.237): the ceiling check is
            # `XS>0 && ...` where `XS` is this env var (falling back to the
            # 600000 default via `??`) — `0` makes that comparison always
            # false, so the sweep never fires, matching the CLI's own
            # stderr message ("Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to
            # wait indefinitely."). A pass is already bounded by this
            # driver's own budget/pct ceilings (see the guard above) — a
            # wall-clock cutoff on background subagents is not one of them
            # (#2622); it killed subagents mid-edit (18 of ~34 recorded
            # passes on 2026-08-19).
            # "$PASS_PROMPT" stays QUOTED — it is ONE argument that normally
            # contains spaces ("/process-gh-issues figli di 2405"); splitting
            # it is the exact opposite of what the unquoted $CLAUDE_ARGS
            # below deliberately does.
            # shellcheck disable=SC2086  # intentional word-splitting of a
            # user-supplied flag string, documented above.
            TOLARIA_LOOP_DRAIN=1 CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p "$PASS_PROMPT" $CLAUDE_ARGS 2>&1
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

    # 5. rate limit / claude error. Two DISTINCT reasons, so the one telemetry
    # field a human reads the next morning doesn't conflate a real usage limit
    # with an ordinary crash, a bad `--claude-args` string, or a hook denial —
    # and because they are now handled DIFFERENTLY:
    #   - `rate-limit`: the transcript matched a rate-limit/usage-limit shape.
    #     Stops immediately, never sleep-and-retry (ADR 0097 — there is no
    #     quota endpoint to poll, so any backoff would be a guess).
    #   - `claude-error`: `claude` exited non-zero with NO such match — some
    #     other failure. RETRIED with a doubling backoff up to
    #     MAX_CONSECUTIVE_ERRORS consecutive failures, because a single crash
    #     ending an unattended overnight run is the failure mode this driver
    #     exists to remove.
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
    backoff_secs=0
    if [ "$rate_limited" -eq 1 ]; then
        reason_field="rate-limit"
        stop_now=1
    elif [ "$claude_errored" -eq 1 ]; then
        # A crash is retried, not fatal — but only CONSECUTIVELY bounded. The
        # streak is reset by any pass that does not crash (below), so a run
        # that alternates crash/success cannot accumulate its way to a stop,
        # and a run that is simply broken still stops after
        # MAX_CONSECUTIVE_ERRORS with the same reason it used to stop on
        # immediately. Backoff doubles per consecutive failure, capped.
        error_streak=$((error_streak + 1))
        if [ "$MAX_CONSECUTIVE_ERRORS" -eq 0 ] ||
            [ "$error_streak" -ge "$MAX_CONSECUTIVE_ERRORS" ]; then
            reason_field="claude-error"
            stop_now=1
        else
            reason_field="claude-retry"
            backoff_secs="$ERROR_BACKOFF_SECS"
            _doublings=$((error_streak - 1))
            while [ "$_doublings" -gt 0 ] &&
                [ "$backoff_secs" -lt "$ERROR_BACKOFF_MAX_SECS" ]; do
                backoff_secs=$((backoff_secs * 2))
                _doublings=$((_doublings - 1))
            done
            [ "$backoff_secs" -le "$ERROR_BACKOFF_MAX_SECS" ] ||
                backoff_secs="$ERROR_BACKOFF_MAX_SECS"
        fi
    elif [ "$total_after" = "$total_before" ] && [ "$green_after" = "$green_before" ]; then
        # 6. neither the TOTAL open ready-for-agent count nor main's tip
        # moved. Deliberately NOT `queue_after`/`queue_before` (the unclaimed
        # count): a pass that only CLAIMS issues (adds `in-progress`) drops
        # the unclaimed count without landing anything, which would
        # otherwise look like progress and reset this streak forever.
        # `total_*` only moves when an issue actually closes (or loses the
        # label) — a real landing — or green-sha moves.
        #
        # That still leaves two DIFFERENT causes reaching this branch: a pass
        # that genuinely found nothing to do, and a pass that was forcibly
        # terminated mid-batch (exits 0, same as clean) while still holding
        # the claims it took. `claims_held_check` (see above) tells them
        # apart off the one durable signal that survives a kill: whether
        # `total_open − unclaimed` (issues this driver's own queue has
        # labelled `in-progress`, bracketed to exactly this pass's
        # before/after window — never a cross-pass or cumulative count, so a
        # concurrent session's claims outside that window are not attributed
        # here) rose while `merges` — provably 0 in this branch, since its
        # own guard already established `total_after == total_before` — is
        # zero. `merges` is real, not a proxy: it is not computed from a
        # separate `gh pr list --state merged` read (see
        # docs/findings/2624-receipts-cannot-express-a-landing.md) because
        # this branch's guard already proves it.
        claims_before=""
        claims_after=""
        if is_uint "$total_before" && is_uint "$queue_before"; then
            claims_before=$((total_before - queue_before))
        fi
        if is_uint "$total_after" && is_uint "$queue_after"; then
            claims_after=$((total_after - queue_after))
        fi
        claims_held_now=0
        if is_uint "$claims_before" && is_uint "$claims_after"; then
            if [ "$(claims_held_check "$claims_before" "$claims_after" 0)" = "true" ]; then
                claims_held_now=1
            fi
        fi
        if [ "$claims_held_now" -eq 1 ]; then
            # A fault, not a quiet stop — reported immediately, no streak
            # (a died pass is urgent evidence, unlike "ran twice and found
            # nothing").
            reason_field="claims-held"
            stop_now=1
        else
            no_progress_streak=$((no_progress_streak + 1))
            if [ "$no_progress_streak" -ge 2 ]; then
                reason_field="no-progress"
                stop_now=1
            fi
        fi
    else
        no_progress_streak=0
    fi

    # Any pass that did not crash clears the crash streak — bounded
    # CONSECUTIVELY, not cumulatively (see the comment above).
    [ "$claude_errored" -eq 1 ] || error_streak=0

    # 7. one line per pass: epoch pass claude_exit pct queue_before queue_after reason
    echo "$epoch $pass $claude_exit $pct $queue_before $queue_after $reason_field" >>"$LOG_FILE"

    if [ "$stop_now" -eq 0 ] && [ "$backoff_secs" -gt 0 ]; then
        echo "loop-drain: pass $pass crashed (claude exit $claude_exit; consecutive failure ${error_streak}/${MAX_CONSECUTIVE_ERRORS}) — retrying in ${backoff_secs}s. Log tail:" >&2
        tail -n 20 "$pass_log" >&2
        if ! interruptible_sleep "$backoff_secs"; then
            stop_reason="stop-file"
            break
        fi
    fi

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

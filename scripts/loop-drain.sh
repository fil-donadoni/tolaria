#!/bin/sh
# scripts/loop-drain.sh — the AFK driver for `/next-ticket` (ADR 0097 + 0110).
#
# `/next-ticket` closes exactly ONE issue per process (ADR 0110): the context
# reset between issues IS the cost-containment mechanism, and the skill's own
# §6 ends with "one issue per invocation. The user (or the budgeted AFK
# driver, ADR 0109) decides whether there is a next one." This script is that
# driver — an OUT-OF-PROCESS loop around a fresh `claude -p "/next-ticket N"`
# per pass. All the state a resumed pass needs already survives a process
# boundary: the `in-progress` GitHub label, the branch/PR, and
# `.claude/telemetry/green-sha`.
#
# THE DRIVER IS NOT AN ORCHESTRATOR. It decides exactly two things per pass —
# WHICH issue and on WHICH tier (see `resolve_head` below) — and nothing about
# what the pass then does. The orchestrator that ADR 0110 retired lived inside
# the `/process-gh-issues` skill, in the model's context, not here; this loop
# was never the expensive part and must not become it.
#
# LANES (issue #5486). With `--lanes N|auto` the driver keeps several such
# passes alive at once, each a background job in its own lane — as many as the
# machine admission allows before each start (`refresh_lane_target`). Still
# one driver: the budget, the stop-file, max-passes and every stop decision
# are the run's; a lane only runs a pass.
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
# 100, not 80 (issue #3699). `--budget N` is read by everyone who types it as
# "this run may spend N"; a default of 80 silently made it 0.8N, with nothing
# in the output saying so, so a stated budget and a spendable budget were two
# different numbers. It stays a FLAG because a run that wants headroom under
# its own ceiling is a real thing to want — but the default no longer shrinks
# a number the operator declared. The launch line prints the effective ceiling
# in tokens either way, so the two can never diverge silently again.
MAX_PCT=100
# The trailing-window width. Since #3699 the BUDGET guard does not use it: a
# budget is counted from the run's launch forward (RUN_START_MS below), over
# the run's own sessions only. This stays for the informational reading and
# for an operator who asks the reporter directly.
WINDOW_HOURS=5
MAX_PASSES=0
STOP_FILE=".claude/telemetry/loop-stop"
# The health verdict is read through `bun run health:status --json` (issue
# #5462) — the verdict store, never the marker file: on the github backend a
# RED from the other machine has no local marker at all.
CLAUDE_ARGS=""
# The prompt each pass runs. Default = drain the queue one issue per pass, the
# issue chosen by board priority — see `resolve_head`, which appends the
# resolved issue number so the pass is HANDED its issue instead of re-reading
# the queue from inside the model's context.
#
# `--prompt` SCOPES a run instead, and switches the pre-flight OFF entirely:
# an operator who names the prompt owns the whole invocation, so the driver
# neither appends an issue number nor injects a `--model`. That is the only
# way to express "drain just this slice" (or to point the driver at a
# different skill) — `--claude-args` appends CLI FLAGS to the `claude`
# invocation, not prompt text. Unlike CLAUDE_ARGS this is ONE argument and
# stays quoted at the call site: word-splitting it would turn "figli di 2405"
# into three prompts' worth of stray argv.
PASS_PROMPT="/next-ticket"
PROMPT_OVERRIDDEN=0
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
# The SAME treatment for a pass that dies holding claims (issue #3698). It
# used to stop the run outright on the first occurrence — deliberately, as
# "urgent evidence" (#2626) — and the cost of that choice is measured: across
# 23 recorded runs the drain never exceeded 8 passes and its median is 3,
# because the single commonest death (a pre-PR gate promoted past the Bash
# tool's 600s cap, killed with the turn) lands exactly here. One dead pass is
# evidence; it is not a reason to abandon a queue of 200 issues. So it is now
# a CONSECUTIVE streak like the crash streak, with its own counter: any pass
# that does not die holding claims resets it, and a run whose every pass dies
# still terminates — after this many, with reason `claims-held`. The default
# matches MAX_CONSECUTIVE_ERRORS for the same reason that one is 3: it is the
# smallest number that tells a transient death apart from a broken
# environment. The orphan-claim sweep at the top of each pass (see
# `reap_orphan_claims`) reclaims what the dead pass was holding before the next
# pass selects — EXCEPT for the one shape this fix is about: a pass killed
# after it created its branch leaves a `recoverable` claim (loop-doctor.ts),
# which is never released, because the next pass starting that issue from
# scratch would collide with the branch the dead one left: the plan hands it
# to the next pass as `resume` instead (issue #5174), once per run.
MAX_CONSECUTIVE_CLAIMS_HELD=3
PID_FILE=".claude/telemetry/loop-drain.pid"
# THIS RUN's identity and its start anchor (issue #3699). The budget is the
# ceiling for a RUN, so the spend it counts has to be the run's: every pass is
# launched with TOLARIA_LOOP_RUN_ID in its environment, the session-origin hook
# records it beside the session id, and `usage:window --run` sums exactly those
# transcripts from RUN_START_MS forward. Before this, the guard read a trailing
# five-hour window over every session on the machine — so it refused to start
# on an operator's own interactive spend (observed: 132% with the driver having
# spent nothing) and could never stop a run at a cumulative total, because a
# window forgets (one run went from 22.11% to 12.91% across seven passes).
#
# Epoch seconds plus the pid: unique per run on this machine, and orderable.
RUN_ID="${TOLARIA_LOOP_RUN_ID:-}"
[ -n "$RUN_ID" ] || RUN_ID="$(date +%s)-$$"
RUN_START_MS=$(($(date +%s) * 1000))
SINGLE_INSTANCE=0
# Concurrent passes (issue #5486): `1` (the default — a hand-started
# `loop:drain` keeps its one-pass-at-a-time shape), a ceiling N, or `auto` =
# `sessions.cap`. Above one, the machine admission decides how many of them
# may run at any moment (`bun scripts/machine.ts lanes`, see
# `refresh_lane_target`); `--lanes N` only ever lowers that, never raises it.
# `loop:afk` passes `auto` unless told otherwise.
LANES=1
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
            PROMPT_OVERRIDDEN=1
            shift 2
            ;;
        --max-consecutive-errors)
            MAX_CONSECUTIVE_ERRORS="$2"
            shift 2
            ;;
        --max-consecutive-claims-held)
            MAX_CONSECUTIVE_CLAIMS_HELD="$2"
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
        --lanes)
            LANES="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        *)
            echo "loop-drain[error]: unknown argument: $1" >&2
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
    echo "loop-drain[error]: --prompt must not be empty (omit it for the default '/next-ticket')" >&2
    exit 2
fi

if ! is_uint "$MAX_PASSES"; then
    echo "loop-drain[error]: --max-passes must be a non-negative integer, got: '$MAX_PASSES'" >&2
    exit 2
fi

for _pair in "max-consecutive-errors:$MAX_CONSECUTIVE_ERRORS" \
    "max-consecutive-claims-held:$MAX_CONSECUTIVE_CLAIMS_HELD" \
    "error-backoff-secs:$ERROR_BACKOFF_SECS" \
    "error-backoff-max-secs:$ERROR_BACKOFF_MAX_SECS" \
    "start-delay:$START_DELAY"; do
    _name=${_pair%%:*}
    _value=${_pair#*:}
    if ! is_uint "$_value"; then
        echo "loop-drain[error]: --$_name must be a non-negative integer, got: '$_value'" >&2
        exit 2
    fi
done

case "$LANES" in
    auto) ;;
    '' | *[!0-9]* | 0)
        echo "loop-drain[error]: --lanes must be a positive integer or 'auto', got: '$LANES'" >&2
        exit 2
        ;;
esac
# A named prompt is ONE invocation the operator owns (see PASS_PROMPT): N
# copies of it at once would run the same scoped work N times over.
if [ "$PROMPT_OVERRIDDEN" -eq 1 ] && [ "$LANES" != "1" ]; then
    echo "loop-drain[warn]: --prompt runs one lane — --lanes $LANES ignored (N copies of one named prompt would collide)." >&2
    LANES=1
fi

if ! is_number "$MAX_PCT"; then
    echo "loop-drain[error]: --max-pct must be numeric, got: '$MAX_PCT'" >&2
    exit 2
fi

if [ -n "$BUDGET" ] && ! is_number "$BUDGET"; then
    echo "loop-drain[error]: --budget must be a plain number (e.g. 200000000 — no suffix like '2M', no separators like '2_000_000'), got: '$BUDGET'" >&2
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
    echo "loop-drain[error]: a driver is already running (pid $(cat "$PID_FILE")) — refusing to start a second one over the same queue." >&2
    echo ""
    echo "loop-drain[summary]: passes=0 reason=already-running queue_start=? queue_end=? final_pct=n/a spent=n/a budget=n/a"
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

# ── lanes (issue #5486). One directory per pass in flight,
# `$LANE_DIR/<k>/`, one value per file — read back with `cat`, never sourced:
#   driver     this driver's pid — a lane is only ever ours to finish
#   pid        the background job running the pass (`kill -0` liveness)
#   pass.pid   the `claude` process itself, for signals
#   done       written by the job as its very last act
#   pass issue model session epoch log rc overlap, and the before-readings
#   the pass-end accounting compares against.
# `loop:status` and `loop:afk --status` read the same files for their lane
# view. A lane whose driver is dead is debris from a killed run: swept here.
LANE_DIR=".claude/telemetry/loop-lanes"
# How often a multi-lane driver looks for a finished pass. One lane never
# polls: it `wait`s on its one job.
LANE_TICK_SECS="${TOLARIA_LOOP_LANE_TICK_SECS:-1}"
# How stale the admission's answer may get while nothing starts or ends: a
# machine that clears grows its lanes back within this.
LANE_RECHECK_SECS=30
mkdir -p "$LANE_DIR"
for _d in "$LANE_DIR"/*; do
    [ -d "$_d" ] || continue
    _p=$(cat "$_d/driver" 2>/dev/null || echo "")
    if is_uint "$_p" && [ "$_p" != "$$" ] && kill -0 "$_p" 2>/dev/null; then
        continue
    fi
    rm -rf "$_d"
done

lane_put() { printf '%s\n' "$3" >"$LANE_DIR/$1/$2"; }
lane_get() { cat "$LANE_DIR/$1/$2" 2>/dev/null || true; }

# This driver's lanes, one number per line.
own_lanes() {
    for _d in "$LANE_DIR"/*; do
        [ -f "$_d/driver" ] || continue
        [ "$(cat "$_d/driver" 2>/dev/null)" = "$$" ] || continue
        basename "$_d"
    done
    return 0
}

running_lanes() { own_lanes | wc -l | tr -d ' '; }

# The issues this driver's passes are working on — the pre-flight never hands
# one of them to a second lane, claimed yet or not.
busy_issues() {
    for _k in $(own_lanes); do
        lane_get "$_k" issue
    done | tr '\n' ' '
    return 0
}

# A pass is over when its job says so (`done`) or is gone without saying it —
# gone includes a zombie: a job killed before it wrote `done` and not yet
# reaped answers `kill -0` (dash reaps only on `wait`).
lane_over() {
    [ -f "$LANE_DIR/$1/done" ] && return 0
    _p=$(lane_get "$1" pid)
    is_uint "$_p" || return 1
    kill -0 "$_p" 2>/dev/null || return 0
    case "$(ps -o stat= -p "$_p" 2>/dev/null)" in
        *Z*) return 0 ;;
    esac
    return 1
}

# A pass in a background job ignores the terminal's SIGINT (POSIX: an
# asynchronous list in a non-interactive shell), so the driver forwards the
# end of the run to every pass it started: interrupting the driver ends the
# passes, as it did when the one pass ran in the foreground.
stop_lanes() {
    for _k in $(own_lanes); do
        for _f in pass.pid pid; do
            _p=$(lane_get "$_k" "$_f")
            if is_uint "$_p"; then kill -TERM "$_p" 2>/dev/null || true; fi
        done
        rm -rf "${LANE_DIR:?}/$_k"
    done
    return 0
}
# A driver that ends with passes still in flight (an interrupt, or `set -e`
# aborting it) ends them too: an orphaned pass runs on with no driver to
# account for it, and the next driver sweeps its lane as debris. A clean end
# has none left, so this is a no-op there.
trap 'stop_lanes; cleanup_pid_file' EXIT
trap 'exit 130' INT TERM

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
    echo "loop-drain[warn]: WARNING — --claude-args is empty. An unattended pass" >&2
    echo "  will BLOCK on the first permission prompt unless you pass a" >&2
    echo "  permission mode, e.g. --claude-args '--dangerously-skip-permissions'." >&2
    echo "  That is a security-relevant choice this driver will not default for you." >&2
fi

# ── budget guard is MANDATORY (ADR 0109). It used to be opt-in, and the one
# thing that predictably went wrong is exactly what the opt-in allowed: every
# launcher after 2026-08-23 forgot the flag and the driver ran unthrottled
# for days (the 2026-08-25→27 91%-in-48h burn). No budget -> refuse to start.
# Once running, the guard FAILS CLOSED: if the pct can't be read back (the
# reader is missing, crashes, or emits something we can't parse a number
# from), that is treated exactly like "budget exceeded" — see stop reason
# `usage-error` below — never "skip the check and run anyway."
# TOLARIA_LOOP_ALLOW_NO_BUDGET is a TEST-ONLY hatch: the driver's own suite
# exercises dozens of behaviours that are not about the budget guard. Never
# set it for a real run.
BUDGET_ENABLED=1
# NUMERIC, not a list of literals (PR #3704 review). The list it replaces
# (`"" | 0 | 0.0 | -*`) missed `0.00`, `.0` and `00`, each of which then read
# as a REAL budget — and a zero budget can never trip a percentage, so the
# driver ran unthrottled forever instead of refusing to start, which is the
# precise failure ADR 0109 exists to prevent. `awk` answers the question the
# list was approximating: is this budget a positive number.
_budget_positive=0
if is_number "${BUDGET:-}"; then
    _budget_positive=$(awk -v b="$BUDGET" 'BEGIN { print (b + 0 > 0) ? 1 : 0 }')
fi
case "$_budget_positive" in
    0)
        if [ -n "${TOLARIA_LOOP_ALLOW_NO_BUDGET:-}" ]; then
            BUDGET_ENABLED=0
            echo "loop-drain[warn]: TOLARIA_LOOP_ALLOW_NO_BUDGET set (test-only hatch) — the token-budget guard is DISABLED for this run." >&2
        else
            echo "loop-drain[error]: --budget / TOLARIA_LOOP_TOKEN_BUDGET is REQUIRED — this driver refuses to run unbudgeted (ADR 0109)." >&2
            echo "loop-drain[error]: e.g. --budget 200000000; the guard stops the run once THIS RUN's own weighted spend, accumulated from launch, reaches --max-pct (${MAX_PCT}%) of it." >&2
            exit 1
        fi
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

# The PR a pass HANDED OFF for issue $1 (issue #5469): its open PR labelled
# `ready-to-land`, or a merged one — the session's own finish line since
# landing moved to the land-runner. Empty when there is none; non-zero exit
# when `gh` could not answer. Read before and after a pass: a number that
# appears (a new PR, or a `land-failed` repair re-queued) is PROGRESS, though
# no issue closed and no tip moved — the runner lands it later, on its own
# clock. Asked by HEAD branch (`wt:new`'s `feat|fix/issue-N`), never as "the
# newest N PRs", which an old repaired PR falls out of. `any(...)` rather
# than `index(...)`: jq's `index` is 0 — falsy — for a first-position match.
handed_off_pr() {
    for _kind in feat fix; do
        _pr=$(gh pr list --state all --head "$_kind/issue-$1" --limit 5 \
            --json number,state,labels \
            --jq '[.[] | select(.state == "MERGED" or (.state == "OPEN" and any(.labels[]; .name == "ready-to-land")))][0].number // empty') ||
            return 1
        if [ -n "$_pr" ]; then
            echo "$_pr"
            return 0
        fi
    done
}

read_green_sha() {
    if [ -f "$GREEN_SHA_FILE" ]; then
        cat "$GREEN_SHA_FILE"
    else
        echo ""
    fi
}

# A fresh session id per pass (issue #4722): the pass runs as
# `claude -p --session-id <uuid>`, so its transcript is exactly
# `~/.claude/projects/<slug>/<uuid>.jsonl` — no mention-count heuristic, no
# guessing which of the day's transcripts a pass wrote. The same id goes in
# the pass-START tag (the terminal's status line reads the transcript off it)
# and in the log row. Lower-case, and validated: `claude` refuses anything that
# is not a UUID, and a malformed id in the row would be a binding to nothing.
# Empty output when neither source is there — the caller stops the run rather
# than run a pass it cannot bind.
new_session_id() {
    _sid=$({ uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null; } | tr 'A-F' 'a-f' | tr -d '\n')
    if printf '%s' "$_sid" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
        printf '%s' "$_sid"
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
        echo "loop-drain[warn]: claims-held discriminator unavailable (bun -e lib/loop-status failed) — falling back to no-progress" >&2
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
#
# AND IT LANDS NOTHING UNDER --dry-run. That flag's whole contract is that a
# run makes no changes anywhere — the pass itself is only echoed, never
# executed — so a sweep that reached the board's label write would be the one
# mutation a dry run performed, which is a surprise however correct the verdict
# behind it was. The guard reuses loop-doctor's OWN safe-by-default mode rather than
# inventing a third convention: without `--release` it does exactly the same
# reads and prints exactly the same per-claim verdicts, and edits no label
# (loop-doctor.ts: "SAFE BY DEFAULT: reports and releases nothing"). So a dry
# run still SHOWS the operator what a real run would reclaim — the same shape
# as the `[dry-run] pass N would run: …` echo below — while writing nothing.
reap_orphan_claims() {
    _doctor="$SCRIPT_DIR/loop-doctor.ts"
    if [ ! -f "$_doctor" ]; then
        echo "loop-drain[warn]: orphan-claim sweep skipped — $_doctor not found." >&2
        return 0
    fi
    # Empty vs `--release`, expanded UNQUOTED so the empty case contributes no
    # argument at all (same idiom as $CLAUDE_ARGS at the call site below).
    if [ "$DRY_RUN" -eq 1 ]; then
        _reap_flag=""
        _reap_label="[dry-run] orphan-claim sweep (report-only, nothing released)"
    else
        _reap_flag="--release"
        _reap_label="orphan-claim sweep"
    fi
    # shellcheck disable=SC2086
    if _reap_out=$(bun "$_doctor" $_reap_flag 2>&1); then
        printf 'loop-drain[sweep]: %s —\n%s\n' "$_reap_label" "$_reap_out" >&2
    else
        # Never silent: a janitor that stops running without saying so is how
        # the prose version of this rule failed in the first place.
        echo "loop-drain[warn]: $_reap_label FAILED (bun loop-doctor.ts $_reap_flag) — continuing without it." >&2
        printf '%s\n' "$_reap_out" >&2
    fi
    return 0
}

# ── pre-flight: WHICH issue, on WHICH tier (#3083) ──────────────────────────
# `/next-ticket` §0 will pick its own issue when handed none, and §1 will STOP
# the pass when the issue carries a `model:*` label above the session's tier.
# Unattended, that combination is a wall rather than a stall: the stopped pass
# claims nothing, so the same issue is still at the head next pass, and the run
# dies on the no-progress streak with the queue untouched. 47 of the 233 open
# `ready-for-agent` issues carry `model:opus` — a 20% chance per drain, not an
# edge case.
#
# So the driver resolves the head BEFORE spawning and hands the pass both
# facts: the issue number in the prompt, the tier as `--model`. Two
# consequences beyond unblocking the drain: the pass no longer pays for the
# queue read inside the model's context, and the tier is now decided by the
# label rather than by whatever tier the operator happened to launch.
#
# It resolves nothing else. Review routing is untouched and must stay so — the
# reviewer is a subagent with its own explicit `model`, and escalating above
# the session tier already works (`/next-ticket` §4; the telemetry records
# sonnet-main sessions spawning opus reviewers).
#
# `--exclude-hitl` (#3088). An HITL issue asks for a human to look before it
# merges; an unattended pass ends in `land`, which merges. So the driver does
# not "handle" that work carefully — it never considers it, and says so to the
# planner rather than growing a second, shell-side notion of eligibility here.
# An interactive `/next-ticket` passes no such flag and still sees them.
#
# CONSUMED, NOT REIMPLEMENTED. The ordering (priority BAND inherited from the
# parent PRD, then own priority, then bugs, then oldest lineage), the
# eligibility filter and the label→tier resolution all
# belong to `queue:plan`; this reads `batch[0]` off its plan and nothing
# more. The read goes through
# `bun -e` rather than a `grep -o` on the JSON because the plan's OTHER arrays
# (`deferred`, `skipped`) carry `number` fields too — a first-match scan
# silently returns a DEFERRED issue's number the moment the batch is empty,
# which is precisely when it must return nothing.
#
# FATAL, unlike the orphan-claim sweep — and this is the one place that trade
# goes the other way (#3088). A pass handed the bare prompt picks its own
# issue, and `/next-ticket` knows nothing about HITL: it would implement an
# HITL-flagged issue and then `land` it, merging the very thing the flag
# exists to hold for a human. So "the planner could not answer" must not
# degrade into "run something anyway". It stops the run, next to `gh-error`,
# which already stops it for the strictly milder failure of not being able to
# COUNT the queue. A safety that yields the moment it is inconvenient is not
# a safety.
#
# RESUME BEFORE NEW WORK (issue #4763). A pass that pushed its branch or
# opened its PR and then ended its turn waiting on a background job dies with
# the turn (`claude -p`), leaving a `stranded` claim: owner gone, work pushed,
# usually one `land` away. A pass that died before pushing leaves a
# `recoverable` claim — its local branch, maybe uncommitted WIP in its
# worktree (issue #5174). The plan names both as `resume`, band-ordered,
# and the head is `resume[0]` before `batch[0]` — handed to a fresh pass as
# `/next-ticket N --resume`, not landed here: the observed recoveries needed
# `oracle:compile --carry-bot`, a catalogue repack and a gold fixup after the
# rebase, which is judgment a pass has and this script does not. BOUNDED to
# one resume per issue per run (`RESUMED_THIS_RUN`): a stranded issue whose
# resume also died is skipped thereafter — `loop:doctor` keeps naming it on
# every sweep — so one wedged PR cannot eat the whole run.
#
# REPAIR BEFORE RESUME (issue #5469): a PR the land-runner labelled
# `land-failed` is `plan.repair`, taken before `resume[0]` and handed off the
# same way (`pr:<N>` → `/next-ticket N --resume`), under the same one-per-run
# bound.
#
# NEVER A RUNNING LANE'S ISSUE (issue #5486). A pass claims its issue a minute
# or so after it starts; until then the plan still offers it. So every pick
# skips the issues this driver's running passes hold (`busy_issues`), and the
# plan is asked for one more batch item per running lane. A pick that still
# collides — another machine, a hand session — meets `queue:claim`'s lock,
# which refuses the second claim outright.
#
# NEVER AN ISSUE A PASS LEFT UNTOUCHED (issue #5564). A pass that ends with no
# claim, no PR, and its issue still `ready-for-agent` and unclaimed has judged
# it work no agent can land (owner-only installs, an unreachable host) — and
# the next plan offers it again at the head, so two such passes stop the run
# on `no-progress` with other eligible work still queued. Such an issue joins
# `EXCLUDED_THIS_RUN` (see `finish_lane`): every later pick skips it, and the
# plan is asked for one more batch item per exclusion. When nothing but
# excluded issues is left, the run stops on `no-progress` — the queue
# genuinely has no other head (`RESOLVED_EXHAUSTED`).
RESOLVED_ISSUE=""
RESOLVED_MODEL=""
RESOLVED_RESUME=""
RESOLVED_EXHAUSTED=0
RESUMED_THIS_RUN=""
EXCLUDED_THIS_RUN=""
resolve_head() {
    RESOLVED_ISSUE=""
    RESOLVED_MODEL=""
    RESOLVED_RESUME=""
    RESOLVED_EXHAUSTED=0
    # stderr goes to a FILE, never into `$_plan`: `bun run <script>` prints a
    # `$ bun scripts/… ` banner on stderr, and folding that into the captured
    # stdout makes the JSON unparseable — a real dry run against a 230-issue
    # queue resolved nothing at all for exactly this reason. Only stdout is
    # the plan.
    _plan_cap=$((1 + $1))
    for _x in $EXCLUDED_THIS_RUN; do _plan_cap=$((_plan_cap + 1)); done
    _plan_err=$(mktemp)
    if ! _plan=$(bun run queue:plan --cap "$_plan_cap" --exclude-hitl 2>"$_plan_err"); then
        echo "loop-drain[error]: pre-flight FAILED (bun run queue:plan --cap $_plan_cap --exclude-hitl) — STOPPING. A pass handed the bare prompt picks its own issue and knows nothing about HITL, so it could implement and merge work reserved for a human (#3088)." >&2
        cat "$_plan_err" >&2 || true
        rm -f "$_plan_err"
        return 1
    fi
    rm -f "$_plan_err"
    # `bun -e` reads the plan off the environment, never argv: a plan is
    # multi-KB of JSON with quotes in it, and interpolating that into a shell
    # word is how a quoting bug becomes an arbitrary-command bug.
    # Third word: `new`, or `pr:<N>` / `branch` / `local` for a resume (see
    # above).
    _head=$(LOOP_PLAN="$_plan" LOOP_RESUMED="$RESUMED_THIS_RUN" LOOP_BUSY="$(busy_issues)" LOOP_EXCLUDED="$EXCLUDED_THIS_RUN" bun -e '
const plan = JSON.parse(process.env.LOOP_PLAN || "{}");
const ids = (v) => new Set((v || "").split(/\s+/).filter(Boolean).map(Number));
const done = ids(process.env.LOOP_RESUMED);
const busy = ids(process.env.LOOP_BUSY);
const excluded = ids(process.env.LOOP_EXCLUDED);
const ok = (x) => x && Number.isInteger(x.number) && typeof x.model === "string" && x.model !== "" && !busy.has(x.number) && !excluded.has(x.number);
const repair = (plan.repair || []).find((x) => ok(x) && Number.isInteger(x.pr) && !done.has(x.number));
const resume = (plan.resume || []).find((x) => ok(x) && !done.has(x.number));
const head = (plan.batch || []).find(ok);
if (repair) {
    process.stdout.write(repair.number + " " + repair.model + " pr:" + repair.pr);
} else if (resume) {
    process.stdout.write(resume.number + " " + resume.model + " " + (Number.isInteger(resume.pr) ? "pr:" + resume.pr : resume.state === "recoverable" ? "local" : "branch"));
} else if (head) {
    process.stdout.write(head.number + " " + head.model + " new");
} else if ((plan.batch || []).some((x) => x && excluded.has(x.number))) {
    process.stdout.write("exhausted");
}
' 2>/dev/null) || _head=""
    if [ "$_head" = "exhausted" ]; then
        echo "loop-drain[warn]: no eligible head left but the issues this run excluded (${EXCLUDED_THIS_RUN# }) — stopping on no-progress." >&2
        RESOLVED_EXHAUSTED=1
        return 1
    fi
    if [ -z "$_head" ]; then
        echo "loop-drain[error]: pre-flight resolved no ELIGIBLE head issue from the plan — stopping rather than letting a pass pick for itself." >&2
        return 1
    fi
    RESOLVED_ISSUE=${_head%% *}
    _rest=${_head#* }
    RESOLVED_MODEL=${_rest%% *}
    _kind=${_rest#* }
    if ! is_uint "$RESOLVED_ISSUE" || [ -z "$RESOLVED_MODEL" ] ||
        [ "$_kind" = "$_rest" ]; then
        echo "loop-drain[error]: pre-flight returned an unusable head ('$_head') — stopping rather than letting a pass pick for itself." >&2
        RESOLVED_ISSUE=""
        RESOLVED_MODEL=""
        return 1
    fi
    [ "$_kind" = "new" ] || RESOLVED_RESUME="$_kind"
    return 0
}

# A stated budget and a spendable budget must never be different numbers
# without the output saying so (issue #3699) — `--max-pct` is a multiplier on
# the declared budget, and for a year it was silently 0.8.
#
# Output tags (ADR 0147). The lines the AFK terminal structures carry a
# bracketed tag after the source — `loop-drain[<tag>]: <message>` — from a
# CLOSED set: run (banner), warn, error, pass (pass start), end (pass end),
# sweep, summary. `scripts/lib/loop-render.ts` classifies by that tag and
# never by the message text, so a message may be reworded freely; a line with
# no tag renders as plain chatter. A new tag is a change to DRIVER_TAGS there.
CEILING="-"
if [ "$BUDGET_ENABLED" -eq 1 ]; then
    CEILING=$(awk -v b="$BUDGET" -v m="$MAX_PCT" 'BEGIN { printf "%.0f", b * m / 100 }')
    echo "loop-drain[run]: run $RUN_ID — budget ${BUDGET} weighted tokens, --max-pct ${MAX_PCT}% ⇒ effective ceiling ${CEILING} tokens, counted from this launch over this run's own passes only." >&2
fi

if [ "$START_DELAY" -gt 0 ]; then
    echo "loop-drain: waiting ${START_DELAY}s before the first pass (handoff grace period)." >&2
    interruptible_sleep "$START_DELAY" || {
        echo ""
        echo "loop-drain[summary]: passes=0 reason=stop-file queue_start=? queue_end=? final_pct=n/a spent=0 budget=${BUDGET:-n/a} ceiling=${CEILING}"
        exit 0
    }
fi

pass=0
# The run's spend so far, in weighted tokens — MONOTONIC by contract. The
# reading is already monotonic by construction (a fixed left edge, a growing
# set of the run's own transcripts), and this high-water mark says so out loud:
# a transcript compacted or rewritten under us, or a `sessions.jsonl` row that
# has not landed yet, could otherwise make a budget go DOWN, which is the
# property whose absence let a run burn past its ceiling for eight hours.
spent="0"
no_progress_streak=0
error_streak=0
claims_held_streak=0
# Unattended repairs this run attempted (step 2b, issue #5589) — bounded by
# `LOOP_FIX_ATTEMPTS` inside `health:fix --plan`, which reads this count.
fix_attempts=0
FIX_WAIT_SECS="${TOLARIA_LOOP_FIX_WAIT_SECS:-300}"
# One string field of `health:status --json`'s flat one-line JSON (issue
# #5462) — values carry no quotes, `health-main` strips them.
_health_field() {
    printf '%s' "$_health_json" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -n 1
}

# Tell the owner something stopped the loop that a human must look at (the
# SECOND RED, issue #5462). `TOLARIA_NOTIFY_CMD` (run with the message as
# `$1`) wins; else the desktop's own notifier where there is one. Never
# fatal: a notification that cannot be shown leaves the log line.
notify_owner() {
    if [ -n "${TOLARIA_NOTIFY_CMD:-}" ]; then
        sh -c "$TOLARIA_NOTIFY_CMD" notify "$1" || true
    elif command -v osascript >/dev/null 2>&1; then
        osascript -e "display notification \"$1\" with title \"loop-drain\"" >/dev/null 2>&1 || true
    elif command -v notify-send >/dev/null 2>&1; then
        notify-send -u critical "loop-drain" "$1" >/dev/null 2>&1 || true
    fi
}

stop_reason=""
pct="n/a"
first_queue_count=""
last_queue_count=""

# ── the lanes' run state (issue #5486) ──────────────────────────────────────
# DRAIN_REASON: a stop was decided — no pass starts again, the running ones
#   finish (each still writes its row), and the run ends on this reason once
#   none is left. A stop is one decision for the whole run: a rate limit in
#   one lane is the account's (one account, every lane), RED is the base's.
# HOLD: a refusal that may lift when a running pass ends (an empty queue, a
#   plan at the cap or with nothing a running lane is not already doing). With
#   no pass running the same refusal is final, exactly as it was with one lane.
# NEXT_START_AT: a crash backoff holds every lane's NEXT start, not only the
#   crashed lane's.
DRAIN_REASON=""
HOLD=0
NEXT_START_AT=0
LANE_TARGET=""
LANE_PROBED_AT=0
LANE_DIRTY=1
LANES_SEEN=0

# How many passes may be alive now. One lane asks nobody. Above it, the
# machine admission (`bun scripts/machine.ts lanes`, `laneCap`): the RAM's
# effective cap under `sessions.cap` and `--lanes`, each running lane charged
# the budget it has yet to take, one lane while load or memory pressure is
# over its threshold. Re-asked after every pass start and
# end, and every LANE_RECHECK_SECS while nothing moves. An unreadable answer
# is one lane — the probe may only ever hold the driver back.
refresh_lane_target() {
    if [ "$LANES" = "1" ]; then
        LANE_TARGET=1
        return 0
    fi
    _now=$(date +%s)
    if [ "$LANE_DIRTY" -eq 0 ] && [ -n "$LANE_TARGET" ] &&
        [ $((_now - LANE_PROBED_AT)) -lt "$LANE_RECHECK_SECS" ]; then
        return 0
    fi
    LANE_DIRTY=0
    LANE_PROBED_AT=$_now
    _max_arg=""
    [ "$LANES" = "auto" ] || _max_arg="--max $LANES"
    # The running passes' own pids: a lane is charged its budget less what
    # its tree already holds, so a pass started seconds ago still counts in
    # full (`laneCharge`).
    _pids=$(for _o in $(own_lanes); do lane_get "$_o" pass.pid; done | tr '\n' ',' | sed 's/,$//')
    # shellcheck disable=SC2086  # `--max N` or nothing, by design
    _out=$(bun "$SCRIPT_DIR/machine.ts" lanes --running "$1" --pids "$_pids" $_max_arg 2>/dev/null) || _out=""
    _n=${_out%% *}
    if is_uint "$_n" && [ "$_n" -ge 1 ]; then
        _why=${_out#"$_n"}
        _why=${_why# }
    else
        _n=1
        _why="the admission probe did not answer"
    fi
    if [ "$_n" != "$LANE_TARGET" ]; then
        echo "loop-drain: lanes ${_n} (${_why:-the ceiling}) — ${1} running." >&2
    fi
    LANE_TARGET=$_n
    return 0
}

# Block until something may have changed: one lane waits on its job; several
# look again after a tick (POSIX `wait` cannot wait for "any one of them").
wait_tick() {
    if [ "$1" -gt 0 ] && [ "$LANES" = "1" ]; then
        _p=$(lane_get "$(own_lanes | head -n 1)" pid)
        if is_uint "$_p"; then
            wait "$_p" 2>/dev/null || true
            return 0
        fi
    fi
    sleep "$LANE_TICK_SECS"
    return 0
}

# A refusal before a start: final with nothing running, a HOLD otherwise.
refuse_start() {
    if [ "$running" -gt 0 ]; then
        HOLD=1
        echo "loop-drain: no new pass for now (${1}) — ${running} running; looking again when one ends." >&2
    else
        DRAIN_REASON="$1"
    fi
    return 0
}

# Issue N as an overlapped pass's verdict reads it: `<state> <claimed>
# <ready>` — e.g. `OPEN true true` — empty when unread. `any(...)`, never
# `index(...)` (falsy at position 0).
issue_state() {
    gh issue view "$1" --json state,labels \
        --jq '[.state, (any(.labels[]; .name == "in-progress") | tostring), (any(.labels[]; .name == "ready-for-agent") | tostring)] | join(" ")' 2>/dev/null || true
}

# ── start one pass in lane `$lane` (background) ─────────────────────────────
start_pass() {
    pass=$((pass + 1))
    # `mkdir` without `-p` is the claim: it fails on a lane another driver
    # over this checkout (a hand-run `loop:drain`) took a moment ago.
    lane=1
    until mkdir "$LANE_DIR/$lane" 2>/dev/null; do lane=$((lane + 1)); done
    lane_put "$lane" driver "$$"
    # OVERLAP: a pass that ran beside another cannot read its outcome off the
    # queue-wide counts — another lane's landing would move them. It is read
    # off its own issue instead (see `finish_lane`). Both sides are marked.
    if [ "$running" -gt 0 ]; then
        for _o in $(own_lanes); do lane_put "$_o" overlap 1; done
    fi
    _lane_word=""
    [ "$LANES" = "1" ] || _lane_word=" — lane $lane"
    # The pass-START tag: the renderer opens the pass's header rule on it, so
    # the override path announces its pass too, naming the prompt it owns.
    # `session=<uuid>` is a trailing `k=v` word on both forms: the status line
    # reads the pass's transcript off it (issue #4722).
    if [ "$PROMPT_OVERRIDDEN" -eq 1 ]; then
        echo "loop-drain[pass]: pass $pass — prompt \"$pass_prompt\". session=$pass_session" >&2
    else
        echo "loop-drain[pass]: pass ${pass}${_lane_word} — issue #${RESOLVED_ISSUE} on tier ${RESOLVED_MODEL}. session=$pass_session" >&2
    fi
    epoch=$(date +%s)
    pass_log="$LOG_DIR/pass-${pass}-lane-${lane}-${epoch}.log"
    lane_put "$lane" pass "$pass"
    lane_put "$lane" issue "$RESOLVED_ISSUE"
    # A resume or repair pick starts on an issue already claimed (its dead
    # pass's claim): an overlapped pass's claims-held reading starts there.
    _claimed_before=0
    [ -z "$RESOLVED_RESUME" ] || _claimed_before=1
    lane_put "$lane" claimed_before "$_claimed_before"
    lane_put "$lane" model "$RESOLVED_MODEL"
    lane_put "$lane" session "$pass_session"
    lane_put "$lane" epoch "$epoch"
    lane_put "$lane" log "$pass_log"
    lane_put "$lane" queue_before "$queue_before"
    lane_put "$lane" green_before "$(read_green_sha)"
    lane_put "$lane" total_before "$(count_total_open 2>/dev/null || true)"
    # Unread (gh failed) is not "no PR": an existing PR would then read as a
    # new hand-off after the pass. No before-reading, no PR progress.
    _pr_before=""
    _pr_before_ok=0
    if [ -n "$RESOLVED_ISSUE" ] &&
        _pr_before=$(handed_off_pr "$RESOLVED_ISSUE" 2>/dev/null); then
        _pr_before_ok=1
    fi
    lane_put "$lane" pr_before "$_pr_before"
    lane_put "$lane" pr_before_ok "$_pr_before_ok"
    rc_file="$LANE_DIR/$lane/rc"
    done_file="$LANE_DIR/$lane/done"

    if [ "$DRY_RUN" -eq 1 ]; then
        # Echo the command as it will actually be typed. `$pass_model_arg` is
        # empty on the override path, and interpolating an empty variable
        # between two words leaves a double space — which the real invocation
        # never has (the shell collapses it), so an echo that showed one would
        # be a dry run of a command nobody runs.
        if [ -n "$pass_model_arg" ]; then
            _dry_claude="claude $pass_model_arg --session-id $pass_session -p"
        else
            _dry_claude="claude --session-id $pass_session -p"
        fi
        echo "loop-drain: [dry-run] pass $pass would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 $_dry_claude \"$pass_prompt\" $CLAUDE_ARGS" >&2
        (
            : >"$pass_log"
            echo 0 >"$rc_file"
            : >"$done_file"
        ) &
    else
        # The pass runs as a background JOB so other lanes can run beside it;
        # with one lane the driver `wait`s on it straight away. Its output goes
        # to the terminal only with one lane: several would interleave
        # untagged lines under each other's headers — the pass log keeps it. A pipeline's
        # exit status in POSIX sh is the LAST command's (tee), not claude's —
        # claude's real exit code goes to the lane's rc file (no PIPESTATUS in
        # POSIX sh). `done` is the job's last act: the pass is over.
        (
            set +e
            (
                # TOLARIA_LOOP_DRAIN marks the pass as ALREADY driven: the
                # skill's end-of-pass handoff (scripts/loop-handoff.sh) no-ops
                # on it, so a driver-launched pass never detaches a second
                # driver. Without it, every pass would fork its own driver and
                # the fan-out would be exponential, not sequential.
                #
                # CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 disables `claude -p`'s
                # own background-wait ceiling (default 600000ms/600s — the CLI
                # terminates any still-running background tasks once print
                # mode's main turn ends and this ceiling elapses). Verified
                # against the installed CLI bundle (2.1.237): the ceiling check
                # is `XS>0 && ...` where `XS` is this env var (falling back to
                # the 600000 default via `??`) — `0` makes that comparison
                # always false, so the sweep never fires, matching the CLI's
                # own stderr message ("Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
                # to wait indefinitely."). A pass is already bounded by this
                # driver's own budget/pct ceilings (see the guard below) — a
                # wall-clock cutoff on background subagents is not one of them
                # (#2622); it killed subagents mid-edit (18 of ~34 recorded
                # passes on 2026-08-19).
                # "$pass_prompt" stays QUOTED — it is ONE argument that
                # normally contains spaces ("/next-ticket 3083", or an
                # operator's "/process-gh-issues figli di 2405"); splitting it
                # is the exact opposite of what the unquoted $pass_model_arg
                # and $CLAUDE_ARGS beside it deliberately do.
                # shellcheck disable=SC2086  # intentional word-splitting of
                # the resolved tier flag and of a user-supplied flag string,
                # both documented above.
                #
                # The `sh -c … exec` wrapper records its own pid in the lane's
                # `pass.pid` and then BECOMES `claude` (exec keeps the pid):
                # the pid the driver signals when it is itself interrupted
                # (`stop_lanes`).
                TOLARIA_LOOP_DRAIN=1 TOLARIA_LOOP_RUN_ID="$RUN_ID" CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 \
                    sh -c 'echo $$ >"$1" 2>/dev/null; shift; exec "$@"' \
                    pass "$LANE_DIR/$lane/pass.pid" \
                    claude $pass_model_arg --session-id "$pass_session" -p "$pass_prompt" $CLAUDE_ARGS 2>&1
                echo $? >"$rc_file"
            ) | if [ "$LANES" = "1" ]; then tee "$pass_log"; else cat >"$pass_log"; fi
            : >"$done_file"
        ) &
    fi
    lane_put "$lane" pid "$!"
    LANE_DIRTY=1
    _now_running=$(running_lanes)
    [ "$_now_running" -le "$LANES_SEEN" ] || LANES_SEEN=$_now_running
    return 0
}

# ── account for one finished pass, then free its lane ───────────────────────
finish_lane() {
    _k="$1"
    _job=$(lane_get "$_k" pid)
    if is_uint "$_job"; then wait "$_job" 2>/dev/null || true; fi
    lpass=$(lane_get "$_k" pass)
    lissue=$(lane_get "$_k" issue)
    epoch=$(lane_get "$_k" epoch)
    pass_log=$(lane_get "$_k" log)
    pass_session=$(lane_get "$_k" session)
    lqueue_before=$(lane_get "$_k" queue_before)
    green_before=$(lane_get "$_k" green_before)
    total_before=$(lane_get "$_k" total_before)
    pr_before=$(lane_get "$_k" pr_before)
    pr_before_ok=$(lane_get "$_k" pr_before_ok)
    overlap=$(lane_get "$_k" overlap)
    claimed_before=$(lane_get "$_k" claimed_before)
    claude_exit=$(lane_get "$_k" rc)
    # If the job died before it could write its rc (killed, crashed before
    # `echo $?` ran), default to a generic non-zero code rather than leaving
    # claude_exit empty — an empty field breaks the 7-field log-line invariant
    # and `[ "" -ne 0 ]` errors under `-eu`.
    is_uint "$claude_exit" || claude_exit=1
    rm -rf "${LANE_DIR:?}/$_k"
    LANE_DIRTY=1
    HOLD=0

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
    # A pass ends at push + `ready-to-land` (issue #5469): the PR it handed
    # off is its progress, and the summary reports the PR, not a landing.
    pr_progress=0
    # An overlapped pass's own issue: closed, or out of the queue, is its
    # landing (a docs PR on another branch, "already fixed" closed by hand).
    _own_state=""
    if [ "$overlap" = "1" ] && [ -n "$lissue" ]; then
        _own_state=$(issue_state "$lissue")
        case "$_own_state" in
            "" | "OPEN "*" true") ;;
            *) pr_progress=1 ;;
        esac
    fi
    if [ "$pr_before_ok" = "1" ]; then
        pr_after=$(handed_off_pr "$lissue" 2>/dev/null) || pr_after=""
        if is_uint "$pr_after" && [ "$pr_after" != "$pr_before" ]; then
            pr_progress=1
            echo "loop-drain[pr]: pass $lpass — issue #${lissue} handed off as PR #${pr_after} (ready-to-land; the land-runner merges it)" >&2
        fi
    fi
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
    if [ "$BUDGET_ENABLED" -eq 1 ]; then
        spent_field="$spent"
        budget_field="$BUDGET"
    else
        spent_field="-"
        budget_field="-"
    fi
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
    elif [ "$pr_progress" -eq 0 ] && { [ "$overlap" = "1" ] ||
        { [ "$total_after" = "$total_before" ] &&
            [ "$green_after" = "$green_before" ]; }; }; then
        # 6. no PR handed off (issue #5469) and neither the TOTAL open ready-for-agent count nor main's tip
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
        #
        # A pass that ran BESIDE another lane (issue #5486) has no such
        # window of its own: the other lane's claims and landings move the
        # very counts. Its progress is its own issue's — a hand-off, or the
        # issue closed or out of the queue (above) — and its claim is its own
        # issue's label: before = unclaimed, or claimed for a resume/repair
        # pick; after = what the label says now — fed to the same verdict
        # engine.
        claims_held_now=0
        if [ "$overlap" = "1" ]; then
            _claimed_after=0
            case "$_own_state" in
                "OPEN true "*) _claimed_after=1 ;;
            esac
            if [ "$(claims_held_check "${claimed_before:-0}" "$_claimed_after" 0)" = "true" ]; then
                claims_held_now=1
            fi
        else
            claims_before=""
            claims_after=""
            if is_uint "$total_before" && is_uint "$lqueue_before"; then
                claims_before=$((total_before - lqueue_before))
            fi
            if is_uint "$total_after" && is_uint "$queue_after"; then
                claims_after=$((total_after - queue_after))
            fi
            if is_uint "$claims_before" && is_uint "$claims_after"; then
                if [ "$(claims_held_check "$claims_before" "$claims_after" 0)" = "true" ]; then
                    claims_held_now=1
                fi
            fi
        fi
        # A death is not "ran and found nothing", so it must not feed the
        # no-progress streak either — `no-progress` means "genuinely nothing to
        # do" wherever it is read (the glossary, the dashboard's pass outcome),
        # and two deaths either side of one quiet pass must not add up to it.
        if [ "$claims_held_now" -eq 1 ]; then
            no_progress_streak=0
            # A fault, and still reported on the pass that produced it — but
            # no longer a stop on the FIRST occurrence (issue #3698). It is a
            # CONSECUTIVE streak, bounded by MAX_CONSECUTIVE_CLAIMS_HELD and
            # reset below by any pass that does not die this way, exactly like
            # the crash streak above. `claims-held-retry` is the per-pass
            # reason while the streak is still under its bound (mirroring
            # `claude-retry`); `claims-held` remains the reason the RUN stops
            # on, so the morning's summary still says "died holding claims"
            # rather than "nothing to do".
            #
            # No backoff. A crash retries after a doubling sleep because the
            # thing that failed may be a rate-limited API or a wedged
            # machine; a pass that died holding claims failed for a reason
            # the next pass actively repairs — `reap_orphan_claims` runs
            # before it and hands back what the dead pass was holding —
            # so sleeping would only defer the repair.
            claims_held_streak=$((claims_held_streak + 1))
            if [ "$MAX_CONSECUTIVE_CLAIMS_HELD" -eq 0 ] ||
                [ "$claims_held_streak" -ge "$MAX_CONSECUTIVE_CLAIMS_HELD" ]; then
                reason_field="claims-held"
                stop_now=1
            else
                reason_field="claims-held-retry"
                echo "loop-drain[warn]: pass $lpass died holding claims (consecutive ${claims_held_streak}/${MAX_CONSECUTIVE_CLAIMS_HELD}) — the next pass reaps the orphaned claim and continues." >&2
            fi
        else
            # Its issue untouched — still open, unclaimed, `ready-for-agent`
            # — is the pass's verdict that no agent can land it (issue
            # #5564, see `resolve_head`): excluded for the rest of the run,
            # and the streak is left as it stands, since the next pass works
            # a DIFFERENT head. Read here unless the overlap branch already
            # read it.
            _left_state="$_own_state"
            if [ -n "$lissue" ] && [ "$overlap" != "1" ]; then
                _left_state=$(issue_state "$lissue")
            fi
            if [ -n "$lissue" ] && [ "$_left_state" = "OPEN false true" ] &&
                ! printf ' %s ' "$EXCLUDED_THIS_RUN" | grep -q " $lissue "; then
                EXCLUDED_THIS_RUN="$EXCLUDED_THIS_RUN $lissue"
                echo "loop-drain[warn]: pass $lpass left issue #${lissue} unclaimed and still ready-for-agent — excluding it for the rest of this run (owner work → relabel it ready-for-human; blocked → wire blocked-by)." >&2
            else
                no_progress_streak=$((no_progress_streak + 1))
                if [ "$no_progress_streak" -ge 2 ]; then
                    reason_field="no-progress"
                    stop_now=1
                fi
            fi
        fi
    else
        no_progress_streak=0
    fi

    # Any pass that did not crash clears the crash streak — bounded
    # CONSECUTIVELY, not cumulatively (see the comment above).
    [ "$claude_errored" -eq 1 ] || error_streak=0

    # The claims-held streak is cleared by PROGRESS, and by nothing else.
    # "Any pass that is not a death" would be the obvious mirror of the crash
    # streak above and is wrong here, because the two streaks would then clear
    # each other: a run alternating crash / death-holding-claims resets both
    # every pass and never reaches either bound, and with MAX_PASSES defaulting
    # to unlimited that run does not terminate. Progress — a real landing, the
    # `-` reason — is the one event that proves the loop is still getting
    # somewhere, so it is the one event that forgives a death.
    case "$reason_field" in
        -) claims_held_streak=0 ;;
    esac

    # 9. one line per pass:
    #   epoch pass claude_exit pct queue_before queue_after spent budget session reason
    #
    # `spent`/`budget` are new (issue #3699) and sit BEFORE the reason, not
    # after it: `reason` is the LAST field by contract — every reader in this
    # repo, and every test, takes it with a `split(" ").pop()` — so appending
    # there would have silently renamed the reason of every pass. `-` in both
    # when the guard is disabled, so the field count is fixed at 9 and a parser
    # can tell the old 7-field shape from this one by length alone.
    #
    # `session` (issue #4722) follows the same rule, one field later: the
    # pass's `--session-id`, BEFORE the reason, making the row 10 fields — a
    # parser tells 7, 9 and 10 apart by length alone, and the row binds the
    # pass to exactly one transcript. The lane is not a column: the session
    # binds the row to its pass log, whose name carries the lane.
    echo "$epoch $lpass $claude_exit $pct $lqueue_before $queue_after ${spent_field} ${budget_field} ${pass_session} $reason_field" >>"$LOG_FILE"
    # The pass-END tag (ADR 0147): the same facts as the row above, plus what
    # the row has no column for — the lane, the effective ceiling the footer's
    # spend bar is drawn against, the pass's wall duration and the retry
    # delay; `lane=` only on a multi-lane run, as the pass-START line. Emitted right after the row so the terminal footer can never
    # describe a pass the log does not have. `k=v` words, so the renderer
    # reads fields by name.
    _lane_kv=""
    [ "$LANES" = "1" ] || _lane_kv=" lane=$_k"
    echo "loop-drain[end]: pass=${lpass}${_lane_kv} exit=$claude_exit reason=$reason_field pct=$pct queue_before=$lqueue_before queue_after=$queue_after spent=${spent_field} budget=${budget_field} ceiling=${CEILING} duration=$(($(date +%s) - epoch)) retry=${backoff_secs}" >&2

    if [ "$stop_now" -eq 0 ] && [ "$backoff_secs" -gt 0 ]; then
        echo "loop-drain[error]: pass $lpass crashed (claude exit $claude_exit; consecutive failure ${error_streak}/${MAX_CONSECUTIVE_ERRORS}) — retrying in ${backoff_secs}s. Log tail:" >&2
        tail -n 20 "$pass_log" >&2
        # Every lane's next start waits it out, not only this one's.
        NEXT_START_AT=$(($(date +%s) + backoff_secs))
    fi

    if [ "$stop_now" -eq 1 ]; then
        # A pass's own stop outranks a benign drain decided while it ran
        # (max-passes reached by the lane beside it, a stop-file): with one
        # lane it was read first, and the summary still names the fault.
        case "$DRAIN_REASON" in
            "" | stop-file | max-passes | queue-empty | budget) DRAIN_REASON="$reason_field" ;;
        esac
        if [ "$reason_field" = "rate-limit" ] || [ "$reason_field" = "claude-error" ]; then
            # A usage limit is a pause to wait out (warn); a crash is a fault.
            _stop_tag=error
            [ "$reason_field" != "rate-limit" ] || _stop_tag=warn
            echo "loop-drain[${_stop_tag}]: ${reason_field} (claude exit $claude_exit) detected on pass $lpass — stopping. Log tail:" >&2
            tail -n 40 "$pass_log" >&2
        fi
        _left=$(running_lanes)
        if [ "$_left" -gt 0 ]; then
            echo "loop-drain[warn]: ${reason_field} on pass $lpass — no lane starts another pass; the ${_left} running finish first." >&2
        fi
    fi
    return 0
}

while :; do
    # 0. account for every pass that ended since the last look.
    for _k in $(own_lanes); do
        if lane_over "$_k"; then finish_lane "$_k"; fi
    done
    running=$(running_lanes)

    # A decided stop: nothing starts; the run ends once the last pass has.
    if [ -n "$DRAIN_REASON" ]; then
        if [ "$running" -eq 0 ]; then
            stop_reason="$DRAIN_REASON"
            break
        fi
        wait_tick "$running"
        continue
    fi

    # 1. stop-file — the user's kill switch for a run already in flight. A
    # pass in flight finishes; none starts after it.
    if [ -f "$STOP_FILE" ]; then
        DRAIN_REASON="stop-file"
        continue
    fi

    # A crash backoff, or a refusal waiting for a running pass to end.
    if [ "$HOLD" -eq 1 ] || [ "$(date +%s)" -lt "$NEXT_START_AT" ]; then
        wait_tick "$running"
        continue
    fi

    # 1b. room for another lane? With none running there always is — the
    # floor is one.
    if [ "$running" -gt 0 ]; then
        refresh_lane_target "$running"
        if [ "$running" -ge "$LANE_TARGET" ]; then
            wait_tick "$running"
            continue
        fi
    fi

    # 2. max-passes — shared by every lane: it counts passes STARTED.
    # MAX_PASSES is already validated numeric above, so this is a plain
    # comparison — no error-swallowing redirect needed.
    if [ "$MAX_PASSES" -gt 0 ] && [ "$pass" -ge "$MAX_PASSES" ]; then
        DRAIN_REASON="max-passes"
        continue
    fi

    # 2a. the local Convex backend (issue #4945). `check:ui`, the health
    # gate's `--all` walk and preset seeding all need it, and while AFK nobody
    # is there to type `bunx convex dev` after a sleep or a crash killed it —
    # health went RED at `check:ui` and the run stopped as `health-red`.
    # `convex:ensure` starts one ONLY when none answers and none is alive
    # (never a second); it is a no-op probe when the deployment answers.
    # Checked BEFORE the RED marker so a down backend is named as itself,
    # never folded into `health-red` or `no-progress`.
    if ! _convex_out=$(bun run convex:ensure 2>&1); then
        DRAIN_REASON="convex-down"
        echo "loop-drain[error]: the local Convex backend does not answer and 'bun run convex:ensure' could not start one — stopping. Its output:" >&2
        printf '%s\n' "$_convex_out" | tail -n 25 >&2
        continue
    fi

    # 2b. health RED — the batch full gate failed on the base tip and nobody
    # has fixed it. ADR 0110's green-main invariant: "A RED marker means
    # fix-forward FIRST — never stack unrelated work on a red tip." `land`
    # already refuses a non-repair PR, which is the right strength for a
    # human who can state `--red-ok`; unattended there is nobody to state it,
    # so the driver stops instead. Checked BEFORE the budget read and before
    # the orphan sweep, because a red tip means no pass should happen at all
    # — and reported as its own reason rather than folded into `no-progress`,
    # so the morning's log says what to fix.
    #
    # Read through the verdict store (issue #5462), via `health:status
    # --json`: the RED marker on the file backend, the base branch's `health`
    # commit statuses on the github one — a RED found on the OTHER machine
    # stops this loop too. An AMBER lineage (a proved repair landed) runs.
    # The SECOND RED — a red on an AMBER lineage, the repair did not hold —
    # stops with its own reason and notifies the owner. An unreadable store
    # is a warning, never a stop: a GitHub 502 must not end the night.
    _health_json=$(bun run --silent health:status --json 2>/dev/null) || true
    _lineage=$(_health_field lineage)
    # An unreadable store answers `none` WITH an error: name it, never as a
    # clean read.
    _h_error=$(_health_field error)
    [ -n "$_h_error" ] && _lineage="unreadable"
    _h_sha=$(_health_field sha)
    _h_step=$(_health_field step)
    _h_machine=$(_health_field machine)
    _h_log=$(_health_field log)
    _h_short=$(printf '%.8s' "$_h_sha")
    _h_detail="${_h_short} red at ${_h_step:-unknown step}${_h_machine:+ on ${_h_machine}}${_h_log:+ — log: ${_h_log}}"
    case "$_lineage" in
        second-red)
            DRAIN_REASON="health-second-red"
            echo "loop-drain[error]: SECOND RED on this lineage — a repair landed (AMBER) and the next health run found the base RED again: ${_h_detail}. Stopping; a broken repair must not loop unattended. Run 'bun run health:status'." >&2
            notify_owner "Tolaria: second RED on the base (${_h_short}, ${_h_step:-unknown step}) — loop stopped"
            continue
            ;;
        red)
            # The unattended repair (issue #5589): the RED's evidence is on
            # the pivot, so a fixer on THIS machine can diagnose a RED the
            # other one found. `health:fix --plan` decides from the attempt
            # record on that same pivot — ONE headless attempt per tip, at
            # most LOOP_FIX_ATTEMPTS per run; wait while a landed repair
            # awaits health on its own tip; stop on a stuck fixer, an attempt
            # that never finished, the bound, or a record it cannot read.
            _fix_plan=$(bun run --silent health:fix --plan "$_h_sha" --attempts "$fix_attempts" 2>/dev/null | tail -n 1) || true
            [ -n "$_fix_plan" ] || _fix_plan="stop: 'bun run health:fix --plan' gave no answer"
            case "$_fix_plan" in
                attempt)
                    fix_attempts=$((fix_attempts + 1))
                    echo "loop-drain: the base tip is RED (${_h_detail}) — attempting an unattended repair, ${fix_attempts} this run (issue #5589). Evidence:" >&2
                    bun run --silent health:status >&2 || true
                    # $CLAUDE_ARGS rides as ONE argument, split by health:fix
                    # as this driver splits it for its own passes.
                    if bun run --silent health:fix --headless "--claude-args=${CLAUDE_ARGS}" >&2; then
                        # Exit 0 is `landed` — or nothing left to fix by the
                        # time it looked; the next tick re-reads the verdict.
                        echo "loop-drain: health:fix finished clean for ${_h_short} (landed, or nothing left to fix) — re-reading the verdict and resuming" >&2
                    else
                        DRAIN_REASON="health-red"
                        echo "loop-drain[error]: the base tip is RED and the unattended repair did not land (stuck) — stopping; the RED stands. 'bun run health:status' shows the evidence and 'bun run health:fix' repairs it by hand. Verdict:" >&2
                        echo "  ${_h_detail}" >&2
                        notify_owner "Tolaria: RED base (${_h_short}, ${_h_step:-unknown step}) — unattended repair stuck, loop stopped"
                    fi
                    continue
                    ;;
                wait:*)
                    echo "loop-drain: the base tip is RED (${_h_detail}) — ${_fix_plan#wait: }; no pass until health answers" >&2
                    # Health takes ~40 min: look again in minutes, never every
                    # lane tick (each look is two GitHub reads).
                    if [ "$running" -gt 0 ]; then wait_tick "$running"; else sleep "$FIX_WAIT_SECS"; fi
                    continue
                    ;;
            esac
            DRAIN_REASON="health-red"
            echo "loop-drain[error]: the base tip is RED (the last release/health run found it red, ADR 0116) — stopping rather than stacking work on a red tip. Run 'bun run health:status' and fix forward. Verdict:" >&2
            echo "  ${_h_detail}" >&2
            echo "  no unattended repair: ${_fix_plan#stop: }" >&2
            notify_owner "Tolaria: RED base (${_h_short}, ${_h_step:-unknown step}) — no unattended repair, loop stopped"
            continue
            ;;
        infra)
            # 2c. health INFRA (issue #4943) — the last run proved nothing
            # about the tip (the machine slept, or the Convex backend did not
            # answer). Not a stop: the tip is unproven, not red.
            _h_reason=$(_health_field reason)
            echo "loop-drain[warn]: release health is INFRA (at ${_h_step:-unknown step}) — the tip is unproven, not red: ${_h_reason:-re-run 'bun run health'}" >&2
            ;;
        green | amber | none) ;;
        *)
            echo "loop-drain[warn]: the health verdict could not be read (${_h_error:-'bun run health:status --json' gave no lineage}) — running the pass; 'bun run health:status' says more" >&2
            ;;
    esac

    # 3. budget — a local proxy for relative burn, not a real quota reading
    # (see ADR 0097 and scripts/lib/usage-window.ts). FAILS CLOSED: a
    # non-zero exit, unparsable output, or a non-numeric/`null` pct all stop
    # the run with reason `usage-error` rather than silently skipping the
    # check and running the pass anyway. ONE budget for every lane: the
    # reading is the run's (`--run`), and every lane's pass carries the id.
    if [ "$BUDGET_ENABLED" -eq 1 ]; then
        # `--since` + `--run`, never `--hours`: this reads THIS run's own
        # spend from its own launch, not the machine's last five hours. See
        # RUN_ID above for why the two are not the same question.
        usage_json=$(bun run usage:window --since "$RUN_START_MS" --run "$RUN_ID" --budget "$BUDGET" 2>&1) && usage_rc=0 || usage_rc=$?
        pct=$(printf '%s' "$usage_json" | grep -o '"pct":[0-9.eE+-]*' | head -1 | cut -d: -f2)
        weighted=$(printf '%s' "$usage_json" | grep -o '"weighted":[0-9.eE+-]*' | head -1 | cut -d: -f2)
        # FAIL CLOSED FIRST, then account. The order matters: a reading the
        # guard is about to declare unreadable must not move the run's spend
        # on its way out, or the summary reports a figure the guard itself
        # just refused to trust (PR #3704 review).
        if [ "$usage_rc" -ne 0 ] || [ -z "$pct" ] || ! is_number "$pct"; then
            DRAIN_REASON="usage-error"
            pct="n/a"
            echo "loop-drain[error]: budget guard FAILED CLOSED — could not read a usable pct from 'bun run usage:window' (exit ${usage_rc}). This stops the run rather than skipping the check, per ADR 0097. Reader output was:" >&2
            printf '%s\n' "$usage_json" >&2
            continue
        fi
        # High-water mark, then derive the pct from it rather than trusting
        # the reader's — so the figure this guard compares, logs and reports
        # can only ever rise within a run.
        if is_number "${weighted:-}"; then
            spent=$(awk -v a="$spent" -v b="$weighted" 'BEGIN { print (b + 0 > a + 0) ? b : a }')
            pct=$(awk -v s="$spent" -v b="$BUDGET" 'BEGIN { if (b + 0 <= 0) { print 0 } else { print s * 100 / b } }')
        fi
        over=$(awk -v p="$pct" -v m="$MAX_PCT" 'BEGIN { print (p + 0 >= m + 0) ? 1 : 0 }')
        if [ "$over" -eq 1 ]; then
            DRAIN_REASON="budget"
            echo "loop-drain[warn]: budget guard tripped — run $RUN_ID has spent ${spent} of ${BUDGET} weighted tokens (${pct}%) >= --max-pct ${MAX_PCT}%." >&2
            continue
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
        echo "loop-drain[error]: could not read the ready-for-agent queue count via gh — stopping." >&2
        refuse_start "gh-error"
        continue
    fi
    [ -n "$first_queue_count" ] || first_queue_count="$queue_before"
    last_queue_count="$queue_before"
    if [ "$queue_before" -eq 0 ]; then
        refuse_start "queue-empty"
        continue
    fi

    # 4b. resolve WHICH issue and WHICH tier, unless the operator named the
    # prompt (see PASS_PROMPT above — an override owns the whole invocation,
    # including responsibility for what it selects). Before the pass counter
    # moves, so a failure stops the run without booking a phantom pass.
    # `pass_model_arg` is EITHER empty or the two words `--model <tier>`, and
    # is expanded UNQUOTED at the call site for exactly that reason — same
    # idiom as $CLAUDE_ARGS, and the same reason "$pass_prompt" stays quoted.
    pass_prompt="$PASS_PROMPT"
    pass_model_arg=""
    RESOLVED_ISSUE=""
    RESOLVED_MODEL=""
    if [ "$PROMPT_OVERRIDDEN" -eq 0 ]; then
        if resolve_head "$running"; then
            pass_prompt="$PASS_PROMPT $RESOLVED_ISSUE"
            pass_model_arg="--model $RESOLVED_MODEL"
            if [ -n "$RESOLVED_RESUME" ]; then
                pass_prompt="$pass_prompt --resume"
                RESUMED_THIS_RUN="$RESUMED_THIS_RUN $RESOLVED_ISSUE"
                case "$RESOLVED_RESUME" in
                pr:*) _resume_what="PR #${RESOLVED_RESUME#pr:}" ;;
                local) _resume_what="local branch, never pushed" ;;
                *) _resume_what="pushed branch, no PR" ;;
                esac
                echo "loop-drain[warn]: resuming dead claim #${RESOLVED_ISSUE} (${_resume_what}) — its pass died holding the claim; one resume per issue per run." >&2
            fi
        elif [ "$RESOLVED_EXHAUSTED" -eq 1 ]; then
            refuse_start "no-progress"
            continue
        else
            refuse_start "preflight-error"
            continue
        fi
    fi
    # The pass's session id (issue #4722, see new_session_id) — minted before
    # the pass counter moves, for the same reason the head is resolved there.
    pass_session=$(new_session_id)
    if [ -z "$pass_session" ]; then
        echo "loop-drain[error]: could not mint a session id (neither uuidgen nor /proc/sys/kernel/random/uuid) — stopping rather than run a pass no transcript can be bound to." >&2
        DRAIN_REASON="preflight-error"
        continue
    fi

    # ── run one pass ────────────────────────────────────────────────────────
    start_pass
done

echo ""
if [ -n "$EXCLUDED_THIS_RUN" ]; then
    echo "loop-drain[warn]: excluded this run (left unclaimed, still ready-for-agent):$(printf ' #%s' $EXCLUDED_THIS_RUN)" >&2
fi
if [ "$BUDGET_ENABLED" -eq 1 ]; then
    _spend_summary="spent=${spent} budget=${BUDGET} ceiling=${CEILING}"
else
    _spend_summary="spent=n/a budget=n/a"
fi
echo "loop-drain[summary]: passes=$pass reason=${stop_reason:-unknown} queue_start=${first_queue_count:-?} queue_end=${last_queue_count:-?} final_pct=${pct:-n/a} ${_spend_summary} lanes=${LANES_SEEN} duration=$(($(date +%s) - RUN_START_MS / 1000))"

case "$stop_reason" in
    stop-file | max-passes | queue-empty | budget)
        exit 0
        ;;
    *)
        exit 1
        ;;
esac

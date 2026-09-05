#!/bin/sh
# scripts/loop-drain.sh — the AFK driver for `/next-issue` (ADR 0097 + 0110).
#
# `/next-issue` closes exactly ONE issue per process (ADR 0110): the context
# reset between issues IS the cost-containment mechanism, and the skill's own
# §6 ends with "one issue per invocation. The user (or the budgeted AFK
# driver, ADR 0109) decides whether there is a next one." This script is that
# driver — an OUT-OF-PROCESS loop around a fresh `claude -p "/next-issue N"`
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
# The post-merge health verdict (ADR 0110). `health-main.ts` writes this
# marker iff the last completed full gate on the merged tip was RED, and
# removes it on green. Relative to the caller's cwd like STOP_FILE and
# GREEN_SHA_FILE, deliberately — see the header on why every path here is.
HEALTH_RED_FILE=".claude/telemetry/health/RED"
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
PASS_PROMPT="/next-issue"
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
            PROMPT_OVERRIDDEN=1
            shift 2
            ;;
        --health-red-file)
            HEALTH_RED_FILE="$2"
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
    echo "loop-drain: --prompt must not be empty (omit it for the default '/next-issue')" >&2
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
case "$BUDGET" in
    "" | 0 | 0.0 | -*)
        if [ -n "${TOLARIA_LOOP_ALLOW_NO_BUDGET:-}" ]; then
            BUDGET_ENABLED=0
            echo "loop-drain: TOLARIA_LOOP_ALLOW_NO_BUDGET set (test-only hatch) — the token-budget guard is DISABLED for this run." >&2
        else
            echo "loop-drain: --budget / TOLARIA_LOOP_TOKEN_BUDGET is REQUIRED — this driver refuses to run unbudgeted (ADR 0109)." >&2
            echo "loop-drain: e.g. --budget 200000000; the guard stops the run once the ${WINDOW_HOURS}h weighted usage reaches --max-pct (${MAX_PCT}%) of it." >&2
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
        echo "loop-drain: orphan-claim sweep skipped — $_doctor not found." >&2
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
        printf 'loop-drain: %s —\n%s\n' "$_reap_label" "$_reap_out" >&2
    else
        # Never silent: a janitor that stops running without saying so is how
        # the prose version of this rule failed in the first place.
        echo "loop-drain: $_reap_label FAILED (bun loop-doctor.ts $_reap_flag) — continuing without it." >&2
        printf '%s\n' "$_reap_out" >&2
    fi
    return 0
}

# ── pre-flight: WHICH issue, on WHICH tier (#3083) ──────────────────────────
# `/next-issue` §0 will pick its own issue when handed none, and §1 will STOP
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
# the session tier already works (`/next-issue` §4; the telemetry records
# sonnet-main sessions spawning opus reviewers).
#
# `--exclude-hitl` (#3088). An HITL issue asks for a human to look before it
# merges; an unattended pass ends in `land`, which merges. So the driver does
# not "handle" that work carefully — it never considers it, and says so to the
# planner rather than growing a second, shell-side notion of eligibility here.
# An interactive `/next-issue` passes no such flag and still sees them.
#
# CONSUMED, NOT REIMPLEMENTED. The ordering (board Priority, then bugs, then
# oldest lineage), the eligibility filter and the label→tier resolution all
# belong to `queue:plan`; this reads `batch[0]` off its plan and nothing
# more. The read goes through
# `bun -e` rather than a `grep -o` on the JSON because the plan's OTHER arrays
# (`deferred`, `skipped`) carry `number` fields too — a first-match scan
# silently returns a DEFERRED issue's number the moment the batch is empty,
# which is precisely when it must return nothing.
#
# FATAL, unlike the orphan-claim sweep — and this is the one place that trade
# goes the other way (#3088). A pass handed the bare prompt picks its own
# issue, and `/next-issue` knows nothing about HITL: it would implement an
# HITL-flagged issue and then `land` it, merging the very thing the flag
# exists to hold for a human. So "the planner could not answer" must not
# degrade into "run something anyway". It stops the run, next to `gh-error`,
# which already stops it for the strictly milder failure of not being able to
# COUNT the queue. A safety that yields the moment it is inconvenient is not
# a safety.
RESOLVED_ISSUE=""
RESOLVED_MODEL=""
resolve_head() {
    RESOLVED_ISSUE=""
    RESOLVED_MODEL=""
    # stderr goes to a FILE, never into `$_plan`: `bun run <script>` prints a
    # `$ bun scripts/… ` banner on stderr, and folding that into the captured
    # stdout makes the JSON unparseable — a real dry run against a 230-issue
    # queue resolved nothing at all for exactly this reason. Only stdout is
    # the plan.
    _plan_err=$(mktemp)
    if ! _plan=$(bun run queue:plan --cap 1 --exclude-hitl 2>"$_plan_err"); then
        echo "loop-drain: pre-flight FAILED (bun run queue:plan --cap 1 --exclude-hitl) — STOPPING. A pass handed the bare prompt picks its own issue and knows nothing about HITL, so it could implement and merge work reserved for a human (#3088)." >&2
        cat "$_plan_err" >&2 || true
        rm -f "$_plan_err"
        return 1
    fi
    rm -f "$_plan_err"
    # `bun -e` reads the plan off the environment, never argv: a plan is
    # multi-KB of JSON with quotes in it, and interpolating that into a shell
    # word is how a quoting bug becomes an arbitrary-command bug.
    _head=$(LOOP_PLAN="$_plan" bun -e '
const plan = JSON.parse(process.env.LOOP_PLAN || "{}");
const head = (plan.batch || [])[0];
if (head && Number.isInteger(head.number) && typeof head.model === "string") {
    process.stdout.write(head.number + " " + head.model);
}
' 2>/dev/null) || _head=""
    if [ -z "$_head" ]; then
        echo "loop-drain: pre-flight resolved no ELIGIBLE head issue from the plan — stopping rather than letting a pass pick for itself." >&2
        return 1
    fi
    RESOLVED_ISSUE=${_head% *}
    RESOLVED_MODEL=${_head#* }
    if ! is_uint "$RESOLVED_ISSUE" || [ -z "$RESOLVED_MODEL" ]; then
        echo "loop-drain: pre-flight returned an unusable head ('$_head') — stopping rather than letting a pass pick for itself." >&2
        RESOLVED_ISSUE=""
        RESOLVED_MODEL=""
        return 1
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

    # 2b. health RED — the post-merge full gate failed on the merged tip and
    # nobody has fixed it. ADR 0110's green-main invariant: "A RED marker
    # means fix-forward FIRST — never stack unrelated work on a red tip."
    # `land` already WARNS on this, which is the right strength for a human
    # who can read the warning and judge; unattended there is nobody to read
    # it, so the driver stops instead. Checked BEFORE the budget read (which
    # forks `bun`) and before the orphan sweep, because a red tip means no
    # pass should happen at all — and reported as its own reason rather than
    # folded into `no-progress`, so the morning's log says what to fix.
    if [ -f "$HEALTH_RED_FILE" ]; then
        stop_reason="health-red"
        echo "loop-drain: main is RED (post-merge health gate, ADR 0110) — stopping rather than stacking work on a red tip. Run 'bun run health:status' and fix forward. Marker:" >&2
        cat "$HEALTH_RED_FILE" >&2 || true
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

    # 4b. resolve WHICH issue and WHICH tier, unless the operator named the
    # prompt (see PASS_PROMPT above — an override owns the whole invocation,
    # including responsibility for what it selects). Before the pass counter
    # moves, so a failure stops the run without booking a phantom pass.
    # `pass_model_arg` is EITHER empty or the two words `--model <tier>`, and
    # is expanded UNQUOTED at the call site for exactly that reason — same
    # idiom as $CLAUDE_ARGS, and the same reason "$pass_prompt" stays quoted.
    pass_prompt="$PASS_PROMPT"
    pass_model_arg=""
    if [ "$PROMPT_OVERRIDDEN" -eq 0 ]; then
        if resolve_head; then
            pass_prompt="$PASS_PROMPT $RESOLVED_ISSUE"
            pass_model_arg="--model $RESOLVED_MODEL"
        else
            stop_reason="preflight-error"
            break
        fi
    fi

    # ── run one pass ────────────────────────────────────────────────────────
    pass=$((pass + 1))
    [ "$PROMPT_OVERRIDDEN" -eq 1 ] ||
        echo "loop-drain: pass $pass — issue #${RESOLVED_ISSUE} on tier ${RESOLVED_MODEL}." >&2
    epoch=$(date +%s)
    pass_log="$LOG_DIR/pass-${pass}-${epoch}.log"
    green_before=$(read_green_sha)
    total_before=$(count_total_open 2>/dev/null) || total_before=""

    if [ "$DRY_RUN" -eq 1 ]; then
        # Echo the command as it will actually be typed. `$pass_model_arg` is
        # empty on the override path, and interpolating an empty variable
        # between two words leaves a double space — which the real invocation
        # never has (the shell collapses it), so an echo that showed one would
        # be a dry run of a command nobody runs.
        if [ -n "$pass_model_arg" ]; then
            _dry_claude="claude $pass_model_arg -p"
        else
            _dry_claude="claude -p"
        fi
        echo "loop-drain: [dry-run] pass $pass would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 $_dry_claude \"$pass_prompt\" $CLAUDE_ARGS" >&2
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
            # "$pass_prompt" stays QUOTED — it is ONE argument that normally
            # contains spaces ("/next-issue 3083", or an operator's
            # "/process-gh-issues figli di 2405"); splitting it is the exact
            # opposite of what the unquoted $pass_model_arg and $CLAUDE_ARGS
            # beside it deliberately do.
            # shellcheck disable=SC2086  # intentional word-splitting of the
            # resolved tier flag and of a user-supplied flag string, both
            # documented above.
            TOLARIA_LOOP_DRAIN=1 CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude $pass_model_arg -p "$pass_prompt" $CLAUDE_ARGS 2>&1
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

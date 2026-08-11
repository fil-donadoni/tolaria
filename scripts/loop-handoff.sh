#!/bin/sh
# scripts/loop-handoff.sh — the AFK entry point (`bun run loop:afk`).
#
# `scripts/loop-drain.sh` (ADR 0097) can already run pass after pass
# unattended, but nothing ever STARTED it: `/process-gh-issues` runs exactly
# one batch and exits, so a human had to type the driver command every time.
# This script closes that gap from both ends:
#
#   1. `--start` / `--resume` — a human types ONE command and walks away. The
#      driver is detached from this terminal (new session via setsid, SIGHUP
#      immune, optionally under `caffeinate` so the Mac does not sleep through
#      the run), so it keeps going after the shell, the SSH connection, or the
#      Claude Code session that launched it is gone.
#   2. `--from-pass` — the LAST action of a `/process-gh-issues` pass. It
#      no-ops unless the checkout is ARMED, so an ordinary interactive pass
#      never silently forks an hours-long unattended run; when armed, it hands
#      the baton to a detached driver, and the machine keeps draining the
#      queue with no further human input.
#
# Arming is deliberately a separate, durable, human act (`--arm`, or the
# `--start` that implies it): the driver runs `claude` with whatever
# permission mode the conf carries, which for a truly unattended run means
# `--dangerously-skip-permissions`. That is a security-relevant choice, so it
# is written to a file a human can read, audit and delete — never inferred
# from the fact that a pass happened to finish.
#
# POSIX sh, macOS-safe. Every path is relative to the caller's cwd, exactly as
# in loop-drain.sh and for the same reason (testability against a scratch
# directory); `bun run loop:afk` always runs at the repo root.

set -eu

TELEMETRY_DIR=".claude/telemetry"
CONF_FILE="$TELEMETRY_DIR/afk.conf"
STOP_FILE="$TELEMETRY_DIR/loop-stop"
PID_FILE="$TELEMETRY_DIR/loop-drain.pid"
DETACH_LOG="$TELEMETRY_DIR/loop-afk.log"
DRIVER="scripts/loop-drain.sh"

# `--dangerously-skip-permissions` is the default only because an AFK run with
# any other mode blocks on the first permission prompt with nobody watching —
# i.e. it is not an AFK run at all. It is written into the conf file in plain
# text so the choice is visible and revocable (`--disarm`), never implicit.
DEFAULT_CLAUDE_ARGS="--dangerously-skip-permissions"
# Seconds the driver waits before its first pass: the calling pass is still
# releasing claims when the handoff fires.
DEFAULT_START_DELAY=45

MODE=""
ARG_CLAUDE_ARGS=""
ARG_BUDGET=""
ARG_MAX_PCT=""
ARG_MAX_PASSES=""
ARG_MAX_ERRORS=""
ARG_START_DELAY=""
NO_CAFFEINATE=0
DRY_RUN=0

usage() {
    cat <<'EOF'
loop-handoff — start / stop / inspect the detached AFK driver.

  bun run loop:afk                     arm (if needed) + start a detached driver
  bun run loop:afk --resume            same, but clears the stop-file first
  bun run loop:afk --stop              ask the running driver to stop after the current pass
  bun run loop:afk --status            armed? driver alive? stop-file? last log lines
  bun run loop:afk --arm               write the conf without starting anything
  bun run loop:afk --disarm            remove the conf (end-of-pass handoff stops firing)
  sh scripts/loop-handoff.sh --from-pass   invoked BY a pass; no-ops unless armed

Options (recorded in .claude/telemetry/afk.conf on --arm / --start):
  --claude-args <str>          default: --dangerously-skip-permissions
  --budget <n> --max-pct <n>   local-proxy token budget guard (see ADR 0097)
  --max-passes <n>             0 = unlimited
  --max-consecutive-errors <n> crashes tolerated in a row before stopping (default 3)
  --start-delay <secs>         grace before the first pass (default 45)
  --no-caffeinate              do not hold the machine awake for the run
  --dry-run                    print the driver command instead of detaching it
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --start | --resume | --stop | --status | --arm | --disarm | --from-pass)
            if [ -n "$MODE" ]; then
                echo "loop-handoff: pick ONE mode, got both --$MODE and $1" >&2
                exit 2
            fi
            MODE=${1#--}
            shift
            ;;
        --claude-args)
            ARG_CLAUDE_ARGS="$2"
            shift 2
            ;;
        --budget)
            ARG_BUDGET="$2"
            shift 2
            ;;
        --max-pct)
            ARG_MAX_PCT="$2"
            shift 2
            ;;
        --max-passes)
            ARG_MAX_PASSES="$2"
            shift 2
            ;;
        --max-consecutive-errors)
            ARG_MAX_ERRORS="$2"
            shift 2
            ;;
        --start-delay)
            ARG_START_DELAY="$2"
            shift 2
            ;;
        --no-caffeinate)
            NO_CAFFEINATE=1
            shift
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "loop-handoff: unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

[ -n "$MODE" ] || MODE="start"

mkdir -p "$TELEMETRY_DIR"

# ── conf I/O. KEY=VALUE, one per line, cut at the FIRST `=` so a value may
# contain `=` (a claude flag like `--model=opus`). Deliberately parsed, never
# sourced/eval'd: this file is read by an unattended process that then runs
# `claude` with whatever it finds, so a shell-injection surface here would be
# a remote-ish code-execution surface on every future AFK run.
conf_get() {
    [ -f "$CONF_FILE" ] || return 0
    grep "^$1=" "$CONF_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

is_uint() {
    case "$1" in
        '' | *[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

driver_pid() {
    _pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
    is_uint "$_pid" || return 1
    kill -0 "$_pid" 2>/dev/null || return 1
    echo "$_pid"
}

write_conf() {
    _claude_args=${ARG_CLAUDE_ARGS:-$(conf_get CLAUDE_ARGS)}
    [ -n "$_claude_args" ] || _claude_args="$DEFAULT_CLAUDE_ARGS"
    _start_delay=${ARG_START_DELAY:-$(conf_get START_DELAY)}
    [ -n "$_start_delay" ] || _start_delay="$DEFAULT_START_DELAY"
    {
        echo "# Written by scripts/loop-handoff.sh — the AFK arming marker."
        echo "# Its presence is what lets a finished /process-gh-issues pass"
        echo "# launch the next one. Delete it (bun run loop:afk --disarm) to"
        echo "# go back to one-batch-per-invocation."
        echo "CLAUDE_ARGS=$_claude_args"
        echo "BUDGET=${ARG_BUDGET:-$(conf_get BUDGET)}"
        echo "MAX_PCT=${ARG_MAX_PCT:-$(conf_get MAX_PCT)}"
        echo "MAX_PASSES=${ARG_MAX_PASSES:-$(conf_get MAX_PASSES)}"
        echo "MAX_CONSECUTIVE_ERRORS=${ARG_MAX_ERRORS:-$(conf_get MAX_CONSECUTIVE_ERRORS)}"
        echo "START_DELAY=$_start_delay"
    } >"$CONF_FILE.tmp"
    mv "$CONF_FILE.tmp" "$CONF_FILE"
}

# Build the driver argv and detach it into its own session. Three layers, all
# optional-but-defaulted:
#   perl setsid  — new session, so the driver survives the death of the shell,
#                  terminal or Claude Code process that launched it, and is
#                  never killed by a process-group signal aimed at that parent
#   caffeinate   — the Mac must stay awake, or an overnight run stops the
#                  moment the display sleeps
#   nohup        — SIGHUP immunity even where setsid is unavailable
launch_driver() {
    _claude_args=$(conf_get CLAUDE_ARGS)
    _budget=$(conf_get BUDGET)
    _max_pct=$(conf_get MAX_PCT)
    _max_passes=$(conf_get MAX_PASSES)
    _max_errors=$(conf_get MAX_CONSECUTIVE_ERRORS)
    _start_delay=$(conf_get START_DELAY)
    [ -n "$_start_delay" ] || _start_delay="$DEFAULT_START_DELAY"

    set -- sh "$DRIVER" --single-instance \
        --pid-file "$PID_FILE" --stop-file "$STOP_FILE" \
        --start-delay "$_start_delay"
    [ -z "$_claude_args" ] || set -- "$@" --claude-args "$_claude_args"
    [ -z "$_budget" ] || set -- "$@" --budget "$_budget"
    [ -z "$_max_pct" ] || set -- "$@" --max-pct "$_max_pct"
    [ -z "$_max_passes" ] || set -- "$@" --max-passes "$_max_passes"
    [ -z "$_max_errors" ] || set -- "$@" --max-consecutive-errors "$_max_errors"

    if [ "$NO_CAFFEINATE" -eq 0 ] && command -v caffeinate >/dev/null 2>&1; then
        set -- caffeinate -i -s "$@"
    fi
    if command -v perl >/dev/null 2>&1; then
        set -- perl -e 'use POSIX (); POSIX::setsid(); exec @ARGV or die "exec: $!\n";' -- "$@"
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        echo "loop-handoff: [dry-run] would detach: $*"
        return 0
    fi

    echo "--- $(date '+%Y-%m-%d %H:%M:%S') loop-handoff detaching driver ---" >>"$DETACH_LOG"
    nohup "$@" >>"$DETACH_LOG" 2>&1 </dev/null &
    echo "loop-handoff: driver detached (wrapper pid $!) — output: $DETACH_LOG"
}

# Every reason a start must NOT happen, in one place so `--start` and
# `--from-pass` can never drift apart on the safety checks. Prints the reason
# and returns 1; the caller decides whether that is an error or a quiet no-op.
blocked_reason() {
    if [ -n "${TOLARIA_LOOP_DRAIN:-}" ]; then
        echo "this pass was itself started by the driver (TOLARIA_LOOP_DRAIN=1) — the driver launches the next pass, not the pass itself"
        return 1
    fi
    if [ -f "$STOP_FILE" ]; then
        echo "the stop-file $STOP_FILE exists — remove it, or use 'bun run loop:afk --resume'"
        return 1
    fi
    if _pid=$(driver_pid); then
        echo "a driver is already running (pid $_pid) over this checkout"
        return 1
    fi
    return 0
}

case "$MODE" in
    status)
        if [ -f "$CONF_FILE" ]; then
            echo "armed:      yes ($CONF_FILE)"
            sed 's/^/            /' "$CONF_FILE"
        else
            echo "armed:      no — end-of-pass handoff will not fire"
        fi
        if _pid=$(driver_pid); then
            echo "driver:     running (pid $_pid)"
        else
            echo "driver:     not running"
        fi
        if [ -f "$STOP_FILE" ]; then
            echo "stop-file:  PRESENT — nothing will start until it is removed"
        else
            echo "stop-file:  absent"
        fi
        if [ -f "$TELEMETRY_DIR/loop-drain.log" ]; then
            echo "last passes (epoch pass exit pct queue_before queue_after reason):"
            tail -n 5 "$TELEMETRY_DIR/loop-drain.log" | sed 's/^/            /'
        fi
        ;;

    arm)
        write_conf
        echo "loop-handoff: armed. conf:"
        sed 's/^/  /' "$CONF_FILE"
        echo "loop-handoff: nothing started — 'bun run loop:afk' to start now, or the next finished /process-gh-issues pass will."
        ;;

    disarm)
        rm -f "$CONF_FILE"
        echo "loop-handoff: disarmed — the end-of-pass handoff will no longer start a driver."
        echo "loop-handoff: a driver already running is NOT stopped by this; use 'bun run loop:afk --stop'."
        ;;

    stop)
        : >"$STOP_FILE"
        if _pid=$(driver_pid); then
            echo "loop-handoff: stop requested — driver pid $_pid will exit after the current pass finishes."
            echo "loop-handoff: to abort the pass in flight too: kill $_pid"
        else
            echo "loop-handoff: stop-file written; no driver is currently running."
        fi
        echo "loop-handoff: the stop-file is never cleared automatically — 'bun run loop:afk --resume' to start again."
        ;;

    start | resume)
        if [ "$MODE" = "resume" ]; then
            rm -f "$STOP_FILE"
        fi
        if ! reason=$(blocked_reason); then
            echo "loop-handoff: not starting — $reason" >&2
            exit 1
        fi
        write_conf
        echo "loop-handoff: AFK run armed with CLAUDE_ARGS=$(conf_get CLAUDE_ARGS)"
        case "$(conf_get CLAUDE_ARGS)" in
            *--dangerously-skip-permissions*)
                echo "loop-handoff: WARNING — this run answers every permission prompt automatically." >&2
                echo "loop-handoff: it will edit files, push branches and merge PRs with nobody watching." >&2
                echo "loop-handoff: stop it with 'bun run loop:afk --stop'." >&2
                ;;
        esac
        launch_driver
        ;;

    from-pass)
        # Called at the end of a pass. EVERY negative outcome here is a quiet
        # exit 0: this runs inside a successful pass, and a handoff that
        # cannot start is never a reason to fail the batch that just landed.
        if [ ! -f "$CONF_FILE" ]; then
            echo "loop-handoff: not armed — this pass ends here. 'bun run loop:afk' to run unattended."
            exit 0
        fi
        if ! reason=$(blocked_reason); then
            echo "loop-handoff: no handoff — $reason"
            exit 0
        fi
        launch_driver
        ;;

    *)
        echo "loop-handoff: unknown mode: $MODE" >&2
        exit 2
        ;;
esac

#!/bin/sh
# scripts/loop-handoff.sh — the AFK entry point (`bun run loop:afk`).
#
# `scripts/loop-drain.sh` (ADR 0097) can already run pass after pass
# unattended, but nothing ever STARTED it: `/process-gh-issues` runs exactly
# one batch and exits, so a human had to type the driver command every time.
# This script closes that gap from both ends:
#
#   1. `--start` / `--resume` — a human types ONE command. The driver runs in
#      the FOREGROUND (issue #4389): merged stdout+stderr stream to this
#      terminal, every line timestamped by this script's own pipeline and
#      tee'd into the same log a detached run writes, and Ctrl-C reaches the
#      `claude` pass in flight because the driver stays in the caller's
#      process group. ADR 0109 made a human `--start` the only way a run
#      begins, so the operator is AT the keyboard: watching the run must not
#      cost a second shell and a `tail -f`.
#   1b. `--detach` is the opt-in that restores the old shape — new session via
#      `perl POSIX::setsid()`, SIGHUP-immune under `nohup` — for a run that
#      must outlive the shell, the SSH connection or the Claude Code session
#      that started it. `caffeinate` holds the Mac awake on BOTH paths: an
#      overnight FOREGROUND run sleeps through the night otherwise.
#   2. `--from-pass` — DEAD SWITCH (ADR 0109). It used to detach the driver
#      at the end of a `/process-gh-issues` pass whenever an `afk.conf` was
#      present. In practice a weeks-old conf turned a single interactive pass
#      into an unattended, sometimes unbudgeted, multi-day drain (the
#      2026-08-25→27 91%-in-48h burn ran that way). A pass NEVER starts the
#      driver: `--from-pass` is now an unconditional exit-0 no-op, kept only
#      so older prompts that still call it stay harmless. Unattended runs
#      begin ONLY with an explicit human `--start` / `--resume` (or
#      `bun run loop:drain`) in a terminal.
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
# The prompt every pass of the armed run executes. EMPTY BY DEFAULT, and
# deliberately so: an empty PROMPT means the conf states no opinion and the
# driver's own default is the single authority (`launch_driver` omits the flag
# entirely). Restating the driver's default here would be worse than
# redundant — `--prompt` is what switches the driver's pre-flight OFF (#3083),
# so a conf that echoed the default would silently disable the issue/tier
# resolution for every run started through this script.
#
# `--prompt` therefore means exactly one thing: SCOPE this run
# (`/process-gh-issues figli di 2405` = only PRD #2405's children, or any
# other skill). It is recorded in the conf, and printed by --status, precisely
# because an armed run that LOOKS unscoped but isn't (or vice versa) is a trap
# for whoever reads the file the next morning.
DEFAULT_PROMPT=""
# Seconds the driver waits before its first pass: the calling pass is still
# releasing claims when the handoff fires.
DEFAULT_START_DELAY=45

MODE=""
ARG_CLAUDE_ARGS=""
ARG_PROMPT=""
ARG_BUDGET=""
ARG_MAX_PCT=""
ARG_MAX_PASSES=""
ARG_MAX_ERRORS=""
ARG_START_DELAY=""
NO_CAFFEINATE=0
DRY_RUN=0
DETACH=0

usage() {
    cat <<'EOF'
loop-handoff — start / stop / inspect the detached AFK driver.

  bun run loop:afk                     arm (if needed) + run the driver in THIS terminal
  bun run loop:afk --detach            same, but detached — survives this shell
  bun run loop:afk --resume            same as --start, but clears the stop-file first
  bun run loop:afk --stop              ask the running driver to stop after the current pass
  bun run loop:afk --status            armed? driver alive? stop-file? last log lines
  bun run loop:afk --arm               write the conf (defaults for --start) without starting anything
  bun run loop:afk --disarm            remove the conf
  sh scripts/loop-handoff.sh --from-pass   dead switch (ADR 0109): always a no-op — a pass never starts the driver

Options (recorded in .claude/telemetry/afk.conf on --arm / --start):
  --claude-args <str>          default: --dangerously-skip-permissions
  --prompt <text>              SCOPE the run (default: unset — the driver
                               drains the queue with /next-issue, one issue and
                               one tier resolved per pass). Setting it turns
                               that pre-flight OFF: you own the whole
                               invocation, e.g.
                               --prompt "/process-gh-issues figli di 2405"
  --budget <n> --max-pct <n>   local-proxy token budget guard (see ADR 0097).
                              --budget is what THIS RUN may spend, counted
                              from its launch over its own passes only
                              (issue #3699); --max-pct defaults to 100, and
                              the driver prints the effective ceiling in
                              tokens at launch.
  --max-passes <n>             0 = unlimited
  --max-consecutive-errors <n> crashes tolerated in a row before stopping (default 3)
  --start-delay <secs>         grace before the first pass (default 45)
  --no-caffeinate              do not hold the machine awake for the run
  --detach                     run the driver in its own session instead of in
                               this terminal. Ctrl-C then no longer reaches it
                               (use --stop); output goes only to
                               .claude/telemetry/loop-afk.log. Both paths
                               timestamp every line and write that same log.
  --dry-run                    print the driver command instead of running it
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
        --prompt)
            ARG_PROMPT="$2"
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
        --detach)
            DETACH=1
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

# The conf is a LINE-based KEY=VALUE file (see conf_get below): a value
# containing a newline would be written as two lines and read back TRUNCATED
# at the first one — the driver would then run half a prompt for hours with
# nobody watching, which is precisely the failure this flag exists to
# prevent. Reject it loudly at arm time instead. Every other character —
# spaces, `=`, quotes, `$(...)`, backticks — round-trips intact, because the
# file is parsed and never sourced.
if [ "$(printf '%s' "$ARG_PROMPT" | wc -l | tr -d ' ')" != "0" ]; then
    echo "loop-handoff: --prompt must be a single line — a newline in the value would be truncated when $CONF_FILE is read back." >&2
    exit 2
fi

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
    # No `|| _prompt=$DEFAULT_PROMPT` fallback: DEFAULT_PROMPT is empty and
    # an empty PROMPT is meaningful (see its declaration above).
    _prompt=${ARG_PROMPT:-$(conf_get PROMPT)}
    _start_delay=${ARG_START_DELAY:-$(conf_get START_DELAY)}
    [ -n "$_start_delay" ] || _start_delay="$DEFAULT_START_DELAY"
    {
        echo "# Written by scripts/loop-handoff.sh — the AFK arming marker."
        echo "# It stores DEFAULTS for --start (ADR 0109: a pass never starts"
        echo "# the driver, and this file never causes anything to run on its"
        echo "# own). Delete it with: bun run loop:afk --disarm"
        echo "# An empty PROMPT means the driver's own default applies."
        echo "CLAUDE_ARGS=$_claude_args"
        echo "PROMPT=$_prompt"
        echo "BUDGET=${ARG_BUDGET:-$(conf_get BUDGET)}"
        echo "MAX_PCT=${ARG_MAX_PCT:-$(conf_get MAX_PCT)}"
        echo "MAX_PASSES=${ARG_MAX_PASSES:-$(conf_get MAX_PASSES)}"
        echo "MAX_CONSECUTIVE_ERRORS=${ARG_MAX_ERRORS:-$(conf_get MAX_CONSECUTIVE_ERRORS)}"
        echo "START_DELAY=$_start_delay"
    } >"$CONF_FILE.tmp"
    mv "$CONF_FILE.tmp" "$CONF_FILE"
}

# ── per-line timestamps (issue #4389). The stamper runs OUTSIDE the driver,
# in this script's own pipeline, and that placement is the whole design:
#
#   · the per-pass logs stay RAW by construction. loop-drain.sh tees each pass
#     into .claude/telemetry/loop-drain/pass-N-EPOCH.log and then greps that
#     file for RATE_LIMIT_PATTERNS (loop-drain.sh:832); a stamp applied inside
#     the driver would prefix the very lines those patterns must match.
#   · both sinks see the SAME bytes. One filter feeds one `tee`, so the
#     terminal, `--status` and anything tailing loop-afk.log agree line for
#     line, and a detached run produces the same format as a foreground one.
#   · the `2>&1` merge happens BEFORE the filter, because loop-drain.sh writes
#     most of its progress to stderr — merging after would leave half the
#     stream unstamped and interleaved.
#
# `perl` was already a dependency of the detach path (POSIX::setsid). With no
# perl on PATH we stream UNSTAMPED rather than refuse to run: an unstamped log
# beats no run at all.
STAMP_PROG='BEGIN { $| = 1; require POSIX } print POSIX::strftime("%Y-%m-%d %H:%M:%S ", localtime), $_'

stamp_stream() {
    if command -v perl >/dev/null 2>&1; then
        perl -ne "$STAMP_PROG"
    else
        cat
    fi
}

# The detached path runs the SAME driver|stamper pipeline, but INSIDE the new
# session, so the stamper is detached alongside the driver: a stamper left
# behind in the caller's session would take the SIGHUP the driver is protected
# from, and the driver would then die of SIGPIPE writing into it. `$1` is the
# perl program, passed as an ARGUMENT precisely so this string needs no nested
# quoting; the caller redirects the whole inner shell into the log.
DETACH_PIPELINE='_prog=$1; shift; if command -v perl >/dev/null 2>&1; then "$@" 2>&1 | perl -ne "$_prog"; else "$@" 2>&1; fi'

# The session-detaching wrapper, named once so the --dry-run line and the real
# spawn can never print different things. Deliberately free of `$` and of
# backticks so it survives `perl -e "$SETSID_PERL"`: the older inline form
# carried `die "exec: $!"`, which a double-quoted expansion would have turned
# into the shell's last background pid.
SETSID_PERL='use POSIX (); POSIX::setsid(); exec @ARGV; die "loop-handoff: exec failed\n";'

# What an operator reads immediately before the run begins. A function rather
# than inline echoes because on the FOREGROUND path it runs inside the stamped
# pipeline — so every line the caller sees carries a timestamp — while the
# dry-run and --detach paths print it directly.
announce_start() {
    echo "loop-handoff: AFK run armed with CLAUDE_ARGS=$(conf_get CLAUDE_ARGS)"
    # Branch on an empty PROMPT exactly as --status does. This line is the
    # last thing an operator reads before walking away, so `claude -p ""` —
    # which is what an unbranched echo prints now that the conf's default is
    # empty — would announce a pass that does nothing, forever, when the
    # driver actually resolves an issue and a tier per pass.
    _start_prompt=$(conf_get PROMPT)
    if [ -n "$_start_prompt" ]; then
        echo "loop-handoff: every pass will run: claude -p \"$_start_prompt\""
    else
        echo "loop-handoff: every pass will run: /next-issue on the issue and tier the driver resolves for it (unscoped)"
    fi
    case "$(conf_get CLAUDE_ARGS)" in
        *--dangerously-skip-permissions*)
            echo "loop-handoff: WARNING — this run answers every permission prompt automatically." >&2
            echo "loop-handoff: it will edit files, push branches and merge PRs with nobody watching." >&2
            echo "loop-handoff: stop it with 'bun run loop:afk --stop'." >&2
            ;;
    esac
}

# Run the driver IN THIS PROCESS and block until it exits. Everything the run
# prints — this script's own announcement included — goes through one
# `2>&1 | stamp | tee` pipeline, so the terminal and $DETACH_LOG receive
# identical, timestamped bytes.
#
# No setsid and no nohup here, deliberately: the driver must stay in the
# caller's process group or Ctrl-C never reaches the `claude` pass in flight,
# which is the whole point of the foreground default. SIGINT therefore ends
# the run and writes NO stop-file — `--resume` is the answer to a stop-file,
# not to an interrupted foreground run — while the driver's own
# `trap cleanup_pid_file EXIT INT TERM` keeps the pid file honest.
#
# The exit code travels through a file because POSIX sh has no PIPESTATUS:
# `$?` after the pipeline is `tee`'s, which is 0 even when the driver crashed.
# `if`/`else` around the call rather than a bare invocation, because `set -e`
# is in effect inside the pipeline's subshell and would kill it before the
# code was ever written.
run_foreground() {
    _rc_file="$TELEMETRY_DIR/loop-afk.rc.$$"
    rm -f "$_rc_file"
    trap 'rm -f "$_rc_file"; exit 130' INT
    trap 'rm -f "$_rc_file"; exit 143' TERM
    echo "--- $(date '+%Y-%m-%d %H:%M:%S') loop-handoff running driver in the foreground ---" >>"$DETACH_LOG"
    {
        announce_start
        if "$@"; then
            echo 0 >"$_rc_file"
        else
            echo "$?" >"$_rc_file"
        fi
    } 2>&1 | stamp_stream | tee -a "$DETACH_LOG"
    trap - INT
    trap - TERM
    _rc=$(cat "$_rc_file" 2>/dev/null || echo "")
    rm -f "$_rc_file"
    is_uint "$_rc" || _rc=1
    return "$_rc"
}

# Build the driver argv and run it — in this terminal by default, in its own
# session under --detach. The optional-but-defaulted layers:
#   caffeinate   — BOTH paths. The Mac must stay awake, or an overnight run
#                  stops the moment the display sleeps.
#   perl setsid  — --detach ONLY. A new session is exactly what makes Ctrl-C
#                  unable to reach the driver, so it is the opt-in, never the
#                  default.
#   nohup        — --detach ONLY. SIGHUP immunity even where setsid is
#                  unavailable.
launch_driver() {
    _claude_args=$(conf_get CLAUDE_ARGS)
    _prompt=$(conf_get PROMPT)
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
    # Omitted when the conf carries no PROMPT (a conf armed before this flag
    # existed) — the driver's own default is then the single authority.
    [ -z "$_prompt" ] || set -- "$@" --prompt "$_prompt"
    [ -z "$_budget" ] || set -- "$@" --budget "$_budget"
    [ -z "$_max_pct" ] || set -- "$@" --max-pct "$_max_pct"
    [ -z "$_max_passes" ] || set -- "$@" --max-passes "$_max_passes"
    [ -z "$_max_errors" ] || set -- "$@" --max-consecutive-errors "$_max_errors"

    if [ "$NO_CAFFEINATE" -eq 0 ] && command -v caffeinate >/dev/null 2>&1; then
        set -- caffeinate -i -s "$@"
    fi

    if [ "$DETACH" -eq 0 ]; then
        if [ "$DRY_RUN" -eq 1 ]; then
            announce_start
            echo "loop-handoff: [dry-run] would run in the foreground: $*"
            return 0
        fi
        run_foreground "$@"
        return $?
    fi

    # --detach: setsid wraps the `sh -c` that runs driver|stamper, so BOTH
    # members of the pipeline land in the new session (see DETACH_PIPELINE).
    if [ "$DRY_RUN" -eq 1 ]; then
        announce_start
        # The `sh -c` carrying the stamping pipeline is elided from this line
        # on purpose: it is transport, and printing it buries the driver flags
        # the operator typed --dry-run to check.
        if command -v perl >/dev/null 2>&1; then
            echo "loop-handoff: [dry-run] would detach: perl -e $SETSID_PERL -- $*"
        else
            echo "loop-handoff: [dry-run] would detach: $*"
        fi
        return 0
    fi

    set -- sh -c "$DETACH_PIPELINE" sh "$STAMP_PROG" "$@"
    if command -v perl >/dev/null 2>&1; then
        set -- perl -e "$SETSID_PERL" -- "$@"
    fi

    announce_start
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
            # Say the SCOPE in one resolved line, not only as a raw conf
            # row: a run scoped to one lineage that reads as a full-queue
            # drain (or the reverse) is the trap this line closes.
            _p=$(conf_get PROMPT)
            if [ -n "$_p" ]; then
                echo "prompt:     $_p"
            else
                echo "prompt:     (unscoped — the driver drains the queue with /next-issue, resolving one issue and one tier per pass)"
            fi
        else
            echo "armed:      no — no stored defaults for --start"
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
            echo "last passes (epoch pass exit pct queue_before queue_after spent budget reason):"
            tail -n 5 "$TELEMETRY_DIR/loop-drain.log" | sed 's/^/            /'
        fi
        ;;

    arm)
        write_conf
        echo "loop-handoff: armed. conf:"
        sed 's/^/  /' "$CONF_FILE"
        echo "loop-handoff: nothing started — the conf is only defaults for an explicit 'bun run loop:afk --start'. A pass NEVER starts the driver (ADR 0109)."
        if [ -z "$(conf_get BUDGET)" ]; then
            echo "loop-handoff: WARNING — no BUDGET in the conf; --start will refuse unless --budget is passed (or TOLARIA_LOOP_TOKEN_BUDGET is set)." >&2
        fi
        ;;

    disarm)
        rm -f "$CONF_FILE"
        echo "loop-handoff: disarmed — the stored --start defaults are gone."
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
        # Budget is MANDATORY (ADR 0109). Refuse HERE, loudly, rather than
        # detach a driver that dies with the same refusal into a detach log
        # nobody is watching. Env counts: the detached driver inherits
        # TOLARIA_LOOP_TOKEN_BUDGET from this shell.
        if [ -z "${ARG_BUDGET:-$(conf_get BUDGET)}" ] && [ -z "${TOLARIA_LOOP_TOKEN_BUDGET:-}" ]; then
            echo "loop-handoff: refusing to start without a token budget — pass --budget <tokens> (e.g. --budget 200000000), record one with --arm --budget, or set TOLARIA_LOOP_TOKEN_BUDGET. An unbudgeted driver ran unthrottled for days (ADR 0109)." >&2
            exit 1
        fi
        write_conf
        # The announcement is launch_driver's now (announce_start): on the
        # foreground path it has to be printed INSIDE the stamped pipeline, or
        # the caller's first lines would be the only unstamped ones.
        launch_driver
        ;;

    from-pass)
        # DEAD SWITCH (ADR 0109) — see the header. A pass NEVER starts the
        # driver, armed or not, blockers or not. Exit 0 unconditionally: this
        # runs at the end of a successful pass and must never fail the batch.
        echo "loop-handoff: end-of-pass handoff is permanently disabled — a pass never starts the driver (ADR 0109). Unattended runs: 'bun run loop:afk --start'."
        exit 0
        ;;

    *)
        echo "loop-handoff: unknown mode: $MODE" >&2
        exit 2
        ;;
esac

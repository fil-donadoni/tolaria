#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# gate-run — run a gate so that NO single call can outlive the tool cap
# (issue #3698).
#
# THE PROBLEM. The Bash tool caps one call at 600s and, on expiry, promotes the
# command to the background on its own — the caller never opts in. The pre-PR
# gate queued behind the machine-wide gate mutex routinely outlives that cap.
# Once promoted, an unattended pass has no legal way to wait: it reports that
# it is waiting and ends its turn, and under `claude -p` the end of a turn is
# the end of the PROCESS. The gate is SIGTERMed mid-run and its verdict is
# never read — in the last recorded occurrence the gate had already passed
# 235 test files / 2830 tests when it was killed. Roughly 20 of ~75 recorded
# AFK pass logs end on this shape.
#
# THE SHAPE THAT CANNOT BE PROMOTED. Split "run the gate" from "wait for the
# gate":
#
#   1. The gate itself runs in its OWN process group (`set -m`), detached from
#      this call, writing its output to a log and its exit code to an `rc`
#      file. It therefore survives both the tool's 600s promotion and the death
#      of the pass that started it.
#   2. THIS call then waits in the foreground for at most WAIT_SECS (default
#      480 — comfortably inside the 600s cap) and returns either the gate's
#      real exit code, or exit 75 meaning "still running, ask again".
#   3. Re-running the IDENTICAL command re-attaches to the same run. It never
#      starts a second gate, and the gate never loses its place in the mutex
#      queue.
#
# So every call returns inside the cap, no turn ever ends while a gate is
# running, and the exit code is read by the same pass that started it.
#
# WHY NOT `run_in_background`. It throws the verdict away — see
# `.claude/hooks/deny-guard.sh` § 3b, which denies that shape and names this
# script as the sanctioned one. The rule is stated identically there and in
# `.claude/skills/next-issue/SKILL.md`; `scripts/__tests__/gate-run.test.ts`
# fails if the two texts ever drift apart.
#
# Usage:
#   sh scripts/gate-run.sh <bun-script> [args...]     # e.g. check:lane
#   bun run gate:run check:lane
#
# Env:
#   TOLARIA_GATE_RUN_WAIT_SECS  seconds this call may block (default 480)
#   TOLARIA_GATE_RUN_POLL_SECS  poll interval (default 2)
#   TOLARIA_GATE_RUN_TAIL       log lines printed with the verdict (default 60)
#   TOLARIA_GATE_RUN_DIR        where run state lives (default under the cache)
#
# Exit codes: the gate's own on completion; 75 = still running, call again;
# 2 = usage; 70 = the detached runner vanished without writing an exit code.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

if [ $# -eq 0 ]; then
    echo "gate-run: usage: gate-run.sh <bun-script> [args...]" >&2
    exit 2
fi

WAIT_SECS="${TOLARIA_GATE_RUN_WAIT_SECS:-480}"
POLL_SECS="${TOLARIA_GATE_RUN_POLL_SECS:-2}"
TAIL_LINES="${TOLARIA_GATE_RUN_TAIL:-60}"
# NOT inside the worktree: `bun run land` removes the worktree (with anything
# written in it) the moment it merges, and a run's log is most wanted exactly
# when the pass that produced it is gone.
RUN_ROOT="${TOLARIA_GATE_RUN_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/tolaria/gate-runs}"

for _v in "wait-secs:$WAIT_SECS" "poll-secs:$POLL_SECS" "tail:$TAIL_LINES"; do
    case "${_v#*:}" in
        '' | *[!0-9]*)
            echo "gate-run: ${_v%%:*} must be a non-negative integer, got: '${_v#*:}'" >&2
            exit 2
            ;;
    esac
done
[ "$POLL_SECS" -gt 0 ] || POLL_SECS=1

# One run dir per (cwd, command). The cwd is part of the key because two
# worktrees gating concurrently are two different runs of the same script —
# attaching one to the other's log would report the wrong tree's verdict.
_key=$(printf '%s|%s' "$(pwd)" "$*" | cksum | tr -cd '0-9')
_safe=$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-')
RUN_DIR="$RUN_ROOT/$_safe-$_key"
LOG="$RUN_DIR/log"
RC="$RUN_DIR/rc"
PIDF="$RUN_DIR/pid"
STARTF="$RUN_DIR/started"

mkdir -p "$RUN_DIR"

is_alive() {
    [ -n "${1:-}" ] || return 1
    kill -0 "$1" 2>/dev/null
}

# Attach to a live run, or start one. A run is LIVE when its pid is still
# running and no exit code has been written yet; anything else (no pid, a dead
# pid, a leftover `rc` from a verdict already reported) means this call owns a
# fresh run.
attached=0
if [ ! -f "$RC" ] && [ -f "$PIDF" ] && is_alive "$(cat "$PIDF" 2>/dev/null)"; then
    attached=1
fi

if [ "$attached" -eq 0 ]; then
    rm -f "$RC" "$PIDF"
    : >"$LOG"
    date +%s >"$STARTF"
    # `set -m` puts the background job in its OWN process group, so a
    # group-directed signal aimed at the dying pass does not reach the gate;
    # `trap '' HUP` covers the hangup that reaches it anyway. Together they are
    # what makes the run outlive the call that started it — the whole point.
    set -m 2>/dev/null || true
    (
        trap '' HUP INT
        # `set +e` is load-bearing, not tidiness: this file runs under
        # `set -eu`, which the subshell inherits, so a RED gate would kill the
        # subshell on the spot and the `echo $?` below would never run. The
        # caller would then see a vanished runner (exit 70) instead of the
        # gate's own exit code — the same "the verdict was thrown away"
        # failure this whole script exists to remove.
        set +e
        bun run "$@" >"$LOG" 2>&1
        echo $? >"$RC"
    ) </dev/null >/dev/null 2>&1 &
    _pid=$!
    set +m 2>/dev/null || true
    printf '%s\n' "$_pid" >"$PIDF"
    echo "gate-run: started \`bun run $*\` detached (pid $_pid, log: $LOG)." >&2
else
    _pid=$(cat "$PIDF")
    echo "gate-run: re-attached to the running \`bun run $*\` (pid $_pid, log: $LOG)." >&2
fi

waited=0
while [ ! -f "$RC" ] && [ "$waited" -lt "$WAIT_SECS" ]; do
    if ! is_alive "$_pid"; then
        # The runner is gone. Give the `echo $? >"$RC"` that follows the gate
        # one beat to land before calling it a vanished run — the two events
        # are adjacent, not simultaneous.
        sleep 1
        break
    fi
    sleep "$POLL_SECS"
    waited=$((waited + POLL_SECS))
done

_started=$(cat "$STARTF" 2>/dev/null || echo "")
case "$_started" in
    '' | *[!0-9]*) _elapsed="?" ;;
    *) _elapsed=$(( $(date +%s) - _started )) ;;
esac

if [ -f "$RC" ]; then
    rc=$(cat "$RC" 2>/dev/null || echo "")
    case "$rc" in
        '' | *[!0-9]*) rc=1 ;;
    esac
    # Report AND CLEAR: the next invocation of the same command must start a
    # new gate, never re-print a verdict from a tree that has moved on.
    rm -f "$RC" "$PIDF"
    echo "gate-run: \`bun run $*\` — exit=$rc after ${_elapsed}s (log: $LOG)"
    [ "$TAIL_LINES" -eq 0 ] || tail -n "$TAIL_LINES" "$LOG"
    exit "$rc"
fi

if ! is_alive "$_pid"; then
    echo "gate-run: \`bun run $*\` — the detached runner (pid $_pid) is gone and wrote no exit code after ${_elapsed}s. Log: $LOG" >&2
    tail -n 20 "$LOG" >&2 || true
    rm -f "$PIDF"
    exit 70
fi

echo "gate-run: \`bun run $*\` — STILL RUNNING after ${_elapsed}s (pid $_pid, log: $LOG)."
echo "gate-run: re-run the IDENTICAL command to keep waiting — it re-attaches to this run, it never starts a second gate."
tail -n 5 "$LOG" || true
exit 75

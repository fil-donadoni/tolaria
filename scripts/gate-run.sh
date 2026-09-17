#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# gate-run — run a gate so that NO single call can outlive the tool cap
# (issue #3698).
#
# THE PROBLEM. The Bash tool caps one call (default 120s, max 600s) and, on
# expiry, promotes the command to the background on its own — the caller never
# opts in. The pre-PR gate queued behind the machine-wide gate mutex routinely
# outlives that cap. Once promoted, an unattended pass has no legal way to
# wait: it reports that it is waiting and ends its turn, and under `claude -p`
# the end of a turn is the end of the PROCESS. The gate is SIGTERMed mid-run
# and its verdict is never read — in the last recorded occurrence the gate had
# already passed 235 test files / 2830 tests when it was killed. Roughly 20 of
# ~75 recorded AFK pass logs end on this shape.
#
# THE SHAPE THAT CANNOT BE PROMOTED. Split "run the gate" from "wait for the
# gate":
#
#   1. The gate itself runs in its OWN process group (`set -m`), detached from
#      this call, writing its output to a log and its exit code to an `rc`
#      file. It therefore survives both the tool's promotion and the death of
#      the pass that started it.
#   2. THIS call then waits in the foreground for at most WAIT_SECS (default
#      480) and returns either the gate's real exit code, or exit 75 meaning
#      "still running, ask again".
#   3. Re-running the IDENTICAL command re-attaches to the same run. It never
#      starts a second gate, and the gate never loses its place in the mutex
#      queue. A run that FINISHED while nobody was waiting is not thrown away
#      either: its exit code is handed to the next call, as long as the tree is
#      still the tree that was gated (see HEAD_F below).
#
# So every call returns inside the cap, no turn ever ends while a gate is
# running, and the exit code is read by the same pass that started it.
#
# **The caller still owns the tool timeout.** 480s is under the tool's 600s
# MAXIMUM, not under its 120s DEFAULT — a call issued without an explicit
# `timeout` is promoted at 120s however patient this script is. The rule in
# `.claude/hooks/deny-guard.sh` § 3b and `.claude/skills/next-issue/SKILL.md`
# says to pass `timeout: 600000`; `TOLARIA_GATE_RUN_WAIT_SECS` is the knob for
# a caller that cannot.
#
# WHY NOT `run_in_background`. It throws the verdict away — see
# `.claude/hooks/deny-guard.sh` § 3b, which denies that shape and names this
# script as the sanctioned one. The rule is stated identically there and in
# `.claude/skills/next-issue/SKILL.md`;
# `scripts/__tests__/gate-rule-parity.test.ts` fails if the two texts drift.
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
#   TOLARIA_GATE_RUN_KEEP_DAYS  prune run dirs older than this (default 7)
#   TOLARIA_GATE_RUN_KEY        name this run instead of keying it on the cwd
#                               (for `land`, which deletes the cwd it ran from)
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
KEEP_DAYS="${TOLARIA_GATE_RUN_KEEP_DAYS:-7}"
# NOT inside the worktree: `bun run land` removes the worktree (with anything
# written in it) the moment it merges, and a run's log is most wanted exactly
# when the pass that produced it is gone.
RUN_ROOT="${TOLARIA_GATE_RUN_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/tolaria/gate-runs}"

for _v in "wait-secs:$WAIT_SECS" "poll-secs:$POLL_SECS" "tail:$TAIL_LINES" \
    "keep-days:$KEEP_DAYS"; do
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
#
# TOLARIA_GATE_RUN_KEY replaces the cwd component when the cwd is not a stable
# name for the run (issue #3706). The case that forces this is `land`: it runs
# from the PR's own worktree — it refuses to run from the base branch — and it
# DELETES that worktree when it merges. So a `land` that returns 75 leaves the
# next call with a cwd that no longer exists, and a call from anywhere else
# computes a different key and starts a SECOND `land`, re-paying the whole
# gate. With an explicit key the same run is addressable from any directory.
_key_scope="${TOLARIA_GATE_RUN_KEY:-}"
[ -n "$_key_scope" ] || _key_scope="$(pwd)"
# A NEWLINE between scope and command, not `|`: the scope is now free text a
# caller chooses, and `a|b` + `c` must not hash the same as `a` + `b|c`.
_key=$(printf '%s\n%s' "$_key_scope" "$*" | cksum | tr -cd '0-9')
_safe=$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-')
RUN_DIR="$RUN_ROOT/$_safe-$_key"
LOG="$RUN_DIR/log"
RC="$RUN_DIR/rc"
PIDF="$RUN_DIR/pid"
PIDSTART="$RUN_DIR/pidstart"
HEAD_F="$RUN_DIR/head"
BASE_F="$RUN_DIR/base"
CMD_F="$RUN_DIR/command"
GREEN_F="$RUN_DIR/green"
STARTF="$RUN_DIR/started"
LOCK="$RUN_DIR/.lock"

mkdir -p "$RUN_DIR"

# One gate log per (cwd, command) and worktree paths are ephemeral, so the set
# grows without bound otherwise — and "disk full kills gates" is a failure this
# machine has already had. Non-fatal by construction: a janitor that takes down
# a gate is worse than the disk it was saving.
if [ "$KEEP_DAYS" -gt 0 ] && [ -d "$RUN_ROOT" ]; then
    find "$RUN_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+$KEEP_DAYS" \
        -exec rm -rf {} + 2>/dev/null || true
fi

is_alive() {
    [ -n "${1:-}" ] || return 1
    kill -0 "$1" 2>/dev/null
}

# A pid ALONE is not an identity. The run dir outlives the process, macOS
# recycles pids within hours, and a recycled pid reads as "still running"
# forever: every later call re-attaches, waits the ceiling, exits 75, and the
# gate is never started — silently, with the PREVIOUS run's log tail as the
# diagnostic. So the pid is paired with the process's own start stamp, the same
# primitive `loop-doctor.ts` uses to join a claim to a live process (#2627).
# Unreadable stamp → treated as NOT ours, which starts a fresh run: the safe
# direction, since a duplicate gate is visible and a wedged one is not.
#
# The stamp is `lstart` AND the full command line, not `lstart` alone:
# `ps -o lstart=` has one-second resolution, so a pid recycled onto a process
# that happens to have started in the same second reads as identical. The
# command line is what actually says "this is the gate we launched".
pid_ident() {
    ps -o lstart=,command= -p "$1" 2>/dev/null | head -1 | tr -s ' ' || true
}

git_head() {
    git rev-parse HEAD 2>/dev/null || echo ""
}

# The base tip the gate ran against: `origin/<base>`, the base branch named in
# `tolaria.config.json` (read with jq, the way `deny-guard.sh` reads it — no
# branch literal lives here). Empty when there is no repo, no config or no such
# ref, and an empty base can never match anything `land` compares it with.
git_base() {
    _cfg="$(git rev-parse --show-toplevel 2>/dev/null || echo .)/tolaria.config.json"
    _branch=$(jq -r '.branches.base // empty' "$_cfg" 2>/dev/null || true)
    [ -n "$_branch" ] || { echo ""; return 0; }
    git rev-parse --verify --quiet "origin/$_branch" 2>/dev/null || echo ""
}

# The attach-or-start decision is the one critical section: two concurrent
# identical calls that both read "no live pid" both start a gate, both truncate
# the shared log, and the second's pid file overwrites the first's — so one
# run's verdict gets reported for the other and the loser is orphaned and
# untracked. `mkdir` is the portable atomic test-and-set. A lock older than the
# ceiling is stale by definition (nothing holds it across a wait; the wait
# happens outside it) and is stolen rather than waited on.
lock_acquire() {
    _i=0
    while [ "$_i" -lt 30 ]; do
        if mkdir "$LOCK" 2>/dev/null; then
            return 0
        fi
        if [ -d "$LOCK" ] && [ -z "$(find "$LOCK" -maxdepth 0 -mmin -5 2>/dev/null)" ]; then
            rm -rf "$LOCK" 2>/dev/null || true
            continue
        fi
        sleep 1
        _i=$((_i + 1))
    done
    # Never fail the gate over the lock — proceed unsynchronised rather than
    # refuse to run, and say so.
    echo "gate-run: could not take the run lock after 30s; proceeding without it." >&2
    return 0
}

lock_release() {
    rmdir "$LOCK" 2>/dev/null || rm -rf "$LOCK" 2>/dev/null || true
}

lock_acquire
trap 'lock_release' EXIT INT TERM

# ── attach to a live run, report a finished one, or start a fresh one ───────
attached=0
finished=0
_pid=$(cat "$PIDF" 2>/dev/null || echo "")

if [ ! -f "$RC" ] && is_alive "$_pid" &&
    [ "$(pid_ident "$_pid")" = "$(cat "$PIDSTART" 2>/dev/null || echo "")" ] &&
    [ -s "$PIDSTART" ]; then
    attached=1
elif [ -f "$RC" ] &&
    { [ -n "${TOLARIA_GATE_RUN_KEY:-}" ] ||
        [ "$(cat "$HEAD_F" 2>/dev/null || echo "-")" = "$(git_head)" ]; }; then
    # A gate that COMPLETED while nobody was waiting. Handing its exit code to
    # the next call is the whole point — discarding it would be issue #3698's
    # own "the verdict was thrown away", relocated one step later. It is only
    # safe while the tree has not moved, which is what the recorded HEAD is
    # for: a rebase, a new commit or an amend makes the verdict describe a tree
    # nobody is landing, and that one is discarded.
    #
    # EXCEPT under an explicit key (issue #3706). The HEAD check reads the
    # CALLER's cwd, and a named run exists precisely so the follow-up call can
    # come from somewhere else — the primary checkout, after `land` deleted
    # the worktree. That checkout is on another branch with another HEAD, so
    # the check would always fail there, discard a `land` that may already
    # have MERGED, and start a second one that `land` refuses from the base
    # branch — reporting a successful landing as a failure. The key is the
    # caller's own assertion that this is the same run; it is taken at its
    # word.
    finished=1
fi

if [ "$attached" -eq 0 ] && [ "$finished" -eq 0 ]; then
    rm -f "$RC" "$PIDF" "$PIDSTART" "$GREEN_F"
    : >"$LOG"
    date +%s >"$STARTF"
    git_head >"$HEAD_F"
    # (head, base, command, green) is the record `land` reads to skip a lane it
    # would pay a second time on the same tree (ADR 0136 §2): the rebased tip
    # equal to `head`, the base tip equal to `base`, `command` exactly
    # `check:lane`, and `green` present. `green` is removed above BEFORE
    # `head`/`base` are rewritten, so a half-written record never reads as a
    # green run of the new tree.
    git_base >"$BASE_F"
    printf '%s\n' "$*" >"$CMD_F"
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
        # The run's NAME is this call's business, not the gate's. Left in the
        # environment, it reaches every descendant of the gate — and a gate
        # that itself drives `gate-run.sh` (the suite does, in its tests) would
        # then collapse every one of its own runs onto the parent's key. That
        # is not hypothetical: `TOLARIA_GATE_RUN_KEY=land-N bun run gate:run
        # land N` turned the keyless-default test red inside `land`'s own gate
        # (PR #3707).
        unset TOLARIA_GATE_RUN_KEY
        bun run "$@" >"$LOG" 2>&1
        _rc=$?
        # `green` outlives the `rc` file on purpose: `rc` is cleared the moment
        # a caller reads the verdict, `green` stays until the next run of the
        # same command in the same place starts — it is what `land` reads.
        [ "$_rc" -ne 0 ] || : >"$GREEN_F"
        echo "$_rc" >"$RC"
    ) </dev/null >/dev/null 2>&1 &
    _pid=$!
    set +m 2>/dev/null || true
    printf '%s\n' "$_pid" >"$PIDF"
    pid_ident "$_pid" >"$PIDSTART"
    echo "gate-run: started \`bun run $*\` detached (pid $_pid, log: $LOG)." >&2
elif [ "$attached" -eq 1 ]; then
    echo "gate-run: re-attached to the running \`bun run $*\` (pid $_pid, log: $LOG)." >&2
else
    echo "gate-run: \`bun run $*\` already finished while nobody was waiting — reporting its exit code." >&2
fi

lock_release
trap - EXIT INT TERM

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
    *) _elapsed=$(($(date +%s) - _started)) ;;
esac

if [ -f "$RC" ]; then
    rc=$(cat "$RC" 2>/dev/null || echo "")
    case "$rc" in
        '' | *[!0-9]*) rc=1 ;;
    esac
    # Report AND CLEAR: the verdict has now been read, so the next invocation
    # of the same command must gate the tree again rather than re-print it.
    rm -f "$RC" "$PIDF" "$PIDSTART"
    echo "gate-run: \`bun run $*\` — exit=$rc after ${_elapsed}s (log: $LOG)"
    # `|| true` is not decoration: `tail` is the last command of this OR-list,
    # so under `set -e` an unreadable log would abort the script BEFORE
    # `exit "$rc"` and report 1 for a green gate.
    [ "$TAIL_LINES" -eq 0 ] || tail -n "$TAIL_LINES" "$LOG" || true
    exit "$rc"
fi

if ! is_alive "$_pid"; then
    echo "gate-run: \`bun run $*\` — the detached runner (pid $_pid) is gone and wrote no exit code after ${_elapsed}s. Log: $LOG" >&2
    tail -n 20 "$LOG" >&2 || true
    rm -f "$PIDF" "$PIDSTART"
    exit 70
fi

echo "gate-run: \`bun run $*\` — STILL RUNNING after ${_elapsed}s (pid $_pid, log: $LOG)."
echo "gate-run: re-run the IDENTICAL command to keep waiting — it re-attaches to this run, it never starts a second gate."
tail -n 5 "$LOG" || true
exit 75

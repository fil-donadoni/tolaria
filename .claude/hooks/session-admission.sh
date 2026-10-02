#!/bin/sh
# UserPromptSubmit gate — machine admission for EVERY session (issue #4966).
#
# `sessions.cap` used to be enforced on `queue:plan` / `queue:claim` alone: it
# counted CLAIMS. A session opened by hand, an interactive audit, a fourth
# terminal — none of them claims anything, so none of them was counted, and the
# machine they saturated turned other sessions' gates red (issue #4966 carries
# the measurements). This hook is the cap applied to the session itself.
#
# It refuses the FIRST prompt of a session — exit 2, which blocks the prompt
# and shows stderr to the user — when the live project sessions already fill
# the effective cap, or memory is under sustained pressure beside them. The
# refusal names the live sessions and the one escape: `TOLARIA_OVER_CAP=1
# claude`, announced and logged like `--no-cap`. Until it is admitted a session
# is asked again on every prompt; once admitted it is stamped with the pid of
# its `claude` process and not asked again while that process lives, so the
# cost after the first prompt is one `jq`, one `read` and one `kill -0`. A
# `claude --resume` keeps the session id and is a NEW process — a new arrival
# on the machine — so its stamp no longer holds and it is asked again.
#
# The DECISION is not here: `scripts/lib/machine-admission.ts` owns it, and
# `queue:claim` and `wt:new` take the same one. This file only finds the
# session id, short-circuits an admitted session, and maps the exit code.
#
# FAILS OPEN. A missing `bun`, a probe that throws, a payload with no session
# id: the prompt goes through, with a line on stderr. A hook that locked every
# session out on its own bug would lock out the session that fixes it.

set -u

payload=$(cat)
session=$(printf '%s' "$payload" | jq -r '.session_id // ""' 2>/dev/null)
case "$session" in
'' | *[!A-Za-z0-9_-]*) exit 0 ;;
esac

# Same root as the gate's locks (`scripts/gate.ts` LOCK_ROOT): outside the
# repo, so the hook of every worktree reads the same stamps.
stamps="${TOLARIA_GATE_LOCK_ROOT:-$HOME/.cache/tolaria}/sessions"
if [ -r "$stamps/$session" ]; then
    read -r admitted <"$stamps/$session" || admitted=""
    case "$admitted" in
    -) exit 0 ;; # admitted under no `claude` process: nothing to outlive
    '' | *[!0-9]*) ;; # unreadable: ask again
    *) kill -0 "$admitted" 2>/dev/null && exit 0 ;;
    esac
fi

# The scripts beside THIS hook, not `$CLAUDE_PROJECT_DIR`'s: a session started
# in a worktree runs that worktree's copy of both.
here=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd) || exit 0
command -v bun >/dev/null 2>&1 || exit 0

# stdout passes through (an override's one-line notice, added to the
# session's context); stderr is held back and shown only on a refusal.
exec 3>&1
err=$(bun "$here/scripts/machine.ts" admit-session "$session" 2>&1 1>&3)
rc=$?
exec 3>&-

if [ "$rc" -eq 2 ]; then
    printf '%s\n' "$err" >&2
    exit 2
fi
[ "$rc" -eq 0 ] ||
    printf 'session-admission: the probe failed (exit %s) — admitting: %s\n' "$rc" "$err" >&2
exit 0

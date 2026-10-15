#!/usr/bin/env bash
# Runs a command whose output must never reach a public job log (ADR 0156
# Amendment I § Public logs, issue #5636): every signed-in GitHub user can read
# this repository's logs, and a Claude transcript may quote anything the
# session read. The output goes to a file ON THE MACHINE; the log gets one
# line — the exit code and where the file is.
#
#   scripts/ci/run-quiet.sh <name> -- <command> [args…]
#
# The structure guard (scripts/__tests__/workflow-structure.test.ts) refuses a
# workflow step that runs `claude` without this wrapper.
set -uo pipefail

name="${1:-}"
[ -n "$name" ] && [ "${2:-}" = "--" ] && [ $# -ge 3 ] || {
    echo "usage: run-quiet.sh <name> -- <command> [args…]" >&2
    exit 2
}
shift 2
case "$name" in
*/* | .*) echo "run-quiet: bad name '$name'" >&2 && exit 2 ;;
esac

dir="${TOLARIA_JOB_LOG_DIR:-$HOME/.cache/tolaria/jobs}/${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}"
mkdir -p "$dir"
log="$dir/$name.log"
"$@" >"$log" 2>&1
rc=$?
echo "run-quiet: $name exited $rc — output kept on $(hostname) at $log, not in this log"
exit "$rc"

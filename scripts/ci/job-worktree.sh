#!/usr/bin/env bash
# The job worktree of a self-hosted runner (ADR 0156 Amendment I, issue #5636).
#
# A job on one of the owner's machines never clones: it works in a git
# worktree of the machine's primary checkout, so `primaryCheckout()` — the
# Convex deployment, `.env.local`, `convex/_generated`, the merge drivers, the
# telemetry — resolves exactly as in an interactive session. The worktree IS
# the job's `$GITHUB_WORKSPACE`, so every later step (a local `uses: ./…`
# included) runs in it with no `working-directory`.
#
#   job-worktree.sh create [<ref>]   # default ref: $GITHUB_SHA
#   job-worktree.sh remove           # the job's last step, `if: always()`
#
# A workflow cannot run a script it has not checked out yet, so the first
# step of a self-hosted job reads THIS file at the job's own commit out of the
# primary's object store (docs/guides/github-pipeline.md § Jobs):
#
#   git -C "$TOLARIA_PRIMARY_CHECKOUT" fetch --no-tags --no-write-fetch-head --quiet origin "$GITHUB_SHA"
#   git -C "$TOLARIA_PRIMARY_CHECKOUT" show "$GITHUB_SHA:scripts/ci/job-worktree.sh" | bash -s -- create
#
# `TOLARIA_PRIMARY_CHECKOUT` comes from the runner's unit (`bun run runner
# install`). The job's commit is held by `refs/ci/<runner name>` — one ref per
# runner, and a runner runs one job at a time, so concurrent jobs on one
# machine never share a ref; every fetch here skips FETCH_HEAD, which the
# primary's git dir shares with every runner and the owner's own `git pull`.
#
# `remove` leaves an EMPTY workspace directory behind: the runner still runs
# the actions' post steps there after the job's last step.
set -euo pipefail

die() {
    echo "job-worktree: $*" >&2
    exit 1
}

primary="${TOLARIA_PRIMARY_CHECKOUT:-}"
ws="${GITHUB_WORKSPACE:-}"
runner="${RUNNER_NAME:-}"
runner_ws="${RUNNER_WORKSPACE:-}"
repo="${GITHUB_REPOSITORY:-}"
[ -n "$primary" ] || die "TOLARIA_PRIMARY_CHECKOUT is unset — re-run \`bun run runner install\` on this machine"
[ -d "$primary/.git" ] || die "$primary is not a primary checkout (no .git directory)"
[ -n "$ws" ] || die "GITHUB_WORKSPACE is unset — this runs inside a GitHub Actions job only"
[ -n "$runner" ] && [ -n "$runner_ws" ] && [ -n "$repo" ] ||
    die "RUNNER_NAME, RUNNER_WORKSPACE or GITHUB_REPOSITORY is unset — this runs inside a GitHub Actions job only"

# The workspace is deleted and recreated below: refuse anything but EXACTLY
# the runner's own `<RUNNER_WORKSPACE>/<repo>` directory under `_work/`, with
# no `..`, and never one nesting with the primary (compared resolved).
[ "$ws" = "$runner_ws/${repo#*/}" ] ||
    die "refusing workspace $ws — not \$RUNNER_WORKSPACE/<repo>"
case "$ws" in
*/../* | */.. | */./*) die "refusing workspace $ws — not a canonical path" ;;
*/_work/*/*) ;;
*) die "refusing workspace $ws — not a runner's _work/<repo>/<repo> directory" ;;
esac
real_primary="$(cd "$primary" && pwd -P)"
real_ws_parent="$(mkdir -p "$(dirname "$ws")" && cd "$(dirname "$ws")" && pwd -P)"
real_ws="$real_ws_parent/$(basename "$ws")"
case "$real_ws/" in
"$real_primary/"*) die "refusing workspace $ws — inside the primary checkout" ;;
esac
case "$real_primary/" in
"$real_ws/"*) die "refusing workspace $ws — contains the primary checkout" ;;
esac

ref_name="refs/ci/$runner"
git_p() { git -C "$primary" "$@"; }

# A ref lock taken by a sibling job's fetch is transient: retry, never fail.
fetch() {
    local n
    for n in 1 2 3 4 5; do
        git_p fetch --no-tags --no-write-fetch-head --quiet origin "$@" && return 0
        sleep "$n"
    done
    die "git fetch origin $* failed 5 times"
}

# A killed job leaves its worktree registered — LOCKED, when it died inside
# `worktree add` ("initializing"): `-f -f` removes a locked one, and prune
# skips locked entries, so drop it before reusing the path.
forget_workspace() {
    if git_p worktree list --porcelain | grep -qxF "worktree $ws"; then
        git_p worktree remove -f -f "$ws" || true
    fi
    git_p worktree prune
}

case "${1:-}" in
create)
    ref="${2:-${GITHUB_SHA:-}}"
    [ -n "$ref" ] || die "no ref given and GITHUB_SHA is unset"
    forget_workspace
    rm -rf "$ws"
    # Every base branch too: `check:lane` diffs against origin/<base>.
    fetch "+refs/heads/*:refs/remotes/origin/*" "+$ref:$ref_name"
    sha="$(git_p rev-parse "$ref_name^{commit}")"
    git_p worktree add -f -f --detach --quiet "$ws" "$sha"
    echo "job-worktree: $ws at $sha (worktree of $primary)"
    ;;
remove)
    forget_workspace
    git_p update-ref -d "$ref_name" 2>/dev/null || true
    rm -rf "$ws"
    mkdir -p "$ws"
    echo "job-worktree: removed $ws"
    ;;
*)
    die "usage: job-worktree.sh create [<ref>] | remove"
    ;;
esac

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
#   git -C "$TOLARIA_PRIMARY_CHECKOUT" fetch --no-tags --quiet origin "$GITHUB_SHA"
#   git -C "$TOLARIA_PRIMARY_CHECKOUT" show "$GITHUB_SHA:scripts/ci/job-worktree.sh" | bash -s -- create
#
# `TOLARIA_PRIMARY_CHECKOUT` comes from the runner's unit (`bun run runner
# install`). The job's commit is held by `refs/ci/<runner name>` — one ref per
# runner, and a runner runs one job at a time, so concurrent jobs on one
# machine never share a ref (nor race on FETCH_HEAD).
set -euo pipefail

die() {
    echo "job-worktree: $*" >&2
    exit 1
}

primary="${TOLARIA_PRIMARY_CHECKOUT:-}"
ws="${GITHUB_WORKSPACE:-}"
runner="${RUNNER_NAME:-}"
[ -n "$primary" ] || die "TOLARIA_PRIMARY_CHECKOUT is unset — re-run \`bun run runner install\` on this machine"
[ -d "$primary/.git" ] || die "$primary is not a primary checkout (no .git directory)"
[ -n "$ws" ] || die "GITHUB_WORKSPACE is unset — this runs inside a GitHub Actions job only"
[ -n "$runner" ] || die "RUNNER_NAME is unset — this runs inside a GitHub Actions job only"

# The workspace is deleted and recreated below: refuse anything that is not
# the runner's own `_work/<repo>/<repo>` directory, and never the primary.
case "$ws" in
*/_work/*/*) ;;
*) die "refusing workspace $ws — not a runner's _work/<repo>/<repo> directory" ;;
esac
case "$ws/" in
"$primary/"*) die "refusing workspace $ws — inside the primary checkout" ;;
esac
case "$primary/" in
"$ws/"*) die "refusing workspace $ws — contains the primary checkout" ;;
esac

ref_name="refs/ci/$runner"
git_p() { git -C "$primary" "$@"; }

# A ref lock taken by a sibling job's fetch is transient: retry, never fail.
fetch() {
    local n
    for n in 1 2 3 4 5; do
        git_p fetch --no-tags --quiet origin "$@" && return 0
        sleep "$n"
    done
    die "git fetch origin $* failed 5 times"
}

# A killed job leaves its worktree registered: drop it before reusing the path.
forget_workspace() {
    if git_p worktree list --porcelain | grep -qxF "worktree $ws"; then
        git_p worktree remove --force "$ws" || true
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
    git_p worktree add --detach --quiet "$ws" "$sha"
    echo "job-worktree: $ws at $sha (worktree of $primary)"
    ;;
remove)
    forget_workspace
    git_p update-ref -d "$ref_name" 2>/dev/null || true
    echo "job-worktree: removed $ws"
    ;;
*)
    die "usage: job-worktree.sh create [<ref>] | remove"
    ;;
esac

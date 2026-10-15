#!/usr/bin/env bash
# Puts the bun `.bun-version` pins on the job's PATH (issue #5636).
#
# Installed from npm into the runner's own tool cache — never `~/.bun`, which
# on a self-hosted runner is the owner's interactive bun, and never a
# third-party action, which the repository's actions allow-list would have to
# name. `actions/setup-node` runs first: it provides the npm used here.
set -euo pipefail

want="$(tr -d '[:space:]' <.bun-version)"
[ -n "$want" ] || {
    echo "setup-bun: .bun-version is empty" >&2
    exit 1
}
dir="${RUNNER_TOOL_CACHE:?}/tolaria-bun/$want/$(uname -s)-$(uname -m)"
have="$("$dir/bin/bun" --version 2>/dev/null || true)"
if [ "$have" != "$want" ]; then
    rm -rf "$dir"
    npm install --global --prefix "$dir" --no-fund --no-audit --loglevel=error "bun@$want" >/dev/null
    have="$("$dir/bin/bun" --version)"
    [ "$have" = "$want" ] || {
        echo "setup-bun: installed bun reports $have, wanted $want" >&2
        exit 1
    }
fi
echo "$dir/bin" >>"${GITHUB_PATH:?}"
echo "setup-bun: bun $have from $dir"

#!/usr/bin/env bash
# Puts the node `.nvmrc` pins on the job's PATH (issue #5636).
#
# The official nodejs.org build, unpacked into the runner's own tool cache.
# A script and not `actions/setup-node`: an action nested in the job setup
# brings a POST step, and the runner runs post steps AFTER the job's last
# step — on a self-hosted runner that is after the job worktree is gone, so
# the runner can no longer read the composite action and fails the job.
set -euo pipefail

want="$(tr -d '[:space:]v' <.nvmrc)"
[ -n "$want" ] || {
    echo "setup-node: .nvmrc is empty" >&2
    exit 1
}
case "$(uname -s)" in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) echo "setup-node: unsupported OS $(uname -s)" >&2 && exit 1 ;;
esac
case "$(uname -m)" in
arm64 | aarch64) arch=arm64 ;;
x86_64) arch=x64 ;;
*) echo "setup-node: unsupported arch $(uname -m)" >&2 && exit 1 ;;
esac
dir="${RUNNER_TOOL_CACHE:?}/tolaria-node/$want/$os-$arch"
have="$("$dir/bin/node" --version 2>/dev/null || true)"
if [ "$have" != "v$want" ]; then
    rm -rf "$dir"
    mkdir -p "$dir"
    curl -fsSL "https://nodejs.org/dist/v$want/node-v$want-$os-$arch.tar.gz" |
        tar -xz -C "$dir" --strip-components 1
    have="$("$dir/bin/node" --version)"
    [ "$have" = "v$want" ] || {
        echo "setup-node: installed node reports $have, wanted v$want" >&2
        exit 1
    }
fi
echo "$dir/bin" >>"${GITHUB_PATH:?}"
echo "setup-node: node $have from $dir"

#!/usr/bin/env bash
# Ralph loop — Tolaria
# See .ralph/AGENTS.md for the operator manual.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

MAX_ITERS="${RALPH_MAX_ITERS:-15}"
PROMPT_FILE="$ROOT/.ralph/PROMPT.md"
LOG_DIR="$ROOT/.ralph/logs"
SENTINEL_DONE="<promise>NO_WORK</promise>"
SENTINEL_HALT="<promise>HALT</promise>"
MAIN_BRANCH="main"

mkdir -p "$LOG_DIR"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "✗ Missing $PROMPT_FILE" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "✗ Working tree dirty. Commit or stash before running ralph." >&2
  exit 1
fi

CUR_BRANCH="$(git branch --show-current)"
if [[ "$CUR_BRANCH" != "$MAIN_BRANCH" ]]; then
  echo "✗ Must start from '$MAIN_BRANCH' (currently on '$CUR_BRANCH')." >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "✗ 'claude' CLI not found in PATH." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "✗ 'gh' not authenticated. Run 'gh auth login'." >&2
  exit 1
fi

trap 'echo; echo "Interrupted at iter $i. Last log: $LOG"; exit 130' INT

# Stacked PRs: each iter branches from local main (which accumulates prior
# iters' commits via local --no-ff merge). PRs are opened with base set to
# the previous iter's branch so the GitHub diff stays scoped to that iter
# alone. Operator MUST reset local main to origin/main between loop runs
# after human merges land on remote (loop deliberately skips `git pull` to
# avoid clobbering the locally-stacked main).
PREV_BRANCH=""
export RALPH_PREV_BRANCH=""

for ((i=1; i<=MAX_ITERS; i++)); do
  TS="$(date +%Y%m%d-%H%M%S)"
  LOG="$LOG_DIR/iter-${i}-${TS}.log"
  echo "════════ Iter $i / $MAX_ITERS  ($TS) ════════"
  echo "log: $LOG"

  git checkout "$MAIN_BRANCH" >/dev/null 2>&1 || true

  export RALPH_PREV_BRANCH="$PREV_BRANCH"
  claude -p --permission-mode=acceptEdits < "$PROMPT_FILE" 2>&1 | tee "$LOG"

  if grep -qF "$SENTINEL_DONE" "$LOG"; then
    echo "✓ No work left. Exiting."
    exit 0
  fi
  if grep -qF "$SENTINEL_HALT" "$LOG"; then
    echo "✗ Agent halted. Inspect log: $LOG"
    exit 2
  fi

  ITER_BRANCH="$(grep -oE '<branch>[^<]+</branch>' "$LOG" | sed -E 's|</?branch>||g' | tail -1)"
  if [[ -z "$ITER_BRANCH" ]]; then
    echo "✗ Could not extract iteration branch from log: $LOG" >&2
    exit 4
  fi

  git checkout "$MAIN_BRANCH" >/dev/null 2>&1
  if ! git merge --no-ff "$ITER_BRANCH" -m "ralph: stack $ITER_BRANCH" >/dev/null; then
    echo "✗ Local merge of $ITER_BRANCH into $MAIN_BRANCH failed. Inspect repo state." >&2
    exit 5
  fi
  PREV_BRANCH="$ITER_BRANCH"
  echo "↳ Stacked $ITER_BRANCH onto local $MAIN_BRANCH. Next iter base = $PREV_BRANCH."
done

echo "⚠ Max iterations ($MAX_ITERS) reached without NO_WORK."
exit 3

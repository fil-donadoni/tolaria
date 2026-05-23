#!/usr/bin/env bash
# Ralph loop — Tolaria
# See .ralph/AGENTS.md for the operator manual.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

for ((i=1; i<=MAX_ITERS; i++)); do
  TS="$(date +%Y%m%d-%H%M%S)"
  LOG="$LOG_DIR/iter-${i}-${TS}.log"
  echo "════════ Iter $i / $MAX_ITERS  ($TS) ════════"
  echo "log: $LOG"

  git checkout "$MAIN_BRANCH" >/dev/null 2>&1 || true
  git pull --ff-only >/dev/null 2>&1 || true

  claude -p --permission-mode=acceptEdits < "$PROMPT_FILE" 2>&1 | tee "$LOG"

  if grep -qF "$SENTINEL_DONE" "$LOG"; then
    echo "✓ No work left. Exiting."
    exit 0
  fi
  if grep -qF "$SENTINEL_HALT" "$LOG"; then
    echo "✗ Agent halted. Inspect log: $LOG"
    exit 2
  fi
done

echo "⚠ Max iterations ($MAX_ITERS) reached without NO_WORK."
exit 3

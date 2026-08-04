#!/bin/sh
# PreToolUse observer — records which issues THIS session claimed
# (issue #2183, PRD #2180).
#
# The Release rule ("a claimed issue must be released on every exit path") is
# the one the loop is least likely to honour on the path that matters: a user
# interrupt or a crash leaves the claim behind, and an orphaned `in-progress`
# label hides ready work from every later pass until someone stumbles on it.
#
# A blind sweep cannot fix that, because several sessions run under the SAME
# GitHub account: their claims are indistinguishable by assignee, so releasing
# "my" claims by assignee would unclaim somebody else's live work. The ledger is
# what makes the sweep safe — it records the claim at the moment this session
# makes it, keyed by session id, so `claim-sweep.sh` can release exactly what
# this session took and nothing else.
#
# Observer only: always exits 0, never blocks. Denial is `deny-guard.sh`'s job.

set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""')
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""')

[ "$tool" = "Bash" ] || exit 0

# `gh issue edit N --add-label in-progress` is the claim. Match the label
# explicitly: an edit that adds some other label is not a claim.
printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+issue[[:space:]]+edit' || exit 0
printf '%s' "$cmd" | grep -Eq -- '--add-label[[:space:]]+in-progress' || exit 0

issue=$(printf '%s' "$cmd" | sed -nE 's/.*gh[[:space:]]+issue[[:space:]]+edit[[:space:]]+#?([0-9]+).*/\1/p')
[ -n "$issue" ] || exit 0

dir="${CLAUDE_PROJECT_DIR:-.}/.claude/telemetry"
mkdir -p "$dir" 2>/dev/null || exit 0

printf '{"ts":%s,"session":"%s","issue":%s,"event":"claim"}\n' \
    "$(date +%s)" "$session" "$issue" >>"$dir/claims.jsonl" 2>/dev/null

exit 0

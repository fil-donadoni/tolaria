#!/bin/sh
# Stop hook — release the claims THIS session took and did not release
# (issue #2183, PRD #2180).
#
# Reads the ledger `claim-ledger.sh` wrote, and for each issue this session
# claimed asks two questions before touching anything:
#
#   * is the `in-progress` label still on it?  (already released → nothing to do)
#   * is there an open PR for it?              (work is in flight → leave it)
#
# Both guards exist because several sessions run under the SAME GitHub account.
# Assignee tells you nothing about WHICH session owns a claim, so ownership here
# comes from the ledger (this session recorded the claim) and liveness from the
# PR — never from `--assignee @me`, which would match every session equally.
#
# Conservative by construction: a release it skips costs one stale label that
# the loop's own stale-claim sweep picks up later; a release it should not have
# made unclaims somebody's live work. It exits 0 in every case — a Stop hook
# that fails must not block the session from ending.

set -u

payload=$(cat 2>/dev/null || printf '{}')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""')
[ -n "$session" ] || exit 0

dir="${CLAUDE_PROJECT_DIR:-.}/.claude/telemetry"
ledger="$dir/claims.jsonl"
[ -f "$ledger" ] || exit 0

command -v gh >/dev/null 2>&1 || exit 0

# Issues this session claimed and has not already released.
claimed=$(jq -r --arg s "$session" '
    select(.session == $s)
    | if .event == "claim" then "+\(.issue)" else "-\(.issue)" end
' "$ledger" 2>/dev/null | awk '
    /^\+/ { open[substr($0,2)] = 1 }
    /^-/  { delete open[substr($0,2)] }
    END   { for (i in open) print i }
')
[ -n "$claimed" ] || exit 0

for issue in $claimed; do
    labels=$(gh issue view "$issue" --json labels -q '[.labels[].name] | join(",")' 2>/dev/null) || continue
    case ",$labels," in
    *,in-progress,*) ;;
    *) continue ;; # already released
    esac

    open_pr=$(gh pr list --state open --search "issue-$issue in:head" --json number -q 'length' 2>/dev/null || printf '0')
    [ "$open_pr" = "0" ] || continue # work is in flight — leave it claimed

    if gh issue edit "$issue" --remove-label in-progress --remove-assignee @me >/dev/null 2>&1; then
        printf '{"ts":%s,"session":"%s","issue":%s,"event":"released"}\n' \
            "$(date +%s)" "$session" "$issue" >>"$ledger" 2>/dev/null
        printf 'released orphaned claim on #%s\n' "$issue" >&2
    fi
done

exit 0

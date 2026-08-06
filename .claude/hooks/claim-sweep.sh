#!/bin/sh
# SessionEnd hook — release the claims THIS session took and did not release
# (issue #2183, PRD #2180; corrected in #2314).
#
# Reads the ledger `claim-ledger.sh` wrote, and for each issue this session
# claimed asks two questions before touching anything:
#
#   * is the `in-progress` label still on it?  (already released → nothing to do)
#   * is there work in flight for it?          (open PR or pushed branch → leave it)
#
# Both guards exist because several sessions run under the SAME GitHub account.
# Assignee tells you nothing about WHICH session owns a claim, so ownership here
# comes from the ledger (this session recorded the claim) and liveness from the
# branch/PR — never from `--assignee @me`, which would match every session
# equally.
#
# Conservative by construction: a release it skips costs one stale label that
# the loop's own stale-claim sweep picks up later (`staleClaims` in
# `queue:plan`, STALE_CLAIM_HOURS); a release it should not have made unclaims
# somebody's live work. It exits 0 in every case — an end-of-session hook that
# fails must not block the session from ending.
#
# TWO CORRECTIONS, both from issue #2314 — the sweep was releasing every claim
# 60–90s after it was made, so the loop's only cross-session lock was inert:
#
#   1. WHICH EVENT. This was mounted on `Stop`, which fires at the end of every
#      assistant TURN, not at the end of the session. The sweep therefore ran
#      while the batch's implement-subagents were still working. It belongs on
#      `SessionEnd` — the only event that means "this session is over, anything
#      it still holds is an orphan". `scripts/__tests__/hook-policy.test.ts`
#      asserts the event by name; registration alone is not enough, since a
#      hook wired to the wrong event runs and does the wrong thing silently.
#
#   2. HOW LIVENESS IS PROBED. This asked `gh pr list --search "issue-N in:head"`.
#      `in:` is a valid qualifier over title/body/comments, NOT over the head
#      branch, so the query matched nothing and returned 0 for every issue —
#      the guard failed OPEN and released claims whose PR was already up. The
#      probe now filters `headRefName` client-side, which is prefix-agnostic
#      (`feat/`, `fix/`, `chore/`) instead of hard-coding the loop's branch
#      naming, and additionally treats a pushed remote branch as in-flight so
#      the window between "branch pushed" and "PR opened" is covered too.

set -u

payload=$(cat 2>/dev/null || printf '{}')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""')
[ -n "$session" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-.}"
dir="$root/.claude/telemetry"
ledger="$dir/claims.jsonl"
[ -f "$ledger" ] || exit 0

command -v gh >/dev/null 2>&1 || exit 0

# Is there work in flight for this issue? Any answer other than a confident
# "no" keeps the claim: the cost of a false negative is a stale label, the cost
# of a false positive is unclaiming somebody's live work.
work_in_flight() {
    _issue=$1

    # An open PR whose head branch ends in `issue-N`. Matched on headRefName
    # rather than through `--search`, which has no head-branch qualifier.
    _prs=$(gh pr list --state open --limit 200 --json headRefName \
        -q "[.[] | select(.headRefName | test(\"(^|/)issue-${_issue}\$\"))] | length" \
        2>/dev/null) || return 0 # gh failed → assume in flight
    [ -n "$_prs" ] || return 0
    [ "$_prs" = "0" ] || return 0

    # A branch pushed but no PR opened yet — the window the PR probe misses.
    if git -C "$root" ls-remote --heads origin "*/issue-${_issue}" 2>/dev/null |
        grep -q .; then
        return 0
    fi

    return 1
}

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

    work_in_flight "$issue" && continue # work is in flight — leave it claimed

    if gh issue edit "$issue" --remove-label in-progress --remove-assignee @me >/dev/null 2>&1; then
        printf '{"ts":%s,"session":"%s","issue":%s,"event":"released"}\n' \
            "$(date +%s)" "$session" "$issue" >>"$ledger" 2>/dev/null
        printf 'released orphaned claim on #%s\n' "$issue" >&2
    fi
done

exit 0

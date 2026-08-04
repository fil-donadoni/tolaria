#!/bin/sh
# PreToolUse deny policy — the loop's invariants, enforced by the runtime
# instead of by a paragraph in a skill file (issue #2183, PRD #2180).
#
# The repo has already proven prose does not hold here: the rule "subagents must
# not run the full suite" was ignored routinely until `scripts/gate.ts` made it
# exit 1, and the skill file says so in as many words. Every rule below is one
# that a model can read, agree with, and then break anyway — because breaking it
# looks locally reasonable in the moment.
#
# Contract: hook JSON on stdin, exit 0 to allow, exit 2 to BLOCK with stderr fed
# back to the model. A denial always says what to do instead: a policy that
# blocks without redirecting just produces a retry loop.
#
# Deliberately hermetic — every decision comes from the payload (`.cwd`,
# `.tool_input.command`) plus git's own worktree metadata, never from an
# environment variable a caller could forge.

set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""')
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""')

[ "$tool" = "Bash" ] || exit 0
[ -n "$cmd" ] || exit 0

deny() {
    printf '%s\n' "$1" >&2
    exit 2
}

# Does the command contain this token as a whole word?
has() {
    printf '%s' "$cmd" | grep -Eq "$1"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. A subagent may not merge a PR.
#
# Merging is the orchestrator's job, behind the serial merge lock: the train
# rebases onto the current tip and re-gates the tree that actually lands. A
# merge fired from inside an issue worktree skips both, so a PR can land on a
# base its gate never saw — silent red on main, which is the one invariant the
# whole loop exists to protect.
# ─────────────────────────────────────────────────────────────────────────────
case "$cwd" in
*-issue-[0-9]*)
    if has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
        deny "BLOCKED: \`gh pr merge\` from an issue worktree ($cwd).
Merging belongs to the orchestrator's merge-train, which rebases onto the
current main tip and re-gates the tree that actually lands. Merging here skips
both. Push the branch, open/leave the PR, and return your receipt — the
orchestrator merges."
    fi
    ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
# 2. Nothing force-pushes the default branch.
#
# No step in the loop needs it, and it is the one action that can destroy
# another session's already-merged work irrecoverably. Force-pushing a FEATURE
# branch is legitimate and stays allowed — the merge-train does exactly that
# after a rebase.
# ─────────────────────────────────────────────────────────────────────────────
# Force is expressed two ways and BOTH have to count: the flag, and a leading
# `+` on the refspec (`git push origin +main`), which is a force push with no
# flag anywhere in the command.
if has '(^|[;&|[:space:]])git[[:space:]]+push([[:space:]]|$)' &&
    { has '(--force([[:space:]=]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$))' ||
        has '[[:space:]]\+[^[:space:]]*(main|master)([[:space:]]|$)'; } &&
    has '([[:space:]:+]|^)(main|master)([[:space:]]|$)'; then
    deny "BLOCKED: force-push targeting the default branch.
No step in this workflow needs it, and it can destroy another session's merged
work with no recovery. If a branch has diverged, rebase it and force-push the
FEATURE branch (allowed) — never main."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. A GATE may not be piped into a pager.
#
# `bun run test | tail -20` reports the exit status of `tail`, which is always
# 0. A red suite therefore reports success, and the gate's verdict — the only
# done/not-done signal in the workflow — becomes meaningless exactly when it
# matters. Redirect to a file and grep it instead.
#
# **Scoped to the GATE, not to every test run.** Telemetry over 24 days: 2,819
# of 3,981 full-gate invocations were piped into a pager, and so were 2,295 of
# 4,189 targeted `vitest run` calls. Denying both would make the rule a
# workflow change rather than a safety net — it would add a second round-trip
# to more than half of all test invocations. A targeted run's verdict is not
# load-bearing (its failures are read out of the output, and a false green on
# it is caught by the gate afterwards), so only the commands whose exit code
# IS the done/not-done signal are denied.
# ─────────────────────────────────────────────────────────────────────────────
if has '(bun[[:space:]]+run[[:space:]]+(test|test:app|test:bot|check:all|check:pr|check:guards)([[:space:]]|$)|scripts/gate\.ts)' &&
    has '\|[[:space:]]*(tail|head|less|more)([[:space:]]|$)'; then
    deny "BLOCKED: gate command piped into a pager.
The pipeline's exit code becomes the pager's, which is always 0 — a red suite
would report success. Redirect to a file and read that instead:
  bun run test >/tmp/gate.log 2>&1; echo \"exit=\$?\"; grep -E 'Tests|FAIL' /tmp/gate.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. No discarding operations in the SHARED main checkout.
#
# Other sessions edit that tree live — a dozen modified files there is the
# normal state, not a mess to clean up. A `git checkout --`, `stash`,
# `reset --hard` or `clean -f` throws away work that belongs to somebody else
# and is unrecoverable; `git commit -a` sweeps their in-flight edits into an
# unrelated commit (observed). Branch switching and ordinary commits stay
# allowed — the loop's own §0 does `git checkout main && git pull`.
#
# "Main checkout" is git's own distinction, not a path convention: a linked
# worktree's git-dir differs from its common-dir, the main one's does not.
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    git_dir=$(git -C "$cwd" rev-parse --absolute-git-dir 2>/dev/null || true)
    common_dir=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
    if [ -n "$git_dir" ] && [ "$git_dir" = "$common_dir" ]; then
        if has '(^|[;&|[:space:]])git[[:space:]]+checkout[[:space:]]+--([[:space:]]|$)' ||
            has '(^|[;&|[:space:]])git[[:space:]]+restore([[:space:]]|$)' ||
            has '(^|[;&|[:space:]])git[[:space:]]+stash([[:space:]]+(push|save))?([[:space:]]*$|[[:space:]]+-)' ||
            has '(^|[;&|[:space:]])git[[:space:]]+reset[[:space:]]+--hard' ||
            has '(^|[;&|[:space:]])git[[:space:]]+clean[[:space:]]+-[a-z]*f' ||
            has '(^|[;&|[:space:]])git[[:space:]]+commit[[:space:]]+(-[a-zA-Z]*a|--all)'; then
            deny "BLOCKED: discarding git operation in the shared main checkout ($cwd).
Other sessions are editing this tree right now — modified files here are normal,
not a mess to clean up, and discarding them is unrecoverable. Do the work in
your own worktree instead:
  git worktree add ../<repo>-<task> -b <branch> && cd ../<repo>-<task>
(\`git status\`, \`git stash list\`, \`git checkout <branch>\` and \`git commit -m\`
without \`-a\` remain allowed.)"
        fi
    fi
fi

exit 0

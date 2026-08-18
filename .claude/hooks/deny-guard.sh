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

deny() {
    printf '%s\n' "$1" >&2
    exit 2
}

# ─────────────────────────────────────────────────────────────────────────────
# 0. Nothing AUTHORS a versioned file in the shared main checkout.
#
# Rule 4 below stops a session from DESTROYING another session's work there.
# This one stops it from creating the mess in the first place, which telemetry
# says is the commoner event by far: ~40 documentation-only commits landed
# straight on `main` over 30 days — ADRs, PRDs, CONTEXT.md updates, findings —
# every one of them the residue of a discussion, not of a task anybody would
# have thought to isolate. Two of those 30 days also carry a
# `Merge branch 'main' of …` commit: local `main` had diverged from origin.
#
# The damage is not cosmetic, because DOCS ARE GATED. `format:check` covers
# `**/*.md`; `cr:lint` reads citations out of prose; `adr-index.test.ts`,
# `resident-context-budget.test.ts`, `findings.test.ts`, `project-skills.test.ts`
# and `action-space.test.ts` all read files a discussion writes. A half-written
# ADR sitting in the shared checkout therefore reds `check:all` for every OTHER
# session on this machine, on a file that has nothing to do with their work —
# and the green-main invariant means they must stop and deal with it.
#
# Scope, deliberately narrow in three directions:
#   * Only the MAIN checkout. Linked worktrees are the whole point — they stay
#     fully writable. The distinction is git's own (git-dir == common-dir), not
#     a path convention.
#   * Only VERSIONED paths. Anything `git check-ignore` claims — the telemetry
#     dir, the receipts dir, `*.local` — cannot dirty anyone's tree, so it is
#     allowed: the loop writes `green-sha` and its receipts from here by design.
#   * Only the authoring TOOLS. A `cat > file` heredoc in Bash still gets
#     through; matching redirections in a command string is the false-denial
#     shape the header below is about, and the tools are what a model actually
#     uses to write a document.
#
# Escape hatch, visible and per-session, for the case where a human really does
# want to edit the main checkout (a merge conflict, a hotfix):
#   TOLARIA_ALLOW_MAIN_EDIT=1 claude
# ─────────────────────────────────────────────────────────────────────────────
case "$tool" in
Edit | Write | MultiEdit | NotebookEdit)
    target=$(printf '%s' "$payload" |
        jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
    [ -n "$target" ] || exit 0
    [ "${TOLARIA_ALLOW_MAIN_EDIT:-}" = "1" ] && exit 0

    # A new file's directory may not exist yet — walk up to the first that does,
    # so `git` has something to answer about.
    probe=$(dirname "$target")
    while [ ! -d "$probe" ]; do
        parent=$(dirname "$probe")
        [ "$parent" != "$probe" ] || break
        probe="$parent"
    done
    [ -d "$probe" ] || exit 0

    git_dir=$(git -C "$probe" rev-parse --absolute-git-dir 2>/dev/null || true)
    common_dir=$(git -C "$probe" rev-parse --path-format=absolute \
        --git-common-dir 2>/dev/null || true)
    # Not a repo, or a LINKED worktree (git-dir differs from common-dir) → fine.
    [ -n "$git_dir" ] && [ "$git_dir" = "$common_dir" ] || exit 0
    # Gitignored → invisible to `git status`, cannot break anyone's gate.
    git -C "$probe" check-ignore -q -- "$target" 2>/dev/null && exit 0

    deny "BLOCKED: writing a versioned file in the shared main checkout.
  $target

Other sessions gate this tree. Markdown is gated too (format:check, cr:lint,
adr-index, resident-context-budget, findings, project-skills), so an unfinished
ADR or a reformatted doc here reds check:all for everybody else — 'it is only a
document' is exactly how ~40 such commits reached main. Work in a worktree:

  git worktree add ../tolaria-wt-<task> -b <branch> origin/main
  cd ../tolaria-wt-<task>

For a documentation-only change there is a one-command lane:
  bun run wt:docs <task>      # worktree + branch, from origin/main
  bun run docs:ship           # doc gate, PR, merge

(Gitignored paths — .claude/telemetry, .claude/receipts — stay writable here.
Genuinely need this file, in this tree? Relaunch with TOLARIA_ALLOW_MAIN_EDIT=1.)"
    ;;
esac

[ "$tool" = "Bash" ] || exit 0
[ -n "$cmd" ] || exit 0

# ─────────────────────────────────────────────────────────────────────────────
# The command's ADDRESS, not the session's.
#
# `cd ../repo-wt-x && git stash` is how a session operating out of one tree does
# work in another — and it is now the NORMAL shape, since every file a session
# authors belongs in a worktree (§ 0). The payload's `.cwd` still names the
# SESSION's directory, so judging that command by `.cwd` denied a perfectly
# legal stash in a worktree because the session happened to sit in the main
# checkout. Observed within the hour § 0 landed.
#
# It cuts the other way too, which is the more important half: `cd ../repo &&
# git reset --hard` FROM a worktree used to be allowed, because `.cwd` said
# "worktree". Reading the leading `cd` makes both verdicts follow the directory
# the command actually operates in.
#
# Only a LEADING `cd` counts, and only the first one. A `cd` buried mid-script,
# or a `git -C <dir>`, still escapes this — same class of hole as the `cat >`
# heredoc in § 0, and narrowing it further means parsing shell, which is how
# guards start denying legitimate work at random.
# ─────────────────────────────────────────────────────────────────────────────
_first=$(printf '%s' "$cmd" | head -1 | sed -e 's/&&.*//' -e 's/;.*//' \
    -e 's/[[:space:]]*$//')
case "$_first" in
cd\ *)
    _target=$(printf '%s' "$_first" | sed -e 's/^cd[[:space:]]*//' \
        -e "s/^['\"]//" -e "s/['\"]$//")
    case "$_target" in
    /*) _candidate="$_target" ;;
    *) _candidate="$cwd/$_target" ;;
    esac
    if [ -d "$_candidate" ]; then
        _resolved=$(cd "$_candidate" 2>/dev/null && pwd)
        [ -n "$_resolved" ] && cwd="$_resolved"
    fi
    ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
# Everything below matches against SEGMENTS, never the whole command string.
#
# A `tool_input.command` is not one command. It is a script: several commands
# joined by `&&`, `;` and newlines, and it routinely carries PROSE — commit
# message heredocs, PR bodies, echoed explanations. Matching the whole string
# produced three false denials in the first hour these rules were live:
#
#   * a `git commit` whose MESSAGE discussed force-pushing, chained with a
#     perfectly legal push of a feature branch;
#   * a gate REDIRECTED to a file, followed by a separate `grep … | tail` of
#     that file — the gate and the pager were in different commands;
#   * and the same shape again with a different message.
#
# Each denial was correct about the characters present and wrong about what the
# command does. A guard that blocks legitimate work at random is a guard that
# gets switched off, which costs more than the rule was ever worth. So: split on
# the separators that end a pipeline (`&&`, `||`, `;`, newline — NOT a bare `|`,
# which is the pipe these rules need to see), and require a rule's patterns to
# co-occur in ONE segment.
# ─────────────────────────────────────────────────────────────────────────────

segments=$(printf '%s' "$cmd" | sed -e 's/&&/\
/g' -e 's/||/\
/g' -e 's/;/\
/g')

# True when some single segment matches every pattern given.
seg_has() {
    matching=$(printf '%s\n' "$segments")
    for pattern in "$@"; do
        matching=$(printf '%s\n' "$matching" | grep -E "$pattern" || true)
        [ -n "$matching" ] || return 1
    done
    return 0
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
    if seg_has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
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
#
# **Scoped to the `git push` invocation's own arguments, not the whole command
# string.** Testing the entire string produced a false denial the first time it
# met a real command: a `git commit -F -` heredoc whose MESSAGE discussed
# force-pushing main, followed by `git push` of a feature branch. Prose travels
# inside commands — commit bodies, PR bodies, `echo`ed explanations — and a
# guard that reads it is a guard that blocks legitimate work at random, which is
# how guards get switched off.
if seg_has '(^|[;&|[:space:]])git[[:space:]]+push([[:space:]]|$)' \
    '(--force([[:space:]=]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$)|[[:space:]]\+[^[:space:]]*(main|master)([[:space:]]|$))' \
    '([[:space:]:+])(main|master)([[:space:]]|$)'; then
    deny "BLOCKED: force-push targeting the default branch.
No step in this workflow needs it, and it can destroy another session's merged
work with no recovery. If a branch has diverged, rebase it and force-push the
FEATURE branch (allowed) — never main."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. A GATE may not be piped into a pager — FAIL CLOSED.
#
# `bun run test | tail -20` reports the exit status of `tail`, which is always
# 0. A red suite therefore reports success, and the gate's verdict — the only
# done/not-done signal in the workflow — becomes meaningless exactly when it
# matters. Redirect to a file and grep it instead.
#
# **Inverted, on purpose, after this held a stale hand-maintained allowlist of
# gate command NAMES.** That list was already wrong the moment `bun run land`
# shipped: `land` (→ `scripts/land.ts`, spawns `gate.ts heavy`), `docs:ship`
# (→ `scripts/docs-lane.ts`, runs `check:docs`, itself a `gate.ts light`
# wrapper), `check:docs`, `ladder` (`scripts/ladder.ts:102` runs the same
# heavy gate) and `wt:docs` all reach `scripts/gate.ts` and none of them was
# in the list — `bun run land 2524 | tail -80` and
# `bun run docs:ship 2>&1 | tail -25` both sailed straight through it.
# Patching the list with those five names would only reload the same gun for
# the next gate wrapper. So the rule is now: deny `bun run <script>` piped
# into a pager BY DEFAULT, and carry an explicit allowlist of the scripts
# whose output is purely informational and whose exit code nobody branches
# on. A new gate command is covered from the day it is written; a new
# informational command is merely inconvenient until it earns a line below —
# which is the failure direction actually wanted here. A bare
# `scripts/gate.ts` invocation (bypassing `bun run` entirely) is always the
# gate itself and stays unconditionally denied when piped.
#
# **The informational allowlist, seeded against `package.json` (verify with
# `bun run <name>` before adding another):** `cr`, `cr:check`, `findings`,
# `queue:plan`, `queue:train`, `loop:scorecard`, `usage:window`,
# `telemetry:dash`, `telemetry:ingest`. Nothing else — in particular `lint`,
# `format:check`, `check:ts`, `check:index` and `check:stubs` stay DENIED:
# piping any of those hides a real failure exactly like piping the gate does.
#
# **Still scoped to a single segment, never to every test run.** Telemetry
# over 24 days: 2,819 of 3,981 full-gate invocations were piped into a pager,
# and so were 2,295 of 4,189 targeted `vitest run` calls. Denying both would
# make the rule a workflow change rather than a safety net — it would add a
# second round-trip to more than half of all test invocations. A targeted
# run's verdict is not load-bearing (its failures are read out of the output,
# and a false green on it is caught by the gate afterwards), so `bunx vitest
# run …` stays allowed piped — only `bun run <script>` (any script, unless
# allowlisted above) and a bare `scripts/gate.ts` are in scope.
# ─────────────────────────────────────────────────────────────────────────────
GATE_INFORMATIONAL_SCRIPT_RE='^(cr|cr:check|findings|queue:plan|queue:train|loop:scorecard|usage:window|telemetry:dash|telemetry:ingest)$'

_gate_piped=0
_old_ifs=$IFS
IFS='
'
set -f
for _seg in $segments; do
    case "$_seg" in
    *'|'*) ;;
    *) continue ;;
    esac
    printf '%s\n' "$_seg" |
        grep -Eq '\|[[:space:]]*(tail|head|less|more)([[:space:]]|$)' || continue

    # A bare `scripts/gate.ts` invocation is always the gate itself — no
    # script-name allowlist applies to it.
    if printf '%s\n' "$_seg" | grep -Eq 'scripts/gate\.ts'; then
        _gate_piped=1
        break
    fi

    _gate_script=$(printf '%s\n' "$_seg" |
        sed -nE 's/.*bun[[:space:]]+run[[:space:]]+([^[:space:]]+).*/\1/p')
    [ -n "$_gate_script" ] || continue

    if printf '%s\n' "$_gate_script" | grep -Eq "$GATE_INFORMATIONAL_SCRIPT_RE"; then
        continue
    fi
    _gate_piped=1
    break
done
set +f
IFS=$_old_ifs

if [ "$_gate_piped" = 1 ]; then
    deny "BLOCKED: \`bun run\` command piped into a pager.
The pipeline's exit code becomes the pager's, which is always 0 — a red suite
would report success, and this guard denies BY DEFAULT rather than trusting a
hand-maintained list of which scripts are gates (that list was already stale:
\`land\`, \`docs:ship\`, \`check:docs\`, \`ladder\` and \`wt:docs\` all reach
scripts/gate.ts and none of them was covered). Redirect to a file and read
that instead:
  bun run test >/tmp/gate.log 2>&1; echo \"exit=\$?\"; grep -E 'Tests|FAIL' /tmp/gate.log

If this really is a purely informational script whose exit code nobody
branches on, add its name to GATE_INFORMATIONAL_SCRIPT_RE in
.claude/hooks/deny-guard.sh § 3 — not before checking what it actually does."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. No discarding operations in the SHARED main checkout.
#
# Other sessions edit that tree live — a dozen modified files there is the
# normal state, not a mess to clean up. A `git checkout --`, `stash`,
# `reset --hard` or `clean -f` throws away work that belongs to somebody else
# and is unrecoverable; `git commit -a` sweeps their in-flight edits into an
# unrelated commit (observed). `git add -A` / `git add .` is the same sweep in
# two steps and is denied for the same reason — naming the paths (`git add
# <path>`) is not, since that cannot pick up a file you did not mean. Branch
# switching and ordinary commits stay allowed — the loop's own §0 does
# `git checkout main && git pull`.
#
# "Main checkout" is git's own distinction, not a path convention: a linked
# worktree's git-dir differs from its common-dir, the main one's does not.
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    git_dir=$(git -C "$cwd" rev-parse --absolute-git-dir 2>/dev/null || true)
    common_dir=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
    if [ -n "$git_dir" ] && [ "$git_dir" = "$common_dir" ]; then
        if seg_has '(^|[;&|[:space:]])git[[:space:]]+checkout[[:space:]]+--([[:space:]]|$)' ||
            seg_has '(^|[;&|[:space:]])git[[:space:]]+restore([[:space:]]|$)' ||
            seg_has '(^|[;&|[:space:]])git[[:space:]]+stash([[:space:]]+(push|save))?([[:space:]]*$|[[:space:]]+-)' ||
            seg_has '(^|[;&|[:space:]])git[[:space:]]+reset[[:space:]]+--hard' ||
            seg_has '(^|[;&|[:space:]])git[[:space:]]+clean[[:space:]]+-[a-z]*f' ||
            seg_has '(^|[;&|[:space:]])git[[:space:]]+commit[[:space:]]+(-[a-zA-Z]*a|--all)' ||
            seg_has '(^|[;&|[:space:]])git[[:space:]]+add[[:space:]]+(-A|--all|\.)([[:space:]]|$)'; then
            deny "BLOCKED: discarding git operation in the shared main checkout ($cwd).
Other sessions are editing this tree right now — modified files here are normal,
not a mess to clean up, and discarding them is unrecoverable. Do the work in
your own worktree instead:
  git worktree add ../<repo>-<task> -b <branch> && cd ../<repo>-<task>
(\`git status\`, \`git stash list\`, \`git checkout <branch>\`, \`git add <path>\` and
\`git commit -m\` without \`-a\` remain allowed.)"
        fi
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. One planner run per session (MAX_PASSES = 1, enforced).
#
# SKILL.md § Running unattended already says it in as many words: one batch,
# then exit — a fresh process per batch costs nothing (all loop state is
# durable: labels, PRs, green-sha) and caps orchestrator context growth. The
# prose did not hold: a 2026-08-06 session ran batches back-to-back for 13.6h
# ("prosegui" × 21, /compact instead of /clear), averaged 173k context per
# message, and alone cost 44% of the day. The planner invocation is the one
# chokepoint every pass goes through, so the rule lives here.
#
# A SECOND `queue:plan` in the same session is denied. The same-pass replan
# after a claim collision (§1b) is legitimate and stays available behind an
# explicit, visible opt-in in the command itself:
#   TOLARIA_ALLOW_REPLAN=1 bun run queue:plan --cap 4 --pretty
# ─────────────────────────────────────────────────────────────────────────────
# Match the INVOCATION shape, not the bare word: "queue:plan" travels inside
# prose (commit messages quoting this very rule, greps over the skill file) and
# a word-match created exactly the false denial the header above warns about.
PLAN_INVOKE='(^|[;&|[:space:]])bun[[:space:]]+(run[[:space:]]+queue:plan|[^[:space:]]*queue-plan\.ts)([[:space:]]|$)'
if seg_has "$PLAN_INVOKE"; then
    session=$(printf '%s' "$payload" | jq -r '.session_id // ""')
    if [ -n "$session" ]; then
        markers="${CLAUDE_PROJECT_DIR:-$cwd}/.claude/telemetry/pass-markers"
        mkdir -p "$markers" 2>/dev/null || true
        # prune markers older than a day so the directory stays small
        find "$markers" -type f -mtime +1 -delete 2>/dev/null || true
        marker="$markers/$session"
        if [ -f "$marker" ] && ! seg_has 'TOLARIA_ALLOW_REPLAN=1' "$PLAN_INVOKE"; then
            deny "BLOCKED: second planner run in this session (MAX_PASSES = 1).
One batch per session: finish this pass, report, and EXIT — the next batch
belongs to a fresh session (context reset is the point; all loop state is
durable in labels/PRs/green-sha, nothing is lost). If this is a same-pass
replan after a claim collision (§1b), opt in explicitly:
  TOLARIA_ALLOW_REPLAN=1 bun run queue:plan --cap 4 --pretty"
        fi
        touch "$marker" 2>/dev/null || true
    fi
fi

exit 0

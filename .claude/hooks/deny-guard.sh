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
# `.tool_input.command`) plus git's own worktree metadata, never from ambient
# state. The ESCAPE HATCHES are the deliberate exception and are meant to be
# forgeable: they exist so a human can opt out visibly, in the session
# (`TOLARIA_ALLOW_MAIN_EDIT=1 claude`, § 0) or in the command itself
# (`TOLARIA_ALLOW_REPLAN=1`, § 5; `TOLARIA_ALLOW_MANUAL_MERGE=1`, § 1). A
# guard with no way out gets switched off wholesale, which is worse.

set -u

payload=$(cat)
tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""')
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""')

# Branch names come from tolaria.config.json (ADR 0116) — the same file
# scripts/lib/branches.ts reads — never from a literal in this hook. The
# fallback keeps the rules meaningful when the hook runs against a fixture
# tree that has no config (scripts/__tests__/hook-policy.test.ts).
branch_cfg="${CLAUDE_PROJECT_DIR:-$cwd}/tolaria.config.json"
base_branch=$(jq -r '.branches.base // empty' "$branch_cfg" 2>/dev/null)
release_branch=$(jq -r '.branches.release // empty' "$branch_cfg" 2>/dev/null)
[ -n "$base_branch" ] || base_branch=main
[ -n "$release_branch" ] || release_branch=main

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
# straight on `main` over 30 days — ADRs, PRDs, GLOSSARY.md updates, findings —
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

  bun run wt:new <issue#>     # issue worktree, branched from origin/$base_branch
  cd ../tolaria-wt-<task>

For a documentation-only change there is a one-command lane:
  bun run wt:docs <task>      # docs worktree + branch, from origin/$base_branch
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

# A backslash-continued line is still ONE pipeline (`bun run test \` +
# newline + `  | tail -20` runs as a single command), and a line ending in a
# bare shell operator (`|`/`||`/`&&`/`&`) is the same shape one step over
# (`bun run test |` + newline + `tail -20`) — but the newline-based split
# below would otherwise treat either continuation as a separator and see
# two harmless-looking halves. That is exactly the shape of the incident
# that started this file (`docs:ship 2>&1 | tail -25`), just wrapped across
# a line break instead of typed on one line. Join both shapes into a space
# BEFORE splitting into segments, so the pipe and the pager end up back in
# the same segment. Both joins live in ONE shared, single-pass script —
# `.claude/hooks/lib/join-continued-lines.awk` — so the hook and its test
# suite (`scripts/__tests__/hook-policy.test.ts`) run the exact same code,
# never two implementations of the same rule.
#
# **Not sed.** The original `sed -e :a -e '/\\$/N; s/\\\n/ /; ta'` is a
# fail-OPEN hole on this machine's `sed` (BSD): `N` on the LAST line, with no
# next line to append, quits WITHOUT printing the pattern space — so a
# command whose final physical line ends in `\` (a live, working shell
# command: a trailing `\` before EOF is just a literal backslash argument)
# collapses `_cmd_joined` to empty, which empties `segments`, which makes
# every rule below (§1 `gh pr merge`, §2 force-push main, §3 the pager gate,
# §3b the backgrounded gate, §4 discarding git, §5 MAX_PASSES) match nothing.
# One trailing backslash
# turned a fail-closed guard fully fail-open — the exact bug class this file
# exists to close, reintroduced by its own fix. `awk`, one line per record,
# has no such last-line special case — see the script's own header for the
# full shape inventory (backslash parity, CRLF, the four operators, and the
# byte-identity guarantee for a line with neither).
# LC_ALL=C: the joiner's own comparisons are all substr/length, never a
# locale-aware regex, but pinning the locale here too is a free belt-and-
# suspenders — command bytes are untrusted, and a wide-character conversion
# routine invoked under a UTF-8 locale is exactly the kind of thing that can
# throw on an invalid byte sequence instead of degrading gracefully.
#
# **Heredoc bodies come off FIRST** (issue #2537). A command carries text it
# does not run — a commit message, a PR body, a `python3 - <<'PY'` patch
# script — and to a substring scanner that text is indistinguishable from a
# command. Segment-splitting closed the three false denials in the header
# above; heredoc bodies are the shape that survived it, and widening §1 to the
# whole machine made it bite: a patch script that MENTIONED the merge (this
# repo's own hook tests do) was denied while it edited a test file. Stripping
# runs on PHYSICAL lines, before the joiner, because a body line can itself end
# in `\` or `|` and would otherwise be glued onto a real command.
# `lib/strip-heredoc-bodies.awk` documents exactly which introducer shapes it
# recognises and why the detection is deliberately narrow.
# `${0%/*}` rather than `dirname` twice: this runs on every Bash, Edit and
# Write call, and two `dirname` processes cost more than the parameter
# expansion that replaces them. The `*/*` guard keeps it correct for a `$0`
# with no slash, where `${0%/*}` would return the name itself.
case "$0" in
*/*) _hookdir=${0%/*} ;;
*) _hookdir=. ;;
esac

_cmd_joined=$(printf '%s' "$cmd" |
    LC_ALL=C awk -f "$_hookdir/lib/strip-heredoc-bodies.awk" |
    LC_ALL=C awk -f "$_hookdir/lib/join-continued-lines.awk")

segments=$(printf '%s' "$_cmd_joined" | sed -e 's/&&/\
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
# The single "is this a GATE" predicate — shared by §3 (piped into a pager)
# and §3b (run in the background). Both are the same underlying failure: the
# gate's exit code, the only done/not-done signal in the workflow, never
# reaches anyone. Deny-by-default: a script not named anywhere below is still
# a gate unless it resolves through `bun run` to a name on the ONE exempt-
# script list, or the invocation is a bare `scripts/gate.ts`. There is
# deliberately no second copy of this test and no second list — see
# #2429/#2527 for what a hand-maintained gate-name list already cost once.
#
# **The list carries TWO senses of "not a gate", not one — renamed from
# GATE_INFORMATIONAL_SCRIPT_RE to say so (issue #2654 review).** §3 only ever
# needed the first sense (nobody branches on the exit code: `cr`, `findings`,
# `format`, …), so a purely informational name was accurate for it alone. §3b
# widens what "exempt" has to mean: `bun run dev` / `bun run preview` are
# long-running SERVERS with no gate verdict to report in the first place —
# `docs/guides/ui-runbooks.md` makes a backgrounded `dev` the prerequisite for
# manual CDP verification, and denying it (worse, telling the caller to run a
# process that never exits in the FOREGROUND) would burn the harness's own
# 10-minute cap and manufacture the exact stall this file exists to prevent,
# through the one producer the issue puts out of scope. Both senses share one
# property that is the actual membership test — nothing downstream ever reads
# this script's own exit code as a verdict — so one list is correct, not two.
# Adding `dev`/`preview` here also correctly relaxes §3 for an ordinary dev-
# server startup banner piped into a pager, which was never the failure §3
# exists to catch.
# ─────────────────────────────────────────────────────────────────────────────
GATE_EXEMPT_SCRIPT_RE='^(cr|cr:check|findings|queue:plan|usage:window|telemetry:dash|cockpit|format|dev|preview)$'

# True when the given SEGMENT text reaches the gate runner.
segment_reaches_gate() {
    _grg_seg="$1"

    # A bare `scripts/gate.ts` invocation is always the gate itself — no
    # script-name allowlist applies to it. `scripts/gate-run.sh` joins it
    # (issue #3698): its documented direct form, `sh scripts/gate-run.sh
    # check:lane`, contains no `bun run` token at all, so without this line
    # piping or backgrounding the gate DRIVER slipped through the very rules
    # it exists to make followable.
    #
    # **ANCHORED TO COMMAND POSITION (issue #4377).** This clause used to
    # match `scripts/gate*` ANYWHERE in the segment, so a read-only grep of a
    # gate file — `grep -n "tolaria.config.json" -A3 scripts/gate-run.sh |
    # head -12` — was denied as "a gate piped into a pager", and the denial
    # text sent the caller to `GATE_EXEMPT_SCRIPT_RE`, which is the wrong fix
    # (the file is an ARGUMENT, not the command; no gate runs at all). A gate
    # only runs when the path is the thing being EXECUTED, so that is what is
    # matched: the head of each command in the segment, never a later
    # argument. The `bun run <script>` clause below is untouched.
    #
    # Anchoring is the whole risk here, so the head extraction is built to err
    # towards finding MORE heads — every step below can only ever make this
    # clause deny more, never less:
    #
    #   1. Redirections are DELETED first, not skipped as a token. Deleting
    #      `2>&1` outright means the `&` split below leaves no stray `1` to
    #      read as a command, and deleting the operator in `sh <scripts/gate-
    #      run.sh` (no space — valid shell, `sh` runs the script from stdin)
    #      exposes the path as the head. An earlier revision skipped a
    #      redirection as one token, `[0-9]*[<>][^[:space:]]*`, which
    #      swallowed that glued path and was a one-character bypass; it also
    #      needed a bare `[0-9]+` alternative that mistruncated any command
    #      whose name starts with a digit (`2to3` read as `to3`). Both are
    #      gone (issue #4377 review).
    #   2. Command boundaries are taken from ``| ; & ( { ` `` — the same
    #      segment-level approximation the rest of this file uses. A `$(…)`
    #      leftover `$` simply yields a head that matches nothing, while the
    #      substituted command inside it is still read.
    #   3. The head is read past leading quotes, env assignments, flags, and
    #      wrapper words — `bun`/`bunx`/`sh`/`bash`/`zsh`/`env`/`time`/
    #      `nohup`/`command`/`eval`/`exec`/`sudo`/`source`/`.`/`nice`/
    #      `stdbuf`/`xargs` — each accepted PATH-QUALIFIED too, because
    #      `/usr/bin/env sh scripts/gate-run.sh | tail` and `/bin/sh …` run
    #      the gate exactly as the bare forms do and were both allowed before
    #      the review caught it. Same for `eval "sh scripts/gate-run.sh" |
    #      tail`, `exec …`, `sudo …`, `source …` and `. …`.
    #
    # So `bun scripts/gate.ts heavy …` and `sh scripts/gate-run.sh … | tail`
    # remain denied, however they are wrapped.
    #
    # **What this does NOT reach, and never did:** a brace group whose `;`
    # ends the segment before §3 looks at it — `{ sh scripts/gate-run.sh; } |
    # tail` is allowed, as it was before this change, because the top-level
    # splitter treats `;` as a segment boundary on purpose (`hook-policy.
    # test.ts`: "`;` must not join a gate into a pager segment"). `{` is in
    # the boundary set above for the shape that DOES reach here, `{ bun
    # scripts/gate.ts heavy | tail -5 ; }`, where the pipe precedes the `;`.
    _grg_heads=$(printf '%s\n' "$_grg_seg" |
        sed -E 's/[0-9]*[<>]+&?[0-9-]*//g' |
        tr '|;&({`' '\n\n\n\n\n\n' |
        sed -E -e 's/^[[:space:]]*//' \
            -e "s#^((['\"]|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+|(/?([^[:space:]/]+/)*)?(bun|bunx|sh|bash|zsh|env|time|nohup|command|eval|exec|sudo|source|nice|stdbuf|xargs|\.)[[:space:]]+|-[^[:space:]]*[[:space:]]+))*##" \
            -e 's/[[:space:]].*$//')
    if printf '%s\n' "$_grg_heads" |
        grep -Eq '^\.?/?([^[:space:]]*/)?scripts/gate(-run\.sh|\.ts)$'; then
        return 0
    fi

    # EVERY `bun run <script>` occurrence in the segment must be checked, not
    # just one: a single greedy extraction picks up the LAST occurrence in a
    # chained pipeline (`bun run test | bun run cr`), so an allowlisted name
    # at the tail would launder a non-allowlisted invocation ahead of it.
    _grg_scripts=$(printf '%s\n' "$_grg_seg" |
        grep -oE 'bun[[:space:]]+run[[:space:]]+[^[:space:]]+' |
        sed -E 's/^bun[[:space:]]+run[[:space:]]+//')
    [ -n "$_grg_scripts" ] || return 1

    for _grg_script in $_grg_scripts; do
        if ! printf '%s\n' "$_grg_script" | grep -Eq "$GATE_EXEMPT_SCRIPT_RE"; then
            return 0
        fi
    done
    return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. A merge to the base branch goes through `bun run land`. Nothing else merges.
#
# Merging is the orchestrator's job, behind the serial merge lock: the train
# rebases onto the current tip and re-gates the tree that actually lands. A
# merge that skips it can land a PR on a base its gate never saw — silent red
# on main, the one invariant the whole loop exists to protect.
#
# WIDENED FROM "issue worktree" TO EVERYWHERE (issue #2537). `scripts/gate.ts`
# holds a machine-wide mutex over GATING; `land` extends it to cover the merge
# (#2517). A merge made any other way — a hand-typed `gh pr merge` from the
# main checkout, the GitHub web UI — takes no lock at all, so `main` moves
# under a session that is mid-gate and that session's gated tree stops being
# the tree that lands. The old rule keyed on `$cwd` matching `*-issue-N*`,
# which is precisely why the three such merges on 2026-08-18 went uncaught:
# two of them were typed from the main checkout as recovery after `land`
# failed. `land` converges now (#2536), and its own merge is `pr-merge.ts`,
# which retries the transient case instead of dropping the caller into
# hand-merging — so the recovery path this rule used to leave open is no
# longer the only one.
#
# `land`'s own merge is untouched by construction: this hook inspects Bash
# TOOL calls, never the child processes a script spawns, so the merge inside
# `land`'s locked command is invisible here BY DESIGN. Do not weaken the hook
# to accommodate it (`scripts/land.ts` header says the same).
#
# The web UI cannot be reached from here at all — no hook sees it. That gap is
# documented in `docs/agents/quality-gates.md`, not closable in this file.
#
# Escape hatch, explicit and per-command, in the same style as §5's replan
# opt-in — because a real recovery must stay possible without editing a hook:
#   TOLARIA_ALLOW_MANUAL_MERGE=1 gh pr merge <PR#> --squash
# It has to sit in the SAME segment as the merge, so it names the one command
# it is authorising rather than blanket-disabling the rule for a session.
# ─────────────────────────────────────────────────────────────────────────────
MERGE_INVOKE='(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'
if seg_has "$MERGE_INVOKE" && ! seg_has 'TOLARIA_ALLOW_MANUAL_MERGE=1' "$MERGE_INVOKE"; then
    deny "BLOCKED: \`gh pr merge\` — merging goes through \`land\`, from the PR's own branch.

\`scripts/gate.ts\` locks GATING machine-wide; \`bun run land <PR#>\` extends that
lock across rebase → gate → push → merge, so the tree that lands is the tree
that was gated. A merge typed by hand takes no lock: \`main\` moves under whoever
is mid-gate, and their verified tree is no longer the one landing.

  bun run land:ready <PR#>  # a session labels its PR \`ready-to-land\` (§ 8); the
                            # land-runner, until the merge queue replaces it
                            # (ADR 0156), runs \`bun run land <PR#>\`

If \`land\` already gated and pushed and only the MERGE failed, retry just the
merge — it never re-runs the suite:

  bun scripts/pr-merge.ts <PR#>

A \`merge:manual\` PR (one the Mergify queue refuses) merges through the command
that waits for its advisory lane, green on its up-to-date head:

  bun run merge:manual <PR#>

Genuinely need to merge by hand? Say so in the command itself:
  TOLARIA_ALLOW_MANUAL_MERGE=1 gh pr merge <PR#> --squash"
fi

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
    "(--force([[:space:]=]|\$)|--force-with-lease|[[:space:]]-f([[:space:]]|\$)|[[:space:]]\\+[^[:space:]]*($base_branch|$release_branch|master)([[:space:]]|\$))" \
    "([[:space:]:+])($base_branch|$release_branch|master)([[:space:]]|\$)"; then
    deny "BLOCKED: force-push targeting \`$base_branch\` or \`$release_branch\`.
No step in this workflow needs it, and it can destroy another session's merged
work with no recovery. If a branch has diverged, rebase it and force-push the
FEATURE branch (allowed) — never the base or release branch."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2b. A session never pushes to the base or release branch (issue #5641).
#
# ADR 0156: a session's work reaches the base through a PR and the merge queue
# — never through a push. The force-push rule above stops destruction; this one
# stops the plain `git push origin main` that skips the queue's lane. The
# scripts that legitimately move those branches (`gaps:sync`, `release`, the
# queue itself) push from INSIDE a `bun` process, which this hook never sees,
# so the rule costs them nothing. The one case it must still let through is a
# human moving a branch by hand, who says so in the command itself:
#
#   TOLARIA_ALLOW_BASE_PUSH=1 git push origin <ref>
#
# Two shapes are denied, both read from the push invocation's own segment
# (which must START with the push, so a commit message that merely mentions one
# is not a push):
#   * a refspec naming the base/release branch as source or destination
#     (`origin main`, `HEAD:main`, `feat:main`, `+main`);
#   * a push that names no refspec at all (`git push`, `git push origin`) from
#     a checkout that has the base/release branch checked out.
# ─────────────────────────────────────────────────────────────────────────────
PUSH_SEG='^[[:space:]]*\(?[[:space:]]*((env|command)[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git([[:space:]]+(-C|-c|--git-dir|--work-tree)[[:space:]]+[^[:space:]]+|[[:space:]]+--[a-z-]+(=[^[:space:]]*)?)*[[:space:]]+push([[:space:]]|$)'
if seg_has "$PUSH_SEG" && ! seg_has "$PUSH_SEG" 'TOLARIA_ALLOW_BASE_PUSH=1'; then
    _push_denied=0
    if seg_has "$PUSH_SEG" "([[:space:]:+\"']|refs/heads/)($base_branch|$release_branch)([[:space:]\"')]|\$)"; then
        _push_denied=1
    elif seg_has "$PUSH_SEG" '[[:space:]]--(all|mirror)([[:space:]]|$)'; then
        _push_denied=1
    else
        _head=$(git -C "$cwd" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
        if [ "$_head" = "$base_branch" ] || [ "$_head" = "$release_branch" ]; then
            # Positional words after `push`: at most the remote means no refspec.
            _positional=$(printf '%s\n' "$segments" | grep -E "$PUSH_SEG" |
                sed -E 's/^.*[[:space:]]push([[:space:]]|$)//' |
                tr -s '[:space:]' '\n' | grep -vE '^(-|[0-9]*[<>&]|$)' | wc -l | tr -d ' ')
            [ "${_positional:-0}" -le 1 ] && _push_denied=1
        fi
    fi
    if [ "$_push_denied" = 1 ]; then
        deny "BLOCKED: a session does not push to \`$base_branch\` or \`$release_branch\` (issue #5641, ADR 0156).
Work reaches the base through a PR and the merge queue, so a direct push skips
the lane that gates it. Push the feature branch and hand the PR off:
  git push -u origin <feature-branch> && bun run land:ready <PR#>

Moving the base or release branch by hand on purpose (what \`gaps:sync\` and
\`release\` do from inside their own scripts)? Say so in the command itself:
  TOLARIA_ALLOW_BASE_PUSH=1 git push origin <ref>"
    fi
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
# gate itself and stays denied when piped — but only IN COMMAND POSITION
# (issue #4377): the clause reads the head of each command in the segment,
# because a gate only runs when the path is the thing being EXECUTED. A gate
# script named as an ARGUMENT runs nothing, so `grep -n … scripts/gate-run.sh
# | head -12` is an ordinary read and is allowed. The derivation, and what the
# head is read past, are in `segment_reaches_gate` above.
#
# **Known tradeoff, taken deliberately — and mislocated in an earlier
# revision of this comment.** This rule matches SEGMENTS, never parsed
# shell, so it cannot tell live pipeline text from the same characters
# sitting inside a quoted string. Measured across three review rounds: MOST
# of this false-denial class predates the joiner above entirely and has
# nothing to do with backslashes — it is this section's own segment
# matching reading a QUOTED pattern as if it were a live pipeline (3 of 5
# observed shapes). The trigger is any command that **quotes the pager
# pattern AND pipes its OWN output** — not specifically a heredoc, though a
# heredoc is the commonest carrier: a `grep -E 'tail|head'` in a findings
# file's body, piped through something else entirely for formatting, reads
# as "gate piped into a pager" even though the quoted text never runs. This
# bit an ordinary diagnostic command as readily as a heredoc, which is why
# "redirect to a file and grep it" (this rule's own advice, below) does not
# help here: the pattern IS the payload, there is no gate output to
# redirect.
#
# The genuinely NEW shape, introduced by the backslash joiner itself: a
# Markdown **hard line break** — a trailing `\` at end-of-line, welding two
# otherwise-benign lines into one segment — which matters more than it
# might look, because every findings/ADR write in this repo goes through a
# heredoc, and hard line breaks are ordinary Markdown. Heredoc-awareness
# (telling quoted body text apart from a live pipeline) is out of scope for
# the same reason the file's own header gives: parsing shell far enough to
# know the difference is how a guard starts denying legitimate work at
# random. This false-denial shape — mostly pre-existing, sharpened slightly
# by the joiner — is accepted on purpose, not overlooked.
#
# **The informational allowlist, seeded against `package.json` (verify with
# `bun run <name>` before adding another):** `cr`, `cr:check`, `findings`,
# `queue:plan`, `usage:window`, `telemetry:dash`, `cockpit`
# (issue #5652: a server with no verdict, like `telemetry:dash`), `format`.
# Nothing else — in particular `lint`,
# `format:check`, `check:ts`, `check:index`, `check:stubs` and
# `telemetry:ingest` stay DENIED: piping any of those hides a real failure
# exactly like piping the gate does. The rule sorting these is NOT "writers
# fail closed, readers are informational" — `format` below is a writer too
# (`prettier --write`) and it stays allowlisted. The rule is **whether
# anything downstream independently verifies the result or branches on the
# exit code**: `telemetry:ingest` WRITES `telemetry.db` and nothing re-checks
# that write afterward, so its own exit code is the only signal that it
# happened correctly — piping it away is the same blind spot as piping the
# gate. `format` (`prettier --write`, thousands of lines on a real run, `|
# tail -5` a daily reflex) is safe to pipe for a different reason: nobody
# branches on ITS exit code either way, and `check:all` re-verifies
# formatting independently regardless of how this run went — the write is a
# convenience, not the thing anyone is trusting. (Not "a parse error is loud
# in the output anyway" — that claim is false the moment the pipe is `|&`,
# which redirects stderr into the same stream this rule now matches on
# purpose.)
#
# **`dev`/`preview` joined this same list later, for §3b's reason, not this
# one** (issue #2654 review) — the constant was renamed to
# `GATE_EXEMPT_SCRIPT_RE` accordingly. They are not "informational" in the
# sense above (there is no gate output to read at all, piped or not); they
# are long-running servers that legitimately background, and adding them here
# means §3 also correctly stops treating a `dev`/`preview` startup banner
# piped into a pager as a gate violation, which it never was.
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
    # `|&` is zsh's (and bash's) shorthand for `2>&1 |` — a live pipe, not a
    # background job marker in this position — and is the exact shape of the
    # incident that started this file. The pattern below matches a bare `|`
    # or a `|&` ahead of the pager name.
    printf '%s\n' "$_seg" |
        grep -Eq '\|&?[[:space:]]*(tail|head|less|more)([[:space:]]|$)' || continue

    if segment_reaches_gate "$_seg"; then
        _gate_piped=1
        break
    fi
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

If this really is a script whose exit code nobody branches on — purely
informational, or a long-running server with no verdict to report — add its
name to GATE_EXEMPT_SCRIPT_RE in .claude/hooks/deny-guard.sh § 3 — not before
checking what it actually does."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3b. A GATE may not run in the BACKGROUND either — FAIL CLOSED.
#
# Same failure shape as §3, a different producer (issue #2654): nine subagent
# terminations were observed with this exact pattern — start the gate detached
# (the Bash tool's own `run_in_background: true`), report "waiting for the
# notification", and end the turn. Under `claude -p` the end of a turn is the
# end of the PROCESS: nothing schedules the notification and nothing ever
# reads the exit code, so the pass stalls holding a claimed batch, no receipt
# written, nothing released. A backgrounded gate's result is not delayed like
# a piped one's is not quiet — it is never read at all, which is worse.
#
# **The rule this guard enforces, stated in full.** It is one rule, and it is
# the SAME text in `.claude/skills/next-ticket/SKILL.md` — a pass told to
# background its gate by one file and forbidden to by the other is how a pass
# that followed the guard to the letter died anyway (issue #3698).
# `scripts/__tests__/gate-rule-parity.test.ts` reds if the copies drift.
#
# <<<GATE-RULE>>>
# RUNNING A GATE. A gate never runs detached from the call that must read its
# verdict: not `run_in_background` (the notification never arrives — under
# `claude -p` the end of a turn is the end of the process), and not piped into a
# pager (the exit code becomes the pager's). A gate that can outlive the Bash
# tool's cap — `land`, and any lane gate run by hand, both of which queue behind
# the machine-wide gate mutex — runs through `bun run gate:run <script>`
# instead, issued with the tool's `timeout` set to its 600000ms MAXIMUM, because
# the 120000ms DEFAULT is shorter than the wait this script does: each call
# blocks in the FOREGROUND for at most 480s and then either returns the gate's
# real exit code or exits 75, "still running"; re-running the IDENTICAL command
# re-attaches to the same run and never starts a second gate. Re-run it until an
# exit code comes back. This rule is the same attended and unattended — the only
# difference is the cost of breaking it: an attended session that lets a gate be
# promoted to the background sees the promotion and can re-attach by hand, a
# driven pass dies with the turn and takes the gate's verdict with it.
# <<<END GATE-RULE>>>
#
# **Reuses §3's own predicate — not a second notion of what a gate is.**
# `segment_reaches_gate` (defined above, shared code, one allowlist) is the
# exact "does this reach the gate runner" test §3 already uses: deny BY
# DEFAULT, so a gate script named nowhere in this file is still denied, and
# the SAME exempt-script list (`GATE_EXEMPT_SCRIPT_RE`) exempts the scripts
# nothing downstream reads a verdict from either way — informational readers
# and long-running servers alike. There is deliberately no independent
# "known background-unsafe gates" list — that is exactly the name-list shape
# §3 already had to be rewritten out of once.
#
# Checked against EVERY segment, not only ones with a pipe: backgrounding has
# nothing to do with pagers, and a gate needs no `|` in the command to be a
# gate that must not run detached.
#
# **The signal is in the TOOL INPUT, not the command string.** `run_in_background`
# is a field the Bash tool call carries alongside `.tool_input.command` — the
# same payload `cmd`/`cwd` above are already read from — never a shell
# feature like a trailing `&` (that shape is real, unrelated, and already has
# its own documented one-directional tradeoff where the joiner is discussed).
#
# **Truthiness, read defensively.** The field can arrive as JSON `true`, JSON
# `false`, absent (an ordinary foreground call), or the STRING `"true"`
# depending on the caller. `// false` folds the absent/`false` cases to the
# literal text `false`; `-r` strips the quotes a JSON string carries, so a
# real boolean `true` and the string `"true"` both come out as the bare word
# `true` — comparing that text is what makes every shape count the same way.
# ─────────────────────────────────────────────────────────────────────────────
_bg=$(printf '%s' "$payload" | jq -r '.tool_input.run_in_background // false')
if [ "$_bg" = "true" ]; then
    _old_ifs=$IFS
    IFS='
'
    set -f
    for _seg in $segments; do
        if segment_reaches_gate "$_seg"; then
            set +f
            IFS=$_old_ifs
            deny "BLOCKED: gate script requested to run in the BACKGROUND.
Backgrounding throws away the exit code exactly like piping into a pager does
(§3) — and worse, under \`claude -p\` the end of your turn is the end of the
process, so no notification ever wakes you to read it either. Nine subagent
passes stalled this exact way (issue #2654). Run it in the FOREGROUND:
  bun run test
  bun run check:pr
  bun run check:all

Genuinely slow and you want to read the output back? Redirect to a file —
still in the foreground, still waiting for the real exit code:
  bun run test >/tmp/gate.log 2>&1; echo \"exit=\$?\"; grep -E 'Tests|FAIL' /tmp/gate.log

Slower than the Bash tool's own 600s cap, so the tool promotes it to the
background over your head and kills it together with your turn (issue #3698)?
Drive it through gate:run, which returns inside the cap and re-attaches on the
next FOREGROUND call until an exit code exists:
  bun run gate:run check:lane   # repeat the IDENTICAL command while it exits 75

If this really is a script whose exit code nobody branches on — purely
informational, or a long-running server with no verdict to report — it
belongs on GATE_EXEMPT_SCRIPT_RE in .claude/hooks/deny-guard.sh (the same
list §3 uses) — not before checking what it actually does."
        fi
    done
    set +f
    IFS=$_old_ifs
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
# <path>`) is not, since that cannot pick up a file you did not mean. Ordinary
# commits stay allowed, and so does switching — back to the base branch only
# (§4b below).
#
# "Main checkout" is git's own distinction, not a path convention: a linked
# worktree's git-dir differs from its common-dir, the main one's does not.
# ─────────────────────────────────────────────────────────────────────────────
# ORDER IS A COST DECISION, NOT A LOGIC ONE. Both halves of this test are pure
# predicates — a text match over the segments, and two read-only `git rev-parse`
# calls — so `A && B` and `B && A` cannot disagree. They cost wildly different
# amounts: the pattern is one `grep` (~4ms), the address is two `git` processes
# (~35ms), and the overwhelming majority of commands are not discarding
# operations at all. Asking the cheap question first means the two `git` calls
# are paid only by the handful of commands that could actually be denied here,
# instead of by every Bash, Edit and Write call in every session.
#
# The seven patterns are ONE alternation rather than seven `seg_has` calls for
# the same reason. `seg_has` with a single pattern is "some segment matches it",
# so seven of them chained with `||` is exactly "some segment matches any of the
# seven" — factoring the shared `git[[:space:]]+` prefix out of the alternation
# is an identity in ERE, and it turns seven `grep` processes into one.
if seg_has '(^|[;&|[:space:]])git[[:space:]]+(checkout[[:space:]]+--([[:space:]]|$)|restore([[:space:]]|$)|stash([[:space:]]+(push|save))?([[:space:]]*$|[[:space:]]+-)|reset[[:space:]]+--hard|clean[[:space:]]+-[a-z]*f|commit[[:space:]]+(-[a-zA-Z]*a|--all)|add[[:space:]]+(-A|--all|\.)([[:space:]]|$))'; then
    if [ -n "$cwd" ] && [ -d "$cwd" ]; then
        git_dir=$(git -C "$cwd" rev-parse --absolute-git-dir 2>/dev/null || true)
        common_dir=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
        if [ -n "$git_dir" ] && [ "$git_dir" = "$common_dir" ]; then
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
# 4b. The shared main checkout stays on the base branch (issues #6132, #6133).
#
# It is the DEPLOYMENT SOURCE: `convex dev --local` (`com.tolaria.convex`,
# WorkingDirectory = this checkout) pushes whatever its convex/ tree holds to
# the one local backend every browser walk talks to. On 2026-10-20 a
# `git checkout main` here pushed functions 144+ commits behind base; every
# game-route cell of the health walk went UNWALKED and a green tip went RED. So a
# `git checkout` / `git switch` here may name only the base branch (or nothing
# but flags). Anything else — another branch, a sha, `-b`/`-c <new>`, `-` — is
# denied unless the command carries the announced escape hatch
# `TOLARIA_PRIMARY_OFF_BASE=1` (and then `check:ui` / health report the skew as
# INFRA until the checkout is back on base). Paths after `--` are §4's.
#
# Same cost order as §4: the text match first, the `git` calls only for a
# command that could be denied. A word that is a path in the tree, or a word
# that resolves to no commit, names no switch (`git checkout <file>`, `.`).
# ─────────────────────────────────────────────────────────────────────────────
if seg_has '(^|[;&|[:space:]])git[[:space:]]+(checkout|switch)([[:space:]]|$)' &&
    ! seg_has 'TOLARIA_PRIMARY_OFF_BASE=1'; then
    _off_base=""
    if [ -n "$cwd" ] && [ -d "$cwd" ]; then
        git_dir=$(git -C "$cwd" rev-parse --absolute-git-dir 2>/dev/null || true)
        common_dir=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
    else
        git_dir="" common_dir=""
    fi
    if [ -n "$git_dir" ] && [ "$git_dir" = "$common_dir" ]; then
        _old_ifs=$IFS
        IFS='
'
        set -f
        for _seg in $segments; do
            # The candidates a `git checkout|switch` IN COMMAND POSITION names
            # (first word, or after env assignments / a pipe / a subshell —
            # never the word `git` inside a quoted message): `new <name>`
            # after a create flag, `dash` for `-`, `tok <word>` otherwise.
            # Base and `HEAD` name no move; a `--` means paths follow, a
            # checkout that restores files and switches nothing (§4's).
            _cands=$(printf '%s\n' "$_seg" | awk -v base="$base_branch" '{
                on = 0; cmdpos = 1; n = 0; create = 0
                for (i = 1; i <= NF; i++) {
                    if (!on) {
                        if (cmdpos && $i == "git" && ($(i + 1) == "checkout" || $(i + 1) == "switch")) { on = 1; i++; continue }
                        if ($i ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || $i == "|" || $i ~ /\($/) { cmdpos = 1 } else { cmdpos = 0 }
                        continue
                    }
                    if ($i == "--") { n = 0; exit }
                    if ($i == "-") { out[++n] = "dash -"; continue }
                    if ($i ~ /^-./) { create = ($i ~ /^(-[bBcC]|--create|--force-create|--orphan)$/); continue }
                    t = $i; gsub(/["\047]/, "", t)
                    if (create) { out[++n] = "new " t; create = 0; continue }
                    if (t == base || t == "HEAD") continue
                    out[++n] = "tok " t
                }
            } END { for (k = 1; k <= n; k++) print out[k] }')
            [ -n "$_cands" ] || continue
            _ref=""
            _is_restore=0
            for _c in $_cands; do
                _kind=${_c%% *}
                _word=${_c#* }
                case "$_kind" in
                new | dash) _ref=$_word ;;
                tok)
                    # A word that is a path in the tree: `git checkout <file>`,
                    # `git checkout <ref> <path>` — a restore, not a switch.
                    if [ -e "$cwd/$_word" ]; then
                        _is_restore=1
                    elif [ -z "$_ref" ] &&
                        git -C "$cwd" rev-parse --verify -q "$_word^{commit}" >/dev/null 2>&1; then
                        _ref=$_word
                    fi
                    ;;
                esac
            done
            if [ -n "$_ref" ] && [ "$_is_restore" = 0 ]; then
                _off_base=$_ref
                break
            fi
        done
        set +f
        IFS=$_old_ifs
    fi
    if [ -n "$_off_base" ]; then
        deny "BLOCKED: switching the shared main checkout off \`$base_branch\` (to \`$_off_base\`).
This checkout is the DEPLOYMENT SOURCE: \`convex dev\` pushes its convex/ tree to
the local backend every \`check:ui\` walk and \`release\`'s browser step talks
to. Off \`$base_branch\` it serves other code, and they can only end INFRA
(issues #6132, #6133). Look at another branch in a worktree instead:
  git worktree add --detach ../<repo>-peek <ref>
If you really mean to move it (and accept the skew INFRA until it is back),
announce it in the command:
  TOLARIA_PRIMARY_OFF_BASE=1 git switch <branch>"
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

# 6. RETIRED (ADR 0156) — the claim is the label. The locked claim verb is
#    gone: `afk-dispatch` or an attended `/next-ticket` adds `in-progress`
#    with `gh issue edit`, so a typed claim is no longer denied.

# 6b. The release is one act — label AND assignee (issue #4752).
#
# An abort that typed `gh issue edit N --remove-label in-progress` left the
# `@me` assignee, and the planner deferred the issue as "assigned — someone
# is working it" on every pass, forever. A release that ALSO removes the
# assignee is the one `afk-dispatch` and the merge path make, and is allowed.
RELEASE_INVOKE='(^|\|)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+issue[[:space:]]+edit[[:space:]].*--remove-label(=|[[:space:]]+)["'"'"']?([^[:space:]"'"'"']*,)?in-progress["'"'"']?([[:space:],]|$)'
if seg_has "$RELEASE_INVOKE" && ! seg_has '[[:space:]]--remove-assignee(=|[[:space:]]+)["'"'"']?([^[:space:]"'"'"']*,)?@me["'"'"']?([[:space:],]|$)' "$RELEASE_INVOKE" && ! seg_has 'TOLARIA_ALLOW_MANUAL_CLAIM=1' "$RELEASE_INVOKE"; then
    deny "BLOCKED: half a release — the label comes off, the assignee stays (issue #4752).
The planner defers an assigned issue as \"someone is working it\" on every
pass, so a label-only release starves it forever. Release as ONE act:
  gh issue edit <issue#> --remove-label in-progress --remove-label pr-open --remove-assignee @me"
fi


# ─────────────────────────────────────────────────────────────────────────────
# 7. RETIRED (issue #6463) — a bare `oracle:compile` on a Bot diff is no
#    longer the sweep.
#
# Issue #4942 denied a bare `oracle:compile` from a checkout whose diff moved
# the Bot hash, because the bare write path then discarded the whole verdict
# cache and replayed every `ready` card (20–47 min). Since issue #6463 the
# bare run is session-scoped: it carries every committed verdict whose
# definition is unchanged whatever the Bot hash says, plays only the
# definition misses (seconds), and keeps the committed Bot hash in the
# header. The whole replay is `--replay-bot`, asked for by name, and runs on
# the base once per Bot change (`derive:sync --replay-bot`, the `bot-replay`
# job of `post-merge.yml`). With the sweep gone from the bare run, the
# reason to deny it is gone; `scripts/bot-sweep-inputs.ts`, the hook's one
# helper, went with it. `hook-policy.test.ts` pins the ALLOW.
# ─────────────────────────────────────────────────────────────────────────────
# 7b. The hand-off is `bun run land:ready <PR#>`, never a raw label (issue #6141).
#
# `land:ready` does three things beyond the label: the pre-queue check (the
# lane's seconds-cost steps, issue #5554), the bare `Closes #N` line when GitHub
# does not link the PR to its branch's issue (issue #5952), and the claim move to
# `pr-open`. A raw `ready-to-land` skips all three: PR #6138 went into the
# queue with 26 unconfirmed CR citations and no closing link. The claim label
# has its guard (§ 6); the hand-off label gets the same shape. Removing the label
# (unqueue) is never denied, and `land:ready`'s own `gh` calls are child
# processes this hook never sees.
#
# Every spelling `gh` accepts for adding a label to a PR: `gh pr edit
# --add-label`, `gh pr create --label` / `-l`, `gh issue edit --add-label`; `=`
# or a space, quoted or not, anywhere in a comma list. The hatch is for the
# owner labelling by hand, in the SAME segment.
READY_LABEL_INVOKE='(^|\|)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+(pr|issue)[[:space:]]+(edit|create)[[:space:]].*[[:space:]](--add-label|--label|-l)(=|[[:space:]]+)["'"'"']?([^[:space:]"'"'"']*,)?ready-to-land["'"'"']?([[:space:],]|$)'
if seg_has "$READY_LABEL_INVOKE" && ! seg_has 'TOLARIA_ALLOW_MANUAL_READY=1' "$READY_LABEL_INVOKE"; then
    deny "BLOCKED: a raw \`ready-to-land\` label skips the hand-off (issue #6141).
\`land:ready\` runs the pre-queue check (the lane's seconds-cost steps), adds the
\`Closes #N\` line when GitHub does not link the PR to its issue, and moves the
claim to \`pr-open\`; the bare label does none of it, and the PR enters the
queue to fail on an error the check catches in seconds. Hand off with:
  bun run land:ready <PR#>
Unqueueing (\`--remove-label ready-to-land\`) is never denied. Labelling by hand,
as the owner:
  TOLARIA_ALLOW_MANUAL_READY=1 gh pr edit <PR#> --add-label ready-to-land"
fi


# ─────────────────────────────────────────────────────────────────────────────
# 8. A session never runs `land` — it hands its PR off `ready-to-land`.
#
# (Issue #5641, ADR 0156: the label is the whole hand-off; the land-runner reads
# it today and the merge queue will, once the landing stack is deleted. Inside
# an `afk-pass` job the session still ends at `land:ready`.)
#
# Landing is asynchronous (issue #5469, ADR 0154 topology B'): a session ends
# at push + `bun run land:ready <PR#>` (label `ready-to-land`, claim
# `pr-open`), and ONE land-runner on the MacBook serializes rebase → lane →
# merge. A session that runs `land` itself spends 8–9 of its ~35 minutes
# polling it at a full-context message per poll, and makes the base branch a
# second writer beside the runner.
#
# Denied as an INVOCATION — start of a segment or after a `|` (or a `(`),
# env-var / `env` / `nohup` / `time` prefixes allowed —
# `bun run [--flags] land`, through `gate:run` or any
# `sh`/`bash` of `gate-run.sh`, or `bun [run] scripts/land.ts`; `land:ready`
# and `land:runner` are other scripts and pass. The hatch is the runner's own env
# var, in the SAME segment, so it names the one command it authorises:
#   TOLARIA_LAND_RUNNER=1 bun run land <PR#>
# (the owner asking for a landing by hand; `/health-fix`'s `--repair` with no
# recorded repair issue).
# ─────────────────────────────────────────────────────────────────────────────
LAND_INVOKE='(^|\|)[[:space:]]*\(?[[:space:]]*((env|nohup|time|command|exec)[[:space:]]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(bun[[:space:]]+run([[:space:]]+-[^[:space:]]+)*[[:space:]]+(gate:run[[:space:]]+)?land|bun[[:space:]]+(run[[:space:]]+)?[^[:space:]]*scripts/land\.ts|[^[:space:]]*sh[[:space:]]+[^[:space:]]*gate-run\.sh[[:space:]]+land)([[:space:]]|\)|$)'
if seg_has "$LAND_INVOKE" && ! seg_has 'TOLARIA_LAND_RUNNER=1' "$LAND_INVOKE"; then
    deny "BLOCKED: a session does not run \`land\` — it hands the PR off as \`ready-to-land\` (issue #5469).

  git push && bun run land:ready <PR#>

labels the PR \`ready-to-land\` and moves the claim to \`pr-open\`; the landing
side (the land-runner, then the merge queue) rebases, gates and merges it. A
red landing comes back as \`land-failed\` + a comment, and the next pass picks
it up as a repair.

A landing by hand, on explicit request (the runner's own hatch):
  TOLARIA_LAND_RUNNER=1 bun run land <PR#>"
fi

exit 0

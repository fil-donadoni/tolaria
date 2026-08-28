---
name: next-issue
description: Close ONE ready-for-agent issue end-to-end in THIS session — the single-session pipeline (ADR 0110). Use when the user says "next issue", "prendi la prossima issue", "close issue N", or invokes /next-issue [N].
---

# /next-issue — one context closes one issue

One session, one issue, no orchestrator, no implement subagents (ADR 0110).
Target: a median issue lands in 10-15 minutes. Everything below happens in
THIS session's context.

## 0. Pick

- `/next-issue 1234` → that issue. Otherwise: `bun run queue:plan --cap 1
--pretty` picks the top unclaimed `ready-for-agent` issue by board
  Priority (P0 → P1 → P2, then bugs, then oldest).
- Read the issue and its comments IN FULL before touching anything. The
  body's `Target files:` section (one path per line) is the declared blast
  radius — use it to scope your reading and to route the review in §4; a
  missing or comma-joined section is worth fixing in the issue while you are
  there.

## 1. Model check (before any work)

Estimate the tier the issue needs, and say it out loud in one line:

- **opus-class**: touches stack-object identity, LKI, the layer system,
  replacement effects, priority/timing edge rules, bot search/pricing — or
  carries the `model:opus` label.
- **sonnet-class**: everything else — DSL cards on exercised Ops, UI, script,
  docs, mechanical refactors.

If the issue is opus-class and this session runs a lower tier: **stop
here** — tell the user to relaunch (`claude --model opus`) or leave the
`model:opus` label for a properly-routed session. Do not "try anyway": the
2026-08 data shows underpowered attempts pay for themselves again in review
rounds. Conversely, if review later finds a wrong-mental-model defect (not a
mechanical slip), add `model:opus` to the issue so the NEXT routing is right.

## 2. Claim + worktree

- Claim: `gh issue edit N --add-label in-progress`. Already claimed by a live
  branch/PR → pick the next issue instead.
- Ephemeral worktree (bootstrap is ~2s warm — never reuse a standing one):
  `git worktree add ../tolaria-issue-N -b feat/issue-N && cd … && bun run
worktree:init` (`fix/issue-N` for bugs).

## 3. Implement — in THIS context

The path-specific rules apply unchanged (`.claude/rules/gre-development.md`,
`frontend-components.md`, `bot-development.md`): CR printed not recalled,
DSL-first, frontend wiring walk, proof-of-failure for every guarding test.
Iterate with targeted runs only (`bunx vitest run <path>`). Card variants in
tests go through `withTemporaryDefinition` — the catalogue is frozen.

**COMMIT BEFORE YOU BREAK ANYTHING.** Proof-of-failure means editing the
subject and reverting it, and with no orchestrator there is no second copy of
your work: `git checkout <file>` on a file with uncommitted changes discards
the IMPLEMENTATION, not the break. So commit the work first, then break →
run → revert against a clean baseline. Both failure modes are silent, and
both were observed the first time this skill was run for real (#2789):

- reverting a break wiped the whole implementation of the file, which then had
  to be rewritten from context;
- the SECOND revert left a later break's `perl` substitution matching nothing,
  so the test passed, and a vacuous-looking green nearly got recorded as a
  proof. **Assert the patch applied** (`grep -c` the broken text) before
  believing a red — and before believing a green.

## 4. Review — ONE round, routed by risk

Pick by the DIFF (not the issue label alone):

| Diff touches                                 | Reviewer                   |
| -------------------------------------------- | -------------------------- |
| `convex/gre/**`, `**/ai/**`, or `model:opus` | one spawn, `model: opus`   |
| anything else with code                      | one spawn, `model: sonnet` |
| docs/markdown only                           | no review                  |

Spawn exactly one reviewer subagent (`description: "review PR …"`, explicit
`model` — spawn-guard enforces both) scoped to the diff plus whatever context
it asks to read. Blocking findings: fix them HERE, in this session, re-run
the targeted tests, and answer in the PR thread. **No re-review round** — the
lane gate at `land` catches regressions; if the reviewer found a
wrong-mental-model defect, see §1's escalation note.

## 5. Land

- Pre-PR: `bun run check:lane` (degrades to `check:pr` verbatim on mixed
  diffs — that's fine).
- PR body: what changed, tests + proof-of-failure line, `{ label, spec }`
  scenario for any new card/gameplay feature (ADR 0044), UI receipt only if
  the diff can reach the DOM (`bun run check:ui`).
- `bun run land <PR#>` — it rebases, runs the lane gate under the machine
  mutex, merges, fast-forwards the primary checkout's local `main` onto the
  merged tip, tears down the worktree and both branch refs, and detaches
  `health:main` (the full gate on the merged tip — ADR 0110). If `land`
  warns that a health RED marker exists, read `bun run health:status` first:
  fixing main comes before landing new work.
- **Never do that catch-up by hand.** The merge lands through the API, so
  only `origin/main` moves; `land` owns pulling the local branch up and
  deleting the local branch, because a rule that CAN be a script is not
  prose. If `land` printed `could not fast-forward local main` (a dirty
  primary checkout, or one not on `main`), that line is the whole handover —
  say so in §6 rather than fixing the user's checkout for them.
- Issue not auto-closed by the merge → close it with a one-line comment.
  On abort: remove `in-progress`, remove the worktree.

## 6. Report

Five lines, no more: issue, PR, what landed, what the review caught (or
"clean"), anything flagged for the user. Then STOP — one issue per
invocation. The user (or the budgeted AFK driver, ADR 0109) decides whether
there is a next one.

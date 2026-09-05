---
name: next-issue
description: Close ONE ready-for-agent issue end-to-end in THIS session — the single-session pipeline (ADR 0110). Use when the user says "next issue", "prendi la prossima issue", "close issue N", or invokes /next-issue [N].
---

# /next-issue — one context closes one issue

One session, one issue, no orchestrator, no implement subagents (ADR 0110).
Target: a median issue lands in 10-15 minutes. Everything below happens in
THIS session's context.

## Context hygiene — the contract

One long context is the whole design (ADR 0110), and its one weakness is that
**nothing ever leaves it**. Every token a tool result adds is re-read as
cache-read by every later turn, so a session's cost is super-linear in its
length: measured over 2026-08-28 → 2026-09-05, a turn cost **$0.074 at 93k of
context and $0.186 at 353k** — 2.5x — and the back half of a session burned
**62% of main-thread spend for 50% of the turns**. The baseline and the command
that re-derives it: `docs/agents/quality-gates.md` § Context hygiene.

This is prose, not a gate — deliberately (issue #3078). It is three habits:

1. **Ask `gh` for fields, not for a page.** `gh issue view N` and `gh pr view N`
   render the whole record; name what you will read instead —
   `gh issue view N --json number,title,body,labels,state`, adding `comments`
   only when you are going to read them (§0 wants the comments, not the
   reactions and the project cards). One field is one field:
   `gh pr view N --json state --jq .state`, never a full view to check whether a
   PR is still open. `--jq` any list down to the columns you will use, and cap
   `--limit` — an unfielded `gh issue list` measured 7.6k tokens in one call,
   and `gh` as a bucket runs 919 tokens a call against a 512-token `git`.

2. **Noisy stdout goes to a file; the verdict comes back.** Gates, test runs,
   builds and broad searches reach the transcript as an exit code plus the lines
   that carry the answer, with the full log left on disk for a targeted re-read:

    ```bash
    L="$SCRATCHPAD/check-lane.log"   # session scratchpad — NEVER a shared /tmp
    bun run check:lane >"$L" 2>&1; echo "exit=$?"; grep -E 'Tests|FAIL|✗' "$L"
    ```

    `deny-guard.sh` § 3 already refuses a `bun run` piped into a pager, and this
    is the idiom it is asking for. The same applies to reading: `grep -c` or
    `grep -n 'export function'` before `cat`, `sed -n 'A,Bp'` for a known region,
    `--files-with-matches` when you only need the list. `fs` calls were the
    single largest sink measured — 7.9k calls, 5.2M tokens, p90 2.1k per call.

3. **Never poll.** A `sleep N; echo` round-trip is a full-price turn at tail
   context carrying zero information, and 437 of them were measured in one week.
   Background work re-invokes you when it exits — start it with
   `run_in_background` and answer the notification. For external state the
   harness cannot see (a deploy, a remote queue), use `Monitor` with an
   until-loop, not a sequence of turns.

None of this narrows what you may read. It is about the SHAPE of what enters
the transcript: read the whole issue, run the whole gate — just don't carry
the rendering of either for the rest of the session.

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

**The `model:*` label is the routing authority — there is no second criterion
here.** Absence of a label IS the answer: the issue runs on the default tier
(Sonnet). The full test and its rationale live in ONE place,
`docs/agents/triage-labels.md` § Model-routing labels — do not restate it, and
never re-derive a tier from the area an issue touches. Area-based escalation is
what the 2026-08 audit found had put half the queue on Opus for no measured
quality gain, and a prose list here that disagrees with the filing skill is how
this section shipped contradicting `/new-qa-issue` (a bot-search issue with a
mandatory blade pair is unlabelled BY DESIGN, and was being stopped as
"opus-class" anyway).

Say the tier out loud in one line, then:

- **Carries `model:opus` / `model:fable`, session runs a lower tier** → **stop
  here**: tell the user to relaunch (`claude --model opus`). Do not "try
  anyway" — the 2026-08 data shows underpowered attempts pay for themselves
  again in review rounds.
- **Unlabelled** → proceed on this session's tier, whatever it is. A higher
  tier than the label asks for is never a reason to stop.
- **Unlabelled, but reading the issue convinces you it meets the label's
  criterion** (a wrong mental model no gate catches — not "it touches the
  engine", not file count): apply the label FIRST —
  `gh issue edit N --add-label model:opus` — and only then stop or continue.
  A stop that leaves no label re-derives the same judgment next session and
  gives the filing criterion no feedback.

Likewise, if review later finds a wrong-mental-model defect (not a mechanical
slip), add `model:opus` to the issue so the NEXT routing is right.

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

**Touching the Bot (`convex/gre/{search,evaluate,moves,applyMove,ai}`,
`src/lib/ai/`, `convex/limited/botDrafter`)? Invoke `/bot-slice` FIRST**
and find your row in its **Seams** table. A missed bot seam fails no
suite — it just makes the bot quietly stupid, or makes the change
invisible in the DecisionTrace you would debug it with (#2686).

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
- **The scenario is a ```json fence under a `## Preset scenario` heading**, and
  `land` refuses the merge without one whenever the diff touches
  `convex/cards/sets/**` or `convex/gre/**`. Say "none owed" in that section
  when it genuinely isn't. You do NOT run the insert — `land` seeds it after
  the merge. (Between ADR 0110 retiring the orchestrator and this being wired,
  every emitted spec was silently dropped: 33 were recovered by
  `bun run seed:backlog`.)
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

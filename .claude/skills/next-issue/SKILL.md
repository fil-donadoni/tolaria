---
name: next-issue
description: Close ONE ready-for-agent issue end-to-end in THIS session — the single-session pipeline (ADR 0110). Use when the user says "next issue", "prendi la prossima issue", "close issue N", or invokes /next-issue [N].
---

# /next-issue — one context closes one issue

One session, one issue, no orchestrator, no implement subagents (ADR 0110).
Target and baseline: `docs/agents/quality-gates.md` § Latency per issue
(`bun run telemetry:latency`). Each step below ends on a **Done when** line;
a pass that picks, implements, reviews and lands without incident reads this
file and nothing else.

**Disclosed material** — open a file only when its condition holds:

- → `abort.md` — the abort protocol: wire the prerequisite in both stores,
  release the claim as one act. Read it when: this issue cannot land in this
  pass.
- → `land-failures.md` — `land`'s failure, retry and post-merge modes (exit
  75 / 77, a regenerable-artefact red, RED marker, wrong base, missing band).
  Read it when: `land` returns anything but a merge, or prints a warning.
- → `filing.md` — the band-inheritance procedure for an issue you file by
  hand. Read it when: you are about to run `gh issue create`.
- → `hygiene.md` — why each context-hygiene habit below exists, and where
  its measurement lives. Read it when: a habit seems not to fit your case.

## Context hygiene — three habits

Every token a tool result adds is re-read by every later turn.

1. **Ask `gh` for fields, not for a page**:
   `gh issue view N --json number,title,body,labels,state` (add `comments`
   only to read them); `--jq` lists down to the columns you use; cap
   `--limit`.
2. **Noisy stdout goes to a file; the verdict comes back**:

    ```bash
    L="$SCRATCHPAD/check-lane.log"   # session scratchpad — NEVER a shared /tmp
    bunx vitest run <path> >"$L" 2>&1; echo "exit=$?"; grep -E 'Tests|FAIL|✗' "$L"
    ```

    Read with `grep -c` / `grep -n` / `sed -n 'A,Bp'` before `cat`. `land`
    is the exception: it goes through `gate:run` below.

3. **Never poll.** No `sleep N; echo` turns. Background work that is NOT a
   gate re-invokes you when it exits — start it with `run_in_background`;
   external state the harness cannot see → `Monitor` with an until-loop. A
   gate is the one exception, to `run_in_background` itself:

<!-- <<<GATE-RULE>>> -->

RUNNING A GATE. A gate never runs detached from the call that must read its
verdict: not `run_in_background` (the notification never arrives — under `claude
-p` the end of a turn is the end of the process), and not piped into a pager
(the exit code becomes the pager's). A gate that can outlive the Bash tool's cap
— `land`, and any lane gate run by hand, both of which queue behind the
machine-wide gate mutex — runs through `bun run gate:run <script>` instead,
issued with the tool's `timeout` set to its 600000ms MAXIMUM, because the
120000ms DEFAULT is shorter than the wait this script does: each call blocks in
the FOREGROUND for at most 480s and then either returns the gate's real exit
code or exits 75, "still running"; re-running the IDENTICAL command re-attaches
to the same run and never starts a second gate. Re-run it until an exit code
comes back. This rule is the same attended and unattended — the only difference
is the cost of breaking it: an attended session that lets a gate be promoted to
the background sees the promotion and can re-attach by hand, a driven pass dies
with the turn and takes the gate's verdict with it.

<!-- <<<END GATE-RULE>>> -->

**A pass never ends its turn waiting** (issue #4763) — at ANY point: on a
gate, a regenerator (`oracle:compile`), a test suite or a `land` retry.
Whatever the pass needs the result of runs in the FOREGROUND (`gate:run`, or
a foreground call with `timeout` up to 600000ms); the turn ends only on a
verdict — landed, or a failure reported as a failure.

## 0. Pick

- `/next-issue 1234` → that issue. Otherwise `bun run queue:plan --cap 1
--pretty` picks the top unclaimed `ready-for-agent` issue (band → standalone
  before slice → own priority → bugs → oldest). The band is the parent
  umbrella's when it carries one; a `priorityBand` echo names it. "Finish PRD #N" is `--lineage <N>`,
  never a hand-picked batch.
- `queue:plan` refuses on **cap** (live claims at `sessions.cap`; stop) or on
  a **RED** health marker (exit: `bun run health:fix` instead of a pick).
- Read the issue and its comments IN FULL. Its `Target files:` section (one
  path per line) is the blast radius: scope reading and the §4 review by it;
  fix a missing or comma-joined section in the issue.
- **`/next-issue N --resume`** — a stranded claim (a dead pass pushed a
  branch or opened a PR). Do not start over: `queue:claim N`, then
  `cd "$(bun run --silent wt:new N --resume)"`. Open PR → read it against
  the issue, go to §5. Branch, no PR → finish §3–§4, open the PR, §5.

**Done when:** one issue number is chosen and its body and comments are read.

## 1. Model check

The `model:*` label is the only routing authority; no label = default tier
(Sonnet). Criterion: `docs/agents/triage-labels.md` § Model-routing labels
escalate by exception — never re-derive a tier from the area an issue touches.
Say the tier in one line, then:

- `model:opus` / `model:fable` on a lower-tier session → **stop**; tell the
  user to relaunch (`claude --model opus`). Never "try anyway".
- Unlabelled → proceed on this tier.
- Unlabelled, but the issue meets the label's criterion (a wrong mental model
  no gate catches) → `gh issue edit N --add-label model:opus` FIRST, then
  stop or continue. Same if review later finds such a defect.

**Done when:** the tier is stated and either matches the label or the pass
has stopped.

## 2. Claim + worktree

- `bun run queue:claim N` — one locked act. Refusal `claimed` → pick the
  next issue; `cap` → stop (`--no-cap` is an announced escape, never for a
  pass). Never hand-type `--add-label in-progress`.
- `cd "$(bun run --silent wt:new N)"` (`--fix` for bugs): a fresh worktree
  branched from `origin/<base>`, never a standing one.

**Done when:** `queue:claim` printed `claimed` and the shell is in the new
worktree.

## 3. Implement — in THIS context

**The DIFF's LANE decides what this section owes** (ADR 0136 §8). Commit,
then `bun run check:lane --plan` (prints the lane, runs nothing):

- **`cards`** (only `convex/cards/sets/**` + regenerated `data/**`, prose
  may ride along): the SHORT PATH — definition, `## Preset scenario` JSON,
  regenerated artefacts, CR lines confirmed (`bun run cr <id>`, then
  `bun run cr:ledger confirm <file>:<line>`). **No hand-written test, no
  proof-of-failure, no bot or frontend seam walk.** Tripwire: writing a test
  for a `cards` diff means an unexercised Op — stop, file it per `/new-op`.
- **any other lane** (`engine`, `skin`, `full`): everything below.

The short path is keyed on the LANE, never on how simple the card reads.

- Path rules apply unchanged (`.claude/rules/gre-development.md`,
  `frontend-components.md`, `bot-development.md`).
- Iterate with targeted `bunx vitest run <path>`; card variants via
  `withTemporaryDefinition`.
- Added or retitled a test that pins a constant or asserts identity → run
  `bun run check:test-hygiene` before the PR (a block missing from
  `scripts/lib/identity-test-allowlist.json` is refused by `land`'s lane).
- A new guard's tier is its MEASURED cost (≤ 10 s → `check:lane`, else
  `HEALTH_ONLY_GUARDS`); the PR states the number.
- Touching the Bot (`convex/gre/{search,evaluate,moves,applyMove,ai}`,
  `src/lib/ai/`, `convex/limited/botDrafter`) → `/bot-slice` FIRST, find
  your row in its Seams table.
- **COMMIT BEFORE YOU BREAK ANYTHING.** Proof-of-failure = break → run →
  revert against a committed baseline; `git checkout <file>` on uncommitted
  work discards the implementation. **Assert the patch applied** (`grep -c`
  the broken text) before believing a red — or a green.

**Done when:** the work is committed, targeted tests pass, and every new
guarding test has been seen red.

## 4. Review — ONE round, routed by risk

| Diff touches                                 | Reviewer                   |
| -------------------------------------------- | -------------------------- |
| `convex/gre/**`, `**/ai/**`, or `model:opus` | one spawn, `model: opus`   |
| anything else with code                      | one spawn, `model: sonnet` |
| docs/markdown only                           | no review                  |

One reviewer subagent (`description: "review PR …"`, explicit `model`),
scoped to the diff. Fix blocking findings HERE, re-run the targeted tests,
answer in the PR thread. No re-review round.

**Done when:** every blocking finding is fixed and committed, or the row
says no review.

## 5. Land

- **No pre-PR gate** (ADR 0136 §1): targeted runs + §4 review, then commit,
  push, open the PR.
- PR body: what changed, tests + proof-of-failure line, UI receipt only if
  the diff can reach the DOM (`bun run check:ui`).
- **`## Preset scenario`** heading over a `json` fence holding
  `{ "label", "spec" }` for any new card/gameplay feature (ADR 0044). `land`
  refuses a diff under `convex/cards/sets/` or `convex/gre/` without the
  heading; write "none owed" there when it is not. `land` seeds it; you do
  not.
- From the worktree, timeout 600000ms:
  `TOLARIA_GATE_RUN_KEY=land-<PR#> bun run gate:run land <PR#>` — rebase,
  lane gate under the mutex, merge, teardown. The key lets the identical
  command re-attach from anywhere after `land` deletes the worktree.
- Exit 75 → re-issue the identical command. Never end the turn on a 75.
- Diff under `convex/cards/sets/` → `bun run seed:preset --all` after the
  merge.
- Issue not auto-closed → close it with a one-line comment.

**Done when:** `land` exited 0 with the PR merged and the issue closed.

## 6. Report

Five lines, no more: issue, PR, what landed, what the review caught (or
"clean"), anything flagged for the user. Quote `land`'s lane receipt in the
"what landed" line — `lane: ran` or
`lane: skipped (gated <sha> against <base>)` (ADR 0136 §2). Then STOP — one
issue per invocation.

**Done when:** the five lines are written.

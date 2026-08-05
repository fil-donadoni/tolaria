# The loop's fan-out stays model-driven; the Workflow tool is not adopted

## Status

accepted

## Context

`/process-gh-issues` runs one pass as a sequence a model performs from prose:
select a file-disjoint batch, fan out one implement subagent per issue, review
each PR the moment its receipt lands, then merge the resulting PRs one at a time
through a serial rebase → re-gate → merge train. PRD #2180 spent eleven slices
moving the _decisions_ in that sequence out of prose and into tested code — the
batch (#2181), the runtime invariants (#2183), the receipt contract (#2182), the
merge order (#2185), the receipt-driven train (#2186), the metrics (#2187).

That work left one question open, deliberately last: should the **execution** of
the pass become a deterministic orchestration script — the `Workflow` tool —
instead of a sequence a model walks?

The case for is strong on shape. `pipeline(issues, implementStage, reviewStage)`
is _exactly_ the loop's fan-out: each issue flows implement → review
independently, with no barrier between stages, which is what §3/§3b already want
and what prose orchestration only approximates. The harness also supplies a
per-run execution journal and `resumeFromRunId`, which reads like the durable-
execution machinery #2182 built by hand.

The case against is that the loop's control flow is genuinely adaptive at four
points — collision back-off (§1b), stall probing (§3), red-baseline triage
(§0b), and the hand-back-versus-`[WIP]` call (§4 / Error handling) — where a
script would either encode the judgment badly or delegate each to a model, at
which point the determinism it bought is partial.

Two facts settled it, and neither is about that trade.

**The journal does not cross a process boundary.** `resumeFromRunId` is
same-session. The loop's resume is deliberately _cross-process_: `MAX_PASSES = 1`,
a fresh process per batch, and every piece of durable state parked where a new
process can find it — the `in-progress` label on GitHub, the branch and PR, the
`.claude/telemetry/green-sha` file, and since #2182 the receipt artifacts. That
is not an accident to be replaced; it is what makes an unattended run survive a
crash, an interrupt, or a context reset. A Workflow journal recovers a run whose
session is still alive, which is the case the loop already handles for free.
So the machinery is not duplicated — it solves a strictly narrower problem.

**A workflow script cannot perform the side effects the train is made of.** The
script body has no filesystem and no Node API; only its `agent()` calls hold
tools. Every `git rebase`, `gh pr merge`, gate invocation and `gh issue edit`
would therefore run inside a subagent. What a script would make deterministic is
the _ordering_ of those steps — and the ordering is already a pure, tested
function as of #2185 (`scripts/lib/train-order.ts`). The remaining determinism
on offer is over control flow the loop does not find hard.

## Decision

**No.** The fan-out, the review trigger and the merge-train stay model-driven,
executed from the skill's frame with the deterministic decisions supplied by the
pure modules PRD #2180 extracted.

The four adaptive points stay where they are, and this is what each rests on:

| Adaptive point                | Where the judgment lives                                        | Why not a script                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Collision back-off** (§1b)  | prose + `references/collisions.md`, probing branch/PR existence | The rule is mechanical, but the _action_ on a hit is "leave everything alone" — including not touching a label a shared GitHub account makes indistinguishable from your own. A script encoding this would still call `gh` through an agent, and the failure mode of getting it wrong is unclaiming another session's live work |
| **Stall probing** (§3)        | prose, cheapest-signal-upward probe                             | "Inert worktree" is a judgment over several weak signals (file mtimes, a running test process, an unpushed branch). A long gate looks exactly like a hang, and the cost of deciding wrong is two agents in one worktree                                                                                                         |
| **Red-baseline triage** (§0b) | `references/red-baseline.md`, three-row classification          | Genuinely a judgment: mapping a failure to the commit that introduced it, and deciding whether it is yours to revert. Exactly one of the three rows is the loop's to repair                                                                                                                                                     |
| **Hand-back vs `[WIP]`** (§4) | prose + the 3-attempt counter                                   | The counter is mechanical and could be script state; "is this fixable" cannot be, and it is the half that matters                                                                                                                                                                                                               |

Note what the table shows: the loop's remaining model-driven decisions are
concentrated in **exception handling**, not in the happy path. The happy path is
already deterministic — it is a plan (`queue:plan`), an order (`queue:train`),
and a set of hooks that deny the moves prose could not prevent (#2183).

## Consequences

- The loop keeps a single orchestration layer (`claude -p` + the skill), not two.
- Cross-process resume keeps working, which is the property the AFK driver
  depends on.
- Two things Workflow offers are **not** obtained and are accepted as costs:
  the harness-enforced concurrency cap (`BATCH_CAP` and the CPU budget stay a
  documented parameter plus `scripts/gate.ts`'s machine-wide mutex), and live
  in-run progress (a pass is opaque until it reports).
- Structured returns and an execution journal are already covered by the receipt
  contract and its artifact directory (#2182), which are typed, validated at the
  write, and readable by a later process.

## What would change the answer

This decision is contingent on two properties, not on taste. Revisit it if
either changes:

1. **A workflow journal that survives the process that wrote it.** If
   `resumeFromRunId` becomes usable from a new process, the strongest argument
   here disappears and the receipt directory becomes the redundant half rather
   than the load-bearing one.
2. **The adaptive points reducing to tables.** Red-baseline triage is already a
   three-row table; if stall probing and the hand-back call reach the same shape
   — a fixed classification over signals a script can read — then the judgment
   they hold has moved into data and the script stops being a worse encoding of
   it.

If either lands, the **hybrid** is the shape to adopt first, not the full
rewrite: run `pipeline(implement → review)` inside a single pass as a workflow
script — that phase is in-session, needs no barrier, and matches the primitive
exactly — while the merge-train and the exception paths stay model-driven. The
full-script option was rejected on the merits above, but the pipeline half was
rejected only for the coupling cost of running two orchestration layers at once;
that cost is worth paying if the resume gap closes.

## Alternatives considered

**Hybrid — the implement→review pipeline only.** Rejected _now_, not on
principle. It buys the harness's concurrency cap and live progress for the one
phase that fits the primitive perfectly, and it leaves every adaptive point
alone. The cost is two orchestration mechanisms in one pass: a workflow whose
agents open PRs, and a model-driven train that then consumes receipts those
agents wrote. Debugging a stuck pass would mean asking which layer is stuck.
With the deterministic decisions already extracted, the marginal gain did not
justify that seam — but it is the first thing to reach for if the revisit
triggers fire.

**Full script — the whole pass, adaptive points as `agent()` calls with
schemas.** Rejected. It concedes the point it is meant to win: four `agent()`
calls returning structured verdicts is model-driven control flow wearing a
script's clothes, and it pays for that with a runtime dependency, a second layer
to debug, and the loss of cross-process resume. The one thing it would genuinely
add — a hard token budget via `budget.remaining()` — is worth having on its own
and does not require adopting the orchestration model to get.

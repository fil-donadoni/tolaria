---
name: process-gh-issues
description: Process GitHub issues labeled ready-for-agent. Selects a file-disjoint batch by priority (board Priority field first, then bugs, then oldest), fans out parallel implement-subagents, integrates their PRs through a serial rebase+re-gate merge-train, and closes on success. Use when user says "process issues", "work on issues", "pick up issues", or invokes /process-gh-issues.
---

# Process GitHub Issues

Autonomous issue processing loop. Selects a file-disjoint **batch** of `ready-for-agent` issues by priority, implements them in parallel (one subagent + worktree each), then merges their PRs through a serial **merge-train** (rebase → re-gate → merge), closing each on success.

**This skill lives in the repository it drives** (`.claude/skills/process-gh-issues/`), not in the machine's user-level skill directory. It used to live outside any git repo, which meant the rules deciding what gets merged into `main` were the only part of the system with no version control, no review, no revert and no test — and a change to them could not be carried by a PR at all, so any issue touching this file had to be marked HITL and worked by hand. Now the loop can modify itself the same way it modifies everything else: a branch, a PR, a review, a gate. Treat an edit here as an ordinary code change, and if a rule can be moved into a script the repo tests (`scripts/queue-plan.ts`, `scripts/gate.ts`, a hook), move it — prose in this file is the fallback for what cannot be enforced mechanically, not the default home for a rule.

When the workflow stabilises it can be extracted into a shareable package; until then it belongs to this project.

**Concurrency-safe.** Multiple Claude Code processes may run this loop at the same time. Two mechanisms keep them from colliding:

- **Claim label** (`in-progress`) — marks an issue as taken so no other process selects it. Applied at selection, removed on release.
- **Git worktree** — each issue is implemented in its own throwaway worktree + branch, so concurrent processes never share a working directory or step on each other's files.

**Context efficiency — one subagent per issue (mandatory).** The orchestrator loop (this conversation) stays thin: it only selects, claims, checks dependencies, runs the serial integrate stage, verifies closure, and releases. The heavy work for each issue — reading the issue + PRD, creating the worktree, implementing, testing, running the gate, committing, pushing, opening the PR — is delegated to a **fresh subagent** spawned via the `Agent` tool. The subagent's file reads, test output, and edit churn never enter the orchestrator's context; only the subagent's terse final receipt does. This keeps the orchestrator context small across a long run. Spawn a **new** subagent per issue (do not reuse one) — a fresh context per issue is the point.

**Throughput model — parallel implement, serial integrate (merge-train).** Implementation fans out; merging does not. Claim/worktree isolation gives collision-free parallel _implement_, but **not** safe _integrate_: if each subagent merged its own PR against a stale base with no rebase and no re-gate, two clusters could each pass their own gate and land a combined state that was never gated — silent red on `main`, violating the green-main invariant (§0). So:

- **Fan-out (parallel):** the orchestrator selects a _batch_ of mutually-disjoint ready issues, claims all, and spawns N subagents concurrently (each its own worktree, capped at a small concurrency limit). Subagents implement, gate, push, and open a PR — but **do not merge.**
- **Integrate (serial, orchestrator-owned):** the orchestrator merges the resulting PRs **one at a time** behind a merge lock — rebase onto the current `main` tip → re-run the full gate on the rebased state → merge only if green; otherwise hand the branch back to a subagent for fixup. This is the only place a merge to `main` happens.

**One full gate per landing tree — at the train, and CI runs it when the repo has one.** The full suite + `check:all` run exactly once per PR, in the merge-train (§4 step 3), on the rebased tree that actually lands. Subagents run only **targeted tests + fast static checks** pre-PR (subagent brief § pre-PR gate) — they never pay the full suite (a per-branch full gate would be re-paid at the train anyway: 2N−1 → N full gates per batch). **If the repo has required CI status checks covering the suites, THEY are that gate** (§4 step 3, Lane A): with `strict: true` they run on the exact tree that lands, which a local gate cannot promise because `main` moves while the suite runs. Only run the suite locally when no such checks exist. Gate dedup applies everywhere: a full gate that passed on a given tree (`git rev-parse HEAD^{tree}`) is valid for that tree everywhere — never re-run the suite on a tree already verified green (baseline SHA cache §0, subagent abort-on-red skip (subagent brief)); the train itself is the deliberate exception — `land` always gates. Dedup, not relaxation.

**Review pre-merge (mandatory, parallel).** Every PR is reviewed by a fresh reviewer subagent before merge. The review is spawned **as soon as that PR's receipt arrives** (§3b) — it runs in parallel with still-working implementers, so its wall-clock cost hides inside the fan-out. The merge-train (§4) consumes the verdict; it never merges an unreviewed PR.

## References — loaded on demand, not part of this frame

This file is the **frame**: what every pass needs. Everything episodic lives in
`references/`, opened only when its situation arises. Two of them are read by a
SUBAGENT rather than by the orchestrator — pass the path, never the contents.

| File                                  | Open when                                                            | Read by          |
| ------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| `references/priority-rationale.md`    | changing the sort key, or the lineage order looks wrong              | orchestrator     |
| `references/red-baseline.md`          | the green-main precondition (§0) fails                               | orchestrator     |
| `references/collisions.md`            | a claim probe trips, a branch/worktree exists, a subagent goes quiet | orchestrator     |
| `references/subagent-brief.md`        | spawning an implement / fixup subagent                               | **the subagent** |
| `references/reviewer-brief.md`        | spawning a reviewer subagent                                         | **the reviewer** |
| `references/merge-train.md`           | picking the gate lane (once per run); `gh pr merge` misbehaves       | orchestrator     |
| `references/scenario-registration.md` | a receipt carried a `scenario` (§5)                                  | orchestrator     |
| `references/afk-driver.md`            | setting up or debugging `bun run loop:afk` (§ Running unattended)    | the human/user   |

Nothing here is duplicated there. If you find yourself restating a reference in
this frame, move the sentence rather than copying it — two copies of a rule
drift, and the stale one reads as authoritative.

## Parameters

- `MAX_PASSES = 1` — batches per process. **One batch, then exit** (see § Running unattended): the loop's durable state lives in GitHub labels and `.claude/telemetry/green-sha`, not in the conversation, so a fresh process per batch costs nothing and caps context growth. Raise only for an interactive run you are watching.
- `SUBAGENT_STALL_MINUTES = 20` — no receipt and no worktree activity for this long ⇒ probe for liveness (see § Stalled subagents).
- `BATCH_CAP = 4` — max issues per fan-out batch. Tune here only. **The cap is a CPU budget, not just a context budget**: every concurrent subagent runs targeted tests, a type-check and a lint. If the project enforces a per-process worker cap (Tolaria: 2 vitest workers per light job, see its CLAUDE.md § Quality gates), `BATCH_CAP × workers` should stay at or below the machine's core count. Raising the cap without raising that budget buys queueing, not throughput.
- `STALE_CLAIM_HOURS = 24` — claim-orphan threshold; the planner applies it and reports orphans as `staleClaims` (§1).
- `DEFAULT_IMPL_MODEL = sonnet` — implement/fixup subagent model when the issue carries no `model:*` label. **Never omit the `model` parameter**: omitting it inherits the orchestrator's session model, which silently routes every unlabeled issue to whatever tier the session runs on (a Fable/Opus session = most expensive tier on routine work).
- Reviewer model: **`opus`, fixed** — independent of the issue's `model:*` label (review reads a diff, costs a fraction of implementation; a strong reviewer over a cheap implementer is the asymmetry to exploit).

## Priority order

1. **Board `Priority`** — the `Priority` single-select on the GitHub Project board (`P0` → `P1` → `P2`), above everything unprioritized
2. `bug` label
3. Within same category: **oldest LINEAGE first** — sort by **`parent.number ?? number`**, ascending

Keys 2–3 are DEFAULTS for the issues nobody has ruled on. Key 1 is the maintainer's live override and beats them all — **a `P2` outranks an unprioritized `bug`**, deliberately: a human looked at the board this week, the heuristic did not.

**The planner computes this — you do not.** `bun run queue:plan` prints the result (§1), echoing `priority` on each admitted issue so the plan says _why_ something jumped. The sort key looks arbitrary and is not: see `references/priority-rationale.md` **before changing it**, and when an intake skill writes a `--parent` edge.

**A board that cannot be read is a HARD STOP.** `queue:plan` exits non-zero rather than plan without the priorities — a batch ordered on stale defaults looks completely normal and nothing goes red. Fix the access (`gh auth refresh -s read:project`) or pass `--no-priority` to plan on the defaults deliberately.

## Main loop

### 0. Green-main precondition (abort if baseline is red)

**The loop's pre-merge gate is its only done/not-done signal — a red baseline poisons it.** Before selecting any issue, confirm `main`'s baseline suite is green:

```bash
git -C <main-repo-root> checkout main && git pull --ff-only
bun run test   # or the project's full suite from CLAUDE.md § Quality gates
```

**Cheaper equivalent when the repo has required CI checks (§4 step 3, Lane A):** don't run the suite — read the verdict CI already recorded for the tip.

```bash
gh api repos/<owner>/<repo>/commits/<tip-sha>/check-runs \
  --jq '[.check_runs[] | {name, conclusion}]'
```

Every required check `success` → baseline green, proceed. Any required check failed → treat exactly as a red baseline below. No check runs at all (a tip pushed straight to `main`, bypassing a PR) → fall back to running the suite.

**Never work in the shared main checkout.** Other sessions may be editing it live — `git status` showing a dozen modified files is the normal state, not a problem to clean up. Never `git checkout --`, `stash`, or `switch` there, and prefer not to edit files there at all: a concurrent session running `git commit -a` will sweep your edit into an unrelated commit (observed). Make even one-file doc changes in your own worktree.

- If the baseline is **green** → record the tip as the **verified-green SHA** and proceed to selection.
- If the baseline is **red** → **never select, claim, or branch off it** (branching off red makes every subagent thrash, fix unrelated tests, or merge red). **Classify the red first, then act** (§0b).

#### 0b. Red baseline → classify before acting

Never select, claim or branch off a red baseline — and never simply stop either, or an unattended loop is dead until a human notices. **Classify the red, then act: `references/red-baseline.md`.** Exactly one class (a commit this loop merged) is yours to revert; a red you did not cause is a `bug` issue plus a stop.

**SHA cache (gate dedup), persisted across sessions.** After every full gate that passes on `main`'s tip (baseline, integrate re-gate, post-merge), write the SHA to `.claude/telemetry/green-sha` (`mkdir -p .claude/telemetry && git rev-parse HEAD > .claude/telemetry/green-sha`, from the main checkout, gitignored) — the file is only ever written after a green gate, so a later session can trust it. At the start of every pass: `git pull --ff-only`, compare the tip with it — **identical → skip the baseline suite** (main is green by construction: its tip is the last merged PR, which passed the train's gate); **different or missing** (external push, another process merged) → run the full baseline as above, then write the file. This removes the "first pass always pays the full baseline" cost (~the full-suite duration per session).

Each **subagent** repeats this check inside its worktree before implementing — **unless its branch starts exactly at the verified-green SHA the orchestrator passed in the prompt** (gate dedup: same tree, same result — skip). If the branch base differs (main moved, or a pre-existing WIP branch), run the full suite: if the pre-existing failure set (before any edits) is non-empty, abort immediately and report the reds back — it does **not** implement on top of red. "Not my test" is never an exemption.

Each pass of the loop selects a **batch** of issues, fans them out to parallel subagents, then integrates the results serially.

### 1. Get the batch from the planner

**Do not derive the batch. Run the planner and execute its output.**

```bash
bun run queue:plan --cap 4 --pretty
```

It prints one JSON object (`version: 1`) and makes the `gh` calls itself — one list call, then one body fetch per candidate it actually considers. Only the plan crosses into this context, never the queue.

```jsonc
{
    "version": 1,
    "batch": [
        {
            "number": 2187,
            "title": "…",
            "type": "feat",
            "model": "sonnet",
            "hitl": false,
            "targetFiles": ["scripts/**"],
            "blastRadius": "declared",
            "reason": "…",
        },
    ],
    "deferred": [
        { "number": 2190, "reason": "overlaps #2187", "conflictsWith": 2187 },
    ],
    "skipped": [{ "number": 2091, "reason": "PRD…", "action": "strip-ready" }],
    "staleClaims": [1998],
}
```

**Act on each field. None of them is advisory:**

| Field         | What you do                                                                                                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staleClaims` | Release each **first**, before claiming anything: `gh issue edit N --remove-label in-progress --remove-assignee <assignee>`. The planner already checked open-PR liveness and `STALE_CLAIM_HOURS`; these are orphans from a crashed process, and an unreleased one hides ready work forever. |
| `skipped`     | Carry out the declared `action` on each (below), then move on. A skip is **never** claimed.                                                                                                                                                                                                  |
| `batch`       | Claim (§1b) and fan out (§3). Each entry's `model` is the implement tier — pass it verbatim, never re-decide it. `type` is the branch prefix (`fix/issue-N` / `feat/issue-N`). `hitl: true` means the PR is left for human review instead of auto-merged (§ HITL flag).                      |
| `deferred`    | Nothing — they stay unclaimed in the pool for a later pass. Report them with their `conflictsWith` so the pass report explains why the batch is the size it is.                                                                                                                              |

**Skip actions**, one `gh` call each plus a one-line comment saying why:

- `relabel-human` — the work cannot be landed by an automated session however well implemented: `gh issue edit N --remove-label ready-for-agent --add-label ready-for-human`. (CI-config changes under `.github/workflows/**` need the `workflow` OAuth scope, which only an interactive `gh auth refresh` grants — never work around it with an alternate token. Same for anything whose _definition of done_ is a human at a browser.)
- `strip-ready` — a spec umbrella wrongly labelled: `gh issue edit N --remove-label ready-for-agent`. **This is a fix, not a skip.** Left in place the label buys nothing (the planner skips the umbrella on _every_ pass, forever) and actively breaks the outer loop: a PRD is never `in-progress`, so it permanently falsifies the stop condition ("no more **unclaimed** `ready-for-agent` issues"). Priority for an umbrella's work comes from the lineage sort, never from a label on the parent.
- `needs-info` — malformed beyond use: `gh issue edit N --remove-label ready-for-agent --add-label needs-info`.

**When `blastRadius` is `unknown`, the plan is a solo batch and that is a signal, not a verdict.** The planner refuses to guess a file set from prose, because a wrong guess parallelizes two issues that collide. But most of the pre-`Target files:` queue declares nothing, so a plan with several `unknown` candidates degenerates to one issue per pass and the fan-out stops paying for itself. The judgment is yours, the arithmetic stays in the planner: infer the file sets, then re-run with them.

```bash
bun run queue:plan --inferred '{"2104":["convex/cards/sets/ice/**"],"2109":["src/components/debug/**"]}'
```

A declaration in the issue body always wins over an override, so this can never quietly contradict a ticket. Two cautions when inferring: an issue body names the module it is _about_, not every file it will touch — grep the candidate's key symbols for shared consumers first (two issues once both rewrote the same vs-AI driver hook, invisible until the receipts came back). A late-discovered overlap is not fatal — the receipts report the paths actually touched, and `queue:train` (§4) recomputes the merge order from them.

**If the project has no planner** (`bun run queue:plan` is absent — this skill is meant to be portable), fall back to **serial single-issue mode**: take the highest-priority unclaimed `ready-for-agent` issue by § Priority order, claim it, and run the rest of this loop with a batch of one. Do **not** hand-roll a batch query. Fan-out without a tested planner is what this section replaced: deriving the sort, the dependency scan and the disjointness walk from prose produced silent mis-orderings that looked plausible and claimed work out of order. One issue per pass is slower and always correct; the fan-out is the reward for adopting the planner.

### 1b. Claim the batch (concurrency lock)

Immediately after assembling the batch, claim **every** issue in it so no other process picks one up in parallel. For each `#N` in the batch:

```bash
# create the label once if it doesn't exist (idempotent — ignore "already exists")
gh label create in-progress --color FBCA04 --description "Claimed by an agent currently working it" 2>/dev/null || true

# claim: assign self AND apply the lock label
gh issue edit N --add-label in-progress --add-assignee @me
```

**Collision detection is by branch/PR existence — NEVER by assignee.** Several loops run under the same GitHub account, so an assignee check passes every collision straight through. Probe before writing the label, and re-probe after: **`references/collisions.md`** carries the probe, the race tiebreak, and what you must NOT touch when another session owns an issue (releasing their label unclaims their live work).

### 2. Dependencies — already resolved in the plan

The planner scans each candidate's body for `blocked by #N` / `depends on #N` / `requires #N` / `after #N`, resolves each reference, and applies the outcome before the batch is finalised: a **closed** blocker leaves the candidate eligible; an **open** one puts the candidate in `deferred` with `conflictsWith: N`. An issue and something it depends on can therefore never share a batch.

Nothing to do here — the rule is `scripts/lib/queue-plan.ts`, and the plan you already have is its output. In the no-planner fallback (§1), a batch of one cannot contain its own blocker, so the only check is: if the single candidate's body names an **open** blocker, skip it, release any claim (see Release), report "Skipping #N — blocked by #M", and take the next one.

### 3. Fan out — spawn one subagent per batch issue, concurrently

Spawn a **fresh** subagent via the `Agent` tool for **each** issue in the batch, **in a single message with multiple tool calls** so they run concurrently (one new subagent per issue — never reuse one). The orchestrator does NOT read the issue body, create the worktree, edit files, or run tests itself — each subagent does its own. Pass each subagent everything it needs in the prompt:

- The issue number `#N` and its type (bug → `fix`, enhancement → `feat`).
- The **`BATCH_ID`** — the receipt directory this pass writes to (subagent brief § receipt). Use the orchestrator's session id, which is also what the `SubagentStop` hook derives its path from; a subagent writing to a directory the hook cannot find would defeat the missing-receipt guarantee.
- The **verified-green SHA** from §0 (enables the subagent's abort-on-red skip).
- Whether the HITL flag is set (so its PR is left for human review — see HITL flag).
- The instructions below, which the subagent follows end-to-end.
- **One sentence naming the hard part of THIS issue** — lead with it, before any compliance material. Not "follow the rules": what is the specific thing that is easy to get wrong here? ("the hard part is deciding which of the existing raise sites count as a search", "the hard part is that two shipped cards reuse this choice kind for something else".) A prompt that is all guard checklist and silent on the semantics produces a subagent that satisfies every guard and gets the semantics wrong — the checklist cannot check what nobody stated. If you cannot name the hard part from the issue body, that is a signal the issue needs a producer census (subagent brief) or is under-specified, not that it has none.

**Investigator-first — the implementer receives a map, it does not explore.**
Telemetry (2026-08-06): implement-subagents averaged **183k tokens of context
per message** (files read while wandering) against 68k for `investigate`
subagents, whose compressed output costs ~$2.6/run — every file the implementer
never opens is content it does not re-read on each of its next 150 messages.
So, for each batch issue whose `targetFiles` name a
glob/module or more than 2 files (engine/cross-module work): spawn an
`investigate` subagent first (`model: sonnet`, description prefixed
`investigate`), concurrently across the batch, asking for a compact `file:line`
map of the sites the issue must touch (definitions, consumers, tests, the
reducers a UI-visible change must walk). Pass that map in the
implement-subagent's prompt with the instruction: **work from the map; do not
re-explore** (no broad Glob/Grep sweeps — open only mapped files plus what a
mapped file directly forces). If the map proves wrong somewhere, the
implementer may explore minimally and MUST note the correction in its receipt
(that feedback is how bad maps get caught). **Skip the investigator** when
`targetFiles` pin 1–2 explicit files — a map of a two-file fix is pure
overhead.

**Model routing — take the tier from the plan, verbatim.** Every `batch` entry carries a `model` (§1). Pass it as the `model` parameter of that issue's `Agent` call. It is always present precisely so the parameter can never be omitted — omitting it inherits the orchestrator's session model, which silently routes routine work at whatever tier the session runs on (see Parameters). The planner resolves it from the issue's `model:<name>` label, falling back to `DEFAULT_IMPL_MODEL`; several labels resolve to the most capable and arrive as `modelAmbiguity`, which you report in the batch summary. The resolver is generic over any `model:<name>` in `MODEL_RANK`, but the tracker deliberately carries **only the escalation labels** — `model:opus` and `model:fable`. `model:sonnet` was retired: it said exactly what its absence already says, so it was noise on every routine issue. **An unlabelled issue is not un-triaged, it is the default tier.**

The tier governs the **implement-subagent and every follow-up subagent for that issue** — fixup and rebase-conflict-resolution handbacks (§4) inherit it (fixup difficulty correlates with issue difficulty, not with the session). The orchestrator itself and the reviewer (fixed `opus`, see Parameters) are unaffected.

**If a plan entry looks under-tiered, say so — do not silently upgrade it.** Some work is harder than its label suggests: an issue whose difficulty is **classification or taxonomy** (a new event type, a new seam other code feeds, a new union member, anything requiring the producer census in the subagent brief) wants `opus`, because the failure mode there is a wrong mental model rather than a typo — no gate catches that, only review does, expensively and serially. But re-deciding the tier per run is exactly the model-derived decision this loop moved into the planner: it makes the same issue route differently on two passes for reasons nobody can reconstruct afterwards. Report the suspicion in the pass report and **suggest the `model:opus` label**; applied at triage it persists, takes effect on the next pass, and every later run agrees. Run what the plan says in the meantime.

Every subagent has written its receipt before the train starts (§4 reads them from disk, not from this conversation). Because the batch is file-disjoint (§1), the parallel worktrees cannot collide.

**Stalled subagents — a silent one is usually alive.** If a subagent has written no receipt for `SUBAGENT_STALL_MINUTES` (`ls .claude/receipts/<BATCH_ID>/`), do **not** respawn it: a second agent in the same worktree corrupts both. Probe for liveness first, cheapest signal upward:

```bash
ls -la ../<repo>-issue-N                      # worktree still there?
git -C ../<repo>-issue-N status --porcelain   # uncommitted churn = someone is working
git -C ../<repo>-issue-N log --oneline -1     # recent commit?
find ../<repo>-issue-N -newermt '-10 minutes' -not -path '*/node_modules/*' -not -path '*/.git/*' | head
```

Any file touched in the last 10 minutes, or a running test process against that path, means it is alive — a long-running gate or a big refactor looks exactly like a hang. Only when the worktree is inert **and** no branch was pushed do you treat it as dead: release the claim, remove the worktree, and leave the issue for a later pass. Never respawn into a worktree you did not first prove idle.

### 3b. Review fan-out (parallel, receipt-triggered)

The moment a `pr-open` receipt lands in the batch directory — while other implementers are still working — spawn a **fresh reviewer subagent** (`opus`, always) on that PR's diff. Do not wait for the full batch: review wall-clock hides inside the fan-out this way, instead of stretching the serial train.

Its prompt is: read the PR diff for `#N`, and follow `references/reviewer-brief.md` end to end. Do not restate the mandate in the prompt — the reviewer reads it.

**The verdict is a receipt**, written to the batch directory as `<issue>-review.json` (`role: "review"`, `outcome: "approve" | "blocking"`, `pr`, `findings[]`). A `blocking` verdict with no findings is rejected by the contract — it is the shape that stalls a train with nothing to hand the fixup subagent. Persisting it is what makes "was this PR reviewed?" answerable after an interrupt. A **re-review** (the fixup subagent's PR, after an earlier `blocking` verdict on the same issue) is a second `review` receipt, not an edit to the first: `writeReceipt` refuses to overwrite round 1, so the re-reviewer writes with an explicit `round` one higher (`<issue>-review-2.json`) — see reviewer-brief.md. `queue:train` (§4) selects the effective verdict by round, so the later one always wins regardless of which file it reads first.

The train (§4) consumes these verdicts. `blocking` → hand the branch to a fixup subagent (issue's `model:*` label, max 3 attempts) before that PR may enter the merge steps.

**Migration light lane (`migration` label) — skip the review.** A `migration`-labelled issue is a machine-proven pure refactor: a `resolve()`→`effects[]` transcription whose behavioural equivalence is proven by its own pre-existing per-card test kept byte-for-byte untouched, green before and after (PRD #826, playbook `docs/agents/effect-script-migration.md`). It carries no CR-correctness or design risk a reviewer would catch, so **do NOT spawn a reviewer subagent** for it in this section. The train (§4 step 2) treats an absent verdict on a `migration` issue as an implicit `approve` — never as "review still running". This lightens only the **per-issue** overhead; the green-main invariant is upheld unchanged by the merge-train's full-suite gate (§4 step 3), which still runs once per train on the combined state that actually lands.

**The subagent task itself lives in `references/subagent-brief.md`** — worktree, abort-on-red, producer census, implementation, pre-PR gate, PR, receipt. The subagent reads that file as its first action; do **not** paste its contents into the prompt. The prompt carries only what is specific to this issue (the list above) plus the path.

### 4. Integrate (serial merge-train, orchestrator-owned)

**Get the merge order from the receipts. Do not derive it.**

```bash
bun run queue:train --batch <BATCH_ID> --pretty
```

It reads the batch's receipts, builds the conflict graph over the paths each PR actually touched, and returns the sequence to merge in:

| Field        | What it is                                                                                                                                                      | What you do                                                                                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order`      | issue numbers, in merge sequence                                                                                                                                | merge in exactly this order                                                                                                                                                                                                                                                                                                         |
| `cycles`     | PRs with no correct relative order                                                                                                                              | **non-empty ⇒ `order` is empty and the train does not run.** Report it, land nothing, leave the claims                                                                                                                                                                                                                              |
| `edges`      | `{before, after, path}` — why the order is what it is                                                                                                           | quote in the pass report when the order surprises you                                                                                                                                                                                                                                                                               |
| `entries`    | per mergeable issue: `pr`, `branch`, `worktree`, `verdict`, `scenario`                                                                                          | this is the join you would otherwise hold in context — read the one field you need, per step                                                                                                                                                                                                                                        |
| `blocked`    | `wip` / `failed` / `collision` receipts                                                                                                                         | not in the train; their issues stay claimed for a later pass or fixup                                                                                                                                                                                                                                                               |
| `missing`    | subagents that stopped leaving no receipt                                                                                                                       | > 0 means work is unaccounted for — say so in the pass report, and do not treat the batch as fully implemented                                                                                                                                                                                                                      |
| `unreadable` | `{file, message}` — a receipt that failed validation, or whose filename does not match its own contents (a tampering signal), or whose round sequence has a gap | its ISSUE is quarantined out of `order`/`entries`/`blocked` — everyone else's order still printed. `queue:train` exits non-zero whenever this is non-empty; fix or re-write the named file, then re-run. Never treat a non-empty `unreadable` as "nothing to merge" — every other issue's order in the same output is still correct |

A **cycle is a stop, not a hint.** Two PRs that each restructure a file the other touches have no correct order, and that is the batch telling you it should never have been parallel. Merging one anyway means picking a sequence nobody chose. Report the cycle, leave both claimed, and let the next pass take them serially.

Then merge the PRs **one at a time** behind a serial lock. **Never merge two PRs concurrently** — the whole point of this stage is that every merge is gated against the _actual_ post-merge state of `main`, not a stale base.

**Resuming an interrupted train.** The batch directory survives the orchestrator, so a train that died mid-way does not restart from zero. Re-run `queue:train`, then ask GitHub what already landed. If the resuming session still knows its own `BATCH_ID`, `--batch <BATCH_ID>` (as above) is all you need. If it does not — a fresh orchestrator picking up someone else's stalled pass, working only from `ls .claude/receipts/` — point `queue:train` at the directory directly: `bun run queue:train --dir .claude/receipts/<batch-dir-name> --pretty` reads exactly that directory (no `RECEIPTS_ROOT` re-join), and prints the identical plan `--batch` would for the same batch. It exits non-zero if the directory holds no receipts at all — that is a "you pointed at the wrong path" signal, not "this batch has nothing to merge".

```bash
gh pr view <pr> --json state --jq .state      # MERGED → skip; nothing to re-review, nothing to re-merge
```

Everything else needed to continue is already on disk: the verdicts (so no PR is re-reviewed), the branches and worktrees (so no PR is re-created), and the scenario specs (so §5 can still register them). Do **not** re-run the fan-out for an issue whose receipt is already there.

For each issue in `order`:

1. **Take the merge lock.** Only one PR integrates at a time.
2. **Read the review verdict from its entry** (`entries[].verdict`, persisted by §3b — already the round-aware verdict, so you never have to pick between rounds yourself). `approve` → proceed. `blocking` → hand the branch to a fixup subagent (issue's `model:*` label, max 3 attempts) with `entries[].findings`, and re-review the fix before proceeding; if still blocking after 3, mark `[WIP]`, release, move on. `null` with a review still running → integrate another approved PR first and come back. **A `migration`-labelled issue has no verdict by design (§3b light lane): a `null` verdict there is an implicit `approve` — never a review still pending.** Tell both the fixup subagent and the re-reviewer which `round` to write (one past the highest already on disk for that issue+role — `ls .claude/receipts/<BATCH_ID>/ | grep '^<issue>-'`), since `writeReceipt` refuses to overwrite the prior round's file.
3. **Land it: `bun run land <PR#>`, run from that PR's own worktree.** ONE `gate.ts heavy` invocation holds the lock across fetch → rebase → gate → push → merge → green-sha → teardown, closing the gap where `main` could move between "gate green" and "merge lands" (issue #2517). Lane details, why nesting `check:all`/`test` inside it is safe, and `gh pr merge` failure modes: **`references/merge-train.md`**.
    - Refuses, named, before taking the lock: dirty tree, branch `main`, PR not open, PR head ≠ current branch.
    - A rebase conflict `--abort`s automatically inside the locked run and exits non-zero naming the conflicting paths — hand to a fresh subagent (issue's `model:*` label) to resolve, **re-review the delta**, retry.
    - Exit 0 → merged; `.claude/telemetry/green-sha` already holds the new tip.
    - Non-zero otherwise → re-check `gh pr view <PR#> --json state` first (exit code can't tell gate-red from merged-but-a-post-merge-step-failed): `MERGED` → success, go to step 4 (but if it exited via the tip-verification refusal, green-sha is stale and ref cleanup did NOT run — re-fetch `origin/main`, hand-write `.claude/telemetry/green-sha`, delete the branch refs yourself); still `OPEN` → if it failed AT the merge, retry `bun scripts/pr-merge.ts <PR#>` alone (a second `land` re-pays the gate on a verified tree, #2536); else hand to a fresh subagent for fixup (max 3 attempts, §Error handling); on success retry, else mark `[WIP]`, release, move on.
4. **Release the merge lock** and proceed to the next PR — its `bun run land <PR#>` now rebases onto the tip _including_ the PR just merged.

If the HITL flag was set on an issue, its PR is **not** merged here — report "PR #X ready for review (HITL flagged on #N)" and leave it for the human (still release the worktree/claim per Release).

### 5. Verify, release, and continue

Back in the orchestrator (do NOT re-read the diff or re-run tests):

- On a merged PR: the issue auto-closes via `Closes #N` in the PR body. Verify closure: `gh issue view N --json state`.
- **Register the preset scenario (DB-direct), reading the spec from the artifact.** Now that the PR is merged and the deployment redeployed, the card exists in the catalogue the loadability guard checks. The spec is `entries[].scenario` in the `queue:train` output — read it from there, never from memory of what the subagent said:

    ```bash
    bun run queue:train --batch <BATCH_ID> --pretty | jq -r '.entries[] | select(.scenario) | .scenario | @json'
    bunx convex run debugScenarios:seedScenarioDirect '{"label":"…","spec":{…}}'
    ```

    It upserts by label (safe to re-run), and the row is deployment-local by design (issue #1455) — not in git, so nothing to commit. Because the spec is on disk, an orchestrator that dies between the merge and the registration loses nothing: the next pass re-reads the same artifact and registers it.
    A headless subagent has never loaded a scenario, so expect the emitted spec to be both malformed and unconvincing — **`references/scenario-registration.md`** covers checking the shape and checking that it actually exercises the feature.

- **Release the claim and tear down the worktree** for every batch issue (see Release).
- **Close the parent umbrella when its last child closes.** For each issue closed this pass that declares a `parent`, read the parent's completion:

    ```bash
    gh issue view <parent> --json number,title,state,subIssuesSummary
    ```

    Close it only when **all three** hold: the parent carries the **`prd` label**, `subIssuesSummary.total > 0`, and `completed == total`. Then comment the list of children that discharged it and `gh issue close <parent> --reason completed`. An umbrella whose every slice has landed is **done** — leaving it open is how a PRD from three months ago still reads as live work, and how the same spec gets re-audited and re-ticketed by a later intake pass. This is the only place in the loop that closes a `prd`-labelled issue; it never _implements_ one (see §1, `strip-ready`).

    **The `prd` guard is load-bearing, not a formality.** A sub-issue edge can legitimately hang off an ordinary work item (a slice split out of a normal issue during an audit), and auto-closing on child completion would then close a ticket whose own implementation has not been written. Only an umbrella is fully discharged by its children; everything else has work of its own.

    Do not close a parent on a partial count, and do not close one whose `total` is 0 — a zero means nobody wired the sub-issue edges, not that there is no work left.

- **Post-merge health check.** A gate that passed on the rebased tree can still be followed by a red `main` — a required check that only runs on `main`, a deployment step, a second merge that raced yours. After the last merge of the batch, read the tip's check runs (the §0 `gh api … /check-runs` call). Red → run §0b triage immediately: the culprit is almost certainly a commit **this loop just merged**, which is the revert case. Do not start another batch on a red tip.
- **AFK handoff — the last action of the pass, after Release and the final report.** Run `sh scripts/loop-handoff.sh --from-pass` on **every** exit path that reaches a report, including a pass that landed nothing. It decides for itself: quiet exit-0 no-op unless the checkout is armed and no driver already owns it, otherwise it detaches a `loop:drain` driver. **A blocked handoff is never an error** — the batch that just landed stays a success. Conditions and flags: `references/afk-driver.md`.

- Pass complete. With `MAX_PASSES = 1` (default), **exit here** — the driver starts a fresh process for the next batch (see § Running unattended).

## Release (mandatory on every exit path)

A claimed issue must be released no matter how the loop leaves it — success, failure, dependency-skip, or user interrupt. Releasing = drop the lock so the issue is reselectable (if not closed) **and** remove the throwaway worktree so it doesn't accumulate.

```bash
# 1. return to the main checkout before removing its worktree
cd <main-repo-root>

# 2. remove the worktree (use --force if it has uncommitted changes you intend to discard)
git worktree remove ../<repo>-issue-N

# 3. drop the claim lock + self-assignment
gh issue edit N --remove-label in-progress --remove-assignee @me
```

Release **every** claimed issue in the batch — iterate the rule below over each one:

- On a **successful merge** (§4), the issue is already closed; still remove the worktree and the `in-progress` label/assignment so the board stays clean.
- On **failure / WIP** (see Error handling), keep the branch and PR but **remove the `in-progress` claim** so the issue returns to the `ready-for-agent` pool for a later pass; remove the worktree too (the branch persists independently of its worktree).
- On **interrupt**, release **all currently-claimed batch issues** before stopping.
- On a **collision** (`branch already exists` / branch or open PR owned by another session, per §1b / subagent brief § worktree): the issue belongs to that session. **Do NOT remove the `in-progress` label or assignee** — the shared GitHub account means your `--remove-label`/`--remove-assignee` would unclaim _their_ live work. Just drop the issue from your batch and remove **only** a worktree you created yourself (never theirs). Nothing else to release.
- Stale-claim recovery: if you find an `in-progress` issue whose worktree/branch no longer exists and no PR is open, it was orphaned by a crashed process — releasing it (remove label) is safe.

## HITL flag

If issue body contains `⚠️ HITL` or `HITL`:

- Let its subagent implement + open the PR as normal (§3)
- In the integrate stage (§4), do **NOT** merge it — report to user: "PR #X ready for review (HITL flagged on #N)"
- Continue integrating the rest of the batch

## Running unattended (the outer loop)

This skill implements **one pass**. Continuous operation is an outer loop that re-invokes it, and that works because **no loop state lives in the conversation** — taken issues (`in-progress` label), done issues (issue state), the known-green tree (`.claude/telemetry/green-sha`) and in-flight work (pushed branch + open PR) are all durable outside it, so a fresh process per batch loses nothing and resets context to zero.

**Do NOT drive this with `/loop`** — it re-fires its prompt inside the SAME conversation, so context never resets and `.claude/hooks/deny-guard.sh` denies the second `bun run queue:plan`, killing pass 2. Never run many passes in one conversation to "save" the startup cost either: context growth across passes is the failure mode this design removes.

Start an unattended run with **`bun run loop:afk`** (ADR 0097/0099): it arms the checkout and detaches the out-of-process driver into its own session, so the run outlives the terminal, the SSH connection and the Claude Code process that started it, and every finished pass hands the baton on (§4 last step) even if the driver died. `bun run loop:drain` runs the same driver in the foreground. Commands, arming, permission mode, stop reasons, crash retry, budget proxy: `references/afk-driver.md`.

## The queue is the only source of work

This loop **drains** `ready-for-agent`; it never **fills** it. An empty queue is a success condition, not a problem to solve: do not invent issues, do not promote `needs-triage`, do not decide something looks worth doing. Refilling the queue is a deliberate human action through the intake skills (`/audit-tracker`, `/grill-with-docs`, `/new-set`, `/new-card`, `/new-qa-issue`), and an agent that files its own work removes the one place a human sets direction.

## When to stop

- No more **unclaimed** `ready-for-agent` issues open (all remaining carry `in-progress` — another process has them) → **stop the outer loop too**
- The **green-main precondition (§0) fails** with a red the loop did not cause (§0b row 3) — report the `bug` issue and stop
- `MAX_PASSES` reached → exit cleanly; the driver relaunches
- User interrupts → **release all currently-claimed batch issues first** (see Release)
- A dependency is blocked on a non-ready-for-agent issue and no other issues remain

Report final summary: issues completed, PRs merged, any skipped/WIP with reasons, **plus the human-blocked backlog** — counts (and numbers) of open issues carrying `needs-design`, `ready-for-human`, or the HITL flag. That list is the loop's only channel for "I am done, and here is what is waiting on you"; without it the human-owned pile grows invisibly while the queue looks healthy.

## Error handling

These rules govern the per-issue **subagent** (implement + gate + PR, §3) and the orchestrator's **integrate** stage (rebase + re-gate + merge, §4); the subagent reports its outcome as a receipt, which the integrate stage and Release act on.

- **During implementation** (subagent), only targeted tests run (CLAUDE.md § Quality gates cadence) — if they fail, fix and retry (max 3 attempts).
- The **light pre-PR gate** (subagent brief § pre-PR gate: targeted tests + static checks) must pass before the PR is opened. If it fails: fix and retry (max 3 attempts).
- The **integrate re-gate** (orchestrator, §4) must pass on the rebased state before merge (`land` never skips it). If it fails: hand the branch to a fresh subagent for fixup (max 3 attempts), re-rebase, re-gate.
- **Fixup / conflict-resolution subagents inherit the issue's `model:*` label** — same routing as the implement-subagent.
- If stuck after 3 attempts (at any of the above): leave branch as-is, open/keep a draft PR with `[WIP]` prefix, **release the claim** (remove `in-progress` so the issue can be retried later) and remove the worktree (see Release), report failure, continue with the rest of the batch
- Never force-push or skip the pre-PR gate
- Never merge a PR whose review verdict (§3b) isn't `approve`
- Never merge a tree that no full gate has passed on. Rebase onto the current `main` tip is always mandatory, and the train's gate is **never** skipped: `land` runs `check:all` + `test` on the rebased tree every time (its lock makes that the only gate per landing, #2517). Dedup applies where the cost recurs — §0, subagent — never as gate relaxation
- A worktree must never be left behind: even on an aborted attempt, run `git worktree remove` (Release) so they don't pile up across runs

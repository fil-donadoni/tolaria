---
name: process-gh-issues
description: Process GitHub issues labeled ready-for-agent. Selects a file-disjoint batch by priority (bugs first, then oldest), fans out parallel implement-subagents, integrates their PRs through a serial rebase+re-gate merge-train, and closes on success. Use when user says "process issues", "work on issues", "pick up issues", or invokes /process-gh-issues.
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

**One full gate per landing tree — at the train, and CI runs it when the repo has one.** The full suite + `check:all` run exactly once per PR, in the merge-train (§4 step 4), on the rebased tree that actually lands. Subagents run only **targeted tests + fast static checks** pre-PR (§3 step 6) — they never pay the full suite (a per-branch full gate would be re-paid at the train anyway: 2N−1 → N full gates per batch). **If the repo has required CI status checks covering the suites, THEY are that gate** (§4 step 4, Lane A): with `strict: true` they run on the exact tree that lands, which a local gate cannot promise because `main` moves while the suite runs. Only run the suite locally when no such checks exist. Gate dedup applies everywhere: a full gate that passed on a given tree (`git rev-parse HEAD^{tree}`) is valid for that tree everywhere — never re-run the suite on a tree already verified green (baseline SHA cache §0, subagent abort-on-red skip §3 step 2, identical-tree skip §4 step 4). Dedup, not relaxation.

**Review pre-merge (mandatory, parallel).** Every PR is reviewed by a fresh reviewer subagent before merge. The review is spawned **as soon as that PR's receipt arrives** (§3b) — it runs in parallel with still-working implementers, so its wall-clock cost hides inside the fan-out. The merge-train (§4) consumes the verdict; it never merges an unreviewed PR.

## Parameters

- `MAX_PASSES = 1` — batches per process. **One batch, then exit** (see § Running unattended): the loop's durable state lives in GitHub labels and `.claude/telemetry/green-sha`, not in the conversation, so a fresh process per batch costs nothing and caps context growth. Raise only for an interactive run you are watching.
- `SUBAGENT_STALL_MINUTES = 20` — no receipt and no worktree activity for this long ⇒ probe for liveness (see § Stalled subagents).
- `BATCH_CAP = 4` — max issues per fan-out batch. Tune here only. **The cap is a CPU budget, not just a context budget**: every concurrent subagent runs targeted tests, a type-check and a lint. If the project enforces a per-process worker cap (Tolaria: 2 vitest workers per light job, see its CLAUDE.md § Quality gates), `BATCH_CAP × workers` should stay at or below the machine's core count. Raising the cap without raising that budget buys queueing, not throughput.
- `STALE_CLAIM_HOURS = 24` — claim-orphan threshold; the planner applies it and reports orphans as `staleClaims` (§1).
- `DEFAULT_IMPL_MODEL = sonnet` — implement/fixup subagent model when the issue carries no `model:*` label. **Never omit the `model` parameter**: omitting it inherits the orchestrator's session model, which silently routes every unlabeled issue to whatever tier the session runs on (a Fable/Opus session = most expensive tier on routine work).
- Reviewer model: **`opus`, fixed** — independent of the issue's `model:*` label (review reads a diff, costs a fraction of implementation; a strong reviewer over a cheap implementer is the asymmetry to exploit).

## Priority order

1. `bug` label first
2. Within same category: **oldest LINEAGE first** — sort by **`parent.number ?? number`**, ascending

**The planner computes this — you do not.** `scripts/lib/queue-plan.ts` owns the sort, the two-stage fetch, the dependency scan, and the disjointness walk; `bun run queue:plan` prints the result (§1). What follows is the _rationale_, so a future reader does not "simplify" a key that looks arbitrary. It is not instructions to re-derive the query by hand.

**Why the lineage and not the issue.** A child inherits its parent's queue position, not its own creation date. Without this, every spec umbrella starves: a PRD opened in July gets its slice tickets cut in August, those sort behind the entire queue, and the PRD never converges — while each fresh audit makes it worse by adding more children at the bottom. Sorting on the parent drains lineages in the order the _work_ was commissioned: all of the oldest PRD's children, then the next PRD's, and so on.

**Sort on the parent's NUMBER, not its `createdAt`.** Issue numbers are monotonic in creation time, so the number is an exact proxy — and it is the only one available: `gh issue list --json parent` returns `{id, number, state, title, url}` and **no `createdAt`**, so a `parent.createdAt` key silently falls back to the child's own date and the whole ordering quietly reverts to the broken behaviour. (Verified 2026-08-04; check the payload before changing this key.) For issues with no parent the two keys agree, so mixing `number` and `createdAt` across the queue is not an option — use `number` for both sides.

The edge is the **native GitHub sub-issue relationship** (`gh issue edit <child> --parent <prd>`), read from the planner's single list call — free, no body fetch. A prose `Split out of #N` line in the body is documentation for humans; it is **not** the sort key, because parsing it would force a body fetch for the whole queue and destroy two-stage selection. When an intake skill cuts children from an umbrella it MUST set `--parent`; a child with no parent edge simply sorts on its own number, so the change degrades gracefully.

`gh issue edit --parent` is **unreliable under rapid fire** — observed exiting non-zero on success, no-opping silently, and once applying the wrong parent when called in a tight loop. Read every edge back (`gh issue view <child> --json parent`) and retry on mismatch; never trust the exit code. (This applies to the intake skills that WRITE edges; the planner only reads them.)

## Main loop

### 0. Green-main precondition (abort if baseline is red)

**The loop's pre-merge gate is its only done/not-done signal — a red baseline poisons it.** Before selecting any issue, confirm `main`'s baseline suite is green:

```bash
git -C <main-repo-root> checkout main && git pull --ff-only
bun run test   # or the project's full suite from CLAUDE.md § Quality gates
```

**Cheaper equivalent when the repo has required CI checks (§4 step 4, Lane A):** don't run the suite — read the verdict CI already recorded for the tip.

```bash
gh api repos/<owner>/<repo>/commits/<tip-sha>/check-runs \
  --jq '[.check_runs[] | {name, conclusion}]'
```

Every required check `success` → baseline green, proceed. Any required check failed → treat exactly as a red baseline below. No check runs at all (a tip pushed straight to `main`, bypassing a PR) → fall back to running the suite.

**Never work in the shared main checkout.** Other sessions may be editing it live — `git status` showing a dozen modified files is the normal state, not a problem to clean up. Never `git checkout --`, `stash`, or `switch` there, and prefer not to edit files there at all: a concurrent session running `git commit -a` will sweep your edit into an unrelated commit (observed). Make even one-file doc changes in your own worktree.

- If the baseline is **green** → record the tip as the **verified-green SHA** and proceed to selection.
- If the baseline is **red** → **never select, claim, or branch off it.** Branching off red makes every subagent thrash, fix unrelated tests, or merge red. But do not simply stop either: an unattended loop that halts on someone else's red is dead until a human notices. **Classify the red first, then act** (§0b).

#### 0b. Red-baseline triage (self-heal, narrowly)

Identify what broke it before doing anything: `git log --oneline -15`, then map each failing test/type-error to the commit that introduced it (`git log -S '<symbol>' -1 --format='%H %an %s' -- <file>`).

| Cause                                                                                                | Action                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flake** (re-run the failing set once, alone)                                                       | green on re-run → proceed, and note it in the final report. Do not chase it                                                                                                                                                                                                                                                                                                                       |
| **A commit THIS loop merged** (it is in your session's merge list, and the gate was green before it) | **revert it** — `git revert --no-edit <squash-sha>`, re-gate, push. The green-main invariant outranks the PR. Then reopen its issue (`gh issue reopen N`) with a comment linking the revert and the failure, remove `in-progress`, and let a later pass redo it. This is the only case where the loop rewrites `main` on its own, and it is safe because it restores a tree a gate already passed |
| **Anything else** — a direct push to `main`, another session's merge, a human's in-flight refactor   | **not yours to revert.** Open one `bug` issue (title `fix: main is red — <failing set>`), body = the failing output + the culprit commit + author, label it `bug` and `ready-for-human`, and **stop the loop** reporting that issue. Do not attempt a fix-forward on a tree you did not break: a half-understood repair on top of someone's live refactor is worse than the red                   |

Reverting a commit the loop did not merge, or force-pushing `main`, is never allowed regardless of cause.

**SHA cache (gate dedup).** The orchestrator tracks the verified-green SHA across passes, updating it on every gate that passes on `main`'s tip (baseline, integrate re-gate, post-merge). At the start of each later pass: `git pull --ff-only`, compare the tip with the cached SHA — **identical → skip the baseline suite** (main is green by construction: its tip is the last merged PR, which passed the train's gate); **different** (external push, another process merged) → run the full baseline as above.

**Persist the cache across sessions.** After every full gate that passes on `main`'s tip, write the SHA to `.claude/telemetry/green-sha` (`mkdir -p .claude/telemetry && git rev-parse HEAD > .claude/telemetry/green-sha`, from the main checkout, gitignored). At session start, if `main`'s pulled tip equals the file's SHA → skip the baseline suite entirely (the file is only ever written after a green gate, so the tip is verified by a previous session). Different or missing → run the full baseline, then write the file. This removes the "first pass always pays the full baseline" cost (~the full-suite duration per session).

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

**Collision detection is by label + branch/PR existence — NEVER by assignee.** Multiple loops commonly run under the **same GitHub account**, so both appear as the _same_ assignee: an assignee check can never tell "me, this session" from "me, another session" and will pass a collision straight through. The reliable signals that a live session **already owns** an issue are, in priority order:

1. a `feat/issue-N` / `fix/issue-N` **branch already exists** on the remote, or
2. an **open PR** already targets that issue, or
3. the `in-progress` label was **already present before you added it**.

`git ls-remote` / `gh pr list` are the ownership tokens because a subagent creates the branch early (§3 step 1) — that branch creation, not the label, is the atomic claim.

**Read-before-write.** For each `#N`, probe BEFORE writing the label:

```bash
gh label create in-progress --color FBCA04 --description "Claimed by an agent currently working it" 2>/dev/null || true

# collision probe (read-only — no writes yet)
git ls-remote --heads origin feat/issue-N fix/issue-N   # branch present? (a PR can't exist without its head branch, so this subsumes the open-PR check)
gh issue view N --json labels -q '[.labels[].name]'     # is in-progress ALREADY here?
```

- **Any signal present** (branch exists, open PR exists, or `in-progress` already there) → **another session owns it.** Do NOT add the label, do NOT spawn a subagent, drop `#N` from the batch, re-select from the top. **Never touch that issue's label / branch / worktree / PR** — they belong to the other session, and the shared assignee means removing the label would unclaim _their_ work.
- **All clear** → claim it, then re-probe once to catch a competitor that raced you between probe and write:
    ```bash
    gh issue edit N --add-label in-progress --add-assignee @me
    git ls-remote --heads origin feat/issue-N fix/issue-N   # did a branch appear meanwhile?
    ```
    If a branch/PR appeared in the interim, the other session created the branch first and wins → drop `#N` and **leave the label as-is** (it is correctly "in progress" for them; do not remove it — the shared account means your `--remove-label` would clear their flag too).

The atomic tiebreak is the branch: even if both sessions pass the probe and both add the label, only one subagent's `git worktree add -b feat/issue-N` succeeds (§3 step 1) — the other gets `branch already exists` and **must abort as a collision** (not resume it as a WIP). See §3.

Track **every claimed issue in the batch** — each one, on every exit path (merge, failure, interrupt, dependency-skip), must be released (see Release). A claim you dropped because another session owns it is **not** yours to release — leave its label/branch/PR untouched.

### 2. Dependencies — already resolved in the plan

The planner scans each candidate's body for `blocked by #N` / `depends on #N` / `requires #N` / `after #N`, resolves each reference, and applies the outcome before the batch is finalised: a **closed** blocker leaves the candidate eligible; an **open** one puts the candidate in `deferred` with `conflictsWith: N`. An issue and something it depends on can therefore never share a batch.

Nothing to do here — the rule is `scripts/lib/queue-plan.ts`, and the plan you already have is its output. In the no-planner fallback (§1), a batch of one cannot contain its own blocker, so the only check is: if the single candidate's body names an **open** blocker, skip it, release any claim (see Release), report "Skipping #N — blocked by #M", and take the next one.

### 3. Fan out — spawn one subagent per batch issue, concurrently

Spawn a **fresh** subagent via the `Agent` tool for **each** issue in the batch, **in a single message with multiple tool calls** so they run concurrently (one new subagent per issue — never reuse one). The orchestrator does NOT read the issue body, create the worktree, edit files, or run tests itself — each subagent does its own. Pass each subagent everything it needs in the prompt:

- The issue number `#N` and its type (bug → `fix`, enhancement → `feat`).
- The **`BATCH_ID`** — the receipt directory this pass writes to (§3 step 8). Use the orchestrator's session id, which is also what the `SubagentStop` hook derives its path from; a subagent writing to a directory the hook cannot find would defeat the missing-receipt guarantee.
- The **verified-green SHA** from §0 (enables the subagent's abort-on-red skip).
- Whether the HITL flag is set (so its PR is left for human review — see HITL flag).
- The instructions below, which the subagent follows end-to-end.
- **One sentence naming the hard part of THIS issue** — lead with it, before any compliance material. Not "follow the rules": what is the specific thing that is easy to get wrong here? ("the hard part is deciding which of the existing raise sites count as a search", "the hard part is that two shipped cards reuse this choice kind for something else".) A prompt that is all guard checklist and silent on the semantics produces a subagent that satisfies every guard and gets the semantics wrong — the checklist cannot check what nobody stated. If you cannot name the hard part from the issue body, that is a signal the issue needs a producer census (step 4) or is under-specified, not that it has none.

**Model routing — take the tier from the plan, verbatim.** Every `batch` entry carries a `model` (§1). Pass it as the `model` parameter of that issue's `Agent` call. It is always present precisely so the parameter can never be omitted — omitting it inherits the orchestrator's session model, which silently routes routine work at whatever tier the session runs on (see Parameters). The planner resolves it from the issue's `model:<name>` label (`model:sonnet` / `model:opus` / `model:fable` / `model:haiku`), falling back to `DEFAULT_IMPL_MODEL`; several labels resolve to the most capable and arrive as `modelAmbiguity`, which you report in the batch summary.

The tier governs the **implement-subagent and every follow-up subagent for that issue** — fixup and rebase-conflict-resolution handbacks (§4) inherit it (fixup difficulty correlates with issue difficulty, not with the session). The orchestrator itself and the reviewer (fixed `opus`, see Parameters) are unaffected.

**If a plan entry looks under-tiered, say so — do not silently upgrade it.** Some work is harder than its label suggests: an issue whose difficulty is **classification or taxonomy** (a new event type, a new seam other code feeds, a new union member, anything requiring the producer census in step 4) wants `opus`, because the failure mode there is a wrong mental model rather than a typo — no gate catches that, only review does, expensively and serially. But re-deciding the tier per run is exactly the model-derived decision this loop moved into the planner: it makes the same issue route differently on two passes for reasons nobody can reconstruct afterwards. Report the suspicion in the pass report and **suggest the `model:opus` label**; applied at triage it persists, takes effect on the next pass, and every later run agrees. Run what the plan says in the meantime.

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

Reviewer prompt mandate (strict): read the PR diff (`gh pr diff`) plus surrounding context; report **only** (a) real bugs, (b) CR-correctness violations, (c) project-rule violations — primitive reuse, type sourcing, one-component-per-file, test quality (tautological/weak tests), missing mandatory coverage per `.claude/rules/`. No style commentary, no praise, no scope creep.

**The verdict is a receipt, written to the same batch directory** as `<issue>-review.json` (`role: "review"`, `outcome: "approve" | "blocking"`, `pr`, `findings[]`) before the reviewer returns its one-line summary. A `blocking` verdict with an empty `findings` list is rejected by the contract — it is the shape that stalls a train with nothing to hand the fixup subagent. Persisting the verdict is what makes "was this PR reviewed?" answerable after an interrupt, instead of a question only the dead context could answer.

**Prove it, don't read it — empirical verification is mandatory (not optional).** A review conducted entirely by reading is a guess with a confident tone. For every load-bearing claim — the implementer's and your own — **run something**: execute the relevant tests, and where a claim is that some test _covers_ a behaviour, **deliberately break the subject and confirm the test goes red**, then revert. Comment out the new branch, invert the condition, re-introduce the original bug. A guard that does not fire is not a guard.

This is what actually catches the recurring class, and nothing else does. Three shapes, all shipped despite green suites and careful reading:

1. **The test encodes the bug** — asserts the current wrong behaviour, so it locks the defect in.
2. **The test asserts nothing** — expected and actual are the same object by construction (a captured reference into state that the code mutates **in place**), so it passes with the feature disabled.
3. **The test never reaches the code** — a hand-built view instead of the real reducer, or a catalogue guard that silently skips the card.

The asymmetry is why reading cannot substitute: a test that fails when it should pass is loud (CI red, fixed in minutes); a test that passes when it should fail is **silent forever**, and writing it, reading it, reviewing the diff and running the suite all look identical either way. Only breaking the subject distinguishes them.

**A verdict with no mutation performed and reported is not a valid verdict.** State in the receipt what you broke and what failed. If a test still passes after you break what it guards, that is a finding — report it as blocking.

**Pull the context you need — never review myopically (mandatory).** The diff is the starting point, NOT the boundary. Whenever a correctness or rule judgment depends on something the diff doesn't show, actively read it from the codebase before deciding — grep for the primitive the change should have reused, open the caller/callee of a touched function, read the CR-referenced rule, follow the type to its source, walk the view reducer a UI change depends on, read the test the coverage rule requires. **Never approve or block on an assumption when the answer is one search away**, and never let a narrow diff-only read pass a bug that a caller or a reducer would have revealed (the Phelia/one-site-honored class). A review is under-contexted until every finding — and every non-finding — rests on code actually read, not guessed. Cost is not a reason to stay shallow: the reviewer is the correctness backstop for cheap implementers, and a myopic backstop is worse than none.

The train (§4) consumes these verdicts. `blocking` → hand the branch to a fixup subagent (issue's `model:*` label, max 3 attempts) before that PR may enter the merge steps.

**Migration light lane (`migration` label) — skip the review.** A `migration`-labelled issue is a machine-proven pure refactor: a `resolve()`→`effects[]` transcription whose behavioural equivalence is proven by its own pre-existing per-card test kept byte-for-byte untouched, green before and after (PRD #826, playbook `docs/agents/effect-script-migration.md`). It carries no CR-correctness or design risk a reviewer would catch, so **do NOT spawn a reviewer subagent** for it in this section. The train (§4 step 2) treats an absent verdict on a `migration` issue as an implicit `approve` — never as "review still running". This lightens only the **per-issue** overhead; the green-main invariant is upheld unchanged by the merge-train's full-suite gate (§4 step 4), which still runs once per train on the combined state that actually lands.

**Subagent task (runs entirely in the subagent's context):**

1. **Create an isolated worktree + branch.** Branch name: `fix/issue-N` (bug) or `feat/issue-N` (enhancement). Never work in the shared main checkout — a concurrent process may be editing it. Spin up a dedicated worktree instead:

    ```bash
    # from the repo root; branch off the current default branch's tip
    git worktree add ../<repo>-issue-N -b fix/issue-N
    cd ../<repo>-issue-N
    ```

    - `../<repo>-issue-N` is a sibling dir outside the main checkout — it gets its own working files, so parallel processes never clobber each other.
    - **`git worktree add -b` is the atomic ownership claim.** If it fails with **`branch already exists`**, that is the last-line collision signal (§1b): another session claimed this issue between the orchestrator's probe and now. **Probe before assuming it's a resumable WIP:**

        ```bash
        git ls-remote --heads origin feat/issue-N        # remote branch present?
        gh pr list --state open --json headRefName | grep issue-N   # open PR?
        ```

        - **Remote branch or open PR exists → another live session owns it. ABORT immediately.** Do NOT create the worktree, do NOT reuse the branch, do NOT delete or force anything. Return a `collision` receipt (`outcome: failed`, reason "branch/PR owned by another session") so the orchestrator backs off and leaves the issue to its owner.
        - **Only** when there is **no remote branch and no open PR** (a purely local branch left by a _crashed_ prior attempt of your own loop) may you resume it with `git worktree add ../<repo>-issue-N feat/issue-N` (no `-b`).

    - **Bootstrap the worktree — first command, before anything else.** A fresh worktree is missing every gitignored runtime input: deps (`node_modules`/`vendor`), generated client/codegen output (e.g. `convex/_generated`), the local env file (`.env.local`), and the git-hook shims (`.husky/_`, whose absence silently skips `lint-staged` so prettier drift reaches the merge-train). Without the generated client, hundreds of test files fail at _import_ (`Cannot find module './_generated/api'`) — the tell is **`N files failed, 0 tests failed`**, a setup error that reads as a catastrophic red baseline and will send you debugging the wrong thing.
        - **Tolaria: `bun run worktree:init`** (idempotent; `--force` re-copies). It does all four.
        - Other projects: install deps, then copy the codegen dir + env file from the primary checkout by hand.
    - **All remaining steps run inside this worktree**, never in the main checkout.

2. **Abort-on-red check (green-main invariant, §0) — with gate-dedup skip.** If the branch tip equals the **verified-green SHA** passed in the prompt, skip this check entirely (that exact tree already passed the baseline — same tree, same result). Otherwise run the full suite on the fresh branch: if the pre-existing failure set is **non-empty** (reds you did not introduce), abort immediately — do not implement on top of red. Return a `failed` receipt naming the reds. "Not my test" is never an exemption.
3. Fetch and read the full issue body (`gh issue view N`) — acceptance criteria are the spec. If the body references a `Parent #N`, fetch and read `#N` (the PRD) as **additional spec/context** — the user stories, implementation and testing decisions there frame this slice. Read it, do **not** implement it wholesale.
    - **Context discipline — keep your own context lean (measured lever).** Telemetry shows implement subagents balloon to a **228k median / 600k peak** context, driven not by the handed-in prompt (~43k) but by **inline tool-call volume** — a single heavy run logged 113 `grep`s + 95–142 `Read`s, each result resident for the rest of the run. So: **(a) delegate codebase location/mapping to a `caveman:cavecrew-investigator` sub-agent** (spawn it via the `Agent` tool, `model: sonnet` — the plugin's copy pins no model of its own) instead of grepping/globbing the tree inline — its file dumps stay in _its_ context and only the compressed `file:line` map returns to you. Reserve your own `Read` for the handful of files you will actually edit. **(b) Pipe noisy `Bash` through a filter** — `… | tail -20`, `bun run test <path> 2>&1 | tail -30`, `grep -n` over a full-file cat — so a failing suite or a build log never dumps in full. **(c) One search question = one investigator**, not a fresh grep each time you wonder where something lives. A lean implement context is cheaper _and_ sharper (less noise to reason over).
4. **Producer census — MANDATORY before implementing, whenever the issue widens an input space.** Triggers: a new event type / trigger condition, a new hook or seam other code feeds, a new field on a shared record, a new `*.type` union member, a new predicate other call sites must satisfy. In all of these the hard part is **not writing the code — it is classifying what already flows in**, and that is precisely what a guard checklist cannot check for you.

    Before writing any implementation:
    1. **Enumerate every producer.** Grep every site that can raise/emit/produce the thing, and read each one. Not "find the choke point" — a single funnel is necessary but says nothing about the traffic through it. Delegate the sweep to a `caveman:cavecrew-investigator` (`model: sonnet`) to keep your context lean.
    2. **Tabulate the semantics.** One row per site: which field means what, who the acting party is, and — the load-bearing column — **should this one count, yes or no**. Sites that reuse a shared kind/type for a _different_ meaning are the bug: they look identical to a `kind ===` check and are not.
    3. **Put the table in the PR description**, and name any site you deliberately excluded plus why.
    4. **Derive the tests from the table, one row = one test** — explicitly including the must-NOT rows. Tests written from the implementation inherit the implementation's assumptions and cannot falsify them; tests written from an independently-built census can.
    5. **Prefer an explicit, fail-closed discriminator** over an implicit invariant ("today every real one leaves field X unset"). Implicit invariants fail _open_ the moment someone adds a producer that doesn't know about them.

    Skipping this is the single most expensive failure mode this loop has: three consecutive `blocking` review rounds on one PR, each finding a producer the implementer never read (a searcher/owner mix-up, a regression in two shipped cards, and a choice-kind overloaded by two more) — every round green on the local gate, because the tests shared the bug's premise. The census is roughly 10 lines of table and would have pre-empted all three.

5. Follow project development cycle (CLAUDE.md § Development cycle), including its **quality-gate cadence** (CLAUDE.md § Quality gates): targeted tests while iterating, the full gate once before the PR. Use the commands documented there — do not re-specify or assume a tool here. **Work test-first at the agreed seams** (`/tdd` discipline: red → green → refactor) — write the failing test before the implementation wherever a natural seam exists, so the tests the gate later runs prove behaviour rather than restate it.
    - **Preset scenario — DB-direct, post-merge (mandatory for any new card / user-visible mechanic, CLAUDE.md step 7).** The DB is the single source of truth for debug scenarios — there is no code-array/file path (issue #1455). You are headless (no Debug panel), so you do NOT insert the scenario yourself. Instead **emit one `{ label, spec }` object in your PR receipt** (spec = `debugSetupScenario`'s args minus `gameId`; pick cards/zones/phase/`landCount` that hit the golden path, and make sure every card name resolves in the catalogue). The orchestrator registers it post-merge in §5. Skip ONLY for a pure refactor with no user-visible behaviour change.
6. **Pre-PR gate (light, mandatory).** When the implementation is complete, run: (a) the **targeted tests** for everything the diff touches (the issue's own tests + the suites of the modules it modifies), and (b) the project's **complete fast static checks — never a hand-picked subset**. In Tolaria that is exactly **`bun run check:pr`**: the same `check:all:inner` as the full gate (format + lint + type-check + `check:ids` + `check:index` + `check:stubs`) on the unlocked light tier. Picking `check:ts && lint` and dropping the rest saved nothing (those three cost <0.2s each) and made every card-shipping PR fail at the merge-train on the card-index lockfile guard. Do **not** run the full suite or full `check:all` on the branch — the merge-train (§4 step 4) runs the full gate once on the rebased tree that actually lands, and a per-branch full gate would be re-paid there. Do not open the PR until this light gate is green.

    **This is enforced mechanically where the project supports it, not by prose.** Tolaria's `scripts/gate.ts` makes `bun run test` / `bun run check:all` exit 1 inside a `feat/issue-N` / `fix/issue-N` worktree — telemetry showed the prose rule alone was routinely ignored, with several subagents running full suites concurrently and driving the machine to 5× oversubscription. If a subagent hits that block, the correct response is to run the targeted gate, **never** to set the `TOLARIA_ALLOW_FULL_SUITE=1` escape hatch: that flag belongs to the orchestrator's train, not to an implement subagent.
    - **Migration light lane (`migration` label).** For a `migration`-labelled issue only, the pre-PR gate is the **targeted gate**, not the full suite: the migrated card's own per-card test (kept byte-for-byte untouched — it is the equivalence proof) plus the two catalogue sweeps that auto-discover every migrated card, `convex/cards/__tests__/effectScripts.test.ts` (static validation: schema, Op vocabulary, ref-check, JSON purity) and `convex/cards/__tests__/effectScriptSmoke.test.ts` (canned-scenario smoke through the real `resolveTopOfStack`). These three green on the branch is the pre-PR bar. The full `bun run check:all` + `bun run test` is **not** run per migration issue — the merge-train runs it once on the combined tree (§4 step 4), where it is load-bearing. Any non-`migration` issue still runs the light pre-PR gate above.

7. **Ship to a PR — but do NOT merge** (all from inside the worktree). Merging is the orchestrator's job (§4), behind the serial merge lock:
    1. Commit with message referencing the issue: `fix: <description> (closes #N)` or `feat: <description> (closes #N)`
    2. Push branch, open PR: `gh pr create --title "<type>: <short title>" --body "Closes #N\n\n<summary>"`
    3. **Stop here.** Leave the worktree intact (the orchestrator may hand the branch back for a rebase fixup in §4). Never run `gh pr merge`.
8. **Write the receipt to the batch artifact directory, then return a one-line summary.** The receipt is a FILE, not a paragraph — `.claude/receipts/<BATCH_ID>/<issue>-implement.json`, written through `writeReceipt` (`scripts/lib/receipt.ts`), which validates before it writes and rejects a malformed receipt naming the offending field. `BATCH_ID` arrives in your prompt.

    `WorkReceipt` in `scripts/lib/receipt.ts` **is** the field list — read it there rather than from a copy here, and let the validator tell you what is missing. Three fields carry judgment no schema can enforce:
    - **`targetFiles`** — the paths the diff ACTUALLY touched (`git diff --name-only main`), not the paths the issue predicted. The train's conflict graph is built from these.
    - **`restructures`** — the subset you MOVED, RENAMED, SPLIT or REWROTE, as opposed to appended to or edited in place. The train cannot derive this from paths: "we both touched `layers.ts`" says nothing about who must land first, and you are the only one who knows. Omit when nothing was restructured (the common case).
    - **`proofOfFailure`** — one entry per test you added that _guards_ a behaviour (a regression test, a catalogue guard, a CR-conformance assertion): what you broke, and what went red. Break the subject, watch it fail, revert. A test never seen failing is not evidence, and the failure mode is silent — a test that passes when it should fail looks identical to a real one in the diff, in review, and in a green suite. If a test still passes after you break what it guards, fix the test; do not report it as covered.

    Then return **one line** to the orchestrator: outcome, PR number, and — on `wip`/`failed` — what is still red. Nothing more (no file dumps, no test logs, no restated receipt). The file is the payload; the line is a pointer.

    **A `SubagentStop` hook backs this up.** If you stop without writing a receipt, `.claude/hooks/receipt-guard.sh` records a `missing` marker so the gap is a fact on disk rather than an absence. That is a backstop, not an alternative — a `missing` marker carries no PR, no paths and no verdict, so an issue whose receipt is only a marker cannot be merged this pass.

The subagent inherits the same error-handling rules (max 3 attempts, then `[WIP]` draft PR — see Error handling).

### 4. Integrate (serial merge-train, orchestrator-owned)

**Get the merge order from the receipts. Do not derive it.**

```bash
bun run queue:train --batch <BATCH_ID> --pretty
```

It reads the batch's receipts, builds the conflict graph over the paths each PR actually touched, and returns the sequence to merge in:

| Field     | What it is                                                             | What you do                                                                                                    |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `order`   | issue numbers, in merge sequence                                       | merge in exactly this order                                                                                    |
| `cycles`  | PRs with no correct relative order                                     | **non-empty ⇒ `order` is empty and the train does not run.** Report it, land nothing, leave the claims         |
| `edges`   | `{before, after, path}` — why the order is what it is                  | quote in the pass report when the order surprises you                                                          |
| `entries` | per mergeable issue: `pr`, `branch`, `worktree`, `verdict`, `scenario` | this is the join you would otherwise hold in context — read the one field you need, per step                   |
| `blocked` | `wip` / `failed` / `collision` receipts                                | not in the train; their issues stay claimed for a later pass or fixup                                          |
| `missing` | subagents that stopped leaving no receipt                              | > 0 means work is unaccounted for — say so in the pass report, and do not treat the batch as fully implemented |

A **cycle is a stop, not a hint.** Two PRs that each restructure a file the other touches have no correct order, and that is the batch telling you it should never have been parallel. Merging one anyway means picking a sequence nobody chose. Report the cycle, leave both claimed, and let the next pass take them serially.

Then merge the PRs **one at a time** behind a serial lock. **Never merge two PRs concurrently** — the whole point of this stage is that every merge is gated against the _actual_ post-merge state of `main`, not a stale base.

**Resuming an interrupted train.** The batch directory survives the orchestrator, so a train that died mid-way does not restart from zero. Re-run `queue:train`, then ask GitHub what already landed:

```bash
gh pr view <pr> --json state --jq .state      # MERGED → skip; nothing to re-review, nothing to re-merge
```

Everything else needed to continue is already on disk: the verdicts (so no PR is re-reviewed), the branches and worktrees (so no PR is re-created), and the scenario specs (so §5 can still register them). Do **not** re-run the fan-out for an issue whose receipt is already there.

For each issue in `order`:

1. **Take the merge lock.** Only one PR integrates at a time.
2. **Read the review verdict from its entry** (`entries[].verdict`, persisted by §3b). `approve` → proceed. `blocking` → hand the branch to a fixup subagent (issue's `model:*` label, max 3 attempts) with `entries[].findings`, and re-review the fix before proceeding; if still blocking after 3, mark `[WIP]`, release, move on. `null` with a review still running → integrate another approved PR first and come back. **A `migration`-labelled issue has no verdict by design (§3b light lane): a `null` verdict there is an implicit `approve` — never a review still pending.**
3. **Rebase onto the current `main` tip.** In that PR's worktree:
    ```bash
    git -C <worktree> fetch origin main
    git -C <worktree> rebase origin/main
    ```
    If the rebase conflicts (a prior PR in this same train touched an overlapping file — should be rare given §1's disjoint batching, but possible across passes), hand the branch back to a fresh subagent (issue's `model:*` label) to resolve the conflict + re-gate, then **re-review the conflict-resolution delta** (the reviewed diff is no longer what will land) and retry from step 3.
4. **Gate the rebased state.** Every landing tree is gated exactly once. **WHERE that gate runs depends on whether the repo has required CI status checks — determine this once per run, before the first merge:**

    ```bash
    gh api repos/<owner>/<repo>/branches/<default>/protection \
      --jq '.required_status_checks | {strict, contexts}'   # 404 → no protection
    ```

    **Lane A — required CI checks exist and cover the test suites (PREFERRED).** CI is the gate; do **not** re-run the full suite locally.
    - Push the rebased branch (`git push --force-with-lease`) and wait for the required checks to go green, then `gh pr merge --squash --delete-branch`.
    - Run locally **only what the required set does not cover.** Required contexts are frequently just the test suites, leaving type-check / lint / format in a non-required job — run those yourself (`bun run check:all`), they are minutes, not the suite.
    - **Why this is stricter, not looser.** With `strict: true` the branch must be up to date with the base, so CI runs on the exact tree that lands. A local gate cannot promise that: `main` moves while the suite runs, and the tree you verified is not the tree you push. That is not hypothetical — it happened twice in one session against a repo with concurrent agents. CI also runs uncontended, off the machine-wide gate mutex.
    - **`gh pr merge` failure modes to expect.** `BLOCKED` = required checks still pending, or `strict: true` and the branch fell behind (rebase again, force-push, wait for the re-run). `UNSTABLE` = mergeable, but a **non-required** check failed — inspect it before merging: if the failure is inside this PR's diff, treat it as red and hand back to fixup; if it is pre-existing on the base, merge and open a separate fix. `gh pr merge` may also print a local `fatal: 'main' is already used by worktree at …` **after** the API merge succeeded — always re-check `gh pr view N --json state` before treating it as a failure.

    **Lane B — no required checks (or they don't cover the suites).** The local full gate is the only gate: run the project's whole `check:all` + full `test` (CLAUDE.md § Quality gates) on the rebased tree, then push and merge.
    - Run it from a **dedicated gate worktree** (detached HEAD at the rebased commit, e.g. `tolaria-gate-<batch>`), never from the issue worktree — the issue-worktree guard (§3 step 6) blocks the full suite on a `feat/issue-N` / `fix/issue-N` branch by design, and never from a gate worktree another session already occupies (check `git worktree list` first). If gating in place is unavoidable, prefix with the escape hatch (`TOLARIA_ALLOW_FULL_SUITE=1 bun run test`). The train is the only caller entitled to that flag. The gate holds a machine-wide mutex, so a train gate and a concurrent session's gate serialize instead of halving each other — `[gate] waiting …` is expected output, not a hang.
    - **A fresh worktree is not runnable as-is** — same gap as §3 step 1, and the gate worktree is a fresh worktree. Bootstrap it first: **`bun run worktree:init`** in Tolaria, or install deps + copy the codegen dir and `.env.local` by hand elsewhere. Skipping this produces `N files failed, 0 tests failed`, which reads as a catastrophic red rather than a setup error.
    - **Never pipe the gate through `tail`/`head`** — the exit code becomes the pager's, and a red suite reports success. Redirect to a file and grep the summary, or read the exit code directly.
    - Dedup, not relaxation: skip the run **only** if `git rev-parse HEAD^{tree}` equals a tree a full gate already passed (track the tree hashes of passing gates — e.g. an unchanged retry after a verdict wait).

    Either lane:
    - **Green** → merge, then verify the merged tip really is the tree you gated (`git log --oneline <old-tip>..origin/main` should show only your squash) before recording it as the verified-green SHA.
    - **Red** → do **not** merge. Hand the branch back to a fresh subagent for fixup (issue's `model:*` label, max 3 attempts, §Error handling); on success retry from step 3, otherwise mark the PR `[WIP]`, release its claim, and move on.

5. **Release the merge lock**, update the verified-green SHA to the new `main` tip, and proceed to the next PR — which now rebases onto the tip _including_ the PR just merged.

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
    - **Expect the emitted spec to be wrong and check it.** A headless subagent never loads a scenario, so it writes the shape it _imagines_ — a plausible-looking `{deckId, hand, battlefield}` when the validator wants `{cards: [{name, owner, zone, count}], phase, landCount}` (observed). The mutation rejects it with the full expected validator in the error, which is the fastest way to learn the real shape; fix and re-run rather than handing the failure back.
    - **Then check it exercises the feature.** A scenario that loads is not a scenario that demonstrates anything — the emitted one used a 1-mana spell to show off _batched_ multi-land payment, which taps exactly one land. Re-pick the cards yourself against the actual mechanic, and verify every card name resolves in the catalogue (`grep -rn 'name: "…"' convex/cards/sets/`) before registering.

- **Release the claim and tear down the worktree** for every batch issue (see Release).
- **Close the parent umbrella when its last child closes.** For each issue closed this pass that declares a `parent`, read the parent's completion:

    ```bash
    gh issue view <parent> --json number,title,state,subIssuesSummary
    ```

    Close it only when **all three** hold: the parent carries the **`prd` label**, `subIssuesSummary.total > 0`, and `completed == total`. Then comment the list of children that discharged it and `gh issue close <parent> --reason completed`. An umbrella whose every slice has landed is **done** — leaving it open is how a PRD from three months ago still reads as live work, and how the same spec gets re-audited and re-ticketed by a later intake pass. This is the only place in the loop that closes a `prd`-labelled issue; it never _implements_ one (see §1, `strip-ready`).

    **The `prd` guard is load-bearing, not a formality.** A sub-issue edge can legitimately hang off an ordinary work item (a slice split out of a normal issue during an audit), and auto-closing on child completion would then close a ticket whose own implementation has not been written. Only an umbrella is fully discharged by its children; everything else has work of its own.

    Do not close a parent on a partial count, and do not close one whose `total` is 0 — a zero means nobody wired the sub-issue edges, not that there is no work left.

- **Post-merge health check.** A gate that passed on the rebased tree can still be followed by a red `main` — a required check that only runs on `main`, a deployment step, a second merge that raced yours. After the last merge of the batch, read the tip's check runs (the §0 `gh api … /check-runs` call). Red → run §0b triage immediately: the culprit is almost certainly a commit **this loop just merged**, which is the revert case. Do not start another batch on a red tip.
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
- On a **collision** (`branch already exists` / branch or open PR owned by another session, per §1b / §3 step 1): the issue belongs to that session. **Do NOT remove the `in-progress` label or assignee** — the shared GitHub account means your `--remove-label`/`--remove-assignee` would unclaim _their_ live work. Just drop the issue from your batch and remove **only** a worktree you created yourself (never theirs). Nothing else to release.
- Stale-claim recovery: if you find an `in-progress` issue whose worktree/branch no longer exists and no PR is open, it was orphaned by a crashed process — releasing it (remove label) is safe.

## HITL flag

If issue body contains `⚠️ HITL` or `HITL`:

- Let its subagent implement + open the PR as normal (§3)
- In the integrate stage (§4), do **NOT** merge it — report to user: "PR #X ready for review (HITL flagged on #N)"
- Continue integrating the rest of the batch

## Running unattended (the outer loop)

This skill implements **one pass**. Continuous operation is an outer loop that re-invokes it — and the reason that works is that **no loop state lives in the conversation**:

| State                     | Where it durably lives              |
| ------------------------- | ----------------------------------- |
| which issues are taken    | the `in-progress` label on GitHub   |
| which issues are done     | issue state (closed by `Closes #N`) |
| which tree is known green | `.claude/telemetry/green-sha`       |
| in-flight work            | the pushed branch + open PR         |

So a fresh process per batch loses nothing and resets context to zero. Drive it with `/loop` (or a shell wrapper around `claude -p "/process-gh-issues"`), one invocation per batch. **Never** try to run many passes inside one conversation to "save" the startup cost — context growth across passes is the failure mode this design removes.

Exit codes the driver acts on: **queue empty** → stop the loop (nothing left to do; do not poll aggressively — a human must refill it). **Red baseline it did not cause** (§0b row 3) → stop and surface. Anything else → relaunch.

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
- The **light pre-PR gate** (subagent, §3 step 6: targeted tests + static checks) must pass before the PR is opened. If it fails: fix and retry (max 3 attempts).
- The **integrate re-gate** (orchestrator, §4) must pass on the rebased state before merge (or be skipped only via the tree-identical dedup, §4 step 4). If it fails: hand the branch to a fresh subagent for fixup (max 3 attempts), re-rebase, re-gate.
- **Fixup / conflict-resolution subagents inherit the issue's `model:*` label** — same routing as the implement-subagent.
- If stuck after 3 attempts (at any of the above): leave branch as-is, open/keep a draft PR with `[WIP]` prefix, **release the claim** (remove `in-progress` so the issue can be retried later) and remove the worktree (see Release), report failure, continue with the rest of the batch
- Never force-push or skip the pre-PR gate
- Never merge a PR whose review verdict (§3b) isn't `approve`
- Never merge a tree that no full gate has passed on. Rebase onto the current `main` tip is always mandatory; the train's full gate may be skipped **only** when the post-rebase tree is byte-identical to a tree a full gate already passed (§4 step 4) — gate dedup, never gate relaxation
- A worktree must never be left behind: even on an aborted attempt, run `git worktree remove` (Release) so they don't pile up across runs

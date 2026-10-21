# Derived whole-file state leaves the PR: the lockfile's counts are derived on read, its header hashes and `data/catalogue/*` are written by the base after each merge, and the merge queue regenerates them in the tree it tests

## Status

**proposed** — awaiting the owner's choice between the options in
§ Options (issue #6173, parent issue #6164). The recommendation is Option 1.
No implementation ticket is cut until the owner approves a choice; the
tickets in § Implementation tickets are the plan for Option 1 and are filed
as children of issue #6164 on approval.

## Context

### The problem

At ~10 PR/h a queued PR nearly always sees the base move before it merges.
GitHub and Mergify do not run our merge drivers (`merge=regenerated`,
`scripts/merge-driver-regenerated.ts`), so two PRs that both change a
whole-file generated line conflict **textually** even when the drivers would
resolve them. Each conflict costs a `pr-refresh` rebase and force-push, a
dequeue, and a fresh `queue-lane` run (5–38 min) — issue #6164.

Issue #6169 (PR #6184, merged 2026-10-20T20:20Z) removed the amplifier: a
row's `gaps` now cites fragments by stable Fragment Key, so a card PR no
longer renumbers half of `data/oracle-compiled.json`. What is left to
collide is state that summarises the **whole** file and so changes on every
PR that changes any row:

| Derived state                                                   | Moves when                                           | Shape                   |
| --------------------------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| lockfile `header.counts`                                        | any card changes compile state                       | 3 lines                 |
| lockfile `formats` (`ReportedFormat → {total, ready, …, pool}`) | any card changes compile state                       | ~40 lines               |
| lockfile `header.compilerHash`                                  | any edit under `convex/oracle/**` (every grammar PR) | 1 line                  |
| lockfile `header.registryHash` / `poolHash` / `botHash`         | registry / hand-written card set / Bot verdict edits | 1 line each             |
| `data/catalogue/source-hash.json`                               | any row of the merged catalogue changes              | 1 line                  |
| `data/catalogue/packed-corpus.json`                             | same (global dictionary, block-packed)               | 1 line, 1.3 MB          |
| `data/catalogue/search-index.json`, `definition-index.json`     | same                                                 | 1 line, 2.0 MB / 172 kB |

`header.grammarVersion` and `header.corpus` move only on a deliberate bump or
repin; they stay in the PR that makes it (a rare, intended conflict).

These files stay **committed**: `source-hash.json`, `packed-corpus.json` and
`definition-index.json` are statically imported by the Convex bundle
(`convex/cards/compiledCatalogue.ts:25`, `compiledPool.ts:28`,
`catalogue.ts:32`), and `search-index.json` / `definition-index.json` by the
client (`src/lib/searchIndex.ts:22`, `src/lib/catalogue/set-modules.browser.ts:25`).
The question is only **who writes them, and when**.

### The measurement (`bun run queue:churn`, issue #6171)

| Window (UTC)                         | Merges | `queue-lane` runs / merge    | `pr-refresh` runs / merge | Dequeues (conflict) |
| ------------------------------------ | ------ | ---------------------------- | ------------------------- | ------------------- |
| 2026-10-20 00:00 → 20:20 (pre #6169) | 22     | 47 = **2.14** (17 cancelled) | 24 = 1.09                 | 24 (5)              |
| 2026-10-20 20:21 → 2026-10-21 08:50  | 11     | 18 = **1.64** (5 cancelled)  | 12 = 1.09                 | 9 (2)               |

Stable fragment keys took `queue-lane` runs per merge from 2.14 to 1.64. The
twelve `pr-refresh` runs of the second window logged eleven PR events:

- **8 `conflicting`**, all on generated files, all refused by the artefact
  resolver (`fix: bun run oracle:corpus && bun run oracle:compile && bun run
catalogue:pack`): PR #6178 once — its only lockfile change is the
  `compilerHash` line — and PR #6209 seven times — `compilerHash`, 40 changed lines
  of `counts` / `formats`, and all four catalogue files. PR #6209 is still
  stuck in that loop.
- 3 `base-touched` pushes of `merge:manual` PRs, which touch no generated
  file and are out of scope here.

So **every** generated-file conflict left after issue #6169 is explained by
the header and the catalogue alone. The window is small (11 merges); the
claim is the attribution, not a rate.

### A second measurement: an out-of-queue commit resets the queue

The precedent for "the base writes it" is `gaps:sync` in `post-merge.yml`
§ `housekeeping`, which commits straight to the base
(`scripts/gaps-sync.ts`, `commitAndPushAllowlist`). Its commit `913ce592b`
was pushed at 2026-10-21T07:09:30Z; the queue draft
`mergify/merge-queue/90c10cb07d` was cancelled 18 s later and two new drafts
started at 07:09:47Z and 07:09:56Z. Mergify's default
(`merge_queue.reset_on_external_merge: always`) restarts every queued draft
on a push it did not make. A base writer that commits after every merge
would therefore **double** the restarts it was meant to remove — unless the
queue is told not to reset (`reset_on_external_merge: never`, documented in
Mergify's configuration reference and its deploy guide).

### What regeneration costs

Measured on the MacBook at load average 16:

- `bun run catalogue:check` (regenerate all four catalogue files in memory
  and compare): **1 s**.
- `bun run check:oracle` with the Card Corpus cache present (full
  regenerate-and-diff of 34,890 rows plus the header): **5 s**.

So the lane can rebuild every derived byte for the tree it tests at a cost
below the ≤ 10 s guard tier (ADR 0154). Self-hosted lane runners hold the
corpus reader key (issue #5675); hosted runners do not.

## Options

### Option 1 — the base writes derived state; the PR carries rows only (recommended)

**1a. `counts` and `formats` leave the file.** They are a tally of the rows
beside them. Their readers (`oracle-report`, `oracle-fragments`,
`oracle-retirements`, `generated-artifacts`) already load the rows and
derive them on read through one shared function. No writer, no window, no
conflict. Independent of 1b and shippable first.

**1b. Header hashes and `data/catalogue/*` are written by the base.**

- **Who writes them.** A `derive:sync` step in `post-merge.yml`
  § `housekeeping`, on a self-hosted runner (it needs the corpus): regenerate
  the header hashes and the four catalogue files on the tip, commit them with
  `commit-tree` on a scratch index (the `gaps:sync` mechanics), push.
  **Coalescing**: a rejected push is not retried on a stale tip — the newer
  tip's own post-merge run regenerates from scratch; the hourly cron is the
  backstop. A commit whose regenerated bytes equal the tip's is not made.
- **The PR never carries them.** The generators keep writing them locally (a
  worktree's tests need fresh bytes); `land:ready` restores the derived paths
  to the merge-base before the hand-off push, and `check:lane` reds a PR diff
  that still touches them (`derived-in-diff`, a static path check, < 1 s).
  `pr-refresh` then has nothing to resolve: a card or grammar PR's diff is
  rows, sources and tests.
- **The queue tests what the base will hold.** `queue-lane.yml` regenerates
  the derived files **in the draft's working tree** (≈ 6 s) before
  `check:lane`, so the Mergify draft — base + PR + fresh derived state — stays
  the one integration test, and the bytes it tested are exactly those
  `derive:sync` will commit (the generators are deterministic; that
  determinism is pinned by test).
- **The queue does not reset on the derive commit.** `.mergify.yml` sets
  `merge_queue.reset_on_external_merge: never`. Safe because the derive
  commit touches only paths no PR may touch, and every draft regenerates them
  anyway. Side effect: a hand push to the base (`health:revert`, a
  `merge:manual` merge) no longer resets drafts either; a draft built before
  a revert is still tested against its own base, and the revert is itself
  re-proven by health.

**The window between a merge and its derive commit** (expected: the
post-merge job's latency, a minute or two; at worst the hourly cron):

- **Deployment.** The local Convex deployment serves whatever post-merge
  `sync` fast-forwards the primary checkout to. `sync` moves the primary only
  to a **derived-fresh** tip — `check:oracle`'s hash tier and
  `catalogue:check` both pass (≈ 6 s) — so the deployment never serves a
  catalogue that disagrees with its source (e.g. a new hand-written card
  missing from `definition-index.json`). Between a merge and its derive
  commit it stays on the previous fresh tip.
- **Health.** `health-early` and `health` judge a derived-stale tip as
  `pending`, not `RED`, for a grace of one housekeeping period (an hour); a
  tip still stale past it is `RED` with cause `derive:sync`, and `base-health`
  holds the queue as for any RED. `release` is unchanged: it re-proves the
  exact tip with the full gate, so only a derived-fresh tip can be released.
- **History.** One bot commit per merge burst on the base (coalesced, never
  more than one per merge).

**What the checks compare once the PR stops refreshing these files:**

- `check:oracle` on a **PR / draft**: `headerHashDrift` is no longer
  meaningful (the header is the base's). The lane runs the full
  regenerate-and-diff it already has (Tier 3, 5 s) and compares **per row**;
  a row that disagrees with the tree's compiler is the red. On the **base**
  (health, `sync`'s predicate) `headerHashDrift` stays as the cheap, corpus-free
  tier.
- `scripts/__tests__/catalogue-artifact.test.ts`: its freshness block
  (committed bytes = a regeneration) moves to the base's derived-fresh
  predicate, where committed bytes are supposed to be fresh. In the lane it
  runs after the in-tree regeneration, where freshness is true by
  construction; the identity, decode-equality and determinism checks
  (`packedCorpusDrift`, the source-hash pair of ADR 0113 §2) keep running
  there unchanged.

### Option 2 — merge-friendly shapes, derived state stays in the PR

1a (counts/formats derived on read), plus `definition-index.json` and
`search-index.json` rewritten one sorted entry per line so `git merge-file`
— and GitHub — merge disjoint additions. No base writer, no window.

It does not reach the goal: `packed-corpus.json` is block-packed against a
global dictionary and `source-hash.json` is one hash of everything, so any
two PRs that change a compiled row still conflict on both, and every pair of
grammar PRs still conflicts on `compilerHash`. Of the 8 measured conflicting
events, it would remove at most the `counts`/`formats` part of PR #6209's
and none of PR #6178's.

### Option 3 — status quo, automated repair

Keep derived state in the PR and let `pr-fixup` regenerate and push on a red
draft. Every push is a dequeue and a fresh `queue-lane` run; it automates the
loop issue #6164 measures instead of removing it. Rejected as a target;
listed because it is what runs today.

## Recommendation

**Option 1**, shipped in two steps: 1a first (no window; of PR #6209's conflicting
lockfile header it leaves only the `compilerHash` line), then 1b. Expected effect, to be
re-measured with `queue:churn` over one working day after each step:
generated-file `conflicting` events in `pr-refresh` → 0 (8 of 11 events in
the measured window), and `queue-lane` runs per merge from 1.64 toward 1 plus
the red rate.

## Consequences

- A card or grammar PR's diff is its rows, sources and tests; GitHub merges it
  without our drivers, and `merge=regenerated` survives only for local rebases
  of the derived paths.
- The lane needs the Card Corpus cache for the per-row oracle check on every
  PR that changes `convex/oracle/**`, a registry or `data/**` — already true of
  self-hosted lane runners, never of hosted ones.
- The base gains a writer besides the queue. Two now exist (`gaps:sync`,
  `derive:sync`), both under `housekeeping`'s concurrency group; a third needs
  its own ADR.
- `reset_on_external_merge: never` changes queue semantics for every
  out-of-queue push, not only the derive commit (§ Option 1b).

## Implementation tickets (cut on approval, children of issue #6164)

1. **Lockfile: `counts` and `formats` derived on read** — remove them from
   `serializeLockfile`, one derivation function for every reader; `check:oracle`
   structure tier accepts the new shape. Blocks nothing.
2. **Mergify: `reset_on_external_merge: never`** — `.mergify.yml` (a
   `merge:manual` PR, it touches `.mergify.yml`); measure with `queue:churn`
   that a `gaps:sync` commit no longer cancels drafts.
3. **`derive:sync` in `housekeeping`** — regenerate header hashes and
   `data/catalogue/*` on the tip, coalescing push; post-merge `sync` moves the
   primary only to a derived-fresh tip. Blocked by 2.
4. **Queue-lane regenerates derived state in the draft's tree** — and
   `check:oracle` compares per row in the lane, `headerHashDrift` on the base
   only; `catalogue-artifact.test.ts` freshness moves to the base predicate.
5. **The PR stops carrying derived paths** — `land:ready` restores them to
   the merge-base, `check:lane` `derived-in-diff` guard; health treats a
   derived-stale tip as `pending` within the grace. Blocked by 3 and 4.

# Shared files spread PR edits by their order; per-PR ledger sidecars are rejected

## Status

accepted (2026-11-06, owner decision on the measurement below, issue #8385).
Amends [ADR 0133][adr-0133] § 7, the ledger's row order.

## Context

GitHub and Mergify run no merge drivers. A queued PR touching a driven file
conflicts when the base edits a neighbouring line, even if nothing disagrees.
Issue #8385 proposed that each PR write its confirmations to its own file,
`data/cr/ledger.d/<issue>.json`, folded into the ledger by `derive:sync`, and
asked for a measurement first.

### The measurement

Window: 2026-10-30 00:00 to 2026-11-06 20:50 UTC, 329 merges, every PR comment
read (722 of 722 search results).

Each dequeue's cause comes from Mergify's comment: the code
`CONFLICT_WITH_BASE_BRANCH`, or an unchecked `-conflict` condition under
`PR_DEQUEUED`. Each conflict was attributed to paths by replaying the PR's head
at that instant against the base at that instant with
`git --attr-source=<empty tree> merge-tree`, the merge GitHub performs. The
replay found a conflict in 42 of the 44 dequeues Mergify calls conflicts.

| Dequeue cause                     | Count   |
| --------------------------------- | ------- |
| `CHECKS_FAILED`                   | 80      |
| `ready-to-land` gone, no conflict | 51      |
| conflict                          | 44      |
| `CHECKS_TIMEOUT`                  | 5       |
| `PULL_REQUEST_UPDATED`            | 1       |
| **Total**                         | **181** |

| Path in the 42 attributed conflicts   | Any | Only path |
| ------------------------------------- | --- | --------- |
| `data/cr/citations-ledger.json`       | 17  | 13        |
| `data/pick-ratings/vintage-cube.json` | 10  | 8         |
| `data/oracle-compiled.json`           | 10  | 8         |
| `data/card-index.json`                | 2   | 2         |
| other paths                           | 9   | 9 at most |

Three readings change the problem as issue #8385 stated it:

- **The ledger is the top file, not the top cause.** Removing its conflicts
  altogether clears at most 13 of 181 dequeues (7 %). A dequeue whose conflicts
  also touch another file still happens.
- **A conflict dequeue costs no lane.** Every one of the 48 replayed conflicts
  reports "no time running CI": with one draft checked at a time, these PRs had
  not reached the head. The cost is the place in the queue, and the median from
  dequeue to merge is 118 minutes.
- **The conflicts are not real.** Across the ledger's 58 replayed conflicts
  (dequeues and force-pushes), no key was changed differently on the two sides.
  In 57 the two sides touched no common key; one had an identical change on
  both.

### Why the rows collide

The two sides insert into the same gap. Rows sorted by id then text keep a hot
rule's rows together, and citation text shares prefixes such as `// ` and
`/** CR `, so two PRs reach the same few gaps. Pick Ratings have only one gap:
each card PR appends to the tail of `ratings`.

Each candidate was replayed on the same real events through `merge-tree`, with
the three sides of the file rewritten in that shape:

| Shape                               | Dequeue events | Force-push events |
| ----------------------------------- | -------------- | ----------------- |
| Ledger, as committed                | 17             | 41                |
| Ledger, blank line between rows     | 17             | 38                |
| Ledger, hash order                  | 2              | 11                |
| Ledger, hash order plus blank lines | 2              | 11                |
| Pick Ratings, as committed          | 14             | 31                |
| Pick Ratings, sorted keys           | 0              | 0                 |

Pick Ratings count 14 here, not 10, because the replay also conflicts on four
dequeues Mergify gave another cause for.

The replays cover the conflict rate only. They do not model the one-off
reorder below.

## Decision

1. **The ledger sorts by a hash of its key** (`id` + `line`), in
   `serializeLedger`. It stays one file with one row per entry, written only by
   `cr:ledger` and the driver.
2. **Pick Ratings keep their nested keys sorted.** `canonicalKeyedMap` is the
   driver's output form. `check:cube-ratings` reds a `vintage-cube.json` out of
   order, and its `--sort` flag repairs it, so a hand-appended tail is caught in
   the authoring session.
3. **Per-PR ledger sidecars are rejected.** They would remove all ledger
   conflicts rather than most, a gain of a few dequeues over hash order, at the
   price of `cr:lint` reading two sources, rules for entries moved or pruned
   before the fold, and a fold that can fail with sidecars left behind. Hash
   order has none of these, so issue #8385's questions 2 and 3 do not arise.
4. **The drivers stay.** Hash order leaves some conflicts, and `pr-refresh`
   rescues them as it does today.

`data/card-index.json` is left alone: 2 of 42. `data/oracle-compiled.json` was
not replayed in any other shape, so it gets its own measurement rather than this
decision.

## Consequences

- At most 22 of the window's 181 dequeues had only the ledger and Pick Ratings
  as conflicting paths. Half of the conflicts stay, and the larger causes,
  `CHECKS_FAILED` above all, are untouched.
- The ledger no longer reads by rule id. Nobody is meant to read it by hand:
  `bun run cr:ledger` prints open citations beside their rule, and a search by
  id or text still finds a row.
- **One-off wave.** This change rewrites the whole ledger and both ratings
  files, so a queued PR touching any of them conflicts once. `pr-refresh`
  rebases it through the drivers, which write the new order.
- A revert of this change restores the old order the same way: the drivers
  serialize whatever order the code at the rebased tip defines.

[adr-0133]: 0133-cr-citations-carry-a-committed-ledger.md

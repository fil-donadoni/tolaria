# Grammar Clusters are cut by Clause Family, capped by accepted forms, and close when their forms compile

## Status

accepted — grilled 2026-10-07 (grammar backlog granularity session). Amends
ADR 0146 § Decision 6 (closing criterion) for the `grammar` kind; the cap rule
of `/cluster-gaps` § 3 and `/new-set` Phase 3 changes unit for `grammar`.

## Context

A projection of the grammar backlog on 2026-10-07 (lockfile: 34,890 cards,
4,907 `ready`) found the Grammar Gap key too fine to cut work by. `gapShape`
folds only amounts, so "Whenever you cast a red spell" and "… a noncreature
spell" are two keys: 21,954 keys, 18,747 of them refusing a single card. A
greedy simulation over those keys needed ~12,400 keys for 80 % of the corpus;
at the measured ~15 keys and ~15–17 `ready` per grammar issue, with ~70 % of
closed keys revealing a deeper gap, that is ~1,400 issues.

Grouping keys by the head of the unconsumed span — the attribution's span
starts where the deepest sub-grammar stopped, so its opening words name the
missing construct — gave 10,159 groups (6,973 singles), the top 2,000 freeing
21,204 cards against 11,785 for the top 2,000 keys. The head groups were
coherent in the middle of the ranking ("Look at the top …", "… can't be
countered") and too wide at the top when the leading keyword was folded away.

Two rules then held the gain back. The cut cap counted keys ("~10 gaps"),
while what a cluster pays per member is a golden fixture and its proof of
failure per accepted **form** — a compositional rule reads many keys with one
form. And ADR 0146 § 6 closed a cluster only when every claimed key closed, so
a signature as wide as a family would never close.

## Decision

1. **Clause Family is a derived grouping, never a key.** Gap keys, claim rows,
   the lockfile and `matchCluster` are unchanged (stable keys, `claimsNote`).
   A Clause Family is computed from a gap: its slot and sub-grammar path plus
   the head of its span after folding amounts, colours, card types, players
   and P/T, the leading keyword kept literal. The head length and the fold list
   are code constants, tuned by the same measure (families, singles, cards
   freed by the top K).
2. **The family proposes, the signature decides.** Clause Families rank the
   backlog and propose a cut; the Cluster Signature written at the cut
   (`/cluster-gaps`, `/new-set` Phase 3) may narrow a family that is too wide.
   No compiler change is required to deepen attribution.
3. **The cap is ~10 accepted forms, not ~10 keys.** A Grammar Cluster may
   claim a whole Clause Family, any number of keys, while its rule reads them
   with about ten golden fixtures; past that it is split by sub-form.
4. **The Target chooses, the corpus sizes.** Ranking Targets keep choosing
   which family is cut and its band. The cut covers the family across the
   corpus: forms ordered by corpus cards, up to the cap.
5. **A Grammar Cluster closes when its accepted forms compile** (amends
   ADR 0146 § 6 for `grammar`). Its signature may stay family-wide and adopt
   while open; keys still live at closing are re-homed (ADR 0146 § 5) into
   singles, which feed the Cluster Cut ticket, whose next cut takes the
   family's next slice.
6. **No re-cut of open issues.** The rule applies to cuts made from now on;
   today's open grammar issues (mostly per-Op census tickets) stay as filed.
7. **Baseline for review.** ~15–17 `ready` and ~15 keys closed per grammar
   issue (the last ~24 grammar landings before this ADR). After ~20 clusters
   cut by this rule the yield is re-measured; a standing corpus-wide family
   queue, rejected here, is reconsidered only if the corpus `ready` curve has
   not moved.

## Rejected

- **A coarser key** (folding `gapShape` itself): re-maps every claim row and
  loses which form refused.
- **Deeper compiler attribution as the family**: compiler work per
  sub-grammar, and the key changes with it.
- **Cap in families** (3–6 per cluster, forms unbounded): unbounded PRs.
- **Narrow per-form signatures with ADR 0146 § 6 kept**: every slice of a
  family is a hand rewrite of globs, and new keys of the family go unadopted.
- **A second, corpus-only cut queue**: competes with the Targets for the
  session cap; deferred behind Decision 7.

## Consequences

- `scripts/lib/grammar-gaps.ts` gains the Clause Family function beside
  `gapOf`; `oracle:report` gains a family ranking.
- `/cluster-gaps` § 2–3 and `/new-set` Phase 3: grammar axis = Clause Family,
  cap = accepted forms; `/grammar-rule` acceptance reads "accepted forms
  compile".
- The managed-block heading text in `scripts/lib/gap-issues.ts` ("closes when
  every key is closed") is reworded for `grammar`.

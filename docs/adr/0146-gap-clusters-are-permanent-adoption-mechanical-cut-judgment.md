# Gap Clusters are permanent: adoption is mechanical, the cut is judgment

## Status

accepted — grilled 2026-09-25 (decisions Q1–Q15 of PRD #4673). Amends ADR 0137
(`gaps:sync` files gap issues) and retires the rule "`gaps:sync` never rewrites
a cluster's body or moves its parent". Terms in `CONTEXT.md`: **Gap Cluster**,
**Cluster Signature**, **Standalone Gap**, **Absorb**, **Re-home**,
**Cluster Cut ticket**.

## Context

`gaps:sync` files one issue per gap for every kind it computes — Grammar Gap,
Bot Gap, Hand Tail, mechanic and scenario quarantine classes. Clustering (the
gaps one family closes, cut as ONE ticket so the recompile, the lane, the
review and the landing are paid once) happened only by hand: `/new-set`
Phase 3 cut Grammar Clusters at a set rollout, the Op census was cut once
(issues #4524–#4537). Nothing kept it going. `gaps:sync` respected a cluster it
found (action `cluster`) but never created one, never adopted a new gap into
one, and never absorbed the singles it had filed before the cluster existed.
The old rule made that safe — a multi-claimed issue's body and parent were the
cutter's — and made it permanent: a cluster could never grow without a human.

Measured 2026-09-25, the P0 umbrellas still listed 21 Bot Gap singles and 18
Hand Tail singles; every one pays a PR's fixed cost alone, and a session that
picks one never sees the siblings that share its fix.

## Decision

1. **Adoption is mechanical, the cut is judgment, and the judgment is
   triggered mechanically.** What belongs together is decided by a person (or
   a `/cluster-gaps` session) once, as data; every later gap that matches is
   claimed without anyone remembering to.
2. **A Gap Cluster declares a Cluster Signature as data**: a row in a new
   `clusters` array beside `ops` and `claims` in the Grammar Gap allowlist,
   `{ issue, kind, match, standalone?, reason? }`. `match` is a list of segment
   globs over the `›`-separated gap key (grammar, bot, mechanic, scenario) or,
   for `hand-tail`, a `{ set, colour }` card match. A **Standalone Gap** is a
   row with `standalone: true` and a `reason` — a signature of one exact key —
   so a deliberate single is told from a forgotten one. `gaps:sync` stays the
   only writer of `claims`; `/cluster-gaps` authors `clusters` rows.
3. **Filing adopts.** A new gap is matched before it is filed: an open issue
   naming the card in `## Cards` (issue #4515) first, then signature matches,
   closed clusters and clusters `in-progress` or with an open PR excluded, the
   lowest issue number winning. A gap whose only matching clusters are in
   progress is filed as a single, so no key is ever unclaimed.
4. **Singles are absorbed.** An open single `gaps:sync` itself filed whose key
   now matches an open, not-in-progress cluster is closed into it ("absorbed
   into issue #N", its body copied into the comment, its row re-pointed).
   A hand-filed issue and an issue in progress are never absorbed.
5. **Closed clusters re-home.** A live key whose row points at a closed cluster
   moves to the oldest matching open cluster or to a new single, with a comment
   on the closed one. A closed cluster is never an adoption target.
6. **`gaps:sync` writes a cluster's managed block and may move its parent
   upward only.** The body carries a `## Adopted gaps` section between fixed
   HTML-comment markers, regenerated from the claim rows each run; outside the
   markers the body is never written, and new clusters carry no member counts
   in their title. A cluster's band is the highest band among its live keys;
   its parent moves up to that band's umbrella, with a comment, never down —
   the queue order stays stable and never oscillates. The closing criterion of
   a cluster becomes "every key, hand-listed or adopted, closed".
7. **A threshold triggers the cut.** When the unabsorbable, non-standalone
   open singles of one kind reach the configured threshold (in configuration,
   default 5), `gaps:sync` opens or updates ONE standing **Cluster Cut
   ticket** for that kind — `ready-for-agent`, `area:workflow`, band the
   highest among the singles it lists — worked by `/cluster-gaps`.
8. **No new PR-phase gate.** The only census is informational, on `health`
   (signature ambiguities, residual singles, signatures matching no live key);
   it never reds. Migration is out of scope: its slot-signature clustering
   already exists.
9. **No migration script.** The first `land` after release passes the
   threshold and files the Cluster Cut tickets; their cuts land signatures;
   the next `land` absorbs today's singles.

## Retired

"`gaps:sync` never rewrites a cluster's body or moves its parent" is retired
wherever stated: `docs/agents/issue-tracker.md`, `/new-set`, `/grammar-rule`,
and the tool's own comments. A multi-claimed issue with NO signature row is
still a hand-cut cluster and still left alone; a cluster WITH a signature row
gets its managed block and its upward parent move, nothing else.

## Consequences

- The queue stops growing by one issue per gap; a cluster's scope is a diff of
  `clusters` rows, and the issue a session reads is the whole contract.
- A session mid-cluster never has its scope grown under it (in-progress and
  open-PR clusters are skipped).
- Implementation is PRD #4673's slices; this ADR only records the decisions.

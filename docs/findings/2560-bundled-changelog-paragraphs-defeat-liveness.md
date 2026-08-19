---
title: Bundled changelog-style divergence paragraphs (ICE, INV) defeat automated per-item liveness — scoped out, not resolved
discoveredBy: 2560
status: draft
confidence: medium
---

**What is wrong.** `scripts/check-marker-liveness.ts` (issue #2560) resolves
only an explicit `tracked-by: #NNN` as a marker's own tracking ref — it
deliberately does NOT fall back to every bare `#NNN` in a marker's paragraph.
The reason: several files (`convex/cards/sets/ice/*.ts`,
`convex/cards/sets/inv/*.ts`) use ONE marker paragraph as a bundled changelog
covering several cards/items, where each bullet carries its OWN bare-number
disposition — some are live trackers, some are "ACTIVE (#NNN)" citations of
the (closed) issue that already shipped that bullet, some are cross-references
to a sibling card's ref. A first cut that resolved every bare `#NNN` measured
**68 "rotten" hits, the great majority false positives** from exactly this
shape (`convex/cards/sets/ice/white.ts:164`'s "DEFERRED (remain commented
stubs...)" paragraph alone cites four closed-but-shipped issue numbers as
completion records). Narrowing to `tracked-by:` only dropped this to 1 real
hit (fixed in this PR, `pls/white.ts:877`).

**Consequence.** A genuine per-item rot INSIDE one of these bundled
paragraphs — a bullet whose bare `(#NNN)` is a live tracker, not a completion
citation, and that issue later closes without the gap being fixed — is
invisible to `check-marker-liveness.ts` today. Guard B's presence check is
similarly coarse (paragraph-level, not bullet-level), so nothing catches this
case at any layer.

**Evidence.** `scripts/lib/divergence-markers.ts`'s `issueNumbersIn` doc
comment states the trade explicitly and names the measured false-positive
count; `scripts/check-marker-liveness.ts:32-70`'s module doc walks the same
reasoning. The ICE bundle at `convex/cards/sets/ice/white.ts:164-189` is the
clearest example: `ACTIVE (#729)`, `ACTIVE (#734)` are completion citations
(both issues are closed and describe the shipped capability), while
`Kjeldoran Elite Guard — … not modelled (#653 flagged, deferred)` two bullets
later cites the SAME #653 (also closed) as an apparently still-open blocker —
i.e., two different disposition MEANINGS for two different bullets, sharing
one paragraph, both using the identical bare-`#NNN` syntax.

**Why it may not deserve its own issue.** The ICE/INV bundled-changelog
convention is inherited, hand-maintained prose predating any automated
liveness check — a mechanical per-bullet parser would need to key off each
bullet's own leading `•` and its own trailing disposition clause, which is a
real parsing project (bullet boundaries are not currently structured data),
not a regex tweak. It is also scale-bounded: two files show this shape today
(`ice/white.ts`, `ice/blue.ts`, `ice/multicolor.ts`, `ice/red.ts`,
`ice/black.ts`, `ice/green.ts`, plus `inv/*.ts`'s residue-tranche TODOs — all
already excluded from `check-marker-liveness.ts`'s scope by the SEPARATE
`isStubContext` exclusion for the `inv`/residue-tranche ones, or captured by
the bare-number drop for the `ice` changelog ones). A future per-bullet parser
is a legitimate enhancement to `scripts/check-marker-liveness.ts`, not a
correctness bug in what shipped here — the checker is honestly narrower than
"every rotten ref", and says so in its own header.

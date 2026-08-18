---
title: cr:lint's keyword scan is blind to a keyword that appears only inside an identifier, and 8 "CR 701.8" discard citations survive because of it
discoveredBy: 2389
status: draft
confidence: high
---

**What is wrong.** `CR 701.8` is **Destroy**; **Discard** is `CR 701.9`
(`bun run cr 701.8` / `bun run cr 701.9`). Eight comment sites cite `CR 701.8`
while talking about discarding, and `bun run cr:lint` — which exists precisely to
catch a resolvable-but-wrong 701/702 citation by comparing the line's keyword
against the cited section's TITLE — passes all eight.

The reason is a matcher gap, not an exclusion: `scripts/cr-keyword-citations.ts:209`
keys Discard on `/\bdiscard\w*/i`, and every one of these lines spells the
keyword **only inside an identifier** — `CARD_DISCARDED` (`_` is a word
character, so there is no `\b` before `DISCARDED`) or camelCase
(`upkeepDiscardOrElse`, `DiscardOrElse`). The scan therefore classes the line as
"names no keyword", which its own header documents as invisible-by-design. The
same hole exists for every term in `TERMS`, not just Discard: `CREATURE_DIED`,
`applyDestroyReplacements`, `shuffleLibrary`, `exileFromGraveyard` are all
identifier-only spellings of a keyword the scan is meant to key on.

**Evidence.** The eight surviving sites (`grep -rn "CR 701\.8" | grep -i discard`):

- `convex/gre/state.ts:18822` — "it emits CARD_DISCARDED (CR 701.8 — Necropotence)."
- `convex/cards/types.ts:969`, `:1035` — both "emits CARD_DISCARDED (CR 701.8)"
- `convex/cards/abilities/upkeepDiscardOrElse.ts:21`, `:68`
- `convex/cards/abilities/__tests__/upkeepDiscardOrElse.test.ts:3`, `:180`
- `convex/cards/mechanicsRegistry.ts:2940` — "(CR 701.8a, PRD #795)" for
  `discardAtRandom`; this one is inside the file the scan deliberately excludes
  wholesale, so it is a second, already-known reason rather than this one.

The matcher: `scripts/cr-keyword-citations.ts:204-216` (`TERMS`), all `\b`-anchored.
The correct number is printable: `bun run cr 701.9` → "701.9. Discard".

**Why it may not deserve its own issue.** These are comments — nothing behaves
differently, and the eight sites are a one-line `sed` away from correct. The
question worth a human's judgement is the _matcher_, not the eight sites: adding
an identifier-aware surface form (split on `_` / camelCase before matching, or a
second pass over identifier tokens) would widen the scan across the whole repo at
once, and #2429's own history says that kind of widening reds the gate on a large
batch of pre-existing sites — 793 stood wrong when the title check was added, and
the `mechanicsRegistry.ts` exclusion exists for exactly that reason. So this may
be a line on the CR-citation-hygiene tracker rather than a ticket; what it should
NOT be is silence, because "cr:lint is green" currently reads as a stronger claim
than it is.

---
title: Stomp's hand-written oracleText splits one printed line in two, and now carries a stale compiler-gap marker
discoveredBy: 3238
status: draft
confidence: high
---

**What is wrong.** `convex/cards/sets/eld/red.ts` writes Bonecrusher Giant's
Adventure half as `"Damage can't be prevented this turn.\nStomp deals 2 damage
to any target."`. Scryfall prints that as ONE line —
`"Damage can't be prevented this turn. Stomp deals 2 damage to any target."` —
and ADR 0004 makes the modern Oracle text authoritative. Two consequences, both
invisible to every gate:

1. `compile.ts` routes each `\n`-separated line to the slot router
   independently (only bullet lists are regrouped, `grammar/lineGroups.ts`), so
   the hand-written text compiles to `"a card declares spell text twice"` where
   the real printed text compiles fine.
2. The `// compiler-gap: "Damage can't be prevented this turn." (#2693)` marker
   above the anchor is now STALE: issue #3238 taught the grammar that exact
   sentence.

**Evidence.** Compiling Stomp's hand-written `\n`-joined text fails with
`a card declares spell text twice`; the same text joined by a single space
compiles. The vendored corpus row for `Bonecrusher Giant // Stomp` has exactly
one remaining unparsed fragment after issue #3238 — the `BECAME_TARGET` trigger
line, not the anti-prevention sentence.

**Why no guard catches it.** `compilerRoundTrip.test.ts`'s "no compiler-gap
marker outlives the gap it names" check keys on the CARD's verdict, and
Bonecrusher Giant still carries a second, genuine marker for the trigger line —
so the card never flips to `ok` and the first marker's staleness is masked
permanently. Nothing compares a hand-written `oracleText` to the corpus either.

**Why it may not deserve its own issue.** The fix is two lines on one card
(join the Adventure half's oracleText, drop one marker). It is defensible
without Impractical Joke — the marker-masking mechanism is general and would
hide any stale marker on a multi-marker card — but if the class turns out to be
this one card, it is a line on the compiler tracker rather than a ticket.

---
title: An ability-loss effect strips a layer-6 grant but leaves the same source's layer-7b pt-set applying
discoveredBy: 2386
status: draft
confidence: medium
---

**What is wrong.** CR 613.1f layer 6 honours `abilitiesSuppressedBy` (Humility,
Ovinize, Turn to Frog — "loses all abilities"), but nothing in the layer-7 path
consults it. A permanent whose abilities have been stripped therefore keeps
every `pt-set` / `pt-buff` / `pt-cda` those same abilities generate. CR 613.4
does not exempt layer 7 from CR 613.1f: an effect that no longer exists cannot
apply in ANY later layer.

**Evidence.** `convex/gre/layer6.ts` is the only reader of
`abilitiesSuppressedBy`; `convex/gre/layers.ts`'s layer-7 collection does not
mention it. Reachable in a P/T-SETTING shape for the first time with
Hexdrinker (`convex/cards/sets/mh1/green.ts`, issue #2386): under Humility its
LEVEL bands would lose "protection from instants" / "protection from
everything" (layer 6, correctly) while the band's 4/4 or 6/6 base P/T (layer 7b)
kept applying — so the creature would read 6/6 instead of Humility's 1/1.

**Why it may not deserve its own issue.** The interaction needs a
"loses all abilities" effect on the board at the same time as a leveler or
another self-referential P/T source, which no shipped scenario reaches today —
and the fix is one shared read, not a per-card patch, so it may be better as a
line on the Continuous Effects Registry work (ADR 0082 / PRD #2064) than as its
own ticket.

**Adjacent, smaller.** Two pre-existing CR citations are wrong and were left
untouched by #2386's diff: `src/lib/card-utils.ts:1764` cites `CR 602.3b` for
"Activate only as a sorcery" (the rule is `CR 602.5d`), and
`convex/cards/mechanicsRegistry.ts:3394` cites `CR 115.4` for player-scoped
protection from everything (the rule is `CR 702.16j`, which names both scopes).
`cr:lint` cannot see either — both ids resolve, they just say something else.

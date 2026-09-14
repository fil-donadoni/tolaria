---
title: The "attached-host object selector" marker class is refuted at HEAD — ~10 aura cards still carry it
discoveredBy: 1701
status: draft
confidence: high
---

**What is wrong.** Issue #1701's sweep was scoped to the markers naming the
aura-host-CONTROLLER _player_ ref, and those four are now migrated (Cursed Land,
Warp Artifact, Wanderlust, Farmstead, plus Feedback and Power Leak, which the
issue named outright). Its SIBLING class — markers whose stated blocker is an
"attached-host OBJECT selector" — has the same refuted premise and nobody has
touched it: `$host` has been an implicit object-snapshot binding at every
ability site since issue #1341, so `{ ref: "$host" }` is a legal
`EffectObjectSelector` today, exactly as `{ ref: "$host.controller" }` turned
out to be a legal `EffectPlayerRef`.

**Evidence.** `convex/gre/effects/interpreter.ts` (`HOST_BINDING`,
`runEffectScript`'s fresh-entry bind) seeds `$host` from the live
`ctx.getAttachedToId()` link; `convex/gre/effects/validate.ts`'s
`ABILITY_BINDINGS` pre-declares it at every ability site. Markers still claiming
otherwise, one line each:

- `convex/cards/sets/fem/black.ts:688`
- `convex/cards/sets/ice/white.ts:1027`
- `convex/cards/sets/ice/red.ts:127`
- `convex/cards/sets/pls/red.ts:229`
- `convex/cards/sets/lea/green.ts:970`
- `convex/cards/sets/leg/red.ts:580`
- `convex/cards/sets/leg/blue.ts:399`, `:932` (these two ALSO name a second,
  independent blocker — an event-amount value construct — so they are
  corrections, not migrations)
- `convex/cards/sets/leg/black.ts:910`
- `convex/cards/sets/ice/black.ts:2980`, `convex/cards/sets/ice/white.ts:335`,
  `convex/cards/sets/ice/red.ts:2253`, `convex/cards/sets/lea/white.ts:283`,
  `:664`, `convex/cards/sets/lea/red.ts:385` (the `issue #840` pump variants,
  all one sentence apart)

Also in the same family and NOT re-verified here: Essence Flare
(`convex/cards/sets/ice/blue.ts`), whose marker claims a second refuted thing —
that `phaseTrigger`'s `effects[]` site is restricted to `scope: "your"`. It is
not: this PR ships four `scope: "host-controller"` scripts.

**Why it may not deserve its own issue.** It is one mechanical migration
repeated ~15 times with no engine work at all, so it may be better as a line on
the existing resolve()→effects migration tracker than as its own ticket. The
argument for a ticket is the opposite one: every marker here is a claim about
the engine that is FALSE, and a false premise sitting in the catalogue is what
made #1701 re-derive the same refutation from scratch — the markers are read by
future sessions as a map of what the DSL cannot do.

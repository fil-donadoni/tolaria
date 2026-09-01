---
title: A Rebound SORCERY would be suppressed by the free-exile-cast timing gate, in the engine and therefore for the Bot
discoveredBy: 2983
status: draft
confidence: medium
---

**What is wrong.** Rebound's window opens at the caster's upkeep (CR 702.88a),
and the keyword explicitly covers sorceries. The engine's free-exile-cast
branch applies `castTimingBaseLegal` plus `passesCastPhaseRestriction`, which
for a sorcery means sorcery timing — and UPKEEP is not a main phase with an
empty stack. So a rebound sorcery's free recast would be judged illegal at the
one moment it is supposed to be legal.

This is an ENGINE gate, not a Bot one: `announceCast` reaches the same
predicate through `assertLegalAction`, so a human clicking Cast in that window
would be refused too. Contrast the Madness branch a few lines above, which
deliberately applies no timing gate at all and says so — the madness window is
instant-speed for exactly the analogous reason.

Nothing is reachable today: Ephemerate (`convex/cards/sets/mh1/white.ts`) is
the only shipped card with rebound and it is an Instant. Distortion Strike is
the real-world card that would hit it.

**Evidence.** `convex/gre/rules.ts:1039-1052` (`isFreeExileCast`, applying
`castTimingBaseLegal` + `passesCastPhaseRestriction`) versus
`convex/gre/rules.ts:1012-1025` (the Madness branch, no timing gate, with the
comment explaining why). `convex/gre/rebound.ts:82-115`
(`openReboundCastWindow`, which raises the window during UPKEEP).
`bun run cr 702.88a`.

**Why it may not deserve its own issue.** Zero shipped cards reach it, so it
fixes nothing observable today, and the right shape of the fix is a genuine CR
question rather than a mechanical edit: the free-exile-cast branch is SHARED
with Dauthi Voidwalker / Malcolm-style grants, where the ordinary timing gate
is correct and must stay. So the fix is not "drop the gate" but "let the
permission that opened the window declare whether it waives timing" — a small
seam, but a seam, and one better designed alongside the first rebound sorcery
than speculatively.

What raises it above a pure curiosity is the interaction with #2983: the Bot's
new cast-window generator asks `getLegalActions` whether the cast is legal and
fails CLOSED on "no". So the day a rebound sorcery ships, the Bot will silently
decline a legal free recast, and the fail-closed design — correct in every other
respect — is precisely what will hide the engine bug from anyone watching the
Bot rather than the rules.

---
title: createTokenCopyOf applies the copy AFTER the token has entered, so a token copy never owes the copied card's as-enters choices (CR 707.5/707.6)
discoveredBy: 2451
status: draft
confidence: medium
---

**What is wrong.** ADR 0100 D6 scopes token copies IN ("Census row C is already
a chokepoint caller, so covering them costs nothing"), and CR 707.5 says an
object entering "as a copy" _becomes_ a copy as it enters, with the copied
text's own "as [this] enters" abilities taking effect. `createTokenCopyOf` does
the opposite order: it mints a placeholder token, lets it ENTER, and only then
runs `applyCopy` on it. So the CR 614 chokepoint sees the placeholder, and a
token copy of a permanent whose definition declares `entersWith.asEnters` gets
no prompt — the copied card's as-enters choice is silently skipped.

**Evidence.** `convex/gre/state.ts:14374` (`SpellContext.createTokenCopyOf`)
builds a bare `{ name: "Copy", types: ["Creature"], power: 0, toughness: 0 }`
spec with **no `entersWith`**, hands it to `createTokenPermanents`, and calls
`applyCopy(token, source, opts)` on the far side of the entry. The chokepoint
call at `convex/gre/state.ts:17857` passes `{ declaredEntersWith: spec.entersWith }`
and a card object carrying no `card` blob, so both the declared and the
presented-definition sources of `asEnters` are `undefined` — the verdict is
always `"enter"`.

Two consequences, both latent today:

1. **No as-enters choice on a token copy** (CR 707.5/707.6). Reachable only when
   the copy SOURCE still presents an as-enters definition — after #2451 that
   means a Clone / Phantasmal Image / Phyrexian Metamorph / Vesuvan
   Doppelganger sitting on the battlefield having DECLINED its copy, i.e. a 0/0
   the very next sweep bins (CR 704.5f). Copy Artifact declines into a surviving
   blank enchantment, but no token-copy Op in the catalogue can target a
   non-creature. So the window is real but essentially unhittable in play.
2. **No replay marker on the `createTokenCopy` Op.** ADR 0100 D5 requires one
   per census-row-C Op; `createToken` got it in slice 1
   (`convex/gre/effects/interpreter.ts:3866-3943`, `doneKey` +
   `recallChoice`/`noteChoice`), but `createTokenCopy`
   (`convex/gre/effects/interpreter.ts:3968-4066`) has none and instead loops
   `count` times calling `ctx.createTokenCopyOf` one entry at a time. That is
   safe **only because** of the bug above: no token copy can park, so the Op is
   never re-entered mid-batch. Fix (1) without fixing (2) and a `count: N` batch
   duplicates on resume — the exact failure D5 names.

**Why it may not deserve its own issue.** Reordering `createTokenCopyOf` is not
a small change: the placeholder-then-copy shape exists so the CR 603.6a entry
event describes the copy rather than a 0/0 named "Copy" (`deferEntryEvent`,
issue #2300), and moving the copy before the entry means synthesising a
`TokenSpec` from the source's copiable values instead. Weighed against a window
that needs a declined clone to survive an SBA sweep, this may be a line on ADR
0100 / #2043 rather than a ticket — but the two halves are coupled, so whoever
takes it must take both.

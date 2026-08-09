---
title: createTokenCopyOf's lastKnownFromGraveyardOrExile is a live zone lookup, not last-known-information — Vaultborn Tyrant's dies trigger silently creates no token if the dead creature leaves the graveyard first
discoveredBy: 2364
status: draft
confidence: high
---

**What is wrong.** `SpellContext.createTokenCopyOf`'s `opts.
lastKnownFromGraveyardOrExile` (`convex/gre/state.ts`, built for Eternalize,
issue #2339) resolves its copy source with
`findCardInGraveyardOrExile(state, sourceCreatureId)` — a lookup in the
CURRENT graveyard/exile zone at the moment the effect resolves. It is not a
last-known-information (LKI) snapshot of the creature's characteristics as
they last existed on the battlefield (CR 608.2b's actual requirement for a
dies trigger: "the object's last known information is used"). For Eternalize
the distinction is invisible: the ability's own activation COST ("Exile this
card from your graveyard: …") removes the card from the graveyard as part of
paying the cost, so by the time the ability resolves the source is
guaranteed to be sitting in exile, exactly where the zone lookup expects it.

Vaultborn Tyrant (`convex/cards/sets/big/green.ts`) reuses the same option
for a TRIGGERED ability with no such guarantee. Its dies trigger goes on the
stack while the dead creature sits in the graveyard; any player with
priority can legally move that card out of the graveyard before the trigger
resolves (discard-graveyard-hate, mill-into-library effects, graveyard
shuffles). When that happens, `findCardInGraveyardOrExile` finds nothing,
`source` is `undefined`, and `createTokenCopyOf` returns `undefined`
SILENTLY — no error, no partial token, nothing on the battlefield. CR 608.2b
/ 707.2 say the copy token should still be created, built from the
creature's copiable values as it last existed on the battlefield.

**Evidence.**

- `convex/gre/state.ts:13258-13272` — `createTokenCopyOf`'s source
  resolution: `findOnBattlefield(...)?.card ?? (opts?.
lastKnownFromGraveyardOrExile ? findCardInGraveyardOrExile(state, ...) :
undefined)`. Both branches are live-zone searches; neither reads a
  last-known definition id captured at the moment the creature died.
- `convex/cards/sets/big/green.ts` (`vaultbornTyrantDiesTrigger`) — the sole
  shipped caller of `lastKnownFromGraveyardOrExile: true` outside Eternalize.
- Reachable in the current catalogue: Krosan Reclamation
  (`convex/cards/sets/jud/green.ts`) is an instant that shuffles graveyard
  cards into the library — a legal response to Vaultborn Tyrant's dies
  trigger while it sits on the stack. Exile-based graveyard hate is fine
  (`findCardInGraveyardOrExile` searches exile too); a library shuffle is
  the failure case.
- Proven empirically during PR #2426's round-2 review: with the dies
  trigger on the stack, moving the dead Vaultborn Tyrant out of the
  graveyard yields `tokens created: 0` on resolution.
- This is also a narrow regression relative to PR #2426's own round 1: the
  hand-authored `createToken` spec that round used created the token
  unconditionally, with no graveyard dependency at all.

**Why it may not deserve its own issue yet.** The real fix is an engine
capability — a copy source resolvable from a last-known definition id
(captured at the trigger's queue time, the same shape `TriggerStateView`
snapshots already use for other LKI-dependent conditions), not a live zone
search — which is a `gre/state.ts` primitive change, not a one-card patch.
Vaultborn Tyrant is currently the only caller that could observe the gap,
and the failure mode is a missed token rather than a crash or a rules
violation that compounds (SBAs / game state stay consistent either way). If
a second card reuses `lastKnownFromGraveyardOrExile` on a triggered (rather
than cost-gated) ability, or if this exact interaction gets flagged in play,
it stops being a one-off and is worth its own ticket for the LKI-based
lookup primitive.

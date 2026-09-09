---
title: The human auto-tap solver taps the parked activation's own {T} source, silently losing the ability and the mana
discoveredBy: 3081
status: draft
confidence: high
---

**What is wrong.** Issue #3081 fixed the Bot's planner
(`planManaPayment`'s `barredSourceId`) so an activated ability whose cost
declares `{T}` is never funded by its own source. The HUMAN auto-tap solver has
the same bug and was explicitly out of scope there — on the same 14 shipped
cards. Clicking auto-tap on such an ability taps four lands, spends four mana
and loses the ability, with **no error**.

The issue's own out-of-scope note assumed the solver "already sees the source as
tapped because the activation mutation taps it before payment begins". That
premise is wrong: the announce is DEFERRED precisely so the source stays
untapped (CR 302.1 re-check at commit), so the solver sees an untapped,
mana-producing permanent and picks it.

**Evidence.** `convex/game.ts:10126` builds the solver's source list with

```ts
const sources = buildAutoTapSources(
    player.battlefield,
    manaGateBattlefields(state)
);
```

— no exclusion for `state.pendingActivation.cardInstanceId`, and
`buildAutoTapSources`' own tapped-source filter cannot catch it because
`convex/game.ts:14643` deliberately leaves the source untapped while the
activation is parked. The plan then taps it; the mana leg is paid in full; and
`tryAutoCommitPendingActivation` (`convex/game.ts:3022`) reaches
`pa.tapSource` with `card.isTapped` already true, reads it as a benign
double-commit race and **discards the whole pending activation, returning
`null`** — lands tapped, mana spent, nothing on the stack, nothing thrown.

Reproduced against HEAD on Abandoned Air Temple + 3 Plains with the activation
parked: `autoTapForPayment` returned a plan naming `temple, plains-0, plains-1,
plains-2`.

Reachable on every permanent pairing a `{T}` mana ability with a
`<mana>, {T}` activated ability: the five Mana Batteries, Shelldock Isle, Mind
Stone, Relic of Sauron, Horizon Canopy, Sunbaked Canyon, Waterlogged Grove,
Barbarian Ring, Terminal Moraine, Abandoned Air Temple.

Two candidate fixes, and the second is the one that closes the CLASS: thread the
parked activation's `cardInstanceId` into `buildAutoTapSources` when
`pa.tapSource` is set (the human twin of `barredSourceId`); and make the commit's
`card.isTapped` branch distinguish a genuine double-commit race from a source
the payment itself tapped, rather than silently dropping both.

**Why it may deserve its own issue.** It is defensible without the card that
surfaced it — a human-facing silent loss of mana and a card's ability on 14
shipped permanents, with no error surface. The Bot half is fixed; leaving the
human half is a live divergence between two solvers CLAUDE.md documents as
mirroring each other.

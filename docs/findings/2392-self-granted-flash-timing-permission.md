---
title: No SELF-granted "cast this spell as though it had flash" — only the player-scoped Teferi grant exists, and #1975 does not scope it
discoveredBy: 2392
status: draft
confidence: high
---

**What is wrong.** The engine models exactly one cast-timing permission: a
**player-scoped** grant ("until your next turn, _you_ may cast sorcery spells as
though they had flash", Teferi, Time Raveler +1). It has no way for a card in
hand to grant the permission **to itself** — the "You may cast this spell as
though it had flash" clause. That clause is a printed static ability that
functions from the hand (CR 113.6c / 601.3e), keyed on the spell being cast, not
a grant handed to a player for a class of spells.

Necromancy (#2392) is blocked on this. So is every other card carrying the same
sentence. Crucially, this gap is **not in #1975's acceptance criteria** — #1975
scopes the per-instance Aura restriction and the cleanup-step delayed trigger,
and treats the flash clause as needing only the cast-timing _memory_ flag. So
even if #1975 lands in full, #2392 remains blocked on this fourth capability.

**Evidence.**

- The only permission seam is player-scoped — `convex/gre/state.ts:3723` declares
  it as `castTimingFlashGrants?: { playerId; cardTypes? }[]`. Every field is
  about a **player** and a **class of card types**; there is no per-card or
  per-instance slot.
- Gate: `hasCastTimingFlashGrant(casterId, spell, state)` —
  `convex/cards/castRestrictions.ts:152`, which returns early on
  `g.playerId !== casterId` (`castRestrictions.ts:161`). A card cannot enter
  this path without first writing a player-scoped grant.
- Consumed in `castTimingBaseLegal` — `convex/gre/rules.ts:388-403`, the shared
  helper the GRE `getLegalActions`, the cast mutation and the client all read.
- Written by exactly one Op, `grantCastTiming`, documented as
  "Grant a **per-player** casting-TIMING permission" —
  `convex/cards/mechanicsRegistry.ts:2646`; writer at `convex/gre/state.ts:13824-13826`.
- Two further cards are commented out on this same clause:
  Breaking Wave `convex/cards/sets/inv/blue.ts:784-801` (tracked-by #2146 /
  #1332) and Saproling Symbiosis `convex/cards/sets/inv/green.ts:1078`. Both
  carry the conditional variant ("…as though it had flash **if** you pay {2}
  more"), which additionally couples the permission to an additional cost.

**Why the obvious substitute is wrong.** Giving Necromancy the plain `flash`
static ability (`mechanicsRegistry.ts:748`) is close but not equivalent: it
changes the card's printed characteristics (CR 205.2 / 604 — an ability the card
does not have), and Necromancy's own second sentence keys on _the timing that
was actually used_ ("if you cast it any time a sorcery couldn't have been cast"),
not on possessing flash. A card with real flash cast in a main phase with an
empty stack must **not** arm the sacrifice; conflating the two makes that
condition unreadable.

**Why it may not deserve its own issue.** It is arguably a line on #1975 rather
than a ticket — #1975 is already the named blocker for Necromancy and could
simply widen its acceptance criteria by one bullet. The counter-argument, and
the reason this is written up separately: it is defensible **without**
Necromancy (two INV cards are blocked on it independently, with their own
tracking refs #2146/#1332), and the conditional form those two need — permission
gated on paying an additional cost — is a strictly larger design than the flat
self-permission Necromancy wants. Sizing it as "one more bullet on #1975" risks
shipping the flat form and leaving the conditional form to be rediscovered.

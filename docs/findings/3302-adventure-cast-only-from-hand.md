---
title: The Adventure cast option is reachable only from the hand, not from a graveyard or exile permission
discoveredBy: 3302
status: draft
confidence: high
---

**What is wrong.** CR 715.3 says "as a player **plays** an adventurer card, the
player chooses whether they play the card normally or as an Adventure" — it
names no zone. The Adventure cast option shipped in issue #3302 is offered only
from the branch of `getLegalActions` that serves the hand (and the CR 715.3d
exile permission, where the Adventure is deliberately withheld). Every other
cast branch returns before the adventure leg is evaluated, so a player who may
cast an adventurer card from their graveyard or from exile under some other
effect can cast only its front face.

**Evidence.** `convex/gre/rules.ts` — the flashback, escape, graveyard-permission,
exile and library-top branches each compute `castTimingBaseLegal(state, …, <zone>)`
with no `alternativeCostId` and `return actions` before reaching the
`adventureCastLegal` term added for the hand branch. Reproduction: Yawgmoth's
Will on the battlefield, Brazen Borrower in your graveyard, an opposing nonland
permanent, {1}{U} available, opponent's turn. CR 715.3a makes Petty Theft legal
(an Instant, evaluated on its own characteristics); `getLegalActions` reports no
`"cast"` because the creature half is sorcery-speed, and `assertLegalAction`
then refuses the mutation.

Fail-closed, not fail-open: the cast is refused, never mispriced or misresolved.

**Why it may not deserve its own issue.** The fix is not the one-line OR the
hand branch took. Each graveyard branch prices its cast against a DIFFERENT
cost — the flashback cost, the escape cost, the permission's own waiver — while
CR 715.3a says the Adventure is cast for the inset half's own cost, so "which
cost does an Adventure cast from a graveyard pay?" is a real rules question per
grant, not a mechanical repetition. No shipped card combines an adventurer card
with flashback or escape, and the only live path is a broad graveyard permission
(Yawgmoth's Will, Underworld Breach) over the two Vintage Cube adventurers — so
this may be one line on PRD #1525's Adventure work rather than a ticket, and it
becomes worth its own slice only when a second grant shape reaches an adventurer
card.

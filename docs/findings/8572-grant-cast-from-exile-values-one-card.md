---
title: grantCastFromExile's Bot valuer prices a grant over several exiled cards as one card
discoveredBy: 8572
status: draft
confidence: medium
---

**What is wrong.** `grantCastPermission` (`convex/gre/ai/opValuers.ts`, the
valuer behind `grantCastFromExile`) ignores the Op's `card` field and returns
one flat card-advantage term per Op. Since issue #8572 a picks ref grants every
card the binding holds, so "Exile the top two cards of your library. Until the
end of your next turn, you may play those cards." (Reckless Impulse, Wrenn's
Resolve, Embrace the Unknown) and the X-sized Commune with Lava are valued as
if they offered one card.

**Evidence.** The four cards graduated `ready` with `botReach: played`, so the
Bot casts them; it simply under-rates them against a one-card impulse draw.
The same flat price already applied to `{ exiledWithSource: true }` grants
over several linked cards (The Legend of Roku's chapter I).

**Why it may not deserve its own issue.** The Bot plays the cards; the cost is
a valuation gap, not a freeze. It may belong as a line on the Bot evaluation
tracker rather than a ticket of its own.

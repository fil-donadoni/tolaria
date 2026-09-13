---
title: applyMoveInSearch runs state-based actions while a resolution is still suspended, orphaning Kudzu before its re-attach pick
discoveredBy: 3545
status: draft
confidence: low
---

**What is wrong.** Kudzu's trigger destroys its host, then asks a `may-pay`
("attach this Aura to a land of their choice?"), then a `choose-permanents` for
the new land. When the search answers that `may-pay` through
`applyMoveInSearch` (`convex/gre/search.ts`, the may-pay case), the applier
calls `checkStateBasedActions` while the resolution is still suspended on the
next choice. The Aura has no host at that moment, so CR 704.5m puts it into the
graveyard before the re-attach pick is made. CR 704.3 checks state-based
actions only when a player would receive priority, never mid-resolution.

**Evidence.** Measured in the Kudzu settle test in
`convex/gre/ai/__tests__/choose-permanents-choice-node.bot.test.ts`. Right after
accepting the may-pay, the battlefield holds only the Taiga, and Kudzu and the
Forest are both in the graveyard, while the `choose-permanents` choice is still
pending.

**Why it may not deserve its own issue.** Unverified: whether the
authoritative submit path (the `submitMayPay` mutation) does the same. If only
the search applier does, the cost is a mispriced probe on a rare card shape
(an Aura re-attached mid-resolution after its host left). The fix belongs to the
SBA timing of every choice answer in the applier, not to this card.

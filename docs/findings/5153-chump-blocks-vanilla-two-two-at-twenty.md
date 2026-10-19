---
title: The Bot chump-blocks a vanilla 2/2 with a 1/1 at 20 life
discoveredBy: 5153
status: draft
confidence: medium
---

**What is wrong.** On a bare board — the opponent attacks with a lone
Grizzly Bears, the Bot (20 life, no poison, no mana, no hand) holds one
Savannah Lions — the Bot blocks. The 1/1 dies, the 2/2 survives, and all
the block saves is 2 of 20 life. Declining is the better play.

**Evidence.** Measured with `runBladeScenario` at 400 iterations, seeds
`[0xb1ade, 1, 2, 3, 4]`, on the board of the blade entry "poison-lethal:
chump-blocks the infect attacker whose damage is the tenth poison counter
(issue #5153)" with its `continuousEffects` and `poison` taken out: the Bot
declares `Savannah Lions → Grizzly Bears` on 5/5 seeds. It does the same at
`life: { opp: 2 }`, where the block is correct, so this board does not
separate the two cases. The existing non-lethal control ("life-dependent: does
NOT chump-block when the incoming damage isn't lethal", 4 × Craw Wurm into 40
life) declines, so the bias may depend on how big the attack is compared with
the life total.

**Why it may not deserve its own issue.** The blade registry may already pin a
small-attack chump decline that this board misses. If it does not, the gap
belongs under the block-quality tie-break (`blockDeltaOf`, `search.ts`) or the
Bot Gap tracker, not in a new ticket.

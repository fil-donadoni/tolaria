---
title: A shroud/protection grant whose payoff is the removal FIZZLING is still invisible at the search horizon
discoveredBy: 1920
status: draft
confidence: medium
---

**What is wrong.** Issue #1920 made an activated ability's payoff visible by
putting it on the search's stack and resolving it one ply deep
(`policyValue`, `convex/gre/search.ts`). That works when the ability's own
resolution moves material — a Prodigal Sorcerer ping kills the creature, and
the leaf shows it dead. It does **not** work when the payoff is that the
opponent's spell will later fail: the grant resolves, but the removal is still
on the stack, and the position only improves when it fizzles on an illegal
target (CR 608.2b) a further resolution away.

So the bot still declines the textbook use of a sacrifice-cost protection
ability. With a Bolt on the stack aimed at its Grizzly Bears and an untapped
Sylvan Safekeeper, the bot passes on all five blade seeds — before AND after
#1920 — because the sacrificed land is immediate and certain while the save is
two resolutions out.

**Evidence.** Measured at `iterations: 200`, seeds `[0xb1ade, 1, 2, 3, 4]`, via
`runBladeScenario` on the position described in the `note` of
`activation timing: does not crack Sylvan Safekeeper with no threat`
(`convex/gre/ai/blade/registry.ts`): `pass` on 5/5 both before and after.
At the policy level (`policyValue`, one resolution deep) the same position
scores `pass` 408.5 against 391.5 for the activation — a 17-point deficit that
is exactly the sacrificed land's `W_PERMANENT + W_MANA`, with the shroud grant
crediting nothing that offsets it.

The contrast that isolates the cause: Iron-Shield Elf in the same shape — same
"protect a creature from removal on the stack" job, same reactive window — flips
from RED on 5/5 seeds to green on 5/5 with #1920. Its grant is
`indestructible`, a KEYWORD that `evaluateCreature` prices directly off
`staticAbilities`, so the payoff lands inside the one-resolution horizon. Shroud
also lands as a keyword, but the material it protects only changes hands when
the Bolt fizzles, which does not.

**Why it may not deserve its own issue.** This is lookahead DEPTH, not a
missing capability, and #1920 never claimed to fix it — the tree does reach the
fizzle at a larger budget, so it may be a tuning observation rather than a
defect. It is also close to the known "combat quality is washed out at the
horizon" class already tracked around `selectRootMove` tie-breaks, and might
belong there as a line rather than as a ticket. The counter-argument for
ticketing it: "sacrifice something to make removal fizzle" is a whole card
archetype (Safekeeper, Diamond Valley effects, sacrifice-for-regeneration), and
every one of them is currently mispriced in the same direction.

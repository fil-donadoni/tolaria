---
title: A shroud/protection grant whose payoff is the removal FIZZLING is still invisible at the search horizon
discoveredBy: 1920
status: declined
confidence: medium
---

**DECLINED (issue #2938).** The premise was wrong. The bot's refusal was not a
lookahead-depth gap: the payoff this finding said was "two resolutions away"
was not reachable at ANY depth, because the engine did not counter a targeting
spell whose target had gained shroud in response (CR 608.2b). That rules gap is
issue #2942, shipped in PR #2957. With it in, the bot chooses the activation on
5/5 blade seeds in exactly the position described below — pinned as
`activation payoff: cracks Sylvan Safekeeper against removal on the stack`
(`convex/gre/ai/blade/registry.ts`), the discriminating mirror of the no-threat
control. Nothing about the search horizon changed. Kept for the record because
the reasoning below is a live trap: a payoff the bot never observes reads
exactly like a payoff it cannot see far enough to reach, and the two want
opposite fixes.

---

**What was claimed.** Issue #1920 made an activated ability's payoff visible by
putting it on the search's stack and resolving it one ply deep
(`policyValue`, `convex/gre/search.ts`). That works when the ability's own
resolution moves material — a Prodigal Sorcerer ping kills the creature, and
the leaf shows it dead. It was read as NOT working when the payoff is that the
opponent's spell will later fail: the grant resolves, but the removal is still
on the stack, and the position only improves when it fizzles on an illegal
target (CR 608.2b) a further resolution away.

So the bot declined the textbook use of a sacrifice-cost protection ability.
With a Bolt on the stack aimed at its Grizzly Bears and an untapped Sylvan
Safekeeper, the bot passed on all five blade seeds — before AND after #1920.

**Evidence as measured then.** `iterations: 200`, seeds `[0xb1ade, 1, 2, 3, 4]`,
via `runBladeScenario`: `pass` on 5/5 both before and after. At the policy level
(`policyValue`, one resolution deep) the same position scored `pass` 408.5
against 391.5 for the activation — a 17-point deficit that is exactly the
sacrificed land's `W_PERMANENT + W_MANA`, with the shroud grant crediting
nothing that offsets it.

**Why the contrast misled.** Iron-Shield Elf in the same shape — same "protect a
creature from removal on the stack" job, same reactive window — flipped from RED
to green on 5/5 with #1920. Its grant is `indestructible`, which `evaluateCreature`
prices directly off `staticAbilities`, so the payoff lands inside the
one-resolution horizon. Shroud also lands as a keyword; the difference read as
horizon depth. It was not. Indestructible's payoff was real in the engine and
shroud's was not, at any depth — the deficit above is what a correctly-priced
land costs against a benefit that did not exist.

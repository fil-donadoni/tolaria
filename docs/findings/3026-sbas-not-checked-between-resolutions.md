---
title: State-based actions are not checked between two consecutive stack resolutions
discoveredBy: 3026
status: draft
confidence: high
---

**What is wrong.** CR 704.3 checks state-based actions "whenever a player would
get priority", which includes the window between two consecutive resolutions.
`resolveTopOfStack` (`convex/gre/state.ts`) does not run them itself, and
neither does `drainAutoPasses` (`convex/gre/phases.ts`) between the resolutions
it chains — so a run of resolutions that both players auto-pass through sees no
SBA until the run ends.

**The shape it costs.** A storm-copied pinger (Grapeshot with a storm count of 2) puts three 1-damage effects on the stack against one 2-toughness creature.
Under CR 704.3 the creature is destroyed after the second point and the third
copy has an illegal target, so it fizzles (CR 608.2b). Today all three resolve
against a creature that is still on the battlefield with damage marked, and it
is destroyed once at the end of the run. The board usually converges, so the
divergence is visible only where the difference between "fizzled" and
"resolved" is itself observable — a "whenever this spell resolves" watcher, a
damage-triggered ability, or a copy whose other clauses would still apply.

**Why it is not fixed under issue #3026.** All three cast paths share the gap —
the mutation path, the ISMCTS sandbox (`drainAutoPasses`) and the greedy sandbox
(`applyMoveForSearch`'s post-cast drain). Adding the check to one of them alone
gives that path SBA timing the other two do not have, which is exactly the
greedy-vs-ISMCTS divergence issue #3026 was opened to close. It is one fix at
the shared resolution seam or nothing.

**Partly closed by issue #5784.** Lethal damage no longer destroys inline (it
is the CR 704.5g SBA's), which made this gap visible for every damage death,
so `drainAutoPasses` now checks SBAs before each auto-pass it takes — that
covers the mutation path and the ISMCTS `passInSearch`, which both resolve
through it. Still open: the greedy sandbox's cast-segment and attack-trigger
drains (`applyMoveForSearch`, `gre/applyMove.ts`) chain resolutions with no
check between them; a Bot-glob change, owed through `/bot-change` with its
blade entry.

Also open (review of issue #5784): a mana ability resolves with no SBA after it
(`activation.ts`, `game.ts` granted mana ability — CR 605.3b keeps it off the
stack), so one that damages a creature leaves it alive until the next priority
check of the action it was activated inside. Rare; pre-existing policy.

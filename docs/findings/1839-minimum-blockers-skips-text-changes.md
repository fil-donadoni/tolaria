---
title: getMinimumBlockers reads raw staticAbilities while its sibling applies CR 612 text changes
discoveredBy: 1839
status: draft
confidence: low
---

**What is wrong.** The two block-legality readers in `gre/combatRegistry.ts`
disagree about text-changing effects (CR 612). `evaluateBlockerKeywords`
deliberately reads `applySubstitution(attacker).staticAbilities` — "a text
change can rewrite the attacker's landwalk keyword (forestwalk → islandwalk), so
match against the rewritten abilities". `describeMinimumBlockers` (added by
#1839, and the pre-existing `getMinimumBlockers` it replaced) reads
`attacker.staticAbilities` directly, so a substitution that rewrote `menace` or
`minimum-blockers:N` would be invisible to the count threshold while being
honoured by the per-blocker veto on the same attacker in the same declaration.

**Evidence.** `convex/gre/combatRegistry.ts:239` (`applySubstitution(attacker)`)
versus `convex/gre/combatRegistry.ts` `describeMinimumBlockers`, which iterates
`attacker.staticAbilities` unfiltered. Both are consumed from the same
`confirmBlockers` path — `convex/gre/combat.ts:229` `validateMinimumBlockers` and
`convex/game.ts:11308`.

**Why it may not deserve its own issue.** No shipped card text-changes a
non-landwalk keyword: `applySubstitution` exists for the Sleight of Mind /
Magical Hack landwalk family, and neither `menace` nor the new
`minimum-blockers:N` marker is a word those cards can name. The divergence is
therefore currently unreachable, and "make both readers substitute" is a
one-line change best folded into whatever ticket first ships a general
keyword-rewriting effect rather than carried as a standing bug.

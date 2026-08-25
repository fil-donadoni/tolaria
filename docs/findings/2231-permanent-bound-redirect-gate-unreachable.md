---
title: The permanent-bound redirection gate has no shipped card that can reach it
discoveredBy: 2231
status: draft
confidence: low
---

**What is wrong.** #2231 added a per-effect suppression gate to BOTH CR 614
loops. The transient-shield half is exercised by shipped cards (Jade Monolith,
Mirrorwood Treefolk vs Lava Burst / Whippoorwill). The permanent-bound
`replacementEffects[]` half is not reachable from any card in the catalogue
today, because of a scope mismatch nobody has written down:

- all four `damageEffectKind: "redirection"` permanent-bound effects fire only
  on damage aimed at a **player** — Harsh Judgment
  (`convex/cards/sets/inv/white.ts:513`), Martyrs of Korlis
  (`convex/cards/sets/atq/white.ts:230`), Personal Incarnation
  (`convex/cards/sets/lea/white.ts:914`), Veteran Bodyguard
  (`convex/cards/sets/lea/white.ts:1232`);
- both shipped locks are **permanent**-scoped — Lava Burst's rider is
  conditional on the target being a creature
  (`convex/cards/sets/ice/red.ts`), and `damageLockThisTurn` lives on a
  `CardInstanceState` (`convex/gre/state.ts`, `setDamageLockThisTurn` rejects a
  non-permanent selection).

So the gate is proven only by a direct `runDamageReplacement` unit test
(`convex/gre/__tests__/damageLock.test.ts`, "unpreventable vs unredirectable are
independent"), never end-to-end through a card.

**Why it may not deserve its own issue.** Building it was not speculative — the
gate is what stops the SAME loop leaking a _prevention_ lock, which several
shipped cards do reach (Callous Giant, Lashknife Barrier, Divine Presence), and
the classification field it keys on is required catalogue-wide either way. The
first printed card whose lock covers player damage (Skullcrack, Leyline of
Punishment, Everlasting Torment) closes the gap with no engine change. Worth
recording so a future reader does not mistake the unit test for over-testing, or
delete the gate as dead code.

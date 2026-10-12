---
title: A must-attack creature whose set-dependent restriction can't be met stalls the declaration
discoveredBy: 5495
status: draft
confidence: medium
---

**What is wrong.** Rule 508.1d says a requirement is obeyed only if obeying it
breaks no restriction. A creature that must attack, but carries a set-dependent
`declared-attack-restriction` it can't satisfy, is a problem: for example
Orcish Conscripts or Scarred Puma under an "attacks each combat" effect, with
no qualifying co-attacker. The legal declaration leaves that creature out.
Neither `foldAttackRequirements` nor the quota check in
`validateDeclaredAttackers` (`convex/gre/combat.ts`) models this. Both always
add the required creature, and the set check then throws.

**Evidence.**

- Human path: `confirmAttackers` auto-adds the required creature, then throws.
- Bot path: after issue #5495, `enumerateAttackerMoves` (`convex/gre/moves.ts`)
  filters every subset through `declaredAttackRestrictionViolation`. Every base
  subset contains the required creature, so the bot gets zero
  `declare-attackers` moves.
- Before issue #5495, the bot was offered the illegal move instead. Either way,
  the game stalls.
- The fix: the fold and the quota should count set-dependent restrictions as
  limits on how many requirements can be obeyed.

**Why it may not deserve its own issue.** It needs a must-attack effect
together with one of three shipped set-restricted cards (Orcish Conscripts,
Errantry's host, Scarred Puma). No preset reaches that position today.

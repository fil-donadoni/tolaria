---
title: A kicked count-widening decides which target gets which effect by pick ORDER, with no per-slot affordance
discoveredBy: 4133
status: draft
confidence: medium
---

**What is wrong.** CR 702.33g's kicked announcement is encoded as ONE group whose
count widens (`kickedTargetRequirement: { type: "Creature", count: 2 }`), so the
two slots the Effect Script indexes — `{ target: 0 }` and `{ target: 1 }` — are
assigned purely by the order the player clicks. Where the two slots do DIFFERENT
things, a player who picks in the other order gets the opposite spell, and there
is no undo. Jilt is the first such card: `{ target: 0 }` is bounced to its
owner's hand, `{ target: 1 }` takes 2 damage.

**Evidence.** `convex/oracle/lowerEffects.ts` — `TargetSlots.foldKickedWidening`
(the encoding); `src/components/board/target-selection-banner.tsx` renders one
"choose 2" prompt with no per-slot label. The three encodings that shipped before
this rule are all SYMMETRIC — Magma Burst (3 damage / 3 damage), Falling Timber
(prevent / prevent), Rushing River (bounce / bounce) — so the ambiguity had never
mattered. It is legal under CR 601.2c: the controller does choose, and the
announcement is complete before resolution.

**Why it may not deserve its own issue.** Exactly one card reaches it today, and
the fix is not local: either the announcement grows per-slot prompts (a
`TargetRequirement` shape change reaching `pendingTarget`, the banner and the bot
enumerator), or the compiler stops using the widening for asymmetric bodies and
needs an encoding that does not exist. A line on whichever ticket next touches
the target-selection banner is likelier the right home than a ticket of its own —
unless a second asymmetric card lands, which is the signal to promote it.

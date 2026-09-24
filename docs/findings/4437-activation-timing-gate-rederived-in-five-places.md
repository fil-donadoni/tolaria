---
title: The activation timing gate is re-derived in five places, one of them on the client without checking the stack is empty
discoveredBy: 4437
status: draft
confidence: high
---

**What is wrong.** "May this ability be activated now" (controller's turn only,
attacked-this-turn, once per turn, sorcery speed, phase restriction, class
level) is written as a throwing check in `activation.ts`, a `continue` in
`moves.ts`, a `return false` in `src/lib/card-utils.ts`, and again in
`evaluate.ts` and `autoTapDemands.ts`; `activationPhaseRestriction` has seven
further check sites. The client copy tests the sorcery window without the
empty-stack condition.

**Evidence.** `convex/gre/activation.ts` `assertActivationTimingLegal`,
`convex/gre/moves.ts` (~4224), `src/lib/card-utils.ts` (~2084),
`convex/gre/evaluate.ts` (~661), `convex/gre/autoTapDemands.ts` (~177).

**Why it may not deserve its own issue.** The precedent already exists
(`loyaltyActivationViolation`, `classLevelActivationViolation`: a boolean
authority with a thin throwing wrapper), so this is ~150 lines and low risk —
but it is a scatter fix, not a bug report, and no user-visible symptom has been
tied to it. Ticket it when the next activation restriction is added, or if the
client's missing empty-stack check is ever shown to offer a move the server
refuses (the Bot-freeze class).

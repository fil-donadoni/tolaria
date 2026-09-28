---
title: The client's "has a legal target" pre-check reads only controller and subtype
discoveredBy: 4320
status: draft
confidence: medium
---

**What is wrong.** `hasBattlefieldTargetCandidate` (`src/lib/card-utils.ts`)
decides whether an activated ability with a battlefield target is offered at
all. It lowers only `controller` and `subtypeFilter` into the registry check,
never the whole `PERMANENT_FILTER_KEYS` set, and it never binds the
source-relative directives (`applySourceDirectives`). So an ability whose only
restriction is some other filter looks as if it has a target when it has none.
The menu offers it, and the server then refuses the activation because there is
no legal target.

**Evidence.** Cromat's `{W}{B}: Destroy target creature blocking or blocked by
Cromat` (`combatPartnerOfSource`, issue #4320) is offered outside combat.
`combatRoleFilter` ("target attacking creature") has the same gap and predates
it. The offered/accepted split is the ADR 0068 class, only at the ability-menu
layer rather than at target highlighting.

**Why it may not deserve its own issue.** The failure is a dead menu entry that
the server refuses cleanly, never an illegal move. A fix is small: run
`checkPermanentTargetFilters` over `lowerPermanentFilters(applySourceDirectives(req, source.id))`.
The trigger-state view probably needs the combat and turn facts first, though,
and that is the real cost.

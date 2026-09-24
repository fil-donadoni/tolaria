---
title: The `choose-player` Pending Choice kind has no producer in the catalogue
discoveredBy: 4476
status: draft
confidence: high
---

**What is wrong.** `choose-player` is still a `ZonePickKind` member with a
dedicated branch in `applyPendingChoiceSubmit`, a label, a client-buffer entry
and a Brain case, but no production code raises it. Endurance, its only
producer, moved to an announcement-time CR 603.3d player target in issue #1193,
and `EffectChoiceKind` does not admit it, so a DSL `choice` Op cannot raise it
either. `look-top` was in the same position and issue #4476 removed it.

**Evidence.** `grep -rn '"choose-player"' convex --include='*.ts'` outside
`__tests__` hits only `gre/types.ts` (the union), `gre/pendingChoiceSubmit.ts`
(the consumer branch) and `gre/ai/nonZoneChoiceCandidates.ts` (the Bot table).
Issue #4476 pins the ladder branch with a test-only `resolve()` fixture
(`convex/gre/__tests__/pendingChoiceThinKinds.test.ts`), so the handler
registry (issue #4443) ports it rather than dropping it silently.

**Why it may not deserve its own issue.** Unlike `look-top`, the kind has a
live, non-generic consumer branch and is the natural shape for a future
`resolve()` card's "choose a player" clause (Blocked on a
choose-player-and-store Op in `cards/sets/atq/colorless.ts`). Deleting it
could be premature; it might belong as one line on the registry's issue #4443,
which will decide whether every kind in the union earns a handler.

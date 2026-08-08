---
title: delayedOracleText/inlineTargetRequirement/reflexiveTrigger/designationId/designationImagePrintId are absent from resetStackTransientState by design, not by omission
discoveredBy: 2137
status: draft
confidence: high
---

**What was audited.** Issue #2137's third acceptance criterion asked for an
audit of every `StackItem` cast-time snapshot field absent from
`resetStackTransientState` (`convex/gre/state.ts`). Besides
`dynamicCantBeCountered` (fixed in #2137 — a genuine leak), the issue named
five more candidates: `delayedOracleText`, `inlineTargetRequirement`,
`reflexiveTrigger`, `designationId`, `designationImagePrintId`.

**Why these five are NOT part of this bug class.** All five are set ONLY on
synthetic, non-card stack items built fresh at trigger-fire time — never
derived from a `card` object that could have previously ridden through a
hand/library/graveyard/exile zone:

- `convex/gre/triggers.ts:46-71` (`buildDelayedTriggerStackItem`) — builds a
  brand-new `StackItem` literal (`card: { id: t.sourceCardId }`) each time a
  delayed trigger fires; sets `delayedOracleText` alongside `delayedTriggerId`
  in the same literal, never spread from an existing card object.
- `convex/gre/triggers.ts:87-120` (`buildMonarchDrawStackItem`) — same shape;
  sets `designationId`/`designationImagePrintId` alongside `delayedTriggerId`.
- `convex/gre/state.ts:13486-13511` (`reflexiveTrigger` Op handler) — same
  shape; sets `reflexiveTrigger: true` and (conditionally)
  `inlineTargetRequirement` alongside `delayedTriggerId:
INLINE_DELAYED_TRIGGER_ID` in one fresh literal.

All three construction sites unconditionally pair their field with
`delayedTriggerId`. Every call site `resetStackTransientState` reaches is
gated against `delayedTriggerId` before it can arrive: `counter()`
(`convex/gre/state.ts`, the `if (item.abilityId || item.triggeredAbilityId ||
item.delayedTriggerId) return;` guard) and `putSpellOnLibrary()` (identical
guard) both return early for any item with `delayedTriggerId` set, before
reaching a `resetStackTransientState`/exit-clear call; `finalizeSpellResolution`
and `sendStackItemToGraveyard` only ever run for a stack item that resolved or
was countered as a SPELL (a delayed/reflexive/designation trigger vanishes
instead of moving to a zone, CR 603.7a/701.5a).

Since these five fields can never coexist with an item that reaches a
zone-array push, there is no `{ ...card }` round-trip that could carry them
forward, and adding delete lines for them to `resetStackTransientState` would
be dead code, not a fix.

**Why it may not deserve any further action.** All three construction sites
were read in full and unconditionally pair the field with `delayedTriggerId`,
and both guard sites (`counter()`, `putSpellOnLibrary()`) return early on that
same field before reaching a clear call — the reasoning above is a complete
audit, not a probabilistic guess. Recorded so a future re-audit of this field
list doesn't redo the same investigation; likely a straight `declined` on
triage.

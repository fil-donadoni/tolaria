---
title: Palace Jailer's exile ignores CR 610.3b when the monarchy changes before its ETB resolves
discoveredBy: 2601
status: draft
confidence: medium
---

**What is wrong.** #2601 added a CR 610.3a/610.3b guard to the
exile-until-source-leaves family: `exileWithAttachments`
(`convex/gre/state.ts`) grows a `requireSourceOnBattlefield` opt that the
`exileWithAttachments` Op sets, so an O-Ring destroyed in response to its own
ETB exiles nothing instead of stranding the card. Palace Jailer
(`exileUntilMonarchChanges`, `convex/gre/state.ts`) deliberately leaves that
opt false, and correctly so: its specified event is a MONARCH CHANGE, not the
Jailer's own departure, so the exile must survive the Jailer's death (CR 720).

But Palace Jailer has the same CR 610.3b hole against its OWN event. If an
opponent of the Jailer's controller becomes the monarch between the ETB
trigger firing and that trigger resolving, the specified event has already
occurred, and CR 610.3b says "the object doesn't move". The engine exiles the
creature anyway and arms a `monarchReturnWatch` that will only fire on the
NEXT monarch change — so the creature sits in exile through a monarchy the
rules say should have kept it on the battlefield.

**Evidence.** `convex/gre/state.ts::exileUntilMonarchChanges` calls
`exileWithAttachments` and then unconditionally pushes onto
`state.monarchReturnWatch`; nothing compares the current monarch against the
one in force when the trigger was put on the stack. The generalized guard
cannot express this: `requireSourceOnBattlefield` asks about the SOURCE's
zone, while Palace Jailer's event is a change in `state.monarchId`. Printed
via `bun run cr 610.3b`.

**Why it may not deserve its own issue.** The window is narrow — it needs a
monarch change in the response window to Palace Jailer's own ETB trigger,
which in a 2-player game means an opponent connecting with a monarch-stealing
attack or resolving another monarch effect at instant speed while the trigger
is on the stack. Palace Jailer is currently the only card on the
`exileUntilMonarchChanges` path, so this may be a line on the monarch tracker
rather than a ticket. It is also the second instance of one class ("an
until-EVENT exile must re-check its event at resolution"), which is the
argument FOR generalizing the guard from a zone predicate to an
event-still-pending predicate rather than fixing Palace Jailer alone.

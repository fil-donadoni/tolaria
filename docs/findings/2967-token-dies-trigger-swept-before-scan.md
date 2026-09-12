---
title: A token that dies fires no trigger at all — the CR 704.5d sweep removes it before the trigger scan
discoveredBy: 2967
status: draft
confidence: high
---

**What is wrong.** `checkTokenExistenceSBA` runs INSIDE the SBA fixpoint
(`convex/gre/sba.ts:860`) and `processPendingActionTriggers` only after the
fixpoint settles (`convex/gre/sba.ts:900`). So a token put into a graveyard is
already gone from every zone array by the time `collectTriggers` looks for it,
and the CR 603.10a look-back scan — which locates a departed source by scanning
its destination zone (`convex/gre/triggers.ts:420`) — finds nothing. The token's
own dies / leaves-the-battlefield triggers never reach the stack.

CR 704.5d ends the token's existence, but the death itself already happened:
CR 603.10a puts leaves-the-battlefield abilities first on the look-back list
precisely so an object that no longer exists still contributes them.

**Evidence.** Probe against the real engine — a token instance of Rukh Egg
(`isToken: true`), `removePermanentTo(state, id, "graveyard")` then
`checkStateBasedActions(state)`, then `collectTriggers` over the queued
`pendingEvents`:

```
{ "gy": [], "fired": [] }
```

`["rukh-egg-death"]` is owed. The same board with a NON-token instance fires it
(`convex/gre/__tests__/lookBackTriggers.test.ts`, "leaves an ordinary
permanent's printed dies trigger untouched").

This is pre-existing and independent of issue #2967's look-back fix: the entry
`lookBackSelf` would read is written correctly for tokens too
(`GameState.lastKnownCopiable`, ADR 0086 — "written for EVERY departing
permanent, tokens included"), but the scan never gets as far as consulting it
because the SOURCE is not in any pile. It means the most common copy shape —
Kiki-Jiki / Splinter Twin token copies, and every `createTokenCopyOf` — takes no
benefit from that fix either.

**Why it may not deserve its own issue.** The fix is an ORDERING question inside
the SBA sweep (drain event triggers before the token sweep, or have the sweep
defer removal of tokens whose ids are in the current `pendingEvents`), and
getting it wrong reaches every SBA path in the engine — so it may belong as a
slice under whatever tracker owns SBA ordering rather than as a standalone
ticket. It is also possible a caller drains triggers earlier on some paths; the
probe exercised the `checkStateBasedActions` → `processPendingActionTriggers`
sequence those two functions themselves compose, not every entry point.

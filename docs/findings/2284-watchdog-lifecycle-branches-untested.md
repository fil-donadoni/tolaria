---
title: Every lifecycle branch of the new bot watchdog is individually removable with the whole driver suite green
discoveredBy: 2284
status: draft
confidence: high
---

**What is wrong.** Issue #2284 gave `useVsAiDriver` a watchdog whose timer is
held in a ref keyed to the state version and is deliberately **not** torn down by
its effect's cleanup (`src/hooks/useVsAiDriver.ts:655-739`). The escalation
behaviour that timer drives is now well covered — 15 tests in
`useVsAiDriver-liveness.bot.test.ts`, several proven to fail. Its **lifecycle** is
not covered at all. Five branches decide when the timer is armed, re-armed and
disarmed, and **each one can be deleted with all 32 driver tests still green**.

This is one observation rather than five because the remedy is one thing: a
purpose-written lifecycle probe. Splitting it into per-branch tickets would
produce five tests nobody writes.

**Evidence.** Branch by branch, all in `src/hooks/useVsAiDriver.ts`:

| Branch                                                                             | Line    | What it stops                                                                        |
| ---------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `useEffect(() => disarmWatchdog, [disarmWatchdog])` — the unmount teardown         | 739     | an armed timer firing into a game the player has left                                |
| `if (inFlight.current) { arm(BOT_WATCHDOG_MS); return; }`                          | 718-720 | a never-settling submission killing the clock                                        |
| `if (stuckSignature.current !== signature) arm(BOT_WATCHDOG_MS)` — the self re-arm | 728     | an inert rung being the last thing that ever happens                                 |
| `if (stuckSignature.current === signature) { disarmWatchdog(); … }`                | 686-688 | rung 5 re-firing forever after the terminal banner                                   |
| `disarmWatchdog()` on each early return (`!botState`, loading tick, tick/seq race) | 663-681 | a timer surviving into a state version whose `view`/`signature` it no longer matches |

Two of the five are worth naming individually.

**The unmount teardown (line 739) is the only thing standing between a leaked
timer and an abandoned game.** Delete it and the suite stays green — only a
purpose-written probe catches it, because no existing test unmounts the hook with
a timer armed. What it prevents is user-visible: the driver's timer fires after
the player has left the board, `escalate` runs against the last-seen
`realisationContext`, and a decline mutation is submitted into a game nobody is
watching. It is also **structurally fragile**: it sits three lines below a
`// NO cleanup: … The timer is owned by the ref, not by this effect run.` comment
on a _different_ effect. A future reader consolidating "the two watchdog effects"
is being invited to delete exactly the one that must stay.

**The `inFlight` re-arm (lines 718-720) is the original bug class, reappearing
with no alarm.** `escalate` refuses to interleave a rung into a live submission
(ADR 0091 decision 6 — a realisation is atomic). If the fire handler simply
returned instead of re-arming, a submission that never settles would leave no
clock running at all: no `.finally`, so no settle nonce, so no re-render, so no
effect re-run, so nothing ever re-arms. That is precisely the "no mutation → no
tick → nothing left to run" latch #2284 exists to eliminate. A websocket drop
mid-mutation reaches it. The consult side of this was closed at the source
(`BRAIN_CONSULT_TIMEOUT_MS`, `brain-client.ts`) and has its own test; the
**mutation** side has neither a timeout nor a test.

**Why it may not deserve its own issue.** Three arguments against:

1. Two of the five branches are genuinely redundant today. The self re-arm and
   the `!owed` disarm are both re-established by the settle nonce's re-render on
   the very next tick, so removing them costs nothing observable. Testing a
   redundant branch pins an implementation detail, not a behaviour.
2. The unmount hazard is bounded: the mutation lands in a game the player left,
   and the server re-validates it. It is noise and a wasted write, not a
   corruption.
3. The whole cluster may be better answered by a **structural** rule than by five
   tests — the shape `.claude/rules/gre-development.md` prefers ("the test must
   traverse the real path" over "write good tests"). If the watchdog's arm /
   re-arm / disarm decisions were one small pure function over
   `(signature, owed, inFlight, stuck)` returning an intent, it would be
   exhaustively testable in one table-driven test and the effect would hold no
   branches worth deleting.

Against all that: the `inFlight` re-arm is not redundant, and an untested branch
guarding the exact failure class the issue was opened for is the shape that rots.
If this becomes a ticket, argument 3 is the version worth building.

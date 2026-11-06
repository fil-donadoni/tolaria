---
title: ActionSheet's close timer has no cleanup, and can red a lane whose tests all passed
discoveredBy: 8168
status: triaged
issue: 8296
confidence: high
---

**Fixed under issue #8296.** PR #8396's `check:lane` went red on the same stack
twice (run 42218346112, attempts 1 and 2), so a re-run could not land it. An
unmount now settles a pending close at once, and no timer outlives the sheet.
The lane error itself has still never been reproduced locally.

**What is wrong.** `handleClose` in `src/components/ui/action-sheet.tsx:36` calls
`setTimeout(onClose, 200)` and never clears it. If the sheet unmounts inside
those 200 ms, `onClose` still runs. When that happens after a test file's
environment is torn down, React's `setState` throws, vitest counts an unhandled
error, and the lane goes red with every test green.

**Evidence.** PR #8323's `check:lane` (run 42106717257, step `vitest(related)
2/2`) reported 592 files and 7464 tests passed, 2 skipped, and 1 error:
`ReferenceError: window is not defined`, through `resolveUpdatePriority` and
`dispatchSetState` from `Timeout.onClose`, at
`src/components/deckbuilder/deck-zone-peek.tsx:142`, attributed to
`src/components/limited/__tests__/limited-draft-table.test.tsx`. That PR's diff
touches neither `action-sheet.tsx`, `deck-zone-peek.tsx` nor that test.
`pr:fixup classify` printed `needs-pass ... with no fixup row`, so the queue
labelled the PR `land-failed` and it took a repair pass.

**Not reproduced.** Seven local runs on the Huawei stayed clean: the whole file
once, the `Move to…` test alone three times, and three `--no-isolate` runs with
one worker shared across 21 files. That `Move to…` test uses fake timers, while
the stack shows a real Node `Timeout`, so it is not what armed this timer. Which
test does is unknown. The cause above is read from the stack and the code, and
has not been shown by a failing run.

**Why it may not deserve its own issue.** It is one occurrence, seen under
lane load. In the app the leak is harmless, because `setPickingColumn(false)` on
an unmounted component is a no-op. The fix is small (keep the timer id, clear it
on unmount), but it sits in `components/ui/`, so that PR owes a `check:ui` walk.

---
title: The stack was the top refusal by count, but most stack positions state no preference
discoveredBy: 3480
status: draft
confidence: high
---

**What is wrong.** Nothing is broken — the measurement that ordered the work
turns out to have ranked a cause whose positions are largely not judgeable for a
SECOND reason. Issue #3480 removed the blanket stack refusal and the sweep shows
the stack collapsing as a cause (`stack-not-journalled` 14.4% → 7.7% on robots
vs erhnamgeddon, 4.6% → 0.8% on mono-red-burn vs channel-fireball), while the
judgeable share barely moves: 12.9% → 13.3% and 11.9% → 11.9%. Almost all of the
freed decisions land on `single-candidate` (+176 and +107 respectively).

That is the correct outcome, not a failure: with a spell on the stack the
responder's only legal move is very often `pass`, and a verdict there states no
preference (`collectVerdictReport`'s UNCONSTRAINING). But it means PRD #3397's
remaining headroom is NOT where the pre-#3480 refusal table pointed.

**Evidence.** The four sweeps are the same seeds and budget with the journal on
and off (six games, seeds 1..6, 60 iterations). Ranked tables in PR for issue
#3480.

**Why it may not deserve its own issue.** It is a re-prioritisation input for
PRD #3397, not a defect: the two causes now worth measuring are
`different-decision` (14.8% on robots — a lowering that loses something the
decision depended on, cause unnamed) and `combat-not-captured` (6.0% on burn).
Whoever picks up the next spec-widening slice should re-read the table rather
than the issue list.

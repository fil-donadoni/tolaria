---
title: fit:weights says DO NOT PASTE on an ordering tie that the reproducibility guard requires pasting
discoveredBy: 4218
status: draft
confidence: high
---

**What is wrong.** `improvesOnIncumbent` (`convex/gre/ai/verdicts/report.ts`)
is strict, so when the fitted vector orders EXACTLY as many verdicts as the
committed one, `pasteInstruction` prints `DO NOT PASTE — the fitted vector
orders FEWER verdicts than the committed one`. Here that text is false. And
`weightFit.bot.test.ts` still reds until the vector is pasted, because it
demands that `DEFAULT_EVAL_WEIGHTS` IS the fit. Adding any new blade `moves`
entry whose pair the committed vector already orders produces this tie. The two
tools then give opposite instructions.

**Evidence.** Issue #4218 added three `must` entries. The fit was 71/108
verdicts, 138/191 pairs for both the incumbent and the fitted vector, with
contradictions 159 → 156. `improvesOnIncumbent: false` printed DO NOT PASTE.
The guard demanded the paste. After the paste, `test:blade` must stays green
(180/180) and `fit:weights` reports the committed vector as up to date.

**Fix shape.** Split the tie out of the refusal: on equal ordering, print
"ordering-neutral refit — paste (the guard requires it)" and keep DO NOT PASTE
for a strict loss. Or have the guard accept the incumbent when the fit does not
improve on it. Either way, one of the two instructions has to change.

---
title: A win gated by a triggered ability's own condition still reads as certain latent worth
discoveredBy: 5045
status: draft
confidence: medium
---

**What is wrong.** Issue #5045 stopped the latent reader from counting a
`winGame` inside an `if` Op's `then` branch (`withoutConditionalWin`,
`convex/gre/ai/opValuers.ts`). A win gated by the triggered ability's own
`condition` (an intervening "if", CR 603.4) with a top-level
`effects: [{ op: "winGame" }]` never reaches `case "if"`, so it still prices
the `WIN_GAME_VALUE` sentinel as certain.

**Evidence.** The review probe gave `cardValueById(Epic Struggle) = 300`
(the `MAX_LATENT_SCRIPT_VALUE` cap) after the fix. The trigger-path weights
are around `UNDECIDABLE_GATE_WEIGHT` and the step-gate logic in
`convex/gre/ai/cardScriptValue.ts`.

**Why it may not deserve its own issue.** Epic Struggle's trigger is a
standing upkeep ability, and its hand face and battlefield face carry the same
number, so the card is still cast (`botReach: played`). The cost is a skewed
hand value, not an uncastable card. That is the ETB-only failure that #5045
fixed.

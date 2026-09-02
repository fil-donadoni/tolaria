---
title: revealTopAndRoute has an OP_VALUERS row but no OP_BENEFICENCE row, so its sign fails open to "neutral"
discoveredBy: 2707
status: draft
confidence: medium
---

**What is wrong.** `OP_BENEFICENCE` (`convex/gre/ai/opValuers.ts`) is site 7b of
the `/new-op` checklist and the one nothing guards: a missing row resolves
through `?? "neutral"`, so the bot loses the who-does-this-help axis for that Op
entirely. `revealTopAndRoute` has no row. Every `RevealRouteDestination` it can
name gets the card OUT of the named player's library and into a zone they own,
so the sign is unambiguously `"beneficial"` — the same argument the neighbouring
`digMatchingToHand`, `lookDistribute` and `explore` rows already make in that
table.

**Evidence.**

- `convex/gre/ai/opValuers.ts` — `revealTopAndRoute` appears in `OP_VALUERS`
  (the valuer is `const revealTopAndRoute: Valuer<"revealTopAndRoute">`, and the
  name is listed in the table below it) but grep for `revealTopAndRoute:` inside
  the `OP_BENEFICENCE` object literal returns nothing.
- `opValuerCoverage.bot.test.ts` censuses `OP_VALUERS` only, so the gap is green
  in every suite including `check:guards`.
- The failure shape is the one `convex/gre/ai/beneficence.ts` was written for:
  Nadu-style "reveal the top card, land to the battlefield, otherwise to hand"
  pointed at an OPPONENT (`player: { target: 0 }` is a shipped shape on the Op)
  reads as neutral, so the bot has no reason not to hand the gift over.

**Why it may not deserve its own issue.** No shipped card currently aims
`revealTopAndRoute` at an opponent — the Op's only consumers dig their own
library — so the mis-sign is latent rather than live. And the fix is a one-word
row that, under `.claude/rules/bot-development.md`, still owes a `must` blade
entry in the same PR (it is a bot behaviour change), which is more work than the
diff suggests. It may be better as a line on the bot map (issue #1892) than a
ticket of its own, or folded into whichever PR next gives that Op an
opponent-facing consumer.

A second, wider version of the same observation: the checklist calls site 7b
unguarded, and nothing enumerates which Ops are missing a row. A census test
mirroring `opValuerCoverage.bot.test.ts` — with an explicit allowlist for Ops
whose sign is genuinely ambiguous (`transform` is the documented example) —
would close the class rather than this one instance.

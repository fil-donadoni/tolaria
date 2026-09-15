---
title: CR 117.3a is cited catalogue-wide for "may pay" / "unless pays" decisions
discoveredBy: 2100
status: draft
confidence: high
---

**What is wrong.** The vendored CR's 117.3a is "The active player receives
priority at the beginning of most steps and phases…". About 150 comments and
test titles cite it for optional-payment decisions: `mayPay`, "counter unless
its controller pays", and upkeep pay-or-else taxes. For those decisions the
printed rules are 118.12 ("[A player] may [do something]. If [that player]
[does, doesn't]…") and 118.12a ("[Do something] unless [a player does
something else]"). A genuine priority citation (phases, combat, ninjutsu) is
correct and must stay.

**Evidence.** `grep -rn 'CR 117\.3a' convex src` gives about 150 hits. The
may-pay cluster is `convex/gre/{legalActions,pendingChoiceSubmit,state}.ts`,
`convex/cards/types.ts` (the may-pay cost union), and most counter-unless-pay
cards: `leg/blue.ts` Force Spike, `ulg/blue.ts`, `zen/blue.ts`, `sth/blue.ts`
and `mkm/multicolor.ts`. Issue #2100 fixed only its own new line in
`mh2/blue.ts` (Lose Focus → CR 118.12a). `cr:lint` cannot catch this, because
117.3a resolves and is not a 701/702 keyword id.

**Why it may not deserve its own issue.** It is comment-only, with no behaviour
change. It does, however, cover the whole may-pay family, and "print, never
recall" (ADR 0098) is the project's stated norm. A mechanical sweep that splits
priority citations (keep) from payment citations (→ 118.12/118.12a) is
defensible on its own. It would also be a candidate for a `cr:lint` rule that
flags `117.3a` on a line mentioning "pay" or "may".

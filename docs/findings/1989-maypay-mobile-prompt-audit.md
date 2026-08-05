---
title: No targeted client-side test coverage for a "you may draw" prompt appearing/being tappable on a bounced-and-recast enchantment specifically
discoveredBy: 1989
status: draft
confidence: low
---

**What is wrong (maybe).** Issue #1989 reports that recasting a bounced
enchantment (Mirri's Guile) with an Enchantress-style permanent in play did
not draw a card. The GRE mechanism is verified correct end to end (PR #2277,
regression test in `convex/cards/sets/lea/__tests__/green.test.ts`) — the
`may-pay` PendingChoice for Verduran Enchantress's optional draw is always
enqueued (`requestMayPay`, `convex/gre/state.ts`) and never auto-declines.

What I did **not** audit: whether the `may-pay` prompt reliably renders and is
tappable client-side for this exact shape (a triggered ability's `may-pay`
choice stacked on top of a spell still resolving, immediately after a cast),
particularly on a narrow mobile viewport (the reporter's UA was iPhone
Safari). The frontend has substantial existing coverage
(`src/lib/__tests__/may-pay-return-leg.test.ts`,
`src/hooks/__tests__/usePendingChoiceBuffer.test.ts`,
`src/components/board/pending-choice-prompt.tsx`), but none of it specifically
drives "a spell was just cast, a cast-trigger's may-pay is on top of the
stack, on a mobile-width viewport."

**Evidence.** None gathered — this is a documented gap in what I checked, not
an observed defect. The GRE-side mechanism (the only thing in this issue's
named blast radius, `convex/gre/**` + `convex/cards/sets/{2ed,leb,lea,usg}/**`)
is provably correct (PR #2277's proof-of-failure).

**Why it may not deserve its own issue.** I have no reproduction, no failing
test, and no evidence the prompt actually fails to render — only that I
didn't verify it does. The much simpler explanation for a single unreproduced
mobile bug report is a missed tap on an optional "you may" prompt, not a
client rendering bug. If a similar report recurs with confirmation that a
"Draw a card?" prompt DID appear and was tapped Yes with no effect, that would
be worth a real investigation (and a targeted mobile-viewport test for the
may-pay prompt specifically). Until then this is speculation, not a finding.

---
title: manual-band.ts has no counterpart to backRowRank for issue #2169
discoveredBy: 2166
status: draft
confidence: medium
---

**What is wrong.** `BoardBattlefield`'s new `rowClassifier` prop
(`src/components/board/board-battlefield.tsx`) is `{ bandOf, backRowRank }` —
two functions, because the back row itself sub-orders (lands flush-left,
other noncreature permanents flush-right). `src/lib/manual-band.ts`
(landed by #2168) only exports `manualBandOf`, answering the band half
(`"creatures" | "back"`); it has no counterpart deciding land-vs-other rank
within the back row.

**Evidence.** `src/lib/manual-band.ts:62-74` (`manualBandOf`) returns only a
`ManualBand`. `src/components/board/board-battlefield.tsx`'s
`BattlefieldRowClassifier` type requires both `bandOf` AND `backRowRank`
(`board-battlefield.tsx:44-47`).

**Why it may not deserve its own issue.** #2169 ("wire the Manual Board
through this seam", not yet filed at the time of this issue) is the natural
owner — whoever wires the Manual Game's `rowClassifier` will need to add a
`manualBackRowRank`-shaped function (or fold rank into `manualBandOf`'s
return) as part of that slice anyway, following the same
lane/type-line-then-fallback precedence `manual-band.ts`'s header comment
already documents for the band half. Flagging here only so it isn't
rediscovered from scratch.

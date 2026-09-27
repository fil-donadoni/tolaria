---
title: The Bot values every whole-zone moveZone at 0, so graveyard hate and graveyard recycling read as nothing
discoveredBy: 3011
status: draft
confidence: medium
---

**What is wrong.** `moveZone`'s whole-zone shape (`player` / `from` / `to`, no
`target`, issue #1279) always values to `{ points: 0, tags: ["tempo"] }`. The
valuer's first guard returns early for any `moveZone` without a `target`
(`convex/gre/ai/opValuers.ts`, `const moveZone`). Its comment only anticipates
the self-directed hand/library shuffle-in. But the shape also covers exiling an
opponent's whole graveyard (Tormod's Crypt, Soul-Guide Lantern), which is
graveyard hate, and shuffling your own graveyard back into your library
(Feldon's Cane, Gaea's Blessing), which recycles cards. Both carry a stake that
depends on who the `player` is and what their graveyard holds.

**Evidence.** Issue #3011 moved Tormod's Crypt, Feldon's Cane, Gaea's
Blessing's trigger and Winds of Change from `resolve()` onto this shape. Before
the move they were unread (`aiEffects` allowlist rows). After it they are read,
but every one of them still values at 0, so the Bot can reach the activation
through `enumerateMoves` but has no reason to choose it.

**Why it may not deserve its own issue.** This did not regress: the cards went
from "unscripted" to "scripted at 0". Pricing the shape properly means making
the value depend on the recipient (it helps when aimed at your own graveyard
and hurts when aimed at an opponent's) and on the graveyard's contents. That is
a `/bot-slice` change with a blade pair, and it probably belongs under the Bot
roadmap's valuation umbrella rather than as a standalone ticket.

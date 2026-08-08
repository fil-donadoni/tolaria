---
title: "sacrifice-permanents" pending choices have no in-tree ISMCTS candidate generator
discoveredBy: 2373
status: draft
confidence: medium
---

**What is wrong.** `CHOICE_CANDIDATE_GENERATORS` (`convex/gre/ai/
choiceCandidates.ts`) — the registry that turns a live `PendingChoice` into an
in-tree ISMCTS decision node — has no entry for `"sacrifice-permanents"` (or
its sibling `"choose-permanents"`). `enumerateMoves` (`convex/gre/moves.ts`)
therefore surfaces `[]` for any pending choice of this kind, and the bot
answers it purely through the ADR 0016 heuristic default
(`chooseResolution`'s `"sacrifice-permanents"` case, `src/lib/ai/brain.ts`):
`worstFirst(candidates).slice(0, min)`. Because every optional "you may
sacrifice…" card (Gut, True Soul Zealot; Minsc & Boo, Timeless Heroes's own
-2 loyalty ability) declares `min: 0` for the optional leg, this heuristic
**always returns an empty pick** — the bot can never choose the sacrifice
branch, only the mandatory-count (`min > 0`) shape would ever pick something,
and even then by raw card-worth (`worstFirst`), never by comparing "keep this
permanent" against "gain the created token/effect".

**Evidence.** `convex/gre/ai/choiceCandidates.ts:612-622`
(`CHOICE_CANDIDATE_GENERATORS`) lists `may-pay`, `land-entry-tapped`,
`draw-replacement`, `option-pick`, `search-library`, `random-reveal`,
`choose-hand-card` — no `sacrifice-permanents` entry.
`src/lib/ai/brain.ts:822-825` (`chooseResolution`'s `case
"sacrifice-permanents"`) computes `worstFirst(candidates).slice(0, min)`,
which is `[]` whenever `min === 0`. Confirmed against Gut, True Soul Zealot's
own shipped ability (`convex/cards/sets/clb/red.ts`,
`count: { min: 0, max: 1 }`): `src/lib/ai/__tests__/
gutTrueSoulZealot.bot.test.ts` proves the bot always declines under the
current default, even with a clearly-worse-than-the-token permanent (a bear)
sitting on the board as fodder.

**Why it may not deserve its own issue.** This is a pre-existing,
catalogue-wide gap that already affected the shipped Minsc & Boo card before
this issue — Gut does not introduce it, it just makes it newly visible
through a `min: 0` (fully-optional) instance of the same shape. Building a
real `sacrifice-permanents` ISMCTS generator (mirroring
`handPickCandidates`'s shape: compare "keep everything" against "sacrifice
candidate X" by projected value, including the created token/effect on the
gain side) is a genuine feature slice, not a one-line fix, and is better
scoped as its own ticket than folded into a single-card PR. Worth a line on
the bot AI wayfinder map (`project_bot_ai_wayfinder_map` memory) rather than a
fresh tracker if that map is still being drained.

---
title: An as-enters creature-type choice renders CR 205.3m's whole table as ~280 plain buttons
discoveredBy: 2710
status: draft
confidence: high
---

**What is wrong.** `PendingChoiceOptions` renders one `<Button>` per option in a
single `flex flex-wrap` row (`src/components/board/pending-choice-options.tsx`).
Every option-pick shipped before this was a handful of options — 2-5 modal
modes, 3 Primal Clay bodies, 8 Shapeshifter numbers, 21 pay-life amounts. "As
this enters, choose a creature type" (CR 614.12a) offers CR 205.3m's whole
table: ~280 buttons, unsorted beyond the rules' own alphabetical order, with no
search box, no grouping and no "types on the battlefield" shortcut — on a phone
viewport that is a wall the player scrolls through to find "Goblin".

**Evidence.** `convex/gre/state.ts`'s as-enters `"subtypes"` arm builds
`options: choice.from.map(...)`, and both shipped cards pass
`from: [...CREATURE_SUBTYPES]` (`convex/cards/sets/mmq/black.ts` Conspiracy,
`convex/cards/sets/ulg/black.ts` Engineered Plague). The prompt is also
generic — `Choose 1 as Engineered Plague enters.` never says _what_ is being
chosen, because the raise site has no noun for the option space.

**Why it may not deserve its own issue.** It is a UI affordance, not a rules or
reachability gap: the choice is raised, submitted and validated correctly, and
the bot now ranks the board's own types first
(`subtypeModePrior`, `convex/gre/ai/choicePriors.ts`). It predates this slice
(Conspiracy shipped it) and is one line on a picker-ergonomics ticket rather
than a card ticket — but it is the first choice in the game a human cannot
answer without scrolling, so the picker's ergonomics are now load-bearing.

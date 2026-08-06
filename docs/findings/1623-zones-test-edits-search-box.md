---
title: The Constructed zones test's "unrelated re-render" edits the search box, not the deck name
discoveredBy: 1623
status: draft
confidence: medium
---

**What is wrong.** `deck-builder-zones.test.tsx`'s mounted-drag test claims to
prove a Card Pin survives "any unrelated re-render — here, editing the deck
name". It does not edit the deck name: it grabs the FIRST `input[type=text]` in
the document, and that is the header's `SearchBar`, not `SaveDeckBar`'s name
field. The assertion still passes for a real reason (typing in the search box
does re-render the builder, and the pin does survive), so the test is not
vacuous — but it exercises a different input than the one it names, and a future
change to the search box's markup would silently retarget it again.

**Evidence.**
`src/components/lobby/deck-builder/__tests__/deck-builder-zones.test.tsx:243-250`
uses `getByTitle(/Remove Lightning Bolt/).ownerDocument.querySelector("input[type=text]")`.
The search input is emitted by `src/components/lobby/deck-builder/search-bar.tsx:13`
(`<input type="text" …>`) inside the header band, which renders before
`SaveDeckBar`'s own name input (`save-deck-bar.tsx`). Predates issue #1623 —
`DeckBuilder` already rendered `SearchBar` above `SaveDeckBar` before the shell
existed.

**Why it may not deserve its own issue.** It is one line in one test and the
behaviour it guards is genuinely covered (a re-render happens either way);
`deck-builder-parity.test.tsx` now drives the deck-name field explicitly through
`getByDisplayValue("Test Deck")`, which is the query shape this line should have
used. Most cheaply folded into whatever slice next touches that file rather than
ticketed on its own.

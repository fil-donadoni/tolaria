---
title: The AppShell scroll-contract guard's route-root census is looser than its own messages claim
discoveredBy: 1623
status: draft
confidence: medium
---

**What is wrong.** Two premise checks in
`src/components/chrome/__tests__/shell-height-claims.guard.test.tsx` are keyed on
"does the FILE contain one" rather than "is THIS the one", so both can be
satisfied by an element that is not the thing the registry declared. Neither is a
vacuous assertion — I proved both fail when the file genuinely has nothing (see
the proofs on PR #2303) — but each has a middle state where the declaration is
false and the guard stays green, and in one case the fail-open then feeds the
height sweep.

1. **`returnedRoots` counts a render-prop callback's JSX as a route root.** It
   matches any `return (` followed by a tag, including one inside a child's
   render prop, which is not `<main>`'s direct flex child and is not a route root
   at all. Consequence: `"every registered root file … returns at least one
element with a static className"` — whose message is _"the census below would
   silently cover nothing"_ — can be satisfied by that nested element while the
   real root has no readable className; and the height sweep runs
   `resolveShellLayout` over an element the shell never lays out.
2. **`ownScroller` is verified as `scrollers.length > 0`.** The declaration names
   a specific wrapper (`at:` = "the … wrapper around the whole content column"),
   but any scroller anywhere in the file vouches for it. Delete the
   whole-content-column scroller while leaving an inner one and the guard stays
   green — while `deriveHeightClaim` keeps receiving `hasOwnScroller: true`,
   which is exactly the fail-OPEN the module header calls out
   (`shellLayout.ts:326-328`, "Fail-closed on purpose").

**Evidence.** `shell-height-claims.guard.test.tsx:613-633` (`returnedRoots`) and
`:712-727` (the `ownScroller` premise check), both pre-dating issue #1623.
`deck-builder-shell.tsx:200-206` is a live instance of (1): the `DragOverlay`
render prop returns `<div className="aspect-5/7">`, which the sweep now treats as
a `DeckBuilderRoute` / `LimitedDeckBuilderRoute` root. Measured for (2): removing
`overflow-y-auto` from `deck-builder-shell.tsx:124` (the declared whole-column
scroller) while leaving `:141`'s source-panel scroller keeps all 22 assertions
green; removing both turns the `ownScroller` premise red.

**Why it may not deserve its own issue.** Both holes require a specific middle
state, and today's registry has exactly one `ownScroller` entry and one
render-prop instance, so nothing is currently mis-certified — the guard's real
outputs (`clippedPx`, `bottomReachable`) still fail loudly on the shapes #2274
was opened for. Fixing (1) properly means teaching `returnedRoots` about
component-boundary scope (a parser question, not a regex tweak), and (2) means
matching the declaration to the element rather than to the file, which is design
work rather than a one-liner. Most cheaply folded into whichever slice next
touches this guard — a line on the #2274 follow-up rather than a ticket, unless a
third route arrives with a nested scroller and makes the fail-open load-bearing.

---
title: The ui-gate's draft-pick selector matched zero elements for its whole life
discoveredBy: 2587
status: draft
confidence: high
---

**What is wrong.** `check:ui`'s `draft-pick` row has always reported "renders no
pack for this seat right now (zero `button[aria-label^='Draft pick:']` tiles)".
That reason was wrong: the tile is a `div role="button"`, so a `button[…]` CSS
selector can never match one, on any deployment, with any pack in front of any
seat. The surface has been unmeasurable since it was written, and the failure
looked exactly like an empty pack. Fixed in this PR (`[role=button][…]`).

**Evidence.** `src/components/limited/limited-draft-pack-card.tsx:57-65` renders
`<div ref={ref} role="button" … aria-label={\`Draft pick: …\`}>`— it has to be a
div, it is also the dnd-kit draggable. The selector was`scripts/ui-gate/surfaces.ts:109`, and its own comment reasoned carefully about
the aria-label while missing the element name.

**Why it may not deserve its own issue.** The one instance is fixed here. What
generalises is the shape: an `Unreachable` reason is written by the same person
who wrote the selector, so a selector that matches nothing produces a plausible,
self-consistent, wrong explanation — and `budgets.json` then records that
explanation as a standing fact. A cheap guard would be a lane-level assertion
that every `Unreachable` naming "zero X" was raised from a page where SOME
sibling selector matched; whether that is worth building is a judgement call on
how many more surfaces the lane still owes.

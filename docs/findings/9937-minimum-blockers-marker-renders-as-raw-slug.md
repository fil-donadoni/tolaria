---
title: The minimum-blockers:N marker renders as a raw slug in the keyword list
discoveredBy: 9937
status: draft
confidence: medium
---

**What is wrong.** `capitalizeKeyword` (`src/lib/card-utils.ts`) maps internal
`staticAbilities` slugs to their Oracle line through `KEYWORD_DISPLAY`, which
knows `does-not-untap` and `skip-untap-step` but not the parametric
`minimum-blockers:N`. Wherever a card's keywords render as structured rows
(Oracle text hidden, or the marker granted at runtime by `grantAbility`), the
player reads "Minimum-blockers:3" instead of "This creature can't be blocked
except by three or more creatures."

**Evidence.** `KEYWORD_DISPLAY` is a plain `Record<string, string>` lookup; a
parametric marker needs a pattern (`/^minimum-blockers:(\d+)$/`). The
hand-written Troll of Khazad-dûm already carries the marker; issue #9937 adds
Phyrexian Colossus and Rampaging Ceratops through the compiler.

**Why it may not deserve its own issue.** With Oracle text shown (the default
preview), native keywords are filtered out by `resolvePreviewAbilities`, so the
slug only surfaces in the structured view or on a granted copy — no shipped
card grants the marker today.

---
title: BasicLandArtPicker grid tiles from the same set share an identical aria-label
discoveredBy: 1629
status: draft
confidence: low
---

**What is wrong.** `src/components/deckbuilder/basic-land-art-picker.tsx` labels
each grid tile `${subtype} — ${p.setCode.toUpperCase()}` (e.g. "Mountain —
4ED"). A subtype with more than one printing in the same set (Mountain has
three 4ed printings, three 3ed, three 2ed, three leb) renders several grid
buttons with the exact same accessible name — a screen-reader user tabbing
through the grid hears "Mountain — 4ED" three times in a row with no way to
tell them apart by ear, even though they are visually distinguishable by art.

**Evidence.** `src/components/deckbuilder/basic-land-art-picker.tsx:84`
(`aria-label={`${subtype} — ${p.setCode.toUpperCase()}`}`) has no
per-collector-number or per-printing disambiguator — unlike
`src/lib/editions.ts:17-25` (`editionOptions`), which already solves the exact
same problem for the per-card edition `<select>` by appending a `#n` suffix
when a set has more than one printing in the list.

**Why it may not deserve its own issue.** `CardPrinting` (`convex/cards/catalogue.ts:404`)
carries no collector number, so the only disambiguator available is Ordinal-
within-set (`#1`/`#2`/`#3`), which `editionOptions`'s counting logic could be
reused for almost verbatim. This is a pure accessibility polish item (sighted
users already tell the tiles apart by the rendered art), not a functional gap
the issue's acceptance criteria call for, and is cheap enough to fold into a
future basics-bar accessibility pass rather than stand alone.

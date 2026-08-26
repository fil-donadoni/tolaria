---
title: font-beleren still on several editing-surface CHROME labels (ADR 0103 §4)
discoveredBy: 2728
status: draft
confidence: medium
---

**What is wrong.** ADR 0103 §4 confines Beleren to the card domain
(text-only card faces, the card frame) and moves everything else — including
dialog/menu chrome that merely NAMES a card — to the Geist display face.
Issue #2728 dropped the one `font-beleren` use inside its own target file
(`src/components/editing/inspect-overlay.tsx`'s dialog title), but several
sibling editing-surface chrome labels still carry it and were out of scope
for this issue:

- `src/components/cards/phyrexian-picker.tsx:81,96`
- `src/components/cards/additional-cost-picker.tsx:84,96`
- `src/components/cards/mode-picker.tsx:40,110`
- `src/components/cards/alt-cost-picker.tsx:78,88,99`
- `src/components/editing/editing-action-button.tsx:38`
- `src/components/editing/peek-panel.tsx:106`

**Why it may not deserve its own issue.** These are all UI chrome labels
(picker prompts, action buttons, the Peek Panel's title row), not the card
face itself, so the ADR's rule applies the same way it did to
`inspect-overlay.tsx` — but a proper fix should sweep the whole editing
surface in one pass rather than as a side effect of an unrelated PR, and
`peek-panel.tsx` in particular is explicitly flagged "behaviour unchanged"
for other in-flight v4 slices, so it may already be scoped into one of
#2721's other children.

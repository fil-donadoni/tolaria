---
title: control-edge-usage.test.ts is blind to the flattened border-border-subtle alias — 10 interactive sites beyond mode-picker.tsx
discoveredBy: 2731
status: draft
confidence: medium
---

**What is wrong.** `src/__tests__/control-edge-usage.test.ts`'s `HAIRLINE_BORDER`
regex is `/border-\[var\(--hairline/` — it only catches the arbitrary-value
spelling of the decorative hairline pair. `--color-border-subtle` (`#2d2f32`,
`src/index.css:234`) is the SAME ivory/12 value flattened onto `--color-surface`
into a plain hex (`src/index.css:228-234`, `:1386`) so it can be used as a bare
Tailwind colour utility (`border-border-subtle`) instead of an arbitrary value.
A control drawing its edge with `border-border-subtle` is the identical WCAG
1.4.11 violation (1.34:1, needs 3:1) as one spelled `border-[var(--hairline)]`,
but the sweep's regex never matches the alias spelling, so it passes.

**Evidence this is real, not theoretical.** Round-1 review of #2731 found
`mode-picker.tsx`'s `ModeRow` — a `<button>` — carrying
`hover:border-border-subtle`, the exact violation `AnchoredPickerRow` (one
function below, in the shared popover shell) was fixed for in the same PR
(`0671b4e8`). The reviewer proved the sweep was blind to it by temporarily
rewriting the class to the translucent spelling (`border-[var(--hairline)]`,
identical rendered colour) — that alone reds the sweep with
`mode-picker.tsx:34 <button>`. This round fixes `mode-picker.tsx` itself
(`hover:border-border-strong`, WCAG-compliant 3.38:1) but does not widen the
sweep — see below.

**Site count found (interactive control tags only, `CONTROL_TAG` from the
sweep itself — `button` / `a` / the Trigger primitives — with the alias
appearing on the tag's own edge, not a `border-t/-b/-l/-r` divider and not a
`disabled:`-only state).** 11 total, 10 beyond the one fixed this round:

| File:line                                                          | Tag                             | Note                                                                                          |
| ------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/components/admin/bug-report-list-row.tsx:23`                  | `<button>`                      | resting-state list row, ternary vs. `border-border-accent` when selected                      |
| `src/components/board/band-formation-panel.tsx:95`                 | `<button>`                      | resting-state toggle, ternary vs. a signal colour when selected                               |
| `src/components/board/game-stack.tsx:390`                          | `<button>`                      | stack-overflow "show more" affordance                                                         |
| `src/components/board/player-granted-abilities.tsx:47`             | `<button>`                      | granted-ability pill (also has a genuinely disabled state, but the class applies at rest too) |
| `src/components/cards/mode-picker.tsx:34`                          | `<button>`                      | **fixed this round**                                                                          |
| `src/components/debug/dev-panel-rail.tsx:80`                       | `<button>`                      | dev-only debug panel toggle                                                                   |
| `src/components/deckbuilder/basic-land-art-picker.tsx:51`          | `<PopoverTrigger>`              | art-swatch trigger                                                                            |
| `src/components/lobby/deck-builder/deck-filters-button.tsx:94,135` | `<button>` + `<PopoverTrigger>` | both read the same `TRIGGER_CLASS` constant — one site, two tags                              |
| `src/components/lobby/deck-builder/multi-combobox.tsx:79`          | `<PopoverTrigger>`              | filter combobox trigger                                                                       |
| `src/components/lobby/limited-scope-picker.tsx:58`                 | `<button>`                      | draft-scope radio-style picker                                                                |

(Found with a one-off script mirroring the sweep's own `openingTag`/
`constantTable` machinery, restricted to `border-border-subtle` without a
side prefix or a `disabled:` guard — not committed; the sweep's own file is
the natural home for it if this gets picked up.)

**Why this PR does not widen the sweep.** The finding that surfaced this
explicitly gates the decision on set size: fix-and-widen only if the
independently-found set is small (≤5). Ten sites beyond the one this PR
already had a reason to touch is a repo-wide edge migration, not a
`mode-picker.tsx` fixup — exactly the scope creep CLAUDE.md's "no autonomous
code" / "discuss scope first" norms warn against for anything past the
ticket's boundary.

**Suggested widening, for whoever picks this up:** extend `HAIRLINE_BORDER` to
match `border-border-subtle` too — no side-scoped divider (`border-t-`/
`border-b-`/`border-l-`/`border-r-`), no `disabled:`-only state, mirroring the
exclusions used to produce the table above — then fix the 10 sites above one
PR at a time or in one batch, whichever the team prefers. Re-running the
sweep after the regex change should red on exactly this list, and green again
once each site moves to `border-border-strong`.

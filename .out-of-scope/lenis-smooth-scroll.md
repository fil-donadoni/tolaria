# Lenis smooth scroll

Tolaria does not use Lenis, or any other JavaScript smooth-scroll library, on
any surface — including the desktop Browse surfaces (lobby, decks, the
`/limited` list). Scrolling is the browser's native scroll everywhere.

## Why this is out of scope

**App-wide it was rejected by design.** ADR 0101 § Considered options records
the decision: Lenis hijacks scroll, and Tolaria's editing and Immersive
surfaces are built on native scroll behaviour that a hijacked scroller breaks:

- **scroll-snap** — the Draft Room's two stops on phone
  (`src/components/limited/draft-room/draftSnapStops.ts`,
  `useDraftSnapStops.ts`) and the deckbuilder's Mana-Value rows
  (`deck-mv-row.tsx`, `deck-zone-surface.tsx`) rely on CSS snap and
  `overscroll-behavior` that a virtual scroller overrides;
- **drag** — the long-press gesture engine on editing surfaces (ADR 0101 §4)
  arbitrates scroll vs drag on real pointer scroll, which Lenis intercepts.

**The desktop-Browse-only trial (#T1) was the one exception left open, and it
was closed too.** It was parked until PRD #2405 landed; when it came up for
triage (issue #2597) with every slice merged, it still had nothing to gain
that justified its cost:

- **No problem to solve.** Nobody reported janky scrolling on a Browse
  surface. Desktop trackpads and wheels already scroll smoothly natively.
- **No measurable success criterion.** "Measured for jank" names no threshold;
  the only thing a trial could deliver is a subjective feel, which is a
  human judgement on real hardware, not something a gate can hold.
- **Certain costs.** A new runtime dependency; a feature-flag mechanism the
  frontend does not have; an opt-out wired to the Motion preference
  (`[data-motion]`, `src/components/settings/settings-motion-section.tsx`)
  so `reduced` never gets synthetic easing; and the accessibility surface a
  scroll hijacker touches (keyboard scrolling, find-in-page, anchor jumps,
  nested scrollers such as the Inspect Overlay's
  `src/components/editing/inspect-overlay.tsx`) on an app that has just
  reached WCAG 2.2 AA (issue #2593).
- **A split scroll model.** Smooth on Browse and native on Immersive would
  make the same wheel gesture feel different depending on the shell mode,
  which is the opposite of the one-design goal of ADR 0101.

Programmatic smooth scrolling where the UI moves the scroller itself — for
example `scrollTo({ behavior: "smooth" })` to settle on a Draft Room stop — is
native and stays; this record is about replacing the user's own scroll.

## Prior requests

- issue #2597 — "Lenis smooth-scroll trial — desktop Browse surfaces only
  (#T1, parked)", parked from PRD #2405

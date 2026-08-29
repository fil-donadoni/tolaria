# Browser Verification Rules — resident index

**A change that can alter what a user SEES is not done until a real browser has
shown it.** happy-dom has no layout engine, so "the card is in the document"
passes on a screen where the card sits in a 24px-tall container.

**This file is the index; the full text is `src/CLAUDE.md`**, which the harness
loads on demand the first time a session reads a file under `src/`. Procedure
and the probe: `docs/guides/browser-verification.md`; click sequences:
`docs/guides/ui-runbooks.md`.

**Applies to** any diff reaching a component, CSS, layout, responsive rule,
overlay/z-index or scroll container. Not to engine/Convex/script/doc changes —
say so in one line and move on.

**Run `bun run check:ui`** (#2580). It owns its own Vite + headless Chrome,
signs in, walks the runbook surfaces at all five viewports (ADR 0101), probes
and runs axe. **Its output IS the receipt — paste it byte-exact, banner +
coverage line included** (#2760); `bun run land` re-derives them and refuses a
`skin`-lane PR that does not match. Only a `RECEIPT` run, never `DIAGNOSTIC`;
never reflow a row.

**A surface it could not reach prints `UNWALKED` and reds the run** — that is a
coverage failure, not a pass.

**Measure, never eyeball.** A screenshot of a clipped row reads as "the cards
are there" — that is how the bug above shipped. A UI PR with no receipt and no
"cannot reach the DOM" note is not done.

**Gameplay checks use solo mode** — one user, both seats. Never a second tab
for the opponent.

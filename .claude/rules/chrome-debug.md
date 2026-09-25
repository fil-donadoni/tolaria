# Browser Verification Rules — resident index

**A change that can alter what a user SEES is not done until a real browser has
shown it.** happy-dom has no layout: "the card is in the document" passes while
the card sits in a 24px-tall container.

**This file is the index; the full text is `src/CLAUDE.md`**, loaded on demand
at the first read of a file under `src/`. Procedure and probe:
`docs/guides/browser-verification.md`; click sequences:
`docs/guides/ui-runbooks.md`.

**Applies to** any diff reaching a component, CSS, layout, responsive rule,
overlay/z-index or scroll container. Not to engine/Convex/script/doc changes,
nor a test-only `src/**` diff (ADR 0110 §4) — say so in one line, move on.

**Run `bun run check:ui`** (#2580): own Vite + headless Chrome, signs in, walks
the runbook surfaces at all five viewports (ADR 0101), probes, runs axe; nine
Floors at zero (ADR 0132). It is a gate outside `check:all` (offline; this
needs a deployment + browser), so the PR receipt is the whole enforcement.
**Its output IS the receipt — paste it byte-exact** (#2760); `bun run land`
re-derives its verdict block, refusing a mismatch or a non-`PASS` line. The
block no longer fits a PR body (GitHub caps it at 65,536 characters): paste the
three lines under `receipt digest` — banner, `verdict-sha256:`, coverage —
which `land` accepts on the same terms (#4419). A no-flag run walks the diff's
surfaces and prints `SCOPED` (ADR 0131), re-derived by `land`; `RECEIPT` covers
any diff; never `DIAGNOSTIC`; never reflow a row.

**Unreached prints `UNWALKED`; a walk the machine cut short, `INFRA` (#3644)** —
both red the run: unproven, not a pass.

**Measure, never eyeball** — a screenshot of a clipped row reads as "the cards
are there". A UI PR with neither receipt nor "cannot reach the DOM" note is not
done.

**Gameplay checks use solo mode** — one user, both seats; never a second tab
for the opponent.

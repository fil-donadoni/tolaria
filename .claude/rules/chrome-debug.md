# Browser Verification Rules

**A change that can alter what a user SEES is not done until a real browser
has shown it.** happy-dom has no layout engine — no viewport, no paint, no
stacking contexts, `getBoundingClientRect()` returns zeroes — so "the card is
in the document" passes on a screen where the card sits in a 24px-tall
container. Measured 2026-08-17 with the whole `dom` project green, at 390x844:
both deck-builder routes render **card zones 24-66px tall around 101-158px
card tiles**, plus 25 of 95 images occluded outright on the Limited pool.

**Applies to** any diff reaching a component, CSS, layout, responsive rule,
overlay/z-index or scroll container. Not to engine/Convex/script/doc changes —
say so in one line and move on.

**Three viewports per surface touched**, via `emulate`: desktop `1440x900x2`,
phone portrait `390x844x3,mobile,touch`, phone landscape
`844x390x3,mobile,touch,landscape`.

**Measure, never eyeball.** A screenshot of a clipped row reads as "the cards
are there" — that is how the bug above shipped. Run the probe from the guide
and report `zero / occ / stranded / starved` per viewport plus
`list_console_messages {types:["error"]}`. A UI PR with no receipt and no
"cannot reach the DOM" note is not done.

**Tooling:** the `chrome-devtools-mcp` plugin (CDP). The Claude-in-Chrome
extension cannot work in Arc — no `chrome.sidePanel`, so its per-site approval
is ungrantable and every call times out. Prefer `take_snapshot` (a11y tree +
uids) over screenshots for navigation; screenshots are evidence, not
diagnosis.

**Gameplay checks use solo mode** — one user, both seats, viewer auto-switches
to whoever holds priority. Never a second tab for the opponent.

Procedure and the probe: `docs/guides/browser-verification.md`. Click
sequences (solo game from cold, the active-game blocker, Limited deck builder,
debug scenarios, storage keys): `docs/guides/ui-runbooks.md`.

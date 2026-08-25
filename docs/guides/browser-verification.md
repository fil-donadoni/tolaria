# Browser verification

**How to prove a UI change actually renders.** The norm itself — when this is
mandatory — is resident in `.claude/rules/chrome-debug.md`; this guide is the
procedure, read on demand.

Task-by-task click sequences (start a game, reach the deck builder, load a
scenario) live in [UI runbooks](ui-runbooks.md). Read that one when the
question is "how do I GET to the screen", this one when it is "how do I prove
the screen is right".

**Most of this page is now automated: `bun run check:ui`** (issue #2580). Read
[The headless lane](#the-headless-lane-bun-run-checkui) first — the manual CDP
procedure below is for what the lane does not walk, and for diagnosing what it
flagged.

## Why the unit tests do not cover this

The `dom` vitest project runs on happy-dom. It has a DOM tree, and it has no
layout engine: no viewport, no paint, no stacking contexts, no scroll
containers. `getBoundingClientRect()` returns zeroes. Every assertion of the
form "the card is in the document" passes on a screen where the card sits in a
24px-tall container.

Measured 2026-08-17 on `main`, with the whole `dom` project green, at 390x844
(phone portrait): on the Limited pool builder the two card zones were **24px
and 66px tall while their card tiles are 101px**; 25 of 95 card images were
occluded outright. The same shape on `/decks/create`: a 24px zone holding
158px children. A human on a phone saw no cards. Every test the repo had said
they were rendered.

That is the gap this guide closes. It is not a style check — it is the only
check that looks at pixels.

## The headless lane (`bun run check:ui`)

One command, no browser plugin, no interactive session — the lane a headless
agent can actually run:

```
bun run check:ui                              # every surface, all five viewports
bun run check:ui -- --surface=lobby           # one surface, same rules
bun run check:ui -- --record                  # rewrite budgets.json from this run
bun run check:ui -- --headed                  # watch it walk
```

It owns the whole lifecycle: it checks the Convex deployment answers, starts
its **own** Vite on `127.0.0.1` and a free port (your `bun run dev` is left
alone), signs in, walks each surface in `scripts/ui-gate/surfaces.ts` at each
of the five viewports, injects `scripts/ui-gate/probe.js` and `axe-core`, and
compares the result against `scripts/ui-gate/budgets.json`. Screenshots land
in `.claude/telemetry/ui-gate/` (gitignored).

**Requirements.** A running Convex backend (`bunx convex dev` — the lane never
starts one), the Chromium binary (`bunx playwright install chromium`; a
missing one fails with that exact line), and dev-account credentials in
`TOLARIA_UI_EMAIL` / `TOLARIA_UI_PASSWORD` — read from the environment or from
the gitignored `.env.local`. The credentials are deliberately not in the repo.

**What a red means.** Two different things, and the lane never confuses them:

- **FAIL** — a measured number is over its budgeted ceiling. A real
  regression, or a surface whose budget a slice is meant to tighten.
- **UNWALKED** — the lane could not measure the surface at all: no budget
  entry for it, the debug-scenario row is absent from this deployment, an
  active game blocks the route, a walk timed out. This also exits non-zero.
  Coverage is the thing being asserted; "we could not look" is a red, not a
  shrug. The one exception is a surface the budget file explicitly declares
  `{"status": "unwalked", "reason": …}` — that is listed in the output and in
  the coverage line, and is the row a later slice deletes.

**The budget file is the contract.** `scripts/ui-gate/budgets.json` holds one
ceiling set per surface × viewport (`cardsZero/Occ/Stranded`,
`ctrlsZero/Occ/Stranded`, `starved`, `small`, `axeSerious`, `axeCritical`).
The floors the lane is FOR are zero occluded card tiles, zero stranded
controls and no axe serious/critical; where a surface violates one today the
entry carries a `knownDebt` note naming what is broken, printed under every
run, so the number reads as debt rather than as a decision. A slice that
fixes a surface lowers its ceilings in the same PR.

`small` (issue #2658) is the one ceiling that is deliberately **pointer-blind**:
the probe counts every visible interactive control under 44px on its smaller
dimension at EVERY viewport, but `--control-h` is 32px under `pointer: fine`
by design (`src/index.css:942,946-948` — the comment cites WCAG 2.5.8, a
touch-target rule). So a nonzero `small` on the desktop viewport (`1440x900x2`)
usually just reflects that intentional 32px control height, while the same
nonzero count on a `…x3,mobile,touch…` row is real sub-target debt — the
`knownDebt` note on each budgeted row says which one it is.

**What it is not.** It is not part of `check:all`: the full gate is offline by
contract and mutex-held, and booting a browser inside it would tax every
session that never touches the DOM. It is a standalone command a UI diff runs,
and its output is the receipt.

**Non-destructive by construction.** The lane resumes a pre-existing match
read-only and never concedes one it did not create, and it only loads a debug
scenario into a game it created itself. That is why an active game makes it
red (UNWALKED on the board surfaces) rather than making it lie.

## The tool: chrome-devtools-mcp, not the Claude extension

Use the `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` tools. They speak
CDP to a Chrome instance the plugin manages — no extension, no side panel, no
site-approval step.

The Claude-in-Chrome extension (`mcp__claude-in-chrome__*`) is the other
option and it **does not work in Arc**: Arc does not implement
`chrome.sidePanel`, the panel never opens, so the per-site approval it needs
can never be granted, and every call ends in `tabs_context_mcp … did not
respond in time` with `Your approved sites: none`. Do not spend turns
diagnosing that — go straight to CDP.

Core calls:

```
list_pages                       # what is open
navigate_page {type,url}         # url | back | forward | reload
take_snapshot                    # a11y tree with uids — prefer over screenshots
click {uid}                      # includeSnapshot:true to get the next tree free
fill {uid,value}
evaluate_script {function}       # measurement lives here
emulate {viewport}               # device emulation, see below
take_screenshot                  # evidence, not diagnosis
list_console_messages {types}    # ["error"] after every state change
```

`take_snapshot` costs a fraction of a screenshot and gives clickable uids;
screenshots are for the PR receipt and for the cases where the question is
genuinely visual (overlap, colour, cropping).

## The viewport matrix

Emulate, do not resize the window — `emulate` sets DPR, touch and the mobile
flag, which is what triggers the responsive branches.

```
emulate { viewport: "1440x900x2" }                         # desktop
emulate { viewport: "390x844x3,mobile,touch" }             # phone portrait
emulate { viewport: "844x390x3,mobile,touch,landscape" }   # phone landscape
emulate { viewport: "820x1180x2,mobile,touch" }            # tablet portrait
emulate { viewport: "1180x820x2,mobile,touch,landscape" }  # tablet landscape
```

Five viewports since ADR 0101 (the tablet pair was where the deck builders hid
their worst clipping). A change to a shared layout primitive (Panel, a zone
surface, a scroll container) owes all five. A change scoped to a desktop-only
affordance owes desktop plus one phone pass to prove it did not leak.

Emulation persists across navigations in the same page, so set it once and
walk the runbook.

## The probe

Eyeballing a screenshot is how the deck-builder bug shipped: the strip of
cards was visible, cut off at the bottom, and read as "cards are there".
Measure instead.

**The probe lives in one file: [`scripts/ui-gate/probe.js`](../../scripts/ui-gate/probe.js).**
`bun run check:ui` injects that file; a human pastes the arrow function it
assigns (everything after the `=`) into `evaluate_script`. This page used to
embed a copy of its own and the two had already drifted — the manual copy had
lost the touch-target, tiny-text and chrome-height measurements. One source,
so the gate and the hand check can never disagree about what "measured" means.

### Reading the output

- **`zero`** — the element collapsed: a flex child with no basis, an image
  with no intrinsic size. Always a defect.
- **`occ`** — laid out, inside the viewport, and something else is painted
  over its centre. Almost always a defect; the exception is deliberate overlap
  (the hand fan on the board reports a few).
- **`stranded`** — outside the viewport with no scrollable ancestor: the user
  cannot reach it by any gesture. Always a defect.
- **`reachable`** — outside the viewport but inside something that scrolls.
  **Not** a defect; this is what a long list looks like.
- **`starved`** — a scroll container shorter than the tallest thing inside it.
  This is the metric that catches the deck-builder class: the cards were not
  occluded and not collapsed, they were in a 66px window. Read it with
  judgement — a 300px container holding a 1200px column is a normal scrolling
  list; a 66px container holding 101px card tiles is broken, because scrolling
  cannot recover height the tile needs all at once.
- **`small`** — a visible, in-band `button,a[href],input,select,[role=button],
[role=tab],[role=option]` whose smaller dimension is under 44px. Budgeted
  but **pointer-blind** (see above): read a desktop-viewport count against the
  32px `pointer: fine` control height before calling it debt, and treat every
  touch-viewport count as real.

**The `reachable` / `occ` distinction is why this probe looks the way it
does.** The first version clamped every element's centre point into the
viewport before hit-testing, so anything below the fold hit whatever happened
to be at the clamp point and counted as occluded — it reported 90 of 95 on a
screen whose real count was 25, and it reported 13 of 13 on a lobby that is
fine. If you write your own variant, never hit-test a point the element does
not actually occupy.

What the probe still does not see: whether the layout is _good_. For that,
look at the screenshot. Colour and contrast are now covered by axe, which the
lane runs alongside the probe (`axeSerious` / `axeCritical` are budgeted).

## What goes in the PR

The `check:ui` table IS the receipt — paste it **byte-exact**: the
`RECEIPT`/`DIAGNOSTIC` banner line, every surface × viewport row, the coverage
line and the screenshot directory. This is not a style preference — `bun run
land` re-derives the banner, the coverage line and every row from the pasted
text and refuses to merge a `skin`-lane PR whose paste does not match
(`scripts/ui-gate/verify-receipt.ts`, issue #2760; check it yourself first
with `bun run verify:ui-receipt <PR#>`). A row whose padding was reflowed to
single spaces, a hand-summarized row, or a missing banner/coverage line all
fail the same way a deleted row does:

```
RECEIPT — full lane run, 8 surface(s) in scope (5 measured, 3 declared unwalked)
PASS     lobby           1440x900x2   cards n39 zero0 occ1 stranded0 | ctrls … | starved2 | small24 | axe s1/c0
PASS     lobby           390x844x3    …
PASS     lobby           844x390x3    …
PASS     lobby           820x1180x2   …
PASS     lobby           1180x820x2   …
coverage: 5/8 surfaces measured, 3 declared unwalked
console errors: none
screenshots: .claude/telemetry/ui-gate/
```

Paste only a `RECEIPT`-labelled run — a `DIAGNOSTIC` (a `--surface=` subset)
is for your own fast local iteration, never the PR body. The one region you
may shorten is the "known debt carried by the budgets" trailer at the bottom
(pure `budgets.json` prose), and only behind the literal marker
`verify-receipt.ts` defines — never a verdict row, a ceiling, the coverage
line or the banner itself.

For a surface the lane does not walk, the hand-driven equivalent — same five
viewports, same probe:

```
Deck-builder zones, verified in Chrome (CDP):
- 1440x900   → cards n95 zero0 occ0 stranded0, starved0
- 390x844    → cards n95 zero0 occ0 stranded0, starved0
- 844x390    → cards n95 zero0 occ0 stranded0, starved0
- 820x1180   → cards n95 zero0 occ0 stranded0, starved0
- 1180x820   → cards n95 zero0 occ0 stranded0, starved0
console errors: none
```

A change with no browser receipt and no "cannot reach the DOM" note is not
done. Saying "the dom tests pass" is not a receipt — see the measurement at
the top of this page for what that is worth.

## Console errors

`list_console_messages {types:["error"]}` after every state-changing step.
React key warnings and Convex validator errors both surface here and both
predict a broken screen for the next person.

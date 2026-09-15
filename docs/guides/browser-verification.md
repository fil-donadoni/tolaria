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
bun run check:ui                              # the surfaces this diff reaches, all five viewports
bun run check:ui -- --all                     # every surface, whatever the diff
bun run check:ui -- --scope-only              # print the scope, no browser
bun run check:ui -- --surface=lobby           # one surface, same rules (DIAGNOSTIC)
bun run check:ui -- --headed                  # watch it walk
```

**Scope** (issues #3627, #3628; ADR 0131). A run with no `--surface=`/`--all`
walks only the surfaces whose route import closure contains a file this
checkout changed against the base branch (`scripts/lib/ui-scope.ts`). A
stylesheet, a design token, a shared UI primitive, the shell, the router,
`index.html`, `public/**`, the build config, the lane itself, or any path the
scoper cannot place forces the full run. Tests, scripts and markdown reach
nothing, so a diff made only of them walks zero surfaces and says so.

It owns the whole lifecycle: it checks the Convex deployment answers, starts
its **own** Vite on `127.0.0.1` and a free port (your `bun run dev` is left
alone), registers the run's own throwaway account and signs in as it, walks
each surface in `scripts/ui-gate/surfaces.ts` at each of the five viewports,
injects `scripts/ui-gate/probe.js` and `axe-core`, and holds every Floor at
zero (`scripts/ui-gate/floors.ts`). Screenshots land in
`.claude/telemetry/ui-gate/<runId>/` (gitignored; run directories older than a
day are pruned).

**Requirements.** A running **local** Convex backend (`bunx convex dev` — the
lane never starts one, and its account functions refuse any other deployment)
whose functions include `convex/uiGateAccounts.ts`, and the Chromium binary
(`bunx playwright install chromium`; a missing one fails with that exact line).
No credentials: the lane never signs in as the shared dev account.

**The run's account** (issue #3626). Every run owns one:

1. It sweeps lane accounts older than two hours — runs killed with no chance
   to clean up.
2. It registers `ui-gate+<runId>@ui-gate.invalid` with a random password,
   through the same `auth:signIn` sign-up flow the auth form uses.
3. It grants that account admin and tester, and seeds its Limited fixtures
   under `ui-gate/<runId>/…` labels.
4. When the run ends — pass, fail, Ctrl+C or SIGTERM — it destroys the account
   and every row it owns: auth rows, decks, matches and games with their state
   rows, Limited events, verdicts.

So two sessions can run the lane at the same time and never see each other's
games, decks or fixtures, and a game left open on your own dev account has no
effect on a run. `bun run check:ui -- --keep-user` skips the teardown and
prints the account's email and password, so you can sign in as it and look at
what a failed walk left; the next run's sweep collects it.

All of it runs through `bunx convex run` from the **primary checkout**, where
the local deployment's CLI config lives — so the backend must already carry
this module. A worktree whose branch adds or changes those functions has to push them
first. Point the CLI at the local backend by URL and admin key (the key is
`adminKey` in the primary checkout's `.convex/local/default/config.json`); the
push rewrites `.env.local`'s `CONVEX_DEPLOYMENT` line, so restore it after:

```bash
bak=$(mktemp) && cp .env.local "$bak"
CONVEX_DEPLOYMENT= CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
  CONVEX_SELF_HOSTED_ADMIN_KEY=<adminKey> bunx convex dev --once --typecheck disable
cp "$bak" .env.local
```

The backend is shared by every session on the machine, so that push replaces
the functions every other session runs against until the next push — do it
only for a branch whose Convex changes are additive.

The account functions refuse any address outside the lane
pattern, and the role grant, the teardown and the sweep refuse a non-local
deployment.

**What a red means.** Three different things, and the lane never confuses them:

- **FAIL** — a Floor reads above zero: a defect in the tree, named on the line
  with its reading (`broken floor: axeSerious 1`). There is no ceiling to
  raise; fix it, or declare the surface unwalked with an issue.
- **INFRA** — an **Infra Verdict** (issue #3644): the walk was cut short by
  the machine, not by the tree — a backend function past its execution limit,
  a server error, a navigation that never answered — recognised by its
  signature in the console and named on its verdict line by that signature
  (`INFRA … function-timeout`), with the machine load and the reason in the
  diagnostic block (`function-timeout, load 23.4 — …`). The lane retries
  the surface, waiting for the load to drop, before it stands; when it stands
  the surface is unproven, never failed, and never green — `land` refuses the
  receipt. The signatures are `function-timeout`, `server-error`,
  `navigation-timeout`, `step-timeout` and `unsettled`
  (`scripts/ui-gate/infra-verdict.ts`); each cell gets three attempts, and
  before each retry the lane waits up to 90s for the 1-minute load average to
  drop under the CPU count (`TOLARIA_UI_GATE_LOAD_THRESHOLD` overrides it),
  ending and re-dealing its own game first when the surface plays in one. A
  signature that still fails with the load under that threshold is the walk's
  own failure, and is reported as UNWALKED.
- **UNWALKED** — the lane could not measure the surface at all: the
  debug-scenario row is absent from this deployment, an active game blocks the
  route, a walk timed out. This also exits non-zero. Coverage is the thing
  being asserted; "we could not look" is a red, not a shrug. The one exception
  is a surface declared in `UNWALKED_SURFACES` (`scripts/ui-gate/floors.ts`),
  in code, with its reason and an open issue — it gets no line, is named with
  its issue on the coverage line, and is the entry that issue deletes.

**Settled Screen** (issue #3644). The state a Walked Surface must reach before
anything on it is measured: its own ready marker is up (the component says its
data has arrived), and for a short quiet window nothing animates, nothing is in
flight to the backend, and no measured box has moved. A screen that never
settles is an Infra Verdict (`unsettled`), not a reading; a reading taken
before settling is what a flap is. Concretely (`scripts/ui-gate/settle.ts`):
the marker is `[data-surface-ready]`, rendered by
`src/components/ui/surface-ready-marker.tsx` in each walked route's loaded
branch (`ui-gate-surface-ready.test.ts` reds on a route without it); the quiet
window is 300ms within a 30s bound; infinite animations (spinners, pulses) do
not count; and "in flight" is read off the Convex sync socket itself — every
`Mutation`/`Action` until its response, every query-set change until a
`Transition` reaches it — because the socket never goes idle, so
`networkidle` never fires. No fixed sleep is left in
`scripts/ui-gate/surfaces.ts`. Before walking, the lane proves the predicate in
its own Chromium against fixture pages (`settle-selfcheck.ts`); a predicate that
returns early is a fatal error. The diagnostic block prints the machine load at
the start and end of the run.

**Floors, not ceilings** (ADR 0132, issue #3648). The lane gates nine counts,
all at zero, on every walked surface and viewport, with no per-surface
exception — constants in `scripts/ui-gate/floors.ts`, so there is nothing to
record and no budget file:

- `cardsZero`, `cardsStranded`, `ctrlsZero`, `ctrlsStranded` — a collapsed or
  unreachable card tile or control (see [Reading the output](#reading-the-output));
- `cardsSquare` — a card showing page background in its corner (issue #2724);
- `cardsSoft` — a printed card face sharper in the slot than its resolved
  rendition (issue #3553); a face whose rendition the probe does not know
  (`cardsSoftUnknown`) counts too, because a face it cannot measure is one it
  cannot prove sharp;
- `axeSerious`, `axeCritical` — axe-core violations at those impacts;
- `hOverflow` — the page scrolls sideways.

Four **Shape Readings** — `cardsOcc`, `ctrlsOcc`, `small`, `starved` —
describe the screen as designed (a fanned hand overlaps, a sheet covers the
board under `lg`, a scroll port is shorter than its list), so their value moves
with the position on the screen. They are printed in the diagnostic block of
every receipt and compared against nothing.

`small` (issue #2658) is also deliberately **pointer-blind**: the probe counts
every visible interactive control under 44px on its smaller dimension at EVERY
viewport, but `--control-h` is 32px under `pointer: fine` by design
(`src/index.css:942,946-948` — the comment cites WCAG 2.5.8, a touch-target
rule). A nonzero `small` on the desktop viewport (`1440x900x2`) usually just
reflects that intentional 32px control height, while the same count on a
`…x3,mobile,touch…` viewport is a real sub-target control.

**The one axe exemption is an attribute, not a number** (issue #2593).
`/admin/design-system` documents what a failing token looks like, so its
specimens carry `data-axe-exempt="<why>"` on the smallest element containing
them. The lane excludes those subtrees from axe and prints `exempt<n>` on the
surface's progress line of every run; `axe-exemption-scope.test.ts` fails when
the attribute appears outside `src/routes/design-system/`.

**What it is not.** It is not part of `check:all`: the full gate is offline by
contract and mutex-held, and booting a browser inside it would tax every
session that never touches the DOM. It is a standalone command a UI diff runs,
and its output is the receipt.

**Non-destructive by construction.** The lane resumes a pre-existing match
read-only and never concedes one it did not create, and it only loads a debug
scenario into a game it created itself. On a fresh per-run account the only
game that can exist is one this run dealt, so an active game making a board
surface UNWALKED now points at the run itself, never at another session.

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
[role=tab],[role=option]` whose smaller dimension is under 44px. A Shape
  Reading, and **pointer-blind** (see above): read a desktop-viewport count against the
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
lane runs alongside the probe (`axeSerious` / `axeCritical` are Floors).

## What goes in the PR

The `check:ui` receipt — paste it **byte-exact**, from the banner to the end.
It has two blocks (ADR 0132 §6):

- the **verdict block** — the `RECEIPT`/`SCOPED`/`DIAGNOSTIC` banner, one line
  per surface × viewport saying `PASS|FAIL|INFRA|UNWALKED` (with any broken
  Floor and its reading), and the coverage line. It is a function of the tree
  and the scope, so two runs of one tree print it byte-identical;
- then a fixed separator and the **diagnostic block** — every cell's Shape
  Readings, the infra signatures with their load and reason, the machine load,
  console errors, screenshots and wall time.

This is not a style preference — `bun run land` re-derives the verdict block
from the PR's own diff (the all-`PASS` block of that scope, rendered by the
real evaluator) and refuses to merge a `skin`-lane PR whose paste differs from
it or carries any line that is not `PASS`
(`scripts/ui-gate/verify-receipt.ts`, issues #2760 and #3648; check it yourself
first with `bun run verify:ui-receipt <PR#>`). A line whose padding was
reflowed to single spaces, a missing cell, a reordered line or a missing
banner/coverage line all fail. It never reads the diagnostic block, so a
receipt whose readings or wall time differ from a re-run lands the same:

```
RECEIPT — full lane run, 20 surface(s) in scope (17 measured, 3 declared unwalked)
PASS     auth-sign-in         1440x900x2   every floor at zero
PASS     auth-sign-in         390x844x3    every floor at zero
…
PASS     admin-verdicts       1180x820x2   every floor at zero
coverage: 17/20 surfaces measured, 3 declared unwalked: game-board (issue #3695), game-card-preview (issue #3506), game-stress (issue #3506)
─── diagnostic — shape readings, load, infra, wall time; never read by land ───
shape    auth-sign-in         1440x900x2   cardsOcc 0 ctrlsOcc 0 small 2 starved 0
…
machine load: start 3.2, end 4.1 (1-minute average, 12 cpus, retry threshold 12)
shell return band: absent on every walk — no controls excluded
console errors: none
screenshots: .claude/telemetry/ui-gate/3f9c0a1b2d4e/
wall time: 412s
```

A run the diff scoped prints `SCOPED` instead, naming the base and every surface
walked:

```
SCOPED — diff base origin/staging, 1 surface(s) in scope: deck-detail (1 measured, 0 declared unwalked)
```

`land` re-derives the scope from the PR's own diff with the same function and
re-renders that banner from it: a `SCOPED` receipt missing a surface the diff
reaches, listing one it does not, taken against another base, or pasted on a
diff that forces the full run is refused. Take it on the final diff — a commit
that widens the scope after the run makes the receipt stale. A full `RECEIPT`
satisfies any diff. A `DIAGNOSTIC` (a hand-picked `--surface=` subset) is for
your own fast local iteration, never the PR body.

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

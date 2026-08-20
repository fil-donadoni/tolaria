---
title: The Peek Panel rail occludes event-toolbar controls that sit outside the reserved container
discoveredBy: 2583
status: draft
confidence: high
---

**What is wrong.** The Peek Panel's `rail` layout is `fixed inset-y-0 right-0`
at `PEEK_PANEL_RAIL_WIDTH` (224px). `LimitedDraftTable` reserves that width via
`peekPanelReserve(layout)`, which fixed the round-1 review blocker for the
Booster grid and the Pool. But the reserve is applied to the draft table's own
container, and the Draft Room renders controls ABOVE and BELOW it, inside
`LimitedEventDetail`, which reserves nothing. Those controls are occluded on the
X axis, and X is not a scroll axis here — unlike the phone-portrait `sheet`,
where covered cards come back by scrolling, there is no gesture that recovers
them. The user has to dismiss the panel to reach them.

**Evidence.** Measured with the lane's own `scripts/ui-gate/probe.js` on
`feat/issue-2583` rebased on `origin/main`, in a real Draft Room seat holding a
live 15-card pack, with the Peek Panel open:

| viewport   | layout | cards occ | ctrls occ | occluded controls                          |
| ---------- | ------ | --------- | --------- | ------------------------------------------ |
| 1440x900x2 | rail   | 0         | 3         | Close Event, Copy event link, Report a bug |
| 844x390x3  | rail   | 0         | 3         | Close Event, Test Fil / Sign out           |
| 820x1180x2 | rail   | 0         | 4         | Close Event, nav items, Report a bug       |
| 1180x820x2 | rail   | 0         | 3         | Close Event, Report a bug                  |
| 390x844x3  | sheet  | 3         | 3         | (scroll-recoverable, see below)            |

`cards occ = 0` at every rail viewport — the AC's literal scope (Booster grid,
Pool) is genuinely fixed. The 3 occluded cards at `390x844x3` are the pack's
last row under the bottom sheet at scroll-top; scrolling `main.overflow-y-auto`
(`scrollHeight 1194` vs `clientHeight 644`) clears them, and
`PEEK_PANEL_SHEET_RESERVE` (144px) already exceeds the sheet's rendered height
(127px). That one is ordinary bottom-sheet behaviour, not this finding.

One of the occluded controls is deliberate and should stay excluded from any
fix: the floating **Report a bug** button paints below an open sheet/rail on
purpose (`--z-dev-overlay: 45` < `--z-sheet: 50`, `src/index.css`), documented
in `src/components/dev/bug-report-button.tsx` so it cannot steal a tap meant for
the panel.

**Why it may not deserve its own issue.** Three reasons to fold it into a later
slice instead. (1) The Draft Room is the only surface that mounts the Peek Panel
today (`~/lib/gesture` has exactly two production importers, pinned by a
closed-set sweep in this PR), so the blast radius is one screen. (2) Dismissing
the panel is a single tap on a 44px control, so nothing is trapped — this is a
degraded affordance, not a dead end. (3) The real fix is a decision about WHERE
the reserve belongs: hoisting `peekPanelReserve` from `LimitedDraftTable` up to
`LimitedEventDetail` would cover the toolbar but is a layout change to a
component this slice deliberately did not touch, and slices 5+ adopt the panel
on other editing surfaces anyway — each of which will face the same question.
Answering it once, there, is likely cheaper than patching the Draft Room now.

Against that: `Close Event` is the affordance that ends the session, and having
it silently covered is the kind of thing a user reports as "the button is gone"
rather than "the panel is in the way".

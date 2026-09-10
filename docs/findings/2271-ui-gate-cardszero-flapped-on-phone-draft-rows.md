---
title: check:ui reports a flapping `cardsZero 1` on a phone-width draft row, on whichever draft surface the run catches
discoveredBy: 2271
status: draft
confidence: medium
---

**What is wrong.** On the two phone viewports (`390x844x3`, `844x390x3`) one
card element in the Draft Room measures under `probe.js`'s 4px floor and lands
in `cardsZero`, intermittently. The budget for every one of those rows is
`cardsZero 0`, so the run reds. It is not deterministic and it is not pinned to
a surface: consecutive runs of the SAME tree move it between `draft-pick` and
`draft-pool-peek`.

**Evidence.** Four full-lane runs on 2026-09-10, same machine, same seeded
fixture (`ui-gate/draft`), same re-seeded deployment:

| Tree                                                    | Row that read `cardsZero 1`                   | Peek phone rows |
| ------------------------------------------------------- | --------------------------------------------- | --------------- |
| `fix/issue-2271`                                        | `draft-pick @ 390x844x3`                      | both PASS       |
| `fix/issue-2271`                                        | `draft-pool-peek @ 390x844x3` + `@ 844x390x3` | —               |
| `fix/issue-2271` (repeat)                               | `draft-pool-peek @ 390x844x3` + `@ 844x390x3` | —               |
| `origin/staging`, checked out over `src/` and `convex/` | `draft-pick @ 390x844x3`                      | both PASS       |

The last row is the attribution: the untouched base tree reproduces it, so no
`src/` diff owns it. The count is always exactly ONE element, and `cardsOcc`,
`cardsStranded` and the control family never move with it — consistent with a
single card measured before it has a box (an image that has not laid out yet)
rather than a layout defect, but WHICH element was never captured: `probe.js`
reports the aggregate, and nothing dumps the offending node.

**Why it may not deserve its own issue.** It may be one `await` in
`surfaces.ts`'s phone walk — the same class as the settle the walk already does
elsewhere — in which case it is a line on the lane's own stability work rather
than a ticket. It is also invisible except at phone width on two of eighteen
surfaces, and it never fires at the three larger viewports. Against that: a
row that reds at random is exactly the "lane people learn to re-run is a lane
they route around" failure `game-board`'s withdrawal note argues (#2512), and
recording a ceiling for it would be the wrong fix — a flapping ceiling hides
the next real regression on that row. Whoever picks it up should make
`probe.js` NAME the zero-box element first; the diagnosis is cheap once the
node is known, and guessing at the settle without it is how a flake gets
"fixed" twice.

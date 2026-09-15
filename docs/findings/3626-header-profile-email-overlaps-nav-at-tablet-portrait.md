---
title: A long account email widens the header profile block over the nav at 820px, occluding a control on every signed-in surface
discoveredBy: 3626
status: draft
confidence: high
---

**What is wrong.** The header's profile block puts the nickname and the email
in an unbounded column, and nothing in that block may shrink. At 820x1180 a
36-character address (`ui-gate+<runId>@ui-gate.invalid`) pushes the avatar
leftwards over the primary nav: the avatar circle covers `LIMITED`. `probe.js`
counts that as one occluded control on every signed-in surface at that viewport.

**Evidence.**

- `src/components/chrome/app-header-profile.tsx:119`: the nickname/email
  column is `flex flex-col leading-tight`, with no `min-w-0` or `max-w-*`.
- `:136`: the email `<span>` has no `truncate`. It is hidden only under
  `short-viewport:`, which does not apply to a tall 820x1180 viewport.
- Issue #3626's four `check:ui` runs on per-run lane accounts all read
  `ctrlsOcc 1` at `820x1180x2` on the same surfaces: `lobby`, `deck-detail`,
  `design-system`, `limited-list`, `limited-your-events` and
  `limited-antechamber`. The budgets recorded on the shared dev account, which
  has a short address, hold `0`.
- The screenshot is under the run's directory:
  `.claude/telemetry/ui-gate/<runId>/lobby__820x1180x2.png`.

**Why it may not deserve its own issue.** Only accounts with long addresses
reach it, and a real user's address is usually shorter than the lane's. The fix
is small, though: truncate the email, or hide it below `lg`. It is a genuine
layout defect that the short dev address hid, and the per-run account now makes
it measurable on every run. That argues for a ticket rather than a standing
`knownDebt` note on six budget rows.

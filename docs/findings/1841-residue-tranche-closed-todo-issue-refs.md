---
title: Six residue-tranche `TODO(issue #NNN)` numbers named on stub-context markers are CLOSED, but stay permanently invisible to markers:lint by design
discoveredBy: 1841
status: draft
confidence: medium
---

**What is wrong.** Closing #1841's stub-context liveness blind spot required
choosing which of the two live-ref syntaxes to admit inside a commented-out
stub's comment run: `tracked-by: #NNN` (colon) now is, `TODO(issue #NNN`
stays excluded — see `scanRepoMarkers`'s updated doc comment in
`scripts/check-marker-liveness.ts`. The reason for the split is real
(admitting `TODO(issue` wholesale would drag six unrelated closed-issue
"residue tranche" numbers into `markers:lint`'s verdict, which was explicitly
scoped OUT when that syntax was added), but the split also means those six
numbers are now **permanently** excluded from every automated liveness
check, not just this one — `check-stub-coverage.ts` only checks PRESENCE of
a disposition, never whether it is still open.

**Evidence.** Measured directly against HEAD of this branch (`gh issue view
<n> --json state`): every `TODO(issue #NNN` stub-context site in
`convex/cards/sets/**` names one of `#676`, `#679`, `#684`, `#1303`, `#1305`,
`#1307` — all six **CLOSED**. Representative sites: `akh/red.ts:6` (#676,
Exert), `fin/green.ts:6` (#679, mill), `dsc/green.ts:6` (#684, Ursine
Monstrosity), `c13/white.ts:3` (#1303, Unexpectedly Absent), `mh1/red.ts:3`
(#1305, Vintage Cube residue tranche), `shm/green.ts:6` (#1307, residue
re-audit). 26 of the 29 sites using this syntax repo-wide sit in stub
context and are therefore excluded by design from both this PR's fix and the
sweep that predates it.

**Why it may not deserve its own issue (yet).** These are almost certainly
the SAME shape #1841's own prior audit passes (#2753, #2767) already worked
through for `tracked-by:`-syntax markers — a stub whose original discovery
issue closed as superseded/re-triaged into a successor bucket, where the
successor (not the closed number) is the live tracker. `check-stub-coverage.ts`
already enforces that every one of these 26 stubs carries SOME disposition
(it does — that guard is green); what's missing is only the "is it still the
RIGHT disposition" pass, which is exactly `/audit-tracker`'s job, not a new
guard. A human should decide whether this is six individual re-audits, one
batched `/audit-tracker`-style pass over the residue-tranche buckets, or
deliberately left alone (unlike a shipped/active card, an inert commented-out
stub pointing at a stale discovery issue costs nothing at runtime — it is a
documentation staleness, not a behavioral gap).

---
title: count_total_open failures are silently absorbed, unlike count_unclaimed's
discoveredBy: 2626
status: draft
confidence: medium
---

**What is wrong.** `count_unclaimed`'s result (`queue_before`) is validated
with `is_uint` right after the read — a failed `gh` call (`queue_before=""`)
stops the driver with `reason=gh-error` (`scripts/loop-drain.sh:378-382`).
`count_total_open`'s result (`total_before`/`total_after`) has no equivalent
check (`scripts/loop-drain.sh:424`, `:498`): a failed read just becomes `""`
and the driver carries on.

Two empty strings compare equal in `sh` (`[ "" = "" ]`), so a `gh` call that
keeps failing for `count_total_open` across passes lands in the
`total_after = total_before` branch every time — the SAME branch this issue's
`claims-held`/`no-progress` split lives in. The new code (`is_uint` guards on
`claims_before`/`claims_after`, `scripts/loop-drain.sh:534-580`) fails closed
in that case — it never misreports `claims-held`, it just falls through to
the ordinary `no_progress_streak` — so nothing shipped in #2626 is unsound.
But the underlying signal is wrong either way: a broken `gh issue list
--search '...label:ready-for-agent'` (no `-label:in-progress`) call reads
identically to "nothing changed", accumulating a `no-progress` streak that is
actually a `gh-error` in disguise, same shape as the bug #2519 round 3 finding
5 fixed for the unclaimed count.

**Evidence.** `scripts/loop-drain.sh:378-382` (`is_uint` check + `gh-error`
stop, for `queue_before` only) vs. `scripts/loop-drain.sh:424`/`:498`
(`total_before`/`total_after`, no check at all).

**Why it may not deserve its own issue.** `count_total_open` and
`count_unclaimed` are two separate `gh issue list --search` calls made
seconds apart against the same API — if one is failing (rate limit, auth),
the other very likely is too, and `queue_before`'s existing check already
catches that shared failure mode before a pass even runs. The gap is
narrower than it looks: a `gh` failure that hits `count_total_open`
specifically while `count_unclaimed` keeps succeeding is a fairly exotic
partial-outage shape. Worth a ticket only if this pattern is ever actually
observed in `loop-drain.log` (a `no-progress` streak with no `pass_log`
evidence of the driver doing anything, per the existing "check the pass log
size first" doc guidance in `docs/guides/afk-loop.md`).

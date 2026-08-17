---
title: performPhaseEntry's UNTAP/UPKEEP duration-tick comments cite rules about something else
discoveredBy: 2445
status: draft
confidence: high
---

**What is wrong.** `performPhaseEntry`'s `UNTAP` and `UPKEEP` cases each cite a
CR rule as the source of the "expires as this step begins" duration-tick
behaviour, but neither printed rule says that.

**Evidence.** `convex/gre/phases.ts:1898-1907` (UNTAP) cites CR 502.1:

```
$ bun scripts/cr.ts "502.1"
502.1. First, all phased-in permanents with phasing that the active player
controls phase out, and all phased-out permanents that the active player
controlled when they phased out phase in. This all happens simultaneously.
This turn-based action doesn't use the stack. See rule 702.26, "Phasing."
```

That is the PHASING turn-based action itself (phasing is defined at CR
702.26), unrelated to duration expiry.
`convex/gre/phases.ts:1908-1917` (UPKEEP) cites CR 500.2:

```
$ bun scripts/cr.ts "500.2"
500.2. A phase or step in which players receive priority ends when the stack
is empty and all players pass in succession. ...
```

That is about when a priority-bearing step/phase ENDS, not about the upkeep
step BEGINNING. Both citations predate this issue (#2445) — I only touched
these two comment blocks to prepend the now-correct CR 500.4 ("as a step or
phase begins ... those effects expire"), and left the pre-existing 502.1 /
500.2 references in place rather than guessing a replacement without
independently researching what they were meant to reference (Orcish Farmer /
Xenic Poltergeist-style "until next untap step" / "until next upkeep"
expiry). CR 500.4 turns out to be the whole answer — it alone covers
begin-of-step duration expiry — so the correct fix is simply dropping the
502.1 / 500.2 trailers rather than replacing them with another id.

**Why it may not deserve its own issue.** It is a comment-only citation bug
(the CODE behaviour — ticking at phase entry — is correct; only the cited
rule number is wrong), on two lines that DO carry a `CR ` prefix and DID pass
`cr:lint`/`check-cr-citations.ts`, because both cited ids (502.1, 500.2)
resolve to _something_ — this is the "resolvable but wrong" gap the CLAUDE.md
notes is unclosed outside the 701/702 keyword-title check. Low blast radius
(doesn't affect behaviour), but is exactly the kind of citation rot the
#2429/cr-keyword-citations effort is trying to eventually close for
non-keyword sections too.

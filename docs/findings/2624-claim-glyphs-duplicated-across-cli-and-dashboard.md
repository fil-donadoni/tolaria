---
title: The claim live/orphan/suspect glyph mapping is still hand-duplicated across TS and the dashboard's inline JS
discoveredBy: 2624
status: draft
confidence: medium
---

**What is wrong.** #2624 removed one of the two hand-authored formatters of the
same facts — the loop's health statement now comes from `deriveLoopVerdict` and
both surfaces render its strings. The sibling duplication it did NOT touch is
the per-claim mark: the same `ClaimVerdict["state"]` union is mapped to the same
three glyphs twice, in two languages, with no shared constant. A fourth verdict
state (or a change of glyph) has to be made in two places, and nothing fails if
only one is.

**Evidence.** `scripts/lib/loop-status.ts:763` (`verdictMark`) returns
`"×" / "?" / "·"` for `orphan / suspect / live`;
`scripts/telemetry-dashboard.html:1243-1250` re-derives the identical mapping in
inline JS (`verdictState === "orphan" ? … "×" : … "?" : "·"`), and
`scripts/loop-doctor.ts:287-289` writes it a THIRD time for its own CLI tail.
The verdict-band guard added in this PR
(`scripts/__tests__/loop-status-dashboard.test.ts`) checks the verdict tone map
against `LOOP_VERDICT_STATES`; nothing equivalent covers the glyphs.

**Why it may not deserve its own issue.** PRD #2621 already replaces `×` / `?`
with the WORDS `orphaned` / `unsure` (user story 15) and reworks the claims table
wholesale, so the duplication may be deleted rather than fixed by work already
queued. If that ticket lands as specified, this is a line on it, not a ticket.

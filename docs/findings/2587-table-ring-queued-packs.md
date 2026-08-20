---
title: The Table Ring cannot show queued packs per seat — the projection strips them
discoveredBy: 2587
status: draft
confidence: medium
---

**What is wrong.** ADR 0101 §6 and issue #2587's acceptance criteria both ask the
Table Ring for "queued packs per seat". Only the VIEWER's own seat carries that
number on the wire, so the shipped dialog renders `N queued` for the viewer and
`· · ·` for everyone else, falling back to each seat's public pick count
(`poolCount`) as the "who is holding the table up" signal.

**Evidence.** `convex/limited/eventProjection.ts:555` —
`packQueueCount: isViewer ? (seat.packQueue?.length ?? 0) : null` — and the
field's own doc comment at `:151` ("viewer's own seat only"). The boundary is
deliberate and guarded:
`convex/limited/__tests__/eventProjection.test.ts:199` asserts "strips every
OTHER seat's currentPack contents and packQueueCount", and `:209` re-asserts it
for a Sealed event. Widening it would mean inverting a shipped privacy
assertion, which is a product decision, not a UI slice's call — so #2587 left it
alone and documented the gap in `src/components/limited/limited-table-ring.tsx`.

**Why it might be right as it stands.** PRD #1107 story 15 hides a seat's picks
during a draft; a queue depth is pace, not cards, but it is one inference away
from "that seat is three picks behind", and the projection's author chose to
keep the whole `packQueue` shape private rather than draw that line. Arena shows
the count, and `poolCount` (already public for every seat) leaks the same pace
information more directly — so the current boundary may simply be inconsistent
rather than protective.

**What an issue would have to decide.** Whether `packQueueCount` becomes public
for every seat (count only, never contents). If yes it is a small change with a
wide blast radius: the projection, `convex/limitedEvents.ts:345`'s returns
validator, the two projection assertions above, and the dialog's fallback.

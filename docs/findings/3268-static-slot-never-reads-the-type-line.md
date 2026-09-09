---
title: The static slot never consults ParseContext.typeLine, so nothing structurally stops an instant compiling a board static
discoveredBy: 3268
status: draft
confidence: medium
---

**What is wrong.** A static ability is "simply true while its source is on the
battlefield" (CR 604.1), so the static slot only makes sense for a PERMANENT.
Nothing enforces that. `staticSlot` (`convex/oracle/grammar/slots/staticSlot.ts`)
and every frame in `grammar/shared/staticClause.ts` read the sentence alone;
`ParseContext.typeLine` is available and unread. An instant or sorcery whose
text happens to match a frame compiles a `compiledStaticEffects[]` entry that
the engine would evaluate for as long as the card sat on the battlefield —
which it never does, so the effect is simply inert on a card that reads
`ready`.

**Evidence.** The corpus has the live example: Borne Upon a Wind (Instant)
prints "You may cast spells this turn as though they had flash." and Complete
the Circuit (Instant) prints "You may cast sorcery spells this turn as though
they had flash." Both are one duration tail away from the `cast-permission`
frame added in issue #3268. That frame refuses the tail BY NAME
(`a DURATION-scoped permission is not a board static (CR 604.1)`), which
closes these two — but the refusal is per-frame prose, not a slot-level
invariant, so the next frame added inherits nothing.

**Why it may not deserve its own issue.** The cheap fix is one line in
`staticSlot` (refuse when `ctx.typeLine.types` contains no permanent type),
and it is not obviously free: `PERMANENT_TYPES` is already imported by the
descriptor grammar, but a card with a permanent type AND an instant type does
not exist, so the check has no test population beyond the two cards above. It
may be a line on the PRD #2693 grammar-hardening list rather than a ticket.

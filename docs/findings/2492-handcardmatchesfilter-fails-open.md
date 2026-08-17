---
title: handCardMatchesFilter silently admits everything for four printed-characteristic EffectCardFilter fields
discoveredBy: 2492
status: draft
confidence: medium
---

**What is wrong.** `handCardMatchesFilter` implements 9 of `EffectCardFilter`'s
~17 fields (`name`, `type`, `excludeType`, `subtype`, `supertype`, `color`,
`manaValueAtMost`, `manaCostEquals`, `any`). Four of the unhandled ones are
printed-characteristic filters that are perfectly meaningful for a card in hand
or for a declared card name — `excludeSupertype`, `excludeColor`,
`manaValueEquals`, `hasAbility` — and each falls through to `return true`. A
filter declaring only one of those is therefore inert: it admits every card
rather than restricting anything. That is a fail-OPEN default in a matcher whose
callers all treat it as a legality gate.

**Evidence.** `convex/gre/alternativeCost.ts:131` is the matcher. Its three
callers each read it as authoritative: the alternative-cost hand leg
(`alternativeCost.ts`), the `discardFilter` leg, and — new in #2492 — the
as-enters `name` kind's filter check at
`convex/gre/pendingChoiceSubmit.ts:427`. No caller inspects which fields the
matcher understood, so a card author who writes
`filter: { excludeSupertype: "Basic" }` gets a silently permissive gate with no
type error, no test failure and no runtime signal.

**Why it may not deserve its own issue.** Nothing in the shipped catalogue
declares one of the four fields on a filter that reaches this matcher, so the
fail-open is latent rather than live, and the natural moment to fix it is when a
card first needs one of the fields — #2467 (the first filtered as-enters `name`
card, Meddling Mage's "nonland card name") is already open and would touch this
code. Widening the matcher speculatively also risks changing the behaviour of
the two existing callers, which is a strictly larger change than the one the
first real card would need. Counter-argument for a ticket of its own: the
failure mode is silence, and the guard shape (a fail-closed default plus an
explicit "understood fields" list) is the same fix regardless of which card
surfaces it — the `EffectCardFilter` fail-open class is already noted in the
user's memory as a standing hazard.

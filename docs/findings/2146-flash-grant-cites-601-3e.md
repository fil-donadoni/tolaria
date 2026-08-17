---
title: The player-scoped flash grant (Teferi's +1) is documented as CR 601.3e everywhere, and 601.3e is a different rule
discoveredBy: 2146
status: draft
confidence: medium
---

**What is wrong.** Every site describing `castTimingFlashGrants` — the per-player
"you may cast spells as though they had flash" permission Teferi, Time Raveler's
+1 hands out — cites **CR 601.3e**. Printed (`bun run cr 601.3e`), that rule says:

> Some rules and effects state that an alternative set of characteristics or a
> subset of characteristics are considered to determine if a card or copy of a
> card is legal to cast.

which is the Garruk's-Horde / morph / Adventure rule, not an "as though it had
flash" grant. The rules that actually govern a flash grant are **CR 609.4** (the
generic "as though" clause) plus **CR 307.1** for the window it widens; CR 601.3b
covers only the narrower "spell with certain qualities" proposal case. This is a
**resolvable-but-wrong** citation, which is exactly the class `bun run cr:lint`
cannot see: its second scan checks section TITLES only for `CR 701.N` / `702.N`.

**Evidence.**

- `convex/cards/castRestrictions.ts:100` — the `castTimingFlashGrants` field doc:
  `/** CR 601.3e (Teferi, Time Raveler +1) — per-player "cast spells of these types as though they had flash" grants.`
- `convex/cards/castRestrictions.ts:147` — `hasCastTimingFlashGrant`'s doc opens
  "CR 601.3e — true when casterId holds a castTimingFlashGrant covering spell".
- `convex/cards/mechanicsRegistry.ts` — the `grantCastTiming` Op row carries
  `cr: "601.3e"` and repeats the citation in its `note`.
- `convex/gre/__tests__/castTiming.test.ts:119` — the test name
  `"a live flash grant (CR 601.3e) — and only a live one …"`.
- `convex/gre/rules.ts` (`getLegalActions`) and `convex/gre/state.ts` carry the
  same number in several nearby comments, some of them about the genuinely
  different cast-from-exile/graveyard case where 601.3e IS right — which is
  probably how the number spread.

Same file, `convex/gre/rules.ts`'s `castTimingBaseLegal`, opens its doc with
`CR 601.3a / 307.1`; 601.3a is the "effect prohibits casting a spell with certain
qualities" rule, so the header of the shared timing authority looks wrong in the
same way.

**Why it may not deserve its own issue.** Nothing behaves incorrectly — this is a
comment/registry-metadata defect only, and #2429 already ran one repo-wide
citation-correction pass, so a second may be better batched than ticketed. Against
that: the `mechanicsRegistry` row is the closest thing the project has to a
specification of the mechanic, `cr:lint` structurally cannot catch this shape, and
issue #2146 (this work) had to reason about exactly which CR clause governs the
tiers of `castTimingBaseLegal` — a wrong number there costs a future reader real
time. Deliberately not "corrected" in #2146's diff: touching six unrelated files
to renumber a citation is scope the issue did not ask for, and a
plausible-but-still-wrong replacement passes every check.

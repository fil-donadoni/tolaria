# A cast permission's id is derived from its CLAUSE, not from the card that prints it

## Status

accepted (issue #3268, under PRD #2693; the engine it constrains is issue
#2706)

## Context

Issue #2706 shipped `StaticCastPermission` — a board permanent licensing a
CLASS of spells on terms the sentence states (CR 601.3 "a rule or effect
allows that player to cast it", CR 118.9 for the free half). Aluren is the
card it was built for; Vedalken Orrery, Quick Sliver, Dracogenesis and a
couple of dozen others print the same shape.

The static carries an `id`, and until now that id followed the convention
every other static id in the catalogue follows: `<card>-<what>`,
hand-written — `aluren-creature-permission`. That convention is right for
every other static, because every other static id is a PRIVATE HANDLE. Nothing
outside the card reads it; it exists so a human can name the effect.

This one is read from outside, twice:

- **`collectCastPermissions` deduplicates on the bare `effect.id`** across
  every permanent on BOTH battlefields (`convex/gre/castPermissions.ts`). Two
  Alurens must grant one permission, not two cast options — CR 118.9a lets a
  caster announce one alternative cost anyway.
- **The id travels on the wire** as `cast-permission:<id>`, the
  `alternativeCostId` the cast mutation resolves (`convex/game.ts`).

So the id is not a handle for the card. It is the IDENTITY OF THE OFFERED CAST
OPTION. Three cards print "You may cast creature spells as though they had
flash."; two print "You may cast spells as though they had flash." Under a
card-scoped id the picker shows the same option two or three times and the Bot
enumerates two or three identical branches — a defect the hand-written
catalogue never reached only because exactly one card declared the kind.

Issue #3268 is where it stops being theoretical: the Oracle compiler learned
to read the sentence, and eleven compiled cards declare the kind at once. The
compiler has no card-scoped name to invent from — nothing in the sentence
names the card — which is the reason the grammar rule was deferred when the
engine landed rather than written beside it.

## Decision

**A `cast-permission` id is a pure function of the permission's own clause.**

    <grantee>-<primary class>-<fnv1a32 digest of the canonicalised clause>

e.g. `any-player-creature-f9f346f4` (Aluren),
`controller-spell-a7736ca4` (Vedalken Orrery **and** High Fae Trickster — one
id, because one sentence). The derivation is
`convex/oracle/castPermissionId.ts`, and it is the only implementation.

Four things follow, and each is a decision rather than a detail:

**1. A digest over the WHOLE clause, not a readable slug.** A slug builder has
to enumerate the fields it renders. The day `EffectCardFilter` grows one the
builder forgets, two different permissions share an id — and under a dedupe
keyed on that id the consequence is not an error but the SILENT SUPPRESSION of
the second permission. That is the `EffectCardFilter`-fails-open shape, in the
one place where failing open makes an illegal cast legal and free. A digest
over everything cannot forget a field: a new field changes the digest by
itself. The prefix in front of it is cosmetic and cannot collide.

**2. Canonicalised with the gold harness's own canonicalisers.** `sortKeys`
for key order, `canonicaliseShorthands` for the "single X is shorthand for one
X" fields (`convex/oracle/gates.ts`, moved there from `gold.ts` so the
comparator and the derivation cannot drift apart). Without the second, a
hand-written `type: "Creature"` and the compiler's `type: ["Creature"]` are
the same filter with two ids — the split identity this ADR exists to prevent,
arriving through a spelling difference instead of a forgotten field.

The shorthand list was widened in the same change to cover `EffectCardFilter`'s
other singular members — `subtype`, `color`, `excludeType`, `excludeColor` —
because covering only `type` closes the class for Aluren and leaves it open
for the next card: a hand-written `subtype: "Dragon"` beside the compiler's
`subtype: ["Dragon"]` is exactly the same defect one field over. Each of the
four is documented as a shorthand in `cards/types.ts`, and taking them was
measured to be a no-op on the catalogue (unchanged catalogue hash, unchanged
gold and round-trip verdicts, identical `oracle:triage` buckets) — which is
what a canonicalisation of an already-declared equivalence should be.

**3. A card still writes a LITERAL; a guard asserts the derivation.** Cards
are DATA (ADR 0045). A definition calling the derivation would make the
compiler round trip a tautology: both sides computing the same value proves
nothing about whether the compiler READ the sentence.
`cards/__tests__/castPermissionIds.test.ts` asserts, catalogue-wide,
`effect.id === derive(clause)` — and, separately, that two permissions sharing
an id have equal clauses. That second assertion REPLACES the bare-uniqueness
check the guard used to make, which a content-derived id makes false by
construction.

**4. The round trip compares the id.** ADR 0114 §4 — "the comparator never
folds a field the engine reads" — and the engine reads this one twice (the
dedupe, the `alternativeCostId`). Excluding it from `behaviouralProjection`
was considered and refused. Aluren adopts the derived literal instead.

## Consequences

- Two cards printing one sentence collapse to one cast option, in the picker
  and in the Bot's enumeration, with no per-card coordination.
- A permission's id CHANGES if its clause changes — including its
  `oracleText`, which is part of the clause because it is the label the caster
  reads on the option. A card whose Oracle text is errata'd gets a new id.
  That is correct (it is a different offered option) and it is not a
  persistence hazard: nothing stores an `alternativeCostId` across a save —
  it is announced and consumed inside one mutation.
- The id is opaque. A log line reading `cast-permission:controller-spell-…`
  no longer names the card, which is the point; the prefix is what keeps it
  legible.
- This kind is the DELIBERATE EXCEPTION to the `<card>-<what>` convention. Any
  future static whose id is read across cards belongs here too; the test is
  whether anything outside the card compares two of them, not how the id
  looks.

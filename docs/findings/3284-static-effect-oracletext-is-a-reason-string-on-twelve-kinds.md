---
title: Twelve StaticEffect kinds call a UI reason string `oracleText`, and 43 of the 95 shipped fields are not printed text
discoveredBy: 3284
status: draft
confidence: high
---

**What is wrong.** Issue #3284 repaired ONE instance of "a field named after card
data is edited as if it were UI copy": `StaticCastPermission.oracleText` was
shortened to `"Cast with Aluren"` for the picker, which staled the content-hashed
catalogue artifact and broke a wiring test. The class guard it shipped
(`convex/gre/__tests__/castPermissions.test.ts`) is scoped to `cast-permission`
and cannot be widened, because on twelve SIBLING kinds the same field is a reason
string BY CONVENTION.

Counted over the catalogue — permission's `oracleText` vs its own card's Oracle
paragraphs:

| kind                          | fields | not printed text |
| ----------------------------- | ------ | ---------------- |
| `attack-mana-tax`             | 2      | 1                |
| `attack-requirement`          | 5      | 4                |
| `attack-restriction`          | 14     | 5                |
| `attack-sacrifice-tax`        | 2      | 2                |
| `block-restriction`           | 29     | 11               |
| `declared-attack-restriction` | 3      | 2                |
| `enters-tapped-restriction`   | 2      | 2                |
| `global-attack-restriction`   | 6      | 6                |
| `untap-restriction`           | 14     | 10               |
| `cast-permission`             | 1      | 0 (guarded)      |

Examples of the convention: `"Creatures without flying can't attack (Moat)."`,
`"Creatures with power 3 or greater don't untap (Meekstone)."`,
`"… enter tapped (Kismet)."` — a source-name-appended sentence, deliberately not
the printed text.

**Where they are consumed as UI copy.** `convex/gre/combat.ts` (`reason:`, eight
sites), `convex/gre/phases.ts` (`prompt: r.oracleText` — a `PendingChoice`
prompt), `convex/cards/castRestrictions.ts` (`castProhibitionReason`).

**Why it matters.** All 95 are serialized verbatim into the content-hashed
catalogue artifact, so a UI-copy edit to any of them restales
`data/catalogue/*` — and the only symptom is the catalogue freshness test's
undiagnosable "the committed artifact is not what the tree generates". That is
exactly how #3284's four reds reached the base tip; the field name is what
invited the edit.

**The fix is a rename, not a wider sweep.** Widening the containment/equality
invariant would red 43 shipped cards that are correct as written. The good name
already exists one interface away: `CastCondition.reason`
(`convex/cards/types.ts`) is documented as landing "in the same UI slot as a
`cast-restriction`'s `oracleText`". Renaming the reason-string kinds' field to
`reason` makes the name stop inviting the mistake, and then the `oracleText`-means-
printed-text invariant can be asserted on the kinds that keep it.

**Why it may not deserve its own issue.** It is a mechanical rename across ~95
call sites in ~12 kinds plus their consumers, with zero behaviour change and no
card affected — a large diff for a naming win, and the class it closes has now
been observed exactly once. Against that: the observation cost four red tests on
the base tip and a blocked merge train, the symptom was undiagnosable from the
failure message alone, and the repair PR's own class guard had to be scoped
narrowly precisely because of this. A slice that renames one kind at a time,
starting with the two that carry a `prompt:` (where a wrong string reaches a
player), would be defensible.

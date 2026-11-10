# Card Capabilities are a property of the card; Archetypes of the card in an environment — the Card Profile splits into two layers keyed differently

## Status

accepted (2026-11-07, "draft bot" grill session). Amends [ADR 0072][adr-0072]
(the Card Profile's keying) and takes up [ADR 0130][adr-0130] §3 and §6 (one
Capability vocabulary and one baseline for both Bots). Joined by the Archetype
Catalogue decision of the same session (archetype rows live in a seed-plus-DB
catalogue, admin-edited, scope-free as names and emergent in use).

Implemented by issue #8890: tables `cardCapabilities` (by `cardId`) and
`cardArchetypes` (by `scope` + `cardId`), seed files
`data/card-profiles/capabilities.json` and
`data/card-profiles/archetypes/<scope>.json`, split from the legacy rows by a
pure split function and a one-shot migration. Issue #8893 ran that migration on
production (the legacy table held 0 rows there) and dropped the legacy
`cardProfiles` table, the split and the migration. The recomposed lookup
carries one review flag per layer; Combo Edges sit in the Capability layer. The Archetype
Catalogue is implemented by issue #8892: seed `data/archetype-catalogue.json`,
table `archetypeCatalogue`, pure core `convex/limited/archetypeCatalogueCore.ts`
(row validation, seed ∪ DB merge, `activeRows`, `colourSignature`).

## Context

ADR 0072 stores a Card Profile — Archetypes, Capabilities provided, Capabilities
required, a `reviewed` flag — in one `cardProfiles` row keyed `(scope, cardId)`,
and rejects a scope-free profile "for the same reason ADR 0066 rejected a global
Pick Rating: a card's archetype role differs per environment". That sentence is
true of the Archetype half and false of the Capability half, and the code reads
both through one key.

Walked on the registry's ten rows: `value-on-etb`, `value-on-death`,
`value-on-attack`, `value-on-cast`, `self-mills`, `discard-outlet` and
`cheap-artifact` are mechanical facts of the card — Worldspine Wurm's death
trigger fires the same way in every cube and every set. The one judgement that
looks format-relative, `reanimatable` ("disproportionately powerful put onto the
battlefield from a graveyard"), ADR 0130 §14 already makes absolute with a
structural threshold. Archetypes, by contrast, are relative everywhere:
Lightning Bolt is `aggro` in the Vintage Cube and removal for `control` in a
set; `kicker` is a plan in Invasion and nowhere else; `aggro` is W/R in one
environment and R/G in another.

Two consumers force the question. The play Bot's Plan (ADR 0130, PRD #3602)
reads Capabilities for constructed decks, which have no Pack Source scope: a
scope-keyed Capability would have the engine pick a scope at random to read
from. And the derivator of ADR 0130 §4 reads a card's structure, which has no
scope either; its "certified profiles are the test bench" (§6) needs ONE row per
card to agree with, not one per scope.

The cost of not splitting is also a cost in work: with six Draftable sets and
the cube, a per-scope Capability layer is censused and reviewed seven times for
the same seven facts.

## Decision

1. **Card Capabilities are keyed by card alone.** `provides` / `requires` (and
   their `reviewed` flag and census rationale) live in a scope-free layer —
   one seed file for the catalogue, one DB table keyed `cardId` — and hold in
   every scope and in constructed play.
2. **Card Archetypes stay keyed `(scope, cardId)`.** The Archetype half keeps
   ADR 0072's reasoning: a plan is a property of the card IN an environment.
   Its `reviewed` flag and rationale are its own.
3. **No per-scope Capability exception.** A judgement that looks
   format-relative is made absolute by a structural threshold (ADR 0130 §14's
   `reanimatable`), never re-declared per scope. A weaker environment simply
   has fewer providers and fewer requirers, and the match stays correct. The
   ability to say "reanimatable in Ice Age, not in the cube" is given up on
   purpose: it is the per-scope fork the derivator could never reproduce.
4. **The drafter's lookup is unchanged.** The resolver recomposes the two
   layers into the `GetCardProfile` shape `botDrafter.ts`, `autoBuild.ts` and
   the Draft Signal already consume; the scorer's terms do not move. The
   Admin editor splits into a Capabilities tab (no scope) and an Archetypes
   tab (per scope).
5. **Combo Edges are not affected.** They are derived from the Combo Corpus
   (ADR 0164) and are scope-sensitive on their own: an edge weighs only when
   the partner is in the Pool.

## Considered Options

- **Keep one per-scope row and offer "copy to scope" in the editor** —
  rejected: the play Bot's Plan would still have to choose a scope to read
  Capabilities from, the derivator would have seven rows to agree with, and
  every scope would re-review the same mechanical facts.
- **Make everything global, Archetypes included** — rejected: Lightning Bolt's
  plan really does differ per environment, and the Archetype Catalogue's
  per-scope colour signature is computed from exactly that per-scope tagging.
- **Allow a per-scope Capability override as an escape hatch** — rejected
  (decision 3): the hatch is the fork; the structural threshold is the fix.

## Consequences

- One migration of the `cardProfiles` table (local and production) into two,
  and the Vintage Cube seed file split in two; the review state already
  entered survives per layer.
- The Profile Census tags Capabilities once per card and Archetypes once per
  scope; a new Draftable set costs an Archetype pass only.
- ADR 0130's derivator has one baseline row per card to be measured against.
- `reanimatable`'s threshold becomes load-bearing for every scope at once; its
  calibration is the certified cube layer, as ADR 0130 §14 already says.

[adr-0072]: 0072-card-profile-capability-matching.md
[adr-0130]: 0130-deck-plan-is-derived-unmet-capabilities.md

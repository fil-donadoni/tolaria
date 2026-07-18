# Permanent-level transform (CR 712) + token counters-at-creation

## Status

accepted

## Context

Issue #1210 (child of #924, Incubate — CR 701.53) investigated the engine
end-to-end for two prerequisites of Incubate N: "create an Incubator token, a
colorless artifact token with 'N +1/+1 counters on it' and '{2}: Transform
this artifact.'"

1. **No transform/double-faced-permanent machinery existed.** The only
   face-related state was `CardInstanceState.faceDown` / `faceDownOf`
   (`gre/faceDown.ts`, ADR 0013), which models CR 707.4 morph — a permanent
   with a single REAL identity hidden behind a generic 2/2, later turning up
   to its OWN characteristics. CR 712 transform is a structurally different
   mechanic: a permanent with two DISTINCT printed characteristic sets (front
   and back), always PUBLIC information (CR 712.1a — both players know both
   faces at all times, unlike a face-down card's hidden identity). There was
   no "which face is showing" flag, no back-face characteristics storage, and
   no primitive to swap them.
2. **`EffectTokenSpec` / `TokenSpec` had no counters-at-creation field.**
   Neither the JSON-pure DSL spec (`EffectTokenSpec`, the `createToken` Op)
   nor the fat `TokenSpec` (`SpellContext.createToken` for `resolve()` cards)
   could stamp counters onto a token as it's created — needed for "with N
   +1/+1 counters on it", N possibly dynamic (Sunfall: "X is the number of
   creatures exiled this way"). (Token-scoped `activatedAbilities[]` — the
   OTHER prerequisite flagged when #924 was filed — had already shipped by
   the time #1210 was picked up, issue #778/#1191: a Treasure/Clue/Blood
   token's own sacrifice-for-mana / draw ability. No work needed there.)

Also relevant: `CardDefinition.entersWith.counters` already exists (CR
122.1/614.1c) for a NON-token permanent entering the battlefield with
counters (`"X"`/`"kicker"` dynamic sentinels, applied in
`finalizeSpellResolution`). The token-counters gap is the SAME concept, just
missing on the token-spec types.

The worklist note on #1210 explicitly flags this as a foundational capability
(other CR 712 cards in the Vintage Cube worklist, PRD #620, will hit the same
wall) — scope the primitive generally, not narrowly around Incubate's shape.

## Decision

**Transform reuses the `faceDown.ts` definition-swap pattern, generalized to
a permanent-scoped `backFace` spec instead of a single hidden-identity
sentinel — and is always public, so it needs none of `faceDown`'s
per-viewer projection branching.**

### Data model

- `CardDefinition.backFace?: CardBackFace` (`cards/types.ts`) — the back
  face's own name / types / subtypes / supertypes / P-T / colors /
  staticAbilities / activatedAbilities / staticEffects / oracleText /
  imagePrintId. Declared directly on a printed card's definition, or on
  `TokenSpec.backFace` (a double-faced TOKEN, e.g. the Incubator) — the same
  `registerTokenDefinition` synthesis path a token's own FRONT definition
  already uses.
- `EffectTokenSpec.backFace?: EffectCardBackFace` — the JSON-pure subset for
  the `createToken` Op (ADR 0045/0046): same fields minus
  `activatedAbilities`/`staticEffects` (closures aren't JSON-expressible; a
  token whose back face needs either stays a `resolve()` card — the SAME
  narrowing `EffectTokenSpec` itself already applies relative to `TokenSpec`).
- `CardInstanceState.transformed?: boolean` + `transformedFrom?: string`
  (`gre/state.ts`) — mirrors `faceDown`/`faceDownOf`'s shape exactly:
  `transformed` marks "currently showing the back face"; `transformedFrom`
  retains the FRONT face's own definition id so a later flip restores it. Both
  are PUBLIC fields (no `gameProjections.ts` hiding, unlike `faceDownOf`).

### The primitive

`gre/transform.ts` exports `transformPermanent(card)`, a pure mutator mirror
of `faceDown.ts`'s `turnFaceDown`/`turnFaceUp`:

- **Front → back** (`!card.transformed`): reads `card.backFace` off the
  CURRENT definition (`tryGetDefinition(card.card.id)`); a permanent whose
  current face declares none is a no-op (CR 608.2b-style — nothing to flip
  to). Registers (idempotently, content-derived id keyed by
  `frontDefId + backFace` shape) a synthesized back-face `CardDefinition` via
  the EXISTING `registerTokenDefinition` seam, swaps `card.card.id` to it, and
  overwrites the mutable characteristic fields (`types`/`subtypes`/`power`/
  `toughness`/`staticAbilities`) in place — exactly like `turnFaceDown`
  overwrites them to the vanilla 2/2. Stores the front id in
  `transformedFrom`.
- **Back → front** (`card.transformed`): reads `transformedFrom`, re-derives
  characteristics from that definition, clears both flags.
- **No new "effective card" seam.** Every existing reader (layers.ts P/T
  layers 7a-7e, combat, activated-ability discovery via `card.card.id` →
  registry, SBA creature-ness checks) already re-derives from the mutable
  instance fields / `card.card.id` at read time — confirmed during
  investigation (no central `getEffectiveCard` function exists; every
  consumer independently reads `getDefinition(card.card.id)` +
  `card.types`/`power`/`toughness`). The swap propagates for free, same as
  `faceDown`.
- **Counters carry over across the flip** (CR 122 — transform doesn't remove
  counters; they belong to the permanent, not a face). Since counters live on
  `CardInstanceState.counters`, untouched by the swap, this is automatic — no
  special-case code.
- **Always public** (CR 712.1a): `projectPublicState`'s generic `slimCard`
  pass-through already ships `transformed`/`transformedFrom` identically to
  both players — no branch needed (contrast `faceDown`'s
  `projectBattlefieldCard`, which swaps `card.id` per-viewer to hide a
  MORPHED card's real identity).

### The `transform` Effect Op (CR 701.27, keyword action)

`{ op: "transform"; target: EffectObjectSelector }` — a thin declarative skin
over `SpellContext.transform(target)`, ONE execution path (ADR 0045). CR
712.8a — the SAME Op/primitive flips EITHER direction (front→back if
currently showing front, back→front if already transformed), so a card never
declares two Ops. `target` is almost always the implicit `$source` (the
Incubator's own "{2}: Transform this artifact"), following the exact same
shape as `regenerate`'s `target`-only Op.

### Token counters-at-creation

`TokenSpec.entersWith?: { counters?: { type: string; count: number }[] }` and
`EffectTokenSpec.entersWith?: { counters?: { type: string; count: EffectValue }[] }`
— SAME name/shape as `CardDefinition.entersWith.counters` (generalize, don't
add — ADR 0045's primitive-reuse mandate), minus the `"X"`/`"kicker"`
sentinels (a `resolve()` card computes any dynamic amount itself before
building the spec). `createTokenPermanents` (`gre/state.ts`) stamps the
resolved counters onto each created instance before the CR 614 ETB
chokepoint, mirroring `finalizeSpellResolution`'s existing application for a
non-token permanent. The `createToken` Op executor resolves each
`EffectValue` count (a literal, a bound `ref`, a `count` construct) into a
plain number before handing the spec to `SpellContext.createToken` — the
same "resolve values through the interpreter, hand primitives plain data"
convention every other Op follows. `entersWith` is intentionally excluded
from `tokenDefinitionId`'s content hash (it stamps the INSTANCE, not a
characteristic of the shared definition) — `backFace` IS included (a
definition-level characteristic).

The static validator (`gre/effects/validate.ts`) special-cases
`createToken`'s `token.entersWith` in the ordered ref-check pass: every OTHER
field of `token` is skipped there (a token's `activatedAbilities[].effects`
runs in its OWN independently-scoped script, fresh `$source`, validated by a
separate nested pass) — `entersWith.counters[].count` is the one exception,
since it resolves in THIS outer scope at token-creation time, same as
`count`/`controller`.

## Consequences

- **Scoped deliberately**: only a permanent ALREADY on the battlefield
  transforms in place (a paid activated-ability cost). A full two-sided-card
  CASTING model (choosing which face to cast, a distinct mana cost per face,
  CR 711) is out of scope — no shipped card needs it yet, and it's a
  materially bigger surface (deck/hand representation of a two-faced card,
  cast-time face choice UI). Flagged explicitly for a future issue if a
  printed DFC (not just a double-faced TOKEN) is ever added to the pool.
- **Incubate itself stays `planned`** in `mechanicsRegistry.ts`. Both engine
  gaps #924 flagged are closed by this issue, but composing them into the
  actual "Incubate N" keyword action (create an Incubator token with N
  counters and the transform ability, likely via a small shared token spec in
  `cards/sharedTokens.ts` mirroring `TREASURE_TOKEN`) and un-stubbing Sunfall
  (`cards/sets/mom/white.ts`) is left to #924 — a card-level slice, not a
  foundational one.
- **Serialization**: `transformed`/`transformedFrom` added to
  `compactCard`/`expandCard` (`gre/serialize.ts`) and asserted in the
  monolithic CardInstanceState round-trip test (`serialize.test.ts`) per the
  project's drift-guard convention. No new `GameState`-level optional key —
  both new fields are `CardInstanceState`-scoped.
- **Frontend wiring**: `projectPublicState`'s default pass-through already
  ships the new fields to both viewers untouched — no reducer change needed.
  A dedicated wire-format test (`interpreter.test.ts` and `transform.test.ts`)
  confirms the swapped characteristics AND `transformed` survive identically
  for controller and opponent. Back-face ART is out of scope for this slice
  (no UI work) — `imagePrintId` is carried on `CardBackFace` for a future
  frontend pass to consume via the same `tryGetDefinition(id)` lookup path
  `copiedFrom` already uses for an alternate-face preview.

## Alternatives considered

- **Extend `faceDown`/`faceDownOf` to double as transform state.** Rejected:
  morph and transform diverge on the one property that matters most for
  correctness — face-down hides a REAL identity (opponent sees a placeholder,
  `projectBattlefieldCard` branches per-viewer); transform is always public
  (both faces known to both players, CR 712.1a). Overloading one flag for two
  visibility models is a standing footgun (a future card combining morph +
  transform, e.g. a manifest-then-transform interaction, would need to
  disambiguate anyway). A second, symmetric flag pair costs one serialize
  line and one wire test; conflating them costs a permanent hidden bug class.
- **Store back-face characteristics as an inline snapshot on the instance**
  (no synthesized `CardDefinition`, no `card.card.id` swap). Rejected: every
  existing reader (activated-ability discovery, layers, art lookup) keys off
  `card.card.id` → the registry; an inline snapshot would need a SECOND
  "effective card" resolution seam threaded through every one of those
  readers — exactly the seam the investigation confirmed doesn't exist today
  and that reusing `registerTokenDefinition` avoids introducing.
- **A new `TransformSpec` type independent of `TokenSpec`/`CardDefinition`.**
  Rejected: `CardBackFace` mirrors the SAME field vocabulary the front side
  already declares (name/types/P-T/abilities) — a permanent's back face is
  structurally just another face's worth of printed characteristics, not a
  new concept. One type, attached at two sites (`CardDefinition.backFace`,
  `TokenSpec.backFace`), reuses `registerTokenDefinition` and
  `tokenDefinitionId`'s existing content-hash convention rather than
  inventing a parallel one.

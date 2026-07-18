---
description: Rules for developing Game Rules Engine modules
globs:
    - "convex/gre/**/*.ts"
    - "convex/cards/**/*.ts"
---

# GRE Development Rules

When modifying files in `convex/gre/` or `convex/cards/`:

## Rules compliance

- **CR-compliance is the default — never ask the user whether to follow the Comprehensive Rules.** When behavior is governed by the CR, implement it exactly as the CR specifies. Only surface a question when the CR is genuinely ambiguous, when intentionally simplifying/deferring, or when a design choice is not dictated by the CR. Verify the relevant CR text first (`/mtg-rules-check`) rather than asking.
- Every game mechanic MUST reference its CR (Comprehensive Rules) section in code comments
- Before implementing a new rule or modifying existing behavior, verify against official CR using `/mtg-rules-check`
- Flag any deviation from CR explicitly — document what's simplified and why

## DSL-first authoring (ADR 0045)

**A new card's effect is written as an Effect Script by default.** Every
effect site accepts one: `CardDefinition.effects` (spell resolution),
`ActivatedAbility.effects`, `TriggeredAbility.effects` — an ordered
`EffectOp[]` interpreted by `convex/gre/effects/interpreter.ts` through the
four frozen structural constructs (bind/ref/if/forEach). `resolve()` /
`resolveSteps` / the `effect` shorthand remain mutually-exclusive alternatives
on the same site, reserved for **protocol-like cards** (Word of Command,
Camouflage — ~10–15% of the pool, ADR 0045) whose effect genuinely cannot be
expressed by the current Op vocabulary.

- **`resolve()` requires an explicit justification.** A closure with no
  justification is a review blocker, not a style nit. Record it as a code
  comment on the ability/card (`// protocol card: <why the Op vocabulary
can't express this>`) AND restate it in the PR description. "The Op I need
  doesn't exist yet" is NOT a valid justification for `resolve()` — that's the
  stop-and-issue case below, not the escape hatch.
- **Consult the Mechanics Registry before writing anything.**
  `convex/cards/mechanicsRegistry.ts` is the single authority on mechanic
  names:
    - A **keyword ability** (CR 702, a `staticAbilities[]` string) must
      case-insensitively match a registry row's `name`, or its
      `bindingPattern` for a parametrized keyword (protection, rampage N,
      landwalk, "bands with other …").
    - An **Op** (`EffectOp.op`) must be a row in `EFFECT_OP_REGISTRY`
      (`isRegisteredEffectOp`) — the same file.
- **Stop-and-issue on an uncensused mechanic.** If the oracle text needs a
  keyword or Op that is `planned` or simply absent from the registry, do NOT
  invent a name and do NOT paper over the gap with a card-shaped `resolve()`
  closure. Open a GitHub issue flagging the gap (or ask the user) and leave
  the card as a tracked stub. The registry-wide guard test
  (`convex/cards/__tests__/mechanicsRegistry.test.ts`) fails CI on any
  unlisted name regardless — catching it during authoring is cheaper than
  catching it in CI.
- **Guard A — keyword-must-be-implemented (issue #962).** A shipped
  (non-stub) card's `staticAbilities[]` string must resolve to a Mechanics
  Registry row with `status: "implemented"` — not merely a NAMED mechanic
  (which the name-authority guard above already checks). A card that
  declares a `planned`/`out-of-scope` keyword ships functional-looking but
  is silently inert — the exact deathtouch/hexproof shape (#957/#958) this
  guard exists to catch permanently. Enforced catalogue-wide by
  `describe("Guard A — keyword-must-be-implemented (issue #962)")` in
  `convex/cards/__tests__/mechanicsRegistry.test.ts`. To satisfy it: either
  ship the mechanic (flip its registry row to `implemented` with a real
  binding) before the card, or — if the card must land first — add a
  narrow `{ cardId, keyword, issue }` row to that describe block's
  `KEYWORD_ALLOWLIST`, with a real open tracking issue. The allowlist is
  meant to empty out as each entry's issue lands, never a standing escape
  hatch; a companion test asserts every entry stays well-formed (real card,
  real declared keyword, real issue number).
- **Guard B — documented-divergence-needs-issue (issue #962).** A `//
Deferred` / `// DEFERRED` / `// divergence` / `// DIVERGENCE` / `// not
implemented` / `// TODO` comment inside `convex/cards/sets/**` documents
  an intentional partial implementation (an Oracle clause a card's
  `resolve()`/`effects` silently drops) — and every one MUST carry a
  tracking disposition **in the marker's own comment PARAGRAPH**: a linked
  issue ref (`#NNN`, prefer `tracked-by: #NNN`) or an explicit "out of
  scope" note. Enforced by
  `convex/cards/__tests__/divergenceMarkers.test.ts`. Two deliberate
  narrowings vs. the sibling stub guard (`scripts/check-stub-coverage.ts`),
  each closing a proven leak. **(1) Paragraph scope, not the whole comment
  block:** the ref must live in the SAME paragraph as the marker — the run of
  comment lines around it, bounded by a blank `//` line, a box-rule line
  (`// ────` / `// ════`), or a non-comment line. A ref in a DIFFERENT
  paragraph does not vouch: not a provenance citation in the card-intro
  paragraph above, not a separate deferral note's ref lower in the same block.
  (A real multi-marker section footer — several deferred cards bulleted under
  one `tracked-by: #NNN` header — is ONE paragraph and needs the ref once.)
  **(2) `ADR NNNN` does NOT count as a tracking ref:** an ADR documents a
  card's design/provenance, it is not a work ticket for a dropped clause; a
  permanently out-of-scope divergence must still say so in words ("out of
  scope"), which does count. An unreferenced marker fails CI — add a
  `tracked-by: #NNN` ref on/next to the marker (same paragraph), or open a new
  issue and reference it, before landing the card.

**Per-Op test regime replaces per-card mandates for DSL cards.** The `Card
testing convention` table below still governs `resolve()` cards in full, and
governs a DSL card that introduces a genuinely new Op or construct usage. For
a card whose `effects[]` uses ONLY Ops the interpreter suite already
exercises (check coverage in `convex/gre/effects/__tests__/interpreter.test.ts`,
including its wire-format assertion), **no hand-written per-card GRE or wire
test is required.** Its proof obligation is two things that already run
catalogue-wide, with zero per-card authoring:

1. `validateEffectScript` / `validateAbilityEffectScript` passes — the
   catalogue-wide static sweep (`convex/cards/__tests__/effectScripts.test.ts`):
   schema, ref/binding references, vocabulary, JSON purity (ADR 0046),
   mutual-exclusivity with `resolve`/`resolveSteps`/`effect`.
2. The auto-generated canned-scenario smoke test
   (`convex/gre/effects/scenarioGenerator.ts`, wired catalogue-wide in
   `convex/cards/__tests__/effectScriptSmoke.test.ts`) picks the card up
   automatically and asserts its declared outcomes by resolving it through
   the real path (`resolveTopOfStack`). A script the generator can't
   faithfully scenario-ize surfaces as an explicit skip with a reason —
   never a silent pass — which is the signal to add a hand-written test for
   that card after all.

A card that introduces a **new Op** (or exercises bind/ref/if/forEach in a
combination the interpreter suite doesn't already cover) gets the FULL regime
as that Op's own test: an interpreter unit test covering the construct
combinations it participates in, plus a wire-format assertion once through
`projectPublicState`. That test becomes the Op's permanent test, inherited
free by every later card that reuses the Op — the "new Op pays the entry fee
once, reuse rides free" trade the per-Op suite is built around (PRD #795).

## Testing requirement

- Every new function or behavior change MUST have corresponding tests in `convex/gre/__tests__/`
- Tests MUST reference the CR section they validate (e.g. `describe("lands (CR 305.2)")`)
- Run `bun run test` after any change — zero failures required

## Card testing convention (mandatory for `resolve()` cards and new Ops)

This table governs `resolve()` / `resolveSteps` cards, and a DSL card
introducing a new Op or construct combination (see `DSL-first authoring`
above). A DSL card that only reuses already-exercised Ops is covered by the
per-Op regime instead — the catalogue-wide static sweep plus the
auto-generated canned-scenario smoke test, no hand-written test required.

Every set is a colour-split DIRECTORY (`sets/<code>/<colour>.ts`, ADR 0043), and
every card with non-trivial behavior gets a dedicated `describe` block in the
**parallel per-colour test file** matching the colour module the card lives in:

```
convex/cards/sets/lea/red.ts      →  convex/cards/sets/lea/__tests__/red.test.ts
convex/cards/sets/lea/blue.ts     →  convex/cards/sets/lea/__tests__/blue.test.ts
```

Shared fixtures live in `convex/cards/__tests__/setup.ts` (`makeInstance`, `makePlayer`, `makeState`, `pushSpell`). Import from there — do NOT duplicate fixture helpers in set tests.

Required coverage per card:

| Card has                       | GRE test                                                                              | Wire format test                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `resolve()` (spell)            | yes — push on stack, `resolveTopOfStack`, assert outcome                              | only if the effect is visible client-side                                     |
| `staticEffects[]` (layer 7c)   | yes — assert `getEffectivePower/Toughness` with and without the effect                | **YES, mandatory** — re-run the assertion after `projectPublicState`          |
| `staticAbilities[]` (keywords) | snapshot check on the definition (`expect(card.staticAbilities).toContain("flying")`) | not needed (keywords are already exercised by combat/rules tests generically) |
| `activatedAbilities[]`         | yes — trigger the ability via GRE entry point, assert state change                    | **YES, mandatory** if the ability's outcome is visible on the board           |

**Why the wire format test is mandatory for visible effects.** The server projects `GameState` → `PublicGameState` / `FullGameState` before it crosses the network (`convex/gameProjections.ts`). The projection strips `card.card` to `{ id }` and reshapes arrays (`library: { count }`, opponent `hand: null[]`). A feature that passes the GRE unit test can still be silently broken on the client if the engine reads fat fields that the projection strips. Wire format tests re-run the same assertion against the projected state and are the only tests that catch this class of bug.

Minimum wire format test pattern:

```ts
const state = makeState(/* scenario */);
// assert GRE behavior on fat state:
expect(getEffectiveToughness(state, target)).toBe(expected);
// assert the same behavior survives the projection:
const projected = projectPublicState(state, 1, viewerId);
const slimTarget = projected.players[i].battlefield.find(
    (c) => c.id === target.id
)!;
expect(getEffectiveToughness(projected, slimTarget)).toBe(expected);
```

## End-to-end targeting test (mandatory for new target types)

When a new `TargetRequirement.type` value is introduced (e.g. `"spell-or-permanent"`), the following sites MUST be tested — GRE unit tests alone are NOT sufficient:

| Layer    | What to test                                                                       | File                                      |
| -------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| GRE      | `getLegalTargets` returns correct targets for the new type                         | `convex/gre/__tests__/` or card test file |
| Backend  | `selectTarget` mutation accepts the new type for both permanent and spell branches | `convex/game.ts` integration test         |
| Frontend | `matchesTargetRequirement` marks battlefield cards as clickable                    | `src/lib/__tests__/card-utils.test.ts`    |
| Frontend | `wantsSpellTarget` enables stack spell selection                                   | `src/components/board/` test              |
| Frontend | `TARGET_LABEL` has an entry (no raw fallback string)                               | `src/components/board/` test              |

**Rule: every feature that crosses the GRE → game.ts → UI boundary MUST have at least one integration test that exercises the full path. Two pieces passing individually but failing together is a shipped bug.**

## Frontend wiring analysis (mandatory for EVERY new card / mechanic)

A card that is fully correct in the GRE can still be dead in the UI. The client
never sees `GameState` — it sees the output of **view reducers** that slim it
down, and every reducer is a place a field the UI depends on can be silently
dropped. This is the single most common recurring bug class: the card passes
all GRE unit tests, wire-format tests and the DSL smoke sweep (they all run
server-side, where the ability is legal), yet no affordance appears on the
board. **Before marking any card/mechanic done, walk the reducers and confirm
the UI still works.**

The client-side reducers a new card can trip, and what each drives:

| Reducer                                     | Lives in                                          | Drives (UI surface)                                                                                                                     | Drop symptom                                                                                                           |
| ------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `projectPublicState` / `FullGameState`      | `convex/gameProjections.ts`                       | everything the board renders (strips `card.card` → `{ id }`, `library` → `{ count }`, opponent `hand` → `null[]`)                       | effect reads a fat field the wire strips → value wrong client-side                                                     |
| `buildTriggerStateView`                     | `src/lib/card-utils.ts`                           | `getStackAbilities` affordability hints + `canActivate` predicates (life, `exileFromGraveyard`, `removeCounter`, board/graveyard scans) | ability never offered even though the GRE would allow it (Grim Lavamancer: dropped `graveyard`)                        |
| `getStackAbilities` gates                   | `src/lib/card-utils.ts`                           | whether an activated ability appears in the tap/context menu                                                                            | a new cost shape with no gate is always shown (server rejects) OR gated against a field the view lacks → always hidden |
| `matchesTargetRequirement` / `TARGET_LABEL` | `src/lib/card-utils.ts` / `src/components/board/` | clickable targets + the target prompt label                                                                                             | new `TargetRequirement.type` not handled → nothing clickable / raw fallback string                                     |

**Analysis checklist — run for every new card:**

1. Does the card add or read a **field on `CardInstanceState`** (counters, a new flag)? Confirm `projectPublicState` preserves it and add/extend a wire-format test.
2. Does an ability's **activation cost** gate on player/board state (`exileFromGraveyard`, `life`, `removeCounter`, a `canActivate` predicate)? Confirm `buildTriggerStateView` carries the field it reads, and confirm `getStackAbilities` has a matching affordability gate. The catalogue sweep `src/lib/__tests__/activation-affordability.catalogue.test.ts` picks up `exileFromGraveyard`/`life`/`removeCounter` shapes automatically — a new card reusing them needs no hand-written frontend test; a **new cost shape** must be added to that sweep's `Shape` union (its "new-Op pays the entry fee once" analogue).
3. Does the card add a **new `TargetRequirement.type`**? Run the full target-type table above.
4. For any reducer the card newly depends on, add at least one test that drives the SURFACE assertion **through the reducer** (build the view via `buildTriggerStateView`, project via `projectPublicState`) — a hand-built view/state masks a dropped field, so it does not count.

## Exhaustive target-type matching

Code that switches on `TargetRequirement.type` values MUST use an exhaustive helper or explicitly list every member of the union. A raw `reqTypes.includes("spell")` that doesn't also handle `"spell-or-permanent"` is a bug. When adding a new type value, grep for every consumer and update all of them.

## Serialization requirement

Every optional field on `GameState` must be added to `PERSISTED_OPTIONAL_KEYS` in `serialize.ts` (or `TRANSIENT_KEYS` if intentionally ephemeral). The schema drift guard test in `serialize.test.ts` fails when a GameState key is missing from both sets — this prevents silent field loss across DB writes.

When adding a new optional field to `GameState`:

1. Add the key to `PERSISTED_OPTIONAL_KEYS` in `serialize.ts`
2. Add a round-trip smoke test in `serialize.test.ts` with a non-empty representative value
3. Run `bun run test` — the drift guard will catch omissions

## Code patterns

- All game state mutations are pure functions (no side effects, no async)
- Card definitions are DATA, not imperative code — use `resolve()` only when needed
- Types come from `convex/cards/types.ts` (CardDefinition, ManaCost, SpellContext) and `convex/gre/state.ts` (GameState, PlayerState, CardInstanceState)
- Constants and helpers live in `convex/gre/constants.ts` — never define locally
- Mana abilities use `useStack: false` (CR 605.3a)

## Primitive reuse (mandatory)

Target scale is ~80k cards. One dedicated `SpellContext` primitive per card does not scale — primitives must be small, orthogonal, and composable.

Before adding a new primitive to `SpellContext`:

1. **Decompose the effect.** Can it be expressed as a sequence of existing primitives? E.g. Timetwister = `moveZone(hand→library)` + `moveZone(graveyard→library)` + `shuffleLibrary` + `drawCards(7)`. No new primitive needed.
2. **Generalize, don't add.** If an existing primitive is almost right, parametrize it. `drawCards(player, n)` is "move N from library top to hand" — a `moveZone` with position/count parameters may subsume it and more.
3. **Orthogonality check.** New primitives should represent a general zone/mana/life operation (movement, mutation, lookup), not a card-shaped effect ("shuffleHandAndGraveyardIntoLibrary" fails this test; "moveZone" passes).
4. **Composition over flags.** Avoid adding boolean flags to existing primitives that change behavior — prefer calling a sequence of simpler primitives.

If after those checks a new primitive is still needed, flag it explicitly in the PR/implementation and document why it couldn't be composed.

## Card definition checklist

When adding/modifying cards in `convex/cards/sets/`:

- Verify mana cost against Scryfall
- Map keywords to `staticAbilities[]` — check the Mechanics Registry
  (`convex/cards/mechanicsRegistry.ts`) for the exact name/pattern first
- Set `targetRequirement` for targeted spells
- **Write the effect as an Effect Script (`effects: EffectOp[]`) by default** —
  check `EFFECT_OP_REGISTRY` for the Ops you need before writing anything.
  Use `resolve()` only for a protocol-like card, with a recorded
  justification (see `DSL-first authoring` above); if a needed Op doesn't
  exist yet, flag it / open an issue rather than reaching for `resolve()`
- **One Oracle line = ONE `TriggeredAbility` (multi-event standard).** When a
  single Oracle sentence fires on several distinct engine events — "put into a
  graveyard from anywhere" = `CREATURE_DIED` + `CARD_DISCARDED` + `CARD_MILLED`
  — do NOT emit one near-duplicate `TriggeredAbility` per event. Declare ONE
  ability and pass an ARRAY to `event: GameEventType[]` (CR 603.2); its
  `matches(event, self)` discriminates per firing event. The engine's trigger
  scan (`triggerHandlesEventType`, `gre/triggers.ts`) matches an event whose
  `type` is a member of the array. Duplicate entries render the same Oracle
  line N times on the stack / in the inspector — a UI bug. A catalogue-wide
  guard (`convex/cards/__tests__/triggerDedup.test.ts`) fails CI on any card
  with two same-`oracleText` triggers differing only by `event`. Worldspine
  Wurm (`rtr/green.ts`) is the reference shape. (An array-`event` ability
  cannot read `$event` in an Effect Script — a trigger whose effect must
  inspect the firing event stays scalar `event` + imperative `resolve`.)

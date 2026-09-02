# Engine & card authoring rules

Loaded **on demand** — this file enters context the first time a session reads
a file under `convex/`, and costs nothing to a session that never does. The
resident index is `.claude/rules/gre-development.md`; this is the full text it
points at, and every `§` anchor cited from the codebase resolves here.

## Rules compliance

- **CR-compliance is the default — never ask whether to follow the CR.**
  Implement exactly what the CR specifies; question only genuine ambiguity,
  intentional simplification, or choices the CR doesn't dictate. Verify with
  `/mtg-rules-check` first.
- **Print the rule, never recall it** (ADR 0098). The vendored official
  document (`data/cr/comprehensive-rules.txt`) is the only source:
  `bun run cr 605.1a`, `bun run cr grep "<keyword>"`. A citation whose id
  `bun run cr` cannot find is wrong — `bun run cr:lint` sweeps the repo for
  them and runs in `check:guards` (#2429) — including bare ids in a slash-list,
  so long as the citation stays on ONE line **and that line says `CR `** (a
  prefix split from its id across two comment lines, and a bare id on a line
  with no `CR ` on it, are the two shapes the scan cannot see). It proves only that
  an id RESOLVES: the comment around it must still say what the printed rule
  says, and that is yours to check.
- Every mechanic MUST reference its CR section in code comments.
- Flag any deviation from CR explicitly — what's simplified and why.

## DSL-first authoring (ADR 0045)

**A new card's effect is an Effect Script by default** — `effects: EffectOp[]`
on `CardDefinition` / `ActivatedAbility` / `TriggeredAbility`, interpreted by
`convex/gre/effects/interpreter.ts` (four frozen constructs:
bind/ref/if/forEach). `resolve()` / `resolveSteps` / `effect` are reserved for
**protocol-like cards** (~10–15% of the pool) whose effect genuinely exceeds
the Op vocabulary.

- **`resolve()` requires an explicit justification** — a code comment
  (`// protocol card: <why>`) AND the PR description. A missing Op is NOT a
  justification — that is the stop-and-issue case, not the escape hatch.
- **Consult the Mechanics Registry first** (`convex/cards/mechanicsRegistry.ts`),
  the single name authority: keywords match a row's `name`/`bindingPattern`;
  Ops must be in `EFFECT_OP_REGISTRY` (`isRegisteredEffectOp`).
- **Stop-and-issue on an uncensused mechanic.** Never invent a name or paper
  over the gap with a card-shaped closure — open an issue, leave a tracked
  stub. The registry guard (`mechanicsRegistry.test.ts`) fails CI regardless.
- **Guard A — keyword-must-be-implemented (#962).** A shipped card's
  `staticAbilities[]` must resolve to a registry row with
  `status: "implemented"` — a `planned` keyword ships silently inert.
  Enforced catalogue-wide in `mechanicsRegistry.test.ts`. To satisfy: ship
  the mechanic first, or add a narrow `{ cardId, keyword, issue }` row to
  `KEYWORD_ALLOWLIST` with a real open issue (the allowlist empties out,
  never a standing hatch). History: `docs/agents/gre-guards.md`.
- **Guard B — documented-divergence-needs-issue (#962, widened #1900).**
  Every confession marker in `convex/cards/sets/**` (vocabulary:
  `Deferred`/`divergence`/`not implemented`/`TODO`/`simplif*`/`approximat*`/
  `not model(l)?ed`/`not enforced`/`deviat*`/`unimplemented`/`unbuilt`,
  matched anywhere in a `//` line, not only its first word) MUST carry a
  tracking ref (`tracked-by: #NNN`) or an "out of scope" note **on its own
  line, the next line, or an earlier same-paragraph line that is itself
  dispositioned**. `ADR NNNN` is provenance, never a ticket. A commented-out
  stub's own comment run is `check-stub-coverage.ts`'s domain, not this
  guard's. Enforced by `divergenceMarkers.test.ts`; scanner shared with the
  liveness sweep in `scripts/lib/divergence-markers.ts`. Derivation:
  `docs/agents/gre-guards.md`.
- **Guard C — round-trip-or-declare-the-gap (#2701, PRD #2693).** The gap the
  Oracle compiler introduced: a card whose hand-written definition is entirely
  correct and whose own Oracle text the grammar cannot read back into it.
  Nothing about it is broken — which is why it would accumulate invisibly,
  shrinking the gold standard the compiler is measured against. So a card does
  ONE of three things. (1) **Round-trips**: `roundTripCard`
  (`convex/oracle/gold.ts`, the single comparator, shared with the gold
  harness) — structural equality for a DSL card; for a closure card, producing
  a definition at all is enough here. (2) Carries
  **`// compiler-gap: <fragment> (#issue)`** in the comment paragraph directly
  above its `export const … : CardDefinition` anchor (Guard B's
  `paragraphBounds`, shared). The shape is strict and the FRAGMENT is the
  deliverable — it ranks the next grammar rule (user story 9) — so quote the
  Oracle span, never "the compiler can't do this card". A marker inside the
  object literal, two paragraphs up, or with no issue ref exempts NOTHING and
  reds. (3) Sits in the one-time **baseline**
  (`convex/cards/__tests__/compilerRoundTrip.baseline.ts`, 1,756 cards), which
  cannot be APPENDED to and drains as cards graduate. Enforced by
  `compilerRoundTrip.test.ts`; scanner in
  `scripts/lib/compiler-gap-markers.ts`. Presence only — liveness is the
  network sweep's job, exactly as for Guard B.

**Guard B polices markers; it does not licence them.** A `tracked-by:` ref
makes an already-accepted divergence findable — it never makes one
acceptable. The default is no marker: implement the clause.

**A MECHANIC is implemented WHOLE — never partially shipped behind a marker.**
When work on a keyword/keyword action/CR 701–702 rule begins, every subrule of
its CR section ships, on every surface (GRE, mutation, wire projection, UI
affordance, bot Move + valuation, serialization, debug scenario). A missing
capability the rule text implies is part of the work, scoped up front — not a
follow-up. The cost of a missing clause is that nobody knows it's missing: a
partial mechanic passes its own tests and reads as done while its tracking
issue rots. What stays outside scope: a DIFFERENT card's effect
that merely references the mechanic — but build the engine-side primitive its
own rule text implies (Foretell, CR 702.143d). If genuinely too
large for one PR, slice so intermediate states are engine capabilities with no
card exposing them, registry row `planned` until the last slice.

**Per-Op test regime (DSL cards).** The testing table below governs
`resolve()` cards and DSL cards introducing a new Op/construct combination. A
card whose `effects[]` uses ONLY already-exercised Ops (check
`interpreter.test.ts` coverage) needs **no hand-written per-card test** — its
proof is catalogue-wide and automatic:

1. `validateEffectScript` static sweep (`effectScripts.test.ts`): schema,
   refs, vocabulary, JSON purity, mutual-exclusivity.
2. The generated canned-scenario smoke test (`scenarioGenerator.ts` via
   `effectScriptSmoke.test.ts`), resolving through the real
   `resolveTopOfStack`. An un-scenarioizable script surfaces as an explicit
   skip — the signal to hand-write a test after all.

A card introducing a **new Op** gets the full regime as that Op's permanent
test (interpreter unit + one wire-format assertion through
`projectPublicState`) — "new Op pays the entry fee once, reuse rides free"
(PRD #795).

## Testing requirement

- Every new function/behavior change needs tests in `convex/gre/__tests__/`.
- Tests reference their CR section (`describe("lands (CR 305.2)")`).
- `bun run test` zero failures after any change.

## Proof-of-failure (mandatory for every new guarding test)

**A test you have never seen fail is not evidence.** Break the code it
guards, watch it go red, revert, and state what you broke (PR description;
receipt if a subagent). The asymmetry it defends against: a test failing
wrongly is loud and fixed in minutes; a test passing wrongly is silent
forever — nothing else in the workflow distinguishes a load-bearing assertion
from a vacuous one.

Three shipped shapes it catches: (1) the test encodes the bug (asserts the
wrong current behavior); (2) the test asserts nothing (expected and actual are
the same object — beware code that mutates its argument in place; snapshot
with `structuredClone` before the act); (3) the test never reaches the code (a
hand-built view instead of the real reducer). Shape 3 has the structural rule:
SURFACE assertions must traverse `projectPublicState` /
`buildTriggerStateView`.

**Applies to** every test whose job is to catch something (regression,
catalogue guard, CR conformance, review-finding response). Not to routine DSL
coverage the smoke sweep provides. A test that still passes after you break
the subject is a finding — fix it before proceeding.

## Card testing convention (resolve() cards and new Ops)

Sets are colour-split directories (`sets/<code>/<colour>.ts`, ADR 0043); each
non-trivial card gets a `describe` block in the parallel per-colour test file
(`sets/lea/red.ts` → `sets/lea/__tests__/red.test.ts`). Shared fixtures:
`convex/cards/__tests__/setup.ts` (`makeInstance`, `makePlayer`, `makeState`,
`pushSpell`) — never duplicate them.

| Card has                     | GRE test                                               | Wire format test                                |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `resolve()` (spell)          | yes — push, `resolveTopOfStack`, assert outcome        | only if visible client-side                     |
| `staticEffects[]` (layer 7c) | yes — `getEffectivePower/Toughness` with/without       | **YES, mandatory** — re-assert after projection |
| `activatedAbilities[]`       | yes — trigger via GRE entry point, assert state change | **YES, mandatory** if outcome visible on board  |

`staticAbilities[]` (keywords) has no row: it needs **no per-card test at all**.
`mechanicsRegistry.test.ts` already fails CI catalogue-wide when a shipped
keyword does not resolve to an `implemented` registry row (Guard A above).

**Every per-card test MUST call something.** A block that reads definition
fields and asserts them, with no engine entry point, no fixture builder and no
reducer between the read and the `expect`, is the definition written twice: it
goes red on correct edits, green on a card that is inert in the engine, and
counts as coverage while proving nothing.
`scripts/__tests__/identity-only-card-tests.test.ts` fails CI on a new one
(allowlist empty, meant to stay empty). History: `docs/agents/gre-guards.md`.

**Why wire tests are mandatory for visible effects:** the projection
(`convex/gameProjections.ts`) strips `card.card` → `{ id }`, reshapes arrays
(`library: { count }`, opponent `hand: null[]`); an effect reading fat fields
passes the GRE test and breaks silently on the client. Pattern:

```ts
const state = makeState(/* scenario */);
expect(getEffectiveToughness(state, target)).toBe(expected);
const projected = projectPublicState(state, 1, viewerId);
const slimTarget = projected.players[i].battlefield.find(
    (c) => c.id === target.id
)!;
expect(getEffectiveToughness(projected, slimTarget)).toBe(expected);
```

## End-to-end targeting test (mandatory for new target types)

A new `TargetRequirement.type` value MUST be tested at every site — GRE alone
is NOT sufficient:

| Layer    | What                                                       | Where                                  |
| -------- | ---------------------------------------------------------- | -------------------------------------- |
| GRE      | `getLegalTargets` returns correct targets                  | `convex/gre/__tests__/` or card test   |
| Backend  | `selectTarget` accepts the type (permanent + spell branch) | `convex/game.ts` integration test      |
| Frontend | `matchesTargetRequirement` marks cards clickable           | `src/lib/__tests__/card-utils.test.ts` |
| Frontend | `wantsSpellTarget` enables stack selection                 | `src/components/board/` test           |
| Frontend | `TARGET_LABEL` has an entry                                | `src/components/board/` test           |

**Every feature crossing GRE → game.ts → UI needs at least one full-path
integration test. Two pieces passing individually but failing together is a
shipped bug.**

## Frontend wiring analysis (mandatory for EVERY new card/mechanic)

A card fully correct in the GRE can be dead in the UI: the client sees only
**view reducers**, and every reducer can silently drop a field. This is the
single most common recurring bug class — all server-side tests pass, no
affordance appears. **Walk the reducers before marking done.**

| Reducer                                     | Lives in                                          | Drives                                               | Drop symptom                                                      |
| ------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `projectPublicState` / `FullGameState`      | `convex/gameProjections.ts`                       | everything the board renders                         | effect reads a stripped fat field → wrong client-side             |
| `buildTriggerStateView`                     | `src/lib/card-utils.ts`                           | `getStackAbilities` hints + `canActivate` predicates | ability never offered (a dropped view field)                      |
| `getStackAbilities` gates                   | `src/lib/card-utils.ts`                           | whether an ability appears in the menu               | new cost shape ungated (always shown) or gated on a missing field |
| `matchesTargetRequirement` / `TARGET_LABEL` | `src/lib/card-utils.ts` / `src/components/board/` | clickable targets + prompt label                     | new type unhandled → nothing clickable / raw fallback             |

**Checklist per new card:**

1. New/read field on `CardInstanceState`? Confirm `projectPublicState`
   preserves it + wire-format test.
2. Activation cost gating on player/board state? Confirm
   `buildTriggerStateView` carries the field AND `getStackAbilities` gates it.
   The sweep `activation-affordability.catalogue.test.ts` auto-covers
   `exileFromGraveyard`/`life`/`removeCounter`; a **new cost shape** must be
   added to its `Shape` union.
3. New `TargetRequirement.type`? Full table above.
4. Any newly-depended-on reducer: at least one SURFACE test **through** the
   reducer (hand-built views mask dropped fields and do not count).

## Bot reachability analysis (mandatory for EVERY new card/mechanic)

The exact mirror of the section above. A card that resolves right AND renders
right can still be one the Bot never plays — it never enumerates the action,
cannot answer a choice the card raises, or has no opinion on whether the effect
is worth anything. Silent in a way the UI case is not: no test reds, the card
simply never shows up in a game against the Bot.

| Seam                                                   | Question                  | What already guards it                                                                                |
| ------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `enumerateMoves` (`gre/moves.ts`)                      | is the action REACHABLE?  | **nothing catalogue-wide** — only per-mechanic `*.bot.test.ts`                                        |
| `CHOICE_CANDIDATE_GENERATORS` + minimal-legal fallback | can the Bot ANSWER it?    | partial by design; no generator = never a search decision, no fallback = freeze                       |
| `OP_VALUERS` / `OP_BENEFICENCE`                        | does it know it WANTS to? | valuer censused by `opValuerCoverage.bot.test.ts`; **beneficence is not** — `?? "neutral"` fails open |

Procedure, checklist and the failure gallery: `docs/guides/bot-reachability.md`.

## Exhaustive target-type matching

Code switching on `TargetRequirement.type` MUST use an exhaustive helper or
list every union member (`reqTypes.includes("spell")` missing
`"spell-or-permanent"` is a bug). New type value → grep and update every
consumer.

## Serialization requirement

Every optional `GameState` field goes in `PERSISTED_OPTIONAL_KEYS`
(`serialize.ts`) or `TRANSIENT_KEYS`; the drift guard in `serialize.test.ts`
fails otherwise. New optional field: add the key, add a round-trip smoke test
with a non-empty value, run the suite.

## Code patterns

- Game state mutations are pure functions (no side effects, no async)
- Card definitions are DATA; `resolve()` only when justified
- Types from `convex/cards/types.ts` / `convex/gre/state.ts`; constants and
  helpers from `convex/gre/constants.ts` — never local
- Mana abilities use `useStack: false` (CR 605.3a)

## Primitive reuse (mandatory)

Target scale ~80k cards — one primitive per card does not scale. Before adding
a `SpellContext` primitive:

1. **Decompose** — expressible as a sequence of existing primitives?
   (Timetwister = `moveZone` ×2 + `shuffleLibrary` + `drawCards`)
2. **Generalize, don't add** — parametrize the almost-right primitive
3. **Orthogonality** — general zone/mana/life operation, never a card-shaped
   effect ("shuffleHandAndGraveyardIntoLibrary" fails; "moveZone" passes)
4. **Composition over flags** — sequence of simple primitives beats
   behavior-changing booleans

Still needed after all four? Flag it explicitly in the PR with why.

## Card definition checklist

When adding/modifying cards in `convex/cards/sets/`:

- Verify mana cost against Scryfall
- Map keywords to `staticAbilities[]` — Mechanics Registry name/pattern first
- Set `targetRequirement` for targeted spells
- **Effect Script by default**; `resolve()` only protocol-like with recorded
  justification; missing Op → issue, never a closure
- **One Oracle line = ONE `TriggeredAbility` (multi-event standard).** A
  sentence firing on several engine events ("put into a graveyard from
  anywhere" = `CREATURE_DIED` + `CARD_DISCARDED` + `CARD_MILLED`) is ONE
  ability with `event: GameEventType[]` (CR 603.2), discriminating in
  `matches` — duplicates render N times on the stack (UI bug), and
  `triggerDedup.test.ts` fails CI on same-`oracleText` duplicates. Reference:
  Worldspine Wurm (`rtr/green.ts`). (Array-`event` abilities cannot read
  `$event` in a script — an event-inspecting trigger stays scalar `event` +
  `resolve`.)
- **Token/emblem art is mandatory setup (CR 114/111)** — a missing image
  renders a placeholder, silently
  server-side:
    - **Tokens (`createToken`)**: prefer a shared spec from
      `convex/cards/sharedTokens.ts`. New token: regenerate the lockfile
      (`node scripts/fetch-token-prints.mjs --all`) or pin `imagePrintId` on
      the spec. Guard: `tokenPrintLookup.test.ts` (#1305;
      `NO_PRINTED_TOKEN_ALLOWLIST` only for genuine no-printed-token cases).
      **Blind spot:** `resolve()`-created tokens are invisible to the guard —
      pin `imagePrintId` by hand (see `ncc/colorless.ts`).
    - **Emblems (`{ op: "emblem" }`)**: set `imagePrintId` on the
      `EmblemDefinition` (`convex/cards/emblems.ts`); guard:
      `emblemArt.test.ts`.
    - **Art match rule**: the card's OWN printing's token where it exists,
      else a same-characteristics substitute — sanity-check the era.

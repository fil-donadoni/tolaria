# GRE Development Rules — resident index

When modifying `convex/gre/` or `convex/cards/`.

**This file is the index; the full text is `convex/CLAUDE.md`**, loaded on
demand at the first read of a file under `convex/`. Every `§` anchor the
codebase cites resolves there; here only the invariants.

## Rules compliance

CR-compliance is the default — never ask whether to follow it. **Print the
rule, never recall it** (`bun run cr <id>`, ADR 0098). Every mechanic cites its
CR section in a comment saying `CR ` (a wrap is read whole, #2514). Flag any
deviation explicitly.

## DSL-first authoring (ADR 0045)

A new card's effect is an **Effect Script by default** (`effects: EffectOp[]`).
`resolve()` / `resolveSteps` / `effect` are for protocol-like cards only, with
an explicit `// protocol card: <why>` + a PR note. **A missing Op is not a
justification** — stop and open an issue. Consult
`convex/cards/mechanicsRegistry.ts` first: sole name authority for keywords
and Ops.

- **Guard A — keyword-must-be-implemented (#962).** A shipped card's
  `staticAbilities[]` must resolve to a registry row with `status: "implemented"`,
  or carry a `KEYWORD_ALLOWLIST` row with a real open issue.
- **Guard B — documented-divergence-needs-issue (#962/#1900).** Every
  confession marker under `convex/cards/sets/**` carries `tracked-by: #NNN` or
  an out-of-scope note. Guard B polices markers, never licenses them: default
  is no marker — implement the clause.
- **Guard C — compiler round-trip (#2701).** A card compiles back to its own
  definition, or carries `compiler-gap: <fragment> (#issue)` above its anchor.
- **A MECHANIC is implemented WHOLE**, never partially shipped behind a marker:
  every subrule of its CR section, on every surface.
- **Per-Op test regime.** A DSL card on already-exercised Ops needs no
  hand-written test (static sweep + generated smoke test cover it). A card
  introducing a **new Op** earns that Op its permanent test.

## Testing requirement

Tests in `convex/gre/__tests__/`, each naming its CR section.

## Proof-of-failure (mandatory for every new guarding test)

**A test you have never seen fail is not evidence.** Break the guarded code,
watch red, revert, state what you broke — for every test meant to catch
something. SURFACE assertions traverse `projectPublicState` /
`buildTriggerStateView`; a hand-built view does not count.

## Card testing convention (resolve() cards and new Ops)

Colour-split per-set test files (ADR 0043); shared fixtures from
`convex/cards/__tests__/setup.ts`, never duplicated. **Every per-card test MUST
call something** — asserting definition fields is the definition written twice.

**Wire format test** mandatory for `staticEffects[]` and any
`activatedAbilities[]` outcome visible on the board: the projection strips fat
fields, so a GRE-only test passes while the client breaks silently.

## End-to-end targeting test (mandatory for new target types)

A new `TargetRequirement.type` is tested at GRE, backend and all three frontend
sites. **Every feature crossing GRE → game.ts → UI needs at least one full-path
integration test.**

## Frontend wiring analysis (mandatory for EVERY new card/mechanic)

GRE-correct can be UI-dead: the client sees only view reducers, and any can
silently drop a field — the most common recurring bug class. **Walk the
reducers before done**: `projectPublicState`, `buildTriggerStateView`,
`getStackAbilities`, `matchesTargetRequirement` / `TARGET_LABEL`.

## Bot reachability analysis (mandatory for EVERY new card/mechanic)

GRE-correct can be a card the **Bot never plays**, and nothing catches it for a
new card (censuses cover valuation only; the `blade` receipt fires on
`BOT_GLOBS`, never `cards/sets/**`). **Walk three seams**: `enumerateMoves`
(reachable?), the choice surface (can it answer?), `OP_VALUERS` +
`OP_BENEFICENCE` (does it want to? — sign fails open to neutral). Declare the
outcome in the PR like a preset scenario: a `must` blade entry, or one line
naming the covering seam. Walk: `docs/guides/bot-reachability.md`. **Ignored
and frozen are both unshipped.**

## Exhaustive target-type matching

Code switching on `TargetRequirement.type` uses an exhaustive helper or lists
every union member. New value: grep and update every consumer.

## Serialization requirement

Every optional `GameState` field goes in `PERSISTED_OPTIONAL_KEYS` or
`TRANSIENT_KEYS` (`serialize.ts`); the drift guard fails otherwise. Every
optional `CardInstanceState` field owes ONE row in `CARD_FIELD_LIFECYCLE`
(`gre/state/cardFieldLifecycle.ts`, issue #4453) — `codec` + `reset` scopes —
and no hand-written compact/expand or reset-ladder branch except a `custom`
row's declared pair; `check:ts` reds without the row.

## Naming — the mechanic, never the card (issue #1917)

Engine identifiers name the MECHANIC: `playerAttackRequirements`, never
`islandSanctuaryProtection`. Generic NAME from card #1, always (a mechanical
rename); generic SHAPE waits for card #2 to show the axis of variation.
Enforced by `convex/cards/__tests__/engineIdentifierNames.test.ts` (issue
#1918) over `gre/state.ts`, `cards/types.ts`, Op names. Derivation:
`docs/agents/gre-guards.md` § No card name in an engine identifier.

## Code patterns

Pure functions, no async. Card definitions are DATA. Types, constants: never
local copies (CLAUDE.md § Code Organization). Mana abilities use
`useStack: false` (CR 605.3b).

## Primitive reuse (mandatory)

Before adding a `SpellContext` primitive: decompose into existing ones,
generalize rather than add, keep it orthogonal (never card-shaped), prefer
composition over behaviour-changing flags. Still needed? Flag it in the PR.

## Card definition checklist

Mana cost against Scryfall; keywords via the Mechanics Registry;
`targetRequirement` for targeted spells. **One Oracle
line = ONE `TriggeredAbility`** with `event: GameEventType[]` (CR 603.2).
**Token/emblem art is mandatory setup** (CR 114/111) — a missing image renders
a placeholder silently.

# GRE Development Rules — resident index

When modifying files in `convex/gre/` or `convex/cards/`.

**This file is the index; the full text is `convex/CLAUDE.md`**, which the
harness loads on demand the first time a session reads a file under `convex/`
(measured, not assumed — see `docs/agents/context-residency-audit.md` § Lever 4
applied). Every `§` anchor cited from the codebase resolves in that file. What
stays here is the invariant a session must not violate even before it opens an
engine file; what moved is the derivation, the tables and the worked examples.

## Rules compliance

CR-compliance is the default — never ask whether to follow it. **Print the
rule, never recall it** (ADR 0098): `bun run cr <id>`, vendored, offline. Every
mechanic cites its CR section in a comment, on ONE line that says `CR `. Flag
any deviation explicitly.

## DSL-first authoring (ADR 0045)

A new card's effect is an **Effect Script by default** (`effects: EffectOp[]`).
`resolve()` / `resolveSteps` / `effect` are for protocol-like cards only and
need an explicit `// protocol card: <why>` plus a note in the PR. **A missing
Op is not a justification** — that is stop-and-open-an-issue. Consult
`convex/cards/mechanicsRegistry.ts` first; it is the single name authority for
keywords and Ops.

- **Guard A — keyword-must-be-implemented (#962).** A shipped card's
  `staticAbilities[]` must resolve to a registry row with
  `status: "implemented"`, or carry a `KEYWORD_ALLOWLIST` row with a real open
  issue.
- **Guard B — documented-divergence-needs-issue (#962/#1900).** Every
  confession marker under `convex/cards/sets/**` carries `tracked-by: #NNN` or
  an out-of-scope note. Guard B polices markers, it does not licence them: the
  default is no marker — implement the clause.
- **Guard C — compiler round-trip (#2701).** A card compiles back to its own
  definition, or carries `compiler-gap: <fragment> (#issue)` above its anchor.
- **A MECHANIC is implemented WHOLE**, never partially shipped behind a
  marker: every subrule of its CR section, on every surface.
- **Per-Op test regime.** A DSL card using only already-exercised Ops needs no
  hand-written test — the static sweep plus the generated smoke test cover it.
  A card introducing a **new Op** earns that Op its permanent test.

## Testing requirement

Tests in `convex/gre/__tests__/`, each naming its CR section.

## Proof-of-failure (mandatory for every new guarding test)

**A test you have never seen fail is not evidence.** Break the code it guards,
watch it go red, revert, state what you broke. Applies to every test whose job
is to catch something. SURFACE assertions must traverse `projectPublicState` /
`buildTriggerStateView` — a hand-built view does not count.

## Card testing convention (resolve() cards and new Ops)

Colour-split per-set test files (ADR 0043); shared fixtures from
`convex/cards/__tests__/setup.ts`, never duplicated. **Every per-card test MUST
call something** — a block that reads definition fields and asserts them is the
definition written twice.

**Wire format test** is mandatory for `staticEffects[]` and for any
`activatedAbilities[]` outcome visible on the board: the projection strips fat
fields, so a GRE-only test passes while the client breaks silently.

## End-to-end targeting test (mandatory for new target types)

A new `TargetRequirement.type` is tested at GRE, backend and all three frontend
sites. **Every feature crossing GRE to game.ts to UI needs at least one
full-path integration test.**

## Frontend wiring analysis (mandatory for EVERY new card/mechanic)

A card correct in the GRE can be dead in the UI — the client sees only view
reducers, and every reducer can silently drop a field. This is the single most
common recurring bug class. **Walk the reducers before marking done**:
`projectPublicState`, `buildTriggerStateView`, `getStackAbilities`,
`matchesTargetRequirement` / `TARGET_LABEL`.

## Bot reachability analysis (mandatory for EVERY new card/mechanic)

Mirror of the above, other side of the engine: a card correct in the GRE can be
one the **Bot never plays**. Nothing catches that for a new card — the censuses
cover VALUATION only, and the `blade` receipt field fires on `BOT_GLOBS`, which
`cards/sets/**` never touches. **Walk three seams**: `enumerateMoves`
(reachable?), the choice surface (can it answer?), `OP_VALUERS` +
`OP_BENEFICENCE` (does it want to? — the sign fails open to neutral). Declare
the outcome in the PR like a preset scenario: a `must` blade entry, or one line
naming the seam that covers it. Walk: `docs/guides/bot-reachability.md`.
**Ignored and frozen are both unshipped.**

## Exhaustive target-type matching

Code switching on `TargetRequirement.type` uses an exhaustive helper or lists
every union member. New value: grep and update every consumer.

## Serialization requirement

Every optional `GameState` field goes in `PERSISTED_OPTIONAL_KEYS` or
`TRANSIENT_KEYS` (`serialize.ts`); the drift guard fails otherwise.

## Code patterns

Pure functions, no async. Card definitions are DATA. Types from
`convex/cards/types.ts` / `convex/gre/state.ts`, constants from
`convex/gre/constants.ts` — never local copies. Mana abilities use
`useStack: false` (CR 605.3a).

## Primitive reuse (mandatory)

Before adding a `SpellContext` primitive: decompose into existing ones,
generalize rather than add, keep it orthogonal (never card-shaped), prefer
composition over behaviour-changing flags. Still needed? Flag it in the PR.

## Card definition checklist

Mana cost against Scryfall; keywords via the Mechanics Registry;
`targetRequirement` for targeted spells; Effect Script by default. **One Oracle
line = ONE `TriggeredAbility`** with `event: GameEventType[]` (CR 603.2).
**Token/emblem art is mandatory setup** (CR 114/111) — a missing image renders
a placeholder silently.

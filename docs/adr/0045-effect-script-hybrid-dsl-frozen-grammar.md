# Effect Script: hybrid declarative DSL with a frozen minimal grammar

## Status

accepted

## Context

Card effects are imperative `resolve()` closures calling `SpellContext` primitives.
At 1,180 cards this already shows three structural limits, and all three worsen
linearly toward the ~80k target:

- **Closures are opaque.** The engine, the bot (ISMCTS), and any tooling can only
  learn what a card does by *executing* it. Move ordering, target pruning, and
  static evaluation are impossible; agent-generated cards can only be validated
  by tests, never by schema.
- **Closures are not serializable.** Every card must live in the code bundle
  forever; a DB-backed registry (required for draft/sealed pool queries and for
  the 80k bundle-size wall) is unreachable.
- **SpellContext accretes card-shaped primitives.** ~140 methods, many violating
  the orthogonality rule (`setIslandSanctuaryProtection`, `addHighTide`,
  `applyCamouflagePileBlocks`) because a closure author under pressure asks for
  a bespoke method rather than composing.

The player-choice system is *not* part of the problem: `PendingChoice` is already
a single generic data format (~20 kinds, 4 generic mutations, one UI router).

## Decision

**Effects become declarative data — an Effect Script — wherever possible;
`resolve()` remains as the escape hatch.**

An Effect Script is an ordered list of **Ops** (`dealDamage`, `draw`, `destroy`,
`choice`, …) connected by **exactly four structural constructs, frozen forever**:

1. **bind** — name an op's result for later steps (`bind: "$picked"`)
2. **ref** — read a runtime property or count a declaratively-selected set
   (`{ ref: "$target.power" }`, `{ count: { zone, filter } }`)
3. **if** — predefined predicate forms, then/else branches
4. **forEach** — declarative set selector + sub-list with `$each`

No expressions, no arbitrary loops, no mutable variables. **The Op vocabulary
grows freely; the grammar never does.** Whoever needs a sixth construct must
reopen this ADR. This is the explicit defence against the Forge failure mode:
a Turing-complete "data" language in JSON with no type-checker, no debugger,
and no bot readability — a worse TypeScript. We already have a Turing-complete
escape hatch (`resolve()`, with real type-checking, tests, and debugging);
protocol-like cards (Word of Command, Camouflage, ~10–15% of the pool) belong
there, not in an ever-fatter grammar.

**One execution path.** The interpreter executes Ops by calling the existing
SpellContext primitives — no parallel engine. Effect Scripts apply to every
effect site: spell resolution, triggered-ability and activated-ability effects.
The SpellContext audit happens *inside* the Op-vocabulary design: orthogonal
primitives become Ops; card-shaped ones stay engine-internal, callable only
from `resolve()`, and die by attrition as their cards migrate.

**DSL-first is mandatory for new cards.** A new card is written as an Effect
Script; `resolve()` requires an explicit justification in the PR ("protocol
card: restructures blocking piles"). Without this rule agents keep writing
closures by inertia and the DSL never reaches critical mass. Existing cards
stay in their current form; migration is a separate spot/mass activity.

**The Mechanics Registry governs names.** A machine-readable census of every
CR keyword ability (702) and keyword action (701) — ~240 rows with
`status: implemented | planned | out-of-scope` and the engine binding (Op name
or static ability). It is the single authority: a card declaring an unlisted
static ability, or a script using an unlisted Op, fails CI. Census is total;
implementation is demand-driven — a row costs nothing, building an Op waits
for its first card.

**Testing shifts from per-card to per-Op.** The interpreter/Op suite is
exhaustive (each Op, each construct, the known-treacherous compositions:
choice-inside-forEach APNAP, bind across suspended resolution, ref after zone
change) — including wire-format tests per Op, once, instead of per card.
DSL-only cards using already-exercised Ops get static validation (schema, ref
check, vocabulary) plus an auto-generated canned-scenario smoke test derived
from the script. Cards introducing a new Op get the full regime — as the Op's
test, inherited by every later card. `resolve()` cards keep today's full
regime. Existing per-card tests are **kept as the migration harness** (green
before / green after proves behaviour preserved) and retired gradually only
after their card has migrated. An LLM transcription judge (script ↔ Oracle
text) was considered and deferred.

## Consequences

- Cards written as Effect Scripts are serializable documents (see ADR 0046),
  bot-readable (static priors, target pruning — a follow-up initiative), and
  schema-validatable at generation time.
- Two authoring modes coexist indefinitely; the DSL-first rule plus the PR
  justification keeps the escape hatch at protocol-cards only.
- The grammar freeze will be tested by real cards; the pressure valve is a new
  Op (cheap, encouraged), never a new construct.
- Effect-Script coverage is expected around 80–85% of the vintage-era pool;
  that estimate, not 100%, is the design point — chasing the tail is
  explicitly rejected.

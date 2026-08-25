# The Oracle compiler compiles, never authors: fail-closed and all-consuming, gold as the oracle, the lockfile as the source of truth

## Status

accepted

## Context

Tolaria's card pool is ~2,026 hand-written `CardDefinition`s and grows one card
at a time. Against the 34,890 Oracle cards Scryfall tracks that is 5.8%; against
Premodern it is 1,307 of 5,375 (24.3%). PRD #2693 measured that most of the gap
is not new mechanics but new **compositions** of Ops the engine already has, and
proposed compiling Oracle text into Effect Scripts instead of writing cards.

The prior art is a warning, not a template. phase.rs — a Rust/WASM engine born
the same week — reaches 88% "supported" by parsing Oracle text permissively, and
its own audit reports ~4,700 cards silently misparsed. Every documented shape is
the same defect: **a rule matched part of its input and the remainder went
nowhere.** A dropped trailing filter ("target creature" for "target creature you
don't control"), a dropped intervening-if, a conjunction whose second half
vanished, "for each" collapsed to a constant, anaphora bound to the wrong
referent. None of it is visible in the output. The player finds out in a game.

The user's constraint is explicit and it is the whole design brief: **a compiler
that ships 10–20 broken cards per 100 is worse than no compiler.** Coverage is
cheap and worthless; correctness on what is covered is the only thing being
bought.

## Decision

### 1. Compile, never author

`convex/oracle/` is a pure module (no Convex, no `node:fs`, no network,
importable by scripts and by the client per ADR 0074) that turns an Oracle card
into a `CardDefinition` whose effect is an Effect Script (ADR 0045). It never
emits TypeScript and never emits a closure — `CompiledDefinition` is
`CardDefinition` with every function-valued field (`resolve`, `resolveSteps`,
`effect`, `entersTappedUnless`) **removed from the type**, so a compiler that
tried to author a closure would not type-check.

`resolve()` remains what ADR 0045 says it is: the fallback for protocol-like
cards, hand-written. The compiler does not chase it.

### 2. Fail-closed and all-consuming — as types, not as checks

The invariant is easy to state and easy to fake. It is enforced at four levels,
each structural rather than checked:

**Combinators carry no residue.** `RuleResult<T>` on success is `{ ok, value }`
and nothing else. There is no `rest` field, so a caller cannot forget to check
one. A `Rule<T>` consumed its entire span or it failed. Leaves are `atom` (exact
table lookup, no regex at all) and `pattern`, whose regex must be anchored
`^…$` — enforced by a **throw at construction**, because an unanchored regex
reintroduces prefix-matching invisibly.

**Structure is built by splitting, not by advancing a cursor.** `pair` and
`listOf` take their sub-spans from `String.split`, whose parts satisfy
`parts.join(sep) === span` as an identity. Coverage is algebra, not an assertion
someone remembered to write.

**There is no first-branch fallback anywhere.** `oneOf` is not `alt`: it runs
every alternative and requires **exactly one** to succeed; two successes are an
ambiguity and fail the card. `pair` likewise tries every occurrence of its
separator and fails if more than one split parses. Rule order is therefore not
load-bearing, which is the property being bought — a broad rule cannot shadow a
precise one.

**The slot router uses unique dispatch, not a priority ladder.** PRD #2693
sketched an ordered ladder (keyword → activated → triggered → static → spell). A
ladder is a first-branch fallback wearing a different hat, so the router instead
runs all six slots and requires exactly one to consume the line; zero is
`unparsed`, two or more is `unparsed` with an ambiguity reason. **Grammar v0 has
no catch-all slot** — spell text is refused, not best-effort parsed.

**A partial parse has no representation.** `CompileOutcome` is a union in which
`unparsed` carries no `definition` and `ready` carries no `gaps`. A
half-compiled card is not a value this codebase can hold.

**One unconsumed line fails the whole card,** not just that ability. A definition
missing one of its abilities is worse than no definition: it looks playable and
plays wrong.

### 3. Three states, five gates, all computed

`ready` requires: an all-consuming parse; every Op `implemented` in the Mechanics
Registry; every keyword `implemented` there; `validateEffectScript` green; the
generated smoke scenario green where there is a script to smoke; and the
definition surviving a JSON round trip unchanged. `quarantine` is any of those
failing, **with a reason** — it is not a soft pass, a quarantined row is as
unplayable as an unparsed one. `unparsed` is residue. States are computed; there
is no way to assign one.

The gates never throw. `planSmokeTest` throws on a script that has not passed
static validation, so the smoke gate is skipped when validation already failed
and wrapped in a catch otherwise: a gate that throws does not fail one card, it
aborts a 35,000-card run and the symptom is a lockfile that simply stops.

### 4. Gold as the oracle; precision is gated, recall is only reported

Every hand-written card is compiled from its own Oracle text on every run and
compared to the hand-written definition. **Of the cards the compiler accepts,
100% must match — this is a gate.** Recall (how many it accepts) is reported and
never gated: v0 refuses far more than it accepts by design, and a recall gate
would be direct pressure to accept doubtful cards.

Comparison is over the BEHAVIOURAL projection only — every ability, effect,
static effect, target requirement, cost rider. `manaCost`/`types`/`power` are
structured Scryfall fields no grammar touches, and `aiValue`/`aiCombatHint`/
`aiEffects` are hand-tuned Bot hints with no Oracle text behind them; comparing
them would measure the fixture. A **function is rendered as the sentinel
`"[closure]"`, never dropped** — `JSON.stringify` silently discards
function-valued fields, which would have let the harness bless a compiled card
as equal to a hand-written card whose behaviour lives in a `resolve()` body.

Two normalisations are stated rather than assumed: per-ability `id` and
`oracleText` are engine-internal handles and display strings; and a legacy
`effect` closure on a FIXED-OUTPUT mana ability is dead code, because
`convex/gre/effects/validate.ts` records that a mana authority recognises a mana
ability by its descriptor and "never by reading an `effects` body, which a
fixed-output mana ability does not execute at all".

Comparison runs through the real registry seam (`expandDefinition`, ADR 0046),
exported for this purpose — otherwise every implicit-keyword card (exalted,
prowess, fading N) reads as a compiler bug because the gold side has injected
abilities the compiled side has not yet been through the seam to receive.

Hand-written cards with **no `oracleText` field at all** are excluded from the
harness and counted separately. The input is missing, not empty; compiling `""`
would score a card with real rules text as a vanilla match. A missing fixture is
not a passing test.

### 5. The lockfile is the source of truth; the corpus is not committed

`data/oracle-compiled.json` is generated by `bun run oracle:compile`, never
hand-edited (the `card-index.json` pattern). One row per oracle id, with the
state, the definition when there is one, and — for `unparsed` — indexes into a
**fragment table deduplicated and sorted by how many cards each fragment
blocks**. That table is the grammar backlog: it is what ranks the next rule by
corpus count instead of by which card someone happened to look at.

It is serialized with **one row per line** rather than by `JSON.stringify(…, 4)`
so a card moving `ready` → `unparsed` is a single changed line in review. It is
therefore in `.prettierignore`, and it is ~11 MB — accepted, because
diffability is the reason it is committed at all; if that becomes a problem the
lever is the fragment table, not the per-card rows.

The 24 MB Scryfall cache (`data/oracle-corpus.json.gz`) is **gitignored**;
`data/oracle-corpus.pin.json` is committed and identifies the exact bulk object
(uri, Scryfall's `updated_at`, row count, sha256), which is what "pinned" means
here.

The corpus is `oracle_cards`, not `default_cards`, because rules text is a
property of the oracle card. Layouts that are not cards (art series, tokens,
emblems, Vanguard/Scheme/Plane) are excluded. Paper-ness is **deliberately not**
filtered: `scripts/fetch-full-catalogue.mjs` documents that an `oracle_cards`
row is one representative printing which can be digital-only, so
`games.includes("paper")` on these rows asks the wrong question — measured here
at 702 Premodern-legal cards wrongly dropped (5,375 → 4,673).

### 6. The drift guard is tiered because the gate is offline

`bun run check:oracle` runs in `check:all:inner`. Full regenerate-and-diff needs
the gitignored corpus, and the gate is offline by contract, so the guard is
tiered and every tier that can run, runs:

1. **Header hashes** (always, offline): the lockfile pins a hash of
   `convex/oracle/**` and a hash of the Mechanics Registry's names and statuses.
   Either changing changes what the compiler emits. This catches the failure
   that actually happens — a rule edited without regenerating.
2. **Pin agreement** (whenever the pin is present).
3. **Full regenerate-and-diff** (whenever the cache is present).

Tier 1 is not a weaker tier 3; shipping only tier 3 would make the guard a
silent no-op on every clean checkout, which is the shape of a guard that is not
there. The grammar hash covers all of `convex/oracle/**`, including files like
`gold.ts` that cannot change the output — a conservative over-approximation that
costs one redundant regeneration and never misses a real one.

## Consequences

- Grammar v0 covers vanilla cards, keyword lines and mana abilities: **1,127
  ready / 130 quarantine / 33,633 unparsed** of 34,890; Premodern 222 ready of
  5,375. That number is small on purpose. The four remaining slots and the six
  shared sub-grammars (target filter, quantity, duration, condition, player ref,
  zone ref) ship as stubs **that fail**, with their own tests, so #2697–#2700
  extend rather than invent.
- A stub that returns a neutral value would be a silent misparse waiting for its
  first caller; every stub in this module fails and names its ticket.
- Cards with a basic land type are `unparsed`: CR 305.6 gives them an intrinsic
  mana ability the text box does not state, and the catalogue answers "should
  the definition carry it explicitly?" both ways for load-bearing reasons
  (`getBasicLandMana` returns only the FIRST basic subtype's colour). Guessing
  would be a precision failure; see `docs/findings/`.
- Compiled rows are not yet hydrated through `getDefinition` — that is #2702.
  Until then the wire-projection round trip is proven catalogue-wide against
  gold in `convex/oracle/__tests__/wireProjection.test.ts`, where the registry
  is available, rather than faked inside the gate.
- Every grammar rule carries a one-line CR citation; `cr:lint` covers this
  module like the rest of the engine.

## Alternatives considered

- **A priority ladder for slot routing** (as PRD #2693 sketched). Rejected: it
  is first-branch fallback, and it makes rule order silently load-bearing.
  Unique dispatch costs six rule runs per line and buys order-independence.
- **Standard `{ value, rest }` combinators with an all-consuming check at the
  top.** Rejected: one checked exit is one place to forget, and every
  intermediate call site can still drop `rest`. Removing the field removes the
  failure mode.
- **Committing the corpus** so the drift guard could always regenerate.
  Rejected: 24 MB of third-party data that changes weekly, whose only role is to
  produce an artefact the repo already commits.
- **Gzipping the lockfile** to cut 11 MB to ~1 MB. Rejected: it would end
  reviewable diffs, which PRD #2693 names as the point of committing it.
- **Gating recall as well as precision.** Rejected: it is an incentive to accept
  cards the grammar does not really understand, which is the failure being
  designed against.

## References

- PRD #2693 (Oracle compiler), issue #2694 (this slice), #2697–#2700 (slot
  grammars), #2701 (Guard C), #2702 (hydration)
- ADR 0045 (Effect Script), ADR 0046 (registry seam), ADR 0074 (authority
  boundary), ADR 0080 (Full Catalogue / `default_cards`), ADR 0098 (vendored CR)
- CR 113.3a–d (ability categories), CR 201.5 (self-reference), CR 205.1 (type
  line), CR 207.2a (reminder text), CR 305.6 (basic land types), CR 602.1a
  (activation cost), CR 605.1a / 605.3b (mana abilities), CR 702.1 (keywords)

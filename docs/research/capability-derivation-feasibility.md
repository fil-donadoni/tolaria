# Deriving Capabilities from structured card definitions: is it feasible? (PRD issue #3602)

Measured at 1a5b57b60 (2026-11-14), unless a figure says otherwise.

## The question

ADR 0130 makes the play Bot's Plan a vector of unmet Capabilities, DERIVED from
structured definition fields — never from an id, a name or Oracle text (§4).
The audit of PRD issue #3602 asked whether that derivation is feasible before
any of it is built: how well do structural rules reproduce the Card
Capabilities layer (ADR 0167, `data/card-profiles/capabilities.json`), and what
in a `CardDefinition` is opaque to a reader that is not the engine?

## Method

Throwaway scripts, kept under `docs/research/scripts/capability-derivation/`
and run from the repository root. None is a gate; none is imported by code.

| script                | what it measures                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `derive-spike.mjs`    | first-pass structural rules per registry row, compared with the layer: precision, recall, disagreeing cards, per-rule firings   |
| `trigger-count.mjs`   | catalogue triggers, and how many arrive from the compiler with a JSON head                                                      |
| `closure-scan.mjs`    | source text of every hand-written `matches` / `condition` / `interveningIf` closure, with the card's state in the compiled pool |
| `closure-classify.py` | sorts those closures by the cheapest rewrite                                                                                    |
| `head-infer.mjs`      | prototype: infers a closure's trigger head by differential execution against the trigger factories                              |
| `closure-census.mjs`  | every closure on a hand-written definition, by property key                                                                     |
| `gold-stats.mjs`      | totals of the structural gold harness (`convex/oracle/gold.ts`) over the hand-written catalogue                                 |

The derivation rules in `derive-spike.mjs` were written once and not tuned
against the layer. The layer's rows are LLM-seeded and none is reviewed, so
"precision" and "recall" below measure AGREEMENT with an uncertified bench, not
correctness.

## Result 1 — the derivation works where the row is mechanical

Catalogue: 10,033 cards. Cards whose body is an imperative `resolve()` /
`effect` with no script to walk: 94 (0.9%). Layer rows: 427.

| side     | Capability       | precision | recall | reading                                             |
| -------- | ---------------- | --------- | ------ | --------------------------------------------------- |
| provides | cheap-spell      | 100%      | 99%    | mechanical                                          |
| provides | cheap-artifact   | 83%       | 100%   | mechanical                                          |
| provides | big-artifact     | 83%       | 100%   | mechanical                                          |
| provides | cheat-target     | 93%       | 78%    | mana-value proxy                                    |
| provides | value-on-attack  | 90%       | 93%    | trigger event                                       |
| provides | value-on-etb     | 86%       | 84%    | trigger event + `etbAbility`                        |
| provides | value-on-death   | 80%       | 89%    | trigger event                                       |
| requires | reanimatable     | 80%       | 62%    | Op shape; misses are unwritten rules                |
| requires | value-on-cast    | 71%       | 94%    | trigger event                                       |
| requires | cheap-spell      | 68%       | 71%    | trigger event, scope opaque                         |
| provides | reanimatable     | 54%       | 93%    | judgement row: mana value ≥ 6 or power ≥ 6 proxy    |
| provides | land-enters      | 53%       | 77%    | the layer misses most fetch lands                   |
| provides | discard-outlet   | 50%       | 61%    | the layer skips cycling                             |
| provides | go-wide          | 29%       | 92%    | judgement row: rule fires on any repeatable token   |
| provides | sacrifice-fodder | 14%       | 100%   | judgement row: rule fires on any token maker        |
| provides | self-mills       | 100%      | 29%    | no rule yet for surveil and fetch-land shuffles     |
| provides | value-on-cast    | 53%       | 21%    | no rule yet for free spells and rituals             |
| requires | discard-outlet   | 53%       | 27%    | no rule yet for "scales with the graveyard"         |
| requires | self-mills       | 53%       | 25%    | same                                                |
| requires | land-enters      | —         | 0%     | the landfall filter sits inside a `matches` closure |
| requires | go-wide          | —         | 0%     | same, for "a creature you control enters"           |
| requires | value-on-attack  | —         | 0%     | same                                                |

The full table (every row, true/false positives, per-rule firing counts on the
whole catalogue, the disagreeing cards by name) is the script's output.

### Where the disagreements come from

1. **The layer is often the side that is wrong.** Three cases contradict the
   registry's own glosses (`convex/limited/capabilityRegistry.ts`): fetch lands
   are named as `land-enters` providers and the layer tags a minority of them;
   cycling is named as a `discard-outlet` and the layer skips the cycling
   lands; cheat spells (Sneak Attack, Flash, Through the Breach) are tagged as
   value payoffs but not as `cheat-target` requirers. A structural derivator is
   a checker for the layer as much as the reverse.
2. **Rules not written yet, over shapes that are readable.** Reanimation from
   the top of a graveyard without a target, split-card halves, "scales with the
   graveyard" (the `graveyardCastMechanism` authority and the delirium /
   threshold counts already exist), free spells and rituals, surveil.
3. **Thresholds are judgement, as ADR 0130 §6 and §14 already say.** The
   `reanimatable` proxy admits Uro and Phlage. For these rows a boolean on the
   provides side may be the wrong shape for the play Bot altogether: ADR 0130
   §7 prices a requirer by its best legal target and §8 counts the best
   provider once, so satisfaction can be the requirer's own filter (already
   data: Unearth's `mvFilter`) and worth the value model that exists. Raised as
   a design question on issue #3608; not verified against the evaluation code.

## Result 2 — the opacity that matters is `matches`, not `resolve()`

A `TriggeredAbility` has a readable `event` and a `matches(event, self, state)`
closure. Scope ("this creature" vs "a creature you control") and filter ("a
land") live inside the closure, so "when this dies" and "whenever a creature
dies" are indistinguishable to a reader. That is what caps the trigger rows
above.

The closure is built from data that already exists and is then dropped:

- A trigger factory (`convex/cards/abilities/triggers/*.ts`) receives
  `args.scope: PermanentScope` and `args.filter: PermanentFilter`, closes over
  them, and keeps neither.
- A compiled trigger travels as a JSON descriptor with a
  `head: CompiledTriggerHead` (`convex/cards/compiledTriggers.ts`), and
  `resolveCompiledTrigger` hands it to the SAME factories. After hydration the
  head is gone.

| population                                                      | triggers |
| --------------------------------------------------------------- | -------- |
| catalogue triggers                                              | 3,297    |
| compiled, with a JSON head before hydration                     | 2,479    |
| hand-written closures (`matches`, `condition`, `interveningIf`) | 248      |

The precedent for restating part of a closure as data for non-engine readers
exists four times over, each stamped by a factory and never read by the
engine: `gate` (issue #1936), `phaseScope` / `phaseStep` (issue #5164),
`sourceTapCondition` (issue #5578), `etbAbility` (issue #4758). A stamped
trigger head would generalise three of them (`etbAbility`, `phaseScope`,
`phaseStep` are all readable off a head).

Other readers already work around the same hole:

- `convex/gre/ai/botReach.ts` reads `head.kind === "entered" && head.scope ===
"self"` off the raw descriptors, before hydration — so a hand-written card's
  own enter trigger is invisible to it.
- The gold comparison renders `matches` as `"[closure]"`. A hand-written
  trigger with a raw `matches` makes its card `incomparable` even when the
  compiler reads it (Eternal Witness), and where both sides are factory-built
  the scope is compared only through a restated field. No false `equal` was
  looked for; that check belongs to the ticket that stamps the head.

## Result 3 — almost every hand-written closure is rewritable

248 closures on 212 hand-written cards, sorted by `closure-classify.py`:

| strategy                                                             | closures |
| -------------------------------------------------------------------- | -------- |
| 1. graduation — the card already compiles `ready`                    | 29       |
| 2. an existing factory or head expresses it (scope, filter, host, …) | 90       |
| 3. `conditionOnSelf`, a decidable gate                               | 24       |
| 4. an existing compiled condition kind                               | 26       |
| 5. new but generic vocabulary                                        | 38       |
| 6. card-shaped, or read by hand                                      | 41       |

Of the 41, a reading by hand puts roughly 22 under strategies 2–4, 10 under
new generic vocabulary and under 10 as genuinely card-shaped (Orcish
Bowmasters' "except the first one each draw step", Jihad's chosen colour, Wall
of Caltrops). So roughly three quarters are a mechanical rewrite with no new
vocabulary, a fifth need four or five vocabulary extensions each backed by
several cards (the largest: a `blocks` / `becomes-blocked` head, 21 closures),
and a handful stay closures.

The regexes are a first-pass sort, not a proof. "Rewritable" means expressible
through a factory or head; only strategy 1 is a claim about the compiler.

Of the 211 named cards, 70 are on the vintage-cube or modern-metagame Targets
(ad-hoc join at 309ea073c, not kept as a script).

### The rewrite can be inferred mechanically

`head-infer.mjs` runs each hand-written `matches` and every candidate factory
configuration (factory × scope × a small filter set) on synthetic events, and
keeps the candidate that answers identically on all of them. On three event
types (attack, death, entry):

| closures in scope | inferred, zero disagreements |
| ----------------- | ---------------------------- |
| 64                | 56 (88%)                     |

The 8 misses are exactly the closures that need vocabulary the factories do
not have ("attacks alone": Noble Hierarch, Rogue Kavu; a power/toughness
filter: Sword of the Meek; "play a land": City of Traitors). The same harness
serves as the codemod's source, as its equivalence check, and as the generator
of the residue list. State-reading `condition` closures are a poorer fit and
want templates instead.

## Result 4 — the catalogue-wide cleanup already has a pipeline

Retiring a hand-written card whose compiled twin is proven equal is ADR 0114,
and `gaps:sync` files the `Migration:` tickets per gold bucket.

| hand-written population                       | cards |
| --------------------------------------------- | ----- |
| total                                         | 2,270 |
| accepted by the compiler (`ready`)            | 935   |
| structurally equal to their compiled twin     | 807   |
| incomparable (a closure the diff cannot read) | 116   |
| mismatching                                   | 12    |
| carrying at least one closure                 | 1,284 |

Closures by property key, hand-written definitions only: `matches` 827 (680
cards, factory-built ones included), `resolve` 464, `applies` 373, `effect`
145, `condition` 68, `interveningIf` 56, `predicate` 51, `resolveSteps` 41.
`applies` — the static-effect filter — is the same shape of problem as
`matches` and is out of scope here.

## What was decided on these numbers

- The Plan reads DERIVED Capabilities; the layer is the bench and gains a
  checker (recommendation of the audit, recorded on issue #3602).
- A trigger head stamped by the factories is the prerequisite of deriving the
  whole vocabulary (issue #3609). It is engine and compiler infrastructure with
  four readers, so it gets its own PRD — "triggers are data", with the
  authority flip (`matches` derived from the head, a closure as the escape
  hatch, as ADR 0045 did for `resolve()`) as the stated destination — to be
  shaped with `/grill`.
- PRD issue #3602 is sequenced after that PRD. Its first slice (issue #3608,
  reanimation) needs no trigger head and stays the place where the design's
  real risk — the pricing mechanism — is taken.

## Limits

- One pass of rules, no tuning; the layer is unreviewed. No number here is a
  threshold.
- The closure classification is by regex over source text; the inference
  prototype covers three event types of the dozen in use.
- Figures move with the catalogue: 309ea073c and 1a5b57b60 differ by 15 cards
  and one registry row (`lands-in-graveyard`).

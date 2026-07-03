# Effect Script migration playbook: `resolve()` → `effects[]`

The carved-in-stone procedure for converting an existing imperative `resolve()`
card into a declarative Effect Script (`effects[]`, ADR 0045). Prescriptive
enough to run AFK: follow the steps in order, run the exact commands, stop at the
first gate that fails.

**Scope.** This playbook is for **migrating existing cards**. New cards are
DSL-first by mandate (ADR 0045) and never start as `resolve()`. Bulk migration of
the ~1,180 existing cards is a separate future activity; this document is the
proven procedure that activity will execute one card at a time.

**The one invariant that makes migration safe.** A migration is a **pure
refactor**: the card behaves identically before and after. The proof obligation
is the card's **pre-existing per-card test**, left byte-for-byte untouched. Green
before + green after = behavioural equivalence. That test is the _migration
harness_. If migrating a card forces you to change its test, you have changed
behaviour — stop, the migration is wrong.

---

## Machinery reference (read once)

| Thing                                                                  | Location                                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `effects?: EffectOp[]` field on `CardDefinition` / abilities           | `convex/cards/types.ts` (`CardDefinition.effects`, `ActivatedAbility.effects`)                            |
| The `EffectOp` union (every Op's shape)                                | `convex/cards/types.ts` (`export type EffectOp`)                                                          |
| Op name authority (registry)                                           | `convex/cards/mechanicsRegistry.ts` (`EFFECT_OP_REGISTRY`, `isRegisteredEffectOp`)                        |
| Interpreter (executes Ops via SpellContext)                            | `convex/gre/effects/interpreter.ts` (`runEffectScript`)                                                   |
| Dispatch seam (compiles `resolve()` **or** `effects[]` to one closure) | `convex/cards/effectRegistry.ts` (`getResolveFn`, `getAbilityEffectFn`)                                   |
| Static validation                                                      | `convex/gre/effects/validate.ts` (`validateEffectScript`)                                                 |
| Catalogue-wide validation + JSON-purity sweep                          | `convex/cards/__tests__/effectScripts.test.ts`                                                            |
| Auto-generated canned-scenario smoke sweep                             | `convex/cards/__tests__/effectScriptSmoke.test.ts` (generator: `convex/gre/effects/scenarioGenerator.ts`) |
| Mechanic-name authority sweep                                          | `convex/cards/__tests__/mechanicsRegistry.test.ts`                                                        |

The dispatch seam is why migration is invisible to the engine: `getResolveFn(def)`
returns `def.resolve` when present, else `compileEffectScript(def.effects)`. Both
authoring modes collapse to the same `(ctx: SpellContext) => void` closure, run
through the same `resolveTopOfStack` path. The engine never knows which mode
authored the card — so an equivalent `effects[]` script is behaviourally
indistinguishable from the `resolve()` it replaces.

---

## Op vocabulary at a glance

A card is migratable only if **every** clause of its effect maps onto a
registered Op (source of truth: `EFFECT_OP_REGISTRY` in
`convex/cards/mechanicsRegistry.ts`). Current verbs:

`dealDamage` · `draw` · `gainLife` · `loseLife` · `destroy` · `exile` ·
`discard` · `sacrifice` · `counter` · `choice` · `mayPay`

plus the four frozen structural constructs (grammar, never grows): **bind** (a
field snapshotting an object), **ref** (`{ ref: "$x.power" }` / bare `{ ref:
"$each" }`), **if** (`{ op: "if", predicate, then, else? }`), **forEach** (`{ op:
"forEach", select, effects }`).

Runtime numbers are **only** a literal, a `ref`, or a `count` — `EffectValue =
number | { ref } | { count }`. There is **no arithmetic and no chosen-cost (X)
value construct.** A card whose amount is `ctx.getX()` or `a + b` is **not
migratable today** (see § Non-migratable).

Announced targets map by position: `ctx.targets[0]` → `{ target: 0 }`.

---

## Step-by-step procedure

### Step 0 — Assess migratability

Answer all four. A single **no** routes the card to § Non-migratable (record the
justification and stop).

1. **Ops covered?** Does every clause of the oracle text map onto a registered
   Op above? (Cross-check `EFFECT_OP_REGISTRY`.)
2. **Values expressible?** Is every numeric amount a literal, a count of a
   declaratively-selected set, or a bound object's power/toughness? (No `X`, no
   arithmetic, no "equal to the number of …" that `count` can't express.)
3. **Targets positional?** Does the effect act on announced target slots,
   relative players (`controller`/`opponent`), or a declarative `forEach` set —
   nothing read out of an opaque closure variable?
4. **No protocol behaviour?** The card does **not** restructure the game's
   control flow (rewriting blocking piles, taking control of another player's
   turn, subgames, ante). Protocol cards stay `resolve()` **permanently** by
   design (ADR 0045, ~10–15% of the pool).

### Step 1 — Establish green-before (the harness baseline)

Locate the card's per-card test (`convex/cards/sets/<set>/__tests__/<colour>.test.ts`,
the `describe` block named after the card). Run it **before touching anything**:

```
bun run test convex/cards/sets/<set>/__tests__/<colour>.test.ts
```

It must be green. This is the baseline the migration must preserve. **Do not edit
this test at any point in the migration.** If the card has no per-card test, it is
not eligible for AFK migration — author a behavioural test first (green-before is
the whole safety mechanism), or hand the card to a human.

### Step 2 — Transcribe the oracle text into `effects[]`

Write the Effect Script from the **oracle text** (modern Scryfall, ADR 0004), not
by paraphrasing the closure. The closure is the equivalence oracle, not the
spec. Each sentence of rules text becomes one Op (or one structural construct).

Delete the `resolve:` closure and add `effects:`. Keep everything else
(`id`, `name`, `rarity`, `manaCost`, `types`, `targetRequirement`,
`aiCombatHint`, …) exactly as-is — those fields are orthogonal to the effect
body. `effects` is **mutually exclusive** with `resolve`/`resolveSteps`/`effect`;
leaving both throws at the dispatch seam and fails the catalogue sweep.

Refer to the in-repo reference shapes for the common patterns:

| Pattern                       | Reference card                        | Shape                                                      |
| ----------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| fixed damage to a target      | Lava Spike (`chk/red.ts`)             | `[{ op: "dealDamage", amount: 3, to: { target: 0 } }]`     |
| target player draws N         | Ancestral Recall shape                | `[{ op: "draw", player: { target: 0 }, count: 3 }]`        |
| exile + gain life = its power | Swords to Plowshares (`lea/white.ts`) | `exile … bind: "$c"` then `gainLife … { ref: "$c.power" }` |
| each player sacrifices        | Innocent Blood (`ody/black.ts`)       | `forEach` players → `choice` + `sacrifice`                 |
| counter unless pays           | Force Spike (`leg/blue.ts`)           | `mayPay` + `if` on `$paid` → `counter`                     |
| destroy all creatures         | Day of Judgment (`m11/white.ts`)      | `forEach` permanents → `destroy { ref: "$each" }`          |

### Step 3 — Establish green-after (the equivalence proof)

Re-run the **same untouched** per-card test plus the two catalogue sweeps that
now automatically include the card:

```
bun run test convex/cards/sets/<set>/__tests__/<colour>.test.ts \
             convex/cards/__tests__/effectScripts.test.ts \
             convex/cards/__tests__/effectScriptSmoke.test.ts
```

- The per-card test green (unchanged) is the behavioural-equivalence proof.
- `effectScripts.test.ts` statically validates the new script (schema, Op
  vocabulary, ref-check, JSON purity) across the whole catalogue.
- `effectScriptSmoke.test.ts` **auto-discovers** the card (any card with
  `card.effects !== undefined` is collected with zero opt-in) and runs a
  generated canned scenario through the real `resolveTopOfStack`, asserting the
  outcomes the script declares.

If the generated smoke reports the card as a **SKIP** (e.g. its outcome depends
on a live choice or a runtime `ref`), that is expected for the suspending/branching
Ops — the per-card test remains the behavioural guarantor; the smoke is a free
bonus for the fixed-outcome ops.

### Step 4 — Redundant-test retirement

Migration does **not** delete tests by default. Apply this rule per test:

- **RETIRE** a per-card test **only** when it is a plain restatement of the
  script's own declared outcome — "casts, resolves, deals N to the target",
  "target player's hand shrinks by N" — i.e. exactly what the auto-generated
  canned-scenario smoke now asserts for free. Such a test is redundant coverage
  once the smoke sweep covers the card, and only _after_ green-after is verified.
- **KEEP** any test that encodes a **CR-referenced interaction** or an edge case
  the smoke generator does not model: targeting legality (what is/isn't a legal
  target, CR 115/120), zone-change side effects, regeneration/indestructible,
  replacement effects, dies-triggers, last-known-information reads, APNAP
  ordering, "does as much as it can" partial resolution (CR 608.2b). These are
  the tests whose `describe`/`it` names cite a CR rule — they prove the card
  behaves under interaction, which no generated smoke asserts.

When in doubt, **keep**. A retained test costs a few milliseconds; a wrongly
retired one silently drops interaction coverage. Retirement is opportunistic
cleanup, never a migration requirement — a migration whose card keeps its whole
test block is complete and correct.

### Step 5 — Full gate + PR

Before marking done, run the full gate once (CLAUDE.md § Quality gates):

```
bun run check:all
bun run test
```

Zero errors, zero failures (green-main invariant). No preset scenario is required:
a behaviour-preserving migration is a **pure refactor with no user-visible change**
(dev-workflow step 7 explicitly exempts these). Commit; PR notes the card, the Op
it maps to, and that the per-card test passed unchanged.

---

## Non-migratable assessment path

A card that fails any Step 0 check stays `resolve()` **and the reason is recorded
in a code comment on the card definition** so the next agent does not re-assess it
from scratch. Format:

```ts
// NOT DSL-migratable (ADR 0045): <one-line reason>.
// Blocked on: <missing Op / missing value construct / protocol behaviour>.
resolve: (ctx: SpellContext) => { … },
```

Two genuine classes today:

- **Missing value construct — chosen cost (X).** The `EffectValue` grammar is
  `literal | ref | count`; there is no "X" (chosen-cost) value. _Stream of Life_
  ("Target player gains X life", `ctx.gainLife(t, ctx.getX())`) and _Earthquake_
  ("X damage to each …") are otherwise trivial `gainLife` / `dealDamage` scripts
  blocked solely on an X value construct. These are **planned-migratable**: record
  the block, leave the card `resolve()`, and (if the class is worth unblocking)
  open an issue to add an X `EffectValue` member — extending the _Op value
  grammar_ is cheap and does not reopen ADR 0045 (only a fifth _structural
  construct_ would).
- **Protocol behaviour — permanent.** Cards that restructure control flow (Word
  of Command acting-player, Camouflage blocking piles) stay `resolve()` by design;
  the escape hatch exists exactly for them. Record "protocol card" and move on —
  do **not** open an Op issue.

Distinguish the two in the comment: _planned-migratable_ (blocked on a named Op /
value construct, worth an issue) vs _permanent_ (protocol, no issue).

---

## Worked example — the pilot (Lightning Bolt), each step as executed

The migration this playbook was validated against. `convex/cards/sets/lea/red.ts`.

- **Step 0 — assess.** Oracle: "Lightning Bolt deals 3 damage to any target."
  One clause → `dealDamage`, a registered Op ✅. Amount `3` is a literal ✅.
  Target is announced slot 0 ✅. No protocol behaviour ✅. **Migratable.**
- **Step 1 — green-before.** `bun run test
convex/cards/sets/lea/__tests__/red.test.ts` — the `describe("Lightning Bolt (3
damage to any target, CR 608.3)")` block (deals 3 to a player, kills a 1/1,
  goes to graveyard, can't target lands) passed. Baseline recorded. **Test left
  untouched for the entire migration.**
- **Step 2 — transcribe.** Replaced

    ```ts
    resolve: (ctx: SpellContext) => {
        ctx.dealDamage(ctx.targets[0], 3);
    },
    ```

    with

    ```ts
    effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
    ```

    `ctx.targets[0]` → `{ target: 0 }`; the literal `3` → `amount: 3`.
    `id`/`name`/`rarity`/`manaCost`/`types`/`targetRequirement`/`aiCombatHint` kept
    verbatim. Same shape already proven by Lava Spike (`chk/red.ts`) and Prodigal
    Pyromancer (`m11/red.ts`).

- **Step 3 — green-after.** The **unchanged** per-card block passed — the
  behavioural-equivalence proof. `effectScripts.test.ts` validated the script
  across the catalogue; `effectScriptSmoke.test.ts` auto-discovered Lightning Bolt
  (now has `effects`), generated a canned scenario, ran it through
  `resolveTopOfStack`, and asserted the 3 damage landed. 141 tests green.
- **Step 4 — retirement.** The Lightning Bolt `describe` block is **kept**: its
  cases cite CR interactions (CR 608.3 resolution, CR 115.4/120.3 targeting
  legality — "can't target lands", creature-death from lethal damage). These are
  CR-referenced interaction tests, not plain outcome restatements, so they stay as
  living interaction coverage on top of the generated smoke. Nothing retired.
- **Step 5 — gate.** `bun run check:all` + full `bun run test` green. Pure
  refactor, no user-visible change → no preset scenario added.

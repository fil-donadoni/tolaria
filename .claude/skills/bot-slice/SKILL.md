---
name: bot-slice
description: Implement or review a change to the AI — the play Bot (Brain / ISMCTS search / evaluate / Move executor) or the draft Bot (botDrafter / card profiles / pick ratings). Maps the subsystem, walks the seams a change must touch, and enforces the verification doctrine (deterministic blade scenario first, self-play ladder only for strength claims). Use when work touches convex/gre/{search,evaluate,moves,applyMove,ai}, src/lib/ai/, convex/limited/botDrafter, when the bot stalls / plays badly / ignores a new mechanic, or when a new card or Op must become visible to the AI.
---

# Bot Slice

There are **two** bots. They share no code and fail differently — say which one
you are changing before anything else.

|          | **Play Bot** ("the Brain")                                                           | **Draft Bot**                                             |
| -------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Decides  | which Move to make in a game                                                         | which card to pick from a booster                         |
| Lives in | `convex/gre/` (pure engine) + `src/lib/ai/` (client host)                            | `convex/limited/`                                         |
| Core     | ISMCTS over a determinized tree (`search.ts`), leaf-scored by `evaluate.ts`          | `botDrafter.ts` over `cardProfiles.ts` + `cardRatings.ts` |
| Runs     | **client-side**, in a Worker (`brain.worker.ts`) — never server authority (ADR 0074) | client + server                                           |
| Metric   | the **blade suite** (`convex/gre/ai/blade/`)                                         | pick-rating tests + draft sims                            |

## Play Bot — the pipeline, in order

```
BotView / decideBotAction   (src/lib/ai/brain.ts)      does the bot owe an action at all? (cheap gate)
      ↓
enumerateMoves              (convex/gre/moves.ts)      the legal Move[] — 17 kinds today
      ↓
search (ISMCTS)             (convex/gre/search.ts)     determinize → UCB1 → expand → rollout → backprop
   ├─ applyMove             (convex/gre/applyMove.ts)  applies a Move via the REAL GRE (resolveTopOfStack, advancePhase)
   ├─ evaluate              (convex/gre/evaluate.ts)   leaf heuristic, banded so a win dominates material
   ├─ choiceCandidates      (convex/gre/ai/)           a live PendingChoice becomes an in-tree decision node
   └─ selectRootMove        (convex/gre/search.ts)     most-visited, with material tie-breaks
      ↓
executor                    (src/lib/ai/executor.ts)   Move → the SAME mutation sequence a human's clicks make
      ↓
useVsAiDriver               (src/hooks/)               botActionRealisation dispatch on BotAction.kind
```

Two invariants worth internalising:

- **The search never models the rules.** Legality comes from `enumerateMoves`,
  application from the real GRE. A bot bug is almost never "the search is
  wrong" — it is a Move that was never enumerated, a value the evaluator can't
  see, or a choice kind with no candidate generator.
- **Difficulty is one knob.** `difficulty.ts` presets differ only by
  `SearchBudget` (iterations / timeMs). There is no weak-bot code path; never
  add one.

## Phase 0 — "the bot did something stupid" (symptom-driven entry)

The most common way this skill is invoked is a one-line observation from a real
game: _"it cast Damnation on an empty board"_, _"it chump-blocked for no
reason"_, _"it never uses the sac outlet"_. Do NOT jump to a fix. Four steps,
in order, and the first is the one people skip.

**1. Rebuild the position as a deterministic scenario.** A symptom you cannot
re-run is an anecdote. Reconstruct the board as a `ScenarioSpec`
(`convex/debugScenarioSpec.ts` — cards by NAME, zones, phase, `landCount`) from
whatever you have: the user's description, a screenshot, the DecisionTrace in
the Debug panel (`src/lib/ai/trace-store.ts` — latest decision only, never
persisted, so grab it while it's on screen). Ask the user for the missing
pieces rather than guessing: what was in play on both sides, whose turn, which
phase, life totals. Getting the phase or the untapped-mana count wrong produces
a scenario where the bot's choice is genuinely different and you debug a
position that never happened.

**2. Confirm it reproduces through the REAL search** — `runBladeScenario`
(`convex/gre/ai/blade/runner.ts`) with a fixed `iterations` budget and several
seeds. Three outcomes, and they mean different things:

- **Reproduces on every seed** → deterministic wrong preference. Go to step 3.
- **Reproduces on some seeds only** → the candidates are TIED and the pick is
  rollout noise. This is the most common shape and it changes the fix: you are
  not correcting a wrong score, you are supplying a **missing axis** that
  discriminates two positions the evaluator currently sees as identical.
- **Never reproduces** → your scenario isn't the position that happened. Back
  to step 1; do not "fix" anything.

**3. Diagnose against the three suspects — in this order.** The search itself is
almost never the culprit (it doesn't model rules; it maximises what it is told).

| Suspect                                                | How to test it                                                                                                                   | Typical fix                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **The Move should not have been offered**              | is it in `enumerateMoves`' output for that state? Is it legal at all?                                                            | a legality/enumeration bug in the GRE — a rules fix, not an AI fix                 |
| **The evaluator can't see the difference**             | score `evaluate(stateAfterMove)` vs `evaluate(stateAfterPass)` — near-equal means it is blind                                    | a term in `evaluate.ts`, or (for a card-quality gap) a valuer / `aiEffects` script |
| **The value model has no opinion on the ANNOUNCEMENT** | check `OP_VALUERS` / `OP_BENEFICENCE` for the Ops in that card's script — a missing beneficence entry silently reads `"neutral"` | the missing valuer / sign                                                          |

Worked example, the Damnation shape: a symmetric wrath on an empty board kills
nothing in either branch, so `evaluate` scores both worlds identically, the two
candidates tie inside the outcome epsilon, and the pick falls to rollout noise.
Suspect 2, tie variant. It is the same failure that produced the Wild Growth
gift and is exactly what `convex/gre/ai/beneficence.ts` was built for — read its
header before designing anything.

**4. Fix the CLASS, never the card.** "Don't cast Damnation with no creatures
out" is a card-shaped hack and is forbidden
(`feedback_fix_bug_class_not_single_card`, `feedback_no_card_names_in_identifiers`).
The class here is "an effect whose observable outcome is empty is worth strictly
less than passing" — derived from Op semantics, with zero per-card knowledge.
Grep for the other cards that ride the same shape and confirm the fix moves them
too.

**5. Pin it.** The reproduction from step 1 becomes a blade entry, tier `must`,
in the same PR. That is what makes the answer to "impedisci che succeda ancora"
a **yes** rather than a hope.

## Seams — what a change must touch

Find your row. Missing a seam does not fail the suite; it makes the bot quietly
stupid or stuck.

| You are adding                            | Also touch                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A new `Move` kind**                     | `Move` union + `enumerateMoves` (`moves.ts`) · `applyMove.ts` (search-side application) · `src/lib/ai/executor.ts` (the mutation sequence) · `describeMove.ts` (trace label) · `botActionRealisation` in `src/hooks/useVsAiDriver.ts` — **compile-time exhaustive, never a hand-maintained kind list**, or the bot stalls forever on the new mechanic |
| **A new `PendingChoice` kind**            | a generator in `convex/gre/ai/choiceCandidates.ts` (+ priors in `choicePriors.ts`). With none, the choice is not an in-tree decision and the bot either freezes or takes an arbitrary default                                                                                                                                                         |
| **A new Effect Script Op**                | `OP_VALUERS` **and** `OP_BENEFICENCE` (`convex/gre/ai/opValuers.ts`) — see `/new-op`. Beneficence fails open to `"neutral"`, which is how the bot ended up gifting Wild Growth to its opponent                                                                                                                                                        |
| **A `resolve()` / `resolveSteps` card**   | an `aiEffects` shadow script on the definition — otherwise `cardValueById` has nothing to walk and the card scores at the blind `base + MV` floor (guard: `aiEffectsGuard.bot.test.ts`)                                                                                                                                                               |
| **A cube-legal card**                     | its pick rating in `data/pick-ratings/vintage-cube.json` (guard: `pickRatings.bot.test.ts`)                                                                                                                                                                                                                                                           |
| **A new keyword / evasion / combat rule** | `evaluate.ts`'s creature-quality terms, and the combat tie-breaks in `selectRootMove`                                                                                                                                                                                                                                                                 |
| **Anything in `convex/limited/`**         | `cardProfiles.ts` / `capabilityRegistry.ts` censuses — they are catalogue-wide and go red on an unclassified card                                                                                                                                                                                                                                     |

All of those guards live in the **bot suite**. `bun run test:app` is green while
they are red — run **`bun run check:guards`** (the `TOLARIA_BOT_FAST=1` lane)
before opening a PR.

## Verification doctrine (this is the part that is easy to get wrong)

**Order matters. Start deterministic, escalate only if you must.**

1. **A blade scenario is the first thing you write, not the last.**
   `convex/gre/ai/blade/` is the correctness metric: hand-curated positions
   where a human can say without hedging what the bot ought to do. It is a
   **code-side registry, deliberately not the `debugScenarios` DB table** — a
   blade entry must travel in git with the change it guards, be reviewable in a
   diff, and reproduce on any machine with no deployment. Fixed `iterations`
   (never `timeMs` — wall-clock makes it machine-dependent) + explicit seeds ⇒
   byte-identical chosen move. Tier `must` blocks CI; `stretch` is report-only
   for positions the bot isn't expected to solve yet.
2. **Then a unit test on the decision function** — `selectRootMove`,
   the valuer, the candidate generator — with a hand-built state. Deterministic,
   sub-second, and it names the actual mechanism.
3. **Self-play is NOT how you debug a decision** (`feedback_single_scenarios_over_selfplay`).
   A bad pick reproduced in a 200-game run tells you nothing about _why_.
   Reproduce it as one preset scenario + one deterministic unit test.
4. **The ladder (`src/lib/ai/selfplay/ladder.ts`) is for STRENGTH claims only** —
   paired-design A/B where control and candidate are two config variants of the
   same engine, one per seat, in one process, seeded. Use it to answer "is this
   change stronger?", never "why did it do that?".
5. **Decision telemetry** (`decisionTelemetry.ts` + `decisionCorpus.ts`) when
   you need a distribution over many root decisions rather than one verdict.

## Rules that catch the recurring bugs

- **Name a test `*.bot.test.ts`.** The bot suite runs as a separate vitest
  invocation because bot tests lose the CPU race inside the ~770-file app suite
  and time out. `scripts/__tests__/bot-suite-boundary.test.ts` fails the app
  suite if a plain `*.test.ts` imports a bot-only module.
- **Determinism is a hard requirement.** Every random draw goes through the
  seeded stream (`makeRng(seed)`); iterations, never wall-clock, in any test.
- **The bot is a client, not an authority.** It may import pure engine modules
  and simulate on a local clone, but every real move goes through a mutation in
  `convex/game.ts` and is re-validated server-side (ADR 0074). A "fix" that has
  the bot write state is wrong by construction.
- **Cost-payment legality has ~9 consumers spanning client and server**
  (`project_cost_payment_consumers_client_and_server`) — a server-only fix to a
  may-pay / alt-cost rule freezes the bot or fails open. Enumerate the
  consumers before changing one.
- **Combat quality is washed out at the search horizon**
  (`project_combat_eval_washed_at_horizon`) — combat deltas often don't reach
  the root decision, so encode combat preferences as `selectRootMove`
  tie-breaks rather than expecting `evaluate` to carry them.

## Gate

`bunx vitest run <the bot tests you touched>` while iterating, then
**`bun run check:guards`** (catches the coverage censuses the app suite can't
see) plus `bun run check:pr`. The `must`-tier blade suite must stay green — a
regression there is a real regression, not noise.

## Reference

- Play bot: `convex/gre/{search,evaluate,moves,applyMove,determinize,difficulty,describeMove}.ts`, `convex/gre/ai/**`, `src/lib/ai/**`
- Draft bot: `convex/limited/{botDrafter,cardProfiles,cardRatings,capabilityRegistry}.ts`
- Wayfinder map #1254 (bot AI programme), PRD #1423 (DSL semantic layer), ADR 0001 (bot architecture), ADR 0074 (authority boundary)

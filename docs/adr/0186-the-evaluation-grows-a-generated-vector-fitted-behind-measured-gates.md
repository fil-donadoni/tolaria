# The Evaluation grows a vector generated from card data, fitted on Synthetic Verdicts behind measured gates; player Verdicts become the exam

Date: 2026-11-26

## Status

Accepted as a direction (2026-11-26, owner grill "riflessione sul game bot").
Nothing is rebuilt until four gates are read, in order; a gate that fails
ends the direction at that point and lifts the freeze of Decision 8.

Amends [ADR 0102](0102-combos-via-cr-732-loop-shortcut-not-combo-registry.md)
(a learned per-card correction is admitted as an escape hatch),
[ADR 0124](0124-evaluation-weights-are-fitted-from-player-verdicts.md) (§ 1
the fit's sources, § 5 the moratorium's reach),
[ADR 0129](0129-gameplay-telemetry-proposes-verdicts-never-labels-them.md)
(a label nobody confirmed may train, behind a gate) and
[ADR 0138](0138-bot-strength-is-held-out-agreement.md) (where a new player
Verdict lands). ADR 0143's exclusion of a network over the raw board stands:
what is fitted here is a table of weights.

## Context

The owner's observation: the Weight Fit already is a training of the
Evaluation on examples, while everything around it — how a card is read, which
branch the search prefers, how a rollout plays — is hand-written code that
translates strategy into programming, and that code will not survive a
catalogue three times larger.

Measured the same day
(`docs/research/bot-hand-code-growth-and-verdict-backlog.md`, at `bd6701484`):

- since 2026-08-01 the card index grew 5.6 times, the Bot's reading,
  evaluation and search code about 4 times in lines and 7 times in modules,
  the Op vocabulary 1.7 times — the code follows the cards;
- 25,688 cards are still uncompiled, and 95% of the unread Oracle fragments
  appear on one card each;
- the fitted vector is 36 numbers, each the weight of a hand-written term,
  and the fit can only weigh what the reading produces — in the September
  census 47 failing Eval Pairs gave both boards the same vector
  (`docs/research/verdict-corpus-coverage.md`);
- the Verdict Store holds 184 player Verdicts, about eleven a week since
  October; 74 promotable ones were never read by any fit.

Two examples from the owner set the bar. Amulet Titan: transmute Tolaria West
for Summoner's Pact, Pact for Primeval Titan, cast it, give it haste, attack
— five decisions whose first is a loss when read alone. Tron: Expedition Map
for Urza's Tower this turn because Sylvan Scrying finds Urza's Mine next
turn. Neither can be listed as an explicit plan, the second least of all, and
the opponent may act between any two steps.

## Decision

1. **The Evaluation gains a wide vector generated from card data.** Its
   columns are counted from what card definitions already declare — Ops by
   kind and zone, keywords, costs, mana, life, step — and from the distances
   of Deck Needs. They are born from the Mechanics Registry, so a new Op has
   its column by construction. The Weight Fit prices them. The vector enters
   as a correction over today's terms, pulled toward zero: at zero the Bot is
   today's Bot. A QUANTITY stays code (what a mana source yields); its WEIGHT
   is fitted.
2. **One fitted object, two readers.** The same weights are the value of a
   position and the search's guide, since every prior already derives from
   the one-ply Evaluation. The search stays, as the verifier: the guide
   proposes a branch, the engine proves the branch reaches its payoff.
3. **A plan is implicit.** No plan object, no macro-move, no invalidation
   rules. The Bot finds the continuation again at each decision, from the
   position it is in. A multi-turn intention is carried by the value of the
   intermediate positions (Deck Needs distances), and that is the least
   certain part of this record.
4. **Knowledge is of the class, relative to the deck in hand.** A column
   never names a card; it may be computed over the deck's list ("the payoff
   this deck's tutors point at"). A **Card Residual** — a per-card
   correction the fit shrinks to zero — is the escape hatch, capped and
   reported: a large one names a mechanic the vector does not read.
5. **A Rationale's Factors choose the crossings.** The pairs of columns worth
   generating as products (a combat trick in hand × the step) are too many to
   generate blindly; the Factors testers and the judge name select them.
6. **A Synthetic Verdict may train, behind a measured gate.** A language
   model's label is a class of its own, never an Attestation. It enters the
   fit only while the model, on player Verdicts it was never shown, agrees
   with players more often than the Brain does, per Decision Class. Positions
   come from games the engine plays between Preset Decks, at their natural
   frequency, and from Minimal Pairs written one at a time for the
   non-obvious case; every one must rebuild. The model never runs in a game.
7. **Player Verdicts are the exam.** Every player Verdict not yet in the
   Verdict Lock, and every new one, lands on the held-out side until the
   Prototype gate is read; no Promotion runs before then. The permanent ratio is decided at
   that reading.
8. **Freeze, while the gates are read.** No new hand-written weight or
   preference: no root rule, rollout priority, dominance prune or hand-picked
   constant. ADR 0124 § 5's moratorium now covers them all. A report that the
   Bot preferred the wrong legal move becomes an example, not code. What
   continues: bugs, a card the Bot never plays, a forced loss in the `must`
   tier, a missing quantity, the rollout horizon (PRD issue #10815).
9. **A Line is a test and a source.** A demonstrated course of play is one
   Test Position the Bot must carry to its end, and one judged decision per
   move of the player it demonstrates. Amulet Titan (inside one turn) and
   Tron (across turns) are the two reference Lines.

## The gates

Four, read in this order: Census, Judge, Ceiling, Prototype. Each has its
pass rule written before it is measured. (PRD issue #10083 numbers its own
gates 0 and 1; these are named so the two sets cannot be confused.)

| Gate      | Reads                                                                                                                  | Ends the direction when                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Census    | The generated vector, no fit: how many blind Eval Pairs it separates                                                   | It separates few of them                                            |
| Judge     | A language model against the Brain and the Greedy Pick, on the player exam and the `must` tier (issue #10085, widened) | The model does not beat the Brain                                   |
| Ceiling   | The two reference Lines with the guide forced by hand, at field budgets, with and without rollout probes               | A perfect guide does not find the first move                        |
| Prototype | A fitted prototype: Held-out Agreement against today's weights, and milliseconds per iteration                         | No gain on the exam, or the leaf costs more than the search can pay |

The example factory, and a second reader that scores a move without
simulating it (the measured ceiling of a probe-free rollout is 3.1–6.1 times
the iterations on field boards, `docs/research/rollout-policy-cost.md`), are a
second PRD, written only if the gates pass.

## Consequences

- A hand-written valuer or rule leaves one at a time, by ADR 0124 § 5's
  proof: disabled through a `SearchVariant`, the `must` tier and the exam
  stay green. Those that separate two moves with one vector (timing, hidden
  information) stay.
- A frozen ticket is settled by the fit's report: satisfied by the weights
  (closed, no code), blind (a missing quantity, which is code), or beyond
  the search (search work).
- What this does not buy: the reading of a mechanic no column describes. The
  long tail still needs its quantities written. The target is fewer than half
  of today's lines per thousand cards, not none.
- At a low field budget the Bot plays what the guide says: the Bot is then as
  good as the labels. The exam sees only what players judged.
- Every refit of a wide vector will move Test Positions that pass by noise,
  more than a 36-number refit does.
- PRD issue #3602 (Deck Needs) keeps its derivation and loses its hand
  pricing. PRD issue #10083 keeps Plan and Rationale capture; its Gate 0
  becomes the Judge gate, and its second model beside the Brain is this vector. PRD issue
  #9771 (triggers are data) matters more: a trigger behind an opaque closure
  yields no column.

## Alternatives considered

- **A richer function over the same 36 terms** (ADR 0138's trigger). It
  removes no hand-written line and, in September, could reach a tenth of the
  failing pairs.
- **A network over the raw board.** Still out (ADR 0143): orders of magnitude
  more data, no per-card account of a decision.
- **Per-card weights as the model.** More faithful to one demonstrated deck,
  blind to a deck nobody demonstrated, and a table that grows with the
  catalogue.
- **An explicit plan the Bot adopts and follows.** Sturdier across turns;
  it brings back hand-written conduct and its invalidation rules.
- **Labels without a gate, or only with a player's confirmation.** The first
  cannot tell teaching from mis-teaching; the second keeps today's eleven
  Verdicts a week.

# Imperfect-information game engines — what transfers to the Brain

> **Dated:** 2026-11-16; code facts read at `cd7086e11`. Nothing here was
> measured: this is a literature survey plus a reading of the search code.

> Question: poker, bridge, Hanabi and Stratego engines beat humans at hidden
> information, opponent reading and bluff. Which of their techniques can a
> deterministic, hand-built, CPU-only Magic search use, and which does the
> Brain already have?
> Raised in the 2026-11-16 grill on the contextual reasoning layer (Plan,
> Rationale, Factor in `GLOSSARY.md`), where opponent reading was deferred as
> "the level after this one". This document is the input to that later
> decision; it decides nothing.

**Method.** One research pass by web search and abstract fetches, then a
reading of `convex/gre/search.ts`, `determinize.ts`, `deckKnowledge.ts` and
`difficulty.ts` for the two claims about what the Brain already does. Source
quality is uneven and is flagged per claim:

- ✅ read in the source's own abstract or page;
- ⚠️ seen only in a search summary or a secondary source;
- ❌ not verified at all.

No full paper was read. Every win rate and compute figure below is ⚠️ unless
marked otherwise, and none should be quoted onward as a measured fact.

**Constraints the reading assumes.** No neural network, no offline training
run, no per-card knowledge (ADR 0102), a fixed iteration budget per decision
(`DIFFICULTY_BUDGETS`: 400 to 1320 iterations), determinism under a seed.

---

## 1. Summary

1. The systems that made poker engines superhuman (CFR and its descendants,
   DeepStack, ReBeL, Student of Games, DeepNash) do **not** transfer. Each
   needs either an abstraction of the whole game tree or a trained value
   network, and none has a published Magic result.
2. The family that does fit is ISMCTS, and the Brain is already in it. Of the
   five ideas ranked in § 6, the first is fully built, the third is built in
   its uniform form, and the second is partly built.
3. The one cheap idea the Brain does **not** have is weighting sampled worlds
   by what the opponent _did_ — an action-likelihood model. That is the
   concrete form "reading the opponent" would take here.
4. Bluffing (deliberately randomised play) is the least supported idea: its
   application to Magic is an extrapolation, not a published result.

---

## 2. The CFR family and the poker systems

**CFR, CFR+, MCCFR.** Self-play regret minimisation over the full game tree;
the average strategy converges to a Nash equilibrium in two-player zero-sum
games. CFR+ solved heads-up limit hold'em (Cepheus) with 4800 CPUs for 68 days
and 262 TiB of strategy storage even with compression ⚠️
([IJCAI 2015](https://www.ijcai.org/Abstract/15/097),
[Bowling et al.](https://webdocs.cs.ualberta.ca/~bowling/publications/b2hd-15science.html)).
Deep CFR, the network-approximated version: ❌.

**Libratus.** About 15 million core-hours to build its strategies, about 1,400
cores in live play ⚠️
([CMU press](https://www.cmu.edu/news/stories/archives/2019/july/cmu-facebook-ai-beats-poker-pros.html),
page not opened).

**DeepStack.** Recursive reasoning over a depth-limited subgame plus a learned
value function trained by self-play; beat professionals over 44,000 hands of
heads-up no-limit hold'em ✅ ([arXiv 1701.01724](https://arxiv.org/abs/1701.01724),
abstract). Compute not in the abstract.

**Pluribus** (six-player no-limit). Blueprint in about 8 days on a 64-core
server, about 12,400 core-hours, under 512 GB of RAM; live play on 2 CPUs with
real-time subgame search ⚠️ (same CMU page;
[secondary reading](https://www.greaterwrong.com/posts/6qtq6KDvj86DXqfp6/let-s-read-superhuman-ai-for-multiplayer-poker)).
The science.org page returned HTTP 403.

**Reading.** Pluribus's compute is modest only because poker's abstracted tree
is tiny: a handful of actions, 52 cards, no board state beyond the pot. Magic
has an open-ended card pool, a stack and arbitrary text. No source shows this
family at that scale. The one principle that survives is conceptual: hiding
information requires a _mixed_ strategy — a player who always acts the same
way with the same hand is readable (§ 6, idea 5).

## 3. Search over public belief states

**ReBeL.** Self-play reinforcement learning plus search over public belief
states; provably converges to a Nash equilibrium in two-player zero-sum games
and reduces to AlphaZero-like search under perfect information ✅
([arXiv 2007.13544](https://arxiv.org/abs/2007.13544), abstract).

**Student of Games.** One algorithm, strong in chess and Go, beats the
strongest openly available heads-up no-limit agent and the state of the art in
Scotland Yard ✅ ([arXiv 2112.03178](https://arxiv.org/abs/2112.03178),
abstract).

**Reading.** Both need deep reinforcement learning and a learned value network
over beliefs. Not available under the constraints above. The transferable
concept is the belief state itself: search from what a rational observer
believes about the hidden cards, carried as an explicit weighted distribution,
rather than from a fresh uniform guess. § 5 is the cheap version of that.

## 4. Determinization, ISMCTS and their failure modes

**PIMC (perfect-information Monte Carlo).** Sample worlds consistent with what
is known, solve each as a perfect-information game, aggregate. Its two named
failures (Frank and Basin, 1998) ⚠️
([abstract](https://www.dai.ed.ac.uk/daidb/papers/documents/rp780.html),
[restated in the αμ paper](https://www.lamsade.dauphine.fr/~cazenave/papers/AlphaMu.pdf)):

- **strategy fusion** — the search assumes it may play a different strategy
  in each world, which a player who cannot tell the worlds apart cannot do;
- **non-locality** — it ignores what the opponent knows and would infer.

**When PIMC is good enough.** Long, Sturtevant, Buro and Furtak (AAAI 2010) ⚠️
([paper page](https://ojs.aaai.org/index.php/AAAI/article/view/7562)), on
synthetic trees: it does well when hidden information resolves quickly and
when leaf values correlate across worlds. In Magic the opponent's hand is
revealed mostly by being played, which is slow.

**ISMCTS** (Cowling, Powley and Whitehouse, 2012) ✅
([abstract](https://eprints.whiterose.ac.uk/75048)): one tree over information
sets, determinizing once per iteration only to decide which moves are legal.
Strategy fusion is "lessened or eliminated". No network, no offline training.
The repository's own earlier survey of this paper, with the variants
SO-ISMCTS and MO-ISMCTS, is `docs/research/ismcts-choice-nodes.md` § 1.

**Bridge-specific remedies.** αμ addresses both failures in a game with a
small action set; no evidence it scales to Magic ⚠️. Online Outcome Sampling
(Lisý et al., 2015) is named in
[a review](https://arxiv.org/pdf/2103.04931) as a response to non-locality: ❌.

## 5. Opponent modelling and belief tracking

All the hand-buildable evidence is about **weighted determinization** —
sampling likelier worlds more often.

- **Hearthstone.** An ISMCTS agent shrank the sample space using cards already
  played; a follow-up sampled likelier determinizations from card
  co-occurrence statistics and beat uniform sampling. Full-information agents
  still did better ⚠️
  ([IJCIS](https://www.atlantis-press.com/journals/ijcis/125943384/view),
  [arXiv 1808.04794](https://ar5iv.arxiv.org/html/1808.04794)).
- **Duelyst.** Rollouts stop at end of turn because the opponent's turn cannot
  be simulated without a deck model; deck and hand are predicted from previous
  plays ⚠️ ([paper](https://www.cs.unh.edu/~ruml/papers/duelyst-cog-23.pdf)).
- **Trick-taking games.** Policy-based inference biases determinization with a
  model of how the opponent plays. It improves strength, **raises
  exploitability**, and fails when the model is wrong or the opponent
  deceives it ⚠️ ([arXiv 1905.10911](https://arxiv.org/pdf/1905.10911);
  related, [arXiv 1709.09451](https://arxiv.org/pdf/1709.09451)).
- **Hanabi.** SPARTA searches with an explicit belief over hidden states on
  top of a trained blueprint; 24.61 of 25 in two-player Hanabi ⚠️
  ([AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/6208/6064)). Needs
  the blueprint: out of reach here.
- **Stratego (DeepNash).** Model-free deep reinforcement learning, no search;
  top 3 on the Gravon platform ✅
  ([arXiv 2206.15378](https://arxiv.org/abs/2206.15378), abstract). Heavy
  training: out of reach here.

Magic with a known decklist is an _easier_ belief problem than Hearthstone,
where the list itself has to be guessed.

**Card-game-specific work.**

- **Magic, MCTS.** Cowling, Ward and Powley, "Ensemble Determinization in
  Monte Carlo Tree Search for the Imperfect Information Card Game Magic: The
  Gathering" (IEEE TCIAIG, 2012) ✅
  ([abstract](https://eprints.whiterose.ac.uk/75050); the PDF would not
  decode). Tested: rollout strategies with varying expert knowledge, a
  decaying reward for urgency, pruning to extract more from each
  determinization, and a binary decomposition of move generation. All gave
  "significant improvements in playing strength" over a basic MCTS baseline.
  Caveats: fixed decks and a simplified variant of the game, not full Magic.
- **Magic, language models.** mage-bench runs models inside a fork of XMage
  and rates them; its author states current frontier models are weak at Magic
  ⚠️ ([project page](https://mage-bench.pages.dev/docs/about), not a study).
  Relevant to the Gate 0 measurement planned in the grill: the expectation
  that a language model is a strong ceiling is not supported by this source.
- **Magic, reinforcement learning.** A Gymnasium benchmark with a PPO
  reference agent ⚠️ ([arXiv 2605.06066](https://arxiv.org/pdf/2605.06066),
  no win rates seen).
- **Forge and XMage AIs.** No authoritative architecture description found: ❌.

---

## 6. Five transferable ideas, cheapest first, against the code

### 1. Decide at the root across all worlds — **built**

The ISMCTS answer to strategy fusion at the root: choose the move from
statistics pooled over every determinization, never per world.

The Brain does exactly this. `search.ts` grows one persistent tree and
re-determinizes once per iteration (`iterate` calls `determinize` on a fresh
world, then descends the shared tree); `selectRootMove` picks among the root's
child edges by pooled visits. The file names itself Single-Observer ISMCTS.

It also goes one step past the basic algorithm. `opponentOptionView` splits an
_opponent's_ node statistics by the set of options that world offers, because
the opponent, unlike the Bot, can tell those worlds apart. That is a targeted
fix for strategy fusion on the opponent's side: with pooled statistics an
opponent holding a counterspell never learned to let one spell resolve and
counter the next.

Nothing to do.

### 2. The Magic-specific MCTS adjustments — **partly built**

From Cowling, Ward and Powley. Mapping, by reading only:

| Their adjustment                     | In the Brain                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Pruning within a determinization     | built — dominance pruning at the root and of blocks, proven-dominated moves only          |
| Decaying reward for urgency          | different mechanism — banded reward plus a material margin; no time decay was found       |
| Expert knowledge in rollouts         | different mechanism — a truncated rollout scored by the Evaluation, with action priors    |
| Binary decomposition of move choices | not checked                                                                               |
| Ensemble of separate trees           | not applicable — it is their alternative to the single shared tree the Brain already uses |

"No time decay was found" is a grep, not an audit. Whether a decaying reward
would help is an open question with no evidence either way; the paper's
baseline is far weaker than the current Brain, so its gains do not carry over
by themselves.

### 3. Condition the sampled worlds on what has been played — **built, uniform**

For a seat whose decklist the search is granted, `determinize` samples that
seat's hidden zones from `unseenRemainder`: the decklist multiset minus every
copy the observer can read in a public zone or on the stack, with cards the
observer has been shown (`knownTo`) kept in place. `DIFFICULTY_KNOWS_OPPONENT`
grants the decklist at every level today (`medium`, `hard`, `expert`).

So impossible hands are already excluded. What is **not** done: the sample
from the remainder is uniform. Every remaining card is equally likely to be in
hand, whatever the opponent has done. With no decklist (the blind path) the
opponent's hidden cards are opaque placeholders and the simulated opponent
casts nothing.

### 4. Weight worlds by what the opponent did — **not built; the real candidate**

An opponent who passes the turn with two blue sources untapped is likelier to
hold a counterspell than the uniform remainder says. An opponent who had the
mana for a strong play for two turns and did not make it is less likely to
hold it. The technique: make the sampling weight of a card depend on a
likelihood of the observed actions given that card in hand.

Why it is the candidate:

- it needs no network and no training run — the likelihood can be a small
  hand-built model over quantities, in the same spirit as a **Factor**;
- the seam exists: one function draws the sample, and the search already
  threads the decklist to it;
- it is the same statistical computation the grill ended on ("the opponent has
  one card: how likely is the missing piece?"), which a machine does better
  than a person.

What it costs and risks, to be honest about:

- **Exploitability.** The trick-taking result is explicit: inference raises
  strength against the modelled opponent and loses to one who plays against
  the model. A human who learns the Bot respects open mana can represent a
  counterspell for free. The mitigation in the literature is to cap the
  weight, never to trust the model fully.
- **A wrong model is worse than none.** Uniform sampling is unbiased; a
  miscalibrated likelihood is a systematic error no iteration budget corrects.
- **Per-card knowledge.** The likelihood must be over card _classes_ derived
  from structure (an instant-speed answer castable with the open mana), never
  a list of names (ADR 0102).
- **No measurement instrument yet.** Held-out Agreement today rests on few
  positions (n = 24 at the time of the grill), and almost none hinge on a
  hidden-hand inference. A change here could not currently be shown to help.

### 5. Randomise a few bluff decisions — **speculative**

The poker principle applied narrowly: at a small set of decisions where
information is hidden (attack or hold back, cast or keep mana up), sample the
move from a mixed strategy instead of always taking the maximum. No published
source demonstrates this for Magic. It also conflicts with two standing
properties: determinism under a seed is preserved only if the randomness draws
from the seeded stream, and a Verdict corpus that scores agreement with one
preferred move would count every deliberate deviation as an error.

---

## 7. Recommendation

- Do nothing from this document before Gate 1 of the reasoning-layer
  experiment. Ideas 1 and 3 are built; idea 2 has no evidence of a gain over
  the current Brain.
- Keep idea 4 as the named next level. Its precondition is a set of Verdicts
  whose right answer depends on inferring the opponent's hand — the
  Rationales collected for the reasoning layer will show whether the Reference
  Judge reasons this way often enough to justify it. A **Rationale** that
  says "they kept two blue up, so I play around a counter" is exactly the
  evidence.
- Leave idea 5 unbuilt until idea 4 exists: bluffing against an opponent the
  Bot does not model has nothing to calibrate against.

## 8. Not recommended under the constraints

Deep CFR, ReBeL, Student of Games, DeepNash and Hanabi's learned belief
search. Each needs a trained network or large offline compute, and none has a
published Magic result.

## 9. What this survey did not do

- Read any paper in full, or reproduce any figure.
- Find the head-to-head numbers of ISMCTS against determinized search.
- Audit the Brain's reward for an urgency term, or its move decomposition
  against the 2012 paper's (§ 6, idea 2).
- Measure anything on the Verdict corpus or the Ladder.

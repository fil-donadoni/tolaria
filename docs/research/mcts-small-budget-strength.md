# Strength at small MCTS budgets — value scaling, rollouts, PUCT, fitted evaluation

> Wayfinder research ticket [#1894](https://github.com/fil-donadoni/tolaria/issues/1894),
> map [#1892](https://github.com/fil-donadoni/tolaria/issues/1892).
> Question: for an MCTS agent in a high-branching, hidden-information card game
> on a small budget (400 iterations / 1.5 s, client-side), what do the published
> record and prior art say about where strength actually comes from —
> specifically the map's four open choices: reward calibration, rollout policy,
> selection rule, and learned evaluation without a network?

**Method.** Findings gathered against primary sources (papers, engine source
code, official engine docs); every load-bearing claim carries its citation.
Flags: ⚠️ = verified via abstract/secondary summary only (stated where);
🔧 = the author's inference from verified facts, not a source's claim.
Sources already verified at full text for [#1255](https://github.com/fil-donadoni/tolaria/issues/1255)
(`docs/research/ismcts-choice-nodes.md`) are reused without re-verification and
marked "(#1255 index N)".

**Tolaria context (repo facts, current `main`).** SO-ISMCTS in
`convex/gre/search.ts`, `DEFAULT_BUDGET = { iterations: 400, timeMs: 1500 }`.
Reward: `evaluate` margin → `materialSignal` linear clip at
`MATERIAL_FULL = 500` → `rewardFromValue` three-band map with
`TERMINAL_BAND = 0.25`, giving open-middle slope **0.0005 reward per margin
point**; with `OUTCOME_EPS = 0.05` the root tie window spans **~100 margin
points** (map evidence 1). Rollouts: ε-greedy (`ROLLOUT_EPSILON = 0.25`) over a
1-ply-greedy default policy (`selectRolloutMove` → `policyValue`, which clones
and evaluates every candidate), truncated at a turn-boundary horizon with
`evaluate` at the leaf (ADR 0015) — i.e. Tolaria already runs *short heavy
playouts + eval at horizon*, not full-game rollouts. Selection: flat UCB1, no
priors, no FPU on the action space (#1259 added top-K + priors + FPU for
*choice nodes* only). Feature basis for a fitted model exists
(`convex/gre/ai/featureBasis.ts`); every `evaluate` weight is hand-picked.

---

## 1. Value scaling / reward calibration

### 1.1 What strong engines do: fit margin → win probability on self-play

- **Stockfish** normalizes its evaluation so that "a score of 100 centipawns
  means the engine has a 50% probability to win from that position in selfplay
  at fishtest LTC time control", via a **logistic WDL model fitted on
  self-play data** (win/draw/loss rates as a function of eval and material,
  refitted as the engine changes). Sources:
  [Stockfish wiki "Useful data"](https://github.com/official-stockfish/Stockfish/wiki/Useful-data),
  [official WDL_model repo](https://github.com/official-stockfish/WDL_model).
  The scale of the evaluation is thus *defined by measured outcomes*, not by a
  hand-picked constant — exactly the role `MATERIAL_FULL = 500` plays today as
  a guess.
- **MCTS-EPT engines** (Amazons, Breakthrough, Havannah) map a minimax-style
  evaluation to a playout result through a **sigmoid**; Lorentz reports the
  approach and the use of a cache-optimized sigmoid on the eval difference
  (Lorentz 2015, *Early Playout Termination in MCTS*,
  [Springer](https://link.springer.com/chapter/10.1007/978-3-319-27992-3_2)
  ⚠️ abstract + [Semantic Scholar record](https://www.semanticscholar.org/paper/Early-Playout-Termination-in-MCTS-Lorentz/6fd2e1166d80c4dde39229e27cac577625629ef8);
  sigmoid detail corroborated by the MCTS survey update, Świechowski et al.
  2021, [arXiv](https://arxiv.org/pdf/2103.04931)).
- **KataGo** shows the *dual* failure of a pure-outcome reward: optimizing
  winrate alone produces "slack play" when clearly ahead or behind; the fix is
  a small **score-margin utility added to the win/loss utility**, dynamically
  re-centered at the root's expected score so its slope is live near the
  current position (Wu 2019, *Accelerating Self-Play Learning in Go*,
  [arXiv 1902.10565](https://arxiv.org/pdf/1902.10565) §4; also
  `staticScoreUtilityFactor`/`dynamicScoreUtilityFactor` in the
  [KataGo config docs](https://github.com/lightvector/KataGo)). Tolaria's
  three-band reward (`TERMINAL_BAND` reserving material discrimination inside
  won/lost bands) is a hand-built cousin of this — the mechanism is sound and
  published; only its *scale* is unfitted.

### 1.2 Is the indifference band a known failure mode?

Not under that name — but it decomposes into two published mechanisms:

- **Bandit resolution.** UCB1's sample complexity for separating two arms
  grows as `1/Δ²` in the reward gap Δ (regret bound `O(Σ ln n / Δᵢ)`; Auer,
  Cesa-Bianchi & Fischer 2002, *Finite-time Analysis of the Multiarmed Bandit
  Problem*, Machine Learning 47:235–256 — canonical result, cited from the
  published bound 🔧-free but not re-fetched). 🔧 Arithmetic on our constants:
  a decision worth 20 margin points is Δ = 0.01 in reward; separating it from
  noise needs on the order of 10⁴ samples of the two arms — 25× the *entire*
  400-iteration budget. The band is therefore structural at this budget: no
  amount of tie-break curation removes it, only a steeper reward slope (per
  point that matters) or lower-variance leaf values do.
- **Slack play from flat reward.** KataGo (§1.1) is the direct precedent that
  a too-flat utility near the current position causes visible blunders, and
  that the remedy is *shaping the utility so its slope is concentrated where
  the game actually is* (dynamic re-centering), not adding decision rules.

### 1.3 What calibration buys over the linear clip

- A logistic `margin → P(win)` fitted on Tolaria self-play outcomes replaces
  `MATERIAL_FULL` (a guess) with a measured quantity, and its slope is
  steepest at even positions — concentrating reward resolution exactly where
  decisions are contested, the same effect KataGo engineers by re-centering.
- 🔧 Interaction with the root tie machinery: `OUTCOME_EPS` and `VISIT_TOL`
  exist to keep rollout noise from deciding picks inside the flat band. A
  calibrated, steeper-at-even reward raises the value of Δ for the same
  material stake; combined with lower-variance leaves (§2) the tie window can
  shrink or go away rather than be retuned. Treat "can we delete a tie-break"
  as a ladder-measured question per rule, not a batch rewrite.

**Applicability verdict: HOLDS, directly.** The fit is a 1-D logistic
(margin → outcome) on data we can generate; Stockfish's procedure is
regime-independent (it is curve fitting, not deep RL). Client-side and
determinism constraints are untouched: the fit runs offline at dev time and
ships as constants. Only dependency: a self-play corpus with recorded
outcomes — the same artifact the ladder (#1895) and telemetry (#1893) work
produces.

---

## 2. Rollout policy: greedy playout vs truncation with static evaluation

### 2.1 The evidence for truncating

- **Lorentz 2015** (MCTS-EPT, [Springer](https://link.springer.com/chapter/10.1007/978-3-319-27992-3_2)
  ⚠️ abstract): terminating playouts early and calling an evaluation "can
  compare favorably to a long random playout" even with a weak function;
  MCTS-EPT programs were competitive across Amazons, Breakthrough, Havannah.
- **MC-LOA** (Winands & Björnsson, *Evaluation Function Based Monte-Carlo
  LOA*, [Springer PDF](https://link.springer.com/content/pdf/10.1007/978-3-642-12993-3_4.pdf);
  *Monte-Carlo Tree Search in Lines of Action*,
  [author PDF](https://staff.ru.is/yngvi/pdf/WinandsB10a.pdf)): four ways of
  using an evaluation inside playouts; an **evaluation cut-off** (stop the
  playout when the eval crosses a threshold) is essential — "a player without
  one stands little chance" — and the best strategy mixed probabilistic early
  moves with eval-greedy later moves. The successor MC-LOAαβ ran a 2-ply αβ
  in every playout step: it **halved the simulation count and still won by a
  large margin** — evidence that at fixed wall-clock, better playout decisions
  beat more playouts in tactical games.
- **Implicit minimax backups** (Lanctot, Winands, Pepels & Sturtevant 2014,
  [arXiv 1406.0486](https://arxiv.org/pdf/1406.0486)): keep *two* statistics
  per node — averaged rollout outcome and minimax-backed heuristic eval —
  and select on a convex mix; stronger play in Kalah, Breakthrough, LOA.
  Relevant middle path: it does not throw the playout away, it stops the
  heuristic signal from being diluted by playout noise.
- **Card games specifically**: the Hearthstone MCTS line cuts playouts at the
  end of the current turn and applies a state-value estimate at the horizon —
  Świechowski, Tajmajer & Janusz 2018 ([arXiv 1808.04794](https://arxiv.org/abs/1808.04794),
  #1255 index 13); Zhang & Buro 2017 replace low-level playout decisions with
  a fast learned policy and pre-sample chance events
  ([PDF](https://skatgame.net/mburo/ps/cig17-hsai.pdf), #1255 index 14).
  Nobody in the published card-game line plays full-game random rollouts.

### 2.2 The counter-evidence: playouts must stay stochastic if they exist

- Cowling, Ward & Powley 2012 (MTG, #1255 index 2): fully deterministic
  expert-rule rollouts were **~10% worse everywhere** than a weaker randomized
  policy; uniform-random was "very weak".
- Gelly & Silver 2007 (#1255 index 18): "if the default policy is too
  deterministic, Monte-Carlo simulation fails to provide any benefits";
  stronger default policies do not always help (Silver & Tesauro 2009's
  *balance* result, #1255 index 19).
- 🔧 Tolaria's current playout is already short (turn-boundary horizon,
  ADR 0015) and ε-greedy — it sits between the regimes. Its distinctive cost:
  `selectRolloutMove` clones + applies + evaluates **every candidate at every
  playout step**, so one playout ply costs ~branching × (clone + evaluate).
  Truncation to eval-only leaves would delete precisely the most expensive
  loop in the engine and buy iterations (map evidence 4).

**Applicability verdict: HOLDS with a caveat.** The weight of evidence at
small budgets in tactical/card domains favors *short-or-no playouts with a
static evaluation at the horizon* — Tolaria is already 80% there, so the open
question is narrower than the literature's random-vs-truncated framing: **does
the 1-ply-greedy turn-horizon playout still pay for itself versus evaluating
the expanded node directly?** No published result answers that exact A/B; the
MC-LOAαβ result (fewer, better simulations win) and the EPT results argue for
trying eval-only leaves, while Cowling's randomized-beats-deterministic result
warns that whatever playout remains must keep ε > 0. This is a
ladder-measured experiment (needs #1895), not a decision the record settles.

---

## 3. Selection rule: UCB1 vs PUCT with priors + FPU at ~400 iterations

- **PUCB/PUCT lineage**: Rosin 2011 introduced the predictor-augmented bandit
  ([Chessprogramming summary](https://www.chessprogramming.org/Christopher_D._Rosin));
  AlphaGo/AlphaZero and Leela use a PUCT variant where a policy prior scales
  each child's exploration term, and **unvisited children get a finite
  first-play-urgency value instead of the UCB1 implicit +∞** — Lc0
  documents FPU as standard ([Lc0 AlphaZero primer](https://lczero.org/dev/lc0/search/alphazero/)).
  Without FPU, UCB1 *must* visit every child of a node once before it can
  exploit any of them.
- **The budget arithmetic** 🔧: at MTG main-phase branching measured at 75–90
  compound moves (Cowling et al. 2012, #1255 index 2) a flat-UCB root spends
  its first ~80 iterations — a fifth of `DEFAULT_BUDGET` — on the mandatory
  one-visit sweep, and interior nodes at depth ≥ 1 essentially never leave
  the sweep phase. Priors + FPU is the only mechanism that makes selection
  meaningful below the root at this budget.
- **Priors pay at exactly our scale**: Gelly & Silver 2007 (#1255 index 18)
  measured prior initialization worth ~50 simulations per node and a 60%→69%
  win-rate jump at 3000 sims/move, with the benefit *growing* with branching
  factor. 400 iterations is below their regime, which strengthens, not
  weakens, the case — cold-start cost dominates more, exploration budget
  less.
- **Does the #1259 finding extend?** #1259 concluded progressive *widening*
  barely fires at 400–1200 iterations for choice nodes, and shipped top-K +
  priors + FPU instead. 🔧 The mechanism is node-visit-count-driven and
  identical for action nodes: widening schedules (`k = ⌈C·vᵅ⌉`) need visits
  to grow k, and interior action nodes get single-digit visits at this
  budget. So yes — the finding extends; the remedy that worked for choice
  nodes (priors + FPU + hard top-K, not visit-driven widening) is the one the
  action space needs. This also matches Chaslot et al.'s progressive-bias
  result (#1255 index 7) that heuristic-guided selection benefit grows with
  branching factor.
- **Prior source without a network**: the same 1-ply `policyValue` already
  used by the rollout policy, softmaxed over siblings — the #1255 doc's
  recommendation for choice nodes ("demoted from decides-the-choice to biases
  the playout and seeds the prior") applied to the action space. 🔧 Cost
  warning: computing `policyValue` for all N children at expansion costs the
  same as one full playout ply (N × clone+evaluate); a cheaper static
  move-ordering heuristic (cast cost, move kind, target class) may be needed
  as the prior for wide nodes, with `policyValue` reserved for the top few.

**Applicability verdict: HOLDS, high confidence.** The evidence (Gelly &
Silver at 3000 sims; Lc0/AlphaZero mechanics; #1259's own measured result in
this codebase) all points the same way, and the failure mode of flat UCB1 at
this budget is arithmetic, not conjecture. The open engineering question is
only the prior's cost, not whether prior-guided selection pays.

---

## 4. Learned evaluation without a network

- **Logistic regression over binary features — Logistello/GLEM** (Buro,
  *Improving Heuristic Mini-Max Search by Supervised Learning*, AIJ 134,
  [publisher PDF](https://www.sciencedirect.com/science/article/pii/S0004370201000935/pdf?md5=c48f52865b9003b7e3d275182de15972&pid=1-s2.0-S0004370201000935-main.pdf);
  [Logistello overview](https://en.wikipedia.org/wiki/Logistello)): pattern
  features combined linearly, weights fitted on millions of labeled
  positions; the resulting engine beat the human world champion 6–0. The
  paper explicitly covers training-position generation, feature selection and
  large-scale weight fitting. Scale caveat: ~100k features / ~1.2M parameters
  — three orders of magnitude beyond a `featureBasis.ts` fit, so its *data
  hunger* does not transfer, only its method.
- **TD from self-play with linear evals — the negative and positive results**:
  KnightCap's TDLeaf learned a linear eval to ~2150 strength in ~300 games,
  but **against humans on FICS, not self-play** (Baxter, Tridgell & Weaver,
  [arXiv cs/9901002](https://arxiv.org/pdf/cs/9901002)); Veness et al. report
  that TD-Leaf **from self-play alone yielded only weak amateur play**,
  while their **TreeStrap** (regress the eval toward the αβ/search values of
  *all* tree nodes, not the PV leaf) learned master-level linear weights from
  self-play from random initialization (Veness, Silver, Uther & Blair 2009,
  *Bootstrapping from Game Tree Search*,
  [NeurIPS PDF](https://proceedings.neurips.cc/paper/2009/file/389bc7bb1e1c2a5e7e147703232a88f6-Paper.pdf)).
  Lesson: with linear models the **training signal** (search-backed values ≫
  raw game outcome at the PV leaf) decides success, more than data volume.
- **Card-game precedent**: Zhang & Buro 2017 fitted **logistic-regression
  high-level rollout policies** from game data in Hearthstone
  ([PDF](https://skatgame.net/mburo/ps/cig17-hsai.pdf), #1255 index 14) —
  linear-model fitting on hand-designed features is established practice in
  exactly our genre.
- 🔧 **Fit shape for Tolaria**: `featureBasis.ts` (83 lines) exposes tens of
  terms, not thousands — a logistic/least-squares fit at that scale needs
  thousands-to-tens-of-thousands of labeled positions (rule-of-thumb
  inference, not a source claim), which a few hundred self-play games
  produce. Two viable targets, per the record: (a) regress margin-features →
  game outcome (Logistello-style, simple, pairs with the §1 calibration —
  one fit can do both); (b) regress toward deep-search root values
  (TreeStrap-style) if (a) plateaus. Failure modes to expect from the
  sources: self-play distribution bias (weights tuned to bot-vs-bot lines),
  outcome-label noise (every position of a game inherits one label —
  volume or TD targets mitigate), and feature collinearity (unstable weights,
  stable predictions — harmless for play, confusing for review).
- **Client-side constraint**: a linear model is a dot product — latency and
  size are trivial; determinism holds because fitting is offline and the
  weights ship as constants in the bundle (same posture as today's
  hand-picked weights, ADR 0074 unaffected).

**Applicability verdict: HOLDS at our scale with the method adjusted.** The
published successes are linear models fitted with the right *signal*; the
data-volume numbers from Othello do not transfer and don't need to (our
parameter count is tiny). Precondition, again: the self-play corpus and the
ladder to measure the fitted eval against the hand-tuned one.

---

## Recommended attack order

The single recurring dependency across all four questions is **a self-play
corpus + a strength metric**: §1's fit needs outcomes, §2's A/B needs a
ladder, §4 needs both. That makes the order nearly forced:

1. **Telemetry** (#1893, in flight) — confirms/refutes the indifference-band
   premise and quantifies which tie-breaks are load-bearing. Cheap, running.
2. **Strength metric / ladder** (#1895) — unblocks falsifiability for
   everything below; its self-play games double as the training/calibration
   corpus for steps 3 and 6. Nothing below should merge without it.
3. **Reward calibration** (map Q3) — fit logistic margin → P(win) on the
   ladder corpus; delete `MATERIAL_FULL` as a guess (Stockfish procedure,
   §1.1). Lowest-risk structural change; directly attacks the measured band.
4. **Priors + FPU on the action space** (map Q4) — the highest-confidence
   search-side lever at 400 iterations (§3); reuses the #1259 machinery and
   `policyValue` as prior. Widening stays out (extends #1259's finding).
5. **Rollout truncation A/B** (map Q5) — eval-only leaves vs current
   1-ply-greedy turn-horizon playout, decided by ladder, not argument (§2
   verdict); also the biggest iteration-count win if it holds.
6. **Fitted linear evaluation** (map Q7) — Logistello-style outcome
   regression on `featureBasis`, upgraded to TreeStrap-style search-value
   targets only if needed (§4). Last because it consumes everything above:
   corpus, metric, calibrated reward.

Dominance pruning (map Q6, #1887) is orthogonal to this order and can proceed
independently — no finding above bears on its safety contract.

## Dead ends at this scale (negative results worth keeping)

- **Uniform-random rollouts** — "very weak" in MTG itself (Cowling et al.
  2012, #1255 index 2).
- **Fully deterministic strong playout policies** — measurably worse than
  weaker randomized ones (Cowling et al. 2012; Gelly & Silver 2007's
  collapse warning; Silver & Tesauro 2009 balance result).
- **Raw budget increases** — strength grows ~linearly in log(time) (Chaslot
  et al. 2008, #1255 index 7): doubling the budget buys a constant increment;
  every structural fix above is cheaper per Elo. 🔧
- **Visit-count-driven progressive widening at this budget** — measured as
  barely firing in this codebase for choice nodes (#1259); the mechanism's
  visit dependence extends the conclusion to the action space (§3).
- **TD-Leaf-style outcome-TD from pure self-play with a linear eval** — the
  one directly-reported failure in the linear-fitting record (Veness et al.
  2009): weak amateur play; use outcome regression or search-value targets
  instead.
- **Accumulating root tie-breaks** — not a published dead end but the map's
  own measured pathology (six rules and counting); KataGo's utility-shaping
  (§1.1) is the published pattern for retiring decision rules into the value
  function.

## Source index

| #   | Source                                                                                                                                                                              | Verification                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Stockfish wiki — eval normalization & WDL model ([wiki](https://github.com/official-stockfish/Stockfish/wiki/Useful-data) · [WDL_model repo](https://github.com/official-stockfish/WDL_model)) | official docs                |
| 2   | Wu 2019 — KataGo, score utility & dynamic centering ([arXiv 1902.10565](https://arxiv.org/pdf/1902.10565))                                                                           | paper §4 + repo docs         |
| 3   | Lorentz 2015 — Early Playout Termination ([Springer](https://link.springer.com/chapter/10.1007/978-3-319-27992-3_2))                                                                 | ⚠️ abstract + survey corrob. |
| 4   | Winands & Björnsson — Evaluation Function Based MC-LOA ([PDF](https://link.springer.com/content/pdf/10.1007/978-3-642-12993-3_4.pdf))                                                | full text                    |
| 5   | Winands, Björnsson & Saito 2010 — MCTS in LOA, MC-LOAαβ ([PDF](https://staff.ru.is/yngvi/pdf/WinandsB10a.pdf))                                                                       | full text                    |
| 6   | Lanctot et al. 2014 — implicit minimax backups ([arXiv 1406.0486](https://arxiv.org/pdf/1406.0486))                                                                                  | full text                    |
| 7   | Auer, Cesa-Bianchi & Fischer 2002 — UCB1 regret bound (Machine Learning 47)                                                                                                          | canonical bound, not re-fetched |
| 8   | Rosin 2011 — PUCB ([Chessprogramming](https://www.chessprogramming.org/Christopher_D._Rosin))                                                                                        | ⚠️ secondary summary         |
| 9   | Lc0 — AlphaZero primer, PUCT + FPU ([lczero.org](https://lczero.org/dev/lc0/search/alphazero/))                                                                                      | official docs                |
| 10  | Buro 2002 — Improving Heuristic Mini-Max Search by Supervised Learning ([PDF](https://www.sciencedirect.com/science/article/pii/S0004370201000935/pdf?md5=c48f52865b9003b7e3d275182de15972&pid=1-s2.0-S0004370201000935-main.pdf)) | publisher PDF                |
| 11  | Baxter, Tridgell & Weaver — KnightCap TDLeaf ([arXiv cs/9901002](https://arxiv.org/pdf/cs/9901002))                                                                                  | full text                    |
| 12  | Veness, Silver, Uther & Blair 2009 — TreeStrap ([NeurIPS PDF](https://proceedings.neurips.cc/paper/2009/file/389bc7bb1e1c2a5e7e147703232a88f6-Paper.pdf))                            | full text                    |
| 13  | Świechowski et al. 2021 — MCTS survey update ([arXiv 2103.04931](https://arxiv.org/pdf/2103.04931))                                                                                  | full text (survey)           |
| 14  | Reused from #1255 index (Cowling et al. 2012 MTG; Gelly & Silver 2007; Silver & Tesauro 2009; Chaslot et al. 2008; Świechowski et al. 2018; Zhang & Buro 2017)                       | verified in #1255            |

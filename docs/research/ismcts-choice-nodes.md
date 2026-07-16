# Decision nodes in ISMCTS — literature & prior art

> Wayfinder research ticket [#1255](https://github.com/fil-donadoni/tolaria/issues/1255),
> map [#1254](https://github.com/fil-donadoni/tolaria/issues/1254).
> Question: what do the literature and prior art say about embedding mid-move
> **decision nodes inside ISMCTS** for hidden-information games, and how do
> existing non-per-card MTG/CCG AIs handle resolution-time choices?
> Feeds the choice-node architecture ticket
> [#1259](https://github.com/fil-donadoni/tolaria/issues/1259).

**Method.** Findings were gathered against primary sources (papers, engine
source code, official docs) by three parallel research passes; every load-bearing
claim was verified against the source's own text unless flagged. Flags:
⚠️ = verified only via abstract/metadata or a corroborating secondary primary
source (stated where).

**Tolaria context (repo facts, current `main`).** The bot is a single-observer
ISMCTS (`convex/gre/search.ts`) driven from a Web Worker, budgets 3–1200
iterations / 120–600 ms (`difficulty.ts`). `enumerateMoves`
(`convex/gre/moves.ts`) returns `[]` whenever `state.pendingChoices` is
non-empty ("a continuation the executor drives atomically, not a fresh
macro-move"), and `getMoverId` (`search.ts`) returns `null` on any pending
state — so **every playout halts at a mid-resolution choice**, and any line
through a choice (Stifle on the Dreadnought trigger, fetchland timing) is
structurally invisible to the search. Choices are resolved outside the search
by minimal heuristics in `src/lib/ai/brain.ts` (ADR 0016). Notably, the `Move`
union already carries choice-shaped executor payloads (`resolution-choice`,
`may-pay`, `land-entry`, `madness-decline`, `name-card`, `random-reveal-ack`,
`mulligan-bottom`) — an enumeration seam is half-built. `PendingChoice.playerId`
identifies the chooser; `PendingChoiceKind` spans nine families (~20 zone-pick
kinds alone, including `search-library`, `look-top`, `order-top`,
`look-distribute`, plus yes/no, options, ordering, piles, madness).

---

## 1. ISMCTS foundations

### 1.1 SO-ISMCTS, +POM, MO-ISMCTS (Cowling, Powley & Whitehouse 2012)

*"Information Set Monte Carlo Tree Search"*, IEEE TCIAIG 4(2):120–143.
[DOI](https://doi.org/10.1109/TCIAIG.2012.2200894) ·
[open PDF](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf)

- **SO-ISMCTS** (what Tolaria runs, issue #112): one tree whose nodes are
  information sets from the root player's view; each iteration samples one
  determinization `d` and restricts selection/expansion to `d`-compatible
  actions. All determinizations share one tree's statistics — fixing the two
  weaknesses of plain determinized UCT: budget split across disjoint trees,
  and strategy fusion at reveal points.
- **Subset-armed bandit / availability counts.** When an action is legal only
  in some determinizations, UCB1's parent-visit term is wrong. Fix (their
  Algorithm 1): each node keeps an **availability count** `n′(v)` — every
  sibling *available for selection* on a parent visit gets incremented, and
  `n′` replaces the parent visit count in the UCB formula. This is the correct
  bandit statistic when a choice's options vary across determinizations
  (targets that exist only in some worlds, searchable cards).
- **SO-ISMCTS+POM / MO-ISMCTS**: handle *opponent* moves that the root player
  cannot fully observe (+POM shares one edge per indistinguishable move but
  degrades the opponent model to uniform-random; MO keeps one tree per player).
  Relevant only once the bot must reason about the opponent's hidden
  mid-resolution choices (e.g., what an opponent's tutor took).
- **Not solved by any variant**: determinizations are sampled uniformly — no
  belief updating, so Frank & Basin's *non-locality* (§2) remains.

### 1.2 The MTG paper itself decomposed moves into in-tree decision nodes

Cowling, Ward & Powley 2012, *"Ensemble Determinization in MCTS for the
Imperfect Information Card Game Magic: The Gathering"*, IEEE TCIAIG 4(4).
[DOI](https://doi.org/10.1109/TCIAIG.2012.2204883) ·
[open PDF](https://eprints.whiterose.ac.uk/id/eprint/75050/1/EnsDetMagic.pdf)

The single most on-point precedent, verified at source:

- Game subset: lands + vanilla creatures only, 40-card mono decks — no
  instants, no stack, no targeting. All resolution-time choices were **cut by
  design** (the 2009 precursor, Ward & Cowling CIG 2009, says instant-speed
  "tricks" were excluded because they "increase enormously the complexity").
- Measured MTG branching: 75–90 compound moves at 1 ply, 7,000–8,000 at 2 ply,
  ~10⁶ at 3 ply.
- **Binary decision decomposition (§VI-B2)**: a main-phase move (a *subset* of
  hand cards) is deconstructed into a chain of binary yes/no in-tree decisions
  ("play card X?" one card at a time), "so that parts of a move can be
  reinforced separately". The binary-tree player was consistently strong
  against all others **and more than 3× faster per move** (0.23 s vs
  0.75–1.0 s, Table IV) because of the low per-node branching factor.
- **Ensemble determinization ≈ root parallelization**: at a 10,000-simulation
  budget, best play came from **20–100 trees × 100–500 iterations each** (they
  standardize on 40 × 250); at 100,000 the optimum stayed at 100–1000
  sims/tree — "an increased simulation budget is best used in running
  additional determinizations rather than searching each determinization more
  deeply".
- **Lazy determinization**: card draws are chance events fixed on first visit
  per tree, progressively freezing a deck order — full chance branching over a
  hidden library is hopeless at MTG scale.
- Rollout finding: fully deterministic expert-rule rollouts were **clearly
  inferior** to a weaker randomized "reduced rules" policy (~10% worse in all
  experiments); uniform-random rollouts were "very weak".

**Takeaway**: deepening the tree by factoring compound decisions into
low-arity sequential nodes is not a cost to be mitigated — done right it is
the published *remedy* for MTG's branching.

---

## 2. Determinization pitfalls at choice nodes

### 2.1 Strategy fusion and non-locality

Frank & Basin 1998, *"Search in games with incomplete information: a case
study using Bridge card play"*, Artificial Intelligence 100(1–2).
[DOI](https://doi.org/10.1016/S0004-3702(97)00082-9)
⚠️ paywalled; definitions verified via Long et al. 2010 and Cowling et al. 2012 §V.

- **Strategy fusion**: determinized search wrongly believes it can play a
  *different strategy in each world*, though states in one information set
  must get the same move. **Non-locality**: a node's value depends on tree
  regions outside its subtree, because an informed opponent steers play toward
  worlds favorable to them. Both errors persist *no matter how many worlds are
  sampled*.

### 2.2 When PIMC works anyway

Long, Sturtevant, Buro & Furtak 2010, *"Understanding the Success of Perfect
Information Monte Carlo Sampling in Game Tree Search"*, AAAI 2010.
[record](https://ojs.aaai.org/index.php/AAAI/article/view/7562) ·
[PDF](https://cdn.aaai.org/ojs/7562/7562-13-11092-1-2-20201228.pdf)

- Three properties predict PIMC quality: **leaf correlation** (do sibling
  leaves share payoffs — low correlation means late payoff swings and PIMC
  "always believes the critical decisions are going to come later'"),
  **bias**, and **disambiguation factor** (how fast information sets shrink
  with depth). PIMC's gain over random grows with disambiguation; high `df`
  even rescues low correlation.
- Cowling/Ward/Powley apply this taxonomy to MTG: leaf correlation is high,
  disambiguation grows slowly as hidden cards hit the board — MTG sits in
  PIMC-friendly territory. This is why Tolaria's determinized ISMCTS is a
  sound skeleton.

### 2.3 The reveal problem — what a library-search choice node will hit

Within one determinization the deck order is fixed and *known to the search*,
so "search your library" is valued as if the agent already knows what it finds
— "averaging over clairvoyance" (Russell & Norvig, quoted in exactly this
context by Cowling et al. 2012 §V via Bjarnason's Klondike example).
Determinized search "is incapable of considering issues of information
gathering and information hiding": a tutor looks as good as already holding
the best card, and information-gathering moves per se are undervalued.

**Mitigations, from the verified sources**:

- The value of a reveal node must be an **average across determinizations**
  that disagree about the hidden zone — SO-ISMCTS's per-iteration
  determinization + shared tree provides exactly this discipline (within one
  iteration the reveal is `d`-consistent; across iterations the node
  accumulates the expectation).
- Small enumerable outcome distributions (coin flip, known-top scry) → an
  explicit **chance node with expectation backup**; nobody optimizes there, so
  bandit selection is the wrong tool (Lanctot et al. 2013, *"Monte Carlo
  \*-Minimax Search"*, IJCAI 2013,
  [PDF](https://www.ijcai.org/Proceedings/13/Papers/093.pdf) — sparse
  sampling: a fixed number of sampled outcomes per chance node suffices, with
  accuracy independent of state-space size).
- Dense distributions (draw/tutor from a 40+ card hidden library) → **lazy
  determinization** per tree/iteration (Cowling et al. 2012) or **double
  progressive widening** of the outcome set (§3.3).

---

## 3. Branching containment

### 3.1 Progressive widening / unpruning

- Coulom 2007, *"Computing Elo Ratings of Move Patterns in the Game of Go"*,
  ICGA Journal 30(4), §4.2.
  [author PDF](https://www.remi-coulom.fr/Amsterdam2007/icgaj.pdf) — Crazy
  Stone prunes an internal node to the *n* best moves by prior, with *n*
  growing logarithmically in simulations (`t₀=0`, `t_{n+1} = t_n + 40·1.4ⁿ`);
  contribution on 19×19 was "huge" (0% → 37.5% vs GNU Go).
- Chaslot, Winands, van den Herik, Uiterwijk & Bouzy 2008, *"Progressive
  Strategies for Monte-Carlo Tree Search"*, NMNC 4(3).
  [open PDF](https://dke.maastrichtuniversity.nl/m.winands/documents/pMCTS.pdf)
  — independent co-invention ("progressive unpruning") + **progressive bias**
  (heuristic selection term decaying with visits); the benefit of combining
  both *grows with branching factor*.
- Couëtoux et al. 2011, *"Continuous Upper Confidence Trees"*, LION 5
  ([DOI](https://doi.org/10.1007/978-3-642-25566-3_32), ⚠️ mechanics verified
  via Lanctot et al. 2013 §2.2) — **double progressive widening**: the
  `k = ⌈C·v^α⌉` budget applies to decision-node children AND to a chance
  node's stored outcome set (sample a new outcome only when `k` exceeds the
  current set; otherwise resample among existing children). MTG needs both
  sides at once.

### 3.2 Priors and first-play urgency

- Gelly & Silver 2007, *"Combining Online and Offline Knowledge in UCT"*,
  ICML 2007.
  [PDF](https://ai.dmi.unibas.ch/research/reading_group/gelly-silver-icml2007.pdf)
  — initializing nodes with a prior value and an *equivalent-experience*
  visit count (best `M_eq ≈ 50` episodes) raised win rate 60% → 69% at only
  3000 sims/move; "with larger branching factors it becomes increasingly
  important to … incorporate prior knowledge". A good prior is worth ~50
  simulations per node at budgets close to Tolaria's.
- First-play urgency (Gelly & Wang 2006,
  [HAL](https://hal.science/hal-00115330), ⚠️ verified via Van Eyck & Müller):
  replace the implicit +∞ of unvisited children with a fixed constant so a
  wide node need not try every child once before exploiting — the cheapest
  containment lever, and the one that matters most at rarely-revisited
  interior nodes (exactly what mid-resolution choice nodes are).

### 3.3 Move groups / split moves / factored actions

- Childs, Brodeur & Kocsis 2008, *"Transpositions and Move Groups in MCTS"*,
  CIG 2008 ([DOI](https://doi.org/10.1109/CIG.2008.5035667), ⚠️ paywalled) and
  Van Eyck & Müller 2011, *"Revisiting Move Groups in Monte-Carlo Tree
  Search"*, ACG 2011
  ([author PDF](https://webdocs.cs.ualberta.ca/~mmueller/ps/GVanEyck-MoveGroups-Final.pdf))
  — a move group adds a tree layer (pick group, then pick move within it),
  trading branching for depth. Verified caveat: **arbitrary/random groups only
  speed up the search and do NOT increase per-simulation efficiency**; bad
  groupings were 6–12% *worse* than flat UCB. Grouping quality is the whole
  game — groups must separate good arms from bad.
- Kowalski et al. 2022, *"Split Moves for Monte-Carlo Tree Search"*, AAAI 2022.
  [arXiv](https://arxiv.org/abs/2112.07761) — the systematic study: splitting
  one move into a sequence of micro-decisions, each its own node, "can be
  significantly beneficial" under fixed budgets for both single- and
  multi-action games — *provided* the split layers carry real generalization
  structure (prefix-node statistics shared by all completions, cheaper move
  generation). Decomposition costs when added depth dilutes the budget without
  such sharing.
- Ontañón 2013/2017, combinatorial multi-armed bandits (NaiveMCTS,
  [AIIDE 2013](https://ojs.aaai.org/index.php/AIIDE/article/view/12681) ·
  [arXiv](https://arxiv.org/abs/1710.04805)) — when a "move" is a vector of
  sub-decisions, sample each component ε-greedily against per-component
  estimates instead of enumerating joint arms; increasingly outperforms flat
  MCTS as branching grows. Relevant to subset-shaped choices (discard 3 of 7,
  attackers, multi-target).

---

## 4. Prior art: how MTG/CCG AIs handle resolution-time choices

Ordered from most to least relevant precedent. None of them use per-card play
instructions except Forge (the rejected baseline).

### 4.1 Hearthstone MCTS: atomic decomposition of card plays

Świechowski, Tajmajer & Janusz 2018, *"Improving Hearthstone AI by Combining
MCTS and Supervised Learning Algorithms"*, CIG 2018.
[arXiv](https://arxiv.org/abs/1808.04794)

- Verified at source (§III-A): "We have decomposed complex game actions into
  atomic simple actions, e.g., when the 'SI-7 Agent' card is played, up to
  three simple actions are generated: (1) choose a card from your hand,
  (2) choose a target on the battlefield where the minion is about to be
  placed, (3) choose a target for the battlecry" — **each atomic step is a
  node/edge in the MCTS tree, generically, with no per-card AI code**. The
  clearest published precedent for pendingChoices-as-decision-nodes.
- Combinatorial escape hatch: the attack-sequencing sub-problem (~10¹⁰
  permutations) is delegated to a greedy "board solver" heuristic exposed to
  MCTS **as one artificial action** ("use solver") — a documented hybrid of
  in-tree choice and out-of-tree heuristic.
- No explicit chance nodes: edges keyed in an information-set transposition
  table, states recomputed per traversal, so a stochastic move's statistics
  average over its outcome distribution.
- A value network provides **early rollout cutoff** after the current turn
  (heuristic eval at the horizon — Tolaria already does this, ADR 0015).

### 4.2 Hearthstone DUCT: hierarchical card→target decision levels

Zhang & Buro 2017, *"Improving Hearthstone AI by Learning High-Level Rollout
Policies and Bucketing Chance Node Events"*, CIG 2017.
[IEEE](https://ieeexplore.ieee.org/document/8080452) ·
[PDF](https://skatgame.net/mburo/ps/cig17-hsai.pdf)

- Actions split into **high-level** ("play card X") and **dependent low-level**
  ("choose target for X") decisions — both levels are nodes inside a
  determinized-UCT tree (Fig. 3: `pc(A) ct(A) pc(B) ct(B) et()`).
- Low-level targets picked in rollouts by a fast *generic* value heuristic;
  chance nodes bucketed by mana cost and pre-sampled (N=1–2) to cap branching.
- DUCT + chance bucketing beat the Silverfish baseline 72%.

### 4.3 Engine contract: the pending choice becomes the action space

SabberStone (Hearthstone sim used by the AI competition,
[repo](https://github.com/HearthSim/SabberStone) — verified in
`Controller.Options()`): when a mid-resolution `Choice` is pending
(discover/mulligan), `Options()` returns **only** `ChooseTask.Pick(...)`
entries — the pending choice *replaces* the action space until answered, so
any search over `Options()` automatically treats mid-resolution choices as
decision nodes. This is the engine-level shape of the whole idea, and matches
Tolaria's `enumerateMoves` seam almost exactly (today it returns `[]` there;
the fix is to return the choice's alternatives instead).

### 4.4 XMage: generic enumeration + generic fallback at 25k-card scale

[magefree/mage](https://github.com/magefree/mage), verified in
`ComputerPlayer6.java` / `SimulatedPlayer2.java`: depth-limited simulation
search where `addTargetOptions(...)` expands **every legal target/mode
combination as a separate simulated action node**, generic `TreeOptimizer`s
prune option categories, and any resolution choice not covered by the
simulation falls back to generic outcome-typed heuristics (pick best/worst by
evaluation depending on `Outcome`), then random. Zero per-card AI code across
~25k cards. Weakness: node/depth caps mean long resolutions degrade to the
greedy fallback — but it proves targets/modes can be search-enumerated
generically at production scale.

### 4.5 Forge (contrast — the rejected baseline)

[Forge AI wiki](https://github.com/Card-Forge/forge/wiki/AI): heuristic AI
steered by annotations inside each card's script — `AILogic$ Fog`,
`AILogic$ Never`, SVar hints (`PlayMain1:TRUE`, `SacMe:…`), and
`AI:RemoveDeck:All` to ban cards the AI can't pilot. Every new effect shape
needs a new named logic; cards without one are misplayed or blacklisted. The
authoring tax is unbounded and knowledge is duplicated per card rather than
derived from effect semantics — the exact anti-pattern Tolaria's DSL-derived
semantic layer avoids.

### 4.6 Academic MTG line: nobody ever searched real resolution choices

- Ward & Cowling 2009 ([IEEE](https://ieeexplore.ieee.org/document/5286501)):
  creatures+lands only; Monte Carlo applied to card selection *only*;
  attack/block by fixed expert rules; instants excluded outright.
- Cowling, Ward & Powley 2012: same subset (see §1.2) — the binary in-tree
  decomposition was applied to hand-subset selection, proposed but never
  applied to attackers/blockers, and spells with choices did not exist in
  their game.
- Esche 2018 PhD ([NIU](https://huskiecommons.lib.niu.edu/allgraduate-thesesdissertations/3903/),
  ⚠️ metadata only): minimax + random forest, Monte Carlo player "near but not
  better than an expert rule-based player".
- Newer work is drafting/deck-building or end-to-end RL (ByteRL,
  [LOCM](https://arxiv.org/abs/2303.04096) ·
  [Hearthstone](https://arxiv.org/abs/2303.05197), ⚠️ action-factorization
  details unverified) — no search tree, every choice a policy query.
- LOCM itself ([gym-locm](https://github.com/ronaldosvieira/gym-locm),
  verified) sidesteps the problem by game design: a flat 145-action space,
  no card ever asks a follow-up question.

**Synthesis**: the Hearthstone line established the pattern the architecture
ticket asks about — *sequential decomposition: the pending choice becomes the
current decision node in the same search/action interface, with generic
heuristic (or learned) policies substituting per decision level when branching
explodes*. The engines show both endpoints at scale: Forge's per-card hints
(unbounded authoring, blacklist escape hatch) vs XMage/SabberStone's generic
enumeration + generic fallback (zero per-card cost, bounded quality). No
source contradicts the viability of in-tree resolution choices; the recurring
caveat is combinatorial sub-decisions, which every strong agent handles by
bucketing, heuristic sub-solvers exposed as actions, or portfolio scripts
(Churchill & Buro 2015, Prismata's Hierarchical Portfolio Search,
[AIIDE](https://ojs.aaai.org/index.php/AIIDE/article/view/12787), ⚠️ abstract).

---

## 5. Practical guidance: budgets, rollouts, parallelization

### 5.1 Budget scaling as the tree deepens

- Browne et al. 2012, *"A Survey of Monte Carlo Tree Search Methods"*, IEEE
  TCIAIG 4(1) ([DOI](https://doi.org/10.1109/TCIAIG.2012.2186810) ·
  [open PDF](https://repository.essex.ac.uk/4117/1/MCTS-Survey.pdf)): MCTS is
  an anytime algorithm, but vanilla UCT degrades in wide/deep trees — the
  survey's enhancement chapters (progressive strategies, priors) exist for
  exactly this. Chaslot et al. 2008 measured strength growing *linearly in
  log(time)* (R² = 0.9922): each budget doubling buys a roughly constant
  increment, so raw budget is the weakest lever.
- **Order of remedies for a fixed 300–600 ms window**: selectivity first
  (priors + progressive unpruning + FPU), decomposition into low-arity nodes
  second (§1.2, §3.3), budget last. At 400–1200 iterations, cold choice nodes
  would get 0–2 visits each without priors.

### 5.2 Rollout policy at choice points

- Gelly & Silver 2007 (§3.2): heavy playouts worth ~5× the budget vs uniform
  random (8.88% → 48.62% at 5000 sims) — but "an objectively stronger default
  policy does not [always] lead to better performance"; near-deterministic
  policies collapse ("if the default policy is too deterministic, Monte-Carlo
  simulation fails to provide any benefits"). They construct playout policies
  as **ε-greedy / softmax over a cheap value function**.
- Silver & Tesauro 2009, *"Monte-Carlo Simulation Balancing"*, ICML 2009
  ([PDF](https://icml.cc/Conferences/2009/papers/500.pdf)): optimize the
  *balance* of a simulation policy (accurate spread of outcomes), not its
  strength — a stronger policy can weaken the search.
- Cowling et al. 2012 (MTG, §1.2): randomized reduced-rules rollouts beat the
  intrinsically stronger deterministic expert player in *all* experiments.
- Early playout termination + eval at horizon: Lorentz 2015, *"Early Playout
  Termination in MCTS"*, ACG 2015
  ([Springer](https://link.springer.com/chapter/10.1007/978-3-319-27992-3_2),
  ⚠️ abstract) — "even a weak function can compare favorably to a long random
  playout"; corroborated in Hearthstone by Santos et al. 2017
  ([record](https://research.ou.nl/en/publications/monte-carlo-tree-search-experiments-in-hearthstone), ⚠️)
  and Świechowski et al. 2018's turn-end cutoff. Tolaria's turn-boundary
  horizon (ADR 0015) is this pattern; it also caps the cost choice nodes add
  inside playouts.

**Net guidance**: at in-tree choice points the rollout should be a **cheap
randomized heuristic** — ε-greedy (ε ≈ 0.1–0.5) over the existing static
choice heuristics — never uniform random over all targets, never the strongest
deterministic logic. The current `brain.ts` choice heuristics are exactly the
right raw material, demoted from "decides the choice" to "biases the playout
and seeds the prior".

### 5.3 Parallelization in a Web Worker context

- Chaslot, Winands & van den Herik 2008, *"Parallel Monte-Carlo Tree Search"*,
  CG 2008 ([Springer](https://doi.org/10.1007/978-3-540-87608-3_6) ·
  [open PDF](https://dke.maastrichtuniversity.nl/m.winands/documents/multithreadedMCTS2.pdf)):
  root parallelization at 4 threads achieved **strength-speedup 6.5 — more
  than the threads used** ("it is more efficient to run four independent MCTS
  searches of one second than one large MCTS search of four seconds");
  at 16 threads root (14.9) crushes leaf (2.4) and tree-with-mutexes (3.3–8.5
  with virtual loss).
- Cowling et al. 2012: ensemble determinization *is* root parallelization for
  hidden-information games, and the optimum was many small trees (§1.2).
- [MDN, SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer):
  shared memory requires cross-origin isolation (COOP+COEP headers,
  `crossOriginIsolated`); without it `postMessage` throws on
  `SharedArrayBuffer`. So shared-tree parallelization is off the table for a
  non-isolated web app; **N independent workers, one determinization/tree
  each, merging root-child `{move → (visits, reward)}` maps** is both the
  natively supported option and the empirically strongest at low thread
  counts — and doubles as the correct hidden-information treatment. Messaging
  cost (one structured clone in, a small map out) is negligible next to
  300–600 ms of search. 2–4 workers bounded by
  `navigator.hardwareConcurrency` is the sweet spot.

### 5.4 Anytime behavior / adaptive budgets

- Huang, Coulom & Lin 2010, *"Time Management for Monte-Carlo Tree Search
  Applied to the Game of Go"*, TAAI 2010
  ([PDF](https://www.remi-coulom.fr/Publications/TimeManagement.pdf)):
  rescheduling a *fixed* total budget adaptively (spend longer when the best
  move is unstable/close, stop early when it cannot change) was worth ~17
  win-rate points alone (43.2% → 60%).
- Baier & Winands 2016, *"Time Management for Monte-Carlo Tree Search"*, IEEE
  TCIAIG 8(3) ([DOI](https://doi.org/10.1109/TCIAIG.2015.2443123), ⚠️
  paywalled): taxonomy of semi-dynamic and dynamic (early-stop/extend)
  strategies across five games.
- "Skip search when one legal move" appears in the literature only as the
  degenerate case of dynamic early stopping — treat it as engineering common
  sense (Tolaria's `shouldThink` gate and the auto-resolve rule already do).

---

## Implications for Tolaria

Mapping each finding onto the choice-node architecture questions of
[#1259](https://github.com/fil-donadoni/tolaria/issues/1259).

### 1. Enumeration of choice alternatives as moves in `applyMoveInSearch`

- The seam is already half-built: `enumerateMoves` currently returns `[]` at
  `pendingChoices` and the `Move` union already carries the executor payload
  shapes (`resolution-choice`, `may-pay`, `land-entry`, `name-card`, …). The
  SabberStone contract (§4.3) is the model: **when a choice is pending, the
  choice's alternatives become the entire move list** — no other moves are
  legal, so no interleaving questions arise.
- Emit alternatives as **low-arity sequential micro-decisions**, not the
  cross-product: for a "pick up to N of K" zone pick, prefer per-card yes/no
  chains (Cowling et al.'s binary trees, §1.2; Kowalski et al.'s split moves,
  §3.3) or Naive-sampling-style per-component choices (§3.3) over enumerating
  all C(K,N) subsets. Split layers must carry real structure — prefix
  statistics shared by all completions — or the depth tax wins (Van Eyck &
  Müller's negative result on arbitrary grouping).
- Keep the Świechowski "use solver" pattern in the back pocket: for a
  genuinely combinatorial choice, expose the existing heuristic answer as
  *one enumerated move* alongside (or instead of) the raw alternatives.

### 2. Who "moves" at a choice node (chooser identity / APNAP)

- The literature treats this as unproblematic: a decision node belongs to the
  player who decides, exactly like any other node — MO-ISMCTS formalizes
  "each selection step uses the statistics of the player about to act".
  `PendingChoice.playerId` already carries the chooser; `getMoverId` should
  return it instead of `null`. Adversarial backprop (already in place)
  handles opponent-owned choices (their discards, their legend-rule picks)
  with no special casing — the opponent maximizes their own reward at their
  choice nodes.
- Distinguish **decision nodes** (someone optimizes → bandit selection) from
  **chance nodes** (nobody optimizes → expectation over sampled outcomes;
  Lanctot §2.3). `random-reveal-ack` and coin-flip-like kinds are chance, not
  decisions; do not run UCB over them.

### 3. Branching containment (caps, progressive widening, DSL-policy-guided pruning)

- Highest-leverage single change (Gelly & Silver, §3.2): **seed each choice
  alternative with a prior from the existing heuristics / DSL semantic layer
  plus an equivalent-experience count of a few tens of visits** — never start
  cold at Q=0, n=0 with 400–1200 total iterations.
- On top of priors: **progressive unpruning** (open the top-k
  heuristically-ranked alternatives first, grow k logarithmically with node
  visits) and **FPU** (finite value for unvisited children). This is where
  the DSL-derived per-Op value models plug in as the ranking function — the
  planned move-ordering priors (#1254 "not yet specified") and choice-node
  containment are the same mechanism.
- For choice options that vary across determinizations (targets/searchable
  cards existing only in some worlds), use **availability counts** in the
  UCB denominator (subset-armed bandit, §1.1) — otherwise rarely-legal
  options get systematically over-explored.

### 4. Which choice kinds in the first tranche vs later

The evidence-backed ordering criterion: in-tree first where the decision is
low-arity and strategy-relevant, heuristic-in-tree-as-single-move where
combinatorial, chance-node where nobody decides.

- **First tranche (low-arity decision nodes, immediate wins)**: `may-pay`
  yes/no (the Stifle/Dreadnought class — binary, and exactly the invisible-
  combo symptom), `land-entry` (shock lands), `madness-cast` accept/decline,
  `option`-family modal choices (small fixed option lists),
  `choose-damage-target` / `choose-player` (small candidate lists). All are
  ≤ a handful of alternatives; Cowling's binary-tree result says the added
  depth is cheap.
- **Second tranche (contained enumeration)**: single-card zone picks
  (`choose-hand-card`, `choose-graveyard-card`, `pick-source`, `legend-keep`),
  discard/sacrifice picks with small hands/boards — enumerate with priors +
  unpruning.
- **Later (needs §2.3 + §3.3 machinery)**: `search-library` and the
  `look-*`/`order-top`/`reorder-library` family (clairvoyance risk — value
  must average across determinizations; options huge — needs DSL-policy
  pruning or the "use solver" single-move fallback), `partition`/
  `divide-piles` (combinatorial), multi-card discard from large hands
  (factored per-card decisions), mulligan bottoming.
- **Never decision nodes**: `random-reveal-ack` and any no-decision
  acknowledgment — chance/pass-through.

### 5. Interaction with determinization (choices revealing hidden info)

- The current halt-at-choice behavior accidentally *protects* against
  clairvoyance; putting choices in-tree removes that shield, so this is the
  one place correctness work is mandatory, not optional (§2.3).
- Rules: (a) a reveal node's value must be an **average over
  determinizations** — SO-ISMCTS's shared tree + per-iteration
  re-determinization gives this for free *as long as the tree node keys don't
  encode the revealed cards of one world* (key search-library nodes by the
  choice identity, not by the concrete found card; the found card is the
  *outcome*, sampled per iteration); (b) enumerable small reveals → chance
  node with expectation backup, sparse-sampled (1–2 outcomes per visit,
  Zhang & Buro's bucketing); (c) dense reveals → lazy determinization
  (sample on first visit within the iteration's determinization).
- Watch for the systematic bias PIMC has here: tutors/searches will be
  *overvalued* (the search gets the reveal for free) — a blade scenario
  asserting the bot doesn't over-tutor is worth adding when this ships.
- Opponent hidden choices (their search, their scry) are a +POM/MO-ISMCTS
  problem — defer; single-observer with the opponent's choice resolved by
  the same rollout policy is the pragmatic first cut.

### 6. Budget & parallelization posture (feeds the adaptive-budget line in #1254)

- Deepening the tree does **not** require a proportional budget increase if
  arity stays low and priors are seeded — Cowling's binary-tree player got
  *faster* (§1.2). Selectivity first, budget last (§5.1).
- Rollouts at choice points: ε-greedy over the existing `brain.ts` heuristics
  (ε ≈ 0.1–0.5), never uniform, never fully deterministic (§5.2). The
  turn-boundary horizon (ADR 0015) already caps playout cost.
- When more strength is wanted: **root parallelization across 2–4 Web
  Workers**, one determinized tree each, merged at the root — strongest
  per-thread option, natively message-passing-shaped, no SharedArrayBuffer
  needed (§5.3).
- Adaptive time: elastic window inside the existing 120–600 ms caps — stop
  early when the best root child is unassailable, extend toward the cap when
  the top two flip (Huang et al., §5.4); bypass search for 0/1-option choice
  nodes at the root (existing `shouldThink`/auto-resolve behavior, now also
  applied per choice node).

---

## Source index

| # | Source | Verification |
|---|--------|--------------|
| 1 | Cowling, Powley, Whitehouse 2012 — ISMCTS ([PDF](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf)) | full text |
| 2 | Cowling, Ward, Powley 2012 — Ensemble determinization in MTG ([PDF](https://eprints.whiterose.ac.uk/id/eprint/75050/1/EnsDetMagic.pdf)) | full text |
| 3 | Ward & Cowling 2009 — MC card selection in MTG ([IEEE](https://ieeexplore.ieee.org/document/5286501)) | full text |
| 4 | Frank & Basin 1998 — strategy fusion / non-locality ([DOI](https://doi.org/10.1016/S0004-3702(97)00082-9)) | ⚠️ via Long et al. |
| 5 | Long, Sturtevant, Buro, Furtak 2010 — PIMC success factors ([PDF](https://cdn.aaai.org/ojs/7562/7562-13-11092-1-2-20201228.pdf)) | full text |
| 6 | Coulom 2007 — progressive widening ([PDF](https://www.remi-coulom.fr/Amsterdam2007/icgaj.pdf)) | full text |
| 7 | Chaslot et al. 2008 — progressive strategies ([PDF](https://dke.maastrichtuniversity.nl/m.winands/documents/pMCTS.pdf)) | full text |
| 8 | Couëtoux et al. 2011 — double progressive widening ([DOI](https://doi.org/10.1007/978-3-642-25566-3_32)) | ⚠️ via Lanctot et al. |
| 9 | Lanctot et al. 2013 — MC \*-minimax, chance nodes, sparse sampling ([PDF](https://www.ijcai.org/Proceedings/13/Papers/093.pdf)) | full text |
| 10 | Van Eyck & Müller 2011 — move groups revisited ([PDF](https://webdocs.cs.ualberta.ca/~mmueller/ps/GVanEyck-MoveGroups-Final.pdf)) | full text |
| 11 | Kowalski et al. 2022 — split moves ([arXiv](https://arxiv.org/abs/2112.07761)) | full text (abstract-level claims) |
| 12 | Ontañón 2013/17 — combinatorial MAB / NaiveMCTS ([arXiv](https://arxiv.org/abs/1710.04805)) | metadata + AIIDE record |
| 13 | Świechowski, Tajmajer, Janusz 2018 — Hearthstone MCTS+SL ([arXiv](https://arxiv.org/abs/1808.04794)) | full text |
| 14 | Zhang & Buro 2017 — HL rollout policies + chance bucketing ([PDF](https://skatgame.net/mburo/ps/cig17-hsai.pdf)) | full text |
| 15 | SabberStone `Controller.Options()` ([repo](https://github.com/HearthSim/SabberStone)) | source code |
| 16 | XMage `ComputerPlayer6` / `SimulatedPlayer2` ([repo](https://github.com/magefree/mage)) | source code |
| 17 | Forge AI wiki + card scripts ([wiki](https://github.com/Card-Forge/forge/wiki/AI)) | docs + source |
| 18 | Gelly & Silver 2007 — priors, heavy playouts ([PDF](https://ai.dmi.unibas.ch/research/reading_group/gelly-silver-icml2007.pdf)) | full text |
| 19 | Silver & Tesauro 2009 — simulation balancing ([PDF](https://icml.cc/Conferences/2009/papers/500.pdf)) | full text |
| 20 | Lorentz 2015 — early playout termination ([Springer](https://link.springer.com/chapter/10.1007/978-3-319-27992-3_2)) | ⚠️ abstract |
| 21 | Chaslot, Winands, van den Herik 2008 — parallel MCTS ([PDF](https://dke.maastrichtuniversity.nl/m.winands/documents/multithreadedMCTS2.pdf)) | full text |
| 22 | MDN — SharedArrayBuffer requirements ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)) | official docs |
| 23 | Huang, Coulom, Lin 2010 — time management ([PDF](https://www.remi-coulom.fr/Publications/TimeManagement.pdf)) | full text |
| 24 | Baier & Winands 2016 — time management ([DOI](https://doi.org/10.1109/TCIAIG.2015.2443123)) | ⚠️ metadata |
| 25 | Churchill & Buro 2015 — Prismata portfolio search ([AIIDE](https://ojs.aaai.org/index.php/AIIDE/article/view/12787)) | ⚠️ abstract |
| 26 | Browne et al. 2012 — MCTS survey ([PDF](https://repository.essex.ac.uk/4117/1/MCTS-Survey.pdf)) | full text |
| 27 | gym-locm action space ([repo](https://github.com/ronaldosvieira/gym-locm)) | README/source |

# Test Position / Minimal Pair / held-out agreement — lineage (issue #3850)

**Question.** The owner renamed two project-only terms on 2026-09-17: **Blade
Scenario → Test Position**, **Discriminating Pair → Minimal Pair**. This
document supplies the citable lineage for both renames plus a citable
definition for a third glossary row, **held-out agreement**, and reports
whether any card-game-AI prior art (Forge, XMage, SabberStone, the Cowling et
al. ISMCTS line) already names this concept.

**Verdict up front.** All three renames land on established, well-documented
terms with primary sources. No card-game-AI project in scope names the
concept the way chess engines and NLP behavioural testing do — see §4, a
genuine negative result.

---

## 1. Blade Scenario → Test Position

### Recommended CONTEXT.md definition

> **Test Position**: a scenario spec plus its asserted-correct move(s) —
> lineage: chess EPD test positions (`bm`/`am` opcodes) and the classic
> tactical/positional test suites (Bratko-Kopec, Win At Chess, STS, ERET),
> which engines run at a fixed depth/node budget as a cheap regression floor
> before committing to slow self-play. The four Test Positions that define
> _done_ for the credible-opponent effort: Stifle on one's own punisher
> trigger, fetchland timing and target, modal choice, and lethal-block
> defence.

(This keeps the existing CONTEXT.md sentence describing what the four
scenarios test — only the name and its lineage clause change; see the
current row at `CONTEXT.md:625`.)

### Sources

**EPD specification — `bm` and `am` opcodes.**

- Chess Programming Wiki, [Extended Position Description](https://chessprogramming.org/Extended_Position_Description)
  (mirrors Steven J. Edwards's original EPD standard). Opcode mnemonics
  table lists:
    > `bm` — "best move(s)"
    > `am` — "avoid move(s)"
- The fuller wording of the same standard, quoted verbatim in the Scid vs PC
  documentation ([EPD files](https://scidvspc.sourceforge.net/doc/EPD.htm)),
  which cites the chessprogramming.org page as its source:

    > **bm** — "Best moves: move(s) judged best for some reason."
    > **am** — "Avoid move: poor moves."

    The same EPD page states the general opcode grammar an entry follows:

    > "An EPD operation is composed of an opcode followed by zero or more
    > operands, and terminated by a semicolon."

    and that `bm`'s operands (like other multi-operand opcodes) are

    > "moves that are all immediately playable from the current position"
    > and "should have operands appearing in ASCII order."

    This is the exact shape of a Tolaria Test Position today: a board (EPD's
    four data fields = Tolaria's Scenario Spec) plus one or more asserted
    correct moves (`bm`) or, for the "don't do X" shape, moves to avoid
    (`am`) — a case Tolaria's blade registry does not currently need but the
    rename inherits for free.

**Classic test suites.**

- **Bratko-Kopec (1982)** — Ivan Bratko and Danny Kopec. Chess Programming
  Wiki, [Bratko-Kopec Test](https://www.chessprogramming.org/Bratko-Kopec_Test):
    > "designed by Dr. Ivan Bratko and Dr. Danny Kopec in 1982 to evaluate
    > human or machine chess ability based on the presence or absence of
    > certain knowledge" — 24 positions, "each position (except two) is
    > deemed to have one best move."
- **Win At Chess (WAC)** — 300 positions from Fred Reinfeld's tactics book,
  converted to EPD. Chess Programming Wiki, [Win at Chess](https://chessprogramming.org/Win_at_Chess):
  a widely-cited 300-position tactical EPD suite; per the wiki's summary,
  modern engines solve the large majority within seconds per position —
  cited today mainly as a regression floor, not a strength benchmark
  (see "Testing Standards" note, 3dkingdoms.com engine-strength page linked
  from the wiki).
- **Strategic Test Suite (STS)** — Dann Corbit and Swaminathan Natarajan,
  2008, 1500 positions in 15 thematic files, each move scored 1–10 by
  reference engines rather than pure pass/fail. Chess Programming Wiki,
  [Strategic Test Suite](https://chessprogramming.org/Strategic_Test_Suite).
- **Eigenmann Rapid Engine Test (ERET)** — Walter Eigenmann, published in
  Glarean Magazin, March 2017; 111 positions "specially selected to enable
  an approximate estimation of the playing strength of a (new) chess engine
  within a very short time." Chess Programming Wiki,
  [Eigenmann Rapid Engine Test](https://www.chessprogramming.org/Eigenmann_Rapid_Engine_Test).

**What a test suite is for (authoritative description).**

- Chess Programming Wiki, [Test-Positions](https://chessprogramming.org/Test-Positions),
  the wiki's own index page for this whole family, notes the field's
  present consensus:

    > "In recent years testing positions has fallen out of favor among top
    > engine developers. SPRT tests are now generally regarded as a superior
    > method for engine testing."

    This is directly relevant to Tolaria's own two-tier doctrine (blade/Test
    Position first, ladder second): the wiki names the same split — fixed
    positions as a cheap, deterministic floor; large-sample statistical
    self-play (SPRT) as the higher-fidelity, expensive strength signal — and
    says the field has shifted weight toward the second without discarding
    the first.

**Engine practice — fixed-position/fixed-depth runs as a regression floor.**

- Stockfish source, `src/benchmark.cpp`
  (https://github.com/official-stockfish/Stockfish/blob/master/src/benchmark.cpp):
  the `setup_bench` function builds "a list of UCI commands to be run by
  bench" over a fixed `Defaults` list of 47 positions, run to a fixed
  search limit — by default **depth 13** (`std::string limit = (is >> token)
? token : "13";`) — with usage documented in-file as e.g. `bench 64 1 15:
search default positions up to depth 15`. Every commit records the
  resulting total node count as a `Bench: <n>` trailer; an unexpected change
  in that number for an unrelated commit is the project's classic
  behaviour-changed-when-it-shouldn't tripwire — a fixed-position,
  fixed-depth regression floor, exactly analogous to running the blade/Test
  Position registry before trusting a search or eval change.
- Stockfish wiki, [Regression Tests](https://github.com/official-stockfish/Stockfish/wiki/Regression-Tests):
  a per-version historical record of bench values and Elo, generated from
  the Fishtest framework, used to confirm a release hasn't quietly
  regressed strength or speed — the fixed-position bench number is the
  first, cheap check; the full Fishtest SPRT run (tens of thousands of
  games) is the expensive one. This is the engine-repo counterpart to the
  wiki's "SPRT is now the superior method, but fixed positions remain a
  documented step" split cited above.

### Closest ancestor and why

**EPD `bm`/`am` test positions are the direct ancestor**, not just a loose
analogy: a Test Position is, structurally, an EPD record — a position (the
Scenario Spec, Tolaria's own "vocabulary a position is written in") plus a
`bm` (and potentially `am`) annotation naming the correct move(s) — replayed
through the engine and checked for agreement, cheaply and deterministically,
before the expensive self-play ladder run. Stockfish's `bench` shows the same
two-tier discipline in a shipping engine: a fixed, tiny position set checked
on every change, with the statistically powerful (and expensive) SPRT/Fishtest
run reserved for strength claims — the exact split CLAUDE.md already draws
between "a blade proves a forced play is not missed" (deterministic, cheap)
and "a ladder proves a change that shifts every decision a little is a net
gain" (statistical, expensive).

---

## 2. Discriminating Pair → Minimal Pair

### Recommended CONTEXT.md definition

> **Minimal Pair**: two Test Positions identical except for one card,
> asserting opposite verdicts — lineage: the linguistic minimal pair
> (two forms differing in one element, contrasting in acceptability/meaning),
> most directly BLiMP's minimal pairs of sentences differing in grammatical
> acceptability, adjacent to CheckList's Invariance/Directional-Expectation
> tests and to contrast sets. Neither position proves anything alone — only
> the pair distinguishes a Brain that reads the consequence from one that
> always, or never, makes the play.

(Keeps the existing meaning at `CONTEXT.md:634` — only the name and its
lineage clause change.)

### Sources

**Linguistic origin of "minimal pair."**

- Standard phonology definition (confirmed across multiple linguistics
  references, e.g. Wikipedia's [Minimal pair](https://en.wikipedia.org/wiki/Minimal_pair)
  and university course glossaries): a minimal pair is a pair of words or
  phrases in a given language that differ in only one phonological element
  (a phoneme, toneme, or chroneme) and have distinct meanings — e.g.
  "pat"/"bat". The pair's entire evidentiary force rests on that single
  point of difference: change exactly one element, observe whether the
  judgment (here, meaning; in acceptability judgments, grammaticality)
  flips.

**BLiMP — minimal pairs of sentences (closest NLP ancestor).**

- Warstadt, Parrish, Liu, Mohananey, Peng, Wang, Bowman. _BLiMP: The
  Benchmark of Linguistic Minimal Pairs for English_, TACL 2020, Vol. 8,
  pp. 377–392. https://aclanthology.org/2020.tacl-1.25/
  Abstract, verbatim:

    > "BLiMP consists of 67 individual datasets, each containing 1,000
    > minimal pairs — that is, **pairs of minimally different sentences that
    > contrast in grammatical acceptability and isolate specific phenomenon
    > in syntax, morphology, or semantics.**"

    And on method:

    > "We evaluate n-gram, LSTM, and Transformer ... LMs by observing whether
    > they assign a higher probability to the acceptable sentence in each
    > minimal pair."

    Example minimal pair from the paper (§1):

    > a. The cats annoy Tim. (grammatical)
    > b. \*The cats annoys Tim. (ungrammatical)

**CheckList — Minimum Functionality Test / Invariance / Directional
Expectation (adjacent, not the direct ancestor).**

- Ribeiro, Wu, Guestrin, Singh. _Beyond Accuracy: Behavioral Testing of NLP
  Models with CheckList_, ACL 2020. https://aclanthology.org/2020.acl-main.442/
  Verbatim definitions (§2.2 of the paper):

    > "A Minimum Functionality test (MFT), inspired by unit tests in software
    > engineering, is a collection of simple examples (and labels) to check a
    > behavior within a capability."
    > "An Invariance test (INV) is when we apply label-preserving
    > perturbations to inputs and expect the model prediction to remain the
    > same."
    > "A Directional Expectation test (DIR) is similar, except that the label
    > is expected to change in a certain way."

    INV and DIR are both single-input-perturbed-into-another-input tests, like
    a Minimal Pair — but CheckList's own perturbations are usually broader
    than "one card": swapping named entities, adding a clause, introducing a
    typo — not minimally one atomic element changed, and the paper explicitly
    frames the lineage as software **metamorphic testing** (Segura et al.
    2016), not linguistics. That is a cousin of the Minimal Pair, not its
    ancestor.

**Contrast sets — same neighbourhood, dataset-level rather than pair-level.**

- Gardner et al. _Evaluating Models' Local Decision Boundaries via Contrast
  Sets_, Findings of ACL: EMNLP 2020. https://aclanthology.org/2020.findings-emnlp.117/
  Abstract, verbatim:

    > "...we recommend that the dataset authors manually perturb the test
    > instances in small but meaningful ways that (typically) change the gold
    > label, creating contrast sets. **Contrast sets provide a local view of
    > a model's decision boundary**, which can be used to more accurately
    > evaluate a model's true linguistic capabilities."

    A contrast set is a small cluster of perturbations around one test
    instance (not necessarily paired 1:1 with opposite labels), used to probe
    the local decision boundary — the same underlying idea as a Minimal Pair
    (perturb minimally, expect the label/verdict to flip) but generalized to
    a neighbourhood rather than kept as a single opposing pair.

### Closest ancestor and why

**BLiMP's minimal pairs are the closest ancestor**, and by construction, not
just family resemblance: BLiMP defines its unit exactly as Tolaria defines a
Minimal Pair — two items "minimally different," judged by whether a
model/Brain's verdict differs the way the label says it should — and BLiMP's
own name and definition trace explicitly back to the linguistic minimal pair
(the same "change one element, hold everything else fixed, and check whether
the judgment flips" logic used to establish which sounds are phonemic).
CheckList's INV/DIR tests and Gardner et al.'s contrast sets sit one level up
the same family tree: they generalize the same idea to broader or
neighbourhood-scale perturbations rather than the strict single-point-of-
difference pair. Tolaria's Minimal Pair — "two Test Positions identical
except for one card, asserting opposite verdicts" — is BLiMP's definition
transplanted card-for-word, one level closer than CheckList or contrast
sets.

---

## 3. Held-out agreement

### Recommended CONTEXT.md definition

> **held-out agreement**: agreement between a Brain's verdict and a labelled
> answer measured on data withheld from anything the Brain (or its tuning)
> has seen — never on the corpus a change was tuned against — because
> agreement on data a system was trained/tuned on is inflated by
> memorization and does not predict behaviour on new positions.

### Sources

- scikit-learn documentation, [Cross-validation: evaluating estimator
  performance](https://scikit-learn.org/stable/modules/cross_validation.html)
  (first-party project docs for the reference implementation of
  `train_test_split`), verbatim:
    > "Learning the parameters of a prediction function and testing it on the
    > same data is a methodological mistake: a model that would just repeat
    > the labels of the samples that it has just seen would have a perfect
    > score but would fail to predict anything useful on yet-unseen data.
    > This situation is called **overfitting**. To avoid it, it is common
    > practice when performing a (supervised) machine learning experiment to
    > **hold out part of the available data as a test set**."
- Hastie, Tibshirani, Friedman, _The Elements of Statistical Learning_ (2nd
  ed.), §7.2 "Bias, Variance and Model Complexity": frames the same split as
  **training error** (evaluated on the data used to fit the model, which
  decreases monotonically with model complexity and is a poor estimate of
  future performance) versus **test error / generalization error**
  (expected prediction error on an _independent_ sample not used in
  fitting) — the textbook definition of why held-out evaluation, not
  training-set agreement, is the quantity that estimates generalization.
  (Canonical, freely available PDF: https://hastie.su.domains/ElemStatLearn/ —
  the chapter opens §7.2 by defining `Err_τ` as error "conditional on a
  training set," contrasted with test error computed on a fresh sample.)

Both sources converge on the same reasoning Tolaria's own doctrine already
assumes for the blade/Verdict quiz split: a Brain change tuned or debugged
against the registry corpus and then re-checked only against that same
corpus proves nothing about generalization — held-out agreement means
computing agreement against Verdicts the tuning pass never saw.

---

## 4. Card-game-AI prior art — does anyone already name this?

**No.** None of Forge, XMage, SabberStone, or the Cowling et al. ISMCTS line
names a concept equivalent to a chess EPD test position (a fixed board plus
an asserted best/avoid move, checked for agreement) for a card-game bot.
This is a genuine negative result, not an absence of searching:

- **Forge** (`Card-Forge/forge`). The project wiki's [AI page](https://github.com/Card-Forge/forge/wiki/AI)
  covers running AI-vs-AI matches from the command line for tournament-style
  testing, and general notes on AI weaknesses, but documents no fixed-position
  regression suite with an asserted expected move. `gh search code` against
  the repo for `expectedMove` / `bestMove` returned no hits.
- **XMage** (`magefree/mage`). The closest thing found is
  `Mage.Tests/src/test/java/org/mage/test/AI/basic/TestFrameworkCanPlayAITest.java`,
  which drives the AI from scripted board states via `CardTestPlayerBase` /
  `CardTestMultiPlayerBase` — structurally the nearest analog to a Scenario
  Spec. But its assertions check that **outcomes occurred**
  (`assertGraveyardCount`, `assertPermanentCount` — a spell resolved, a
  creature died), not that the AI chose a specific asserted-best move among
  legal alternatives. One test is marked `@Ignore` with the developer note
  _"AI can't play blade cause score system give priority for boost instead
  restriction effects"_ — i.e., XMage's own maintainers found a case where
  the AI fails a "should have played X" expectation, but the framework has
  no vocabulary (no `bm`/`am`-equivalent) to assert and track that as a
  regression case the way a Test Position does.
- **SabberStone** (`HearthSim/SabberStone`). Its test suite
  (`SabberStoneCoreTest/`) is a per-card unit-test generator plus a
  stability/stress harness (`StabilityTest.cs`, `TheoryStressTest.cs`); no
  fixed-position AI-decision assertion suite was found.
- **Cowling, Powley, Whitehouse, "Information Set Monte Carlo Tree Search,"
  IEEE Trans. Comp. Intell. AI Games 4(2), 2012**
  (https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf).
  Evaluation is entirely win-rate self-play, never single-position
  best-move agreement. For Lord of the Rings: The Confrontation the paper
  even uses **one fixed hand-designed initial setup** for every trial
  ("instead, we conduct all of our experiments on a single, hand-designed
  initial setup intended to be typical of those that a pair of human
  players might choose") — the closest thing to a fixed Test Position in
  this line of work — but the reported metric is still the aggregate win
  rate over many playouts from that one setup, not a per-position
  best/avoid-move verdict. For Dou Di Zhu, 1000 fixed deals are bucketed by
  which algorithm's win rate is higher, again a statistical measure over
  full games, not a single asserted correct decision per deal.

**Conclusion for §4:** the "fixed board + one asserted correct move, checked
deterministically before the expensive statistical run" pattern that chess
engines standardized via EPD `bm`/`am` has no equivalent name or artifact in
the card-game-AI literature or codebases surveyed. Tolaria's Test Position
is, as far as this research can establish, a transplant of the chess-engine
pattern into a domain (MTG bot development) that has not previously named it.

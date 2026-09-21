# Strengthening the play Bot: what the 2026 frontier offers (exploration)

**Status: exploration, parked.** Written 2026-09-21 from a grilling session.
Nothing here is decided, nothing is scheduled; Bot strength work is in the
backlog and this document is where that work starts reading. It records what
was looked at, what was ruled out and why, and the one open question the
session stopped on.

**Question.** A hosted "decision model" (Jev, TypeSafe AI) launched on
2026-09-15, marketed as built for real-time loops such as games. Does it lift
the limits that kept a neural network out of the play Bot — and if not, which
2024–2026 tools, languages and techniques do fit inside or around the ISMCTS
loop?

**Verdict up front. Jev cannot run in the loop, and neither can any other
hosted model: the arithmetic rules it out before doctrine does. The frontier
that does transfer to a ~1000-iteration, deterministic, in-browser search is
not a model and not a language — it is three levers that need no network at
all: a faster simulator, a search that spends a small budget better, and
better labels for the fit.** A learned evaluator stays where ADR 0138 left it:
behind a measured trigger, and if it ever opens, as a tiny deterministic
artefact over the existing term vector, never a framework and never the GPU.

## The constraints any candidate is measured against

These are the repo's own, restated so the tables below can cite them.

- The Brain runs client-side in a Web Worker over the real engine; the server
  only re-validates (ADR 0021, ADR 0074).
- Budget per decision (`convex/gre/difficulty.ts`): `medium` 400 iterations /
  1500 ms, `hard` 1200 / 3000 ms, `expert` 1320 / 3300 ms.
- Measured cost is about 0.57 ms per iteration on the development machine
  (`expert-informed-iteration-cost.md`, issue #2790), and at `medium` the
  ITERATION cap binds, not the wall clock (`iterations-per-decision.md`,
  issue #2682). A faster simulator therefore buys strength only if the caps
  are raised with it, or on slower hardware where the clock binds first.
- Determinism is mandatory: fixed iterations, fixed seed, exact-move
  assertions in the blade registry (`.claude/rules/bot-development.md`).
- The knowledge pipeline is fixed: Verdicts → Weight Fit → held-out agreement
  (ADR 0124, ADR 0138). An LLM may only ever be an OFFLINE author of data,
  never in the loop (grill of 2026-08-22).
- The measured bottleneck of a richer evaluation is the corpus, not the model
  class: 174 verdicts / 492 pairs, 10.2% addressable
  (`verdict-corpus-coverage.md`, issue #3588).
- A network over the raw board is out of the roadmap (ADR 0143). Learned
  interactions over the term vector open only on the ADR 0138 trigger.

## Jev against those constraints

What it is, from the vendor post and independent write-ups: a closed, hosted
API (`POST /v1/systemone`), no open weights, no local or in-process execution,
no fine-tuning announced. It takes unstructured `state` plus typed `questions`
(`Choice` up to 255 options, `Score` 2–10 levels, `Noul` yes/no) and returns
typed answers with calibrated probabilities in one forward pass. Vendor-claimed
latency 70–500 ms end to end, most around 100 ms, before network distance;
$0.042 per million input tokens, output free; about 1200 requests per minute
in early access; roughly 64k tokens shared by state and questions. No source
states that identical input yields identical output, and the public route is
`jev-latest`. Documented weak spots: arithmetic, dates, indirection, and a
large state full of irrelevant detail — which is what a board is. There is no
third-party benchmark; The Register notes that "cannot hallucinate" means
"cannot return an undeclared option", not "is correct".

"Runs inside your software" in the launch material means the OUTPUT is
consumed by code without a parsing step. It does not mean the model runs in
process.

| Role                                     | Verdict | Why                                                                                                                                                                                                 |
| ---------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leaf evaluator inside ISMCTS             | Dead    | 1320 evaluations at ~100 ms is over two minutes against a 3.3 s budget; the rate limit is 20 per second.                                                                                            |
| Root advisor, one call per decision      | Dead    | Fits the latency, fails determinism (remote, mutable model), adds a network dependency to a Worker-local Brain, and is a root rule by another name — `ROOT_RULE_ALLOWLIST` is frozen.               |
| Offline author of Verdicts or Eval Pairs | Open    | The only role the doctrine allows. It aims at the real bottleneck (corpus size, and the decision classes with zero pairs), but a labeller of unknown MTG accuracy contaminates what the fit trusts. |

**The experiment that would settle the open row, if it is ever wanted:** pose
each of the 492 existing Eval Pairs to the model as a `Choice` between the
candidate moves and score its agreement with the recorded Verdicts, exactly as
ADR 0138 scores the evaluation. It costs cents. If it does not clear the
current linear fit's held-out agreement, the question closes with no ADR. If
it does, the next question is whether its labels on UNJUDGED positions can be
trusted where no Verdict exists to check them — a harder question, and the one
that actually matters.

## What the frontier rules out

- **GPU and inference frameworks in the browser.** WebGPU gives no cross-device
  determinism, and at batch 1 it is slower, not faster: a community benchmark
  measures a 140k-parameter MLP at 0.10 ms on WASM against 4.50 ms on WebGPU —
  dispatch and readback dominate. WebNN is Chromium-only and unlikely to be
  cross-browser before 2027. ONNX Runtime Web, TensorFlow.js, LiteRT.js,
  transformers.js, Candle, Burn and tract are tuned for LLM- and vision-scale
  models; at this size the framework overhead exceeds the compute.
- **Relaxed SIMD and fused multiply-add.** Non-deterministic by specification
  — each host picks from an allowed set. Incompatible with exact-move tests.
  Hardware-dispatched INT8 kernels (SDOT, VNNI) also disagree across CPUs;
  integer quantisation is bit-exact only with scalar or non-relaxed ops and a
  fixed accumulation order.
- **ReBeL, Student of Games, DeepNash, DouZero from scratch.** Training scale
  is a cluster; DouZero alone reports four GPUs for thirty days.
- **A second engine in Rust compiled to WASM.** phase.rs exists (a Rust + WASM
  MTG engine, 34k cards, Worker-hosted) and is a separate rewrite, not one
  source compiled twice — precisely the drift this project refuses. Porting
  only the inner loop to AssemblyScript or a WasmGC language has thin evidence
  (1.2–3× at best, none of it on branchy allocation-heavy game logic) and the
  same drift risk. Porffor and Static Hermes are not production-ready. `tsgo`
  speeds up type-checking, not the Bot.
- **Moving the search to a server, action or edge function.** A 1.5–3.3 s
  CPU-bound loop does not fit edge CPU limits, and the round trip spends the
  budget. Offload remains plausible only for pondering and precomputation.

## What transfers

Every row keeps the single TypeScript engine and is compatible with a fixed
seed. "Evidence" is about the technique in the literature, not about Tolaria —
none of these has been measured here.

| #   | Lever                                                                                                               | Axis   | Evidence                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| 1   | Make/unmake with an undo log instead of cloning state per node                                                      | Speed  | Standard chess-engine practice; no MTG benchmark.                                                     |
| 2   | Stable object shapes; no megamorphic dispatch in the Effect Script interpreter's hot path                           | Speed  | Strong, well documented for V8.                                                                       |
| 3   | Compile each card's Effect Script to closures once at load, instead of re-walking `EffectOp[]` on every application | Speed  | Sound mechanism (first Futamura projection); no JS-specific numbers found.                            |
| 4   | Root-parallel ISMCTS across Workers: fixed per-worker seeds and counts, order-independent merge                     | Speed  | Won the Tales of Tribute 2024 competition; shared memory needs COOP/COEP headers.                     |
| 5   | Gumbel top-k sampling plus Sequential Halving at the root                                                           | Search | The strongest result for this regime: a policy-improvement guarantee at 16–32 simulations.            |
| 6   | Re-determinise at every descent, not once per iteration                                                             | Search | Goodman 2019 (Hanabi); aims at non-locality, i.e. the bluff and timing weakness.                      |
| 7   | Group equivalent attack and block assignments before expansion                                                      | Search | Mature (progressive widening, move grouping); our stated branching pain.                              |
| 8   | GRAVE / MAST biasing of the playout policy                                                                          | Search | Mature, unrevised since 2022.                                                                         |
| 9   | Oracle labels: the labeller sees both hands, the linear evaluation regresses onto them (the PerfectDou pattern)     | Data   | Strong in DouDizhu; aims at the corpus bottleneck.                                                    |
| 10  | An LLM proposes evaluation TERMS offline; a verifier keeps the winners; static code ships (FunSearch, Eureka)       | Data   | Strong; deterministic by construction; consistent with "LLM only offline".                            |
| 11  | If the linear fit saturates: EBM/GAM shape tables, compiled boosted trees, or a hand-written scalar int16 MLP       | Model  | Microsecond, bit-exact inference; XGBoost documents `rank:pairwise` for small sets of labelled pairs. |

Three findings that shape expectations rather than add a lever:

- NNUE's incremental accumulator has no precedent outside perfect-information
  board games (shogi, chess, xiangqi). Inspiration, not a recipe.
- No paper on MTG play-time search was found for 2024–2026; the published MTG
  work is drafting only. Forge, XMage and Arena's Sparky publish no method.
- In the Legends of Code and Magic competition, search won while decks were
  fixed and reinforcement learning won once they were randomised — and the
  neural champions were later shown exploitable by targeted counter-play. An
  argument for keeping a search under any learned component.

## Where the levers meet the doctrine

- **Lever 9 contradicts ADR 0124 as written** ("no self-play, no Ladder";
  "the Ladder is not a tuning loop"). So does the Texel-style variant that
  regresses on game outcomes. Adopting either is an amendment to ADR 0124, to
  be argued there, not slipped in as a data source.
- **Lever 5 touches `selectRootMove`.** Sequential Halving allocates search
  budget among candidates; it is not a preference between two moves with one
  feature vector, so it should sit outside `ROOT_RULE_ALLOWLIST` — but that
  reading is this document's, not a decision. It also reshuffles every seed:
  the whole blade registry would need re-recording, and the existing root
  tie-breaks would move with it.
- **Levers 1–3 are unprioritised on purpose.** Nobody has profiled where one
  iteration's ~0.57 ms goes — clone, legal-move enumeration, layer
  recomputation, interpreter dispatch. This session did not read the clone
  path. Ordering them without that profile is a guess.
- **Speed alone does nothing at `medium` on this hardware**, because the
  iteration cap binds (issue #2682). Any speed work owes a companion decision
  on the caps in `difficulty.ts`, and a measurement on a phone, where the
  clock probably binds first.

## Where the session stopped

One question was open when this was parked: **which axis first — speed, search
or data?** The recommendation on the table was speed, starting from a profile
of a single ISMCTS iteration, because it is the only axis that touches no
doctrine and it multiplies whatever comes after it. That recommendation was
not accepted or rejected.

Side finding, not acted on: `docs/guides/bot-glossary.md` ("Fitted
evaluation") and ADR 0138 (Consequences) both cite an "ADR 0074 budget" as the
reason a network is out of scope. ADR 0074 is the Draft Lab decision and
states no budget. The citation looks like drift.

## Sources

Jev: [TypeSafe launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev) ·
[The Register](https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711) ·
[DataCamp](https://www.datacamp.com/blog/system-one-models-jev) ·
[Flavio Copes](https://flaviocopes.com/jev/)

In-browser inference and determinism:
[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) ·
[browser-runtimes-bench](https://github.com/delcenjo/browser-runtimes-bench/blob/main/README.md) ·
[relaxed SIMD non-determinism](https://github.com/WebAssembly/relaxed-simd/issues/44) ·
[WASM NaN non-determinism](https://github.com/WebAssembly/design/issues/619) ·
[INT8 portability](https://arxiv.org/html/2609.16085) ·
[Stockfish NNUE](https://official-stockfish.github.io/docs/nnue-pytorch-wiki/docs/nnue.html) ·
[XGBoost learning to rank](https://xgboost.readthedocs.io/en/stable/tutorials/learning_to_rank.html) ·
[InterpretML EBM](https://interpret.ml/docs/ebm.html) ·
[PySR](https://ai.damtp.cam.ac.uk/pysr/v1.5.9/)

Search in imperfect-information games:
[ISMCTS (Cowling, Powley, Whitehouse)](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf) ·
[re-determinising ISMCTS](https://arxiv.org/pdf/1902.06075) ·
[EPIMC](https://arxiv.org/abs/2408.02380) ·
[Gumbel AlphaZero / MuZero](https://discovery.ucl.ac.uk/id/eprint/10167022/) ·
[GRAVE](https://www.lamsade.dauphine.fr/~cazenave/papers/grave.pdf) ·
[MCTS modifications review](https://link.springer.com/article/10.1007/s10462-022-10228-y) ·
[LOCM competition summary](https://arxiv.org/html/2305.11814) ·
[exploitability of CCG agents](https://arxiv.org/pdf/2404.16689) ·
[Tales of Tribute](https://arxiv.org/html/2305.08234) ·
[PerfectDou](https://arxiv.org/html/2203.16406v7) ·
[Eureka](https://github.com/eureka-research/Eureka) ·
[Texel tuning](https://www.chessprogramming.org/Texel's_Tuning_Method)

Simulator speed:
[V8 hidden classes](https://kislayvats.com/blogs/v8-hidden-classes-optimizing-object-shapes) ·
[Mutative performance](https://mutative.js.org/docs/getting-started/performance/) ·
[AssemblyScript status](https://www.assemblyscript.org/status.html) ·
[phase.rs](https://github.com/phase-rs/phase) ·
[SabberStone](https://arxiv.org/pdf/1808.04794) ·
[COOP/COEP](https://web.dev/articles/coop-coep) ·
[Pgx](https://arxiv.org/pdf/2303.17503)

Several version-support claims for WebAssembly features came from aggregator
posts rather than the specification or caniuse, and the Jev figures are the
vendor's own; verify either before depending on it.

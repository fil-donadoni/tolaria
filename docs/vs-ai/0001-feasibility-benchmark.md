# vs-AI #1 — feasibility benchmark (go/no-go)

Issue #108 · ADR [0001](../adr/0001-ai-opponent-client-side-ismcts.md) · HITL go/no-go gate

## Question

Can a client-side ISMCTS brain clone-and-step the **real** GameState fast
enough to be useful? The PRD target is **~1k–5k iterations/sec** on a mid-range
phone, where one iteration ≈ one determinized clone + one truncated rollout.
The clone is the structural-sharing concern owned by this slice; if the clone
is the bottleneck, nothing downstream matters.

## What was built

- **`cloneGameState`** (`convex/gre/clone.ts`) — a structural-sharing deep
  clone: deep-copies every mutable path so a move applied to the clone never
  reaches the original, but shares each immutable `CardInstanceState.card`
  definition reference. Replaces the general-purpose `structuredClone` used on
  the authoritative server path (which is left unchanged).
- **`runCloneRolloutBenchmark`** (`convex/gre/searchBench.ts`) — runs
  `clone + truncated dummy rollout (depth K) + dummy eval` in a loop over a
  wall-clock budget and reports iterations/sec. Stub moves stand in for the
  real `enumerateMoves`/executor (issue #110); the goal is to measure the
  **clone + state-stepping cost**, which is what structural sharing addresses.

## Method

- Representative position: 2 players, 30-card libraries, 6-permanent
  battlefields, 5-card hands, small graveyards (~88 `CardInstanceState`s total).
- One iteration = `clone(root)` + 10 stub moves applied in place + a dummy eval.
- 50-iteration JIT warm-up, then timed batches until the budget elapses.
- Both clone strategies measured back-to-back for a direct speedup ratio.

## Results

Measured on **Apple M1 Pro** (Node v22.17 via Vitest), depth-10 rollout:

| clone strategy            | iterations/sec | relative |
| ------------------------- | -------------: | -------- |
| `structuredClone` (naive) |         ~7,500 | 1.0×     |
| `cloneGameState` (shared) |        ~40,000 | **5.4×** |

Numbers vary run-to-run; reproduce with:

```
bunx vitest run convex/gre/__tests__/searchBench.test.ts --reporter=verbose
```

## Interpretation vs the ~1k–5k/sec target

- The benchmark isolates **clone + state-stepping** cost. With structural
  sharing the clone is no longer the limiter: ~40k iter/sec on an M1 Pro.
- A mid-range phone runs single-thread JS roughly **4–8× slower** than this
  machine. Extrapolated: **~5k–10k iter/sec** for clone + stub rollout — at or
  above the top of the target band before any real move cost is added.
- Real rollouts (issue #110's `enumerateMoves` + GRE move application) cost
  more per step than the stub move, so the **true** iteration rate will be
  lower. But the clone — the part this slice removes — is now ~5× cheaper than
  the naive baseline the production path uses, which is exactly the headroom
  the rollout work needs.

## Recommendation: **GO**

Structural sharing removes clone as the bottleneck with comfortable margin.
Proceed to issue #110 (`enumerateMoves` + executor) and #111 (`evaluate` +
truncated rollout), then re-measure with **real** moves replacing the stub.

### Levers if real-move rollouts fall short

1. **Shorter rollout depth K** — fewer GRE applies per iteration.
2. **More aggressive `shouldThink` gate** (issue #113) — search only on
   genuinely interesting priority windows; auto-pass the rest.
3. **Share more read-only fields** by reference in the clone (UI-only fields,
   animation) beyond the card definition.
4. **Last resort:** move the brain to a Convex action (ADR 0001 fallback),
   accepting per-move server compute.

## Scope notes for the reviewer

- The "shared GRE package" is a **lightweight barrel** (`convex/gre/index.ts`)
  consumed via the existing `@convex/*` path alias, plus a sanctioned client
  bridge (`src/lib/ai/gre-bridge.ts`) — not a workspace/package extraction. The
  GRE is already pure and isomorphic, so this is the "packaging/boundary move,
  not a rewrite" the issue calls for. The boundary relaxation is documented in
  ADR 0001 and at both module headers.
- No new Convex mutation or action was introduced; the authoritative server
  path is unchanged.

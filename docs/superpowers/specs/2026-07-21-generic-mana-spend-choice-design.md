# Generic mana spend choice (CR 601.2g / 602)

**Date:** 2026-07-21
**Status:** Design approved, pending spec review

## Problem

When paying the generic portion of a cost, the player — per CR 601.2g / 602 —
chooses which mana in their pool to spend. Tolaria never asks: `payManaCost`
(`convex/gre/state.ts:13411-13426`) pays generic greedily, spending from the
color with the most mana in the pool first.

Reported symptom: a land that adds two mana at once (e.g. Ancient Spring —
`{T}, Sacrifice: Add {W}{B}`, `convex/cards/sets/inv/multicolor.ts:2861`) floats
both colors; casting an artifact costing `{1}` silently consumes one color of
the engine's choosing, leaving the other floating. The player never picks. This
only bites when the leftover color matters (a second spell needing the specific
color), but it is a genuine CR divergence.

Two payment paths reach the same generic-payment moment:

1. **Manual floating pool** — player taps sources first (mana floating), then casts.
2. **Auto-tap overproduction** — player casts with an empty pool; `solveSmartAutoTap`
   (`convex/gre/autoTap.ts:573`) taps a dual-producing land, floating a spare color.

Both must be covered (CR-full, both paths).

## Non-goals

- No change to which **sources** auto-tap selects (`solveSmartAutoTap` unchanged).
- No prompt for the *color a source produces at tap time* — that already exists
  (`manaTapNeedsChoice` / `resolveManaTapChoice`, `convex/game.ts:860-881`).
- No prompt for trivial choices (see auto-resolve rule below). Arena-style UX:
  auto-resolve when there is no real decision.

## Design

### 1. Core primitives (pure, `convex/gre/state.ts`)

**`genericSpendAmbiguity(pool, cost): null | { generic: number; candidateColors: string[] }`**

Deterministic from `(pool, cost)`. Computed *after* mandatory colored/colorless
requirements are satisfied (so `pool` reflects what remains for the generic
portion, and `generic` is the outstanding generic amount). Returns non-null only
when **both**:

- the generic amount can be drawn from ≥2 distinct colors present in the pool, **and**
- at least two distinct choices leave a **different set of remaining colors**
  (the *leftover-set-differs* rule).

Trivial cases return `null` → silent auto-pick. Examples:

- Pool `{U:1, G:1}`, cost `{1}` → non-null, `candidateColors: [U, G]` (spending
  one empties that color; the two outcomes differ). **Prompt.**
- Pool `{U:2, G:2}`, cost `{1}` → `null` (either choice still leaves both colors
  reachable). **Auto-pick.**
- Pool `{U:1}`, cost `{1}` → `null` (only one color). **Auto-pick.**

**`payManaCost(pool, cost, subs?, genericSpendOrder?)`**

New optional final parameter: an explicit ordered list of colors to spend for
the generic phase. When omitted, behavior is unchanged (greedy pick) — every
existing caller is untouched. When supplied, the generic phase spends exactly
that order.

### 2. Park & resume

Payment finalizes inside the already-resumable park objects `pendingCast`
(`state.ts:2394`, spells) and `pendingActivation` (`state.ts:2397`, abilities).
This mirrors the existing sacrifice mechanism, which rides *inside* `pendingCast`
as `castSac` via `parkForSacrifice` (`convex/game.ts:4551`).

At the finalize point — after auto-tap has floated mana and colored requirements
are paid — call `genericSpendAmbiguity`:

- **Ambiguous, no order supplied** → stash `manaSpendChoice = { generic,
  candidateColors }` inside the parked `pendingCast` / `pendingActivation`.
  Return stable state; the prompt is shown. No stack commit.
- **New mutation `resolveManaSpendChoice(gameId, spendOrder)`** — validates
  `spendOrder` (a multiset that is ⊆ pool, sums to `generic`, every element in
  `candidateColors`), then resumes the parked finalize passing
  `genericSpendOrder` into `payManaCost`, clears `manaSpendChoice`, and continues
  the cast/activation normally.
- **Not ambiguous** → greedy auto-pick, no park (unchanged fast path).

Because both payment paths reach the same finalize point, one check covers manual
floating pool and auto-tap overproduction alike.

### 3. Bot

New kind on the `BotAction` union (`src/lib/ai/brain.ts:199`), dispatched through
the exhaustive `botActionRealisation` switch (`src/lib/ai/brain.ts:250`, guarded
by `assertNever` — a missing case is a compile error, never a runtime stall).

Heuristic — **preserve flexibility**: pick the spend order that keeps the most
colors useful for the bot's remaining castable spells this turn (spend the most
disposable mana first). Deterministic; unit-tested.

### 4. Frontend

- **Reducer** `buildTriggerStateView` (`src/lib/card-utils.ts:744`) must carry the
  parked `manaSpendChoice` through to the client. A SURFACE test drives the
  assertion *through* the reducer (a hand-built view masks a dropped field).
- **Wire** `projectPublicState` preserves `pendingCast.manaSpendChoice`;
  wire-format test.
- **Prompt UI** — mana-spend choice renders like the existing `PendingChoicePrompt`
  (`src/components/board/pending-choice-prompt.tsx`, rendered at
  `src/components/board/board.tsx:735`). Floating mana shown as **mana-symbol
  SVGs** (never colored circles with letters); click to assign the spend. Reuse
  the shared panel/frame components. New component in its own file
  (one-component-per-file).
- **Disable-while-pending** — buttons firing `resolveManaSpendChoice` disable
  while the mutation is in flight.

### 5. Serialization

`pendingCast` / `pendingActivation` are already persisted; the new
`manaSpendChoice` sub-field rides along. Add a round-trip smoke test in
`serialize.test.ts` with a non-empty `manaSpendChoice`. (If a new top-level
optional GameState field turns out to be needed instead, add it to
`PERSISTED_OPTIONAL_KEYS`, `convex/gre/serialize.ts:1041` — but the sub-field
approach avoids that.)

## Testing (e2e-mandatory, GRE → game.ts → UI)

| Layer | Test |
|---|---|
| GRE | `genericSpendAmbiguity` truth table (trivial → null; real → candidates) |
| GRE | `payManaCost` honors `genericSpendOrder` |
| GRE | park + resume for **both** paths (manual float + auto-tap) via finalize / `resolveTopOfStack` |
| Backend | `resolveManaSpendChoice` validates order; rejects a bad multiset (wrong sum, non-candidate color, exceeds pool) |
| Wire | `projectPublicState` carries `manaSpendChoice` |
| Bot | flexibility heuristic returns the deterministic expected order |
| Frontend | reducer carries `manaSpendChoice`; clickable-mana affordance; prompt label entry (no raw fallback string) |
| Serialize | round-trip `pendingCast.manaSpendChoice` |

## Preset scenario

Append to `NEW_MECHANIC_SCENARIOS` (`convex/debugScenarios.ts`): a dual-mana land
(Ancient Spring, `W|B`) on the battlefield + an artifact costing `{1}` in hand,
main phase — one click reproduces the ambiguous spend.

## CR references

- **601.2g** — paying a spell's costs; the player chooses which mana pays generic.
- **602** — activating abilities (same payment rules).

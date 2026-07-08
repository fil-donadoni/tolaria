# Unified sacrifice choice — engine-general fix

**Date:** 2026-07-08
**Branch:** `fix/unified-sacrifice-choice`
**Status:** design approved, pending implementation plan

## Problem

Sacrificing a permanent described by a filter ("sacrifice a land", "sacrifice a
Swamp", "sacrifice a green creature") is, per CR 701.21a, always a choice made by
the **sacrificing player** — they pick which permanent they control to sacrifice.
Random or opponent-chosen sacrifice exists only as an explicit per-card override
(e.g. "sacrifice a creature at random"). This holds whether the sacrifice is an
effect (CR 701.21), a cost (CR 601.2f / 118.5), or a combat-declaration tax.

Several engine seams instead **auto-pick** the victim in battlefield order. Each
was shipped as a documented local simplification, and each recurred as a
per-card bug (Witherbloom Charm, then Flooded Woodlands, then Drought). The root
cause is upstream: there is no single sacrifice-selection layer that every
filtered-sacrifice site routes through. Each seam rolls its own victim
resolution, and the ones that auto-pick silently violate CR 701.21a whenever the
candidates are not fungible (different types, tapped state, counters, or
attachments).

**Goal:** one upstream mechanism so the controller always chooses which
permanent to sacrifice, with no further per-card patches and no way for a new
seam to regress to auto-pick.

## Scope

### In scope — the four auto-pick seams to convert

| #   | Seam                                     | Location                                                                                                         | Card examples                   |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| #7  | Static additional cast/activation cost   | `planStaticAdditionalSacrifices` / `payStaticAdditionalCost` (`convex/gre/state.ts:9660`, `convex/game.ts:3292`) | Drought                         |
| #10 | Attack-declaration sacrifice tax         | `confirmAttackers` loop (`convex/game.ts:5592`) over `collectAttackSacrificeTax`                                 | Flooded Woodlands, Reclamation  |
| #16 | Optional-cost (`requestMayPay`) fallback | `payMayPayCost` author/battlefield-order default (`convex/gre/state.ts:~10037`)                                  | Witherbloom Charm               |
| #17 | `autoSacrifice` replacement primitive    | `replacements.ts:167`                                                                                            | dormant — no card callers today |

### In scope — fold the two already-correct single-pickers

The existing per-site pickers already prompt correctly but are single-pick and
duplicate the mechanism. They are folded into the unified structure (count-1,
single-requirement selections) so there is ONE structure, ONE mutation, ONE
client picker path:

- Own-cast additional sacrifice cost — `PendingCast.additionalCost` (sacrifice branch) + `selectAdditionalCost`
- Activated-ability sacrifice cost — `PendingActivation.sacrificeChoice` + `selectActivationCost`

Their existing tests become the regression guard for the folded path.

### Out of scope

- **Exile cost** (`additionalCost` exile branch, Soul Exchange — 1 card, works). The
  `additionalCost` field keeps serving the exile cost as-is; only its sacrifice
  branch migrates.
- **Fixed "sacrifice this source"** sacrifices (mana abilities, cumulative
  upkeep, `cost.sacrifice` self, `ctx.sacrifice(ctx.sourceInstanceId)`) — no
  filter, no choice, correct as-is (`game.ts` rows #1-3, #6, #8-13).
- **Effect-time filtered sacrifice** already routed through a resolution `choice`
  Op or `requestChoice` — already prompts (the `sacrifice` Op `permanents` form,
  Earthlink's `sacrifice-permanents` choice). No change; the new layer does not
  replace resolve-time choices.
- **Edict-style fixed-target effect sacrifice** (`ctx.sacrifice(targetId)`, a few
  FEM cards) — the effect names the victim, no choice. Correct as-is.

## Design

### Core structure — `SacrificeSelection`

A single reusable structure representing "player P must choose which permanents
to sacrifice for a set of filter/count requirements before the in-flight action
finalizes":

```ts
type SacrificeSelection = {
    playerId: string; // the sacrificing player (CR 701.21a)
    reason: string; // "Drought", "Flooded Woodlands", oracle text — banner label
    requirements: {
        filter: PermanentFilter;
        count: number;
    }[];
    picked: string[]; // instance ids chosen so far, across all requirements
};
```

`picked` is a flat list validated against the requirements: a candidate is legal
for the next unmet requirement (the first requirement whose picked-count is below
its `count`) if it matches that requirement's `filter`, is on `playerId`'s
battlefield, and is not already in `picked`.

### Shared module — `convex/gre/sacrificeChoice.ts`

Pure functions (no I/O, matching the GRE pure-function convention):

- `buildSacrificeRequirements(...)` — normalize a cost / tax / may-pay spec into
  `requirements[]` (the one place counts and filters are computed).
- `sacrificeCandidates(state, playerId, filter)` — matching permanents, effective
  colours via `STATIC_EFFECT_CTX.getColors` (mirrors `buildAdditionalCostPicker`).
- `autoResolveFungible(state, sel)` — pre-fill `picked` for any requirement whose
  choice is not meaningful: candidate count equals required count (forced), or all
  candidates are identical (same card name, same tapped state, no counters, no
  attachments/auras). Matches the existing Arena-UX auto-resolve-when-no-real-option
  house style.
- `isSacrificeSelectionComplete(sel)` — every requirement's `count` met.
- `applySacrificeSelection(state, sel)` — execute the sacrifices. **The only place
  `removePermanentTo(..., "sacrifice")` runs for these seams.** Re-checks each
  victim is still on the battlefield (CR 608.2b); a vanished victim is skipped.

### The producers reroute

Each producer, instead of auto-picking, does: compute requirements →
`autoResolveFungible` → if complete, `applySacrificeSelection` inline and continue
(no prompt, no regression on trivial boards) → else park the selection on the
in-flight container, suspend the action, and return.

| Producer                                  | Park container (new field)                                                | Resume tail                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| static cost (Drought)                     | `pendingCast.sacrificeSelection` / `pendingActivation.sacrificeSelection` | `tryAutoCommitPendingCast` / `tryAutoCommitPendingActivation` |
| own-cast sacrifice cost (folded)          | `pendingCast.sacrificeSelection` (count 1)                                | `tryAutoCommitPendingCast`                                    |
| activated-ability sacrifice cost (folded) | `pendingActivation.sacrificeSelection` (count 1)                          | `tryAutoCommitPendingActivation`                              |
| attack tax (Flooded)                      | `combat.pendingAttackSacrifice`                                           | finalize tail of `confirmAttackers`                           |
| optional cost (Witherbloom)               | selection carried on the may-pay pending context                          | may-pay resume                                                |

The commit/finalize gates block while a parked `sacrificeSelection` is incomplete
(mirrors today's `if (ac && !ac.pickedId) return null`).

### One mutation — `selectSacrifice`

```ts
selectSacrifice({ gameId, playerId, cardInstanceId });
```

Finds the active parked `SacrificeSelection` for `playerId` (across pendingCast,
pendingActivation, combat, may-pay — exactly one is active), validates the
candidate against the next unmet requirement, appends to `picked`, and when the
selection is complete resumes the parked action (execute + finalize).

Retires `selectAdditionalCost` (sacrifice path) and the sacrifice branch of
`selectActivationCost`. `selectAdditionalCost` remains only for the exile branch.

### Client

No new projection code — `pendingCast`, `pendingActivation`, and `combat` are
top-level `GameState` fields projected verbatim, so `sacrificeSelection` /
`pendingAttackSacrifice` reach the client automatically.

The board shows a sacrifice picker whenever a `SacrificeSelection` for the viewer
is present and incomplete: highlight the candidates of the next unmet requirement
(`sacrificeCandidates` mirrored client-side against the embedded `filter`), click
dispatches `selectSacrifice`. The payment banner reads `reason` +
`formatFilterLabel(requirements[i].filter)` and shows progress (`picked` /
total). This replaces the two existing picker branches in
`useBattlefieldInteraction`, `useBattlefieldVisualState`, and `payment-banner`.

### General guarantee — no new seam regresses

1. Delete `planStaticAdditionalSacrifices` and the `confirmAttackers` auto loop
   entirely; convert `autoSacrifice`. After this, no code path auto-picks a
   filtered sacrifice.
2. **Grep-guard test**: a catalogue-wide test asserting that `removePermanentTo(…,
"sacrifice")` (and the `ctx.sacrifice` filtered form) appears only in
   `applySacrificeSelection`, the resolve-time interpreter `choice` path, and the
   fixed-self / fixed-target sites. A new filtered auto-pick fails CI.

## Data flow (state machine)

```
producer (cast / activation / attack / may-pay)
  → buildSacrificeRequirements
  → autoResolveFungible
      complete?  ── yes ─→ applySacrificeSelection → finalize action  (no prompt)
                  └─ no ──→ park sel on container, suspend, save, return
                                     │
                    selectSacrifice(candidate)  ← client click
                                     │  append to picked
                            complete? ─ no ─→ save, return (await next pick)
                                     └─ yes ─→ applySacrificeSelection → resume finalize
```

## Testing

Per-seam integration tests crossing GRE → game.ts → UI (mandatory per project
rule):

- **Drought**: cast a spell with 2+ black pips into a board of non-fungible Swamps
  (one with a counter / aura) → selection parked, `selectSacrifice` picks, correct
  Swamps leave. Fungible Swamps → auto-resolve, no prompt.
- **Flooded Woodlands**: declare a green attacker with mixed lands (Forest +
  enchanted Island) → parked, pick, correct land leaves; combat not confirmed
  until complete. All-basic-untapped lands → auto-resolve.
- **Witherbloom Charm** (may-pay): opt in with non-fungible candidates → prompt;
  the former card-level workaround still passes.
- **Folded pickers**: existing own-cast (`additional-cost-cast.test.ts`) and
  activated-ability sacrifice-cost tests pass unchanged through the new path.
- **Wire-format**: assert the parked `SacrificeSelection` survives
  `projectPublicState` with `filter` + `picked` intact and the opponent's view
  does not leak the acting player's choices beyond what CR reveals.
- **Grep-guard** test as above.

## Files touched (anticipated)

- `convex/gre/sacrificeChoice.ts` — new shared module
- `convex/gre/state.ts` — `SacrificeSelection` type; add pending fields; remove
  `planStaticAdditionalSacrifices`; `payMayPayCost` reroute
- `convex/gre/combat.ts` — `pendingAttackSacrifice` shape; keep
  `collectAttackSacrificeTax` (read-only) as the requirement source
- `convex/gre/replacements.ts` — convert `autoSacrifice`
- `convex/game.ts` — reroute `payStaticAdditionalCost`, `confirmAttackers`,
  `tryAutoCommitPendingCast/Activation` gates; new `selectSacrifice`; retire
  sacrifice branches of `selectAdditionalCost` / `selectActivationCost`
- `convex/gameProjections.ts` — none (verbatim), but add a wire-format test
- `src/hooks/useBattlefieldInteraction.tsx`, `src/hooks/useBattlefieldVisualState.ts`,
  `src/components/board/payment-banner.tsx` — unified picker
- `src/components/debug/debug-panel.tsx` — preset scenarios (Drought, Flooded
  Woodlands non-fungible boards)
- serialize.ts — register any new optional `GameState` fields in
  `PERSISTED_OPTIONAL_KEYS`

## Open implementation notes

- The may-pay path (#16) carries its selection on the existing may-pay pending
  context rather than a new top-level field; verify that context is projected.
- `applySacrificeSelection` must snapshot mana value / subtypes / power for the
  seams that read them post-sacrifice (Priest of Yawgmoth, Freyalise Supplicant),
  preserving the existing `additionalSacrificeSnapshot` behaviour.

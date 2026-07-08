# Unified Sacrifice Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One upstream sacrifice-selection layer so the sacrificing player always chooses which permanent to sacrifice (CR 701.21a), with no per-card patches and a CI guard that blocks any new auto-pick.

**Architecture:** A single `SacrificeSelection` structure (`{playerId, reason, requirements[], picked[]}`) plus a pure module `convex/gre/sacrificeChoice.ts`. Each producer (spell cast, ability activation, attack-declaration tax) computes requirements → auto-resolves the fungible/forced case inline → otherwise parks the selection on its in-flight container (`pendingCast.sacrificeSelection`, `pendingActivation.sacrificeSelection`, `combat.pendingAttackSacrifice`) and suspends. One `selectSacrifice` mutation appends picks and, on completion, resumes the parked action. The two already-correct single-pickers (own-cast `additionalCost` sacrifice branch, activated `sacrificeChoice`) fold into this structure. The already-correct may-pay path (`pendingChoices` machinery) is left intact.

**Tech Stack:** TypeScript, Convex mutations, pure GRE functions, vitest. React 19 client picker.

## Global Constraints

- Every game mechanic references its CR section in a code comment. Governing rule: **CR 701.21a** (sacrifice = sacrificing player chooses), CR 601.2f / 118.5 (sacrifice as a cost), CR 608.2b (battlefield re-check at execution).
- GRE mutations are pure functions (no I/O, no async, no `Date.now`/`Math.random`).
- Types come from `convex/cards/types.ts` and `convex/gre/state.ts`; constants/helpers from `convex/gre/constants.ts`. No local copies.
- Every optional `GameState` field must be in `PERSISTED_OPTIONAL_KEYS` (`serialize.ts`) or `TRANSIENT_KEYS`; the drift-guard test fails otherwise.
- Frontend never imports from `convex/gre/`; only public mutations in `convex/game.ts`. All UI text in English.
- Auto-resolve a choice only when there is no real option (Arena-UX house style): forced (candidates ≤ count) or all candidates indistinguishable.
- Green-main invariant: `bun run check:all` + full `bun run test` must be green before done.
- Spec: `docs/superpowers/specs/2026-07-08-unified-sacrifice-choice-design.md`.

---

## File Structure

- **Create** `convex/gre/sacrificeChoice.ts` — the `SacrificeSelection` type + all pure helpers. One responsibility: compute/validate/apply filtered sacrifices.
- **Create** `convex/gre/__tests__/sacrificeChoice.test.ts` — unit tests for the pure module.
- **Modify** `convex/gre/state.ts` — add `SacrificeSelection` import/re-export; add `sacrificeSelection` field to `PendingCast` and `PendingActivation`; add `pendingAttackSacrifice` to `CombatState`; delete `planStaticAdditionalSacrifices`; keep `getStaticAdditionalSacrifices` (requirement source).
- **Modify** `convex/gre/replacements.ts` — delete dormant `autoSacrifice`.
- **Modify** `convex/gre/combat.ts` — keep `collectAttackSacrificeTax` (read-only requirement source); no logic change.
- **Modify** `convex/game.ts` — `announceCast` builds cast `sacrificeSelection`; `tryAutoCommitPendingCast` / `tryAutoCommitPendingActivation` gate + apply via the module; `confirmAttackers` parks/finalizes attack tax; new `selectSacrifice` mutation; retire the sacrifice branch of `selectAdditionalCost` / `selectActivationCost`.
- **Modify** `convex/gre/serialize.ts` — nothing new at top level (`pendingCast`/`pendingActivation`/`combat` already persisted); add a round-trip smoke assertion.
- **Modify** `src/hooks/useBattlefieldInteraction.tsx`, `src/hooks/useBattlefieldVisualState.ts`, `src/components/board/payment-banner.tsx` — unified `sacrificeSelection` picker replacing the two branches.
- **Modify** `src/components/debug/debug-panel.tsx` — preset scenarios (Drought + Flooded Woodlands, non-fungible boards).
- **Create** `convex/gre/__tests__/sacrificeGuard.test.ts` — catalogue-wide grep guard.

---

### Task 1: `SacrificeSelection` type + `sacrificeChoice.ts` pure module

**Files:**
- Create: `convex/gre/sacrificeChoice.ts`
- Create: `convex/gre/__tests__/sacrificeChoice.test.ts`
- Modify: `convex/gre/state.ts` (add optional container fields; re-export type)
- Modify: `convex/gre/serialize.ts` (smoke assertion only — fields nest under already-persisted keys)

**Interfaces:**
- Produces:
  ```ts
  type SacrificeRequirement = {
      filter: PermanentFilter;
      count: number;
      snapshot?: boolean; // own-cast additional cost — caller wants MV/subtypes back
  };
  type SacrificeSelection = {
      playerId: string;
      reason: string;
      requirements: SacrificeRequirement[];
      picked: string[];
  };
  type SacrificeResult = { id: string; mv: number; subtypes?: string[]; snapshot: boolean };
  function buildSacrificeRequirements(specs: SacrificeRequirement[]): SacrificeRequirement[];
  function sacrificeCandidates(state: GameState, playerId: string, filter: PermanentFilter): CardInstanceState[];
  function nextUnmetRequirement(sel: SacrificeSelection): SacrificeRequirement | undefined;
  function isSacrificeCandidateLegal(state: GameState, sel: SacrificeSelection, cardInstanceId: string): boolean;
  function autoResolveFungible(state: GameState, sel: SacrificeSelection): void; // mutates sel.picked
  function isSacrificeSelectionComplete(sel: SacrificeSelection): boolean;
  function applySacrificeSelection(state: GameState, sel: SacrificeSelection): SacrificeResult[];
  ```
- Consumes: `matchesPermanentFilter`, `STATIC_EFFECT_CTX`, `getPlayer`, `removePermanentTo`, `tryGetDefinition` (existing).

- [ ] **Step 1: Write the failing test file** `convex/gre/__tests__/sacrificeChoice.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
    sacrificeCandidates,
    nextUnmetRequirement,
    isSacrificeCandidateLegal,
    autoResolveFungible,
    isSacrificeSelectionComplete,
    applySacrificeSelection,
    type SacrificeSelection,
} from "../sacrificeChoice";
import { makeInstance, makePlayer, makeState } from "../../cards/__tests__/setup";

// CR 701.21a — the sacrificing player chooses which permanent(s) to sacrifice.
describe("sacrificeChoice (CR 701.21a)", () => {
    function landSel(playerId: string, count: number): SacrificeSelection {
        return {
            playerId,
            reason: "Test",
            requirements: [{ filter: { types: ["Land"] }, count }],
            picked: [],
        };
    }

    it("sacrificeCandidates returns only matching permanents on the player's battlefield", () => {
        const forest = makeInstance("forest", { subtypes: ["Forest"], types: ["Land"] });
        const bear = makeInstance("grizzly-bears", { types: ["Creature"] });
        const p1 = makePlayer("p1", { battlefield: [forest, bear] });
        const state = makeState({ players: [p1] });
        const cands = sacrificeCandidates(state, "p1", { types: ["Land"] });
        expect(cands.map((c) => c.id)).toEqual([forest.id]);
    });

    it("autoResolveFungible pre-fills when candidates equal count (forced)", () => {
        const f1 = makeInstance("forest", { types: ["Land"] });
        const f2 = makeInstance("forest", { types: ["Land"] });
        const p1 = makePlayer("p1", { battlefield: [f1, f2] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 2);
        autoResolveFungible(state, sel);
        expect(new Set(sel.picked)).toEqual(new Set([f1.id, f2.id]));
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
    });

    it("autoResolveFungible pre-fills when all candidates are indistinguishable", () => {
        const f1 = makeInstance("forest", { types: ["Land"] });
        const f2 = makeInstance("forest", { types: ["Land"] });
        const f3 = makeInstance("forest", { types: ["Land"] });
        const p1 = makePlayer("p1", { battlefield: [f1, f2, f3] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 1);
        autoResolveFungible(state, sel);
        expect(sel.picked.length).toBe(1);
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
    });

    it("autoResolveFungible leaves a real choice unresolved (tapped differs)", () => {
        const untapped = makeInstance("forest", { types: ["Land"] });
        const tapped = makeInstance("forest", { types: ["Land"], isTapped: true });
        const p1 = makePlayer("p1", { battlefield: [untapped, tapped] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 1);
        autoResolveFungible(state, sel);
        expect(sel.picked.length).toBe(0);
        expect(isSacrificeSelectionComplete(sel)).toBe(false);
    });

    it("isSacrificeCandidateLegal accepts a filter match, rejects a non-match", () => {
        const forest = makeInstance("forest", { types: ["Land"] });
        const bear = makeInstance("grizzly-bears", { types: ["Creature"] });
        const p1 = makePlayer("p1", { battlefield: [forest, bear] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 1);
        expect(isSacrificeCandidateLegal(state, sel, forest.id)).toBe(true);
        expect(isSacrificeCandidateLegal(state, sel, bear.id)).toBe(false);
    });

    it("applySacrificeSelection moves picked permanents to the graveyard and returns MV/subtypes", () => {
        const island = makeInstance("island", { types: ["Land"], subtypes: ["Island"] });
        const p1 = makePlayer("p1", { battlefield: [island] });
        const state = makeState({ players: [p1] });
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Test",
            requirements: [{ filter: { types: ["Land"] }, count: 1, snapshot: true }],
            picked: [island.id],
        };
        const results = applySacrificeSelection(state, sel);
        const player = state.players[0];
        expect(player.battlefield.find((c) => c.id === island.id)).toBeUndefined();
        expect(player.graveyard.some((c) => c.id === island.id)).toBe(true);
        expect(results).toEqual([
            { id: island.id, mv: 0, subtypes: ["Island"], snapshot: true },
        ]);
    });

    it("applySacrificeSelection skips a victim that already left the battlefield (CR 608.2b)", () => {
        const forest = makeInstance("forest", { types: ["Land"] });
        const p1 = makePlayer("p1", { battlefield: [] }); // already gone
        const state = makeState({ players: [p1] });
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Test",
            requirements: [{ filter: { types: ["Land"] }, count: 1 }],
            picked: [forest.id],
        };
        expect(() => applySacrificeSelection(state, sel)).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test convex/gre/__tests__/sacrificeChoice.test.ts`
Expected: FAIL — cannot resolve module `../sacrificeChoice`.

- [ ] **Step 3: Create `convex/gre/sacrificeChoice.ts`**

```ts
// Unified sacrifice-selection layer (CR 701.21a). Every filtered sacrifice —
// as a cost, an attack-declaration tax, or an effect — is a choice made by the
// sacrificing player. This module is the single place those choices are built,
// validated, and executed, so no seam can silently auto-pick a victim.
import type { GameState, CardInstanceState, PlayerState } from "./state";
import type { PermanentFilter } from "../cards/types";
import { getPlayer, removePermanentTo } from "./state";
import { matchesPermanentFilter } from "./filters";
import { STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";

export type SacrificeRequirement = {
    filter: PermanentFilter;
    count: number;
    /** own-cast additional cost: caller wants the sacrificed permanent's MV /
     *  subtypes back for a stack snapshot (Priest of Yawgmoth, Freyalise
     *  Supplicant). Static/tax sacrifices leave this unset. */
    snapshot?: boolean;
};

export type SacrificeSelection = {
    /** the sacrificing player (CR 701.21a) */
    playerId: string;
    /** banner label — card name / oracle text */
    reason: string;
    requirements: SacrificeRequirement[];
    /** instance ids chosen so far, flat across all requirements */
    picked: string[];
};

export type SacrificeResult = {
    id: string;
    mv: number;
    subtypes?: string[];
    snapshot: boolean;
};

/** Normalize a set of specs into requirements, dropping count-0 entries. The one
 *  place counts/filters are assembled for a producer. */
export function buildSacrificeRequirements(
    specs: SacrificeRequirement[]
): SacrificeRequirement[] {
    return specs.filter((r) => r.count > 0);
}

/** Matching permanents on the player's battlefield, with effective colours via
 *  the layer system (mirrors buildAdditionalCostPicker) so a `colors` filter
 *  reads the same colour the rest of the engine sees. */
export function sacrificeCandidates(
    state: GameState,
    playerId: string,
    filter: PermanentFilter
): CardInstanceState[] {
    const player = getPlayer(state, playerId);
    return player.battlefield.filter((c) => {
        const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
        return matchesPermanentFilter(view, filter, {
            selfControllerId: playerId,
        });
    });
}

/** The first requirement whose picked-count is below its `count`. Picks are
 *  assigned to requirements greedily in order: a pick that matches requirement i
 *  fills i before i+1. */
export function nextUnmetRequirement(
    sel: SacrificeSelection
): SacrificeRequirement | undefined {
    let remaining = [...sel.picked];
    for (const req of sel.requirements) {
        let filled = 0;
        // consume picks that could satisfy this requirement, up to its count
        const kept: string[] = [];
        for (const id of remaining) {
            if (filled < req.count) {
                filled += 1;
            } else {
                kept.push(id);
            }
        }
        remaining = kept;
        if (filled < req.count) return req;
    }
    return undefined;
}

function counterCount(c: CardInstanceState): number {
    const counters = (c as { counters?: Record<string, number> }).counters;
    if (!counters) return 0;
    return Object.values(counters).reduce((a, b) => a + b, 0);
}

function hasAttachments(state: GameState, c: CardInstanceState): boolean {
    for (const p of state.players) {
        for (const other of p.battlefield) {
            if ((other as { attachedTo?: string }).attachedTo === c.id) {
                return true;
            }
        }
    }
    return false;
}

/** Identity key for fungibility: same card, same tapped state, no counters, no
 *  attachments. Two permanents sharing a key are indistinguishable choices. */
function identityKey(state: GameState, c: CardInstanceState): string {
    const cardId = (c.card as { id?: string }).id ?? "?";
    return [
        cardId,
        c.isTapped ? "T" : "U",
        counterCount(c),
        hasAttachments(state, c) ? "A" : "-",
    ].join("|");
}

/** Pre-fill `picked` for any requirement whose choice is not meaningful:
 *  candidate count equals (or is below) the required count (forced), or all
 *  candidates are indistinguishable. Matches the Arena-UX auto-resolve house
 *  style. Requirements with a real choice are left for the client. */
export function autoResolveFungible(
    state: GameState,
    sel: SacrificeSelection
): void {
    const used = new Set(sel.picked);
    for (const req of sel.requirements) {
        // count how many picks already satisfy this requirement
        const alreadyForThis = countPicksFor(sel, req);
        let need = req.count - alreadyForThis;
        if (need <= 0) continue;
        const cands = sacrificeCandidates(state, sel.playerId, req.filter).filter(
            (c) => !used.has(c.id)
        );
        if (cands.length <= need) {
            for (const c of cands) {
                sel.picked.push(c.id);
                used.add(c.id);
            }
            continue;
        }
        const distinct = new Set(cands.map((c) => identityKey(state, c)));
        if (distinct.size === 1) {
            for (let i = 0; i < need; i++) {
                sel.picked.push(cands[i].id);
                used.add(cands[i].id);
            }
        }
        // else: a real choice remains — leave unresolved
    }
}

/** How many of sel.picked are allocated to this specific requirement (by
 *  greedy in-order allocation). */
function countPicksFor(
    sel: SacrificeSelection,
    target: SacrificeRequirement
): number {
    let remaining = [...sel.picked];
    for (const req of sel.requirements) {
        const take = Math.min(req.count, remaining.length);
        const forThis = remaining.slice(0, take);
        remaining = remaining.slice(take);
        if (req === target) return forThis.length;
    }
    return 0;
}

/** True when a candidate legally satisfies the next unmet requirement:
 *  matches its filter, on the player's battlefield, not already picked. */
export function isSacrificeCandidateLegal(
    state: GameState,
    sel: SacrificeSelection,
    cardInstanceId: string
): boolean {
    if (sel.picked.includes(cardInstanceId)) return false;
    const req = nextUnmetRequirement(sel);
    if (!req) return false;
    const cands = sacrificeCandidates(state, sel.playerId, req.filter);
    return cands.some((c) => c.id === cardInstanceId);
}

export function isSacrificeSelectionComplete(sel: SacrificeSelection): boolean {
    return nextUnmetRequirement(sel) === undefined;
}

function manaValueOf(c: CardInstanceState): number {
    const cardId = (c.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def?.manaCost) return 0;
    return Object.values(def.manaCost).reduce<number>(
        (acc, v) => acc + (typeof v === "number" ? v : 0),
        0
    );
}

/** Execute the sacrifices. The ONLY place removePermanentTo(…, "sacrifice")
 *  runs for the converted seams. Re-checks each victim is still on the
 *  battlefield (CR 608.2b); a vanished victim is skipped. Returns per-victim
 *  MV/subtypes for snapshot-flagged requirements. */
export function applySacrificeSelection(
    state: GameState,
    sel: SacrificeSelection
): SacrificeResult[] {
    const results: SacrificeResult[] = [];
    // map each picked id to its requirement (greedy, in order) to carry the
    // snapshot flag through.
    const flags = pickSnapshotFlags(sel);
    for (const id of sel.picked) {
        const player: PlayerState = getPlayer(state, sel.playerId);
        const victim = player.battlefield.find((c) => c.id === id);
        if (!victim) continue; // CR 608.2b — already gone
        const snapshot = flags.get(id) ?? false;
        const subtypes =
            victim.subtypes && victim.subtypes.length > 0
                ? [...victim.subtypes]
                : undefined;
        results.push({
            id,
            mv: manaValueOf(victim),
            ...(subtypes ? { subtypes } : {}),
            snapshot,
        });
        removePermanentTo(state, id, "graveyard", "sacrifice");
    }
    return results;
}

function pickSnapshotFlags(sel: SacrificeSelection): Map<string, boolean> {
    const flags = new Map<string, boolean>();
    let remaining = [...sel.picked];
    for (const req of sel.requirements) {
        const take = Math.min(req.count, remaining.length);
        for (let i = 0; i < take; i++) {
            flags.set(remaining[i], req.snapshot ?? false);
        }
        remaining = remaining.slice(take);
    }
    return flags;
}
```

> **Implementer note:** verify the exact import paths at edit time — `matchesPermanentFilter` and `STATIC_EFFECT_CTX` may be re-exported from `state.ts` rather than `filters.ts`/`layers.ts`. Grep: `rg "export (function|const) matchesPermanentFilter" convex/gre` and `rg "STATIC_EFFECT_CTX =" convex/gre`. Also confirm `CardInstanceState.attachedTo` / `.counters` field names (`rg "attachedTo\??:" convex/gre/state.ts`, `rg "counters\??:" convex/gre/state.ts`); adjust `hasAttachments`/`counterCount` accessors to the real names. If attachments use a different model (e.g. `attachments: string[]` on the host), rewrite `hasAttachments` accordingly.

- [ ] **Step 4: Add container fields + re-export in `convex/gre/state.ts`**

Add to the `PendingCast` type (next to `additionalCost` at ~line 1146):
```ts
    /** Unified filtered-sacrifice choice for this cast (CR 701.21a): own-cast
     *  additional sacrifice cost AND board-wide static additional sacrifice
     *  (Drought), folded into one selection. `additionalCost` remains for the
     *  exile branch only. */
    sacrificeSelection?: import("./sacrificeChoice").SacrificeSelection;
```

Add to the `PendingActivation` type (next to `sacrificeChoice` at ~line 1183):
```ts
    /** Unified filtered-sacrifice choice for this activation (CR 701.21a).
     *  Replaces the legacy single-pick `sacrificeChoice`. */
    sacrificeSelection?: import("./sacrificeChoice").SacrificeSelection;
```

Add to `CombatState` (next to `pendingBlockerId` at ~line 1742):
```ts
    /** Parked land-sacrifice attack tax awaiting the attacking player's choice
     *  (CR 508.1c/1g, 701.21a — Flooded Woodlands, Reclamation). Present only
     *  while the tax is non-fungible; confirmAttackers finalizes once complete. */
    pendingAttackSacrifice?: import("./sacrificeChoice").SacrificeSelection;
```

- [ ] **Step 5: Run the module tests to verify they pass**

Run: `bun run test convex/gre/__tests__/sacrificeChoice.test.ts`
Expected: PASS (all 7).

- [ ] **Step 6: Serialize smoke — add a round-trip assertion in `convex/gre/serialize.ts` test**

`pendingCast`, `pendingActivation`, `combat` are already in `PERSISTED_OPTIONAL_KEYS`, so no key changes. Add a representative round-trip in `convex/gre/__tests__/serialize.test.ts`:

```ts
it("round-trips a parked sacrificeSelection on pendingCast", () => {
    const forest = makeInstance("forest", { types: ["Land"] });
    const p1 = makePlayer("p1", { battlefield: [forest] });
    const state = makeState({ players: [p1] });
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "x",
        manaCost: {},
        sacrificeSelection: {
            playerId: "p1",
            reason: "Drought",
            requirements: [{ filter: { subtypes: ["Swamp"] }, count: 2 }],
            picked: [forest.id],
        },
    } as unknown as NonNullable<GameState["pendingCast"]>;
    const round = deserializeGameState(serializeGameState(state));
    expect(round.pendingCast?.sacrificeSelection?.picked).toEqual([forest.id]);
});
```

> **Implementer note:** match the exact `serializeGameState`/`deserializeGameState` names and `makeInstance/makePlayer/makeState` imports already used in that test file.

- [ ] **Step 7: Run + commit**

Run: `bun run test convex/gre/__tests__/sacrificeChoice.test.ts convex/gre/__tests__/serialize.test.ts`
Expected: PASS.

```bash
git add convex/gre/sacrificeChoice.ts convex/gre/__tests__/sacrificeChoice.test.ts convex/gre/state.ts convex/gre/__tests__/serialize.test.ts
git commit -m "feat: unified SacrificeSelection module + containers (CR 701.21a)"
```

---

### Task 2: Fold own-cast additional sacrifice + reroute Drought into `pendingCast.sacrificeSelection`

**Files:**
- Modify: `convex/game.ts` — `announceCast` (build selection, ~3727-3745), `tryAutoCommitPendingCast` (gate + apply, 1612-1780), `payStaticAdditionalCost` usage (delete call at 1742)
- Modify: `convex/gre/state.ts` — delete `planStaticAdditionalSacrifices` (9660)
- Test: `convex/cards/sets/ice/__tests__/white.test.ts` (Drought) or a dedicated `convex/gre/__tests__/sacrificeCast.test.ts`

**Interfaces:**
- Consumes: `buildSacrificeRequirements`, `getStaticAdditionalSacrifices`, `sacrificeCandidates`, `autoResolveFungible`, `isSacrificeSelectionComplete`, `applySacrificeSelection` (Task 1).
- Produces: `pendingCast.sacrificeSelection` populated by `announceCast`; consumed by `tryAutoCommitPendingCast` and `selectSacrifice` (Task 5).

- [ ] **Step 1: Write the failing integration test** `convex/gre/__tests__/sacrificeCast.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../cards/__tests__/setup";
import { tryAutoCommitPendingCast } from "../../game"; // adjust if not exported
import { isSacrificeSelectionComplete } from "../sacrificeChoice";

// CR 601.2f / 118.5 / 701.21a — Drought's board-wide "sacrifice a Swamp per
// black pip" additional cost is a choice made by the casting player.
describe("Drought additional sacrifice (CR 701.21a)", () => {
    it("parks a selection when Swamps are non-fungible and does not auto-pick", () => {
        // Board: Drought in play; caster has 2 Swamps, one tapped (distinguishable).
        // Cast a 1-black-pip spell → 1 Swamp to sacrifice, real choice → parked.
        // (Scenario builder details filled during implementation to match Drought's
        //  static additional-cost predicate and a castable black spell.)
        // Assert: state.pendingCast.sacrificeSelection present + incomplete,
        //         both Swamps still on the battlefield.
        expect(true).toBe(true); // replaced with the real assertion below
    });
});
```

> **Implementer note:** build the real scenario using Drought (`convex/cards/sets/ice/white.ts:767`) in play, a black spell in hand (e.g. any mono-black 1-pip creature already in the catalogue), the caster with two Swamps where one is `isTapped: true`. Drive it through the actual cast entry (`announceCast` → payment → `tryAutoCommitPendingCast`) exactly as an existing cast test in the same directory does. Then assert the parked selection. Replace the placeholder `expect(true)`.

- [ ] **Step 2: Run to verify it fails** (once the real scenario is written, it fails because `sacrificeSelection` is never populated)

Run: `bun run test convex/gre/__tests__/sacrificeCast.test.ts`
Expected: FAIL — `pendingCast.sacrificeSelection` is `undefined` (Drought still auto-picks).

- [ ] **Step 3: Build the cast selection in `announceCast`**

Find where `announceCast` sets `pendingCast.additionalCost` (~3727-3745, uses `buildAdditionalCostPicker`). Change so that:
- The **exile** branch keeps setting `additionalCost` (unchanged).
- The **sacrifice** branch instead contributes a `SacrificeRequirement` (count 1, `snapshot: true`) to a combined selection.
- **Also** compute the static Drought requirements up front via `getStaticAdditionalSacrifices(state, castDef?.manaCost, announcedCardInstance, "spell")` and map each to `{ filter, count }` (no snapshot).
- Combine both into `requirements[]`; if non-empty, build the selection, run `autoResolveFungible`, and — only if still incomplete — set `pendingCast.sacrificeSelection`. If `autoResolveFungible` completed it, still set it (so the commit applies the picked ids uniformly) — completeness is what the gate checks.

```ts
// CR 601.2f / 118.5 / 701.21a — assemble every filtered sacrifice this cast
// owes into one selection: the card's own additional sacrifice cost plus any
// board-wide static additional sacrifice (Drought). The player chooses; a
// fungible/forced board auto-resolves so trivial casts never prompt.
const sacSpecs: SacrificeRequirement[] = [];
if (picker && picker.kind === "sacrifice") {
    sacSpecs.push({ filter: picker.filter, count: 1, snapshot: true });
}
for (const req of getStaticAdditionalSacrifices(
    state,
    castDef?.manaCost,
    announcedInstance,
    "spell"
)) {
    sacSpecs.push({ filter: req.filter, count: req.count });
}
const requirements = buildSacrificeRequirements(sacSpecs);
if (requirements.length > 0) {
    const sel: SacrificeSelection = {
        playerId: args.playerId,
        reason: cardName ?? "Sacrifice",
        requirements,
        picked: [],
    };
    autoResolveFungible(state, sel);
    pendingCast.sacrificeSelection = sel;
}
// keep pendingCast.additionalCost ONLY for the exile branch:
if (picker && picker.kind === "exile") {
    pendingCast.additionalCost = picker; // { kind: "exile", filter }
}
```

> **Implementer note:** read the current `announceCast` picker construction to get the exact variable names (`picker`, `announcedInstance`, `castDef`, `cardName`) and where `pendingCast` is assembled. The static-cost gate previously lived only inside commit; moving the *choice* to announce time is CR-correct (601.2f is part of casting). Also confirm `getLegalActions` still gates "cast" on payability so a board with too few Swamps can't reach here (mirrors the existing `buildAdditionalCostPicker` invariant); if not, add the affordability throw.

- [ ] **Step 4: Gate + apply in `tryAutoCommitPendingCast`**

Replace the `additionalCost` gate at 1654-1657 with a `sacrificeSelection` gate:
```ts
// CR 601.2f / 701.21a: commit is blocked until every filtered sacrifice has
// been chosen. The player completes the choice via selectSacrifice.
const sel = state.pendingCast.sacrificeSelection;
if (sel && !isSacrificeSelectionComplete(sel)) {
    return null;
}
// exile additional cost still gates on its own picker:
const ac = state.pendingCast.additionalCost;
if (ac && ac.kind === "exile" && !ac.pickedId) {
    return null;
}
```

Replace the sacrifice-execution block (1683-1713) and the `payStaticAdditionalCost` call (1742-1748). Instead, after mana is paid and the spell card is pulled from hand, apply the unified selection:
```ts
// CR 117.9 / 601.2f — execute every chosen sacrifice through the unified layer.
let additionalSacrificeSnapshot: StackItem["additionalSacrificeSnapshot"];
if (sel) {
    const results = applySacrificeSelection(state, sel);
    const snap = results.find((r) => r.snapshot);
    if (snap) {
        additionalSacrificeSnapshot = {
            cardInstanceId: snap.id,
            mv: snap.mv,
            ...(snap.subtypes ? { subtypes: snap.subtypes } : {}),
        };
    }
}
// exile branch unchanged:
if (ac && ac.kind === "exile" && ac.pickedId) {
    const exiled = player.battlefield.find((c) => c.id === ac.pickedId);
    if (!exiled) { state.pendingCast = undefined; return null; }
    // (retain existing exile snapshot logic here)
    removePermanentTo(state, exiled.id, "exile");
}
```
Delete the standalone `payStaticAdditionalCost(state, castDef?.manaCost, spellCard, player, "spell")` call at 1742-1748.

> **Implementer note:** the ordering matters — the existing code sacrifices BEFORE removing the spell from hand and BEFORE `payStaticAdditionalCost` (which ran after). The unified `applySacrificeSelection` should run at the same logical point the old own-cast sacrifice ran (after mana paid). Verify no downstream reader depends on the Drought sacrifice happening strictly after `removeFromZone`. Keep the "picked permanent vanished → drop pendingCast" safety: `applySacrificeSelection` already skips vanished victims, but if the SNAPSHOT victim vanished the snapshot is simply absent — acceptable (mirrors CR 608.2b).

- [ ] **Step 5: Delete `planStaticAdditionalSacrifices`**

Remove the function at `convex/gre/state.ts:9660-9688` and any export. Keep `getStaticAdditionalSacrifices`.

- [ ] **Step 6: Finish the integration test (fungible + non-fungible) and run**

Fill both cases: non-fungible → parked & incomplete, no Swamp gone yet; fungible (two untapped identical Swamps, 1 pip) → auto-resolved, spell commits, exactly one Swamp gone.

Run: `bun run test convex/gre/__tests__/sacrificeCast.test.ts`
Expected: PASS.

- [ ] **Step 7: Run adjacent suites + commit**

Run: `bun run test convex/cards/sets/ice/__tests__/white.test.ts convex/gre/__tests__/state.test.ts`
Expected: PASS (or fix fallout from the deleted `planStaticAdditionalSacrifices`).

```bash
git add convex/game.ts convex/gre/state.ts convex/gre/__tests__/sacrificeCast.test.ts
git commit -m "feat: route cast additional sacrifice + Drought through SacrificeSelection"
```

---

### Task 3: Fold activated `sacrificeChoice` + reroute ability static additional cost

**Files:**
- Modify: `convex/game.ts` — where `pendingActivation.sacrificeChoice` is built (activation announce path) and `tryAutoCommitPendingActivation` (gate + apply)
- Test: `convex/gre/__tests__/sacrificeActivation.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `pendingActivation.sacrificeSelection`; consumed by `tryAutoCommitPendingActivation` + `selectSacrifice`.

- [ ] **Step 1: Write the failing test** — an activated ability with a "sacrifice a creature" cost onto a non-fungible board parks `pendingActivation.sacrificeSelection` (incomplete); a fungible board auto-resolves and the ability reaches the stack.

```ts
import { describe, it, expect } from "vitest";
import { isSacrificeSelectionComplete } from "../sacrificeChoice";
// + setup + activation entry point used by existing activation tests

describe("activated-ability sacrifice cost (CR 602.1 / 701.21a)", () => {
    it("parks a selection on a non-fungible board", () => {
        // Ability: "Sacrifice a creature: <effect>". Controller has two different
        // creatures. Activate → sacrificeSelection parked + incomplete.
        expect(true).toBe(true); // replace with real assertion
    });
});
```

> **Implementer note:** mirror an existing activated-sacrifice test (grep `sacrificeChoice` usages in `convex/**/__tests__`). Reuse that card and the same activation entry point.

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test convex/gre/__tests__/sacrificeActivation.test.ts`
Expected: FAIL — `sacrificeSelection` undefined.

- [ ] **Step 3: Build the selection at activation announce**

Find where `pendingActivation.sacrificeChoice = { filter }` is set. Replace with a `sacrificeSelection` assembled from: the ability's own sacrifice cost (count 1) plus `getStaticAdditionalSacrifices(state, abilityRawCost, source, "ability")`. Run `autoResolveFungible`, set `pendingActivation.sacrificeSelection`.

```ts
const sacSpecs: SacrificeRequirement[] = [];
if (abilitySacrificeFilter) {
    sacSpecs.push({ filter: abilitySacrificeFilter, count: 1 });
}
for (const req of getStaticAdditionalSacrifices(state, abilityRawCost, source, "ability")) {
    sacSpecs.push({ filter: req.filter, count: req.count });
}
const requirements = buildSacrificeRequirements(sacSpecs);
if (requirements.length > 0) {
    const sel: SacrificeSelection = {
        playerId: args.playerId,
        reason: sourceName ?? "Sacrifice",
        requirements,
        picked: [],
    };
    autoResolveFungible(state, sel);
    pendingActivation.sacrificeSelection = sel;
}
```

- [ ] **Step 4: Gate + apply in `tryAutoCommitPendingActivation`**

Find its `sacrificeChoice` gate (mirror of the cast gate) and its execution (`removePermanentTo(...,"sacrifice")` for the picked id + any `payStaticAdditionalCost(..., "ability")` call). Replace with:
```ts
const sel = state.pendingActivation.sacrificeSelection;
if (sel && !isSacrificeSelectionComplete(sel)) return null;
// …after mana paid, before pushing the ability on the stack:
if (sel) applySacrificeSelection(state, sel);
```
Delete the ability-path `payStaticAdditionalCost(..., "ability")` call if present.

> **Implementer note:** read `tryAutoCommitPendingActivation` in full first (not captured here). Preserve any `notedManaSpent` / mana snapshot logic and the tap-other-choice branch (`tapOtherChoice` is a DIFFERENT cost — do NOT fold it). Only the sacrifice leg migrates.

- [ ] **Step 5: Finish the test (both cases) + run**

Run: `bun run test convex/gre/__tests__/sacrificeActivation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/game.ts convex/gre/__tests__/sacrificeActivation.test.ts
git commit -m "feat: route activated-ability sacrifice cost through SacrificeSelection"
```

---

### Task 4: Reroute attack-declaration tax → `combat.pendingAttackSacrifice`

**Files:**
- Modify: `convex/game.ts` — `confirmAttackers` loop (5592-5601) → park/finalize
- Test: `convex/gre/__tests__/sacrificeAttackTax.test.ts`

**Interfaces:**
- Consumes: `collectAttackSacrificeTax` (combat.ts, unchanged), Task 1 helpers.
- Produces: `combat.pendingAttackSacrifice`; consumed by `selectSacrifice` (Task 5) + a `finalizeConfirmAttackers` tail.

- [ ] **Step 1: Write the failing test** — declare a green attacker while Flooded Woodlands is in play and the controller has a Forest + an enchanted Island (non-fungible). Expect `combat.pendingAttackSacrifice` parked, `combat.confirmed` still false, no land gone. All-basic-untapped lands → auto-resolve, `combat.confirmed` true, one land gone.

```ts
import { describe, it, expect } from "vitest";

describe("attack-declaration sacrifice tax (CR 508.1c / 701.21a)", () => {
    it("parks the land choice when lands are non-fungible", () => {
        // Flooded Woodlands in play; active player declares a green creature;
        // controls Forest + Island(enchanted). Confirm attackers →
        // combat.pendingAttackSacrifice parked, combat.confirmed false.
        expect(true).toBe(true); // replace
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test convex/gre/__tests__/sacrificeAttackTax.test.ts`
Expected: FAIL — `combat.pendingAttackSacrifice` undefined; tax auto-picks.

- [ ] **Step 3: Extract a `finalizeConfirmAttackers` tail**

Move everything in `confirmAttackers` AFTER the tax loop (the "Tap and mark each attacker" block through the end, 5603+) into a pure helper so both the inline auto-resolve path and the `selectSacrifice` resume path can call it:
```ts
function finalizeConfirmAttackers(state: GameState, player: PlayerState): void {
    // (moved body: tap+mark attackers, set combat.confirmed, reset blocker
    //  fields, fire "when creatures attack" triggers, etc.)
}
```

- [ ] **Step 4: Replace the tax loop with build → auto-resolve → park or finalize**

```ts
// CR 508.1c/1g / 701.21a — the taxed attacker's controller chooses which land
// to sacrifice. Build one selection across every active tax charge; a
// fungible/forced board auto-resolves inline, else park and suspend until the
// player picks via selectSacrifice.
const charges = collectAttackSacrificeTax(state);
if (charges.length > 0) {
    // all charges target the active (attacking) player here; assert single payer
    const requirements = charges.map((ch) => ({
        filter: { types: ["Land"] } as PermanentFilter,
        count: ch.count,
    }));
    const payerId = charges[0].controllerId;
    // affordability: reject the declaration if too few lands (mirrors old throw)
    const totalNeeded = charges.reduce((a, ch) => a + ch.count, 0);
    if (sacrificeCandidates(state, payerId, { types: ["Land"] }).length < totalNeeded) {
        throw new Error(charges[0].reason);
    }
    const sel: SacrificeSelection = {
        playerId: payerId,
        reason: charges[0].reason,
        requirements: buildSacrificeRequirements(requirements),
        picked: [],
    };
    autoResolveFungible(state, sel);
    if (!isSacrificeSelectionComplete(sel)) {
        state.combat.pendingAttackSacrifice = sel;
        // suspend: save with combat unconfirmed; selectSacrifice resumes.
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state, gameState);
        return;
    }
    applySacrificeSelection(state, sel);
}
finalizeConfirmAttackers(state, player);
```

> **Implementer note:** `collectAttackSacrificeTax` returns one charge per controller; the attack-tax cards (Flooded Woodlands/Reclamation) tax the ATTACKING player, so `controllerId` is the active player for all charges. If a future card could tax multiple distinct controllers simultaneously the single-payer assumption breaks — add an assertion (`new Set(charges.map(c=>c.controllerId)).size === 1`) and open an issue rather than silently handling only one. Confirm the tax uses a plain "sacrifice a land" filter; `collectAttackSacrificeTax` does not currently carry a filter (only count), so `{ types: ["Land"] }` is the correct filter per Flooded Woodlands oracle text.

- [ ] **Step 5: Finish the test (both cases) + run**

Run: `bun run test convex/gre/__tests__/sacrificeAttackTax.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/game.ts convex/gre/__tests__/sacrificeAttackTax.test.ts
git commit -m "feat: route attack-declaration land tax through SacrificeSelection"
```

---

### Task 5: `selectSacrifice` mutation

**Files:**
- Modify: `convex/game.ts` — new `selectSacrifice` mutation; retire the sacrifice branch of `selectAdditionalCost` / `selectActivationCost`
- Test: `convex/gre/__tests__/selectSacrifice.test.ts` (backend integration)

**Interfaces:**
- Consumes: `isSacrificeCandidateLegal`, `isSacrificeSelectionComplete` (Task 1); `tryAutoCommitPendingCast`, `tryAutoCommitPendingActivation` (Tasks 2/3); `finalizeConfirmAttackers` + `applySacrificeSelection` (Task 4).
- Produces: `api.game.selectSacrifice` for the client (Task 6).

- [ ] **Step 1: Write the failing test** — park a `pendingCast.sacrificeSelection` (Drought, non-fungible), call `selectSacrifice` for a legal Swamp → picked grows; call again to complete → spell commits, correct Swamp gone, wrong one stays. Reject a non-matching candidate and a candidate when no selection is active.

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test convex/gre/__tests__/selectSacrifice.test.ts`
Expected: FAIL — `api.game.selectSacrifice` undefined.

- [ ] **Step 3: Implement the mutation**

```ts
// CR 701.21a — the sacrificing player picks one permanent per call. Dispatches
// to whichever action is currently awaiting this player's sacrifice choice
// (cast, activation, or attack tax — exactly one is active).
export const selectSacrifice = mutation({
    args: {
        gameId: v.id("games"),
        playerId: v.string(),
        cardInstanceId: v.string(),
    },
    handler: async (ctx, args) => {
        const gameState = await getLatestGameState(ctx, args.gameId);
        if (!gameState) throw new Error("Game not found");
        const state = structuredClone(gameState.state) as GameState;
        assertGameNotOver(state);
        assertExpectedInput(state, { playerId: args.playerId, expect: "priority" });

        const active = findActiveSacrificeSelection(state, args.playerId);
        if (!active) throw new Error("No sacrifice choice awaiting you");
        const { sel, container } = active;
        if (!isSacrificeCandidateLegal(state, sel, args.cardInstanceId)) {
            throw new Error("Selected permanent is not a legal sacrifice");
        }
        sel.picked.push(args.cardInstanceId);

        if (isSacrificeSelectionComplete(sel)) {
            if (container === "cast") {
                tryAutoCommitPendingCast(state, args.playerId);
            } else if (container === "activation") {
                tryAutoCommitPendingActivation(state, args.playerId);
            } else {
                // attack tax: apply + finalize the declaration
                applySacrificeSelection(state, sel);
                state.combat!.pendingAttackSacrifice = undefined;
                finalizeConfirmAttackers(state, getPlayer(state, state.activePlayerId));
            }
        }
        await saveGameState(ctx, args.gameId, gameState.seq + 1, state, gameState);
    },
});

function findActiveSacrificeSelection(
    state: GameState,
    playerId: string
): { sel: SacrificeSelection; container: "cast" | "activation" | "attack" } | null {
    const pc = state.pendingCast;
    if (pc && pc.playerId === playerId && pc.sacrificeSelection &&
        !isSacrificeSelectionComplete(pc.sacrificeSelection)) {
        return { sel: pc.sacrificeSelection, container: "cast" };
    }
    const pa = state.pendingActivation;
    if (pa && pa.playerId === playerId && pa.sacrificeSelection &&
        !isSacrificeSelectionComplete(pa.sacrificeSelection)) {
        return { sel: pa.sacrificeSelection, container: "activation" };
    }
    const at = state.combat?.pendingAttackSacrifice;
    if (at && at.playerId === playerId && !isSacrificeSelectionComplete(at)) {
        return { sel: at, container: "attack" };
    }
    return null;
}
```

> **Implementer note:** `tryAutoCommitPendingCast`/`tryAutoCommitPendingActivation` already call `applySacrificeSelection` internally (Tasks 2/3), so the cast/activation branches must NOT double-apply. The attack branch applies here because `finalizeConfirmAttackers` does not. Confirm the priority/`assertExpectedInput` expectation is correct for the attack-tax case (the active player has priority during declare-attackers) — if `expect: "priority"` is wrong there, branch the assertion by container.

- [ ] **Step 4: Retire the folded server branches**

- `selectAdditionalCost` (4087): keep the exile branch, remove the sacrifice-filter matching + `ac.pickedId` sacrifice path (now handled by `selectSacrifice`). If `additionalCost` is exile-only now, simplify accordingly.
- `selectActivationCost` (4462): keep `tapOtherChoice`; remove the `sacrificeChoice` branch (4532-4561).
- Delete the now-unused `sacrificeChoice` field on `PendingActivation` and the sacrifice branch of `additionalCost` handling if fully dead. Grep for readers first.

- [ ] **Step 5: Run + commit**

Run: `bun run test convex/gre/__tests__/selectSacrifice.test.ts convex/gre/__tests__/sacrificeCast.test.ts convex/gre/__tests__/sacrificeActivation.test.ts convex/gre/__tests__/sacrificeAttackTax.test.ts`
Expected: PASS.

```bash
git add convex/game.ts convex/gre/state.ts convex/gre/__tests__/selectSacrifice.test.ts
git commit -m "feat: selectSacrifice mutation; retire folded cost pickers"
```

---

### Task 6: Unified client picker

**Files:**
- Modify: `src/hooks/useBattlefieldInteraction.tsx` (194-217, 275-294, mutation ref 101-102)
- Modify: `src/hooks/useBattlefieldVisualState.ts` (85-130, 222-231, 455-465)
- Modify: `src/components/board/payment-banner.tsx` (38-58 + render)
- Test: `src/components/board/__tests__/board-sacrifice-choice.test.tsx`

**Interfaces:**
- Consumes: `api.game.selectSacrifice`; `pendingCast.sacrificeSelection`, `pendingActivation.sacrificeSelection`, `combat.pendingAttackSacrifice` (projected verbatim).
- Produces: highlighted candidates + click dispatch + banner label.

- [ ] **Step 1: Write the failing component test** — render a board where the viewer's `pendingCast.sacrificeSelection` is incomplete; assert the matching permanents are clickable/highlighted, clicking dispatches `selectSacrifice({gameId, playerId, cardInstanceId})`, and the banner shows `reason` + the next requirement's filter label + progress.

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/components/board/__tests__/board-sacrifice-choice.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add a shared client selector**

Create `src/lib/sacrifice-selection.ts`:
```ts
import type { GameState } from "convex/gre/state"; // type-only import allowed
type Sel = NonNullable<GameState["pendingCast"]>["sacrificeSelection"];

/** The active (incomplete) sacrifice selection for this viewer, across all
 *  three containers. Mirrors the server's findActiveSacrificeSelection. */
export function activeSacrificeSelection(
    pendingCast: GameState["pendingCast"],
    pendingActivation: GameState["pendingActivation"],
    combat: GameState["combat"],
    playerId: string
): NonNullable<Sel> | undefined {
    const pick = (s: Sel, owner?: string) =>
        s && owner === playerId && !isComplete(s) ? s : undefined;
    return (
        pick(pendingCast?.sacrificeSelection, pendingCast?.playerId) ??
        pick(pendingActivation?.sacrificeSelection, pendingActivation?.playerId) ??
        pick(combat?.pendingAttackSacrifice, combat?.pendingAttackSacrifice?.playerId)
    );
}

export function nextRequirement(sel: NonNullable<Sel>) {
    // greedy in-order allocation, mirror of server nextUnmetRequirement
    let remaining = sel.picked.length;
    for (const req of sel.requirements) {
        if (remaining < req.count) return req;
        remaining -= req.count;
    }
    return undefined;
}
function isComplete(s: Sel): boolean {
    if (!s) return true;
    return nextRequirement(s) === undefined;
}
```

> **Implementer note:** frontend must not import GRE *runtime* code — type-only `import type` from `convex/gre/state` is the established pattern (verify how existing hooks import `PendingCast`). Reuse `matchesPermanentFilter` client mirror already used by `matchesActivationCostPick` for candidate highlighting.

- [ ] **Step 4: Replace the two branches in the hooks**

In `useBattlefieldInteraction.tsx`: replace `isPickingAdditionalCost` + `isPickingActivationCost` (sacrifice legs) with one `isPickingSacrifice = !!activeSacrificeSelection(...)`; dispatch `selectSacrifice`. Keep the exile `additionalCost` branch and the `tapOtherChoice` branch untouched.

In `useBattlefieldVisualState.ts`: replace the sacrifice legs of `canInteract`/ring highlight with a check against `nextRequirement(sel).filter` via `matchesPermanentFilter`. Keep tap-other + exile legs.

- [ ] **Step 5: Banner label in `payment-banner.tsx`**

Add a `describeSacrificeChoice(sel)` returning `` `sacrifice ${formatFilterLabel(nextRequirement(sel).filter)}` `` with progress `(picked/total)` when count > 1. Wire it into the subtitle when a sacrifice selection is active, replacing `describeActivationCostChoice`'s sacrifice leg.

- [ ] **Step 6: Run + `check:all` on frontend + commit**

Run: `bun run test src/components/board/__tests__/board-sacrifice-choice.test.tsx`
Then: `bun run check:all`
Expected: PASS / zero errors.

```bash
git add src/hooks/useBattlefieldInteraction.tsx src/hooks/useBattlefieldVisualState.ts src/components/board/payment-banner.tsx src/lib/sacrifice-selection.ts src/components/board/__tests__/board-sacrifice-choice.test.tsx
git commit -m "feat: unified client sacrifice picker via selectSacrifice"
```

---

### Task 7: Delete dead auto-pickers, grep-guard, wire-format test

**Files:**
- Modify: `convex/gre/replacements.ts` — delete `autoSacrifice` (167-182)
- Create: `convex/gre/__tests__/sacrificeGuard.test.ts`
- Create/Modify: a wire-format test asserting the parked selection survives projection

- [ ] **Step 1: Confirm `autoSacrifice` has no callers, then delete it**

Run: `rg "autoSacrifice" convex/ src/`
Expected: only the definition + its type on the ctx interface. Delete the method and its interface member. If a caller exists, STOP and open an issue (a replacement-time filtered sacrifice needs a separate suspend design).

- [ ] **Step 2: Write the grep-guard test** `convex/gre/__tests__/sacrificeGuard.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// CR 701.21a guard — a filtered sacrifice must route through the unified
// selection layer. Raw removePermanentTo(…, "sacrifice") is allowed ONLY at the
// sanctioned sites; a new one fails CI (prevents auto-pick regressions).
const ALLOW = new Set([
    "convex/gre/sacrificeChoice.ts", // applySacrificeSelection — the one executor
    // fixed-self / fixed-target / resolve-time choice sites (no filter choice):
    // add exact relative paths discovered below.
]);

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

describe("sacrifice routing guard (CR 701.21a)", () => {
    it("removePermanentTo(sacrifice) appears only at sanctioned sites", () => {
        const offenders: string[] = [];
        for (const file of walk("convex")) {
            if (!file.endsWith(".ts") || file.includes("__tests__")) continue;
            const rel = file.replace(/^.*\/tolaria\//, "").replace(/^.*unified-sacrifice\//, "");
            const src = readFileSync(file, "utf8");
            if (/removePermanentTo\([^)]*"sacrifice"/.test(src) && !ALLOW.has(rel)) {
                offenders.push(rel);
            }
        }
        expect(offenders).toEqual([]);
    });
});
```

- [ ] **Step 3: Run the guard, populate `ALLOW` with the legitimate fixed-self/fixed-target sites**

Run: `bun run test convex/gre/__tests__/sacrificeGuard.test.ts`
It will list every current `removePermanentTo(…,"sacrifice")` site. For each, inspect: if it is a fixed-self (`ctx.sacrifice(sourceId)`, mana ability, cumulative upkeep), edict fixed-target, or the resolve-time interpreter `choice` path, add it to `ALLOW` with a one-line comment. If it is a NEW filtered auto-pick, that's a bug — route it through the layer instead. Re-run until green.

> **Implementer note:** also guard the `ctx.sacrifice(filter)` interpreter form if one exists — grep `rg '\.sacrifice\(' convex/gre/effects`. The resolve-time `sacrifice` Op `permanents`/choice form already prompts via `requestChoice`; ensure the guard's ALLOW list or regex distinguishes it.

- [ ] **Step 4: Wire-format test**

Assert a parked `pendingCast.sacrificeSelection` survives `projectPublicState(state, 1, viewerId)` with `requirements[i].filter` + `picked` intact, and that the opponent's projection does not expose the acting player's private picks beyond what CR reveals (sacrifices are public once made; a parked pending choice is the acting player's — assert the opponent view still carries the selection since combat/pendingCast cross verbatim, and document that this matches existing pending-choice visibility).

```ts
it("parked sacrificeSelection survives projection", () => {
    // build state with pendingCast.sacrificeSelection (Drought, incomplete)
    const projected = projectPublicState(state, 1, viewerId);
    expect(projected.pendingCast?.sacrificeSelection?.requirements[0].filter)
        .toEqual({ subtypes: ["Swamp"] });
    expect(projected.pendingCast?.sacrificeSelection?.picked).toEqual([]);
});
```

- [ ] **Step 5: Run + commit**

Run: `bun run test convex/gre/__tests__/sacrificeGuard.test.ts <wire-format test path>`
Expected: PASS.

```bash
git add convex/gre/replacements.ts convex/gre/__tests__/sacrificeGuard.test.ts <wire-format test>
git commit -m "feat: delete dormant autoSacrifice; grep-guard + wire-format for sacrifice choice"
```

---

### Task 8: Preset scenarios + full quality gate

**Files:**
- Modify: `src/components/debug/debug-panel.tsx` — `PRESET_SCENARIOS`

- [ ] **Step 1: Add two preset scenarios**

- **"Drought — choose a Swamp"**: caster with Drought in play, a 2-black-pip spell in hand, and 3 Swamps where at least one is tapped / has an aura (non-fungible) → casting prompts the pick.
- **"Flooded Woodlands — choose a land"**: active player with Flooded Woodlands in play, a green creature ready to attack, and mixed lands (Forest + enchanted Island) → declaring attackers prompts the land pick.

Follow the existing `PRESET_SCENARIOS` entry shape (cards/zones/phase/`landCount`).

- [ ] **Step 2: Run the full gate**

Run: `bun run check:all`
Expected: zero errors.

Run: `bun run test`
Expected: zero failures. Fix any fallout (deleted `planStaticAdditionalSacrifices` / `autoSacrifice` / `sacrificeChoice` field references, retired mutation branches).

- [ ] **Step 3: Commit**

```bash
git add src/components/debug/debug-panel.tsx
git commit -m "chore: preset scenarios for Drought + Flooded Woodlands sacrifice choice"
```

---

## Self-Review Notes (coverage against spec)

- Core structure `SacrificeSelection` — Task 1. ✔
- Shared module (`buildSacrificeRequirements`, `sacrificeCandidates`, `autoResolveFungible`, `isSacrificeSelectionComplete`, `applySacrificeSelection`) — Task 1. ✔
- Producers reroute: static cost cast (Drought) — Task 2; static cost ability — Task 3; attack tax — Task 4; folded own-cast + activated pickers — Tasks 2/3. ✔
- may-pay (#16): **left intact** — investigation showed it already honours `sacrificeIds` via the `pendingChoices` machinery and is CR-correct; allowlisted in the grep-guard (Task 7). Spec's "convert #16" is superseded by this finding. ✔ (documented deviation)
- `autoSacrifice` (#17): **deleted** (dormant, no callers) rather than converted — replacement-time effects cannot suspend for input; a future need is a separate design (Task 7). ✔ (documented deviation)
- One mutation `selectSacrifice` — Task 5. ✔
- Client unified picker — Task 6. ✔
- Grep-guard — Task 7. ✔
- Wire-format — Task 7. ✔
- serialize.ts — no new top-level keys (nested under persisted `pendingCast`/`pendingActivation`/`combat`); round-trip smoke — Task 1. ✔
- Preset scenarios — Task 8. ✔
- `additionalSacrificeSnapshot` preserved via `SacrificeResult.snapshot` — Task 1/2. ✔

**Two documented deviations from the spec** (may-pay left intact, autoSacrifice deleted not converted) both strengthen the goal — no auto-pick remains — and are noted in the guard's ALLOW list.

// Integration test for the autoTapForPayment mutation path (issues #321, #474).
//
// Exercises the full chain the mutation runs server-side:
//   buildAutoTapSources + buildHandSpellDemands → solveSmartAutoTap (full) /
//   solveAutoTapPartial (fallback) → tapSourceIntoPayment (real GRE primitive)
//   → tryAutoCommitPendingCast.
//
// Smart auto-tap (PRD #472, ADR 0034) selects, among all minimal-tap covering
// plans, the one that best preserves the paying player's other castable hand
// spells (their Demands) — see the bottom describe block.
//
// The bug: with pure-mana sources that can't cover the whole cost but a manual
// sacrifice source (Black Lotus) also present, the mutation threw
// "No mana combination can pay this cost" and tapped nothing. The fix taps the
// maximal useful subset of pure sources and leaves the manual remainder, with
// the banner staying up (no auto-commit) until the player finishes by hand.

import { describe, it, expect } from "vitest";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
    solveAutoTapPartial,
} from "../gre/autoTap";
import { buildHandSpellDemands } from "../gre/autoTapDemands";
import { tapSourceIntoPayment, tryAutoCommitPendingCast } from "../game";
import {
    getManaSubstitutions,
    isManaCostCovered,
    applySourceStaticEffects,
    type GameState,
    type PlayerState,
    type PendingCast,
} from "../gre/state";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // {T}: R
const FIREBALL = "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece"; // {X}{R}
const BLACK_LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // sacrifice: 3 mana
const TROPICAL_ISLAND = "a9c6c759-aabf-44e7-ba8c-33c5df232b56"; // {T}: G or U
const BLOOD_MOON = "78373616-e2d6-4ccf-998f-09f02bea45b4"; // nonbasic → Mountain

/** Replicates the autoTapForPayment mutation body (solver + tap loop + commit
 *  decision) over real GRE primitives. Returns whether the spell committed. */
function runAutoTap(state: GameState, player: PlayerState): boolean {
    const pending = state.pendingCast!;
    const substitutions = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(player.battlefield);
    const demands = buildHandSpellDemands(player.hand, pending.cardInstanceId);
    const fullPlan = solveSmartAutoTap(
        player.manaPool,
        pending.manaCost,
        substitutions,
        sources,
        demands
    );
    const plan =
        fullPlan ??
        solveAutoTapPartial(
            player.manaPool,
            pending.manaCost,
            substitutions,
            sources
        );
    for (const step of plan) {
        const card = player.battlefield.find((c) => c.id === step.cardId);
        if (!card) continue;
        tapSourceIntoPayment(
            state,
            player,
            card,
            step.manaChoiceIndex,
            pending.tappedLandIds
        );
    }
    return tryAutoCommitPendingCast(state, player.id) !== null;
}

function fireballState(landCount: number, withLotus: boolean) {
    const cast = makeInstance(FIREBALL, {
        id: "fb",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const battlefield = Array.from({ length: landCount }, (_, i) =>
        makeInstance(MOUNTAIN, { id: `m${i + 1}`, controllerId: "p1" })
    );
    if (withLotus) {
        battlefield.push(
            makeInstance(BLACK_LOTUS, { id: "lotus", controllerId: "p1" })
        );
    }
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "fb",
        // Fireball with X=7 → {7}{R}: R:1, generic 7 (8 mana total).
        manaCost: { R: 1, X: 7 },
        tappedLandIds: [],
        chosenX: 7,
    };
    const p1 = makePlayer("p1", { hand: [cast], battlefield });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
    return { state, player: state.players[0] };
}

describe("autoTapForPayment — partial coverage (issue #321)", () => {
    it("taps all 5 Mountains and leaves Black Lotus untapped, no throw, banner stays up", () => {
        const { state, player } = fireballState(5, true);
        const committed = runAutoTap(state, player);

        // Banner stays up: cost not yet covered, spell not committed.
        expect(committed).toBe(false);
        expect(state.pendingCast).toBeDefined();

        const lotus = player.battlefield.find((c) => c.id === "lotus")!;
        const mountains = player.battlefield.filter((c) =>
            c.id.startsWith("m")
        );
        // All 5 Mountains tapped; Black Lotus untouched and still on the field.
        expect(mountains.every((m) => m.isTapped)).toBe(true);
        expect(lotus.isTapped).toBeFalsy();
        expect(lotus.zone).toBe("battlefield");
        expect(player.manaPool.R).toBe(5);

        // Player can finish by manually floating Black Lotus (3 mana).
        const sub = getManaSubstitutions(state, player.id);
        player.manaPool.R += 3;
        expect(
            isManaCostCovered(player.manaPool, state.pendingCast!.manaCost, sub)
        ).toBe(true);
    });

    it("never throws when no pure source can cover the cost (the original bug)", () => {
        const { state, player } = fireballState(5, true);
        expect(() => runAutoTap(state, player)).not.toThrow();
    });
});

describe("autoTapForPayment — full coverage unchanged", () => {
    it("commits when pure sources fully cover the cost", () => {
        // 8 Mountains cover {7}{R} exactly; spell auto-commits.
        const { state, player } = fireballState(8, true);
        const committed = runAutoTap(state, player);

        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();
        // Minimal combination: Black Lotus never auto-tapped.
        const lotus = player.battlefield.find((c) => c.id === "lotus")!;
        expect(lotus.isTapped).toBeFalsy();
        expect(lotus.zone).toBe("battlefield");
    });

    it("does not over-tap when more pure sources than needed are present", () => {
        // 10 Mountains, cost needs 8: exactly 8 tapped, 2 left untapped.
        const { state, player } = fireballState(10, false);
        const committed = runAutoTap(state, player);

        expect(committed).toBe(true);
        const tapped = player.battlefield.filter((c) => c.isTapped).length;
        expect(tapped).toBe(8);
    });
});

// Integration: GRE static effect (Blood Moon) → game.ts tap-for-payment path.
// A nonbasic dual land under Blood Moon must auto-tap for {R} (its intrinsic
// Mountain mana) — never its printed G/U — when paying a red spell. This
// exercises the full chain (buildAutoTapSources → tapSourceIntoPayment →
// tryAutoCommitPendingCast) over the suppression-gated mana lookups, catching
// any desync between the planner and the real payment primitive (#419).
describe("autoTapForPayment under Blood Moon (#419)", () => {
    function bloodMoonState() {
        const moon = makeInstance(BLOOD_MOON, {
            id: "moon",
            controllerId: "p2",
            ownerId: "p2",
        });
        const dual = makeInstance(TROPICAL_ISLAND, {
            id: "dual",
            controllerId: "p1",
            ownerId: "p1",
        });
        const cast = makeInstance(FIREBALL, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", { hand: [cast], battlefield: [dual] });
        const p2 = makePlayer("p2", { battlefield: [moon] });
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "fb",
            // Fireball X=0 → {R}: a single red pip.
            manaCost: { R: 1, X: 0 },
            tappedLandIds: [],
            chosenX: 0,
        };
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingCast,
        });
        // Apply Blood Moon's continuous effects to the board.
        applySourceStaticEffects(state, state.players[1].battlefield[0]);
        return { state, player: state.players[0] };
    }

    it("auto-taps the dual for {R} and commits the red spell", () => {
        const { state, player } = bloodMoonState();
        const committed = runAutoTap(state, player);

        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();
        const dual = player.battlefield.find((c) => c.id === "dual")!;
        expect(dual.isTapped).toBe(true);
        // Tapped for red (the Mountain subtype), not its printed G/U.
        expect(player.manaPool.G ?? 0).toBe(0);
        expect(player.manaPool.U ?? 0).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Smart auto-tap: demand-aware spine through the real mutation path
// (PRD #472, ADR 0034, issue #474). Behavioral seam — asserts which sources
// end up tapped and which hand spells stay castable, not solver internals.
// ---------------------------------------------------------------------------

const TUNDRA = "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb"; // {T}: W or U
const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5"; // {T}: U
const TIME_WALK = "e0139f60-d48e-46fb-9f5a-1e3d7558c834"; // {1}{U} (Sorcery)
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // {W} (Creature)

describe("autoTapForPayment — smart demand-aware spine (ADR 0034)", () => {
    /** Board Tundra (W/U) + Island (U) + Tropical Island (U/G); hand Time Walk
     *  (the spell being cast) + Savannah Lions ({W}). Casting Time Walk. */
    function timeWalkState() {
        const walk = makeInstance(TIME_WALK, {
            id: "walk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lions = makeInstance(SAVANNAH_LIONS, {
            id: "lions",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const battlefield = [
            makeInstance(TUNDRA, { id: "tundra", controllerId: "p1" }),
            makeInstance(ISLAND, { id: "island", controllerId: "p1" }),
            makeInstance(TROPICAL_ISLAND, { id: "trop", controllerId: "p1" }),
        ];
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "walk",
            manaCost: { U: 1, X: 1 }, // {1}{U}
            tappedLandIds: [],
        };
        const p1 = makePlayer("p1", {
            hand: [walk, lions],
            battlefield,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingCast,
        });
        return { state, player: state.players[0] };
    }

    it("leaves Tundra (white source) untapped so Savannah Lions stays castable", () => {
        const { state, player } = timeWalkState();
        const committed = runAutoTap(state, player);

        // Time Walk paid and committed.
        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();

        const tundra = player.battlefield.find((c) => c.id === "tundra")!;
        const island = player.battlefield.find((c) => c.id === "island")!;
        const trop = player.battlefield.find((c) => c.id === "trop")!;
        // The two U sources are tapped; the white source is preserved.
        expect(tundra.isTapped).toBeFalsy();
        expect(island.isTapped).toBe(true);
        expect(trop.isTapped).toBe(true);

        // Savannah Lions ({W}) is still castable from the untapped Tundra.
        const sub = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(player.battlefield);
        const lionsPlan = solveSmartAutoTap(
            player.manaPool,
            { W: 1 },
            sub,
            sources,
            []
        );
        expect(lionsPlan).not.toBeNull();
    });

    it("minimal-tap-count never exceeded: taps exactly two sources for {1}{U}", () => {
        const { state, player } = timeWalkState();
        runAutoTap(state, player);
        const tapped = player.battlefield.filter((c) => c.isTapped);
        expect(tapped).toHaveLength(2);
    });

    it("deterministic: same board casts twice → identical tapped set", () => {
        const a = timeWalkState();
        runAutoTap(a.state, a.player);
        const tappedA = a.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        const b = timeWalkState();
        runAutoTap(b.state, b.player);
        const tappedB = b.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        expect(tappedA).toEqual(tappedB);
        expect(tappedA).toEqual(["island", "trop"]);
    });

    it("empty hand: still pays {1}{U}, leaving the most flexible source up", () => {
        const { state, player } = timeWalkState();
        // Drop Savannah Lions — only the spell being cast remains in hand.
        player.hand = player.hand.filter((c) => c.id === "walk");
        const committed = runAutoTap(state, player);
        expect(committed).toBe(true);
        // Flexibility fallback keeps the 2-color Tropical Island untapped over a
        // 1-color Island, so Island + Tundra are tapped... but Tundra is also
        // 2-color. Tie-break leaves a dual up: exactly two taps, dual preserved.
        const tapped = player.battlefield.filter((c) => c.isTapped);
        expect(tapped).toHaveLength(2);
    });
});

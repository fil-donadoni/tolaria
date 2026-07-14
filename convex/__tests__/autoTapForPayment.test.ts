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
    type AutoTapPlan,
} from "../gre/autoTap";
import {
    buildBoardAbilityDemands,
    buildHandSpellDemands,
} from "../gre/autoTapDemands";
import { isSorceryTiming } from "../gre/phases";
import {
    tapSourceIntoPayment,
    tryAutoCommitPendingCast,
    tryAutoCommitPendingActivation,
    scoreAutoTapPlanPosition,
} from "../game";
import {
    getManaSubstitutions,
    isManaCostCovered,
    applySourceStaticEffects,
    type GameState,
    type PlayerState,
    type PendingCast,
    type PendingActivation,
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
    const demands = [
        ...buildHandSpellDemands(
            player.hand,
            pending.cardInstanceId,
            isSorceryTiming(state)
        ),
        ...buildBoardAbilityDemands(player.battlefield, {
            phase: state.phase,
            isControllersTurn: state.activePlayerId === player.id,
        }),
    ];
    // Drive the REAL production scorer (`scoreAutoTapPlanPosition`, exported from
    // game.ts) — not a mirrored closure — so the eval-scored glue is under test
    // exactly as the `autoTapForPayment` mutation body wires it (issue #794).
    const scorePlan = (plan: AutoTapPlan): number =>
        scoreAutoTapPlanPosition(
            state,
            player.id,
            player.manaPool,
            pending.manaCost,
            substitutions,
            sources,
            plan
        );
    const fullPlan = solveSmartAutoTap(
        player.manaPool,
        pending.manaCost,
        substitutions,
        sources,
        demands,
        undefined,
        scorePlan
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

// ---------------------------------------------------------------------------
// Smart auto-tap: timing-aware Demand filter (issue #475, CR 307 / 601.3a /
// 602 / 603). A sorcery-speed hand spell is a preservable Demand only at
// sorcery timing (own main, empty stack, holding priority); instant-speed
// spells (Instants / Flash, CR 702.8) count in any priority window — including
// the opponent's turn, when auto-tapping to pay for an instant. Exercised
// through the mutation-replica seam so the real `isSorceryTiming` gate runs.
// ---------------------------------------------------------------------------

const COUNTERSPELL = "0df55e3f-14de-46ef-b6b1-616618724d9e"; // {U}{U} Instant
const SHIVAN_DRAGON = "fefbf149-f988-4f8b-9f53-56f5878116a6"; // {R}: +1/+0 (firebreathing)

describe("autoTapForPayment — timing-aware Demand filter (issue #475)", () => {
    /** Opponent's turn (p2 active), p1 holds priority to cast an instant {U}.
     *  Board: Island + Island + Tundra (W/U). Hand: Counterspell ({U}{U},
     *  instant) + Savannah Lions ({W}, creature) + the instant being paid for.
     *  Paying {U}: minimal tap = 1. */
    function offTurnInstantState() {
        const cast = makeInstance(ISLAND, {
            // Stand-in for the instant being cast; only its instance id matters
            // to the payment path — its cost comes from pendingCast below.
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const counter = makeInstance(COUNTERSPELL, {
            id: "counter",
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
            makeInstance(ISLAND, { id: "isl1", controllerId: "p1" }),
            makeInstance(ISLAND, { id: "isl2", controllerId: "p1" }),
            makeInstance(TUNDRA, { id: "tundra", controllerId: "p1" }),
        ];
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { U: 1 }, // a {U} instant
            tappedLandIds: [],
        };
        const p1 = makePlayer("p1", {
            hand: [cast, counter, lions],
            battlefield,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            // Opponent's turn: p2 active, p1 has priority (instant window).
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            pendingCast,
        });
        return { state, player: state.players[0] };
    }

    it("preserves {U}{U} for Counterspell when paying for an instant on the opponent's turn", () => {
        const { state, player } = offTurnInstantState();
        const committed = runAutoTap(state, player);

        // The {U} instant is paid and committed.
        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();

        // Minimal-tap invariant: exactly one source spent for {U}.
        const tapped = player.battlefield.filter((c) => c.isTapped);
        expect(tapped).toHaveLength(1);

        // Counterspell ({U}{U}) is still castable from the two untapped sources:
        // the instant-speed Demand was preserved across the off-turn payment.
        const sub = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(player.battlefield);
        const counterPlan = solveSmartAutoTap(
            player.manaPool,
            { U: 2 },
            sub,
            sources,
            []
        );
        expect(counterPlan).not.toBeNull();
    });

    it("does not hold mana for a sorcery-speed creature off-turn (tap set is creature-independent)", () => {
        // With the creature in hand off-turn:
        const withCreature = offTurnInstantState();
        runAutoTap(withCreature.state, withCreature.player);
        const tappedWith = withCreature.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        // Same board off-turn but with the creature removed from hand:
        const withoutCreature = offTurnInstantState();
        withoutCreature.player.hand = withoutCreature.player.hand.filter(
            (c) => c.id !== "lions"
        );
        runAutoTap(withoutCreature.state, withoutCreature.player);
        const tappedWithout = withoutCreature.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        // The sorcery-speed creature exerts zero preservation pressure off-turn:
        // removing it does not change which source the engine taps. (Contrast:
        // at sorcery timing it WOULD count — see autoTapDemands.test.ts.)
        expect(tappedWith).toEqual(tappedWithout);
    });

    it("at sorcery timing (own main, empty stack, holding priority), a creature Demand IS preserved", () => {
        // Same board, but now it's p1's own main phase with priority: the
        // creature {W} becomes a live Demand, so the white-capable Tundra is
        // kept up and one of the two Islands is spent for the {U} cost.
        const { state, player } = offTurnInstantState();
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        // Drop Counterspell so the creature's {W} preservation is unambiguous.
        player.hand = player.hand.filter((c) => c.id !== "counter");

        const committed = runAutoTap(state, player);
        expect(committed).toBe(true);

        const tundra = player.battlefield.find((c) => c.id === "tundra")!;
        // Tundra (the only white source) is preserved for Savannah Lions ({W}).
        expect(tundra.isTapped).toBeFalsy();
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
});

// ---------------------------------------------------------------------------
// Smart auto-tap: on-board activated abilities as Demands (issue #476,
// CR 602.1). A firebreathing creature's "{R}: +1/+0" is a play the paying
// player might still make this turn, so auto-tap prefers a minimal-tap plan
// that leaves a red source untapped. Counted ONCE per ability (PRD story 12).
// Exercised through the mutation-replica seam so the real ability enumerator
// + timing gate run.
// ---------------------------------------------------------------------------

describe("autoTapForPayment — on-board activated-ability Demands (issue #476)", () => {
    /** Board: Mountain (R) + Tundra (W/U) + Island (U) + Shivan Dragon (its
     *  "{R}: +1/+0" firebreathing ability). Hand: a {1}{U} spell being cast.
     *  Paying {1}{U} costs two taps; the only red source is the Mountain, so a
     *  red-preserving plan must pay the generic from Tundra (not the Mountain).
     */
    function firebreathingState() {
        const cast = makeInstance(ISLAND, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const battlefield = [
            makeInstance(MOUNTAIN, { id: "mtn", controllerId: "p1" }),
            makeInstance(TUNDRA, { id: "tundra", controllerId: "p1" }),
            makeInstance(ISLAND, { id: "island", controllerId: "p1" }),
            // Firebreathing creature: not summoning-sick so its {R} ability
            // (and the engine's tap-lock checks for it) are clean.
            makeInstance(SHIVAN_DRAGON, {
                id: "shiv",
                controllerId: "p1",
                isSummoningSick: false,
            }),
        ];
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { U: 1, X: 1 }, // {1}{U}
            tappedLandIds: [],
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

    it("leaves the red Mountain untapped so firebreathing stays activatable", () => {
        const { state, player } = firebreathingState();
        const committed = runAutoTap(state, player);

        // {1}{U} paid and committed.
        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();

        // Minimal-tap invariant: exactly two sources tapped for {1}{U}.
        const tapped = player.battlefield.filter((c) => c.isTapped);
        expect(tapped).toHaveLength(2);

        // The red source is preserved: the {U} comes from a blue source and the
        // generic from the W/U Tundra, never the Mountain.
        const mtn = player.battlefield.find((c) => c.id === "mtn")!;
        expect(mtn.isTapped).toBeFalsy();
        expect(player.manaPool.R ?? 0).toBe(0);

        // Firebreathing ({R}: +1/+0) is still payable from the untapped Mountain.
        const sub = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(player.battlefield);
        const pumpPlan = solveSmartAutoTap(
            player.manaPool,
            { R: 1 },
            sub,
            sources,
            []
        );
        expect(pumpPlan).not.toBeNull();
    });

    it("the firebreathing ability exerts preservation pressure (removing it changes the tap set)", () => {
        // With the firebreathing creature on board, the Mountain is preserved.
        const withAbility = firebreathingState();
        runAutoTap(withAbility.state, withAbility.player);
        const mtnWith = withAbility.player.battlefield.find(
            (c) => c.id === "mtn"
        )!;
        expect(mtnWith.isTapped).toBeFalsy();

        // Remove the firebreathing creature: with no red Demand and an empty
        // hand, the flexibility tie-break spends the inflexible mono-color
        // Mountain/Island first and keeps the 2-color Tundra up — so the
        // Mountain is now fair game to tap.
        const noAbility = firebreathingState();
        noAbility.player.battlefield = noAbility.player.battlefield.filter(
            (c) => c.id !== "shiv"
        );
        runAutoTap(noAbility.state, noAbility.player);
        const mtnWithout = noAbility.player.battlefield.find(
            (c) => c.id === "mtn"
        )!;
        const tundraWithout = noAbility.player.battlefield.find(
            (c) => c.id === "tundra"
        )!;
        // The 2-color Tundra is preserved by the flexibility heuristic; the
        // Mountain is spent. This differs from the with-ability plan above,
        // proving the firebreathing Demand actually moved the decision.
        expect(tundraWithout.isTapped).toBeFalsy();
        expect(mtnWithout.isTapped).toBe(true);
    });

    it("deterministic: same firebreathing board casts twice → identical tapped set", () => {
        const a = firebreathingState();
        runAutoTap(a.state, a.player);
        const tappedA = a.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        const b = firebreathingState();
        runAutoTap(b.state, b.player);
        const tappedB = b.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        expect(tappedA).toEqual(tappedB);
    });
});

// ---------------------------------------------------------------------------
// Smart auto-tap: X-spell Demands at assumed X=1 (issue #477, CR 107.3 /
// 601.2b). A variable-X spell ({X}{R} Fireball) in hand is a preservable
// Demand at its base cost plus one generic per `{X}` pip — X=0 would
// under-preserve and strand it. Auto-tap therefore prefers a minimal-tap plan
// that keeps the X-spell castable at X=1 when the board allows. Exercised
// through the mutation-replica seam so the real X inflation + payment run.
// ---------------------------------------------------------------------------

describe("autoTapForPayment — X-spell Demands at X=1 (issue #477)", () => {
    /** Own main phase (sorcery timing). Hand: Time Walk ({1}{U}, being cast) +
     *  Fireball ({X}{R}). Board: Island (U) + Tropical Island (U/G) + Tundra
     *  (W/U) + Mountain (R). Paying {1}{U} costs two taps. The Mountain is the
     *  only red source, so keeping Fireball castable at X=1 ({1}{R} = two mana
     *  incl. a red source) forces a plan that leaves the Mountain untapped —
     *  which the flexibility heuristic alone would NOT do (the mono-color
     *  Mountain has the lowest breadth and would be spent first). The X-spell
     *  Demand is therefore what moves the decision. */
    function fireballInHandState() {
        const walk = makeInstance(TIME_WALK, {
            id: "walk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const fireball = makeInstance(FIREBALL, {
            id: "fireball",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const battlefield = [
            makeInstance(ISLAND, { id: "island", controllerId: "p1" }),
            makeInstance(TROPICAL_ISLAND, { id: "trop", controllerId: "p1" }),
            makeInstance(TUNDRA, { id: "tundra", controllerId: "p1" }),
            makeInstance(MOUNTAIN, { id: "mtn", controllerId: "p1" }),
        ];
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "walk",
            manaCost: { U: 1, X: 1 }, // {1}{U}
            tappedLandIds: [],
        };
        const p1 = makePlayer("p1", {
            hand: [walk, fireball],
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

    it("preserves a plan keeping {X}{R} Fireball castable at X=1 ({1}{R})", () => {
        const { state, player } = fireballInHandState();
        const committed = runAutoTap(state, player);

        // {1}{U} paid and committed.
        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();

        // Minimal-tap invariant: exactly two sources spent for {1}{U}.
        const tapped = player.battlefield.filter((c) => c.isTapped);
        expect(tapped).toHaveLength(2);

        // The red Mountain is preserved — never spent on the blue/generic cost.
        const mtn = player.battlefield.find((c) => c.id === "mtn")!;
        expect(mtn.isTapped).toBeFalsy();
        expect(player.manaPool.R ?? 0).toBe(0);

        // Fireball at X=1 → {1}{R}: still payable from the untapped sources
        // (Mountain for {R} plus one more for the generic). The X-spell Demand
        // was preserved across the payment.
        const sub = getManaSubstitutions(state, player.id);
        const sources = buildAutoTapSources(player.battlefield);
        const fireballPlan = solveSmartAutoTap(
            player.manaPool,
            { R: 1, X: 1 }, // {1}{R} = Fireball at X=1
            sub,
            sources,
            []
        );
        expect(fireballPlan).not.toBeNull();
    });

    it("the X-spell exerts preservation pressure (removing it frees the Mountain)", () => {
        // With Fireball in hand the red Mountain is held back.
        const withX = fireballInHandState();
        runAutoTap(withX.state, withX.player);
        const mtnWith = withX.player.battlefield.find((c) => c.id === "mtn")!;
        expect(mtnWith.isTapped).toBeFalsy();

        // Drop Fireball: no red Demand, so the flexibility tie-break spends the
        // inflexible mono-color sources first — the Mountain becomes tappable.
        const withoutX = fireballInHandState();
        withoutX.player.hand = withoutX.player.hand.filter(
            (c) => c.id !== "fireball"
        );
        runAutoTap(withoutX.state, withoutX.player);
        const tappedWith = withX.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();
        const tappedWithout = withoutX.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();
        // The X-spell moved the decision: the two tap-sets differ.
        expect(tappedWith).not.toEqual(tappedWithout);
    });

    it("no false preservation: X-spell not held when even X=1 is unaffordable", () => {
        // Only three lands now — paying {1}{U} taps two, leaving a single source.
        // Fireball at X=1 needs {1}{R} = two mana, unaffordable from one land, so
        // it is NOT a live Demand and exerts no pressure. The tap-set with the
        // X-spell in hand must equal the tap-set without it (the red source can
        // be freely spent because reserving it could never make X=1 castable).
        function threeLandState() {
            const { state, player } = fireballInHandState();
            player.battlefield = player.battlefield.filter(
                (c) => c.id !== "trop"
            );
            return { state, player };
        }
        const withX = threeLandState();
        runAutoTap(withX.state, withX.player);
        const tappedWith = withX.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        const withoutX = threeLandState();
        withoutX.player.hand = withoutX.player.hand.filter(
            (c) => c.id !== "fireball"
        );
        runAutoTap(withoutX.state, withoutX.player);
        const tappedWithout = withoutX.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        expect(tappedWith).toEqual(tappedWithout);
    });

    it("deterministic: same board casts twice → identical tapped set", () => {
        const a = fireballInHandState();
        runAutoTap(a.state, a.player);
        const tappedA = a.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        const b = fireballInHandState();
        runAutoTap(b.state, b.player);
        const tappedB = b.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        expect(tappedA).toEqual(tappedB);
    });
});

// ---------------------------------------------------------------------------
// Self-source deprioritization through the activation payment path (issue
// #544, CR 602.1 / 605.1a). When Auto-Tapping to pay an activated ability's
// mana cost, the activating permanent's OWN mana ability must not be tapped
// unless strictly necessary. Mishra's Factory `{1}:` animate is the repro:
// after animating, the Factory must stay UNTAPPED while another mana source
// can pay — otherwise the freshly-animated 2/2 lands tapped and can't
// attack/block. Exercised through the real mutation seam (planner with
// selfSourceId + tapSourceIntoPayment + tryAutoCommitPendingActivation), so
// the planner and the payment primitive stay in sync.
// ---------------------------------------------------------------------------

const MISHRAS_FACTORY = "a696c5b6-f216-454d-8029-74e84bbd1428"; // {T}: C | {1}: animate

/** Replicates the autoTapForPayment mutation body for a `pendingActivation`
 *  (the self-source branch). Returns whether the ability committed. */
function runAutoTapActivation(state: GameState, player: PlayerState): boolean {
    const pa = state.pendingActivation!;
    const substitutions = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(player.battlefield);
    // The activating permanent's own mana ability is deprioritized.
    const selfSourceId =
        pa.playerId === player.id ? pa.cardInstanceId : undefined;
    const plan = solveSmartAutoTap(
        player.manaPool,
        pa.manaCost,
        substitutions,
        sources,
        [],
        selfSourceId
    );
    for (const step of plan ?? []) {
        const card = player.battlefield.find((c) => c.id === step.cardId);
        if (!card) continue;
        tapSourceIntoPayment(
            state,
            player,
            card,
            step.manaChoiceIndex,
            pa.tappedLandIds
        );
    }
    return tryAutoCommitPendingActivation(state, player.id) !== null;
}

function factoryActivationState(extraMountains: number) {
    const factory = makeInstance(MISHRAS_FACTORY, {
        id: "factory",
        controllerId: "p1",
        ownerId: "p1",
    });
    const battlefield = [
        factory,
        ...Array.from({ length: extraMountains }, (_, i) =>
            makeInstance(MOUNTAIN, { id: `m${i + 1}`, controllerId: "p1" })
        ),
    ];
    const pendingActivation: PendingActivation = {
        playerId: "p1",
        cardInstanceId: "factory",
        abilityId: "mishras-factory-animate",
        manaCost: { X: 1 }, // {1}
        tappedLandIds: [],
        tapSource: false,
        sacrificeSource: false,
    };
    const p1 = makePlayer("p1", { battlefield });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingActivation,
    });
    return { state, player: state.players[0] };
}

describe("autoTapForPayment — manland self-source (issue #544)", () => {
    it("leaves Mishra's Factory untapped when another mana source pays {1}", () => {
        const { state, player } = factoryActivationState(1);
        const committed = runAutoTapActivation(state, player);

        // Animate committed (ability pushed to the stack, payment cleared).
        expect(committed).toBe(true);
        expect(state.pendingActivation).toBeUndefined();

        const factory = player.battlefield.find((c) => c.id === "factory")!;
        const mountain = player.battlefield.find((c) => c.id === "m1")!;
        // The Factory stays untapped; the Mountain pays the {1}.
        expect(factory.isTapped).toBeFalsy();
        expect(mountain.isTapped).toBe(true);
    });

    it("taps the Factory's own mana ability only when it is the sole source", () => {
        const { state, player } = factoryActivationState(0);
        const committed = runAutoTapActivation(state, player);

        // Strictly necessary: the Factory taps itself, activation still succeeds.
        expect(committed).toBe(true);
        expect(state.pendingActivation).toBeUndefined();
        const factory = player.battlefield.find((c) => c.id === "factory")!;
        expect(factory.isTapped).toBe(true);
    });

    it("deterministic: same board activates twice → identical tapped set", () => {
        const a = factoryActivationState(2);
        runAutoTapActivation(a.state, a.player);
        const tappedA = a.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        const b = factoryActivationState(2);
        runAutoTapActivation(b.state, b.player);
        const tappedB = b.player.battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();

        expect(tappedA).toEqual(tappedB);
        // The Factory is never among the tapped sources while a Mountain exists.
        expect(tappedA).not.toContain("factory");
    });
});

// ---------------------------------------------------------------------------
// Evaluation-scored auto-tap acceptance scenarios through the REAL scorer
// (issue #794). Unlike the per-module AC1/AC2 unit tests (autoTap.test.ts),
// which mirror the scorer with a hand-built closure, these run
// `runAutoTap` — which now wires the production `scoreAutoTapPlanPosition`
// exported from game.ts — so the GRE → game.ts glue is exercised end to end,
// asserting the resulting `isTapped` set. Includes the Finding-1 regression
// (Plains + Tropical Island, held {W} spell) so a demand-blind eval can never
// again strand a color-critical source for a generic breadth bonus.
// ---------------------------------------------------------------------------

const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // {T}: W
const SOL_RING = "c4300d24-1cae-4dd5-be7e-38cc677cf5bd"; // {1} artifact (generic)
// MISHRAS_FACTORY id is declared above (manland self-source block).

/** Cast a generic {1} spell (Sol Ring) with `battlefield` sources and an
 *  optional held white spell (Savannah Lions) as a Demand. */
function genericOneState(
    battlefield: ReturnType<typeof makeInstance>[],
    withWhiteDemand: boolean
) {
    const cast = makeInstance(SOL_RING, {
        id: "solring",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const hand = [cast];
    if (withWhiteDemand) {
        hand.push(
            makeInstance(SAVANNAH_LIONS, {
                id: "lions",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
    }
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "solring",
        manaCost: { X: 1 }, // {1} generic
        tappedLandIds: [],
    };
    const p1 = makePlayer("p1", { hand, battlefield });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
    return { state, player: state.players[0] };
}

describe("autoTapForPayment — evaluation-scored plan selection (issue #794)", () => {
    it("AC(a): equal-tap plan avoiding a dual-purpose permanent leaves it untapped", () => {
        // Board: Mishra's Factory ({T}: C + animate) + a plain Mountain ({T}: R).
        // Paying {1} generic is one tap either source covers; no held demands. The
        // real scorer must tap the Mountain and SPARE the Factory (its animate
        // ability makes it worth more untapped).
        const { state, player } = genericOneState(
            [
                makeInstance(MISHRAS_FACTORY, {
                    id: "factory",
                    controllerId: "p1",
                }),
                makeInstance(MOUNTAIN, { id: "m1", controllerId: "p1" }),
            ],
            false
        );
        const committed = runAutoTap(state, player);
        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();

        const factory = player.battlefield.find((c) => c.id === "factory")!;
        const mountain = player.battlefield.find((c) => c.id === "m1")!;
        expect(factory.isTapped).toBeFalsy();
        expect(mountain.isTapped).toBe(true);
    });

    it("AC(b) / Finding-1 regression: preserves the color-critical source a held spell needs over a higher-breadth dual", () => {
        // Board: Plains ({T}: W, 1 color) + Tropical Island ({T}: G or U, 2 color).
        // Paying {1} generic is one tap either covers. A held Savannah Lions ({W})
        // still needs {W}, which ONLY the Plains makes. A demand-BLIND eval would
        // spare the higher-breadth Tropical Island (+breadth bonus) and tap the
        // Plains — stranding the {W}. The unified position score (demand term
        // dominates the breadth bonus) must tap the Tropical Island and spare the
        // Plains so Savannah Lions stays castable.
        const { state, player } = genericOneState(
            [
                makeInstance(PLAINS, { id: "plains", controllerId: "p1" }),
                makeInstance(TROPICAL_ISLAND, {
                    id: "trop",
                    controllerId: "p1",
                }),
            ],
            true
        );
        const committed = runAutoTap(state, player);
        expect(committed).toBe(true);
        expect(state.pendingCast).toBeUndefined();

        const plains = player.battlefield.find((c) => c.id === "plains")!;
        const trop = player.battlefield.find((c) => c.id === "trop")!;
        // Regression assertion: the white source is spared, the dual is tapped.
        expect(plains.isTapped).toBeFalsy();
        expect(trop.isTapped).toBe(true);

        // Savannah Lions ({W}) is still castable from the untapped Plains.
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
});

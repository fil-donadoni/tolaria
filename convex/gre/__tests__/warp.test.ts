// Warp capability tests (CR 702.185, issue #1268) — the whole keyword, across
// every surface it crosses. No card in this pool declares Warp (Edge of
// Eternities is not here), so the suite drives the synthetic probe from
// `fixtures/warpProbe.ts`: the `dash.test.ts` / `evoke.test.ts` precedent for
// an engine capability with no consuming card yet.
//
// What is covered, clause by clause:
//   702.185a first ability  — "you may cast this card from your hand by paying
//                             [cost] rather than its mana cost": the cost
//                             resolves through the SAME `getAlternativeCost` /
//                             `affordableAlternativeCosts` authority as
//                             evoke/dash, and the real cast-commit seam tags
//                             the stack item `warped: true` while actually
//                             paying the warp mana.
//   702.185a second ability — the delayed exile at the next end step, only for
//                             a spell whose warp cost was paid, and CR 400.7:
//                             a permanent that LEFT is not chased, and one that
//                             left and RETURNED is a different object.
//   702.185a third clause   — the recast window: not this turn (end step and
//                             cleanup included), yes from the next turn, for as
//                             long as the card remains exiled; an ordinary cast
//                             for the printed cost that never warps again.
//   702.185b / 702.185c     — the two referents, recorded as derivable state.
//   The lower bound itself  — honoured at EVERY `castableFromExileBy` consumer,
//                             including a full path through
//                             `projectPublicState` (the client's Cast button is
//                             gated on the `legalActions` the projection
//                             attaches, so a hand-built view proves nothing).
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import {
    affordableAlternativeCosts,
    getAlternativeCost,
} from "../alternativeCost";
import { exileCastPermission } from "../castCost";
import { getLegalActions } from "../rules";
import { finalizeCleanup, fireDelayedTriggers } from "../phases";
import { tryAutoCommitPendingCast } from "../../game";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { WARP_PROBE_ID, warpProbe } from "./fixtures/warpProbe";

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

/** The probe already on the battlefield as if its warp spell had just resolved:
 *  the marker rode the stack item onto the permanent, and the delayed ability
 *  has been created. Driven through the REAL resolution
 *  (`resolveTopOfStack` → `finalizeSpellResolution`), never hand-staged, so the
 *  scheduling seam is part of what every test below exercises. */
function warpedOnBattlefield(opts?: { warped?: boolean; turn?: number }): {
    state: GameState;
    permanent: CardInstanceState;
} {
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    state.turn = opts?.turn ?? 3;
    const item: StackItem = {
        ...handCard(WARP_PROBE_ID, "probe"),
        zone: "stack",
        castById: "p1",
        ...(opts?.warped === false ? {} : { warped: true }),
    };
    state.stack.push(item);
    resolveTopOfStack(state);
    const permanent = state.players[0].battlefield.find(
        (c) => c.id === "probe"
    )!;
    return { state, permanent };
}

describe("Warp — the alternative cast cost (CR 702.185a, CR 118.9)", () => {
    it("getAlternativeCost resolves def.warp by its own id (reference equality)", () => {
        expect(getAlternativeCost(warpProbe, "warp")).toBe(warpProbe.warp);
    });

    it("offers BOTH the warp cost and the printed cast when both are affordable", () => {
        const probe = handCard(WARP_PROBE_ID, "probe");
        const state = makeState({
            players: [makePlayer("p1", { hand: [probe] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // {4}{R} covers the printed cost, and {R} of it covers the warp cost.
        state.players[0].manaPool.R = 5;
        expect(
            affordableAlternativeCosts(state, state.players[0], probe).some(
                (a) => a.id === "warp"
            )
        ).toBe(true);
        expect(getLegalActions(state, state.players[0], probe)).toContain(
            "cast"
        );
    });

    it("'cast' is legal on the warp cost alone when the printed cost is unaffordable", () => {
        const probe = handCard(WARP_PROBE_ID, "probe");
        const state = makeState({
            players: [makePlayer("p1", { hand: [probe] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // Exactly {R}: nowhere near the printed {4}{R}, exactly the warp cost.
        state.players[0].manaPool.R = 1;
        expect(getLegalActions(state, state.players[0], probe)).toContain(
            "cast"
        );
    });

    it("the cast commit PAYS the warp mana and tags the stack item warped", () => {
        const probe = handCard(WARP_PROBE_ID, "probe");
        const state = makeState({
            players: [makePlayer("p1", { hand: [probe] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].manaPool.R = 1;
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "probe",
            manaCost: { R: 1 },
            tappedLandIds: [],
            warped: true,
        };
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        // Actually paid, never silently zeroed.
        expect(state.players[0].manaPool.R).toBe(0);
        const item = state.stack.find((s) => s.id === "probe");
        expect(item?.warped).toBe(true);
        // CR 702.185c — "a spell was warped this turn" is recorded at the cast.
        expect(state.players[0].spellsWarpedThisTurn).toBe(1);
    });

    it("a printed-cost cast records no warp (CR 702.185c)", () => {
        const probe = handCard(WARP_PROBE_ID, "probe");
        const state = makeState({
            players: [makePlayer("p1", { hand: [probe] }), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].manaPool.R = 5;
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "probe",
            manaCost: { X: 4, R: 1 },
            tappedLandIds: [],
        };
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        expect(
            state.stack.find((s) => s.id === "probe")?.warped
        ).toBeUndefined();
        expect(state.players[0].spellsWarpedThisTurn ?? 0).toBe(0);
    });
});

describe("Warp — the delayed exile (CR 702.185a, CR 603.7a)", () => {
    it("a warped permanent schedules the next-end-step exile as it enters", () => {
        const { state, permanent } = warpedOnBattlefield();
        expect(permanent.warped).toBe(true);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("next-end-step");
        expect(state.delayedTriggers![0].warpCardInstanceId).toBe("probe");
    });

    it("a permanent cast for its PRINTED cost schedules nothing and is never exiled", () => {
        const { state } = warpedOnBattlefield({ warped: false });
        expect(state.delayedTriggers ?? []).toHaveLength(0);
        fireDelayedTriggers(state, "next-end-step");
        expect(state.players[0].battlefield.some((c) => c.id === "probe")).toBe(
            true
        );
    });

    it("exiles the permanent at the next end step and opens the recast window", () => {
        const { state } = warpedOnBattlefield({ turn: 3 });
        fireDelayedTriggers(state, "next-end-step");
        // CR 603.7a — the delayed ability uses the stack like any trigger.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].warpTrigger).toBe("probe");
        resolveTopOfStack(state);

        expect(state.players[0].battlefield.some((c) => c.id === "probe")).toBe(
            false
        );
        const exiled = state.players[0].exile.find((c) => c.id === "probe")!;
        expect(exiled).toBeDefined();
        // CR 702.185b — a "warped card in exile".
        expect(exiled.warpExiled).toBe(true);
        // CR 702.185a — castable by its OWNER, from the FOLLOWING turn.
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exiled.castableFromExileFromTurn).toBe(4);
        // No expiry: "for as long as it remains exiled".
        expect(exiled.castableFromExileUntilTurn).toBeUndefined();
        // An ordinary cast for the printed cost — no waiver rider.
        expect(exiled.castFromExileWithoutPayingManaCost).toBeUndefined();
    });

    it("CR 400.7 — a permanent that LEFT the battlefield produces no exile", () => {
        const { state } = warpedOnBattlefield();
        // Something killed it first: it is in the graveyard when the end step
        // arrives.
        const [gone] = state.players[0].battlefield.splice(0, 1);
        gone.zone = "graveyard";
        state.players[0].graveyard.push(gone);

        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[0].exile.some((c) => c.id === "probe")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "probe")).toBe(
            true
        );
    });

    it("CR 400.7 — a permanent that left and RETURNED is a new object the trigger does not chase", () => {
        const { state } = warpedOnBattlefield();
        // Bounced to hand and recast for its printed cost: the SAME instance
        // object comes back, and `resetBattlefieldTransientState` /
        // `resetStackTransientState` have cleared the marker off it.
        const [bounced] = state.players[0].battlefield.splice(0, 1);
        bounced.zone = "battlefield";
        delete bounced.warped;
        state.players[0].battlefield.push(bounced);

        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === "probe")).toBe(
            true
        );
        expect(state.players[0].exile.some((c) => c.id === "probe")).toBe(
            false
        );
    });
});

/** The probe sitting in p1's exile under a warp grant opened on `exiledOnTurn`,
 *  with the state's clock at `turn`. */
function warpedInExile(turn: number, exiledOnTurn = 3): GameState {
    const exiled = makeInstance(WARP_PROBE_ID, {
        id: "probe",
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
    });
    exiled.warpExiled = true;
    exiled.castableFromExileBy = "p1";
    exiled.castableFromExileFromTurn = exiledOnTurn + 1;
    const state = makeState({
        players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    state.turn = turn;
    state.players[0].manaPool.R = 5;
    return state;
}

describe("Warp — the recast window's LOWER bound (CR 702.185a)", () => {
    it("is CLOSED during the turn the card was warped out", () => {
        const state = warpedInExile(3);
        const exiled = state.players[0].exile[0];
        expect(exileCastPermission(exiled, "p1", state.turn)).toBe(false);
    });

    it("stays closed through that turn's END STEP and CLEANUP", () => {
        const state = warpedInExile(3);
        state.phase = "END_STEP";
        expect(
            exileCastPermission(state.players[0].exile[0], "p1", state.turn)
        ).toBe(false);
        // CR 514.2 — the cleanup sweep revokes impulse windows; an open-ended
        // warp grant is untouched by it, and still not yet open.
        finalizeCleanup(state);
        const afterCleanup = state.players[0].exile[0];
        expect(afterCleanup.castableFromExileBy).toBe("p1");
        expect(exileCastPermission(afterCleanup, "p1", 3)).toBe(false);
    });

    it("is OPEN from the following turn, and stays open on later turns", () => {
        for (const turn of [4, 5, 9]) {
            const state = warpedInExile(turn);
            expect(
                exileCastPermission(state.players[0].exile[0], "p1", turn)
            ).toBe(true);
        }
    });

    it("never opens for a player who does not hold the grant", () => {
        const state = warpedInExile(9);
        expect(
            exileCastPermission(state.players[0].exile[0], "p2", state.turn)
        ).toBe(false);
    });
});

describe("Warp — the lower bound at every consumer (CR 702.185a, issue #1268)", () => {
    /** The projected exile card the client's Cast button reads, through the
     *  REAL reducer — `projectPublicState`, never a hand-built view. */
    function projectedExileCard(state: GameState) {
        const projected = projectPublicState(state, 1, "p1");
        return projected.players[0].exile.find((c) => c.id === "probe")!;
    }

    it("the projection withholds legalActions while the window is closed", () => {
        const closed = projectedExileCard(warpedInExile(3));
        expect(closed.castableFromExileBy).toBe("p1");
        // The grant is visible (the card IS warped) but the affordance is not:
        // `ExileCastButton` gates its enabled state on exactly this array.
        expect(closed.legalActions ?? []).not.toContain("cast");
    });

    it("the projection attaches the cast affordance once the window opens", () => {
        const open = projectedExileCard(warpedInExile(4));
        expect(open.legalActions).toContain("cast");
    });
});

describe("Warp — the recast is an ORDINARY cast (CR 702.185a)", () => {
    it("declining on one turn leaves the card castable on the next", () => {
        // Nothing consumes the window: the card simply stays exiled.
        const later = warpedInExile(7);
        const exiled = later.players[0].exile[0];
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exileCastPermission(exiled, "p1", 7)).toBe(true);
    });

    it("the recast pays the printed mana cost and schedules no second exile", () => {
        const state = warpedInExile(4);
        // The recast is announced from EXILE, so nothing stamps `warped` —
        // it is not "cast from your hand" (CR 702.185a).
        const [card] = state.players[0].exile.splice(0, 1);
        const item: StackItem = { ...card, zone: "stack", castById: "p1" };
        delete item.castableFromExileBy;
        delete item.castableFromExileFromTurn;
        delete item.warpExiled;
        state.stack.push(item);
        resolveTopOfStack(state);

        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "probe"
        );
        expect(onBoard).toBeDefined();
        expect(onBoard!.warped).toBeUndefined();
        // CR 702.185a — it never warps again, so no second exile is scheduled.
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });
});

describe("Warp — serialization (issue #1268)", () => {
    it("round-trips the marker, the referent and the lower bound", () => {
        const { state } = warpedOnBattlefield({ turn: 3 });
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        state.players[0].spellsWarpedThisTurn = 2;

        const round = expandState(compactState(state));
        const exiled = round.players[0].exile.find((c) => c.id === "probe")!;
        expect(exiled.warpExiled).toBe(true);
        expect(exiled.castableFromExileFromTurn).toBe(4);
        expect(round.players[0].spellsWarpedThisTurn).toBe(2);
    });

    it("round-trips a warp permanent still awaiting its end step", () => {
        const { state } = warpedOnBattlefield();
        const round = expandState(compactState(state));
        expect(
            round.players[0].battlefield.find((c) => c.id === "probe")?.warped
        ).toBe(true);
        expect(round.delayedTriggers?.[0].warpCardInstanceId).toBe("probe");
    });
});

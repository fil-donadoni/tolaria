// PREPARATION (CR 722): the `prepared` designation, the exiled copy of the
// prepare spell, and its cast — through the engine's own entry points.
//
// Skycoach Conductor // All Aboard is the subject: "This creature enters
// prepared" gives the designation (CR 722.3a), the exiled copy is the twin
// `${id}#prepare` (CR 722.3c), and casting it is an ordinary cast from exile
// that unprepares the Conductor at CR 601.2i.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { chooseableNamesOf } from "../../cards/cardNames";
import { insetSpellDefinitionId } from "../../cards/insetSpell";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { enumerateMoves, type Move } from "../moves";
import {
    becomePrepared,
    checkPreparedCopySBA,
    hasPrepareSpell,
    unprepare,
} from "../prepare";
import { getLegalActions } from "../rules";
import { applyMoveInSearch } from "../search";
import { checkStateBasedActions } from "../sba";
import { compactState, expandState } from "../serialize";
import {
    getPlayer,
    applyControlChange,
    phaseInBundle,
    phaseOutPermanent,
    removePermanentTo,
    resolveTopOfStack,
} from "../state";
import type { CardInstanceState, GameState } from "../state";

const CONDUCTOR = getCardByName("Skycoach Conductor").id;
const ALL_ABOARD = insetSpellDefinitionId(CONDUCTOR, "prepare");
const ISLAND = getCardByName("Island").id;
const BEARS = getCardByName("Grizzly Bears").id;

function islands(owner: string, n: number): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(ISLAND, {
            id: `${owner}-island-${i}`,
            controllerId: owner,
            ownerId: owner,
        })
    );
}

/** p1: the Conductor in hand, four Islands and a Grizzly Bears. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(CONDUCTOR, {
                        id: "conductor",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    ...islands("p1", 4),
                    makeInstance(BEARS, {
                        id: "bears",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    ...islands("p2", 2),
                    makeInstance(BEARS, {
                        id: "their-bears",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

type CastMove = Extract<Move, { kind: "cast-spell" }>;

/** The Bot's enumerated cast of `instanceId` — the candidate set every cast
 *  surface agrees with — aimed at `targetId` when given. */
function castMove(
    state: GameState,
    playerId: string,
    instanceId: string,
    targetId?: string
): CastMove | undefined {
    return enumerateMoves(state, playerId).find(
        (m): m is CastMove =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === instanceId &&
            (targetId === undefined ||
                (m.targets ?? []).some((t) => t.id === targetId))
    );
}

/** Commit the cast through the shared cast commit kernel (the ISMCTS
 *  applier), leaving the spell on the stack. */
function cast(
    state: GameState,
    playerId: string,
    instanceId: string,
    targetId?: string
): GameState {
    const move = castMove(state, playerId, instanceId, targetId);
    expect(move, `cast of ${instanceId} offered`).toBeDefined();
    applyMoveInSearch(state, playerId, move!);
    return state;
}

/** {@link cast}, then resolve the stack and run state-based actions. */
function castAndResolve(
    state: GameState,
    playerId: string,
    instanceId: string,
    targetId?: string
): GameState {
    cast(state, playerId, instanceId, targetId);
    while (state.stack.length > 0) resolveTopOfStack(state);
    checkStateBasedActions(state);
    return state;
}

const conductorOf = (state: GameState): CardInstanceState | undefined =>
    state.players
        .flatMap((p) => p.battlefield)
        .find((c) => (c.card as { id: string }).id === CONDUCTOR);

const copiesIn = (state: GameState): CardInstanceState[] =>
    state.players
        .flatMap((p) => [...p.exile, ...p.graveyard, ...p.hand, ...p.library])
        .filter((c) => (c.card as { id: string }).id === ALL_ABOARD);

/** The Conductor already on p1's battlefield, prepared, with its copy. */
function preparedBoard(): GameState {
    const state = castAndResolve(board(), "p1", "conductor");
    state.priorityPlayerId = "p1";
    return state;
}

describe("CR 722.3a — the prepared designation", () => {
    it("a preparation card enters prepared and its controller creates the copy in exile (CR 722.3c)", () => {
        const state = preparedBoard();
        const conductor = conductorOf(state)!;
        expect(conductor.prepared).toBe(true);
        const copies = copiesIn(state);
        expect(copies).toHaveLength(1);
        // CR 112.2a — the controller creates it, so the controller owns it.
        expect(copies[0].zone).toBe("exile");
        expect(copies[0].ownerId).toBe("p1");
        expect(copies[0].castableFromExileBy).toBe("p1");
        // CR 722.3c — "those characteristics become the copy's NORMAL
        // characteristics": an Instant, not a 2/3 Bird Pilot.
        expect(copies[0].types).toEqual(["Instant"]);
        expect(copies[0].power).toBeUndefined();
    });

    it("the parent never offers the prepare spell as a cast option (CR 722.3)", () => {
        const state = board();
        const moves = enumerateMoves(state, "p1").filter(
            (m): m is CastMove =>
                m.kind === "cast-spell" && m.cardInstanceId === "conductor"
        );
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.every((m) => m.alternativeCostId === undefined)).toBe(
            true
        );
    });

    it("an already-prepared permanent cannot gain the designation again and makes no second copy", () => {
        const state = preparedBoard();
        expect(becomePrepared(state, conductorOf(state)!)).toBe(false);
        expect(copiesIn(state)).toHaveLength(1);
    });

    it("a permanent with no prepare spell cannot become prepared", () => {
        const state = preparedBoard();
        const bears = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(hasPrepareSpell(bears)).toBe(false);
        expect(becomePrepared(state, bears)).toBe(false);
        expect(bears.prepared).toBeUndefined();
        expect(copiesIn(state)).toHaveLength(1);
    });

    it("becoming unprepared removes the copy (CR 722.3b / 722.3c)", () => {
        const state = preparedBoard();
        unprepare(state, conductorOf(state)!);
        expect(conductorOf(state)!.prepared).toBeUndefined();
        expect(copiesIn(state)).toHaveLength(0);
    });
});

describe("CR 722.3c — the exiled copy's lifetime", () => {
    it("the permanent leaving the battlefield removes the copy", () => {
        const state = preparedBoard();
        removePermanentTo(state, conductorOf(state)!.id, "hand");
        checkStateBasedActions(state);
        expect(copiesIn(state)).toHaveLength(0);
        // CR 400.7 — the card in hand is a new object with no designation.
        expect(getPlayer(state, "p1").hand[0].prepared).toBeUndefined();
    });

    it("a flickered Conductor enters prepared again with ONE copy — the old object's copy is gone (CR 400.7)", () => {
        const state = preparedBoard();
        const [before] = copiesIn(state);
        const p1 = getPlayer(state, "p1");
        p1.hand.push(
            makeInstance(getCardByName("Ephemerate").id, {
                id: "ephemerate",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        p1.battlefield.push(
            makeInstance(getCardByName("Plains").id, {
                id: "plains",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        castAndResolve(state, "p1", "ephemerate", conductorOf(state)!.id);
        expect(conductorOf(state)!.prepared).toBe(true);
        const after = copiesIn(state);
        expect(after).toHaveLength(1);
        expect(after[0].id).not.toBe(before.id);
    });

    it("phasing out removes the copy; phasing in prepared makes a new one", () => {
        const state = preparedBoard();
        const bundle = phaseOutPermanent(state, conductorOf(state)!.id, {
            returnOn: { kind: "untap-cycle" },
        })!;
        checkStateBasedActions(state);
        expect(copiesIn(state)).toHaveLength(0);
        phaseInBundle(state, bundle);
        expect(conductorOf(state)!.prepared).toBe(true);
        expect(copiesIn(state)).toHaveLength(1);
    });

    it("after a control change the NEW controller is the one who may cast it", () => {
        const state = preparedBoard();
        // CR 613.1b — a layer-2 control change (the Control Magic shape).
        applyControlChange(state, conductorOf(state)!.id, "p2", "steal");
        expect(conductorOf(state)!.controllerId).toBe("p2");
        checkStateBasedActions(state);
        const [copy] = copiesIn(state);
        expect(copy.castableFromExileBy).toBe("p2");
        state.priorityPlayerId = "p2";
        expect(castMove(state, "p2", copy.id, "their-bears")).toBeDefined();
        state.priorityPlayerId = "p1";
        expect(castMove(state, "p1", copy.id)).toBeUndefined();
    });

    it("a copy that leaves exile any other way than being cast ceases to exist (CR 704.5e)", () => {
        const state = preparedBoard();
        const p1 = getPlayer(state, "p1");
        const [copy] = copiesIn(state);
        p1.exile = p1.exile.filter((c) => c !== copy);
        p1.graveyard.push({ ...copy, zone: "graveyard" });
        expect(checkPreparedCopySBA(state)).toBe(true);
        expect(copiesIn(state)).toHaveLength(0);
    });
});

describe("CR 722.3c / 601.2i — casting the copy", () => {
    it("the copy is castable by its controller at instant speed, and only by them", () => {
        const state = preparedBoard();
        const [copy] = copiesIn(state);
        state.activePlayerId = "p2";
        expect(getLegalActions(state, getPlayer(state, "p1"), copy)).toContain(
            "cast"
        );
        expect(castMove(state, "p2", copy.id)).toBeUndefined();
    });

    it("casting it unprepares the permanent at 601.2i, before it resolves", () => {
        const state = preparedBoard();
        const [copy] = copiesIn(state);
        cast(state, "p1", copy.id, "bears");
        expect(state.stack).toHaveLength(1);
        expect((state.stack[0].card as { id: string }).id).toBe(ALL_ABOARD);
        expect(conductorOf(state)!.prepared).toBeUndefined();
        expect(copiesIn(state)).toHaveLength(0);
    });

    it("the resolved copy flickers its target and goes to no graveyard (CR 704.5e)", () => {
        const state = preparedBoard();
        const [copy] = copiesIn(state);
        const next = castAndResolve(state, "p1", copy.id, "bears");
        expect(next.stack).toHaveLength(0);
        expect(copiesIn(next)).toHaveLength(0);
        expect(getPlayer(next, "p1").graveyard).toHaveLength(0);
        // CR 400.7 — the Bears came back as a new object.
        const bears = getPlayer(next, "p1").battlefield.filter(
            (c) => (c.card as { id: string }).id === BEARS
        );
        expect(bears).toHaveLength(1);
        expect(bears[0].isSummoningSick).toBe(true);
        expect(conductorOf(next)!.prepared).toBeUndefined();
    });

    it("a Pilot is not a legal target (non-Pilot creature you control)", () => {
        const state = preparedBoard();
        const [copy] = copiesIn(state);
        expect(castMove(state, "p1", copy.id, "bears")).toBeDefined();
        expect(
            castMove(state, "p1", copy.id, conductorOf(state)!.id)
        ).toBeUndefined();
    });

    it("a copy of the prepare spell is a prepare spell (CR 722.3d — the twin id rides the copy)", () => {
        const state = preparedBoard();
        const [copy] = copiesIn(state);
        expect(hasPrepareSpell(copy)).toBe(false);
        expect((copy.card as { id: string }).id).toBe(ALL_ABOARD);
    });
});

describe("CR 722.5 — the prepare spell's name", () => {
    it("a name choice may name the prepare spell", () => {
        expect(chooseableNamesOf(getCardByName("Skycoach Conductor"))).toEqual([
            "Skycoach Conductor",
            "All Aboard",
        ]);
    });
});

describe("wire and persistence", () => {
    it("the client sees `prepared` and the castable exiled copy through projectPublicState", () => {
        const state = preparedBoard();
        const [copy] = copiesIn(state);
        const own = projectPublicState(state, 1, "p1");
        const slimConductor = own.players[0].battlefield.find(
            (c) => c.card.id === CONDUCTOR
        )!;
        expect(slimConductor.prepared).toBe(true);
        const slimCopy = own.players[0].exile.find((c) => c.id === copy.id)!;
        expect(slimCopy.card.id).toBe(ALL_ABOARD);
        expect(slimCopy.castableFromExileBy).toBe("p1");
        // The opponent sees the designation too (public), but not a cast.
        const theirs = projectPublicState(state, 1, "p2");
        expect(
            theirs.players[0].battlefield.find((c) => c.card.id === CONDUCTOR)!
                .prepared
        ).toBe(true);
    });

    it("`prepared` and the copy link survive a save → load round trip", () => {
        const state = preparedBoard();
        const loaded = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        expect(conductorOf(loaded)!.prepared).toBe(true);
        const [copy] = copiesIn(loaded);
        expect(copy.preparedCopyOf).toBe(conductorOf(loaded)!.id);
        expect(copy.castableFromExileBy).toBe("p1");
    });
});

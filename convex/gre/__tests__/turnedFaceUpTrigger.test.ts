// "When this creature is turned face up" (CR 708.8 / 702.37e, issue #5227).
//
//   - The event: `PERMANENT_TURNED_FACE_UP` is queued by the battlefield
//     turn-up seam (`turnFaceUpOnBattlefield`) — the morph special action and
//     an Illusionary Mask sentinel's own replacement — and NOT by the CR 708.9
//     reveal of a face-down permanent leaving the battlefield.
//   - Full path: `applyTurnPermanentFaceUp` (the body of the
//     `turnPermanentFaceUp` mutation) puts the card's own face-up trigger on
//     the stack, the player who took the action keeps priority (CR 116.3) even
//     when that is the non-active player, and the trigger resolves.
//   - Wire format: the opponent's projection carries the trigger on the stack.
//
// The cards are real compiled corpus cards (Master of Pearls, Skinthinner),
// looked up by name through the catalogue like any other card.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { turnFaceDown, turnFaceUpOnBattlefield } from "../faceDown";
import {
    removePermanentTo,
    resolveTopOfStack,
    tapPermanent,
    type CardInstanceState,
    type GameState,
} from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import { applyTurnPermanentFaceUp, finalizeTargetSelection } from "../../game";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";

const MASTER_OF_PEARLS = getCardByName("Master of Pearls").id; // Morph {3}{W}{W}
const PLAINS = getCardByName("Plains").id;
const BEARS = getCardByName("Grizzly Bears").id;

function lands(id: string, owner: string, n: number): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(id, {
            id: `${owner}-land${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "battlefield",
        })
    );
}

/** `owner` controls a face-down Master of Pearls, five Plains and a Grizzly
 *  Bears; p1 is the active player and `owner` holds priority. */
function masterBoard(owner: "p1" | "p2"): {
    state: GameState;
    master: CardInstanceState;
} {
    const master = makeInstance(MASTER_OF_PEARLS, {
        id: "master",
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });
    turnFaceDown(NO_BOARD_LAYER_VIEW, master, "morph");
    const bears = makeInstance(BEARS, {
        id: "bears",
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });
    const own = [master, bears, ...lands(PLAINS, owner, 5)];
    const state = makeState({
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", { battlefield: owner === "p1" ? own : [] }),
            makePlayer("p2", { battlefield: owner === "p2" ? own : [] }),
        ],
    });
    state.activePlayerId = "p1";
    state.priorityPlayerId = owner;
    return { state, master: own[0] };
}

const faceUpEvents = (state: GameState) =>
    (state.pendingEvents ?? []).filter(
        (e) => e.type === "PERMANENT_TURNED_FACE_UP"
    );

describe("PERMANENT_TURNED_FACE_UP — which turn-ups emit it (CR 708.8)", () => {
    it("the battlefield seam queues one event naming the permanent and its controller", () => {
        const { state, master } = masterBoard("p1");
        turnFaceUpOnBattlefield(state, master);
        expect(master.faceDown).toBeUndefined();
        expect(faceUpEvents(state)).toEqual([
            {
                type: "PERMANENT_TURNED_FACE_UP",
                permanentId: "master",
                controllerId: "p1",
            },
        ]);
    });

    it("an Illusionary Mask sentinel turned up by its own tap replacement emits it", () => {
        const { state, master } = masterBoard("p1");
        // CR 708.2 / ADR 0013 — the masked face-down object: its sentinel
        // definition turns it face up as it would become tapped.
        delete master.faceDown;
        delete master.faceDownOf;
        delete master.faceDownBy;
        master.card = { id: MASTER_OF_PEARLS };
        turnFaceDown(state, master, "cast-face-down");
        tapPermanent(state, master);
        expect(master.faceDown).toBeUndefined();
        expect(faceUpEvents(state).map((e) => e.permanentId)).toEqual([
            "master",
        ]);
    });

    it("the CR 708.9 reveal of a face-down permanent leaving the battlefield is NOT a turn face up", () => {
        const { state } = masterBoard("p1");
        removePermanentTo(state, "master", "graveyard");
        // Revealed as it moved: the graveyard holds the real card…
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            MASTER_OF_PEARLS
        );
        // …and no "turned face up" event was queued for it.
        expect(faceUpEvents(state)).toHaveLength(0);
    });
});

describe("turning a morph face up fires its own trigger (CR 708.8 / 702.37e, full path)", () => {
    it("puts the face-up trigger on the stack, keeps priority with the actor, and resolves", () => {
        const { state } = masterBoard("p1");
        applyTurnPermanentFaceUp(state, "p1", "master");
        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        expect(item.triggerSourceId).toBe("master");
        expect(item.controllerId).toBe("p1");
        expect(item.triggerEvent?.type).toBe("PERMANENT_TURNED_FACE_UP");
        expect(state.priorityPlayerId).toBe("p1");

        // Wire format: the opponent sees the trigger on the stack, sourced
        // from the now face-up permanent.
        const opp = projectPublicState(state, 1, "p2");
        expect(opp.stack).toHaveLength(1);
        expect(opp.stack[0].triggerSourceId).toBe("master");

        resolveTopOfStack(state);
        const bears = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        // "creatures you control get +2/+2 until end of turn"
        expect(getEffectivePower(state, bears)).toBe(4);
        expect(getEffectiveToughness(state, bears)).toBe(4);
    });

    it("another permanent's turn-up does not fire it: the head is the source's own", () => {
        const { state, master } = masterBoard("p1");
        // Master of Pearls already face up (turned up by hand, its Plains
        // untapped); a second face-down Master is turned up for real.
        turnFaceUpOnBattlefield(state, master);
        delete state.pendingEvents;
        const other = makeInstance(MASTER_OF_PEARLS, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        turnFaceDown(NO_BOARD_LAYER_VIEW, other, "morph");
        state.players[0].battlefield.push(other);
        applyTurnPermanentFaceUp(state, "p1", "other");
        expect(state.stack.map((s) => s.triggerSourceId)).toEqual(["other"]);
    });

    it("a NON-active player who turns a morph up receives priority afterward (CR 116.3)", () => {
        const { state } = masterBoard("p2");
        applyTurnPermanentFaceUp(state, "p2", "master");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].controllerId).toBe("p2");
        expect(state.activePlayerId).toBe("p1");
        expect(state.priorityPlayerId).toBe("p2");
        expect(state.passCount).toBe(0);
    });

    it("a NON-active actor whose face-up trigger asks for a target still gets priority once it is chosen (CR 116.3)", () => {
        // Skirk Marauder's "any target" always has a real choice (both
        // players at least), so the announcement SUSPENDS on p2's prompt and
        // lands from the target-submit handler, not from the special action.
        const marauder = makeInstance(getCardByName("Skirk Marauder").id, {
            id: "marauder",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        turnFaceDown(NO_BOARD_LAYER_VIEW, marauder, "morph");
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        marauder,
                        ...lands(getCardByName("Mountain").id, "p2", 3),
                    ],
                }),
            ],
        });
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p2";
        applyTurnPermanentFaceUp(state, "p2", "marauder");
        expect(state.pendingTarget?.playerId).toBe("p2");
        expect(state.priorityAfterTriggerAnnouncement).toBe("p2");
        // A stable save point: the actor survives the round trip.
        const saved = expandState(compactState(state));
        expect(saved.priorityAfterTriggerAnnouncement).toBe("p2");

        const pt = saved.pendingTarget!;
        pt.selected = [{ type: "player", id: "p1" }];
        finalizeTargetSelection(saved, pt, "p2");
        expect(saved.stack[0].targets).toEqual([{ type: "player", id: "p1" }]);
        expect(saved.priorityPlayerId).toBe("p2");
        expect(saved.priorityAfterTriggerAnnouncement).toBeUndefined();
    });

    it("a targeted face-up trigger announces its target and resolves (CR 603.3d)", () => {
        const skinthinner = makeInstance(getCardByName("Skinthinner").id, {
            id: "thinner",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        turnFaceDown(NO_BOARD_LAYER_VIEW, skinthinner, "morph");
        const swamps = lands(getCardByName("Swamp").id, "p1", 5);
        const victim = makeInstance(BEARS, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", { battlefield: [skinthinner, ...swamps] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        applyTurnPermanentFaceUp(state, "p1", "thinner");
        // "destroy target nonblack creature" — announced as it goes on the
        // stack; Skinthinner itself is black, so the Bears are the one legal
        // target and the announcement needs no prompt.
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggerSourceId).toBe("thinner");
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["victim"]);
    });
});

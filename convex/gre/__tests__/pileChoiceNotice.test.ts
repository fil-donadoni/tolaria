// ADR 0053 (pile division) / issue #5661 — the `lastPileChoice` notice that
// lets EVERY seat confirm a `pick-pile` answer, and the wire carrying both it
// and the unchosen pile's CR 509.1b block restriction to the client.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { getDefinition } from "../../cards";

const standOrFall = getDefinition("60c34970-a106-490c-ac37-6156eb7f34ce");
const factOrFiction = getDefinition("7fd4d018-dcf3-4439-8445-02d66e44f7d3");
const savannahLions = getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0");

function submit(state: GameState, playerId: string, ids: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

/** Put the "sof" trigger (always the SAME stack item id, as a recast spell's
 *  would be) on the stack, resolve it and divide `sof-1` | `sof-2`. */
function divideStandOrFall(state: GameState): void {
    const enchantment = state.players[0].battlefield.find(
        (c) => c.id === "sof"
    )!;
    state.stack.push({
        ...enchantment,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "stand-or-fall-divide",
        triggerSourceId: "sof",
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
        },
        targets: [],
    });
    resolveTopOfStack(state);
    submit(state, "p1", ["sof-1"]); // divider: pile A = sof-1, B = sof-2
    expect(state.pendingChoices![0].kind).toBe("pick-pile");
}

/** Stand or Fall's combat-begin trigger on p1's turn, p2's two creatures
 *  divided `sof-1` | `sof-2`, the pick still pending. */
function standOrFallAtPick(opts: { faceDown?: boolean } = {}): GameState {
    const enchantment = makeInstance(standOrFall.id, {
        id: "sof",
        controllerId: "p1",
        ownerId: "p1",
    });
    const creatures = ["sof-1", "sof-2"].map((id) =>
        makeInstance(savannahLions.id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            ...(opts.faceDown && id === "sof-2" ? { faceDown: true } : {}),
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [enchantment] }),
            makePlayer("p2", { battlefield: creatures }),
        ],
    });
    divideStandOrFall(state);
    return state;
}

describe("lastPileChoice — pick-pile confirmation (ADR 0053, issue #5661)", () => {
    it("records the chooser, the pile and its card names when the pile is taken", () => {
        const state = standOrFallAtPick();
        const pick = state.pendingChoices![0];
        submit(state, "p2", ["B"]);
        expect(state.lastPileChoice).toEqual({
            key: `1:${pick.stackItemId}:${pick.step}:${pick.choiceId}`,
            seq: 1,
            chooserId: "p2",
            pile: "B",
            cardNames: [savannahLions.name],
        });
    });

    it("gives a second pick on the SAME stack item id a new key (a recast spell keeps its instance id)", () => {
        const state = standOrFallAtPick();
        const pick = state.pendingChoices![0];
        submit(state, "p2", ["A"]);
        const first = state.lastPileChoice!.key;
        divideStandOrFall(state);
        expect(state.pendingChoices![0].stackItemId).toBe(pick.stackItemId);
        submit(state, "p2", ["A"]);
        expect(state.lastPileChoice!.seq).toBe(2);
        expect(state.lastPileChoice!.key).not.toBe(first);
    });

    it("a rejected submission records nothing", () => {
        const state = standOrFallAtPick();
        expect(() => submit(state, "p2", ["C"])).toThrow();
        expect(state.lastPileChoice).toBeUndefined();
    });

    it("never names a face-down card (CR 708.2a)", () => {
        const state = standOrFallAtPick({ faceDown: true });
        submit(state, "p2", ["B"]);
        expect(state.lastPileChoice?.cardNames).toEqual(["Face-down card"]);
    });

    it("names Fact or Fiction's chosen pile although it has moved to a hand the divider cannot see", () => {
        const library = ["fof-1", "fof-2", "fof-3"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2", {})],
        });
        pushSpell(state, factOrFiction.id, "p1", []);
        resolveTopOfStack(state);
        submit(state, "p2", ["fof-1", "fof-2"]); // the opponent divides
        submit(state, "p1", ["A"]); // the caster takes pile A
        expect(state.players[0].hand.map((c) => c.id)).toEqual([
            "fof-1",
            "fof-2",
        ]);
        // The divider's view: the hand is hidden, the notice still names it.
        const divider = projectPublicState(state, 1, "p2");
        expect(divider.lastPileChoice).toMatchObject({
            chooserId: "p1",
            pile: "A",
            cardNames: [savannahLions.name, savannahLions.name],
        });
    });

    it("survives the save and reaches BOTH seats with the unchosen pile's block restriction (wire format)", () => {
        const picked = standOrFallAtPick();
        submit(picked, "p2", ["A"]);
        const state = expandState(compactState(picked));
        for (const viewer of ["p1", "p2"]) {
            const view = projectPublicState(state, 1, viewer);
            expect(view.lastPileChoice?.pile).toBe("A");
            const p2 = view.players.find((p) => p.id === "p2")!;
            const flag = (id: string) =>
                p2.battlefield.find((c) => c.id === id)?.cantBlockThisTurn;
            expect(flag("sof-1")).toBeUndefined(); // chosen pile may block
            expect(flag("sof-2")).toBe(true); // CR 509.1b — the other can't
        }
    });
});

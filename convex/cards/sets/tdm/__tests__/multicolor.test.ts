// TDM — multicolor card behavior tests (ADR 0043 colour split).
//
// Ureni, the Song Unending: the ETB divides a TEXT-DEFINED budget — "X damage
// … where X is the number of lands you control" — so the divide total is a
// `TargetCountQuantity` read as the trigger is put on the stack (CR 603.3d
// incorporating CR 601.2d), not a fixed number.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import {
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import type { TargetSelection } from "../../../types";
import { getDefinition } from "../../../index";

const ureni = getDefinition("227802c0-4ff6-43a8-a850-ed0f546dc5ac");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const treefolk = getDefinition("b93c5869-7777-44bb-967a-e9439b25ced4"); // 3/5

function ureniEtbOnStack(state: GameState, controllerId: string): StackItem {
    const source = makeInstance(ureni.id, {
        id: "ureni-src",
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
    state.players.find((p) => p.id === controllerId)!.battlefield.push(source);
    const trig: StackItem = {
        ...source,
        id: "ureni-trig",
        zone: "stack",
        castById: controllerId,
        triggeredAbilityId: "ureni-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

function lands(controllerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(forest.id, {
            id: `${controllerId}-land-${i}`,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
        })
    );
}

function creature(id: string, controllerId: string) {
    return makeInstance(treefolk.id, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
    });
}

describe("Ureni, the Song Unending — ETB divides X = lands you control (CR 601.2d via CR 603.3d)", () => {
    it("announces a divide budget equal to the controller's land count and deals the chosen split", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [...lands("p1", 3), creature("mine", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: [
                        ...lands("p2", 5),
                        creature("a", "p2"),
                        creature("b", "p2"),
                    ],
                }),
            ],
        });
        ureniEtbOnStack(state, "p1");

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        // CR 601.2d — the budget is the 3 lands p1 controls, not p2's 5.
        expect(pt.divideTotal).toBe(3);
        expect(pt.count).toEqual({ min: 1, max: 3 });

        pt.selected = [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ] as TargetSelection[];
        pt.divideAmounts = { "permanent:a": 1, "permanent:b": 2 };
        finalizeTargetSelection(state, pt, "p1");

        resolveTopOfStack(state);
        const opp = state.players[1].battlefield;
        expect(opp.find((c) => c.id === "a")?.damageMarked).toBe(1);
        expect(opp.find((c) => c.id === "b")?.damageMarked).toBe(2);
        const mine = state.players[0].battlefield;
        expect(mine.find((c) => c.id === "mine")?.damageMarked ?? 0).toBe(0);
    });

    it("keeps the announced split when the lands leave before resolution (CR 601.2d)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: lands("p1", 2) }),
                makePlayer("p2", { battlefield: [creature("a", "p2")] }),
            ],
        });
        ureniEtbOnStack(state, "p1");
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const pt = state.pendingTarget!;
        expect(pt.divideTotal).toBe(2);
        pt.selected = [{ type: "permanent", id: "a" }] as TargetSelection[];
        pt.divideAmounts = { "permanent:a": 2 };
        finalizeTargetSelection(state, pt, "p1");

        // Every land leaves: the resolution-time count reads 0, but the
        // division was announced as the ability went on the stack.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => !c.id.startsWith("p1-land-")
        );
        resolveTopOfStack(state);
        const opp = state.players[1].battlefield;
        expect(opp.find((c) => c.id === "a")?.damageMarked).toBe(2);
    });

    it("is removed from the stack when opponents control no creature or planeswalker (CR 603.3d)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [...lands("p1", 4), creature("mine", "p1")],
                }),
                makePlayer("p2", { battlefield: lands("p2", 2) }),
            ],
        });
        ureniEtbOnStack(state, "p1");
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack.find((s) => s.id === "ureni-trig")).toBeUndefined();
    });
});

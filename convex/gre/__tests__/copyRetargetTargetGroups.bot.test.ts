// CR 707.10c / 601.2c — the Bot's in-tree answer to a copy retarget of a
// multi-group spell walks every group through the same authority the server
// uses (`applyRaisedTargetFinalization`), instead of finalizing after the
// primary group and dropping the rest.
import { describe, it, expect } from "vitest";
import {
    makeState,
    makePlayer,
    makeInstance,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { requestCopyRetargetOn } from "../state";
import { enumerateRaisedTargetMoves } from "../moves";
import { applyMoveInSearch } from "../search";

const fumarole = getDefinition("efa53e9a-0d7c-4d17-b2be-56930edfa2c2");
const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");

describe("search commits a multi-group copy retarget group by group (CR 707.10c)", () => {
    it("Fumarole copy keeps both picks after two submit-target plies", () => {
        const mk = (id: string, cardId: string) =>
            makeInstance(cardId, { id, controllerId: "p2", ownerId: "p2" });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        mk("bear1", bears.id),
                        mk("bear2", bears.id),
                        mk("land1", mountain.id),
                        mk("land2", mountain.id),
                    ],
                }),
            ],
        });
        const copy = pushSpell(state, fumarole.id, "p1", [
            { type: "permanent", id: "bear1" },
            { type: "permanent", id: "land1" },
        ]);
        requestCopyRetargetOn(state, copy);

        const first = enumerateRaisedTargetMoves(state, "p1").find(
            (m) => m.kind === "submit-target" && m.targets[0].id === "bear2"
        )!;
        applyMoveInSearch(state, "p1", first);
        // The land group is now loaded; the copy is untouched until it ends.
        expect(state.pendingTarget).toBeDefined();

        const second = enumerateRaisedTargetMoves(state, "p1").find(
            (m) => m.kind === "submit-target" && m.targets[0].id === "land2"
        )!;
        applyMoveInSearch(state, "p1", second);
        expect(state.pendingTarget).toBeUndefined();
        expect(copy.targets).toEqual([
            { type: "permanent", id: "bear2" },
            { type: "permanent", id: "land2" },
        ]);
    });
});

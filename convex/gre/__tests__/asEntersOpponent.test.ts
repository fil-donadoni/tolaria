// "As this permanent enters, choose an opponent." — the as-enters OPPONENT leg
// (`AsEntersChoice` kind `opponent`), Cursed Rack / The Rack / Lost Order of
// Jarkeld.
//
//  - CR 614.1c — the "as ~ enters" clause is a replacement, not a trigger;
//  - CR 614.12a — the pick is made BEFORE the permanent enters, so
//    `chosenPlayerId` is already set when it arrives (nothing on the stack);
//  - one opponent is a zero-branch choice and is auto-answered;
//  - the pick survives the CR 400.7 entry reset and the wire projection.
import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { applyPlayLand } from "../playLand";
import type { GameState } from "../state";

const RACK_LAND: CardDefinition = {
    id: "as-enters-opponent-test-land",
    name: "Opponent Chooser",
    rarity: "common",
    types: ["Land"],
    oracleText: "As this land enters, choose an opponent.",
    entersWith: { asEnters: [{ kind: "opponent" }] },
};

function board(playerIds: string[]): GameState {
    return makeState({
        players: playerIds.map((id) =>
            id === "p1"
                ? makePlayer(id, {
                      hand: [
                          makeInstance(RACK_LAND.id, {
                              id: "chooser",
                              controllerId: "p1",
                              ownerId: "p1",
                              zone: "hand",
                          }),
                      ],
                  })
                : makePlayer(id)
        ),
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const onBattlefield = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === "chooser");

describe("as-enters opponent (CR 614.1c / 614.12a)", () => {
    it("one opponent is auto-answered: enters with the pick, no prompt, no trigger", () => {
        withTemporaryDefinition(RACK_LAND, () => {
            const state = board(["p1", "p2"]);
            applyPlayLand(state, state.players[0], "chooser");

            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.stack).toHaveLength(0);
            expect(onBattlefield(state)?.chosenPlayerId).toBe("p2");
        });
    });

    it("several opponents: offers each BEFORE the permanent enters, then writes the pick", () => {
        withTemporaryDefinition(RACK_LAND, () => {
            const state = board(["p1", "p2", "p3"]);
            applyPlayLand(state, state.players[0], "chooser");

            expect(onBattlefield(state)).toBeUndefined();
            const head = (state.pendingChoices ?? [])[0];
            expect(head.kind).toBe("option-pick");
            expect(head.asEntersKind).toBe("opponent");
            expect(head.options?.map((o) => o.id)).toEqual(["p2", "p3"]);

            submitChoice(state, ["p3"]);

            expect(onBattlefield(state)?.chosenPlayerId).toBe("p3");
            expect(state.stack).toHaveLength(0);
        });
    });

    it("refuses a pick that is not an offered opponent (fail-closed)", () => {
        withTemporaryDefinition(RACK_LAND, () => {
            const state = board(["p1", "p2", "p3"]);
            applyPlayLand(state, state.players[0], "chooser");

            expect(() => submitChoice(state, ["p1"])).toThrow();
            expect(onBattlefield(state)).toBeUndefined();
        });
    });

    it("the chosen player survives the wire projection", () => {
        withTemporaryDefinition(RACK_LAND, () => {
            const state = board(["p1", "p2"]);
            applyPlayLand(state, state.players[0], "chooser");

            const projected = projectPublicState(state, 1, "p1");
            const wire = projected.players[0].battlefield.find(
                (c) => c.id === "chooser"
            );
            expect(wire?.chosenPlayerId).toBe("p2");
        });
    });
});

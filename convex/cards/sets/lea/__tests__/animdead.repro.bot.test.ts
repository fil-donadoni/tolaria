import { describe, it, expect } from "vitest";
import { animateDead, grizzlyBears, lightningBolt } from "..";
import { resolveTopOfStack } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import { enumerateMoves } from "../../../../gre/moves";
import { legalActions } from "../../../../gre/legalActions";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

describe("REPRO: animate dead LTB trigger stuck on stack", () => {
    it("bot/legal-action surfaces still work with the trigger on the stack", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "dead" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.stack.length).toBe(1);
        console.log("expectedInput:", JSON.stringify(state.expectedInput));
        console.log("legalActions:", JSON.stringify(legalActions(state)));
        for (const pid of ["p1", "p2"]) {
            const moves = enumerateMoves(state, pid);
            console.log(
                `moves ${pid}:`,
                JSON.stringify(moves.map((m) => m.kind))
            );
        }
        const proj = projectPublicState(state, 1, "p1");
        console.log("projected stack:", JSON.stringify(proj.stack));
    });
});

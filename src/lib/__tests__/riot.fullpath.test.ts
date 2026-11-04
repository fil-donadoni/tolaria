// Riot end to end (CR 702.136a): the GRE parks the entry choice, the prompt crosses
// the projection saying what declining gives, and the client's own attacker gate
// reads the projected permanent, so declining lets a human attack with it and
// accepting does not.
import { describe, expect, it } from "vitest";
import {
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "@convex/cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import { resolveTopOfStack } from "@convex/gre/state";
import type { CardInstance, Player } from "~/types/game";
import { isEligibleAttacker } from "../attacker-eligibility";

const RIOTER: CardDefinition = {
    id: "riot-fullpath-creature",
    name: "Riot Full Path",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["riot"],
};

function atThePrompt() {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    pushSpell(state, RIOTER.id, "p1");
    resolveTopOfStack(state);
    return state;
}

function attackableOnTheWire(answer: "accept" | "decline") {
    const state = atThePrompt();
    submitChoice(state, [answer]);
    state.players[0].battlefield[0].isSummoningSick = true;
    const wire = projectPublicState(state, 1, "p1");
    const players = wire.players as unknown as Player[];
    return isEligibleAttacker(
        players[0].battlefield[0] as CardInstance,
        players[1].battlefield as CardInstance[],
        players
    );
}

describe("Riot, GRE to projection to client (CR 702.136a)", () => {
    it("the prompt reaches the client with both answers", () => {
        withTemporaryDefinition(RIOTER, () => {
            const wire = projectPublicState(atThePrompt(), 1, "p1");
            const choice = wire.pendingChoices?.[0];
            expect(choice?.prompt).toContain("If you don't, it gains haste.");
            expect(choice?.options?.map((o) => o.label)).toEqual([
                "Enter with a +1/+1 counter",
                "Enter with haste",
            ]);
        });
    });

    it("declining: the summoning-sick permanent is an eligible attacker", () => {
        withTemporaryDefinition(RIOTER, () => {
            expect(attackableOnTheWire("decline")).toBe(true);
        });
    });

    it("accepting: the summoning-sick permanent is not", () => {
        withTemporaryDefinition(RIOTER, () => {
            expect(attackableOnTheWire("accept")).toBe(false);
        });
    });
});

// Extort's payment end to end (CR 702.101a / 608.2g): the GRE parks a hybrid
// may-pay, it crosses the projection, and the client's own Pay gate and label read
// it, so a human holding either colour can pay and one holding neither cannot.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "@convex/cards/registry";
import { darkRitual } from "@convex/cards/sets/lea/black.cards";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "@convex/gre/state";
import { mayPayCanAfford, mayPayCostLabel } from "../card-utils";

const EXTORTER: CardDefinition = {
    id: "extort-fullpath-creature",
    name: "Extort Full Path",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["extort"],
};

function owedOnTheWire(pool: Partial<Record<"W" | "B" | "R", number>>) {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(EXTORTER.id, {
                        id: "x",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool },
            }),
            makePlayer("p2"),
        ],
    });
    emitSpellCastEvent(state, pushSpell(state, darkRitual().id, "p1"));
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
    const wire = projectPublicState(state, 1, "p1");
    return { cost: wire.pendingChoices![0].cost!, chooser: wire.players[0] };
}

describe("extort's payment: GRE → wire → client gate (CR 702.101a)", () => {
    it("labels the pip as the hybrid it is", () => {
        withTemporaryDefinition(EXTORTER, () => {
            const { cost } = owedOnTheWire({ W: 1 });
            expect(mayPayCostLabel(cost)).toBe("{W/B}");
        });
    });

    it.each([
        ["white", { W: 1 }, true],
        ["black", { B: 1 }, true],
        ["red", { R: 1 }, false],
        ["nothing", {}, false],
    ])("the Pay gate with %s floating", (_label, pool, payable) => {
        withTemporaryDefinition(EXTORTER, () => {
            const { cost, chooser } = owedOnTheWire(pool);
            expect(
                mayPayCanAfford(cost, chooser.manaPool, chooser.life, 0)
            ).toBe(payable);
        });
    });
});

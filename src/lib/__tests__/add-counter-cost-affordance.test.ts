// `cost.addCounter` ("Put a -1/-1 counter on this creature", CR 122.1 / 118.1)
// is always affordable (CR 118.3), so the client must NEVER hide it — not on a
// lone toughness-1 body whose counter kills it, and not as a tap-less mana
// ability. Read through the real `projectPublicState` and
// `buildTriggerStateView` reducers, so a field the projection drops fails here.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { preloadDefinitions } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstance, Player } from "~/types/game";
import {
    buildTriggerStateView,
    getManaCostMenuAbility,
    getStackAbilities,
} from "../card-utils";

const STACK_ID = "00000000-0000-4000-8000-000064920021";
const MANA_ID = "00000000-0000-4000-8000-000064920022";

preloadDefinitions([
    {
        id: STACK_ID,
        name: "Synthetic Client Counter Payer",
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        power: 0,
        toughness: 1,
        activatedAbilities: [
            {
                id: "client-counter-gain",
                oracleText:
                    "Put a -1/-1 counter on this creature: You gain 3 life.",
                cost: { addCounter: { type: "-1/-1", count: 1 } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        id: MANA_ID,
        name: "Synthetic Client Counter Mana",
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        power: 0,
        toughness: 1,
        activatedAbilities: [
            {
                id: "client-counter-mana",
                oracleText: "Put a -0/-1 counter on this creature: Add {G}.",
                cost: { addCounter: { type: "-0/-1", count: 1 } },
                useStack: false,
                manaProduced: { G: 1 },
                effects: [
                    { op: "addMana", player: "controller", mana: { G: 1 } },
                ],
            },
        ],
    } as CardDefinition,
]);

function projected(cardId: string) {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(cardId, {
                        id: "src",
                        controllerId: "p1",
                        ownerId: "p1",
                        isSummoningSick: false,
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const players = (
        projectPublicState(state, 1, "p1") as unknown as { players: Player[] }
    ).players;
    const source = players[0].battlefield.find(
        (c) => c.id === "src"
    ) as unknown as CardInstance;
    const view = buildTriggerStateView(players as never, "p1");
    return { source, view };
}

describe("cost.addCounter — client affordance (CR 118.3)", () => {
    it("offers a stack ability whose counter would kill the source", () => {
        const { source, view } = projected(STACK_ID);
        const ids = getStackAbilities(source, undefined, true, view, 20).map(
            (a) => a.id
        );
        expect(ids).toEqual(["client-counter-gain"]);
    });

    it("offers the tap-less mana ability in the mana menu", () => {
        const { source, view } = projected(MANA_ID);
        expect(getManaCostMenuAbility(source, view)?.id).toBe(
            "client-counter-mana"
        );
    });
});

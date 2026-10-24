// `cost.exileFromGraveyard.destination: "library-bottom"` (CR 401.4, 118.3,
// 602.2b): "Put N cards from your graveyard on the bottom of your library" as
// an activation cost — the picker, affordability and single-graveyard rule of
// the exile cost, with a different commit destination. Driven through the real
// entry points (`activateAbilityOnState`, `selectActivationExileCostOnState`)
// never a hand-built verdict. The Bot's search slice is in
// `graveyardCostLibraryBottom.bot.test.ts`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { ActivatedAbility, CardDefinition } from "../../cards/types";
import {
    activateAbilityOnState,
    selectActivationExileCostOnState,
} from "../../game";
import { payGraveyardCostCards, type GameState } from "../state";

const ABILITY_ID = "bottom-cost-ability";

function variant(destination: "library-bottom" | undefined): CardDefinition {
    const base = getCardByName("Grim Lavamancer");
    const ability: ActivatedAbility = {
        id: ABILITY_ID,
        oracleText:
            "Put two cards from your graveyard on the bottom of your library: This creature gets +3/+3 until end of turn.",
        cost: {
            exileFromGraveyard: {
                count: 2,
                owner: "you",
                ...(destination ? { destination } : {}),
            },
        },
        useStack: true,
        effects: [
            {
                op: "pump",
                target: { ref: "$source" },
                power: 3,
                toughness: 3,
                duration: { phase: "end-of-turn" },
            },
        ],
    };
    return { ...base, activatedAbilities: [ability] };
}

function board(): GameState {
    const source = makeInstance(getCardByName("Grim Lavamancer").id, {
        id: "src",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const gy = (id: string) =>
        makeInstance(getCardByName("Grizzly Bears").id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
    const lib = (id: string) =>
        makeInstance(getCardByName("Grizzly Bears").id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [source],
                graveyard: [gy("g1"), gy("g2"), gy("g3")],
                library: [lib("l1"), lib("l2")],
            }),
            makePlayer("p2"),
        ],
    });
}

describe("library-bottom graveyard cost (CR 401.4, 118.3)", () => {
    it("puts the picked cards on the bottom of the library, in picked order, while the ability waits on the stack", () => {
        withTemporaryDefinition(variant("library-bottom"), () => {
            const state = board();
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: ABILITY_ID,
            });
            selectActivationExileCostOnState(state, {
                playerId: "p1",
                graveyardOwnerId: "p1",
                cardInstanceIds: ["g3", "g1"],
            });
            const me = state.players[0]!;
            expect(state.stack).toHaveLength(1);
            expect(me.graveyard.map((c) => c.id)).toEqual(["g2"]);
            expect(me.library.map((c) => c.id)).toEqual([
                "l1",
                "l2",
                "g3",
                "g1",
            ]);
            expect(me.exile).toHaveLength(0);
        });
    });

    it("without a destination the same cost still exiles (the Grim Lavamancer behaviour)", () => {
        withTemporaryDefinition(variant(undefined), () => {
            const state = board();
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: ABILITY_ID,
            });
            selectActivationExileCostOnState(state, {
                playerId: "p1",
                graveyardOwnerId: "p1",
                cardInstanceIds: ["g3", "g1"],
            });
            const me = state.players[0]!;
            expect(me.exile.map((c) => c.id)).toEqual(["g3", "g1"]);
            expect(me.library.map((c) => c.id)).toEqual(["l1", "l2"]);
        });
    });

    it("emits ONE library-entry event for the group (CR 603.2c)", () => {
        const state = board();
        const me = state.players[0]!;
        payGraveyardCostCards(state, me, ["g1", "g2"], "library-bottom");
        const events = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARDS_PUT_INTO_LIBRARY"
        );
        expect(events).toHaveLength(1);
    });
});

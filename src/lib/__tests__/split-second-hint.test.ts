// Split second's client hint (CR 702.61a, issue #4007): the real reducer, then the
// lock `board.tsx` forwards, then the three ability menus. A hand-built view would
// keep passing if `projectPublicState` dropped the stack item's `staticAbilities`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { nonManaActivationLockedPlayers } from "@convex/cards/abilities/splitSecond";
import { registerTokenDefinition } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstance } from "~/types/game";
import {
    buildTriggerStateView,
    getGraveyardStackAbilities,
    getHandStackAbilities,
    getStackAbilities,
} from "../card-utils";

const SPLIT_SECOND_SPELL = "test:hint-split-second-instant";
registerTokenDefinition({
    id: SPLIT_SECOND_SPELL,
    rarity: "common",
    name: "Test Hint Split Second Instant",
    manaCost: {},
    types: ["Instant"],
    staticAbilities: ["split second"],
    resolve: () => {},
});
const PLAIN_SPELL = "test:hint-plain-instant";
registerTokenDefinition({
    id: PLAIN_SPELL,
    rarity: "common",
    name: "Test Hint Plain Instant",
    manaCost: {},
    types: ["Instant"],
    resolve: () => {},
});
const ZONE_ABILITIES = "test:hint-zone-abilities";
registerTokenDefinition({
    id: ZONE_ABILITIES,
    rarity: "common",
    name: "Test Hint Zone Abilities",
    manaCost: {},
    types: ["Creature"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "from-battlefield",
            oracleText: "Pay 1 life: Draw a card.",
            useStack: true,
            cost: { life: 1 },
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
        {
            id: "from-hand",
            oracleText: "Pay 1 life: Draw a card.",
            useStack: true,
            activateFromHand: true,
            cost: { life: 1 },
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
        {
            id: "from-graveyard",
            oracleText: "Pay 1 life: Draw a card.",
            useStack: true,
            activateFromGraveyard: true,
            cost: { life: 1 },
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
});

const own = (id: string, zone: "hand" | "battlefield" | "graveyard") =>
    makeInstance(ZONE_ABILITIES, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
        isSummoningSick: false,
    });

/** What each menu offers the viewer, read through the wire. */
function offered(stacked: string) {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [own("perm", "battlefield")],
                hand: [own("held", "hand")],
                graveyard: [own("buried", "graveyard")],
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, stacked, "p2");
    const wire = projectPublicState(state, 1, "p1");
    const view = buildTriggerStateView(
        wire.players as never,
        "p1",
        nonManaActivationLockedPlayers(wire)
    );
    const me = wire.players[0];
    const ids = (rows: { id: string }[]) => rows.map((a) => a.id);
    return {
        battlefield: ids(
            getStackAbilities(
                me.battlefield[0] as unknown as CardInstance,
                "PRECOMBAT_MAIN",
                true,
                view
            )
        ),
        hand: ids(
            getHandStackAbilities(
                me.hand[0] as unknown as CardInstance,
                "PRECOMBAT_MAIN",
                view
            )
        ),
        graveyard: ids(
            getGraveyardStackAbilities(
                me.graveyard[0] as unknown as CardInstance,
                "PRECOMBAT_MAIN",
                view
            )
        ),
    };
}

describe("split second hides non-mana abilities on the client (CR 702.61a)", () => {
    it("hides them in every zone while the spell is on the stack", () => {
        expect(offered(SPLIT_SECOND_SPELL)).toEqual({
            battlefield: [],
            hand: [],
            graveyard: [],
        });
    });

    it("offers them over a spell without the keyword", () => {
        expect(offered(PLAIN_SPELL)).toEqual({
            battlefield: ["from-battlefield"],
            hand: ["from-hand"],
            graveyard: ["from-graveyard"],
        });
    });
});

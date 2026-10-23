// CR 604.3 / 607.2a — a CDA totalling the cards exiled with its source
// (`exiled-with-source-totals`, Sutured Ghoul's clause) must read the same
// number on the server, after `projectPublicState`, and through the client's
// `effectivePower` / `effectiveToughness` (`toLayerState` forwarding `exile`).

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName, registerTokenDefinition } from "@convex/cards";
import { resolveCompiledStatic } from "@convex/cards/compiledStatics";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getEffectivePower, getEffectiveToughness } from "@convex/gre/layers";
import { effectivePower, effectiveToughness } from "../effective-stats";
import type { CardInstance } from "~/types/game";

const GHOUL_ID = "exiled-totals-cda-source";
registerTokenDefinition({
    id: GHOUL_ID,
    name: "Test Exiled Totals Source",
    rarity: "common",
    manaCost: { generic: 7 },
    types: ["Creature"],
    power: 0,
    toughness: 0,
    staticEffects: [
        resolveCompiledStatic({
            kind: "pt-cda",
            appliesTo: "self",
            count: { kind: "exiled-with-source-totals" },
        }),
    ],
});

const BEARS = getCardByName("Grizzly Bears").id; // 2/2
const SORCERER = getCardByName("Prodigal Sorcerer").id; // 1/1

function board() {
    const ghoul = makeInstance(BEARS, {
        id: "ghoul",
        controllerId: "p1",
        ownerId: "p1",
    });
    ghoul.card = { id: GHOUL_ID };
    ghoul.power = 0;
    ghoul.toughness = 0;
    const linkedBears = makeInstance(BEARS, {
        id: "linked-bears",
        zone: "exile",
        controllerId: "p1",
        ownerId: "p1",
        exiledBySourceId: "ghoul",
    });
    const linkedSorcerer = makeInstance(SORCERER, {
        id: "linked-sorcerer",
        zone: "exile",
        controllerId: "p1",
        ownerId: "p1",
        exiledBySourceId: "ghoul",
    });
    // Unequal halves, so a swapped power/toughness total cannot pass.
    linkedSorcerer.toughness = 4;
    // Exiled by something else: not "the exiled cards" (CR 607.2a).
    const stranger = makeInstance(BEARS, {
        id: "stranger",
        zone: "exile",
        controllerId: "p2",
        ownerId: "p2",
        exiledBySourceId: "other-source",
    });
    return {
        ghoul,
        state: makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ghoul],
                    exile: [linkedBears, linkedSorcerer],
                }),
                makePlayer("p2", { exile: [stranger] }),
            ],
        }),
    };
}

describe("exiled-with-source-totals CDA (CR 604.3, 607.2a)", () => {
    it("totals the linked pile's power and toughness separately, server-side", () => {
        const { state, ghoul } = board();
        const layer = state as unknown as Parameters<
            typeof getEffectivePower
        >[0];
        expect(getEffectivePower(layer, ghoul as never)).toBe(3);
        expect(getEffectiveToughness(layer, ghoul as never)).toBe(6);
    });

    it("reads the same totals on the client after projectPublicState", () => {
        const { state } = board();
        const wire = projectPublicState(state, 1, "p1");
        const ghoul = wire.players[0]!.battlefield.find(
            (c) => c.id === "ghoul"
        ) as unknown as CardInstance;
        const players = wire.players as unknown as Parameters<
            typeof effectivePower
        >[0];
        expect(
            effectivePower(players, ghoul, wire.emblems, wire.continuousEffects)
        ).toBe(3);
        expect(
            effectiveToughness(
                players,
                ghoul,
                wire.emblems,
                wire.continuousEffects
            )
        ).toBe(6);
    });

    it("is 0/0 with no linked pile", () => {
        const { state, ghoul } = board();
        for (const p of state.players) p.exile = [];
        const layer = state as unknown as Parameters<
            typeof getEffectivePower
        >[0];
        expect(getEffectivePower(layer, ghoul as never)).toBe(0);
    });
});

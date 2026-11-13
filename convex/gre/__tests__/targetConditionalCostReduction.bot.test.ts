// CR 601.2f — the Bot's move list must not offer a target-conditional self cost
// reduction against a target that does not earn it: its tap plan is priced
// without targets, so the cast would park unpayable at the commit.
// Mystical Dispute: "This spell costs {2} less to cast if it targets a blue spell."

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { mysticalDispute } from "../../cards/sets/eld/blue.cards";
import { counterspell } from "../../cards/sets/lea/blue.cards";
import { lightningBolt } from "../../cards/sets/lea/red.cards";
import { island } from "../../cards/sets/lea/colorless.cards";
import { preloadDefinitions } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";

preloadDefinitions([mysticalDispute()]);

describe("Mystical Dispute — Bot enumeration with a target-conditional reduction (CR 601.2f)", () => {
    it("with one Island, offers Dispute only against the blue spell", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(mysticalDispute().id, {
                            id: "dispute",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(island().id, {
                            id: "island-0",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        pushSpell(state, counterspell().id, "p2").id = "blue-spell";
        pushSpell(state, lightningBolt().id, "p2").id = "red-spell";

        const targeted = enumerateMoves(state, "p1")
            .filter(
                (m) => m.kind === "cast-spell" && m.cardInstanceId === "dispute"
            )
            .flatMap((m) => (m.kind === "cast-spell" ? m.targets : []))
            .map((t) => t.id);

        expect(targeted).toEqual(["blue-spell"]);
    });
});

// CR 601.2f — the Bot's move list must price a target-conditional self cost
// reduction per target: a target that does not earn it is offered at the FULL
// cost (never the reduced one, which would park unpayable at the commit), and
// never dropped while the full cost is affordable (issue #10514).
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

function disputeState(islands: number) {
    return makeState({
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
                battlefield: Array.from({ length: islands }, (_, i) =>
                    makeInstance(island().id, {
                        id: `island-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p2",
        priorityPlayerId: "p1",
    });
}

/** Each offered Dispute cast as `target → lands tapped`. */
function disputeCasts(state: ReturnType<typeof makeState>) {
    return enumerateMoves(state, "p1").flatMap((m) =>
        m.kind === "cast-spell" && m.cardInstanceId === "dispute"
            ? [`${m.targets[0]?.id} → ${m.tapPlan.length}`]
            : []
    );
}

describe("Mystical Dispute — Bot enumeration with a target-conditional reduction (CR 601.2f)", () => {
    it("with one Island, offers Dispute only against the blue spell", () => {
        const state = disputeState(1);
        pushSpell(state, counterspell().id, "p2").id = "blue-spell";
        pushSpell(state, lightningBolt().id, "p2").id = "red-spell";

        expect(disputeCasts(state)).toEqual(["blue-spell → 1"]);
    });

    it("with no blue spell on the stack, offers Dispute at its full cost", () => {
        const state = disputeState(3);
        pushSpell(state, lightningBolt().id, "p2").id = "red-spell";

        expect(disputeCasts(state)).toEqual(["red-spell → 3"]);
    });

    it("with a blue and a red spell, prices each target at its own total", () => {
        const state = disputeState(3);
        pushSpell(state, counterspell().id, "p2").id = "blue-spell";
        pushSpell(state, lightningBolt().id, "p2").id = "red-spell";

        expect(disputeCasts(state).sort()).toEqual([
            "blue-spell → 1",
            "red-spell → 3",
        ]);
    });
});

// Frontend wiring (SURFACE) test for the Emerge cast-option picker affordance
// (CR 702.119, issue #3218). `affordableAltCostsForCard` (src/lib/card-utils.ts)
// is the gate `useHandCardCommit` consults to open the `AltCostPicker`; it
// delegates to the server predicate `affordableAlternativeCosts`, which now
// also folds in `CardDefinition.emerge`. Emerge's offer depends on the BOARD —
// "emerge from artifact" needs an artifact permanent to sacrifice (CR
// 702.119b) — so the assertion runs on the projected battlefield, through
// `projectPublicState`: a projection that dropped a permanent's types would
// hide the option. No emerge card ships yet (Crabomination waits on issue
// #1702), so a SYNTHETIC probe exercises the reducer, the
// `dash-alt-cost.test.ts` precedent.

import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import {
    solRing,
    grizzlyBears,
    swamp,
} from "@convex/cards/sets/lea/index.cards";
import { drought } from "@convex/cards/sets/ice/white.cards";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const EMERGE_PROBE_ID = "test:emerge-alt-cost-probe";
const emergeProbe: CardDefinition = {
    id: EMERGE_PROBE_ID,
    rarity: "common",
    name: "Emerge Alt-Cost Probe",
    manaCost: { X: 4, B: 2 },
    emerge: {
        id: "emerge",
        description: "Emerge from artifact {5}{B}{B}",
        mana: { X: 5, B: 2 },
        permanent: {
            action: "sacrifice",
            count: 1,
            filter: { types: "Artifact" },
        },
    },
    types: ["Creature"],
    subtypes: ["Crab", "Demon"],
    power: 5,
    toughness: 5,
};
registerTokenDefinition(emergeProbe);

const EMERGE_FROM_SWAMP_PROBE_ID = "test:emerge-from-swamp-alt-cost-probe";
registerTokenDefinition({
    ...emergeProbe,
    id: EMERGE_FROM_SWAMP_PROBE_ID,
    name: "Emerge From Swamp Alt-Cost Probe",
    emerge: {
        ...emergeProbe.emerge!,
        description: "Emerge from Swamp {5}{B}{B}",
        permanent: {
            action: "sacrifice",
            count: 1,
            filter: { subtypes: "Swamp" },
        },
    },
});

function emergeOptionOffered(
    permanentCardId: string,
    others: string[] = [],
    probeId: string = EMERGE_PROBE_ID
): boolean {
    const probeInst = makeInstance(probeId, {
        id: "probe",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const permanent = makeInstance(permanentCardId, {
        id: "permanent",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [probeInst],
                battlefield: [
                    permanent,
                    ...others.map((cardId, i) =>
                        makeInstance(cardId, {
                            id: `other-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const projected = projectPublicState(state, 1, "p1") as unknown as {
        players: Player[];
        activePlayerId: string;
    };
    const probeCard = projected.players[0].hand.find(
        (c) => c?.id === "probe"
    ) as CardInstance;
    return affordableAltCostsForCard(
        probeCard,
        "p1",
        projected.players,
        projected.activePlayerId
    ).some((a) => a.id === "emerge");
}

describe("affordableAltCostsForCard — Emerge cast-option picker gate (CR 702.119b)", () => {
    it("offers emerge from artifact through the projected view when an artifact can be sacrificed", () => {
        expect(emergeOptionOffered(solRing().id)).toBe(true);
    });

    it("withholds it when the only permanent is not an artifact", () => {
        expect(emergeOptionOffered(grizzlyBears().id)).toBe(false);
    });

    // CR 118.9d / 601.2f — the probe's {B}{B} owes two Swamps under Drought. An
    // emerge leg that also takes a Swamp owes a third, though two Swamps pass
    // each half alone, so the picker prices the two costs together.
    it("offers an emerge from Swamp under Drought when the Swamps cover the leg and the tax", () => {
        expect(
            emergeOptionOffered(
                swamp().id,
                [drought().id, swamp().id, swamp().id],
                EMERGE_FROM_SWAMP_PROBE_ID
            )
        ).toBe(true);
    });

    it("withholds it when two Swamps cover each half but not the whole", () => {
        expect(
            emergeOptionOffered(
                swamp().id,
                [drought().id, swamp().id],
                EMERGE_FROM_SWAMP_PROBE_ID
            )
        ).toBe(false);
    });
});

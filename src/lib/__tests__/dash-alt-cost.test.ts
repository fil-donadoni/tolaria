// Frontend wiring (SURFACE) test for the Dash cast-option picker affordance
// (CR 702.109, issue #1314). Mirrors `alt-cost-affordability.test.ts`'s
// pattern exactly: `affordableAltCostsForCard` (src/lib/card-utils.ts) is the
// gate `useHandCardCommit` consults to decide whether to open the
// `AltCostPicker`; it delegates to the server predicate
// `affordableAlternativeCosts`, which now also folds in `CardDefinition.dash`
// (mirroring `evoke`). No dash card ships in the catalogue yet (the sole
// candidate, Death-Greeter's Champion, is blocked on Backup — a separate
// ticket), so a SYNTHETIC probe card exercises the reducer end-to-end, the
// same "no shipped card yet" precedent `convex/gre/__tests__/dash.test.ts`
// documents for the GRE side.
//
// The assertion is driven THROUGH the wire reducer: state is projected via
// `projectPublicState` first, then the gate runs on the projected players. A
// hand-built view would mask a field the projection strips — this is the
// class of bug the frontend-wiring rule guards.

import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const DASH_PROBE_ID = "test:dash-alt-cost-probe";
const dashProbe: CardDefinition = {
    id: DASH_PROBE_ID,
    rarity: "common",
    name: "Dash Alt-Cost Probe",
    manaCost: { X: 5, R: 1 },
    dash: { id: "dash", description: "Dash {R}", mana: { R: 1 } },
    types: ["Creature"],
    subtypes: ["Warrior"],
    power: 2,
    toughness: 2,
};
registerTokenDefinition(dashProbe);

describe("affordableAltCostsForCard — Dash cast-option picker gate (CR 702.109)", () => {
    it("offers the dash variant through the projected view (client reducer sees it)", () => {
        const probeInst = makeInstance(DASH_PROBE_ID, {
            id: "probe",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [probeInst] }),
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
        const altIds = affordableAltCostsForCard(
            probeCard,
            "p1",
            projected.players,
            projected.activePlayerId
        ).map((a) => a.id);
        expect(altIds).toContain("dash");
    });
});

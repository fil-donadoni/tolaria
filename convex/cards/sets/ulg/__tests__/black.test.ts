// ULG (Urza's Legacy) — black: Unearth (issue #689). {B} Sorcery: "Return
// target creature card with mana value 3 or less from your graveyard to the
// battlefield." plus Cycling {2} (CR 702.29). Cycling is exercised in
// convex/gre/__tests__/cycling.test.ts; this covers Unearth's on-resolution
// reanimation and the CR 601.2c mvFilter target legality.

import { describe, it, expect } from "vitest";
import { unearth } from "../black";
import { grizzlyBears, crawWurm } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

describe("Unearth (CR 400.7 reanimation, CR 601.2c mvFilter, CR 702.29 Cycling)", () => {
    it("returns a target creature card with MV<=3 from your graveyard to the battlefield", () => {
        // Grizzly Bears is {1}{G} — mana value 2 (CR 202.3), a legal target.
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bears] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unearth.id, "p1", [
            { type: "graveyard-card", id: "bears", playerId: "p1" },
        ]);
        resolveTopOfStack(state);

        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated!.controllerId).toBe("p1");
        expect(state.players[0].graveyard.some((c) => c.id === "bears")).toBe(
            false
        );

        // Wire format: the reanimated creature crosses projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "bears")
        ).toBe(true);
    });

    it("cannot target a creature card with mana value greater than 3 (CR 601.2c)", () => {
        // Craw Wurm is {4}{G}{G} — mana value 6, above the ceiling.
        const wurm = makeInstance(crawWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [wurm, bears] }),
                makePlayer("p2"),
            ],
        });
        const legal = getLegalTargets(
            state,
            unearth.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const legalIds = legal.map((t) =>
            t.type === "graveyard-card" ? t.id : ""
        );
        expect(legalIds).toContain("bears");
        expect(legalIds).not.toContain("wurm");
    });

    it("has Cycling {2}", () => {
        const cycling = unearth.activatedAbilities?.find(
            (a) => a.id === "cycling"
        );
        expect(cycling?.activateFromHand).toBe(true);
        expect(cycling?.cost.mana).toEqual({ generic: 2 });
    });
});

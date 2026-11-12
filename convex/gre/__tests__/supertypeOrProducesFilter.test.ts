// Break the Ice — "Destroy target land that is snow or could produce {C}."
// CR 205.4a (live supertype) / CR 106.7 ("could produce" as a mana TYPE).
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { breakTheIce } from "../../cards/sets/mh2/index.cards";
import { forest } from "../../cards/sets/lea/index.cards";
import { stripMine } from "../../cards/sets/atq/index.cards";
import { snowCoveredForest } from "../../cards/sets/ice/index.cards";
import {
    getLegalTargets,
    NO_TARGETING_SOURCE,
    pendingTargetFiltersFromRequirement,
} from "../rules";
import { permanentFilterValuesFromCarrier } from "../targetFilters";
import { resolveTopOfStack } from "../state";
import type { PendingTarget } from "../state";

function board() {
    const plainForest = makeInstance(forest().id, {
        id: "forest",
        controllerId: "p2",
    });
    const snowForest = makeInstance(snowCoveredForest().id, {
        id: "snow-forest",
        controllerId: "p2",
    });
    const colorless = makeInstance(stripMine().id, {
        id: "strip-mine",
        controllerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [plainForest, snowForest, colorless],
            }),
        ],
    });
    return { state };
}

describe("Break the Ice target filter (CR 205.4a / 106.7)", () => {
    const req = breakTheIce().targetRequirement!;

    it("offers snow lands and {C}-producing lands, not a plain Forest", () => {
        const { state } = board();
        const ids = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1").map(
            (t) => t.id
        );
        expect(ids.sort()).toEqual(["snow-forest", "strip-mine"]);
    });

    it("carries the filter onto the PendingTarget, so selectTarget re-checks the same set", () => {
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.supertypeOrProducesFilter).toEqual({
            supertype: "Snow",
            produces: "C",
        });
        expect(
            permanentFilterValuesFromCarrier(pt as PendingTarget)
                .supertypeOrProducesFilter
        ).toEqual({ supertype: "Snow", produces: "C" });
    });

    it("destroys the chosen land on resolution", () => {
        const { state } = board();
        pushSpell(state, breakTheIce().id, "p1", [
            { type: "permanent", id: "strip-mine" },
        ]);
        resolveTopOfStack(state);
        const battlefield = state.players[1].battlefield.map((c) => c.id);
        expect(battlefield).not.toContain("strip-mine");
        expect(battlefield).toContain("forest");
    });
});

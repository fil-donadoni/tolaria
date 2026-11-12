// Issue #9326 — which cards of a zone the stack targets, and by what.
import { describe, it, expect } from "vitest";
import { zoneTargetSources } from "../zone-target-sources";
import type { StackItem } from "~/types/game";

const item = (id: string, targets: StackItem["targets"]) =>
    ({ id, card: { id: "def" }, targets }) as unknown as StackItem;

describe("zoneTargetSources", () => {
    const reanimate = item("s1", [
        { type: "graveyard-card", id: "elf-2", playerId: "p2" },
    ]);
    const deathrite = item("s2", [
        { type: "graveyard-card", id: "elf-2", playerId: "p2" },
        { type: "graveyard-card", id: "swamp", playerId: "p1" },
    ]);
    const bolt = item("s3", [{ type: "player", id: "p2" }]);

    it("maps each targeted card of THIS owner's graveyard to every object targeting it", () => {
        const m = zoneTargetSources(
            [reanimate, deathrite, bolt],
            "p2",
            "graveyard"
        );
        expect([...m.keys()]).toEqual(["elf-2"]);
        expect(m.get("elf-2")!.map((s) => s.id)).toEqual(["s1", "s2"]);
    });

    it("an untargeted graveyard is empty — its viewer shows no numbers", () => {
        expect(zoneTargetSources([bolt], "p2", "graveyard").size).toBe(0);
    });

    it("exile has no target type yet: always empty", () => {
        expect(zoneTargetSources([reanimate], "p2", "exile").size).toBe(0);
    });
});

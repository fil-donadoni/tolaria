import { describe, it, expect } from "vitest";
import {
    getEffectiveBlockGraph,
    damageSourcesForPlayer,
} from "../combat-graph";
import type { Combat } from "~/types/game";

const banded: Combat = {
    attackerIds: ["hero", "bear"],
    confirmed: true,
    blockerAssignments: { blk: ["hero"] },
    blockersConfirmed: true,
    bands: [{ bandId: "b1", memberIds: ["hero", "bear"] }],
};

describe("getEffectiveBlockGraph (client mirror, CR 702.21e)", () => {
    it("expands a single block to every band member", () => {
        const g = getEffectiveBlockGraph(banded);
        expect(g.blockersByAttacker["hero"]).toEqual(["blk"]);
        expect(g.blockersByAttacker["bear"]).toEqual(["blk"]);
        expect(new Set(g.attackersByBlocker["blk"])).toEqual(
            new Set(["hero", "bear"])
        );
    });

    it("reduces to a plain inversion when no bands exist", () => {
        const g = getEffectiveBlockGraph({
            attackerIds: ["a", "c"],
            confirmed: true,
            blockerAssignments: { b1: ["a"], b2: ["c"] },
            blockersConfirmed: true,
        });
        expect(g.blockersByAttacker["a"]).toEqual(["b1"]);
        expect(g.blockersByAttacker["c"]).toEqual(["b2"]);
        expect(g.attackersByBlocker["b1"]).toEqual(["a"]);
    });
});

describe("damageSourcesForPlayer", () => {
    it("returns the sources a player must assign", () => {
        const combat: Combat = {
            ...banded,
            damageAssignerIds: { blk: "p1", atk: "p2" },
        };
        expect(damageSourcesForPlayer(combat, "p1")).toEqual(["blk"]);
        expect(damageSourcesForPlayer(combat, "p2")).toEqual(["atk"]);
    });

    it("returns empty when there is no authority map", () => {
        expect(damageSourcesForPlayer(banded, "p1")).toEqual([]);
    });
});

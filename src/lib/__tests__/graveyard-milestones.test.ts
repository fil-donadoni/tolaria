import { describe, it, expect } from "vitest";
import {
    countGraveyardTypes,
    computeGraveyardMilestones,
    hasMilestoneWord,
} from "~/lib/graveyard-milestones";
import type { CardInstance } from "~/types/game";

// Minimal graveyard card — only `types` matters to the milestone math.
function gy(types: string[]): CardInstance {
    return {
        id: `c-${Math.random()}`,
        card: { id: "x" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        types,
        isTapped: false,
    } as CardInstance;
}

describe("countGraveyardTypes (delirium, CR 702.D)", () => {
    it("counts DISTINCT card types across the graveyard", () => {
        const graveyard = [
            gy(["Creature"]),
            gy(["Creature"]),
            gy(["Land"]),
            gy(["Sorcery"]),
        ];
        expect(countGraveyardTypes(graveyard)).toBe(3);
    });

    it("counts each type of a multi-type card", () => {
        expect(countGraveyardTypes([gy(["Artifact", "Creature"])])).toBe(2);
    });

    it("is zero for an empty graveyard", () => {
        expect(countGraveyardTypes([])).toBe(0);
    });
});

describe("computeGraveyardMilestones", () => {
    it("delirium is met at 4 distinct types, not at 3 (CR 702.D)", () => {
        const three = computeGraveyardMilestones([
            gy(["Creature"]),
            gy(["Land"]),
            gy(["Sorcery"]),
        ]).get("delirium")!;
        expect(three).toMatchObject({ have: 3, need: 4, met: false });

        const four = computeGraveyardMilestones([
            gy(["Creature"]),
            gy(["Land"]),
            gy(["Sorcery"]),
            gy(["Instant"]),
        ]).get("delirium")!;
        expect(four).toMatchObject({ have: 4, need: 4, met: true });
    });

    it("threshold counts total cards, met at 7 not 6 (CR 702.T)", () => {
        const six = Array.from({ length: 6 }, () => gy(["Creature"]));
        expect(computeGraveyardMilestones(six).get("threshold")).toMatchObject({
            have: 6,
            need: 7,
            met: false,
        });

        const seven = Array.from({ length: 7 }, () => gy(["Creature"]));
        expect(
            computeGraveyardMilestones(seven).get("threshold")
        ).toMatchObject({ have: 7, need: 7, met: true });
    });
});

describe("hasMilestoneWord", () => {
    it("matches the capitalized ability word only", () => {
        expect(hasMilestoneWord("Delirium — deals 6 damage instead")).toBe(
            true
        );
        expect(hasMilestoneWord("Threshold — Add {B}{B} instead")).toBe(true);
    });

    it("ignores plain text without the ability word", () => {
        expect(hasMilestoneWord("Deals 2 damage to target creature")).toBe(
            false
        );
    });
});

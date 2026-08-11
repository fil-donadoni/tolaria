import { describe, it, expect } from "vitest";
import {
    isLegalBandComposition,
    parseBandsWithOtherQuality,
    getBandsWithOtherQualities,
    hasBandsWithOther,
    grantsDamageAssignment,
    matchesBandQuality,
    getDamageAssignerId,
} from "../banding";
import {
    makeInstance,
    makeState,
    makePlayer,
} from "../../cards/__tests__/setup";
import type { CardInstanceState } from "../state";

// Card ids used for quality matching (registry-backed):
//   Hunding Gjornersen — Legendary creature (no banding)
//   Marhault Elsdragon — Legendary creature (no banding)
//   Frost Giant        — non-legendary creature (no banding)
const HUNDING = "07d8e501-6857-4a52-a3b9-2bf0bee5b08c";
const MARHAULT = "67330004-6720-46d9-9de0-c79230110583";
const FROST_GIANT = "6955d54f-7b37-4e43-8183-51677fb1ee11";

/** A creature instance with explicit staticAbilities applied on top of its def. */
function creature(
    cardId: string,
    abilities: string[],
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    const inst = makeInstance(cardId, overrides);
    return { ...inst, staticAbilities: abilities };
}

describe("bands with other [quality] keyword parsing (CR 702.22j)", () => {
    it("parses the legendary quality", () => {
        expect(
            parseBandsWithOtherQuality("bands with other:legendary")
        ).toEqual({ kind: "legendary" });
    });

    it("parses the name quality", () => {
        expect(
            parseBandsWithOtherQuality(
                "bands with other:name=Wolves of the Hunt"
            )
        ).toEqual({ kind: "name", name: "Wolves of the Hunt" });
    });

    it("ignores unrelated keywords", () => {
        expect(parseBandsWithOtherQuality("banding")).toBeUndefined();
        expect(parseBandsWithOtherQuality("flying")).toBeUndefined();
    });

    it("collects every quality on a creature", () => {
        const c = creature(HUNDING, [
            "bands with other:legendary",
            "bands with other:name=Wolves of the Hunt",
            "flying",
        ]);
        expect(getBandsWithOtherQualities(c)).toEqual([
            { kind: "legendary" },
            { kind: "name", name: "Wolves of the Hunt" },
        ]);
    });

    it("hasBandsWithOther detects the variant but not plain banding", () => {
        expect(
            hasBandsWithOther(creature(HUNDING, ["bands with other:legendary"]))
        ).toBe(true);
        expect(hasBandsWithOther(creature(HUNDING, ["banding"]))).toBe(false);
    });
});

describe("matchesBandQuality (CR 702.22j)", () => {
    it("legendary quality matches a legendary creature", () => {
        expect(
            matchesBandQuality(creature(HUNDING, []), { kind: "legendary" })
        ).toBe(true);
    });

    it("legendary quality rejects a non-legendary creature", () => {
        expect(
            matchesBandQuality(creature(FROST_GIANT, []), { kind: "legendary" })
        ).toBe(false);
    });

    it("name quality matches a creature by printed name", () => {
        expect(
            matchesBandQuality(creature(HUNDING, []), {
                kind: "name",
                name: "Hunding Gjornersen",
            })
        ).toBe(true);
        expect(
            matchesBandQuality(creature(HUNDING, []), {
                kind: "name",
                name: "Marhault Elsdragon",
            })
        ).toBe(false);
    });
});

describe("band formation legality (CR 702.22c / 702.22j)", () => {
    it("plain banding: 1 banding + 1 non-banding is legal", () => {
        const members = [
            creature(FROST_GIANT, ["banding"]),
            creature(FROST_GIANT, []),
        ];
        expect(isLegalBandComposition(members)).toBe(true);
    });

    it("plain banding: 2 non-banding is illegal", () => {
        const members = [creature(FROST_GIANT, []), creature(FROST_GIANT, [])];
        expect(isLegalBandComposition(members)).toBe(false);
    });

    it("bands-with-other legendary: all-legendary band is legal", () => {
        const members = [
            creature(HUNDING, ["bands with other:legendary"]),
            creature(MARHAULT, []), // legendary, no banding keyword
        ];
        expect(isLegalBandComposition(members)).toBe(true);
    });

    it("bands-with-other legendary: a non-legendary member makes it illegal", () => {
        const members = [
            creature(HUNDING, ["bands with other:legendary"]),
            creature(FROST_GIANT, []), // NOT legendary
        ];
        // No plain banding, and the non-legendary member fails the quality.
        expect(isLegalBandComposition(members)).toBe(false);
    });

    it("bands-with-other legendary: needs a member that actually grants the keyword", () => {
        const members = [creature(HUNDING, []), creature(MARHAULT, [])];
        // Two bare legendaries, neither has "bands with other" — illegal.
        expect(isLegalBandComposition(members)).toBe(false);
    });

    it("bands-with-other name: two same-named members, one granting, is legal", () => {
        const members = [
            creature(HUNDING, ["bands with other:name=Hunding Gjornersen"]),
            creature(HUNDING, []),
        ];
        expect(isLegalBandComposition(members)).toBe(true);
    });

    it("bands-with-other name: a differently-named member makes it illegal", () => {
        const members = [
            creature(HUNDING, ["bands with other:name=Hunding Gjornersen"]),
            creature(MARHAULT, []),
        ];
        expect(isLegalBandComposition(members)).toBe(false);
    });

    it("a single creature never forms a band", () => {
        expect(
            isLegalBandComposition([
                creature(HUNDING, ["bands with other:legendary"]),
            ])
        ).toBe(false);
    });

    it("three legendaries band when one grants the legendary quality", () => {
        const members = [
            creature(HUNDING, ["bands with other:legendary"]),
            creature(MARHAULT, []),
            creature(MARHAULT, []),
        ];
        expect(isLegalBandComposition(members)).toBe(true);
    });
});

describe("damage-assignment authority (CR 702.22j-k)", () => {
    it("grantsDamageAssignment covers banding and bands-with-other", () => {
        expect(grantsDamageAssignment(creature(FROST_GIANT, ["banding"]))).toBe(
            true
        );
        expect(
            grantsDamageAssignment(
                creature(HUNDING, ["bands with other:legendary"])
            )
        ).toBe(true);
        expect(grantsDamageAssignment(creature(FROST_GIANT, []))).toBe(false);
    });

    it("authority shifts to the controller of a bands-with-other blocker", () => {
        // p1's attacker is blocked by p2's bands-with-other creature.
        const attacker = creature(FROST_GIANT, [], {
            id: "atk",
            controllerId: "p1",
        });
        const blocker = creature(HUNDING, ["bands with other:legendary"], {
            id: "blk",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        // The attacker's combat damage among the banding blocker is assigned by
        // the blocker's controller (p2), not the attacker's controller (p1).
        expect(getDamageAssignerId(state, attacker, ["blk"])).toBe("p2");
    });

    it("no shift when the opposing creature is an ordinary creature", () => {
        const attacker = creature(FROST_GIANT, [], {
            id: "atk",
            controllerId: "p1",
        });
        const blocker = creature(FROST_GIANT, [], {
            id: "blk",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        expect(getDamageAssignerId(state, attacker, ["blk"])).toBe("p1");
    });
});

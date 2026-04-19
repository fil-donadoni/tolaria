import { describe, it, expect } from "vitest";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    mustAttack,
    getRequiredAttackerIds,
} from "../combat";
import type { CardInstanceState } from "../state";
import type { CardType } from "../../cards/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const card = overrides.card ?? { name: "Test Card", types: ["Creature"] };
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card,
        types: overrides.types ?? (card.types as CardType[]) ?? [],
        subtypes:
            (overrides.subtypes as string[]) ??
            (card.subtypes as string[]) ??
            [],
        power: overrides.power ?? (card.power as number | undefined),
        toughness:
            overrides.toughness ?? (card.toughness as number | undefined),
        staticAbilities:
            (overrides.staticAbilities as string[]) ??
            (card.staticAbilities as string[]) ??
            [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// validateAttackerEligibility
// ---------------------------------------------------------------------------

describe("validateAttackerEligibility", () => {
    it("vanilla creature can attack", () => {
        const bears = makeCard({
            card: { name: "Grizzly Bears", types: ["Creature"] },
            types: ["Creature"],
            power: 2,
            toughness: 2,
            staticAbilities: [],
        });
        expect(validateAttackerEligibility(bears)).toEqual({ eligible: true });
    });

    it("creature with defender cannot attack", () => {
        const wall = makeCard({
            card: { name: "Wall of Swords", types: ["Creature"] },
            types: ["Creature"],
            subtypes: ["Wall"],
            power: 3,
            toughness: 5,
            staticAbilities: ["defender", "flying"],
        });
        const result = validateAttackerEligibility(wall);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/defender/i);
        }
    });

    it("tapped creature cannot attack", () => {
        const tapped = makeCard({
            types: ["Creature"],
            power: 2,
            toughness: 2,
            staticAbilities: [],
            isTapped: true,
        });
        const result = validateAttackerEligibility(tapped);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/tapped/i);
        }
    });

    it("creature with summoning sickness cannot attack", () => {
        const sick = makeCard({
            types: ["Creature"],
            power: 2,
            toughness: 2,
            staticAbilities: [],
            isSummoningSick: true,
        });
        const result = validateAttackerEligibility(sick);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/summoning sickness/i);
        }
    });

    it("non-creature cannot attack", () => {
        const land = makeCard({
            card: { name: "Plains", types: ["Land"] },
            types: ["Land"],
            staticAbilities: [],
        });
        const result = validateAttackerEligibility(land);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/creature/i);
        }
    });

    it("defender check takes priority over tapped check", () => {
        const tappedWall = makeCard({
            types: ["Creature"],
            subtypes: ["Wall"],
            power: 0,
            toughness: 7,
            staticAbilities: ["defender"],
            isTapped: true,
        });
        const result = validateAttackerEligibility(tappedWall);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/defender/i);
        }
    });

    it("creature with flying but no defender can attack", () => {
        const serra = makeCard({
            card: { name: "Serra Angel", types: ["Creature"] },
            types: ["Creature"],
            power: 4,
            toughness: 4,
            staticAbilities: ["flying", "vigilance"],
        });
        expect(validateAttackerEligibility(serra)).toEqual({ eligible: true });
    });
});

// ---------------------------------------------------------------------------
// validateBlockerEligibility (CR 509.1b, 702.9, 702.13)
// ---------------------------------------------------------------------------

describe("validateBlockerEligibility — flying (CR 702.9b)", () => {
    it("ground creature cannot block flyer", () => {
        const serra = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const bears = makeCard({ types: ["Creature"], staticAbilities: [] });
        const result = validateBlockerEligibility(serra, bears, [bears]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/flying|reach/i);
        }
    });

    it("creature with reach can block flyer", () => {
        const serra = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const spider = makeCard({
            types: ["Creature"],
            staticAbilities: ["reach"],
        });
        expect(validateBlockerEligibility(serra, spider, [spider])).toEqual({
            eligible: true,
        });
    });

    it("creature with flying can block flyer", () => {
        const serra = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const otherFlyer = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        expect(
            validateBlockerEligibility(serra, otherFlyer, [otherFlyer])
        ).toEqual({
            eligible: true,
        });
    });
});

describe("validateBlockerEligibility — landwalk (CR 702.13b)", () => {
    function makeLand(subtype: string): CardInstanceState {
        return makeCard({ types: ["Land"], subtypes: [subtype] });
    }

    it("swampwalker cannot be blocked when defender controls a Swamp", () => {
        const wraith = makeCard({
            types: ["Creature"],
            staticAbilities: ["swampwalk"],
        });
        const bears = makeCard({ types: ["Creature"], staticAbilities: [] });
        const swamp = makeLand("Swamp");
        const result = validateBlockerEligibility(wraith, bears, [
            bears,
            swamp,
        ]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/Swamp/);
        }
    });

    it("swampwalker can be blocked when defender has no Swamp", () => {
        const wraith = makeCard({
            types: ["Creature"],
            staticAbilities: ["swampwalk"],
        });
        const bears = makeCard({ types: ["Creature"], staticAbilities: [] });
        const forest = makeLand("Forest");
        expect(
            validateBlockerEligibility(wraith, bears, [bears, forest])
        ).toEqual({ eligible: true });
    });

    it("dual land (Bayou) satisfies swampwalk via its Swamp subtype", () => {
        const wraith = makeCard({
            types: ["Creature"],
            staticAbilities: ["swampwalk"],
        });
        const bears = makeCard({ types: ["Creature"], staticAbilities: [] });
        const bayou = makeCard({
            types: ["Land"],
            subtypes: ["Swamp", "Forest"],
        });
        const result = validateBlockerEligibility(wraith, bears, [
            bears,
            bayou,
        ]);
        expect(result.eligible).toBe(false);
    });

    it("landwalk is unblockable regardless of blocker abilities", () => {
        const wraith = makeCard({
            types: ["Creature"],
            staticAbilities: ["swampwalk"],
        });
        const spider = makeCard({
            types: ["Creature"],
            staticAbilities: ["reach", "flying"],
        });
        const swamp = makeLand("Swamp");
        const result = validateBlockerEligibility(wraith, spider, [
            spider,
            swamp,
        ]);
        expect(result.eligible).toBe(false);
    });

    it("forestwalk respects Forest subtype", () => {
        const scout = makeCard({
            types: ["Creature"],
            staticAbilities: ["forestwalk"],
        });
        const bears = makeCard({ types: ["Creature"], staticAbilities: [] });
        const forest = makeLand("Forest");
        const swamp = makeLand("Swamp");
        expect(
            validateBlockerEligibility(scout, bears, [bears, swamp])
        ).toEqual({ eligible: true });
        expect(
            validateBlockerEligibility(scout, bears, [bears, forest]).eligible
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// validateBlockerEligibility — subtype restriction (CR 509.1b)
// ---------------------------------------------------------------------------

describe("validateBlockerEligibility — can't be blocked by Walls (CR 509.1b)", () => {
    it("rejects a Wall blocker against an attacker with the restriction", () => {
        const jug = makeCard({
            types: ["Creature"],
            staticAbilities: ["cant-be-blocked-by-wall"],
        });
        const wall = makeCard({
            types: ["Creature"],
            subtypes: ["Wall"],
            staticAbilities: ["defender"],
        });
        const result = validateBlockerEligibility(jug, wall, [wall]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/Wall/);
    });

    it("allows non-Wall blockers", () => {
        const jug = makeCard({
            types: ["Creature"],
            staticAbilities: ["cant-be-blocked-by-wall"],
        });
        const bears = makeCard({ types: ["Creature"], staticAbilities: [] });
        expect(validateBlockerEligibility(jug, bears, [bears])).toEqual({
            eligible: true,
        });
    });

    it("stacks with flying when both apply", () => {
        const flyingJug = makeCard({
            types: ["Creature"],
            staticAbilities: ["cant-be-blocked-by-wall", "flying"],
        });
        const groundWall = makeCard({
            types: ["Creature"],
            subtypes: ["Wall"],
            staticAbilities: ["defender"],
        });
        const flyer = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        expect(
            validateBlockerEligibility(flyingJug, groundWall, [
                groundWall,
                flyer,
            ]).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(flyingJug, flyer, [groundWall, flyer])
        ).toEqual({ eligible: true });
    });
});

// ---------------------------------------------------------------------------
// mustAttack / getRequiredAttackerIds (CR 508.1d)
// ---------------------------------------------------------------------------

describe("mustAttack / getRequiredAttackerIds (CR 508.1d)", () => {
    it("eligible creature with attacks-if-able must attack", () => {
        const jug = makeCard({
            types: ["Creature"],
            staticAbilities: ["attacks-if-able"],
        });
        expect(mustAttack(jug)).toBe(true);
    });

    it("tapped creature with attacks-if-able is not required (can't attack)", () => {
        const jug = makeCard({
            types: ["Creature"],
            staticAbilities: ["attacks-if-able"],
            isTapped: true,
        });
        expect(mustAttack(jug)).toBe(false);
    });

    it("summoning-sick creature with attacks-if-able is not required", () => {
        const jug = makeCard({
            types: ["Creature"],
            staticAbilities: ["attacks-if-able"],
            isSummoningSick: true,
        });
        expect(mustAttack(jug)).toBe(false);
    });

    it("creature with defender + attacks-if-able is not required", () => {
        const brick = makeCard({
            types: ["Creature"],
            staticAbilities: ["attacks-if-able", "defender"],
        });
        expect(mustAttack(brick)).toBe(false);
    });

    it("getRequiredAttackerIds filters out ineligible required attackers", () => {
        const jugA = makeCard({
            id: "a",
            types: ["Creature"],
            staticAbilities: ["attacks-if-able"],
        });
        const jugB = makeCard({
            id: "b",
            types: ["Creature"],
            staticAbilities: ["attacks-if-able"],
            isTapped: true,
        });
        const bears = makeCard({ id: "c", types: ["Creature"] });
        expect(getRequiredAttackerIds([jugA, jugB, bears])).toEqual(["a"]);
    });
});

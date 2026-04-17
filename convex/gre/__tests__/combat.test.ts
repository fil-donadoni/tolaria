import { describe, it, expect } from "vitest";
import { validateAttackerEligibility } from "../combat";
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

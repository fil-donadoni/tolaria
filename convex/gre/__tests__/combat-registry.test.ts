import { describe, it, expect } from "vitest";
import { evaluateBlockerKeywords, EVASION_RULES } from "../combat-registry";
import type { CardInstanceState } from "../state";
import type { CardType } from "../../cards/types";

// ---------------------------------------------------------------------------
// Synthetic fixture — slim card shape, no registry dependency
// ---------------------------------------------------------------------------

function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const cardRef = overrides.card as { id?: string } | undefined;
    const id = cardRef?.id ?? `synth-${crypto.randomUUID()}`;
    const rest: Partial<CardInstanceState> = { ...overrides };
    delete rest.card;
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: { id },
        types: (overrides.types as CardType[]) ?? [],
        subtypes: (overrides.subtypes as string[]) ?? [],
        power: overrides.power,
        toughness: overrides.toughness,
        staticAbilities: (overrides.staticAbilities as string[]) ?? [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...rest,
    };
}

// ---------------------------------------------------------------------------
// Registry structure
// ---------------------------------------------------------------------------

describe("EVASION_RULES registry", () => {
    it("contains flying as the sole entry", () => {
        expect(EVASION_RULES).toHaveLength(1);
        expect(EVASION_RULES[0].keyword).toBe("flying");
        expect(EVASION_RULES[0].cr).toBe("702.9b");
    });
});

// ---------------------------------------------------------------------------
// evaluateBlockerKeywords — flying (CR 702.9b)
// ---------------------------------------------------------------------------

describe("evaluateBlockerKeywords — flying (CR 702.9b)", () => {
    it("ground creature cannot block flyer", () => {
        const flyer = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const ground = makeCard({
            types: ["Creature"],
            staticAbilities: [],
        });
        const result = evaluateBlockerKeywords(flyer, ground, [ground]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/flying/i);
        }
    });

    it("creature with flying can block flyer", () => {
        const attacker = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const blocker = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        expect(evaluateBlockerKeywords(attacker, blocker, [blocker])).toEqual({
            eligible: true,
        });
    });

    it("creature with reach can block flyer (CR 702.9b)", () => {
        const attacker = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const reacher = makeCard({
            types: ["Creature"],
            staticAbilities: ["reach"],
        });
        expect(evaluateBlockerKeywords(attacker, reacher, [reacher])).toEqual({
            eligible: true,
        });
    });

    it("non-flying attacker is not restricted by flying rule", () => {
        const ground = makeCard({
            types: ["Creature"],
            staticAbilities: [],
        });
        const blocker = makeCard({
            types: ["Creature"],
            staticAbilities: [],
        });
        expect(evaluateBlockerKeywords(ground, blocker, [blocker])).toEqual({
            eligible: true,
        });
    });

    it("flying + reach blocker can block flyer", () => {
        const flyer = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const flyReach = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying", "reach"],
        });
        expect(evaluateBlockerKeywords(flyer, flyReach, [flyReach])).toEqual({
            eligible: true,
        });
    });
});

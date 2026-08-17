import { describe, it, expect } from "vitest";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
    EVASION_RULES,
    ATTACK_RESTRICTION_RULES,
} from "../combatRegistry";
import type { CardInstanceState } from "../state";
import type { CardType, ManaCost } from "../../cards/types";

// ---------------------------------------------------------------------------
// Synthetic fixture — slim card shape, no registry dependency.
// Supports an optional `manaCost` on the card ref so `hasColor` (via
// STATIC_EFFECT_CTX.getColors) can derive colors without hitting the
// card registry.
// ---------------------------------------------------------------------------

function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: { id?: string; manaCost?: ManaCost };
    } = {}
): CardInstanceState {
    const cardRef = overrides.card;
    const id = cardRef?.id ?? `synth-${crypto.randomUUID()}`;
    const rest: Partial<CardInstanceState> = { ...overrides };
    delete rest.card;
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: {
            id,
            ...(cardRef?.manaCost ? { manaCost: cardRef.manaCost } : {}),
        },
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
    it("contains 16 entries: unblockable + 6 landwalk + legendary landwalk + 5 snow landwalk + fear + flying + shadow", () => {
        expect(EVASION_RULES).toHaveLength(16);
        const keywords = EVASION_RULES.map((r) => r.keyword);
        expect(keywords).toContain("unblockable");
        expect(keywords).toContain("plainswalk");
        expect(keywords).toContain("islandwalk");
        expect(keywords).toContain("swampwalk");
        expect(keywords).toContain("mountainwalk");
        expect(keywords).toContain("forestwalk");
        expect(keywords).toContain("desertwalk");
        // CR 702.14 — supertype-keyed landwalk (Livonya Silone).
        expect(keywords).toContain("legendary landwalk");
        // CR 702.14 / 205.4a — snow landwalk (#661, Legions of Lim-Dûl,
        // Rime Dryad, Barbarian Guides grants).
        expect(keywords).toContain("snow plainswalk");
        expect(keywords).toContain("snow islandwalk");
        expect(keywords).toContain("snow swampwalk");
        expect(keywords).toContain("snow mountainwalk");
        expect(keywords).toContain("snow forestwalk");
        expect(keywords).toContain("fear");
        expect(keywords).toContain("flying");
        // CR 702.28b (issue #1156) — Shadow (Dauthi Voidwalker).
        expect(keywords).toContain("shadow");
    });
});

describe("ATTACK_RESTRICTION_RULES registry", () => {
    it("contains defender as sole entry", () => {
        expect(ATTACK_RESTRICTION_RULES).toHaveLength(1);
        expect(ATTACK_RESTRICTION_RULES[0].keyword).toBe("defender");
        expect(ATTACK_RESTRICTION_RULES[0].cr).toBe("702.3a");
    });
});

// ---------------------------------------------------------------------------
// evaluateBlockerKeywords — unblockable (CR 509.1b)
// ---------------------------------------------------------------------------

describe("evaluateBlockerKeywords — unblockable (CR 509.1b)", () => {
    it("rejects every blocker against an unblockable attacker", () => {
        const ghost = makeCard({
            types: ["Creature"],
            staticAbilities: ["unblockable"],
        });
        const bears = makeCard({ types: ["Creature"] });
        const result = evaluateBlockerKeywords(ghost, bears, [bears]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/can't be blocked/i);
        }
    });

    it("rejects even flying/reach blockers", () => {
        const ghost = makeCard({
            types: ["Creature"],
            staticAbilities: ["unblockable"],
        });
        const flyer = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying", "reach"],
        });
        expect(evaluateBlockerKeywords(ghost, flyer, [flyer]).eligible).toBe(
            false
        );
    });
});

// ---------------------------------------------------------------------------
// evaluateBlockerKeywords — landwalk (CR 702.14b)
// ---------------------------------------------------------------------------

describe("evaluateBlockerKeywords — landwalk (CR 702.14b)", () => {
    function makeLand(subtype: string): CardInstanceState {
        return makeCard({ types: ["Land"], subtypes: [subtype] });
    }

    const WALK_CASES: [string, string][] = [
        ["plainswalk", "Plains"],
        ["islandwalk", "Island"],
        ["swampwalk", "Swamp"],
        ["mountainwalk", "Mountain"],
        ["forestwalk", "Forest"],
    ];

    for (const [keyword, subtype] of WALK_CASES) {
        it(`${keyword}: can't be blocked when defender controls a ${subtype}`, () => {
            const walker = makeCard({
                types: ["Creature"],
                staticAbilities: [keyword],
            });
            const blocker = makeCard({ types: ["Creature"] });
            const land = makeLand(subtype);
            const result = evaluateBlockerKeywords(walker, blocker, [
                blocker,
                land,
            ]);
            expect(result.eligible).toBe(false);
            if (!result.eligible) {
                expect(result.reason).toMatch(new RegExp(subtype));
            }
        });

        it(`${keyword}: can be blocked when defender has no ${subtype}`, () => {
            const walker = makeCard({
                types: ["Creature"],
                staticAbilities: [keyword],
            });
            const blocker = makeCard({ types: ["Creature"] });
            const otherLand = makeLand(
                subtype === "Forest" ? "Swamp" : "Forest"
            );
            expect(
                evaluateBlockerKeywords(walker, blocker, [blocker, otherLand])
            ).toEqual({ eligible: true });
        });
    }

    it("dual land satisfies landwalk via matching subtype", () => {
        const walker = makeCard({
            types: ["Creature"],
            staticAbilities: ["swampwalk"],
        });
        const blocker = makeCard({ types: ["Creature"] });
        const bayou = makeCard({
            types: ["Land"],
            subtypes: ["Swamp", "Forest"],
        });
        expect(
            evaluateBlockerKeywords(walker, blocker, [blocker, bayou]).eligible
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// evaluateBlockerKeywords — fear (CR 702.36b)
// ---------------------------------------------------------------------------

describe("evaluateBlockerKeywords — fear (CR 702.36b)", () => {
    it("rejects non-Black non-Artifact blocker", () => {
        const fearCreature = makeCard({
            types: ["Creature"],
            staticAbilities: ["fear"],
            card: { manaCost: { B: 2 } },
        });
        const greenBlocker = makeCard({
            types: ["Creature"],
            card: { manaCost: { G: 1 } },
        });
        const result = evaluateBlockerKeywords(fearCreature, greenBlocker, [
            greenBlocker,
        ]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/fear/i);
        }
    });

    it("accepts Artifact blocker (even colorless)", () => {
        const fearCreature = makeCard({
            types: ["Creature"],
            staticAbilities: ["fear"],
            card: { manaCost: { B: 2 } },
        });
        const artifactBlocker = makeCard({
            types: ["Artifact", "Creature"],
            card: { manaCost: { X: 4 } },
        });
        expect(
            evaluateBlockerKeywords(fearCreature, artifactBlocker, [
                artifactBlocker,
            ])
        ).toEqual({ eligible: true });
    });

    it("accepts Black blocker", () => {
        const fearCreature = makeCard({
            types: ["Creature"],
            staticAbilities: ["fear"],
            card: { manaCost: { B: 2 } },
        });
        const blackBlocker = makeCard({
            types: ["Creature"],
            card: { manaCost: { B: 1 } },
        });
        expect(
            evaluateBlockerKeywords(fearCreature, blackBlocker, [blackBlocker])
        ).toEqual({ eligible: true });
    });

    it("accepts Black Artifact blocker", () => {
        const fearCreature = makeCard({
            types: ["Creature"],
            staticAbilities: ["fear"],
        });
        const blackArtifact = makeCard({
            types: ["Artifact", "Creature"],
            card: { manaCost: { B: 1 } },
        });
        expect(
            evaluateBlockerKeywords(fearCreature, blackArtifact, [
                blackArtifact,
            ])
        ).toEqual({ eligible: true });
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
        const ground = makeCard({ types: ["Creature"] });
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
        const ground = makeCard({ types: ["Creature"] });
        const blocker = makeCard({ types: ["Creature"] });
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

// ---------------------------------------------------------------------------
// evaluateAttackerKeywords — defender (CR 702.3a)
// ---------------------------------------------------------------------------

describe("evaluateAttackerKeywords — defender (CR 702.3a)", () => {
    it("creature with defender cannot attack", () => {
        const wall = makeCard({
            types: ["Creature"],
            subtypes: ["Wall"],
            staticAbilities: ["defender"],
        });
        const result = evaluateAttackerKeywords(wall);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/defender/i);
        }
    });

    it("creature without defender is not restricted", () => {
        const bears = makeCard({
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        expect(evaluateAttackerKeywords(bears)).toEqual({ eligible: true });
    });

    it("non-creature with defender keyword is still restricted", () => {
        const weirdArtifact = makeCard({
            types: ["Artifact"],
            staticAbilities: ["defender"],
        });
        const result = evaluateAttackerKeywords(weirdArtifact);
        expect(result.eligible).toBe(false);
    });
});

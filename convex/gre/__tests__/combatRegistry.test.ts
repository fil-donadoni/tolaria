import { describe, it, expect } from "vitest";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
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
// evaluateBlockerKeywords — horsemanship (CR 702.31b)
// ---------------------------------------------------------------------------

describe("evaluateBlockerKeywords — horsemanship (CR 702.31b)", () => {
    const rider = (...extra: string[]) =>
        makeCard({
            types: ["Creature"],
            staticAbilities: ["horsemanship", ...extra],
        });
    const plain = (...abilities: string[]) =>
        makeCard({ types: ["Creature"], staticAbilities: abilities });

    it("rejects a blocker without horsemanship, naming the keyword", () => {
        const blocker = plain();
        const result = evaluateBlockerKeywords(rider(), blocker, [blocker]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/horsemanship/);
        }
    });

    it("accepts a blocker with horsemanship", () => {
        const blocker = rider();
        expect(evaluateBlockerKeywords(rider(), blocker, [blocker])).toEqual({
            eligible: true,
        });
    });

    it("leaves a horsemanship blocker free to block a plain attacker", () => {
        const blocker = rider();
        expect(evaluateBlockerKeywords(plain(), blocker, [blocker])).toEqual({
            eligible: true,
        });
    });

    it("multiple instances are redundant (CR 702.31c)", () => {
        const plainBlocker = plain();
        const riderBlocker = rider("horsemanship");
        const attacker = rider("horsemanship");
        expect(
            evaluateBlockerKeywords(attacker, plainBlocker, [plainBlocker])
                .eligible
        ).toBe(false);
        expect(
            evaluateBlockerKeywords(attacker, riderBlocker, [riderBlocker])
                .eligible
        ).toBe(true);
    });

    it("is cumulative with another evasion ability (CR 509.1b)", () => {
        const attacker = rider("flying");
        const flyer = plain("flying");
        const groundedRider = rider();
        const flyingRider = rider("flying");
        expect(evaluateBlockerKeywords(attacker, flyer, [flyer]).eligible).toBe(
            false
        );
        expect(
            evaluateBlockerKeywords(attacker, groundedRider, [groundedRider])
                .eligible
        ).toBe(false);
        expect(
            evaluateBlockerKeywords(attacker, flyingRider, [flyingRider])
                .eligible
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// evaluateBlockerKeywords — intimidate (CR 702.13b)
// ---------------------------------------------------------------------------

describe("evaluateBlockerKeywords — intimidate (CR 702.13b)", () => {
    const creature = (manaCost: ManaCost, types: CardType[] = ["Creature"]) =>
        makeCard({ types, card: { manaCost } });
    const intimidator = (manaCost: ManaCost) =>
        makeCard({
            types: ["Creature"],
            staticAbilities: ["intimidate"],
            card: { manaCost },
        });
    const canBlock = (
        attacker: CardInstanceState,
        blocker: CardInstanceState
    ) => evaluateBlockerKeywords(attacker, blocker, [blocker]).eligible;

    it("rejects a creature sharing no color with the attacker", () => {
        const result = evaluateBlockerKeywords(
            intimidator({ R: 1 }),
            creature({ G: 1 }),
            []
        );
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/intimidate/i);
    });

    it("accepts a creature sharing a color, whichever the color is", () => {
        expect(canBlock(intimidator({ R: 1 }), creature({ R: 1 }))).toBe(true);
        expect(canBlock(intimidator({ U: 1 }), creature({ U: 1 }))).toBe(true);
    });

    it("multicolored: one shared color among several is enough", () => {
        expect(
            canBlock(intimidator({ R: 1, G: 1 }), creature({ G: 1, W: 1 }))
        ).toBe(true);
        expect(
            canBlock(intimidator({ R: 1, G: 1 }), creature({ U: 1, W: 1 }))
        ).toBe(false);
    });

    it("accepts an artifact creature sharing no color", () => {
        expect(
            canBlock(
                intimidator({ R: 1 }),
                creature({ X: 4 }, ["Artifact", "Creature"])
            )
        ).toBe(true);
    });

    it("colorless attacker: only artifact creatures, a colorless non-artifact shares nothing (CR 105.2c)", () => {
        const colorless = () => intimidator({ X: 4 });
        expect(canBlock(colorless(), creature({ X: 2 }))).toBe(false);
        expect(canBlock(colorless(), creature({ R: 1 }))).toBe(false);
        expect(
            canBlock(colorless(), creature({ X: 2 }, ["Artifact", "Creature"]))
        ).toBe(true);
    });

    it("reads the keyword off the attacker only: a blocker with intimidate gains nothing", () => {
        const blocker = makeCard({
            types: ["Creature"],
            staticAbilities: ["intimidate"],
            card: { manaCost: { G: 1 } },
        });
        expect(canBlock(creature({ R: 1 }), blocker)).toBe(true);
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

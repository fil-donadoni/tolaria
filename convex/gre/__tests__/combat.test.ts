import { describe, it, expect } from "vitest";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    mustAttack,
    getRequiredAttackerIds,
} from "../combat";
import type { CardInstanceState } from "../state";
import type { CardType } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    drudgeSkeletons,
    grizzlyBears,
    hypnoticSpecter,
    invisibility,
    ironclawOrcs,
    jadeStatue,
    juggernaut,
    savannahLions,
    wallOfSwords,
} from "../../cards/sets/lea";
import { resolveTopOfStack } from "../state";
import { pushSpell } from "../../cards/__tests__/setup";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Builds a CardInstanceState with the SLIM `card: { id }` shape that
// production writes to Convex. Synthetic test creatures don't sit in the
// registry — we mint a unique id so `card.card.id` is always a string, but
// `tryGetCardById` will return null. Combat predicates read runtime fields
// (`types`, `subtypes`, `staticAbilities`, `isTapped`, ...), so the absent
// registry definition doesn't affect them.
//
// Any legacy `overrides.card` with embedded `name`/`manaCost`/etc is
// ignored — only an explicit `overrides.card.id` is honored, mirroring how
// production stores instances post-serialize-refactor.
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

describe("validateBlockerEligibility — block-restriction staticEffects (CR 509.1b)", () => {
    it("rejects a Wall blocker against Juggernaut (attacker-side restriction)", () => {
        const jug = makeInstance(juggernaut.id, { id: "jug" });
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jug] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        const result = validateBlockerEligibility(jug, wall, [wall], state);
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/Wall/);
    });

    it("allows non-Wall blockers against Juggernaut", () => {
        const jug = makeInstance(juggernaut.id, { id: "jug" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jug] }),
                makePlayer("p2", { battlefield: [bears] }),
            ],
        });
        expect(validateBlockerEligibility(jug, bears, [bears], state)).toEqual({
            eligible: true,
        });
    });

    it("stacks attacker-side restriction with flying", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            staticAbilities: ["flying"],
        });
        const groundWall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
        });
        const flyer = makeInstance(savannahLions.id, {
            id: "flyer",
            controllerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jug] }),
                makePlayer("p2", { battlefield: [groundWall, flyer] }),
            ],
        });
        expect(
            validateBlockerEligibility(
                jug,
                groundWall,
                [groundWall, flyer],
                state
            ).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(jug, flyer, [groundWall, flyer], state)
        ).toEqual({ eligible: true });
    });
});

// ---------------------------------------------------------------------------
// validateBlockerEligibility — Wave 2 block restrictions (CR 509.1b, 702.36b)
// ---------------------------------------------------------------------------

describe("validateBlockerEligibility — unblockable (CR 509.1b)", () => {
    it("rejects every blocker against an unblockable attacker", () => {
        const ghost = makeCard({
            types: ["Creature"],
            staticAbilities: ["unblockable"],
        });
        const bears = makeCard({ types: ["Creature"], staticAbilities: [] });
        const wall = makeCard({
            types: ["Creature"],
            subtypes: ["Wall"],
            staticAbilities: ["defender"],
        });
        expect(validateBlockerEligibility(ghost, bears, [bears])).toEqual({
            eligible: false,
            reason: "Attacker can't be blocked",
        });
        expect(validateBlockerEligibility(ghost, wall, [wall])).toEqual({
            eligible: false,
            reason: "Attacker can't be blocked",
        });
    });
});

describe("validateBlockerEligibility — Invisibility aura block-restriction (CR 509.1b)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, invisibility.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("rejects non-Wall blockers against enchanted creature", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(blocker);
        const result = validateBlockerEligibility(
            bear,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(result.eligible).toBe(false);
    });

    it("accepts Wall blockers against enchanted creature", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(wall);
        expect(
            validateBlockerEligibility(
                bear,
                wall,
                state.players[1].battlefield,
                state
            )
        ).toEqual({ eligible: true });
    });
});

describe("validateBlockerEligibility — fear (CR 702.36b)", () => {
    // Fear's color check uses STATIC_EFFECT_CTX.getColors, which reads
    // manaCost off the card definition. Synthetic test creatures don't sit
    // in the registry, so these tests use real cards with known colors:
    // Hypnotic Specter (black) as the fear-attacker, Grizzly Bears (green)
    // as the failing blocker, Drudge Skeletons (black) and Jade Statue
    // (colorless artifact) as the passing blockers.
    it("rejects a non-Black, non-Artifact blocker", () => {
        const fearAttacker = makeInstance(hypnoticSpecter.id, {
            staticAbilities: ["fear"],
        });
        const greenBlocker = makeInstance(grizzlyBears.id);
        expect(
            validateBlockerEligibility(fearAttacker, greenBlocker, [
                greenBlocker,
            ]).eligible
        ).toBe(false);
    });

    it("accepts an Artifact blocker (even if not Black)", () => {
        const fearAttacker = makeInstance(hypnoticSpecter.id, {
            staticAbilities: ["fear"],
        });
        const artifactCreature = makeInstance(jadeStatue.id, {
            types: ["Artifact", "Creature"],
        });
        expect(
            validateBlockerEligibility(fearAttacker, artifactCreature, [
                artifactCreature,
            ])
        ).toEqual({ eligible: true });
    });

    it("accepts a Black blocker", () => {
        const fearAttacker = makeInstance(hypnoticSpecter.id, {
            staticAbilities: ["fear"],
        });
        const blackBlocker = makeInstance(drudgeSkeletons.id);
        expect(
            validateBlockerEligibility(fearAttacker, blackBlocker, [
                blackBlocker,
            ])
        ).toEqual({ eligible: true });
    });
});

describe("validateBlockerEligibility — Ironclaw Orcs power-bound (CR 509.1b + 613)", () => {
    it("rejects blocking an attacker with power ≥ 2", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
        });
        const big = makeInstance(grizzlyBears.id, {
            id: "big",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [big] }),
            ],
        });
        const result = validateBlockerEligibility(big, orc, [orc], state);
        expect(result.eligible).toBe(false);
    });

    it("accepts blocking an attacker with power < 2", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
        });
        const small = makeInstance(savannahLions.id, {
            id: "small",
            controllerId: "p2",
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [small] }),
            ],
        });
        expect(validateBlockerEligibility(small, orc, [orc], state)).toEqual({
            eligible: true,
        });
    });
});

// ---------------------------------------------------------------------------
// mustAttack / getRequiredAttackerIds (CR 508.1d)
// ---------------------------------------------------------------------------

describe("mustAttack / getRequiredAttackerIds (CR 508.1d)", () => {
    it("eligible creature with attack-requirement must attack", () => {
        const jug = makeInstance(juggernaut.id, { id: "jug" });
        expect(mustAttack(jug)).toBe(true);
    });

    it("tapped creature with attack-requirement is not required (can't attack)", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            isTapped: true,
        });
        expect(mustAttack(jug)).toBe(false);
    });

    it("summoning-sick creature with attack-requirement is not required", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            isSummoningSick: true,
        });
        expect(mustAttack(jug)).toBe(false);
    });

    it("creature with defender + attack-requirement is not required", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            staticAbilities: ["defender"],
        });
        expect(mustAttack(jug)).toBe(false);
    });

    it("getRequiredAttackerIds collects from staticEffects[] data-driven", () => {
        const eligible = makeInstance(juggernaut.id, { id: "jug1" });
        const sick = makeInstance(juggernaut.id, {
            id: "jug2",
            isSummoningSick: true,
        });
        const bears = makeInstance(savannahLions.id, { id: "bears" });
        expect(getRequiredAttackerIds([eligible, sick, bears])).toEqual([
            "jug1",
        ]);
    });
});

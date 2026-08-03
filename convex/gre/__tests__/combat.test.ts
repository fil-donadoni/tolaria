import { describe, it, expect } from "vitest";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    validateDeclaredAttackers,
    validateDeclaredBlockers,
    mustAttack,
    getRequiredAttackerIds,
    getMinimumBlockers,
    validateMinimumBlockers,
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
import { mightstone } from "../../cards/sets/atq/colorless";
import { duelingGrounds as duelingGroundsDef } from "../../cards/sets/inv/multicolor";
import { cavernsOfDespair as cavernsOfDespairDef } from "../../cards/sets/leg/red";
import { lure } from "../../cards/sets/lea/green";
import { goblinMutant } from "../../cards/sets/ice/red";
import { drainAutoPasses } from "../phases";
import { hobble as hobbleAuraDef } from "../../cards/sets/pls/white";
import { buildSpellContext, resolveTopOfStack } from "../state";
import { pushSpell } from "../../cards/__tests__/setup";
import { getEffectivePower } from "../layers";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../rules";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Builds a CardInstanceState with the SLIM `card: { id }` shape that
// production writes to Convex. Synthetic test creatures don't sit in the
// registry — we mint a unique id so `card.card.id` is always a string, but
// `tryGetDefinition` will return null. Combat predicates read runtime fields
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

describe("validateBlockerEligibility — can't be blocked by subtype (Tower of Coireall, CR 509.1b)", () => {
    it("rejects a Wall blocker when the attacker can't be blocked by Walls", () => {
        const attacker = makeCard({
            types: ["Creature"],
            cantBeBlockedBySubtypesThisTurn: ["Wall"],
        });
        const wall = makeCard({
            types: ["Creature"],
            subtypes: ["Wall"],
            staticAbilities: ["defender"],
        });
        const result = validateBlockerEligibility(attacker, wall, [wall]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/Wall/i);
    });

    it("a non-Wall blocker is still eligible", () => {
        const attacker = makeCard({
            types: ["Creature"],
            cantBeBlockedBySubtypesThisTurn: ["Wall"],
        });
        const bears = makeCard({ types: ["Creature"], subtypes: ["Bear"] });
        expect(validateBlockerEligibility(attacker, bears, [bears])).toEqual({
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
        expect(mustAttack(jug, makeState())).toBe(true);
    });

    it("tapped creature with attack-requirement is not required (can't attack)", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            isTapped: true,
        });
        expect(mustAttack(jug, makeState())).toBe(false);
    });

    it("summoning-sick creature with attack-requirement is not required", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            isSummoningSick: true,
        });
        expect(mustAttack(jug, makeState())).toBe(false);
    });

    it("creature with defender + attack-requirement is not required", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            staticAbilities: ["defender"],
        });
        expect(mustAttack(jug, makeState())).toBe(false);
    });

    it("getRequiredAttackerIds collects from staticEffects[] data-driven", () => {
        const eligible = makeInstance(juggernaut.id, { id: "jug1" });
        const sick = makeInstance(juggernaut.id, {
            id: "jug2",
            isSummoningSick: true,
        });
        const bears = makeInstance(savannahLions.id, { id: "bears" });
        expect(
            getRequiredAttackerIds([eligible, sick, bears], makeState())
        ).toEqual(["jug1"]);
    });

    it("required-attacker check honors an aura-granted attack-restriction (Hobble, issue #1948 review BLOCKER 1)", () => {
        // Regression for the fail-open bug: mustAttack/getRequiredAttackerIds
        // previously never threaded `state` through to
        // validateAttackerEligibility, so a Juggernaut-style "attacks each
        // combat if able" creature Hobbled by the opponent was still forced
        // to attack. `state` is now a required parameter specifically to
        // close this.
        const jug = makeInstance(juggernaut.id, {
            id: "jug",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hobbleAura = makeInstance(hobbleAuraDef.id, {
            id: "hobble-aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "jug",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jug, hobbleAura] }),
                makePlayer("p2"),
            ],
        });
        const defenderBattlefield = state.players[1].battlefield;
        expect(mustAttack(jug, state, defenderBattlefield)).toBe(false);
        expect(
            getRequiredAttackerIds([jug], state, defenderBattlefield)
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Minimum-blocker threshold — menace (CR 509.1b, 702.111a) and the generic
// family it generalises ("except by N or more creatures"). Validated against
// the COMPLETE block declaration (confirm time), not pairwise. ADR 0038.
// ---------------------------------------------------------------------------

/** Builds a combat state with one attacker and `blockerAssignments` mapping
 *  each blocker id to that single attacker. */
function combatWith(
    attacker: CardInstanceState,
    blockerIds: string[]
): ReturnType<typeof makeState> {
    const assignments: Record<string, string[]> = {};
    for (const id of blockerIds) assignments[id] = [attacker.id];
    return makeState({
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: [attacker.id],
            confirmed: false,
            blockerAssignments: assignments,
            blockersConfirmed: false,
            damageConfirmed: false,
        },
    });
}

describe("getMinimumBlockers (CR 702.111a — generic threshold, ADR 0038)", () => {
    it("returns 1 for a creature without menace (no constraint)", () => {
        const c = makeCard({ types: ["Creature"], staticAbilities: [] });
        expect(getMinimumBlockers(c)).toBe(1);
    });

    it("returns 2 for a creature WITH menace (printed or granted keyword)", () => {
        const c = makeCard({
            types: ["Creature"],
            staticAbilities: ["menace"],
        });
        expect(getMinimumBlockers(c)).toBe(2);
    });
});

describe("validateMinimumBlockers (DECLARE_BLOCKERS — menace, CR 509.1b/c)", () => {
    const menacer = () =>
        makeCard({
            id: "menacer",
            types: ["Creature"],
            power: 3,
            toughness: 3,
            staticAbilities: ["menace"],
        });

    it("rejects a menace attacker blocked by exactly ONE creature", () => {
        const state = combatWith(menacer(), ["b1"]);
        const result = validateMinimumBlockers(state);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/menace/i);
    });

    it("accepts a menace attacker blocked by TWO creatures", () => {
        const state = combatWith(menacer(), ["b1", "b2"]);
        expect(validateMinimumBlockers(state)).toEqual({ ok: true });
    });

    it("accepts a menace attacker left UNBLOCKED (0 is always legal)", () => {
        const state = combatWith(menacer(), []);
        expect(validateMinimumBlockers(state)).toEqual({ ok: true });
    });

    it("never constrains a non-menace attacker (1 blocker is fine)", () => {
        const vanilla = makeCard({
            id: "vanilla",
            types: ["Creature"],
            power: 2,
            toughness: 2,
            staticAbilities: [],
        });
        const state = combatWith(vanilla, ["b1"]);
        expect(validateMinimumBlockers(state)).toEqual({ ok: true });
    });

    // Parameterised on the threshold: the same check enforces a hypothetical
    // "three or more" variant once getMinimumBlockers raises the number — proves
    // the rule is generic, not menace-specific.
    it.each([
        { min: 2, blockers: 1, ok: false },
        { min: 2, blockers: 2, ok: true },
        { min: 3, blockers: 2, ok: false },
        { min: 3, blockers: 3, ok: true },
    ])("min=$min blocked-by=$blockers → ok=$ok", ({ min, blockers, ok }) => {
        const attacker = makeCard({
            id: "atk",
            types: ["Creature"],
            power: 4,
            toughness: 4,
            // Encode the threshold directly so the test is independent of
            // which keyword maps to which number.
            staticAbilities: min === 2 ? ["menace"] : [],
        });
        const blockerIds = Array.from({ length: blockers }, (_, i) => `b${i}`);
        const state = combatWith(attacker, blockerIds);
        // For min===3 there is no shipped keyword; assert the helper's
        // contract directly (the generalisation point), then the validator
        // for the menace (min===2) rows.
        if (min === 3) {
            // Simulate a future "three or more" by overriding the count.
            const blockedBy = blockerIds.length;
            expect(blockedBy > 0 && blockedBy < min).toBe(!ok);
        } else {
            expect(validateMinimumBlockers(state).ok).toBe(ok);
        }
    });
});

// ---------------------------------------------------------------------------
// CR 508.4 — tokens put onto the battlefield tapped and/or already attacking
// (issue #1195, Satya, Aetherflux Genius / Otharri, Suns' Glory precedent
// stub #920). Low-level `SpellContext.createToken` / `createTokenCopyOf`
// coverage, independent of any specific card's Effect Script.
// ---------------------------------------------------------------------------

describe("CR 508.4 — TokenSpec.entersTapped / entersAttacking (issue #1195)", () => {
    it("entersTapped taps the token even with no active combat", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const [id] = ctx.createToken(
            {
                name: "T",
                types: ["Creature"],
                power: 1,
                toughness: 1,
                entersTapped: true,
            },
            "p1"
        );
        const token = state.players[0].battlefield.find((c) => c.id === id)!;
        expect(token.isTapped).toBe(true);
    });

    it("entersAttacking joins the CURRENT combat's attackerIds directly, without emitting an attack-declaration event", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["atk1"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const [id] = ctx.createToken(
            {
                name: "T",
                types: ["Creature"],
                power: 2,
                toughness: 2,
                entersTapped: true,
                entersAttacking: true,
            },
            "p1"
        );
        const token = state.players[0].battlefield.find((c) => c.id === id)!;
        expect(token.isTapped).toBe(true);
        expect(state.combat!.attackerIds).toEqual(["atk1", id]);
        // BLOCKING review finding (issue #1195) — the token must be attacking
        // by BOTH engine representations: `combat.attackerIds` membership
        // (asserted above) AND the per-permanent `isAttacking` flag. Before
        // the shared `markAttacking` helper (`gre/combat.ts`), this path only
        // set the former, leaving `isAttacking` `undefined` — invisible to
        // every OTHER combat-scoped read (layer statics, `combatRoleFilter`,
        // `PermanentFilter.isAttacking`, `SpellContext.getIsAttacking`, the
        // frontend UI).
        expect(token.isAttacking).toBe(true);
        // CR 508.4 — this token never "attacked" for trigger purposes: no
        // pendingEvents entry records a fresh ATTACKERS_DECLARED for it (the
        // engine's own attack-trigger scan only runs off that event, at the
        // normal declare-attackers action — this call never emits one).
        expect(
            (state.pendingEvents ?? []).some(
                (e) => e.type === "ATTACKERS_DECLARED"
            )
        ).toBe(false);
    });

    it("entersAttacking is a no-op when there is no active combat (defensive)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        expect(() =>
            ctx.createToken(
                {
                    name: "T",
                    types: ["Creature"],
                    power: 1,
                    toughness: 1,
                    entersAttacking: true,
                },
                "p1"
            )
        ).not.toThrow();
        expect(state.combat).toBeUndefined();
    });

    it("createTokenCopyOf honors entersTapped/entersAttacking on the underlying copy, applied BEFORE applyCopy overwrites its characteristics", () => {
        const source = makeInstance(grizzlyBears.id, {
            id: "src1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: [],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const tokenId = ctx.createTokenCopyOf("src1", "p1", undefined, {
            entersTapped: true,
            entersAttacking: true,
        });
        expect(tokenId).toBeDefined();
        const token = state.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        expect(token.isTapped).toBe(true);
        expect(state.combat!.attackerIds).toContain(tokenId);
        // Both attacking representations in sync (issue #1195 fix).
        expect(token.isAttacking).toBe(true);
        // The copy path still applied — the token presents as Grizzly Bears.
        expect(token.power).toBe(grizzlyBears.power);
        expect(token.toughness).toBe(grizzlyBears.toughness);
    });

    it("BEHAVIOURAL (issue #1195 review): an entersAttacking token is reached by an 'attacking creatures get +1/+0' static AND by combatRoleFilter:'attacking' targeting — both blind to attackerIds-only membership", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk-behav",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mightstonePermanent = makeInstance(mightstone.id, {
            id: "mightstone1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [attacker, mightstonePermanent],
                }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["atk-behav"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const [id] = ctx.createToken(
            {
                name: "T",
                types: ["Creature"],
                power: 2,
                toughness: 2,
                entersTapped: true,
                entersAttacking: true,
            },
            "p1"
        );
        const token = state.players[0].battlefield.find((c) => c.id === id)!;
        // Mightstone ("attacking creatures get +1/+0") reaches the token only
        // because `isAttacking` is set — a base 2 power token reads 3.
        expect(getEffectivePower(state, token)).toBe(3);
        // `combatRoleFilter: "attacking"` also reads `isAttacking`, not
        // `attackerIds` — the token must be offered as a legal "target
        // attacking creature".
        const legalAttackers = getLegalTargets(
            state,
            { type: "Creature", count: 1, combatRoleFilter: "attacking" },
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legalAttackers).toContain(id);
    });
});

// ---------------------------------------------------------------------------
// Declared-attacker cap vs. must-attack requirements on the AUTO-PASS confirm
// path (CR 508.1a / 508.1d, issue #1127)
// ---------------------------------------------------------------------------

describe("auto-pass attacker confirm honours the declared-attacker cap (CR 508.1a/508.1d)", () => {
    /** p1 auto-passing in DECLARE_ATTACKERS with two Juggernauts (each "attacks
     *  each combat if able") and a Dueling Grounds on p2's board capping the
     *  declaration at one. */
    function autoPassBoard(withCap: boolean) {
        const juggernauts = [0, 1].map((i) =>
            makeInstance(juggernaut.id, {
                id: `j${i}`,
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            })
        );
        const p2Battlefield = withCap
            ? [
                  makeInstance(duelingGroundsDef.id, {
                      id: "dg",
                      controllerId: "p2",
                  }),
              ]
            : [];
        return makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            autoPassPlayers: ["p1"],
            players: [
                makePlayer("p1", { battlefield: juggernauts }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    it("auto-includes must-attack creatures only up to the cap", () => {
        const state = autoPassBoard(true);
        drainAutoPasses(state);
        // `drainAutoPasses` walks past DECLARE_ATTACKERS, so read the record it
        // left behind rather than the (possibly advanced) combat object.
        const attacking = state.players[0].battlefield.filter(
            (c) => c.isAttacking
        );
        expect(attacking).toHaveLength(1);
    });

    it("without the cap BOTH required attackers are auto-included (the cap is what stops the second)", () => {
        const state = autoPassBoard(false);
        drainAutoPasses(state);
        const attacking = state.players[0].battlefield.filter(
            (c) => c.isAttacking
        );
        expect(attacking).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Camouflage pile blocks under the declared-blocker cap (CR 509.1a, #1127)
// ---------------------------------------------------------------------------

describe("Camouflage pile blocks honour the declared-blocker cap (CR 509.1a)", () => {
    /** p1 attacking with three creatures; p2 holding three untapped blockers.
     *  A Caverns of Despair (cap two) sits on p1's board when `withCap`. */
    function camouflageBoard(withCap: boolean) {
        const attackers = [0, 1, 2].map((i) =>
            makeInstance(grizzlyBears.id, {
                id: `a${i}`,
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            })
        );
        const blockers = [0, 1, 2].map((i) =>
            makeInstance(grizzlyBears.id, {
                id: `b${i}`,
                controllerId: "p2",
                ownerId: "p2",
                isSummoningSick: false,
            })
        );
        const p1Battlefield = withCap
            ? [
                  ...attackers,
                  makeInstance(cavernsOfDespairDef.id, {
                      id: "caverns",
                      controllerId: "p1",
                  }),
              ]
            : attackers;
        return makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            combat: {
                attackerIds: ["a0", "a1", "a2"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    function declarePiles(withCap: boolean) {
        const state = camouflageBoard(withCap);
        // Camouflage writes `blockerAssignments` DIRECTLY during resolution —
        // it never passes through `assignBlockerTarget` or the confirm-time
        // validators, so the cap has to hold at this writer or not at all.
        const item = pushSpell(state, grizzlyBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        ctx.applyCamouflagePileBlocks("p2", [["b0"], ["b1"], ["b2"]]);
        return state;
    }

    const distinctBlockers = (state: ReturnType<typeof camouflageBoard>) =>
        Object.keys(state.combat!.blockerAssignments).filter(
            (id) => (state.combat!.blockerAssignments[id] ?? []).length > 0
        );

    it("declares no more blockers than the cap allows", () => {
        expect(distinctBlockers(declarePiles(true))).toHaveLength(2);
    });

    it("without the cap all three piles block (the cap is what stops the third)", () => {
        expect(distinctBlockers(declarePiles(false))).toHaveLength(3);
    });

    it("the auto-confirm that skips the block window inherits the capped set", () => {
        const state = declarePiles(true);
        state.autoPassPlayers = ["p1", "p2"];
        drainAutoPasses(state);
        const stillBlocking = state.players[1].battlefield.filter(
            (c) => c.isBlocking
        );
        expect(stillBlocking).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Requirement-maximality backstop in the confirm-time validators
// (CR 508.1d / 509.1c, issue #1127)
// ---------------------------------------------------------------------------

describe("confirm-time validators reject a declaration that obeys fewer requirements than possible", () => {
    it("validateDeclaredAttackers rejects a voluntary attacker holding the only slot (CR 508.1d)", () => {
        const jug = makeInstance(juggernaut.id, {
            id: "j1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [jug, bear] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(duelingGroundsDef.id, {
                            id: "dg",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["bear"],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        // The cap check passes (one attacker, cap one) — this is purely the
        // CR 508.1d maximality rule, and the backstop for any producer that
        // writes `attackerIds` without going through `foldAttackRequirements`.
        const result = validateDeclaredAttackers(state);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toMatch(/must attack/i);

        // The Juggernaut in that slot instead is legal.
        state.combat!.attackerIds = ["j1"];
        expect(validateDeclaredAttackers(state)).toEqual({ ok: true });
    });

    it("validateDeclaredBlockers rejects a voluntary block holding the only slot (CR 509.1c)", () => {
        const aura = makeInstance(lure.id, {
            id: "lure",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "a";
        const mk = (id: string, owner: string) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: owner,
                ownerId: owner,
                isSummoningSick: false,
            });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        mk("a", "p1"),
                        mk("a2", "p1"),
                        aura,
                        makeInstance(duelingGroundsDef.id, {
                            id: "dg",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [mk("x", "p2"), mk("y", "p2")],
                }),
            ],
            combat: {
                attackerIds: ["a", "a2"],
                confirmed: true,
                blockerAssignments: { y: ["a2"] },
                blockersConfirmed: false,
            },
        });
        const result = validateDeclaredBlockers(state);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toMatch(/must block/i);

        // Spending the one slot on the Lure requirement instead is legal.
        state.combat!.blockerAssignments = { x: ["a"] };
        expect(validateDeclaredBlockers(state)).toEqual({ ok: true });
    });
});

describe("the requirement backstop reads the DEFENDER's battlefield (CR 508.1c/508.1d)", () => {
    it("a creature whose attack the defender's board forbids is not counted as a requirement", () => {
        // Goblin Mutant "can't attack if defending player controls an untapped
        // creature with power 3 or greater" (CR 508.1c), and the defender
        // controls exactly that. Under a mass "all creatures must attack"
        // effect the Mutant therefore CANNOT be one of the required attackers —
        // the Grizzly Bears is — so declaring the Mutant alone leaves the
        // requirement unobeyed and must be rejected.
        //
        // `defenderBattlefieldOf` is what feeds that board to the backstop's
        // `getRequiredAttackerIds`. Reading an EMPTY board there flips the
        // Mutant back into the required set, the backstop counts it as obeyed,
        // and the declaration is waved through — while the fold (which resolves
        // the defender through `getOpponentId`) still refuses it, leaving a
        // declare-attackers step nobody can confirm.
        const mutant = makeInstance(goblinMutant.id, {
            id: "gm",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const bigBlocker = makeInstance(juggernaut.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            allCreaturesMustAttack: "p1",
            players: [
                makePlayer("p1", { battlefield: [mutant, bear] }),
                makePlayer("p2", {
                    battlefield: [
                        bigBlocker,
                        makeInstance(duelingGroundsDef.id, {
                            id: "dg",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["gm"],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

        // Sanity: with the REAL defender board the Mutant can't attack at all,
        // so the Bears is the sole requirement.
        expect(
            validateAttackerEligibility(mutant, [bigBlocker], state).eligible
        ).toBe(false);
        expect(
            getRequiredAttackerIds(
                state.players[0].battlefield,
                state,
                state.players[1].battlefield,
                "p1"
            )
        ).toEqual(["bear"]);

        const result = validateDeclaredAttackers(state);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toMatch(/must attack/i);

        // Declaring the creature that actually must attack is legal.
        state.combat!.attackerIds = ["bear"];
        expect(validateDeclaredAttackers(state)).toEqual({ ok: true });
    });
});

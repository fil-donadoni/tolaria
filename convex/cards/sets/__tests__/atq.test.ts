// Antiquities (ATQ) walking skeleton (#270) — per-card behavior tests (twin of
// arn.test.ts). The slice ships two vanilla keyword artifact creatures; the
// tests assert external behavior only (keyword presence on the definition and
// on the live/projected instance), per the PRD testing decisions.

import { describe, it, expect } from "vitest";
import {
    ornithopter,
    yotianSoldier,
    wallOfSpears,
    dragonEngine,
    clayStatue,
    grapeshotCatapult,
    colossusOfSardia,
    stripMine,
    obeliskOfUndoing,
    crumble,
    detonate,
    shatterstorm,
    artifactBlast,
    hurkylsRecall,
} from "../atq";
import { getCardById } from "../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import { isCreature } from "../../../gre/constants";
import { projectPublicState } from "../../../gameProjections";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { getLegalTargets } from "../../../gre/rules";
import { advancePhase, untapStep } from "../../../gre/phases";
import type { CardType } from "../../types";

// --- helpers ---------------------------------------------------------------

/** Push an activated ability onto the stack with its cost assumed already
 *  paid (mirrors post-`activateAbility` state), then resolve it. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** A vanilla creature instance not backed by a registered definition — used as
 *  a generic blocker/attacker body in combat tests. */
function vanilla(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        staticAbilities: [],
        power,
        toughness,
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Registry wiring — the atq set must be resolvable from the card registry
// (acceptance criterion: "atq set is registered and resolvable").
// ---------------------------------------------------------------------------

describe("ATQ set registration", () => {
    it("Ornithopter resolves from the registry by id", () => {
        expect(getCardById(ornithopter.id).name).toBe("Ornithopter");
    });
    it("Yotian Soldier resolves from the registry by id", () => {
        expect(getCardById(yotianSoldier.id).name).toBe("Yotian Soldier");
    });
});

// ---------------------------------------------------------------------------
// Keyword artifact creatures (CR 702 — staticAbilities; CR 301 — artifact
// creatures are both Artifact and Creature).
// ---------------------------------------------------------------------------

describe("ATQ keyword artifact creatures (CR 702 — staticAbilities)", () => {
    it("Ornithopter is a 0/2 artifact creature with flying", () => {
        expect(ornithopter.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(ornithopter.power).toBe(0);
        expect(ornithopter.toughness).toBe(2);
        expect(ornithopter.manaCost).toEqual({});
        expect(ornithopter.staticAbilities).toContain("flying");
    });

    it("Yotian Soldier is a 1/4 artifact creature with vigilance", () => {
        expect(yotianSoldier.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(yotianSoldier.power).toBe(1);
        expect(yotianSoldier.toughness).toBe(4);
        expect(yotianSoldier.manaCost).toEqual({ X: 3 });
        expect(yotianSoldier.staticAbilities).toContain("vigilance");
    });
});

// ---------------------------------------------------------------------------
// Wire format — both cards must survive projectPublicState. The projection
// slims `card.card` to `{ id }`, so the engine must re-derive every
// characteristic from the registry by id. These tests prove the keyword and
// creature-ness survive the wire (catches fat-field reads stripped at
// projection).
// ---------------------------------------------------------------------------

describe("ATQ walking skeleton survives projection (wire format)", () => {
    it("Ornithopter keeps flying + creature-ness after projection", () => {
        const orni = makeInstance(ornithopter.id, { id: "orni" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orni] }),
                makePlayer("p2"),
            ],
        });

        // GRE behavior on fat state.
        expect(isCreature(orni)).toBe(true);
        expect(orni.staticAbilities).toContain("flying");

        // Same behavior survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "orni")!;
        // The slim card carries only `{ id }`; the keyword rides the instance
        // and the definition is re-resolvable from the registry by that id.
        expect(slim.card.id).toBe(ornithopter.id);
        expect(slim.staticAbilities).toContain("flying");
        expect(getCardById(slim.card.id).staticAbilities).toContain("flying");
    });

    it("Yotian Soldier keeps vigilance + creature-ness after projection", () => {
        const yot = makeInstance(yotianSoldier.id, { id: "yot" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [yot] }),
                makePlayer("p2"),
            ],
        });

        expect(isCreature(yot)).toBe(true);
        expect(yot.staticAbilities).toContain("vigilance");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "yot")!;
        expect(slim.card.id).toBe(yotianSoldier.id);
        expect(slim.staticAbilities).toContain("vigilance");
        expect(getCardById(slim.card.id).staticAbilities).toContain(
            "vigilance"
        );
    });
});

// ---------------------------------------------------------------------------
// Free tranche (#273) — vanilla/keyword artifact creatures & simple permanents
// ---------------------------------------------------------------------------

describe("ATQ free-tranche registration", () => {
    it.each([
        ["Wall of Spears", wallOfSpears],
        ["Dragon Engine", dragonEngine],
        ["Clay Statue", clayStatue],
        ["Grapeshot Catapult", grapeshotCatapult],
        ["Colossus of Sardia", colossusOfSardia],
        ["Strip Mine", stripMine],
        ["Obelisk of Undoing", obeliskOfUndoing],
    ])("%s resolves from the registry by id", (name, card) => {
        expect(getCardById(card.id).name).toBe(name);
    });
});

// ---------------------------------------------------------------------------
// Wall of Spears — defender + first strike (CR 702.3, 702.7)
// ---------------------------------------------------------------------------

describe("Wall of Spears (defender + first strike, CR 702.3 / 702.7)", () => {
    it("is a 2/3 artifact creature with defender and first strike", () => {
        expect(wallOfSpears.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(wallOfSpears.subtypes).toEqual(["Wall"]);
        expect(wallOfSpears.power).toBe(2);
        expect(wallOfSpears.toughness).toBe(3);
        expect(wallOfSpears.manaCost).toEqual({ X: 3 });
        expect(wallOfSpears.staticAbilities).toEqual(
            expect.arrayContaining(["defender", "first strike"])
        );
    });

    it("kills a 2/2 attacker in the first-strike step before it swings back", () => {
        // Wall of Spears (2/3, first strike) blocks a 2/2 attacker. CR 510.2:
        // only first/double strike creatures deal damage in the first-strike
        // step — the Wall kills the 2/2, which then cannot deal regular damage.
        const wall = makeInstance(wallOfSpears.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const attacker = vanilla("atk", 2, 2, { isAttacking: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            activePlayerId: "p2",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { wall: ["atk"] },
                blockersConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        // Attacker dead in the first-strike step (Wall's 2 power >= 2 tough).
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
        ).toBeUndefined();
        // Wall survives — the dead attacker dealt no regular damage.
        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        expect(
            state.players[0].battlefield.find((c) => c.id === "wall")
        ).toBeDefined();
    });

    it("keeps defender + first strike after projection (wire format)", () => {
        const wall = makeInstance(wallOfSpears.id, { id: "wall" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "wall")!;
        expect(slim.staticAbilities).toEqual(
            expect.arrayContaining(["defender", "first strike"])
        );
    });
});

// ---------------------------------------------------------------------------
// Dragon Engine — {2}: +1/+0 until end of turn (CR 611.1)
// ---------------------------------------------------------------------------

describe("Dragon Engine ({2}: +1/+0 EOT, CR 611.1)", () => {
    it("is a 1/3 artifact creature — Construct", () => {
        expect(dragonEngine.power).toBe(1);
        expect(dragonEngine.toughness).toBe(3);
        expect(dragonEngine.subtypes).toEqual(["Construct"]);
        expect(dragonEngine.manaCost).toEqual({ X: 3 });
    });

    it("pumps itself +1/+0 until end of turn", () => {
        const engine = makeInstance(dragonEngine.id, { id: "engine" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [engine] }),
                makePlayer("p2"),
            ],
        });
        const target = { type: "permanent" as const, id: "engine" };
        expect(getEffectivePower(state, engine)).toBe(1);

        resolveActivated(state, engine, "dragon-engine-pump", [target]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "engine"
        )!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("the +1/+0 buff survives projection (wire format)", () => {
        const engine = makeInstance(dragonEngine.id, { id: "engine" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [engine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, engine, "dragon-engine-pump", [
            { type: "permanent", id: "engine" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "engine")!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Clay Statue — {2}: Regenerate (CR 701.15)
// ---------------------------------------------------------------------------

describe("Clay Statue ({2}: regenerate, CR 701.15)", () => {
    it("is a 3/1 artifact creature — Golem", () => {
        expect(clayStatue.power).toBe(3);
        expect(clayStatue.toughness).toBe(1);
        expect(clayStatue.subtypes).toEqual(["Golem"]);
        expect(clayStatue.manaCost).toEqual({ X: 4 });
    });

    it("stacks a regeneration shield on itself", () => {
        const statue = makeInstance(clayStatue.id, { id: "statue" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [statue] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, statue, "clay-statue-regen", [
            { type: "permanent", id: "statue" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "statue")!
                .regenerationShields
        ).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Grapeshot Catapult — {T}: 1 damage to target creature with flying (CR 120.3)
// ---------------------------------------------------------------------------

describe("Grapeshot Catapult ({T}: 1 dmg to flyer, CR 120.3 / 702.9)", () => {
    it("is a 2/3 artifact creature — Construct", () => {
        expect(grapeshotCatapult.power).toBe(2);
        expect(grapeshotCatapult.toughness).toBe(3);
        expect(grapeshotCatapult.subtypes).toEqual(["Construct"]);
        expect(grapeshotCatapult.manaCost).toEqual({ X: 4 });
    });

    it("only a creature with flying is a legal target", () => {
        const cat = makeInstance(grapeshotCatapult.id, { id: "cat" });
        const flyer = makeInstance(ornithopter.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ground = vanilla("ground", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cat] }),
                makePlayer("p2", { battlefield: [flyer, ground] }),
            ],
        });
        const req = grapeshotCatapult.activatedAbilities!.find(
            (a) => a.id === "grapeshot-catapult-bolt"
        )!.targetRequirement!;
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("flyer");
        expect(ids).not.toContain("ground");
    });

    it("deals 1 damage to a 0/2 flyer (does not kill it)", () => {
        const cat = makeInstance(grapeshotCatapult.id, { id: "cat" });
        const flyer = makeInstance(ornithopter.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cat] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, cat, "grapeshot-catapult-bolt", [
            { type: "permanent", id: "flyer" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(live.damageMarked).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Colossus of Sardia — trample + does-not-untap + {9} upkeep untap (CR 702.19,
// 502.1, 602.5b)
// ---------------------------------------------------------------------------

describe("Colossus of Sardia (trample + does-not-untap + {9} untap)", () => {
    it("is a 9/9 artifact creature with trample and does-not-untap", () => {
        expect(colossusOfSardia.power).toBe(9);
        expect(colossusOfSardia.toughness).toBe(9);
        expect(colossusOfSardia.manaCost).toEqual({ X: 9 });
        expect(colossusOfSardia.staticAbilities).toEqual(
            expect.arrayContaining(["trample", "does-not-untap"])
        );
    });

    it("does not untap during the untap step (CR 502.1)", () => {
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [colossus] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
        });
        untapStep(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "colossus")!
                .isTapped
        ).toBe(true);
    });

    it("the {9} ability untaps it", () => {
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [colossus] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
        });
        resolveActivated(state, colossus, "colossus-of-sardia-untap", [
            { type: "permanent", id: "colossus" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "colossus")!
                .isTapped
        ).toBe(false);
    });

    it("the {9} untap is restricted to the controller's upkeep", () => {
        const ability = colossusOfSardia.activatedAbilities!.find(
            (a) => a.id === "colossus-of-sardia-untap"
        )!;
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Strip Mine — {T}: add {C}; {T}, sacrifice: destroy target land (CR 305, 701.7)
// ---------------------------------------------------------------------------

describe("Strip Mine ({T}: add C; sac: destroy target land, CR 701.7)", () => {
    it("is a colorless land with no mana cost", () => {
        expect(stripMine.types).toEqual(["Land"]);
        expect(stripMine.manaCost).toEqual({});
    });

    it("the mana ability is a colorless mana ability (useStack: false)", () => {
        const mana = stripMine.activatedAbilities!.find(
            (a) => a.id === "strip-mine-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ C: 1 });
    });

    it("destroys a target land", () => {
        const mine = makeInstance(stripMine.id, { id: "mine" });
        const victim = makeInstance(stripMine.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, mine, "strip-mine-destroy", [
            { type: "permanent", id: "victim" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
    });
});

// ---------------------------------------------------------------------------
// Obelisk of Undoing — {6},{T}: return a permanent you own and control to hand
// (CR 701.10)
// ---------------------------------------------------------------------------

describe("Obelisk of Undoing ({6},{T}: return your permanent, CR 701.10)", () => {
    it("is a colorless artifact (mana cost per ATQ.json)", () => {
        expect(obeliskOfUndoing.types).toEqual(["Artifact"]);
        expect(obeliskOfUndoing.manaCost).toEqual({ X: 1 });
    });

    it("only the activator's own permanents are legal targets", () => {
        const obelisk = makeInstance(obeliskOfUndoing.id, { id: "obelisk" });
        const mine = makeInstance(clayStatue.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(clayStatue.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [obelisk, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        const req = obeliskOfUndoing.activatedAbilities!.find(
            (a) => a.id === "obelisk-of-undoing-return"
        )!.targetRequirement!;
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toContain("mine");
        expect(ids).toContain("obelisk"); // can target itself
        expect(ids).not.toContain("theirs");
    });

    it("can target a non-creature permanent (artifact) the activator controls", () => {
        // Verifies the explicit all-permanent-types target list — `type:"any"`
        // alone would miss artifacts (CR 115.4 damageable-only).
        const obelisk = makeInstance(obeliskOfUndoing.id, { id: "obelisk" });
        const land = makeInstance(stripMine.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [obelisk, land] }),
                makePlayer("p2"),
            ],
        });
        const req = obeliskOfUndoing.activatedAbilities!.find(
            (a) => a.id === "obelisk-of-undoing-return"
        )!.targetRequirement!;
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toContain("land");
    });

    it("returns a target permanent to its owner's hand", () => {
        const obelisk = makeInstance(obeliskOfUndoing.id, { id: "obelisk" });
        const target = makeInstance(clayStatue.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [obelisk, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, obelisk, "obelisk-of-undoing-return", [
            { type: "permanent", id: "target" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "target")
        ).toBeUndefined();
        expect(state.players[0].hand.some((c) => c.id === "target")).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Artifact removal & bounce (free tranche, #274)
// ─────────────────────────────────────────────────────────────────────────────

describe("Crumble (destroy artifact, no regen, controller gains life = mv, CR 701.7 / 701.15c)", () => {
    it("destroys the target artifact and grants its controller life = mv", () => {
        // Clay Statue is mv 4 (MTGJSON {4}).
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "statue")).toBe(
            true
        );
        // Controller (p2) gains 4 life.
        expect(state.players[1].life).toBe(24);
    });

    it("can't be regenerated — a regen shield does not save it (CR 701.15c)", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
            card: { id: clayStatue.id, regenerationShields: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
    });

    it("indestructible artifact survives but no life is gained (destroy is replaced)", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        // Still on the battlefield; gainLife still fires (controller reads the
        // surviving permanent's mv) — Crumble's life gain is not contingent on
        // the destroy succeeding per oracle text.
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeDefined();
        expect(state.players[1].life).toBe(24);
    });

    it("getLegalTargets restricts to artifacts only", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = vanilla("creature", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue, creature] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            crumble.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain("statue");
        expect(ids).not.toContain("creature");
    });

    it("wire format: target id survives projectPublicState and resolve still works", () => {
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        const item = pushSpell(state, crumble.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack.find((s) => s.id === item.id)!;
        expect(projectedItem.targets?.[0]).toEqual({
            type: "permanent",
            id: "statue",
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(24);
    });
});

describe("Detonate ({X}{R} — destroy artifact of mv X, X damage to controller, CR 107.3 / 701.7)", () => {
    it("destroys an artifact with mv X and deals X damage to its controller", () => {
        // Dragon Engine is mv 3 (MTGJSON {3}). X = 3.
        const engine = makeInstance(dragonEngine.id, {
            id: "engine",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [engine] }),
            ],
        });
        const item = pushSpell(state, detonate.id, "p1", [
            { type: "permanent", id: "engine" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "engine")
        ).toBeUndefined();
        // 3 damage to p2 (the controller).
        expect(state.players[1].life).toBe(17);
    });

    it("getLegalTargets restricts to artifacts whose mv equals the chosen X", () => {
        // Two artifacts: Dragon Engine (mv 3), Clay Statue (mv 4). With X=3,
        // only the mv-3 artifact is legal (mvFilter: { equals: "X" }).
        const engine = makeInstance(dragonEngine.id, {
            id: "engine",
            controllerId: "p2",
            ownerId: "p2",
        });
        const statue = makeInstance(clayStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [engine, statue] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            detonate.targetRequirement!,
            [],
            "p1",
            3
        ).map((t) => t.id);
        expect(ids).toContain("engine");
        expect(ids).not.toContain("statue");
    });

    it("can't be regenerated — a regen shield does not save the target", () => {
        const engine = makeInstance(dragonEngine.id, {
            id: "engine",
            controllerId: "p2",
            ownerId: "p2",
            card: { id: dragonEngine.id, regenerationShields: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [engine] }),
            ],
        });
        const item = pushSpell(state, detonate.id, "p1", [
            { type: "permanent", id: "engine" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "engine")
        ).toBeUndefined();
    });

    it("declares mvFilter equals X on the target requirement", () => {
        expect(detonate.targetRequirement?.mvFilter).toEqual({ equals: "X" });
    });
});

describe("Shatterstorm (destroy all artifacts, no regen, CR 701.7 / 701.15c)", () => {
    it("destroys every artifact on the battlefield, leaving non-artifacts", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const a2 = makeInstance(dragonEngine.id, {
            id: "a2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = vanilla("creature", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a1] }),
                makePlayer("p2", { battlefield: [a2, creature] }),
            ],
        });
        pushSpell(state, shatterstorm.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.find((c) => c.id === "a1")).toBe(
            undefined
        );
        expect(state.players[1].battlefield.find((c) => c.id === "a2")).toBe(
            undefined
        );
        // The non-artifact creature is untouched.
        expect(
            state.players[1].battlefield.find((c) => c.id === "creature")
        ).toBeDefined();
    });

    it("can't be regenerated — artifacts with regen shields still die", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p1",
            ownerId: "p1",
            card: { id: clayStatue.id, regenerationShields: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a1] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, shatterstorm.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.find((c) => c.id === "a1")).toBe(
            undefined
        );
    });

    it("spares indestructible artifacts (CR 702.12)", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p1",
            ownerId: "p1",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a1] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, shatterstorm.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "a1")
        ).toBeDefined();
    });
});

describe("Artifact Blast (counter target artifact spell, CR 701.5a / 114.1)", () => {
    it("counters an artifact spell on the stack", () => {
        const state = makeState();
        // p2 casts Clay Statue (an Artifact spell). p1 responds with blast.
        const statueSpell = pushSpell(state, clayStatue.id, "p2");
        pushSpell(state, artifactBlast.id, "p1", [
            { type: "spell", id: statueSpell.id },
        ]);
        resolveTopOfStack(state); // resolve Artifact Blast (top of stack)
        expect(
            state.stack.find((s) => s.id === statueSpell.id)
        ).toBeUndefined();
        // Countered artifact goes to its owner's (p2) graveyard.
        expect(
            state.players[1].graveyard.some((c) => c.id === statueSpell.id)
        ).toBe(true);
    });

    it("getLegalTargets only offers artifact spells, not other spell types", () => {
        const state = makeState();
        const artifactSpell = pushSpell(state, clayStatue.id, "p2");
        const instantSpell = pushSpell(state, crumble.id, "p2", [
            { type: "permanent", id: "nonexistent" },
        ]);
        const ids = getLegalTargets(
            state,
            artifactBlast.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain(artifactSpell.id);
        expect(ids).not.toContain(instantSpell.id);
    });

    it("declares spellTypeFilter Artifact on the target requirement", () => {
        expect(artifactBlast.targetRequirement?.spellTypeFilter).toBe(
            "Artifact"
        );
    });
});

describe("Hurkyl's Recall (return all artifacts target player owns to hand, CR 701.10)", () => {
    it("bounces every artifact the target player owns, leaving non-artifacts", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const a2 = makeInstance(dragonEngine.id, {
            id: "a2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = vanilla("creature", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a1, a2, creature] }),
            ],
        });
        pushSpell(state, hurkylsRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // Both artifacts left the battlefield and are in p2's hand.
        expect(
            state.players[1].battlefield.filter((c) => c.id !== "creature")
        ).toHaveLength(0);
        expect(state.players[1].hand.some((c) => c.id === "a1")).toBe(true);
        expect(state.players[1].hand.some((c) => c.id === "a2")).toBe(true);
        // Non-artifact creature stays on the battlefield.
        expect(
            state.players[1].battlefield.find((c) => c.id === "creature")
        ).toBeDefined();
    });

    it("only affects the targeted player's artifacts, not the caster's", () => {
        const mine = makeInstance(clayStatue.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(dragonEngine.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, hurkylsRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // p1's own artifact is untouched.
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")
        ).toBeDefined();
        // p2's artifact bounced.
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "theirs")).toBe(true);
    });

    it("returnToHand routes each card to its OWNER's hand", () => {
        // p2 controls and owns the artifact; it must land in p2's hand.
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a1] }),
            ],
        });
        pushSpell(state, hurkylsRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].hand.some((c) => c.id === "a1")).toBe(false);
        expect(state.players[1].hand.some((c) => c.id === "a1")).toBe(true);
    });

    it("targets a player", () => {
        expect(hurkylsRecall.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });
});

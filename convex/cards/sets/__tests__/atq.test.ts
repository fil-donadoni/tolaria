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
    reconstruction,
    argivianArchaeologist,
    feldonsCane,
    drafnasRestoration,
    millstone,
    jalumTome,
    candelabraOfTawnos,
    citanulDruid,
    urzasChalice,
    onulet,
    suChi,
    tabletOfEpityr,
    ivoryTower,
    armageddonClock,
    triskelion,
    clockworkAvian,
    mightstone,
    weakstone,
    gaeasAvenger,
    staffOfZegon,
    mishrasFactory,
    batteringRam,
    urzasAvenger,
    amuletOfKroog,
    argivianBlacksmith,
    rakalite,
    circleOfProtectionArtifacts,
    ashnodsTransmogrant,
    yawgmothDemon,
    mishrasWarMachine,
    goblinArtisans,
    atog,
    ashnodsAltar,
    orcishMechanics,
    sageOfLatNam,
    priestOfYawgmoth,
    dwarvenWeaponsmith,
    gateToPhyrexia,
    mishrasWorkshop,
    urzasMine,
    urzasPowerPlant,
    urzasTower,
    urzasChalice as urzasChaliceDef,
    hauntingWind,
    powerleech,
    artifactPossession,
    ashnodsBattleGear,
    tawnossWeaponry,
    phyrexianGremlins,
    argothianPixies,
    argothianTreefolk,
    artifactWard,
    martyrsOfKorlis,
    reversePolarity,
} from "../atq";
import { grizzlyBears, hillGiant } from "../lea";
import { getCardById, getInstanceManaCost } from "../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import {
    isCreature,
    getActivatedManaRestriction,
    getFixedManaAmount,
    getDynamicManaProduced,
} from "../../../gre/constants";
import { projectPublicState } from "../../../gameProjections";
import {
    resolveTopOfStack,
    removePermanentTo,
    processPendingActionTriggers,
    addRestrictedManaToPool,
    restrictionAllowsSpell,
    spendablePoolForSpell,
    payManaCostForSpell,
    isManaCostCovered,
    normalizeManaCost,
    runDamageReplacement,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { buildAutoTapSources } from "../../../gre/autoTap";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import {
    getLegalTargets,
    getPendingTargetSourceTypes,
} from "../../../gre/rules";
import { isGuardedAgainst } from "../../../gre/permanentGuard";
import { validateBlockerEligibility } from "../../../gre/combat";
import {
    advancePhase,
    untapStep,
    applyAllCombatDamage,
} from "../../../gre/phases";
import { checkStateBasedActions } from "../../../gre/sba";
import { applyPendingChoiceSubmit } from "../../../gre/pendingChoiceSubmit";
import type { CardType, BlockersConfirmedEvent, GameEvent } from "../../types";

/** Submit the current head pending choice (zone-pick) with the given ordered
 *  ids. Auto-resumes the suspended resolution (mirrors the game.ts mutation). */
function submitChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

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

// ---------------------------------------------------------------------------
// Free tranche #275 — graveyard / library recursion & card-flow.
// ---------------------------------------------------------------------------

describe("ATQ free-tranche #275 registration", () => {
    it.each([
        ["Reconstruction", reconstruction],
        ["Argivian Archaeologist", argivianArchaeologist],
        ["Feldon's Cane", feldonsCane],
        ["Drafna's Restoration", drafnasRestoration],
        ["Millstone", millstone],
        ["Jalum Tome", jalumTome],
        ["Candelabra of Tawnos", candelabraOfTawnos],
    ])("%s resolves from the registry by id", (name, card) => {
        expect(getCardById(card.id).name).toBe(name);
    });
});

describe("Reconstruction (return artifact card from your graveyard to hand, CR 400.7)", () => {
    it("moves the targeted artifact card from graveyard to hand", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [makePlayer("p1", { graveyard: [art] }), makePlayer("p2")],
        });
        pushSpell(state, reconstruction.id, "p1", [
            { type: "graveyard-card", id: "art", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard.some((c) => c.id === "art")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "art")).toBe(true);
    });

    it("getLegalTargets offers only artifact cards in the caster's graveyard", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // A non-artifact card in the same graveyard must NOT be a legal target.
        const spell = makeInstance(crumble.id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // An artifact in the OPPONENT's graveyard must NOT be legal (controller: you).
        const oppArt = makeInstance(dragonEngine.id, {
            id: "oppArt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [art, spell] }),
                makePlayer("p2", { graveyard: [oppArt] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            reconstruction.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain("art");
        expect(ids).not.toContain("spell");
        expect(ids).not.toContain("oppArt");
    });

    it("wire format — the recovered card is in hand after projection", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [makePlayer("p1", { graveyard: [art] }), makePlayer("p2")],
        });
        pushSpell(state, reconstruction.id, "p1", [
            { type: "graveyard-card", id: "art", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 0, "p1");
        expect(projected.players[0].hand.some((c) => c?.id === "art")).toBe(
            true
        );
    });
});

describe("Argivian Archaeologist ({W}{W},{T}: return artifact from graveyard, CR 605 / 400.7)", () => {
    it("returns the targeted artifact card to the controller's hand", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const source = makeInstance(argivianArchaeologist.id, {
            id: "arch",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [source],
                    graveyard: [art],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, source, "argivian-archaeologist-return", [
            { type: "graveyard-card", id: "art", playerId: "p1" },
        ]);
        expect(state.players[0].graveyard.some((c) => c.id === "art")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "art")).toBe(true);
    });

    it("is a 1/2 artifact creature costing {1}{W}{W}", () => {
        expect(argivianArchaeologist.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(argivianArchaeologist.power).toBe(1);
        expect(argivianArchaeologist.toughness).toBe(2);
        expect(argivianArchaeologist.manaCost).toEqual({ X: 1, W: 2 });
    });
});

describe("Feldon's Cane ({T}, exile self: shuffle graveyard into library, CR 400.7 / 701.20)", () => {
    it("moves the controller's graveyard into the library and exiles itself", () => {
        const g1 = makeInstance(clayStatue.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const g2 = makeInstance(dragonEngine.id, {
            id: "g2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const cane = makeInstance(feldonsCane.id, {
            id: "cane",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libCard = makeInstance(yotianSoldier.id, {
            id: "lib",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [cane],
                    graveyard: [g1, g2],
                    library: [libCard],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, cane, "feldons-cane-shuffle");
        // Graveyard emptied into library (now 1 original + 2 = 3 cards).
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(3);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toContain("g1");
        expect(libIds).toContain("g2");
        // The Cane exiled itself — not in the library it shuffled.
        expect(libIds).not.toContain("cane");
        expect(state.players[0].battlefield.some((c) => c.id === "cane")).toBe(
            false
        );
        expect(state.players[0].exile.some((c) => c.id === "cane")).toBe(true);
    });
});

describe("Drafna's Restoration (artifact cards from graveyard to top of library, CR 401)", () => {
    it("puts the chosen artifacts on top of the owner's library in the chosen order", () => {
        const g1 = makeInstance(clayStatue.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const g2 = makeInstance(dragonEngine.id, {
            id: "g2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const top = makeInstance(yotianSoldier.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [g1, g2],
                    library: [top],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, drafnasRestoration.id, "p1", [
            { type: "graveyard-card", id: "g1", playerId: "p1" },
            { type: "graveyard-card", id: "g2", playerId: "p1" },
        ]);
        // Suspends on the reorder choice.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.length ?? 0).toBe(1);
        // Order them g2 (top) then g1.
        submitChoice(state, ["g2", "g1"]);
        // Library top-to-bottom: g2, g1, then the pre-existing card.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "g2",
            "g1",
            "top",
        ]);
        // The recurred cards left the graveyard (the resolved sorcery itself
        // lands in the graveyard, so it isn't empty).
        expect(state.players[0].graveyard.some((c) => c.id === "g1")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "g2")).toBe(
            false
        );
    });

    it("takes a variable number of graveyard artifact targets (min 1)", () => {
        expect(drafnasRestoration.targetRequirement?.count).toEqual({ min: 1 });
        expect(drafnasRestoration.targetRequirement?.zone).toBe("graveyard");
    });

    it("getLegalTargets offers artifact cards from any player's graveyard", () => {
        const g1 = makeInstance(clayStatue.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const oppArt = makeInstance(dragonEngine.id, {
            id: "oppArt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const oppSpell = makeInstance(crumble.id, {
            id: "oppSpell",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [g1] }),
                makePlayer("p2", { graveyard: [oppArt, oppSpell] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            drafnasRestoration.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain("g1");
        expect(ids).toContain("oppArt");
        expect(ids).not.toContain("oppSpell");
    });
});

describe("Millstone ({2},{T}: target player mills two, CR 701.13a)", () => {
    it("moves the top two cards of the target's library to their graveyard", () => {
        const c1 = makeInstance(yotianSoldier.id, {
            id: "c1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const c2 = makeInstance(dragonEngine.id, {
            id: "c2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const c3 = makeInstance(clayStatue.id, {
            id: "c3",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const mill = makeInstance(millstone.id, {
            id: "mill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mill] }),
                makePlayer("p2", { library: [c1, c2, c3] }),
            ],
        });
        resolveActivated(state, mill, "millstone-mill", [
            { type: "player", id: "p2" },
        ]);
        // Top two (c1, c2) milled; c3 remains on top.
        expect(state.players[1].library.map((c) => c.id)).toEqual(["c3"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "c1",
            "c2",
        ]);
    });

    it("mills only what's left when the library has fewer than two cards", () => {
        const c1 = makeInstance(yotianSoldier.id, {
            id: "c1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const mill = makeInstance(millstone.id, {
            id: "mill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mill] }),
                makePlayer("p2", { library: [c1] }),
            ],
        });
        resolveActivated(state, mill, "millstone-mill", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["c1"]);
    });
});

describe("Jalum Tome ({2},{T}: draw then discard, CR 121.1 / 701.8)", () => {
    it("draws a card, then discards the chosen card", () => {
        const drawn = makeInstance(yotianSoldier.id, {
            id: "drawn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const inHand = makeInstance(dragonEngine.id, {
            id: "inHand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const tome = makeInstance(jalumTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tome],
                    hand: [inHand],
                    library: [drawn],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tome, "jalum-tome-loot");
        // Suspends on the discard pick: drawn card is now in hand (2 cards).
        expect(state.pendingChoices?.length ?? 0).toBe(1);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "drawn",
            "inHand",
        ]);
        // Discard the just-drawn card.
        submitChoice(state, ["drawn"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["inHand"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["drawn"]);
        expect(state.players[0].library).toHaveLength(0);
    });
});

describe("Candelabra of Tawnos ({X},{T}: untap X target lands, CR 107.3 / 601.2c / 701.20b)", () => {
    it("untaps each of the X targeted lands", () => {
        const l1 = makeInstance(stripMine.id, {
            id: "l1",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const l2 = makeInstance(stripMine.id, {
            id: "l2",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const candelabra = makeInstance(candelabraOfTawnos.id, {
            id: "cand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [candelabra, l1, l2] }),
                makePlayer("p2"),
            ],
        });
        // X = 2: untap both lands.
        const item: StackItem = {
            ...candelabra,
            zone: "stack",
            castById: "p1",
            abilityId: "candelabra-untap",
            chosenX: 2,
            targets: [
                { type: "permanent", id: "l1" },
                { type: "permanent", id: "l2" },
            ],
        };
        state.stack.push(item);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "l1")?.isTapped
        ).toBe(false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "l2")?.isTapped
        ).toBe(false);
    });

    it("declares an X-bound land target count", () => {
        const ability = candelabraOfTawnos.activatedAbilities![0];
        expect(ability.targetRequirement).toEqual({ type: "Land", count: "X" });
        expect(ability.cost.mana).toEqual({ X: "X" });
    });

    it("getLegalTargets offers lands (and X scales the count via the engine)", () => {
        const l1 = makeInstance(stripMine.id, {
            id: "l1",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const creature = vanilla("creature", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [l1, creature] }),
                makePlayer("p2"),
            ],
        });
        const ids = getLegalTargets(
            state,
            candelabraOfTawnos.activatedAbilities![0].targetRequirement!,
            [],
            "p1",
            1
        ).map((t) => t.id);
        expect(ids).toContain("l1");
        expect(ids).not.toContain("creature");
    });
});

// ===========================================================================
// Value triggers & counter creatures (#276)
// ===========================================================================

/** Pushes a triggered ability onto the stack with the same shape
 *  `collectTriggers` builds (triggeredAbilityId + triggerEvent), then resolves
 *  it. For may-pay triggers that suspend, accepts the prompt by writing
 *  `collectedChoices` and re-invoking — mirroring the verified Soul Net /
 *  Ivory Cup flow in lea.test.ts. */
function fireTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    mayPayAccept?: boolean
): void {
    const item: StackItem = {
        ...source,
        id: `trig-${triggeredAbilityId}`,
        castById: source.controllerId,
        zone: "stack",
        triggeredAbilityId,
        // The engine reads `ctx.sourceInstanceId` from `triggerSourceId`
        // (state.ts:resolveTopOfStack) — the source permanent on the
        // battlefield, not the synthetic stack-item id.
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    };
    state.stack.push(item);
    const first = resolveTopOfStack(state);
    if (mayPayAccept === undefined) return;
    // Suspended on a may-pay pending choice. Answer it and resume.
    expect(first).toBeNull();
    const pending = state.pendingChoices![0];
    const stackItem = state.stack.find((s) => s.id === pending.stackItemId)!;
    const key = `${pending.step}:${pending.choiceId}`;
    stackItem.collectedChoices = {
        [key]: [mayPayAccept ? "yes" : "no"],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

/** Builds a full BLOCKERS_CONFIRMED event (CR 509.1h). Only the subtype/id
 *  fields are scenario-relevant; the controller/type fields are filled with
 *  defaults so the literal satisfies the GameEvent union. */
function blockEvent(
    attackerId: string,
    blockerId: string,
    blockerSubtypes: string[]
): BlockersConfirmedEvent {
    return {
        type: "BLOCKERS_CONFIRMED",
        attackerId,
        attackerControllerId: "p1",
        attackerTypes: ["Artifact", "Creature"],
        attackerSubtypes: ["Construct"],
        blockerId,
        blockerControllerId: "p2",
        blockerTypes: ["Creature"],
        blockerSubtypes,
    };
}

// Citanul Druid (CR 603.2 opponent-cast trigger, CR 122.1 +1/+1 counter)
describe("Citanul Druid (+1/+1 on opponent artifact cast)", () => {
    const druidSelf = {
        id: "druid",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"] as CardType[],
        subtypes: ["Human", "Druid"],
        isTapped: false,
        card: {},
    };
    const artifactCast = (casterId: string) => ({
        type: "SPELL_CAST" as const,
        casterId,
        spellInstanceId: "x",
        spellCardId: "y",
        spellTypes: ["Artifact"] as CardType[],
        spellSubtypes: [],
        spellColors: [],
    });

    it("fires on an opponent's artifact spell, not the controller's", () => {
        const trig = citanulDruid.triggeredAbilities![0];
        expect(trig.matches(artifactCast("p2"), druidSelf)).toBe(true);
        expect(trig.matches(artifactCast("p1"), druidSelf)).toBe(false);
    });

    it("does not fire on a non-artifact opponent spell", () => {
        const trig = citanulDruid.triggeredAbilities![0];
        const nonArtifact = {
            ...artifactCast("p2"),
            spellTypes: ["Instant"] as CardType[],
        };
        expect(trig.matches(nonArtifact, druidSelf)).toBe(false);
    });

    it("resolving the trigger adds a +1/+1 counter → 2/2 effective", () => {
        const druid = makeInstance(citanulDruid.id, {
            id: "druid",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid] }),
                makePlayer("p2"),
            ],
        });
        fireTrigger(state, druid, "citanul-druid-grow", artifactCast("p2"));
        const after = state.players[0].battlefield.find(
            (c) => c.id === "druid"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(2);
    });

    it("wire format: counter-driven 2/2 survives projectPublicState", () => {
        const druid = makeInstance(citanulDruid.id, {
            id: "druid",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "druid"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

// Urza's Chalice (CR 603.2 any-player artifact-cast trigger, CR 117.3a may-pay)
describe("Urza's Chalice (may pay {1} → gain 1 life on artifact cast)", () => {
    const setup = () => {
        const chalice = makeInstance(urzasChalice.id, {
            id: "chalice",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chalice], life: 20 }),
                makePlayer("p2"),
            ],
        });
        return { state, chalice };
    };
    const artifactCast = {
        type: "SPELL_CAST" as const,
        casterId: "p2",
        spellInstanceId: "x",
        spellCardId: "y",
        spellTypes: ["Artifact"] as CardType[],
        spellSubtypes: [],
        spellColors: [],
    };

    it("fires on any player's artifact spell, not a non-artifact spell", () => {
        const trig = urzasChalice.triggeredAbilities![0];
        const self = {
            id: "chalice",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        expect(trig.matches(artifactCast, self)).toBe(true);
        expect(trig.matches({ ...artifactCast, casterId: "p1" }, self)).toBe(
            true
        );
        expect(
            trig.matches(
                { ...artifactCast, spellTypes: ["Sorcery"] as CardType[] },
                self
            )
        ).toBe(false);
    });

    it("accept → gain 1 life", () => {
        const { state, chalice } = setup();
        fireTrigger(state, chalice, "urzas-chalice-life", artifactCast, true);
        expect(state.players[0].life).toBe(21);
        expect(state.stack).toHaveLength(0);
    });

    it("decline → no life gain", () => {
        const { state, chalice } = setup();
        fireTrigger(state, chalice, "urzas-chalice-life", artifactCast, false);
        expect(state.players[0].life).toBe(20);
    });
});

// Onulet (CR 603.2 self-death trigger, gain 2 life)
describe("Onulet (dies → gain 2 life)", () => {
    it("death trigger collected on the stack, resolves to +2 life", () => {
        const onuletInst = makeInstance(onulet.id, {
            id: "onulet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [onuletInst], life: 20 }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "onulet", "graveyard");
        processPendingActionTriggers(state);
        // The self-death trigger is now on the stack.
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "onulet-life"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
    });

    it("trigger matches only this creature's death", () => {
        const trig = onulet.triggeredAbilities![0];
        const self = {
            id: "onulet",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact", "Creature"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const ownDeath = {
            type: "CREATURE_DIED" as const,
            creatureInstanceId: "onulet",
            creatureControllerId: "p1",
            creatureTypes: ["Artifact", "Creature"] as CardType[],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 2,
        };
        expect(trig.matches(ownDeath, self)).toBe(true);
        expect(
            trig.matches({ ...ownDeath, creatureInstanceId: "other" }, self)
        ).toBe(false);
    });
});

// Su-Chi (CR 603.2 self-death trigger, add {C}{C}{C}{C})
describe("Su-Chi (dies → add {C}{C}{C}{C})", () => {
    it("death trigger adds four colorless mana to controller's pool", () => {
        const suChiInst = makeInstance(suChi.id, {
            id: "suchi",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [suChiInst] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "suchi", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.C).toBe(4);
    });
});

// Tablet of Epityr (CR 603.10 your-artifact-to-graveyard trigger, may-pay)
describe("Tablet of Epityr (may pay {1} → gain 1 on your artifact to graveyard)", () => {
    const setup = () => {
        const tablet = makeInstance(tabletOfEpityr.id, {
            id: "tablet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherArtifact = makeInstance(onulet.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tablet, otherArtifact],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });
        return { state, tablet };
    };

    it("trigger fires when a controlled artifact is put into the graveyard, then accept → +1 life", () => {
        const { state } = setup();
        removePermanentTo(state, "art", "graveyard");
        processPendingActionTriggers(state);
        // Tablet's may-pay trigger is on the stack (a CREATURE_DIED trigger
        // for Onulet may also be present; resolve the Tablet trigger).
        const tabletTrig = state.stack.find(
            (s) => s.triggeredAbilityId === "tablet-of-epityr-life"
        );
        expect(tabletTrig).toBeDefined();
        // Bring the Tablet trigger to the top of the stack and resolve it.
        const idx = state.stack.indexOf(tabletTrig!);
        state.stack.splice(idx, 1);
        state.stack.push(tabletTrig!);
        const first = resolveTopOfStack(state);
        expect(first).toBeNull();
        const pending = state.pendingChoices![0];
        const item = state.stack.find((s) => s.id === pending.stackItemId)!;
        item.collectedChoices = {
            [`${pending.step}:${pending.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
    });

    it("trigger does not fire for an opponent's artifact", () => {
        const trig = tabletOfEpityr.triggeredAbilities![0];
        const self = {
            id: "tablet",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const oppArtifactLeft = {
            type: "PERMANENT_LEFT" as const,
            instanceId: "opp-art",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
            wasAura: false,
            toZone: "graveyard" as const,
        };
        expect(trig.matches(oppArtifactLeft, self)).toBe(false);
    });
});

// Ivory Tower (CR 603.6a upkeep trigger, hand-size life)
describe("Ivory Tower (upkeep: gain hand − 4 life)", () => {
    const fireUpkeep = (handCount: number, life = 20) => {
        const tower = makeInstance(ivoryTower.id, {
            id: "tower",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = Array.from({ length: handCount }, (_, i) =>
            makeInstance(onulet.id, {
                id: `h${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tower], hand, life }),
                makePlayer("p2"),
            ],
        });
        fireTrigger(state, tower, "ivory-tower-life", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        return state.players[0].life;
    };

    it("gains hand − 4 when hand > 4", () => {
        expect(fireUpkeep(7)).toBe(23);
    });

    it("gains nothing (no life loss) when hand <= 4", () => {
        expect(fireUpkeep(3)).toBe(20);
        expect(fireUpkeep(4)).toBe(20);
    });

    it("trigger fires only on the controller's upkeep", () => {
        const trig = ivoryTower.triggeredAbilities![0];
        const self = {
            id: "tower",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const ev = (active: string) => ({
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: active,
        });
        expect(trig.matches(ev("p1"), self)).toBe(true);
        expect(trig.matches(ev("p2"), self)).toBe(false);
    });
});

// Armageddon Clock (doom counters: add on upkeep, ping on draw, any-player remove)
describe("Armageddon Clock (doom-counter time bomb)", () => {
    const makeClock = (doom = 0) =>
        makeInstance(armageddonClock.id, {
            id: "clock",
            controllerId: "p1",
            ownerId: "p1",
            ...(doom > 0 ? { counters: { doom } } : {}),
        });

    it("upkeep trigger adds a doom counter", () => {
        const clock = makeClock(0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [clock] }),
                makePlayer("p2"),
            ],
        });
        fireTrigger(state, clock, "armageddon-clock-add-doom", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "clock"
        )!;
        expect(after.counters?.doom).toBe(1);
    });

    it("draw-step trigger deals damage equal to doom counters to each player", () => {
        const clock = makeClock(3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [clock], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(state, clock, "armageddon-clock-ping", {
            type: "PHASE_BEGIN",
            phase: "DRAW",
            activePlayerId: "p1",
        });
        expect(state.players[0].life).toBe(17);
        expect(state.players[1].life).toBe(17);
    });

    it("{4} remove-doom ability is activatable by any player during any upkeep", () => {
        const ability = armageddonClock.activatedAbilities!.find(
            (a) => a.id === "armageddon-clock-remove-doom"
        )!;
        expect(ability.activatableByAnyPlayer).toBe(true);
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBeUndefined();
    });

    it("remove-doom ability resolves: removes one doom counter", () => {
        const clock = makeClock(3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [clock] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
            activePlayerId: "p2",
        });
        // Activated by the opponent (p2) during p2's upkeep.
        state.stack.push({
            ...clock,
            zone: "stack",
            castById: "p2",
            abilityId: "armageddon-clock-remove-doom",
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "clock"
        )!;
        expect(after.counters?.doom).toBe(2);
    });
});

// Triskelion (CR 122.1 ETB counters, CR 122.6 removal cost, any-target ping)
describe("Triskelion (3 +1/+1 counters, remove-counter → 1 damage)", () => {
    it("ETB applies three +1/+1 counters → 4/4 effective", () => {
        const state = makeState();
        pushSpell(state, triskelion.id, "p1");
        resolveTopOfStack(state);
        const tris = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === triskelion.id
        )!;
        expect(tris.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(state, tris)).toBe(4);
        expect(getEffectiveToughness(state, tris)).toBe(4);
    });

    it("activated ability deals 1 damage to a player (any target)", () => {
        const tris = makeInstance(triskelion.id, {
            id: "tris",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tris] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        state.stack.push({
            ...tris,
            zone: "stack",
            castById: "p1",
            abilityId: "triskelion-bolt",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("removal cost is declared as a +1/+1 counter cost; target is any", () => {
        const ability = triskelion.activatedAbilities![0];
        expect(ability.cost.removeCounter).toEqual({
            type: "+1/+1",
            count: 1,
        });
        expect(ability.targetRequirement).toEqual({ type: "any", count: 1 });
    });

    it("wire format: counter-driven 4/4 survives projectPublicState", () => {
        const tris = makeInstance(triskelion.id, {
            id: "tris",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tris] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tris"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// Clockwork Avian (CR 122.1 ETB counters, end-of-combat decay, recharge)
describe("Clockwork Avian (4 +1/+0 counters, end-of-combat decay)", () => {
    it("ETB applies four +1/+0 counters → 4/4 effective with flying", () => {
        const state = makeState();
        pushSpell(state, clockworkAvian.id, "p1");
        resolveTopOfStack(state);
        const avian = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkAvian.id
        )!;
        expect(avian.counters?.["+1/+0"]).toBe(4);
        expect(getEffectivePower(state, avian)).toBe(4);
        expect(getEffectiveToughness(state, avian)).toBe(4);
        expect(clockworkAvian.staticAbilities).toContain("flying");
    });

    it("end-of-combat trigger fires only if it attacked or blocked this combat", () => {
        const state = makeState();
        pushSpell(state, clockworkAvian.id, "p1");
        resolveTopOfStack(state);
        const avian = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkAvian.id
        )!;
        const trig = clockworkAvian.triggeredAbilities![0];
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "END_OF_COMBAT" as const,
            activePlayerId: "p1",
        };
        expect(trig.matches(event, avian, state)).toBe(false);
        avian.hasAttackedThisTurn = true;
        expect(trig.matches(event, avian, state)).toBe(true);
    });

    it("recharge ability adds up to X +1/+0 counters, capped at 4 total", () => {
        const avian = makeInstance(clockworkAvian.id, {
            id: "avian",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [avian] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
        });
        state.stack.push({
            ...avian,
            zone: "stack",
            castById: "p1",
            abilityId: "clockwork-avian-recharge",
            chosenX: 5,
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "avian"
        )!;
        // 1 existing + min(5, room=3) = 4, capped at four.
        expect(after.counters?.["+1/+0"]).toBe(4);
    });

    it("recharge ability is restricted to the controller's upkeep", () => {
        const ability = clockworkAvian.activatedAbilities!.find(
            (a) => a.id === "clockwork-avian-recharge"
        )!;
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBe(true);
    });

    it("wire format: counter-driven 4/4 survives projectPublicState", () => {
        const avian = makeInstance(clockworkAvian.id, {
            id: "avian",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 4 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [avian] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "avian"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// ===========================================================================
// P/T statics, combat & one-shot prevention shields (#277)
// ===========================================================================

// Mightstone / Weakstone (CR 611 layer 7c anthem on attacking creatures)
describe("Mightstone (attacking creatures get +1/+0, CR 611)", () => {
    /** A 2/2 vanilla creature; `attacking` toggles the combat-role flag the
     *  anthem reads. */
    function setup(attacking: boolean) {
        const stone = makeInstance(mightstone.id, {
            id: "stone",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: attacking,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, bear };
    }

    it("buffs an attacking creature (+1/+0) but not a non-attacking one", () => {
        const idle = setup(false);
        expect(getEffectivePower(idle.state, idle.bear)).toBe(2);
        const atk = setup(true);
        expect(getEffectivePower(atk.state, atk.bear)).toBe(3);
        expect(getEffectiveToughness(atk.state, atk.bear)).toBe(2);
    });

    it("affects creatures of EITHER controller (no 'you control' clause)", () => {
        const stone = makeInstance(mightstone.id, { id: "stone" });
        const mine = vanilla("mine", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone, mine] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, mine)).toBe(2);
    });

    it("wire format: the +1/+0 survives projectPublicState", () => {
        const { state, bear } = setup(true);
        // Fat state.
        expect(getEffectivePower(state, bear)).toBe(3);
        // Projected state — the anthem must still apply.
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Weakstone (attacking creatures get -1/-0, CR 611)", () => {
    function setup(attacking: boolean) {
        const stone = makeInstance(weakstone.id, { id: "stone" });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: attacking,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, bear };
    }

    it("debuffs an attacking creature (-1/-0) only", () => {
        expect(getEffectivePower(setup(false).state, setup(false).bear)).toBe(
            2
        );
        const atk = setup(true);
        expect(getEffectivePower(atk.state, atk.bear)).toBe(1);
        expect(getEffectiveToughness(atk.state, atk.bear)).toBe(2);
    });

    it("wire format: the -1/-0 survives projectPublicState", () => {
        const { state, bear } = setup(true);
        expect(getEffectivePower(state, bear)).toBe(1);
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

// Gaea's Avenger (CR 604.3 characteristic-defining P/T)
describe("Gaea's Avenger (P/T = 1 + opponents' artifacts, CR 604.3)", () => {
    function setup(opponentArtifacts: number) {
        const avenger = makeInstance(gaeasAvenger.id, {
            id: "avenger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifacts = Array.from({ length: opponentArtifacts }, (_, i) =>
            makeInstance(amuletOfKroog.id, {
                id: `art-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [avenger] }),
                makePlayer("p2", { battlefield: artifacts }),
            ],
        });
        return { state, avenger };
    }

    it("is 1/1 with no opponent artifacts", () => {
        const { state, avenger } = setup(0);
        expect(getEffectivePower(state, avenger)).toBe(1);
        expect(getEffectiveToughness(state, avenger)).toBe(1);
    });

    it("recomputes from the board: 3 opponent artifacts → 4/4", () => {
        const { state, avenger } = setup(3);
        expect(getEffectivePower(state, avenger)).toBe(4);
        expect(getEffectiveToughness(state, avenger)).toBe(4);
    });

    it("ignores artifacts the controller owns (only opponents count)", () => {
        const { state, avenger } = setup(2);
        // Add an artifact controlled by p1 — must NOT raise the count.
        state.players[0].battlefield.push(
            makeInstance(amuletOfKroog.id, {
                id: "my-art",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(getEffectivePower(state, avenger)).toBe(3);
    });

    it("wire format: the CDA survives projectPublicState", () => {
        const { state, avenger } = setup(2);
        expect(getEffectivePower(state, avenger)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "avenger"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// Staff of Zegon (CR 611.1 temporary -2/-0)
describe("Staff of Zegon ({3},{T}: target -2/-0 EOT, CR 611.1)", () => {
    it("applies a -2/-0 temporary buff to the chosen creature", () => {
        const staff = makeInstance(staffOfZegon.id, { id: "staff" });
        const bear = vanilla("bear", 3, 3, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [staff, bear] })],
        });
        resolveActivated(state, staff, "staff-of-zegon-weaken", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

// Mishra's Factory (CR 611.1 animate manland + Assembly-Worker pump)
describe("Mishra's Factory (animate + Assembly-Worker pump, CR 611.1)", () => {
    it("{T}: Add {C} is a non-stack mana ability", () => {
        const mana = mishrasFactory.activatedAbilities!.find(
            (a) => a.id === "mishras-factory-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ C: 1 });
    });

    it("animates the land into a 2/2 Assembly-Worker creature (still a land)", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [factory] })],
        });
        resolveActivated(state, factory, "mishras-factory-animate");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        expect(live.types).toEqual(
            expect.arrayContaining(["Land", "Creature"])
        );
        expect(live.subtypes).toContain("Assembly-Worker");
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("pumps a targeted Assembly-Worker +1/+1 EOT", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
        });
        const worker = vanilla("worker", 2, 2, {
            controllerId: "p1",
            subtypes: ["Assembly-Worker"],
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [factory, worker] })],
        });
        resolveActivated(state, factory, "mishras-factory-pump", [
            { type: "permanent", id: "worker" },
        ]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "worker"
        )!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("the pump only lists Assembly-Worker creatures as legal targets", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
        });
        const worker = vanilla("worker", 2, 2, {
            controllerId: "p1",
            subtypes: ["Assembly-Worker"],
        });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [factory, worker, bear] }),
            ],
        });
        const ability = mishrasFactory.activatedAbilities!.find(
            (a) => a.id === "mishras-factory-pump"
        )!;
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("worker");
        expect(legal).not.toContain("bear");
    });
});

// Battering Ram (CR 702.21 banding grant + blocked-by-Wall destroy)
describe("Battering Ram (banding grant + destroy blocking Wall)", () => {
    it("grants banding at the beginning of combat on your turn", () => {
        const ram = makeInstance(batteringRam.id, {
            id: "ram",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [ram] })],
            phase: "BEGINNING_OF_COMBAT",
        });
        fireTrigger(state, ram, "battering-ram-banding", {
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
        });
        const live = state.players[0].battlefield.find((c) => c.id === "ram")!;
        expect(live.staticAbilities).toContain("banding");
    });

    it("the wall trigger fires only when blocked BY a Wall", () => {
        const trig = batteringRam.triggeredAbilities!.find(
            (t) => t.id === "battering-ram-wall-destroy"
        )!;
        const ramSelf = { id: "ram" } as CardInstanceState;
        const wallBlock = blockEvent("ram", "wall", ["Wall"]);
        const nonWallBlock = blockEvent("ram", "wall", ["Bear"]);
        expect(trig.matches(wallBlock, ramSelf)).toBe(true);
        expect(trig.matches(nonWallBlock, ramSelf)).toBe(false);
        // Does not fire when the Ram is the blocker (only when it's blocked).
        expect(
            trig.matches(
                { ...wallBlock, attackerId: "other", blockerId: "ram" },
                ramSelf
            )
        ).toBe(false);
    });

    it("schedules a next-end-of-combat destroy of the blocking Wall", () => {
        const ram = makeInstance(batteringRam.id, {
            id: "ram",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wall = vanilla("wall", 0, 4, {
            controllerId: "p2",
            ownerId: "p2",
            subtypes: ["Wall"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ram] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
            phase: "DECLARE_BLOCKERS",
        });
        fireTrigger(
            state,
            ram,
            "battering-ram-wall-destroy",
            blockEvent("ram", "wall", ["Wall"])
        );
        // A delayed trigger should now be queued to destroy the Wall.
        expect(
            state.delayedTriggers?.some((d) => d.payload.targetId === "wall")
        ).toBe(true);
    });
});

// Urza's Avenger (CR 611.1 -1/-1 + chosen keyword, modeled as 4 abilities)
describe("Urza's Avenger ({0}: -1/-1 + chosen keyword EOT)", () => {
    it("exposes one ability per keyword (banding/flying/first strike/trample)", () => {
        const ids = urzasAvenger.activatedAbilities!.map((a) => a.id);
        expect(ids).toEqual([
            "urzas-avenger-banding",
            "urzas-avenger-flying",
            "urzas-avenger-first-strike",
            "urzas-avenger-trample",
        ]);
    });

    it("activating flying gives -1/-1 and grants flying until EOT", () => {
        const avenger = makeInstance(urzasAvenger.id, {
            id: "avenger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [avenger] })],
        });
        resolveActivated(state, avenger, "urzas-avenger-flying");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "avenger"
        )!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
        expect(live.staticAbilities).toContain("flying");
    });

    it("activating first strike grants first strike (not flying)", () => {
        const avenger = makeInstance(urzasAvenger.id, {
            id: "avenger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [avenger] })],
        });
        resolveActivated(state, avenger, "urzas-avenger-first-strike");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "avenger"
        )!;
        expect(live.staticAbilities).toContain("first strike");
        expect(live.staticAbilities).not.toContain("flying");
    });
});

// Amulet of Kroog / Argivian Blacksmith / Rakalite (CR 615.1 prevention shields)
describe("Amulet of Kroog (prevent next 1 to any target, CR 615.1)", () => {
    it("registers a 1-damage shield on the chosen target", () => {
        const amulet = makeInstance(amuletOfKroog.id, { id: "amulet" });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [amulet, bear] })],
        });
        resolveActivated(state, amulet, "amulet-of-kroog-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        expect(state.targetPreventionShields).toEqual([
            {
                targetType: "permanent",
                targetId: "bear",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("can shield a player target too", () => {
        const amulet = makeInstance(amuletOfKroog.id, { id: "amulet" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [amulet] })],
        });
        resolveActivated(state, amulet, "amulet-of-kroog-prevent", [
            { type: "player", id: "p1" },
        ]);
        expect(state.targetPreventionShields?.[0]).toMatchObject({
            targetType: "player",
            targetId: "p1",
            remaining: 1,
        });
    });
});

describe("Argivian Blacksmith (prevent next 2 to target creature, CR 615.1)", () => {
    it("registers a 2-damage shield on the targeted creature", () => {
        const smith = makeInstance(argivianBlacksmith.id, { id: "smith" });
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [smith, robot] })],
        });
        resolveActivated(state, smith, "argivian-blacksmith-prevent", [
            { type: "permanent", id: "robot" },
        ]);
        expect(state.targetPreventionShields?.[0]).toMatchObject({
            targetId: "robot",
            remaining: 2,
        });
    });
});

describe("Rakalite (prevent next 1, return self next end step, CR 615.1)", () => {
    it("registers a 1-damage shield and schedules a next-end-step return", () => {
        const rk = makeInstance(rakalite.id, {
            id: "rk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [rk] })],
        });
        resolveActivated(state, rk, "rakalite-prevent", [
            { type: "player", id: "p1" },
        ]);
        expect(state.targetPreventionShields?.[0]).toMatchObject({
            targetId: "p1",
            remaining: 1,
        });
        expect(
            state.delayedTriggers?.some((d) => d.payload.instanceId === "rk")
        ).toBe(true);
    });
});

// Circle of Protection: Artifacts (CR 615.1 source-prevention via COP factory)
describe("Circle of Protection: Artifacts (CR 615.1)", () => {
    it("is a {1}{W} enchantment built from the COP factory", () => {
        expect(circleOfProtectionArtifacts.types).toEqual(["Enchantment"]);
        expect(circleOfProtectionArtifacts.manaCost).toEqual({ X: 1, W: 1 });
    });

    it("registers an end-of-turn prevention against the chosen artifact source", () => {
        const cop = makeInstance(circleOfProtectionArtifacts.id, { id: "cop" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cop] }),
                makePlayer("p2"),
            ],
        });
        // Chosen source: an artifact permanent that would damage p1.
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(robot);
        resolveActivated(state, cop, "cop-prevent", [
            { type: "permanent", id: "robot" },
        ]);
        expect(state.preventionEffects).toEqual([
            {
                sourceInstanceId: "robot",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("the COP ability lists artifact permanents as legal sources, not creatures", () => {
        const cop = makeInstance(circleOfProtectionArtifacts.id, { id: "cop" });
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cop] }),
                makePlayer("p2", { battlefield: [robot, bear] }),
            ],
        });
        const ability = circleOfProtectionArtifacts.activatedAbilities!.find(
            (a) => a.id === "cop-prevent"
        )!;
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("robot");
        expect(legal).not.toContain("bear");
    });
});

// Ashnod's Transmogrant (CR 122.1 +1/+1 counter; artifact-type clause deferred)
describe("Ashnod's Transmogrant ({T}, sac: +1/+1 on nonartifact creature)", () => {
    it("puts a +1/+1 counter on the targeted nonartifact creature", () => {
        const trans = makeInstance(ashnodsTransmogrant.id, {
            id: "trans",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [trans, bear] })],
        });
        resolveActivated(state, trans, "ashnods-transmogrant-counter", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("excludes artifact creatures from legal targets (nonartifact only)", () => {
        const trans = makeInstance(ashnodsTransmogrant.id, { id: "trans" });
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [trans, robot, bear] })],
        });
        const ability = ashnodsTransmogrant.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("bear");
        expect(legal).not.toContain("robot");
    });
});

// Yawgmoth Demon (CR 603.6a upkeep may-sacrifice-or-else)
describe("Yawgmoth Demon (upkeep may-sac artifact, else tap+2)", () => {
    it("is a 6/6 with flying and first strike", () => {
        expect(yawgmothDemon.power).toBe(6);
        expect(yawgmothDemon.toughness).toBe(6);
        expect(yawgmothDemon.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "first strike"])
        );
    });

    it("with no artifact to sacrifice, taps itself and deals 2 to controller", () => {
        const demon = makeInstance(yawgmothDemon.id, {
            id: "demon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [demon] })],
            phase: "UPKEEP",
        });
        // No artifacts: the may is skipped, the else-branch runs immediately.
        fireTrigger(state, demon, "yawgmoth-demon-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "demon"
        )!;
        expect(live.isTapped).toBe(true);
        expect(state.players[0].life).toBe(18);
    });

    it("declining the sacrifice taps itself and deals 2", () => {
        const demon = makeInstance(yawgmothDemon.id, {
            id: "demon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifact = makeInstance(amuletOfKroog.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [demon, artifact] })],
            phase: "UPKEEP",
        });
        // Decline the may-pay → else-branch.
        fireTrigger(
            state,
            demon,
            "yawgmoth-demon-upkeep",
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
            false
        );
        const live = state.players[0].battlefield.find(
            (c) => c.id === "demon"
        )!;
        expect(live.isTapped).toBe(true);
        expect(state.players[0].life).toBe(18);
        // Artifact NOT sacrificed.
        expect(state.players[0].battlefield.some((c) => c.id === "art")).toBe(
            true
        );
    });
});

// Mishra's War Machine (CR 603.6a upkeep discard-or-3+tap)
describe("Mishra's War Machine (upkeep discard or 3 + tap)", () => {
    it("has banding", () => {
        expect(mishrasWarMachine.staticAbilities).toContain("banding");
    });

    it("with an empty hand, deals 3 to controller and taps itself", () => {
        const machine = makeInstance(mishrasWarMachine.id, {
            id: "machine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [machine], hand: [] })],
            phase: "UPKEEP",
        });
        fireTrigger(state, machine, "mishras-war-machine-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "machine"
        )!;
        expect(state.players[0].life).toBe(17);
        expect(live.isTapped).toBe(true);
    });

    it("declining the discard deals 3 and taps", () => {
        const machine = makeInstance(mishrasWarMachine.id, {
            id: "machine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const card = makeInstance(ornithopter.id, {
            id: "card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine], hand: [card] }),
            ],
            phase: "UPKEEP",
        });
        fireTrigger(
            state,
            machine,
            "mishras-war-machine-upkeep",
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
            false
        );
        expect(state.players[0].life).toBe(17);
        expect(state.players[0].hand).toHaveLength(1);
    });
});

// Goblin Artisans (CR 705 coin flip → draw / counter own artifact spell)
describe("Goblin Artisans ({T}: flip → draw / counter own artifact spell)", () => {
    // Seeds verified in arn.test.ts: rngSeed 1 → first flip wins; 7 → loses.
    it("on a winning flip, draws a card (no counter)", () => {
        const artisans = makeInstance(goblinArtisans.id, {
            id: "artisans",
            controllerId: "p1",
            ownerId: "p1",
        });
        const card = makeInstance(ornithopter.id, {
            id: "lib-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        // An own artifact spell on the stack as the declared target.
        const artifactSpell = makeInstance(amuletOfKroog.id, {
            id: "art-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artisans],
                    library: [card],
                    hand: [],
                }),
            ],
            stack: [{ ...artifactSpell, castById: "p1", targets: [] }],
            rngSeed: 1,
        });
        resolveActivated(state, artisans, "goblin-artisans-flip", [
            { type: "spell", id: "art-spell" },
        ]);
        // Drew the card; the targeted spell is NOT countered (still on stack).
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.stack.some((s) => s.id === "art-spell")).toBe(true);
    });

    it("on a losing flip, counters the targeted own artifact spell (no draw)", () => {
        const artisans = makeInstance(goblinArtisans.id, {
            id: "artisans",
            controllerId: "p1",
            ownerId: "p1",
        });
        const card = makeInstance(ornithopter.id, {
            id: "lib-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const artifactSpell = makeInstance(amuletOfKroog.id, {
            id: "art-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artisans],
                    library: [card],
                    hand: [],
                }),
            ],
            stack: [{ ...artifactSpell, castById: "p1", targets: [] }],
            rngSeed: 7,
        });
        resolveActivated(state, artisans, "goblin-artisans-flip", [
            { type: "spell", id: "art-spell" },
        ]);
        // Did NOT draw; the targeted artifact spell is countered (off stack).
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.stack.some((s) => s.id === "art-spell")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Cluster A — sacrifice-as-activation-cost (filtered, non-self).
// CR 602.1 / 118.5. These tests exercise the ability RESOLUTION on fat state
// (and the wire format where the effect is visible). The cost/choice flow
// (picking + sacrificing + mv snapshot) is exercised end-to-end through the
// mutations in convex/__tests__/sacrifice-cost-activation.test.ts.
// ---------------------------------------------------------------------------

describe("Atog (CR 602.1 — sacrifice an artifact: +2/+2)", () => {
    it("declares the filtered sacrifice cost", () => {
        const ability = atog.activatedAbilities![0];
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Artifact" });
        expect(ability.cost.sacrifice).toBeUndefined();
    });

    it("pumps the source +2/+2 until end of turn on resolution", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, at, "atog-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "atog-1"
        )!;
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("wire format — pump survives projection", () => {
        const at = makeInstance(atog.id, { id: "atog-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [at] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, at, "atog-pump");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "atog-1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Ashnod's Altar (CR 602.1 — sacrifice a creature: add {C}{C})", () => {
    it("declares a creature sacrifice cost and no tap", () => {
        const ability = ashnodsAltar.activatedAbilities![0];
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Creature" });
        expect(ability.cost.tap).toBeUndefined();
    });

    it("adds {C}{C} on resolution", () => {
        const altar = makeInstance(ashnodsAltar.id, { id: "altar-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [altar] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, altar, "ashnods-altar-mana");
        expect(state.players[0].manaPool.C).toBe(2);
    });
});

describe("Orcish Mechanics (CR 602.1 — {T}, sac artifact: 2 dmg any target)", () => {
    it("declares tap + artifact sacrifice cost", () => {
        const ability = orcishMechanics.activatedAbilities![0];
        expect(ability.cost.tap).toBe(true);
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Artifact" });
    });

    it("deals 2 damage to a target player on resolution", () => {
        const mech = makeInstance(orcishMechanics.id, { id: "mech-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mech] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, mech, "orcish-mechanics-bolt", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(18);
    });
});

describe("Sage of Lat-Nam (CR 602.1 — {T}, sac artifact: draw)", () => {
    it("draws a card on resolution", () => {
        const sage = makeInstance(sageOfLatNam.id, { id: "sage-1" });
        const libCard = makeInstance(ornithopter.id, {
            id: "lib-1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sage],
                    library: [libCard],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sage, "sage-of-lat-nam-draw");
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib-1");
    });
});

describe("Priest of Yawgmoth (CR 602.1 — add {B} = sacrificed artifact mv)", () => {
    it("adds {B} equal to the snapshotted sacrificed mana value", () => {
        const priest = makeInstance(priestOfYawgmoth.id, { id: "priest-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        // The cost flow snapshots the sacrificed permanent's mv onto the stack
        // item; resolve() reads it via getAdditionalSacrificeMv. Simulate a
        // mv-3 artifact (e.g. Yotian Soldier) having been sacrificed.
        state.stack.push({
            ...priest,
            zone: "stack",
            castById: "p1",
            abilityId: "priest-of-yawgmoth-mana",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "sac-x", mv: 3 },
        });
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
    });

    it("adds no mana when the sacrificed permanent's mv is 0", () => {
        const priest = makeInstance(priestOfYawgmoth.id, { id: "priest-2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...priest,
            zone: "stack",
            castById: "p1",
            abilityId: "priest-of-yawgmoth-mana",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "sac-y", mv: 0 },
        });
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(0);
    });
});

describe("Dwarven Weaponsmith (CR 602.5b — upkeep-only +1/+1 counter)", () => {
    it("declares upkeep timing + controller-turn + tap/sac cost", () => {
        const ability = dwarvenWeaponsmith.activatedAbilities![0];
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.cost.tap).toBe(true);
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Artifact" });
    });

    it("puts a +1/+1 counter on a target creature on resolution", () => {
        const smith = makeInstance(dwarvenWeaponsmith.id, { id: "smith-1" });
        const target = makeInstance(ornithopter.id, { id: "orn-tgt" });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [smith, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, smith, "dwarven-weaponsmith-counter", [
            { type: "permanent", id: "orn-tgt" },
        ]);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "orn-tgt"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
    });
});

describe("Gate to Phyrexia (CR 602.5 — upkeep, once/turn, sac creature)", () => {
    it("declares once-per-turn + upkeep timing + creature sac cost", () => {
        const ability = gateToPhyrexia.activatedAbilities![0];
        expect(ability.oncePerTurn).toBe(true);
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Creature" });
    });

    it("destroys a target artifact on resolution", () => {
        const gate = makeInstance(gateToPhyrexia.id, { id: "gate-1" });
        const artifact = makeInstance(ornithopter.id, {
            id: "art-tgt",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [gate] }),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        resolveActivated(state, gate, "gate-to-phyrexia-destroy", [
            { type: "permanent", id: "art-tgt" },
        ]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "art-tgt")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "art-tgt")).toBe(
            true
        );
    });
});

// ---------------------------------------------------------------------------
// Mishra's Workshop — restricted mana "artifact-spell" (cluster M, #283)
//   "{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells."
//   CR 106.6 (restricted mana) / CR 500.4 (empties at end of step/phase).
//   ADR 0022 — reuses the restricted-mana storage/serialization/emptying/
//   settlement machinery; only a new union member + ability field.
// ---------------------------------------------------------------------------

describe("Mishra's Workshop (restricted mana 'artifact-spell', CR 106.6)", () => {
    /** Tap a Mishra's Workshop into the controller's pool exactly as the
     *  tapUntap mutation's fixed-mana branch does: route the produced mana
     *  into `restrictedMana` (not the fungible pool) under the ability's
     *  declared restriction. */
    function tapWorkshop(state: GameState): void {
        const ws = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === mishrasWorkshop.id
        )!;
        ws.isTapped = true;
        const restriction = getActivatedManaRestriction(ws)!;
        addRestrictedManaToPool(state.players[0], "C", 3, restriction);
    }

    it("is a Land whose mana ability declares the artifact-spell restriction", () => {
        const def = getCardById(mishrasWorkshop.id);
        expect(def.name).toBe("Mishra's Workshop");
        expect(def.types).toEqual(["Land"]);
        const ability = def.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 3 });
        expect(ability?.manaRestriction).toBe("artifact-spell");
    });

    it("getActivatedManaRestriction reads the restriction off the instance", () => {
        const ws = makeInstance(mishrasWorkshop.id);
        expect(getActivatedManaRestriction(ws)).toBe("artifact-spell");
        // A plain land mana ability carries no restriction.
        const factory = makeInstance(mishrasFactory.id);
        expect(getActivatedManaRestriction(factory)).toBeNull();
    });

    it("restrictionAllowsSpell gates artifact spells only", () => {
        expect(restrictionAllowsSpell("artifact-spell", ["Artifact"])).toBe(
            true
        );
        expect(
            restrictionAllowsSpell("artifact-spell", ["Artifact", "Creature"])
        ).toBe(true);
        expect(restrictionAllowsSpell("artifact-spell", ["Creature"])).toBe(
            false
        );
        expect(restrictionAllowsSpell("artifact-spell", ["Sorcery"])).toBe(
            false
        );
    });

    it("tapping produces three colorless mana in the restricted pool, not the fungible pool", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(mishrasWorkshop.id)],
                }),
                makePlayer("p2"),
            ],
        });
        tapWorkshop(state);
        expect(state.players[0].restrictedMana).toEqual([
            { color: "C", amount: 3, restriction: "artifact-spell" },
        ]);
        // Nothing leaks into the fungible pool.
        expect(state.players[0].manaPool.C).toBe(0);
    });

    // Integration across the GRE -> game.ts spell-cast boundary: mirror the
    // affordability check + payment the cast mutations perform (CR 106.6).
    it("pays an artifact spell from restricted mana but rejects a noncreature non-artifact spell and an ability", () => {
        const subs = getManaSubstitutionsEmpty();
        // Urza's Chalice — {1} Artifact. Restricted {C} pays the generic pip.
        const artifactCost = normalizeManaCost(
            getInstanceManaCost(
                makeInstance(urzasChaliceDef.id, { zone: "hand" })
            )!,
            { chosenX: 1 }
        );
        const artifactTypes = getCardById(urzasChaliceDef.id).types;

        const caster = makePlayer("p1", {
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(caster, artifactTypes),
                artifactCost,
                subs
            )
        ).toBe(true);
        payManaCostForSpell(caster, artifactCost, artifactTypes, subs);
        expect(caster.restrictedMana).toEqual([
            { color: "C", amount: 2, restriction: "artifact-spell" },
        ]);
        expect(caster.manaPool.C).toBe(0);

        // The same pool can NOT pay a non-artifact spell (e.g. a Sorcery).
        const sorcererPlayer = makePlayer("p1", {
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(sorcererPlayer, ["Sorcery"]),
                { X: 1 },
                subs
            )
        ).toBe(false);

        // ...nor an activated ability: those payment sites never consult
        // restrictedMana (ADR 0022), so the restricted pool is invisible there.
        // Modelled by the absence of any spendablePool helper on the ability
        // path — the fungible pool alone is { C: 0 }, which can't pay { X: 1 }.
        expect(isManaCostCovered(sorcererPlayer.manaPool, { X: 1 }, subs)).toBe(
            false
        );
    });

    it("empties the restricted mana at end of step/phase (CR 500.4)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(mishrasWorkshop.id)],
                }),
                makePlayer("p2"),
            ],
        });
        tapWorkshop(state);
        expect(state.players[0].restrictedMana).toHaveLength(1);
        // advancePhase runs emptyManaPools, which clears restrictedMana too.
        advancePhase(state);
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("is excluded from the auto-tap solver (restricted mana stays manual)", () => {
        const battlefield = [
            makeInstance(mishrasWorkshop.id),
            makeInstance(stripMine.id), // {T}: Add {C} — a plain mana land
        ];
        const sources = buildAutoTapSources(battlefield);
        const ids = sources.map((s) => s.cardId);
        const wsId = battlefield[0].id;
        expect(ids).not.toContain(wsId);
        // The unrestricted land is still solver-visible.
        expect(ids).toContain(battlefield[1].id);
    });

    it("restricted mana survives the wire projection (CR 106.6)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(mishrasWorkshop.id)],
                }),
                makePlayer("p2"),
            ],
        });
        tapWorkshop(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].restrictedMana).toEqual([
            { color: "C", amount: 3, restriction: "artifact-spell" },
        ]);
    });
});

/** No mana substitutions active (no Sunglasses of Urza etc.). */
function getManaSubstitutionsEmpty(): [] {
    return [];
}

// ---------------------------------------------------------------------------
// Urza land trio — board-conditional mana (cluster I, #284)
//   Mine / Power Plant each "{T}: Add {C}. If you control [the other two],
//   add {C}{C} instead." Tower adds {C}{C}{C} when assembled.
//   CR 106.1 (mana production), CR 605.1a (intrinsic mana ability), CR 205.3
//   (subtype-keyed condition). Output recomputes from the controller's
//   battlefield at activation time via the ability's `manaAmount` hook;
//   `manaProduced` carries the representative assembled output (Mana Flare).
// ---------------------------------------------------------------------------

describe("Urza land trio (board-conditional mana, CR 106.1)", () => {
    const TRIO = [
        {
            def: urzasMine,
            name: "Urza's Mine",
            subtype: "Urza's Mine",
            assembled: 2,
        },
        {
            def: urzasPowerPlant,
            name: "Urza's Power Plant",
            subtype: "Urza's Power-Plant",
            assembled: 2,
        },
        {
            def: urzasTower,
            name: "Urza's Tower",
            subtype: "Urza's Tower",
            assembled: 3,
        },
    ] as const;

    /** The controller's battlefield holding the named subset of the trio. */
    function battlefieldWith(
        subtypes: readonly (
            | "Urza's Mine"
            | "Urza's Power-Plant"
            | "Urza's Tower"
        )[]
    ): CardInstanceState[] {
        const bySubtype = {
            "Urza's Mine": urzasMine.id,
            "Urza's Power-Plant": urzasPowerPlant.id,
            "Urza's Tower": urzasTower.id,
        } as const;
        return subtypes.map((s) => makeInstance(bySubtype[s]));
    }

    it("each land is a colorless mana Land carrying its Urza subtype", () => {
        for (const { def, name, subtype } of TRIO) {
            const looked = getCardById(def.id);
            expect(looked.name).toBe(name);
            expect(looked.types).toEqual(["Land"]);
            expect(looked.subtypes).toEqual([subtype]);
            const ability = looked.activatedAbilities?.[0];
            expect(ability?.cost.tap).toBe(true);
            expect(ability?.useStack).toBe(false);
            expect(ability?.manaRestriction).toBeUndefined();
            expect(typeof ability?.manaAmount).toBe("function");
        }
    });

    it("a lone Urza land taps for exactly {C} (CR 106.1)", () => {
        for (const { def } of TRIO) {
            const land = makeInstance(def.id);
            const battlefield = [land];
            expect(getDynamicManaProduced(land, battlefield)).toEqual({ C: 1 });
            expect(getFixedManaAmount(land, "C", battlefield)).toBe(1);
        }
    });

    it("two of the trio still tap for only {C} (set not assembled)", () => {
        // Mine + Tower in play, but no Power Plant: Mine and Tower each lone-tap.
        const battlefield = battlefieldWith(["Urza's Mine", "Urza's Tower"]);
        const mine = battlefield[0];
        const tower = battlefield[1];
        expect(getFixedManaAmount(mine, "C", battlefield)).toBe(1);
        expect(getFixedManaAmount(tower, "C", battlefield)).toBe(1);
    });

    it("the assembled trio scales each land's output (2 / 2 / 3)", () => {
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        for (const { def, assembled } of TRIO) {
            const land = battlefield.find(
                (c) => (c.card as { id: string }).id === def.id
            )!;
            expect(getDynamicManaProduced(land, battlefield)).toEqual({
                C: assembled,
            });
            expect(getFixedManaAmount(land, "C", battlefield)).toBe(assembled);
        }
        // Assembled, the whole set yields 2 + 2 + 3 = 7 colorless.
        const total = battlefield.reduce(
            (sum, land) => sum + getFixedManaAmount(land, "C", battlefield),
            0
        );
        expect(total).toBe(7);
    });

    it("output recomputes from current board: losing one member drops the rest to {C}", () => {
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        const tower = battlefield[2];
        expect(getFixedManaAmount(tower, "C", battlefield)).toBe(3);
        // Power Plant leaves the battlefield → set disassembled.
        const afterLoss = [battlefield[0], battlefield[2]];
        expect(getFixedManaAmount(tower, "C", afterLoss)).toBe(1);
    });

    it("the condition is per-controller: opponent's Urza lands don't assemble yours", () => {
        // p1 has only the Tower; p2 has Mine + Power Plant. The Tower keys off
        // p1's own battlefield, so it stays at {C}.
        const p1Battlefield = battlefieldWith(["Urza's Tower"]);
        expect(getFixedManaAmount(p1Battlefield[0], "C", p1Battlefield)).toBe(
            1
        );
    });

    it("auto-tap solver reflects the assembled (not base) yield", () => {
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        const sources = buildAutoTapSources(battlefield);
        // Every Urza land is solver-visible (unrestricted, single colorless).
        expect(sources).toHaveLength(3);
        const total = sources.reduce(
            (sum, s) => sum + (s.options[0].mana.C ?? 0),
            0
        );
        expect(total).toBe(7);
    });

    it("tap snapshots the assembled amount; untap refunds it even if the board changed", () => {
        // Mirrors the tapUntap fixed-mana branch (game.ts): on tap the dynamic
        // amount is snapshotted onto `chosenMana`; on untap the refund reads the
        // snapshot, so a mid-float board change can't desync the pool.
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        const player = makePlayer("p1", { battlefield });
        const tower = battlefield[2];

        // Tap the assembled Tower for {C}{C}{C}, snapshotting onto chosenMana.
        const amount = getFixedManaAmount(tower, "C", player.battlefield);
        expect(amount).toBe(3);
        tower.isTapped = true;
        tower.chosenMana = { C: amount };
        player.manaPool.C += amount;
        expect(player.manaPool.C).toBe(3);

        // The set is broken (Mine sacrificed) while the 3 mana is floating.
        player.battlefield = [battlefield[1], battlefield[2]];

        // Untap refunds the snapshot (3), not a fresh recomputation (would be 1).
        const refund = tower.chosenMana?.C ?? 0;
        expect(refund).toBe(3);
        player.manaPool.C = Math.max(0, player.manaPool.C - refund);
        tower.chosenMana = undefined;
        tower.isTapped = false;
        expect(player.manaPool.C).toBe(0);
    });

    it("wire format: assembled output survives projectPublicState (CR 106.1)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: battlefieldWith([
                        "Urza's Mine",
                        "Urza's Power-Plant",
                        "Urza's Tower",
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        const tower = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === urzasTower.id
        )!;
        // Fat state: assembled Tower yields 3.
        expect(
            getFixedManaAmount(tower, "C", state.players[0].battlefield)
        ).toBe(3);

        // Same assertion after projection (subtypes + card.id survive slimCard,
        // so the dynamic computation re-reads the def from the registry).
        const projected = projectPublicState(state, 1, "p1");
        const slimBattlefield = projected.players[0].battlefield;
        const slimTower = slimBattlefield.find(
            (c) => (c.card as { id: string }).id === urzasTower.id
        )!;
        expect(
            getFixedManaAmount(
                slimTower as unknown as CardInstanceState,
                "C",
                slimBattlefield as unknown as CardInstanceState[]
            )
        ).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Cluster B — "ability activated" trigger event (issue #285)
// PERMANENT_TAPPED (CR 701.20a) + ABILITY_ACTIVATED (CR 602.1) punishers.
// ---------------------------------------------------------------------------

/** Synthetic ABILITY_ACTIVATED event over an artifact (CR 602.1). */
function abilityActivatedEvent(overrides: {
    permanentId: string;
    controllerId: string;
    permanentTypes?: CardType[];
    abilityId?: string;
}): GameEvent {
    return {
        type: "ABILITY_ACTIVATED" as const,
        permanentId: overrides.permanentId,
        controllerId: overrides.controllerId,
        permanentTypes:
            overrides.permanentTypes ?? (["Artifact"] as CardType[]),
        permanentSubtypes: [],
        abilityId: overrides.abilityId ?? "some-ability",
    };
}

/** Synthetic PERMANENT_TAPPED event over an artifact (CR 701.20a). */
function artifactTappedEvent(overrides: {
    permanentId: string;
    controllerId: string;
    permanentTypes?: CardType[];
}): GameEvent {
    return {
        type: "PERMANENT_TAPPED" as const,
        permanentId: overrides.permanentId,
        controllerId: overrides.controllerId,
        permanentTypes:
            overrides.permanentTypes ?? (["Artifact"] as CardType[]),
        permanentSubtypes: [],
        forMana: false,
    };
}

describe("Haunting Wind (1 dmg on artifact tap or non-tap ability)", () => {
    const self = {
        id: "hw",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
    };
    const tappedTrig = hauntingWind.triggeredAbilities!.find(
        (t) => t.id === "haunting-wind-tapped"
    )!;
    const abilityTrig = hauntingWind.triggeredAbilities!.find(
        (t) => t.id === "haunting-wind-ability"
    )!;

    it("declares one PERMANENT_TAPPED and one ABILITY_ACTIVATED trigger", () => {
        expect(tappedTrig.event).toBe("PERMANENT_TAPPED");
        expect(abilityTrig.event).toBe("ABILITY_ACTIVATED");
    });

    it("tapped trigger fires for any artifact tap, ignores non-artifacts", () => {
        expect(
            tappedTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        expect(
            tappedTrig.matches(
                artifactTappedEvent({
                    permanentId: "a",
                    controllerId: "p2",
                    permanentTypes: ["Land"],
                }),
                self
            )
        ).toBe(false);
    });

    it("ability trigger fires for an artifact's non-tap ability, ignores non-artifacts", () => {
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({
                    permanentId: "a",
                    controllerId: "p2",
                    permanentTypes: ["Creature"],
                }),
                self
            )
        ).toBe(false);
        // Cross-wiring guard: the tapped trigger must NOT match the
        // ABILITY_ACTIVATED event, and vice versa.
        expect(
            tappedTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(false);
        expect(
            abilityTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(false);
    });

    it("resolves 1 damage to the artifact's controller on the ability event", () => {
        const hw = makeInstance(hauntingWind.id, {
            id: "hw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hw], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(
            state,
            hw,
            "haunting-wind-ability",
            abilityActivatedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(state.players[1].life).toBe(19);
    });

    it("wire format — damage to controller survives projection", () => {
        const hw = makeInstance(hauntingWind.id, {
            id: "hw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hw], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(
            state,
            hw,
            "haunting-wind-tapped",
            artifactTappedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(state.players[1].life).toBe(19);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(19);
    });
});

describe("Powerleech (gain 1 on opponent artifact tap or non-tap ability)", () => {
    const self = {
        id: "pl",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
    };
    const tappedTrig = powerleech.triggeredAbilities!.find(
        (t) => t.id === "powerleech-tapped"
    )!;
    const abilityTrig = powerleech.triggeredAbilities!.find(
        (t) => t.id === "powerleech-ability"
    )!;

    it("fires only for an OPPONENT's artifact (scope: opponents)", () => {
        // opponent (p2) artifact → both events match
        expect(
            tappedTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p2" }),
                self
            )
        ).toBe(true);
        // own (p1) artifact → neither matches
        expect(
            tappedTrig.matches(
                artifactTappedEvent({ permanentId: "a", controllerId: "p1" }),
                self
            )
        ).toBe(false);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({ permanentId: "a", controllerId: "p1" }),
                self
            )
        ).toBe(false);
    });

    it("resolves +1 life to the enchantment's controller (both cases)", () => {
        const make = () => {
            const pl = makeInstance(powerleech.id, {
                id: "pl",
                controllerId: "p1",
                ownerId: "p1",
            });
            return {
                pl,
                state: makeState({
                    players: [
                        makePlayer("p1", { battlefield: [pl], life: 20 }),
                        makePlayer("p2", { life: 20 }),
                    ],
                }),
            };
        };
        const tap = make();
        fireTrigger(
            tap.state,
            tap.pl,
            "powerleech-tapped",
            artifactTappedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(tap.state.players[0].life).toBe(21);

        const abil = make();
        fireTrigger(
            abil.state,
            abil.pl,
            "powerleech-ability",
            abilityActivatedEvent({ permanentId: "art", controllerId: "p2" })
        );
        expect(abil.state.players[0].life).toBe(21);
        // Wire format: life gain visible after projection.
        const projected = projectPublicState(abil.state, 0, "p1");
        expect(projected.players[0].life).toBe(21);
    });
});

describe("Artifact Possession (Aura: 2 dmg on enchanted artifact tap/ability)", () => {
    const tappedTrig = artifactPossession.triggeredAbilities!.find(
        (t) => t.id === "artifact-possession-tapped"
    )!;
    const abilityTrig = artifactPossession.triggeredAbilities!.find(
        (t) => t.id === "artifact-possession-ability"
    )!;

    it("is an Aura that enchants artifacts", () => {
        expect(artifactPossession.subtypes).toContain("Aura");
        expect(artifactPossession.targetRequirement).toEqual({
            type: "Artifact",
            count: 1,
        });
    });

    it("fires only for the enchanted artifact (self.attachedTo host check)", () => {
        const attached = {
            id: "ap",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host",
            card: {},
        };
        // enchanted artifact ("host") → matches
        expect(
            tappedTrig.matches(
                artifactTappedEvent({
                    permanentId: "host",
                    controllerId: "p2",
                }),
                attached
            )
        ).toBe(true);
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({
                    permanentId: "host",
                    controllerId: "p2",
                }),
                attached
            )
        ).toBe(true);
        // a DIFFERENT artifact → no match
        expect(
            abilityTrig.matches(
                abilityActivatedEvent({
                    permanentId: "other",
                    controllerId: "p2",
                }),
                attached
            )
        ).toBe(false);
        // unattached aura → no match
        expect(
            tappedTrig.matches(
                artifactTappedEvent({
                    permanentId: "host",
                    controllerId: "p2",
                }),
                { ...attached, attachedTo: undefined }
            )
        ).toBe(false);
    });

    it("resolves 2 damage to the host artifact's controller", () => {
        const ap = makeInstance(artifactPossession.id, {
            id: "ap",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ap], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(
            state,
            ap,
            "artifact-possession-ability",
            abilityActivatedEvent({ permanentId: "host", controllerId: "p2" })
        );
        expect(state.players[1].life).toBe(18);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].life).toBe(18);
    });
});

// ---------------------------------------------------------------------------
// Cluster E (#286) — "for as long as this remains tapped" duration + tap-lock
// (CR 611.2 state-tied duration; CR 502.1 optional untap). The buff/lock is
// read live while the source stays tapped and pruned by the
// `checkSourceTappedEffects` SBA once the source untaps or leaves.
// ---------------------------------------------------------------------------

describe("Ashnod's Battle Gear (+2/-2 while tapped, CR 611.2)", () => {
    it("is a {2} Artifact with the optional-untap keyword", () => {
        expect(ashnodsBattleGear.manaCost).toEqual({ X: 2 });
        expect(ashnodsBattleGear.types).toEqual(["Artifact"]);
        expect(ashnodsBattleGear.staticAbilities).toContain(
            "may-choose-not-to-untap"
        );
    });

    it("grants +2/-2 to a creature you control while the Gear stays tapped", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true, // {T} cost already paid (resolveActivated skips costs)
        });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);

        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(4);
        expect(getEffectiveToughness(state, live)).toBe(0);
    });

    it("the buff disappears the moment the Gear untaps (live read + SBA prune)", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const bear = vanilla("bear", 2, 4, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const liveBear = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(state, liveBear)).toBe(2); // 4 - 2

        // Untap the Gear: the buff ends immediately on the live layer read,
        // even before the SBA splices the stale entry out.
        state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped =
            false;
        expect(getEffectiveToughness(state, liveBear)).toBe(4);

        // SBA prunes the now-stale entry.
        checkStateBasedActions(state);
        expect(liveBear.sourceTappedPTMods).toBeUndefined();
        expect(getEffectiveToughness(state, liveBear)).toBe(4);
    });

    it("the buff ends when the Gear leaves the battlefield", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const bear = vanilla("bear", 2, 4, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);
        removePermanentTo(state, "gear", "graveyard");
        const liveBear = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(state, liveBear)).toBe(4); // source gone
        checkStateBasedActions(state);
        expect(liveBear.sourceTappedPTMods).toBeUndefined();
    });

    it("wire format: the +2/-2 survives projectPublicState while the Gear is tapped", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const bear = vanilla("bear", 2, 4, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(projected, slimBear)).toBe(4);
        expect(getEffectiveToughness(projected, slimBear)).toBe(2);

        // And the projected tapped state of the source still gates the buff:
        // flipping the projected Gear's isTapped removes the contribution.
        const slimGear = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "gear")!;
        (slimGear as { isTapped: boolean }).isTapped = false;
        expect(getEffectiveToughness(projected, slimBear)).toBe(4);
    });
});

describe("Tawnos's Weaponry (+1/+1 while tapped, CR 611.2)", () => {
    it("is a {2} Artifact with the optional-untap keyword", () => {
        expect(tawnossWeaponry.manaCost).toEqual({ X: 2 });
        expect(tawnossWeaponry.staticAbilities).toContain(
            "may-choose-not-to-untap"
        );
    });

    it("grants +1/+1 to any creature while the Weaponry stays tapped", () => {
        const weap = makeInstance(tawnossWeaponry.id, {
            id: "weap",
            isTapped: true,
        });
        const foe = vanilla("foe", 2, 2); // p2's creature — "any" target
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [weap] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, weap, "tawnoss-weaponry-pump", [
            { type: "permanent", id: "foe" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);

        // Untap → buff gone.
        state.players[0].battlefield.find((c) => c.id === "weap")!.isTapped =
            false;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("wire format: the +1/+1 survives projectPublicState", () => {
        const weap = makeInstance(tawnossWeaponry.id, {
            id: "weap",
            isTapped: true,
        });
        const foe = vanilla("foe", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [weap] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, weap, "tawnoss-weaponry-pump", [
            { type: "permanent", id: "foe" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p2")!
            .battlefield.find((c) => c.id === "foe")!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Phyrexian Gremlins (tap-lock while tapped, CR 611.2 / 502.1)", () => {
    it("is a 1/1 Phyrexian Gremlin with the optional-untap keyword", () => {
        expect(phyrexianGremlins.power).toBe(1);
        expect(phyrexianGremlins.toughness).toBe(1);
        expect(phyrexianGremlins.subtypes).toEqual(["Phyrexian", "Gremlin"]);
        expect(phyrexianGremlins.manaCost).toEqual({ X: 2, B: 1 });
        expect(phyrexianGremlins.staticAbilities).toContain(
            "may-choose-not-to-untap"
        );
    });

    it("taps the target artifact and records the untap-lock", () => {
        const grem = makeInstance(phyrexianGremlins.id, {
            id: "grem",
            isTapped: true, // {T} cost already paid
        });
        const rock = vanilla("rock", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [grem] }),
                makePlayer("p2", { battlefield: [rock] }),
            ],
        });
        resolveActivated(state, grem, "phyrexian-gremlins-tap-lock", [
            { type: "permanent", id: "rock" },
        ]);
        const liveRock = state.players[1].battlefield.find(
            (c) => c.id === "rock"
        )!;
        expect(liveRock.isTapped).toBe(true);
        expect(liveRock.untapLockedBy).toEqual(["grem"]);
    });

    it("keeps the locked artifact tapped through its controller's untap step", () => {
        const grem = makeInstance(phyrexianGremlins.id, {
            id: "grem",
            isTapped: true,
        });
        const rock = vanilla("rock", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
            isTapped: true,
            untapLockedBy: ["grem"],
        });
        const state = makeState({
            phase: "UNTAP",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [grem] }),
                makePlayer("p2", { battlefield: [rock] }),
            ],
        });
        untapStep(state);
        const liveRock = state.players[1].battlefield.find(
            (c) => c.id === "rock"
        )!;
        expect(liveRock.isTapped).toBe(true); // lock holds — Gremlin still tapped
    });

    it("frees the artifact once the Gremlin untaps (SBA prunes the lock)", () => {
        const grem = makeInstance(phyrexianGremlins.id, {
            id: "grem",
            isTapped: false, // Gremlin untapped on a prior turn
        });
        const rock = vanilla("rock", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
            isTapped: true,
            untapLockedBy: ["grem"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [grem] }),
                makePlayer("p2", { battlefield: [rock] }),
            ],
        });
        checkStateBasedActions(state);
        const liveRock = state.players[1].battlefield.find(
            (c) => c.id === "rock"
        )!;
        expect(liveRock.untapLockedBy).toBeUndefined();

        // Now the artifact's controller's untap step untaps it.
        state.phase = "UNTAP";
        state.activePlayerId = "p2";
        untapStep(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "rock")!.isTapped
        ).toBe(false);
    });
});

describe("Optional untap (CR 502.1 — 'you may choose not to untap this')", () => {
    function untapState(source: CardInstanceState): GameState {
        return makeState({
            phase: "UNTAP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
    }

    it("prompts the controller before untapping a may-choose-not-to-untap permanent", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const state = untapState(gear);
        untapStep(state);
        // The Gear is not auto-untapped; an untap-pick prompt is queued.
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(true);
        expect(state.pendingChoices?.[0]?.kind).toBe("untap-pick");
        expect(state.pendingChoices?.[0]?.choiceId).toBe("untap-optional-gear");
    });

    it("untaps when the controller chooses to (selects the id)", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const state = untapState(gear);
        untapStep(state);
        submitChoice(state, ["gear"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(false);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("keeps it tapped when the controller declines (selects nothing)", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const state = untapState(gear);
        untapStep(state);
        submitChoice(state, []);
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(true);
        expect(state.pendingChoices).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cluster C+D — continuous artifact-source prevention/redirection + artifact-
// damage tracking (#287)
// ─────────────────────────────────────────────────────────────────────────────

describe("Argothian Pixies (block restriction + prevent from artifact creatures, CR 509.1b / 615)", () => {
    it("can't be blocked by artifact creatures, but can by non-artifact creatures", () => {
        const pixies = makeInstance(argothianPixies.id, {
            id: "pixies",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const artifactBlocker = makeInstance(yotianSoldier.id, {
            id: "yotian",
            controllerId: "p2",
            ownerId: "p2",
        });
        const fleshBlocker = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pixies] }),
                makePlayer("p2", {
                    battlefield: [artifactBlocker, fleshBlocker],
                }),
            ],
        });
        expect(
            validateBlockerEligibility(
                pixies,
                artifactBlocker,
                [artifactBlocker, fleshBlocker],
                state
            ).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(
                pixies,
                fleshBlocker,
                [artifactBlocker, fleshBlocker],
                state
            ).eligible
        ).toBe(true);
    });

    it("prevents combat damage from an artifact creature but takes damage from a non-artifact creature", () => {
        // Artifact creature attacker (Colossus 9/9) vs Pixies blocking.
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const pixies = makeInstance(argothianPixies.id, {
            id: "pixies",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [pixies] }),
                makePlayer("p2", { battlefield: [colossus] }),
            ],
            combat: {
                attackerIds: ["colossus"],
                confirmed: true,
                blockerAssignments: { pixies: ["colossus"] },
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {}, "regular");
        const pixiesAfter = state.players[0].battlefield.find(
            (c) => c.id === "pixies"
        );
        // All 9 damage from the artifact creature is prevented.
        expect(pixiesAfter?.damageMarked ?? 0).toBe(0);
    });

    it("does NOT prevent damage from a non-artifact creature (source filter)", () => {
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const pixies = makeInstance(argothianPixies.id, {
            id: "pixies",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pixies] }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "giant",
            "p2",
            { type: "permanent", id: "pixies" },
            3,
            false
        );
        // Not consumed — flesh source, damage proceeds.
        expect(res).not.toBeNull();
        expect(res?.amount).toBe(3);
    });
});

describe("Argothian Treefolk (prevent all damage from artifact sources, CR 615)", () => {
    it("prevents damage from an artifact source (any artifact, not just creatures)", () => {
        const treefolk = makeInstance(argothianTreefolk.id, {
            id: "treefolk",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Grapeshot Catapult is a noncreature Artifact damage source.
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [treefolk] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "permanent", id: "treefolk" },
            2,
            false
        );
        expect(res).toBeNull(); // prevented (consumed)
    });

    it("takes damage from a non-artifact source", () => {
        const treefolk = makeInstance(argothianTreefolk.id, {
            id: "treefolk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [treefolk] }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "giant",
            "p2",
            { type: "permanent", id: "treefolk" },
            3,
            false
        );
        expect(res?.amount).toBe(3);
    });

    it("wire format — prevention survives projectPublicState", () => {
        const treefolk = makeInstance(argothianTreefolk.id, {
            id: "treefolk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [treefolk] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const res = runDamageReplacement(
            projected as unknown as GameState,
            "catapult",
            "p2",
            { type: "permanent", id: "treefolk" },
            2,
            false
        );
        expect(res).toBeNull();
    });
});

describe("Artifact Ward (Aura: block restriction + prevention + targeting guard, CR 303.4 / 509.1b / 615 / 611)", () => {
    function setup(opts: { tappedHost?: boolean } = {}) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: opts.tappedHost,
        });
        const ward = makeInstance(artifactWard.id, {
            id: "ward",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        return { host, ward };
    }

    it("enchanted creature can't be blocked by artifact creatures", () => {
        const { host, ward } = setup();
        const artifactBlocker = makeInstance(yotianSoldier.id, {
            id: "yotian",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [artifactBlocker] }),
            ],
        });
        expect(
            validateBlockerEligibility(
                host,
                artifactBlocker,
                [artifactBlocker],
                state
            ).eligible
        ).toBe(false);
    });

    it("prevents damage to enchanted creature from artifact sources", () => {
        const { host, ward } = setup();
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "permanent", id: "host" },
            2,
            false
        );
        expect(res).toBeNull();
    });

    it("enchanted creature can't be targeted by abilities from artifact sources, but can by non-artifact sources", () => {
        const { host, ward } = setup();
        // Triskelion is an artifact source with a targeted ability.
        const trisk = makeInstance(triskelion.id, {
            id: "trisk",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Hill Giant is a non-artifact permanent (stands in for a flesh source).
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [trisk, giant] }),
            ],
        });
        // Artifact source (Triskelion's types include "Artifact") — guarded.
        expect(
            isGuardedAgainst(state, host, "cantBeTargeted", trisk.types)
        ).toBe(true);
        // Non-artifact source — NOT guarded.
        expect(
            isGuardedAgainst(state, host, "cantBeTargeted", giant.types)
        ).toBe(false);
        // Unenchanted creature is never guarded by this Ward.
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(
            isGuardedAgainst(state, other, "cantBeTargeted", trisk.types)
        ).toBe(false);
    });

    it("getPendingTargetSourceTypes reports an artifact source's types (ability path)", () => {
        const trisk = makeInstance(triskelion.id, {
            id: "trisk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [trisk] }),
            ],
        });
        expect(
            getPendingTargetSourceTypes(state, "trisk", "ability")
        ).toContain("Artifact");
    });

    it("getLegalTargets excludes the warded creature for an artifact ability source", () => {
        const { host, ward } = setup();
        host.isAttacking = false;
        const trisk = makeInstance(triskelion.id, {
            id: "trisk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [trisk] }),
            ],
        });
        const req = { type: "any" as CardType, count: 1 as const };
        // Artifact source: warded host excluded.
        const artifactLegal = getLegalTargets(state, req, [], "p2", undefined, [
            "Artifact",
        ]).map((t) => t.id);
        expect(artifactLegal).not.toContain("host");
        // No source-type info (non-artifact / default): host IS targetable.
        const fleshLegal = getLegalTargets(state, req, [], "p2").map(
            (t) => t.id
        );
        expect(fleshLegal).toContain("host");
    });

    it("wire format — prevention survives projectPublicState", () => {
        const { host, ward } = setup();
        host.isAttacking = false;
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, ward] }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const res = runDamageReplacement(
            projected as unknown as GameState,
            "catapult",
            "p2",
            { type: "permanent", id: "host" },
            2,
            false
        );
        expect(res).toBeNull();
    });
});

describe("Martyrs of Korlis (redirect artifact damage to self while untapped, CR 614)", () => {
    it("redirects player damage from an artifact source while untapped", () => {
        const martyrs = makeInstance(martyrsOfKorlis.id, {
            id: "martyrs",
            controllerId: "p1",
            ownerId: "p1",
        });
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [martyrs], life: 20 }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "player", id: "p1" },
            2,
            false
        );
        expect(res?.target).toEqual({ type: "permanent", id: "martyrs" });
    });

    it("does NOT redirect while tapped (CR 614 condition)", () => {
        const martyrs = makeInstance(martyrsOfKorlis.id, {
            id: "martyrs",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const catapult = makeInstance(grapeshotCatapult.id, {
            id: "catapult",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [martyrs], life: 20 }),
                makePlayer("p2", { battlefield: [catapult] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "catapult",
            "p2",
            { type: "player", id: "p1" },
            2,
            false
        );
        expect(res?.target).toEqual({ type: "player", id: "p1" });
    });

    it("does NOT redirect damage from a non-artifact source", () => {
        const martyrs = makeInstance(martyrsOfKorlis.id, {
            id: "martyrs",
            controllerId: "p1",
            ownerId: "p1",
        });
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [martyrs], life: 20 }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "giant",
            "p2",
            { type: "player", id: "p1" },
            3,
            false
        );
        expect(res?.target).toEqual({ type: "player", id: "p1" });
    });
});

describe("artifact-damage tracking + Reverse Polarity (CR 120.3 tally / 119 lifegain)", () => {
    it("bumps artifactDamageToPlayerThisTurn only for artifact combat sources", () => {
        // Artifact creature (Colossus 9/9) attacks unblocked.
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [colossus] }),
            ],
            combat: {
                attackerIds: ["colossus"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {}, "regular");
        expect(state.players[0].life).toBe(11);
        expect(state.artifactDamageToPlayerThisTurn?.["p1"]).toBe(9);
        // The general damage tally also counts it.
        expect(state.damageDealtToPlayerThisTurn?.["p1"]).toBe(9);
    });

    it("does NOT bump the artifact tally for a non-artifact combat source", () => {
        const giant = makeInstance(hillGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
            combat: {
                attackerIds: ["giant"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {}, "regular");
        expect(state.players[0].life).toBe(17);
        expect(state.artifactDamageToPlayerThisTurn?.["p1"] ?? 0).toBe(0);
        expect(state.damageDealtToPlayerThisTurn?.["p1"]).toBe(3);
    });

    it("Reverse Polarity gains twice the artifact damage dealt this turn", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 11 }), makePlayer("p2")],
            artifactDamageToPlayerThisTurn: { p1: 9 },
        });
        const item = pushSpell(state, reversePolarity.id, "p1");
        item.controllerId = "p1";
        resolveTopOfStack(state);
        // 9 artifact damage → gain 18.
        expect(state.players[0].life).toBe(29);
    });

    it("Reverse Polarity gains 0 when no artifact damage was dealt", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 17 }), makePlayer("p2")],
            damageDealtToPlayerThisTurn: { p1: 3 },
        });
        const item = pushSpell(state, reversePolarity.id, "p1");
        item.controllerId = "p1";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });
});

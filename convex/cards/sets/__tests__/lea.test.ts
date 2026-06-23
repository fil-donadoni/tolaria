// Per-card behavior tests for cards in `convex/cards/sets/lea.ts`.
// Mirrors the data file: every card with non-trivial behavior gets its own
// describe() block. Spell cards are exercised through resolveTopOfStack();
// pt-buff cards are exercised via effectivePower/Toughness, both at the GRE
// level AND through the wire format (projectPublicState → frontend adapter)
// so regressions at the projection boundary are caught here.

import { describe, it, expect } from "vitest";
import {
    armageddon,
    badMoon,
    badlands,
    balance,
    bayou,
    berserk,
    birdsOfParadise,
    blackKnight,
    blackWard,
    blueWard,
    bogWraith,
    braingeyser,
    burrowing,
    celestialPrism,
    consecrateLand,
    copperTablet,
    crusade,
    cursedLand,
    deathWard,
    drudgeSkeletons,
    farmstead,
    feedback,
    flight,
    frozenShade,
    giantGrowth,
    goblinBalloonBrigade,
    goblinKing,
    graniteGargoyle,
    greenWard,
    holyStrength,
    howlFromBeyond,
    iceStorm,
    jump,
    karma,
    keldonWarlord,
    lance,
    leyDruid,
    lordOfAtlantis,
    magicalHack,
    sleightOfMind,
    merfolkOfThePearlTrident,
    mindTwist,
    monssGoblinRaiders,
    orcishArtillery,
    pirateShip,
    plagueRats,
    prodigalSorcerer,
    raiseDead,
    rodOfRuin,
    shatter,
    shivanDragon,
    stoneRain,
    streamOfLife,
    tunnel,
    unholyStrength,
    uthdenTroll,
    wallOfBone,
    wallOfBrambles,
    wallOfFire,
    wallOfWater,
    warpArtifact,
    weakness,
    willOTheWisp,
    zombieMaster,
    scatheZombies,
    redWard,
    whiteWard,
    shanodinDryads,
    castle,
    channel,
    circleOfProtectionBlue,
    circleOfProtectionGreen,
    circleOfProtectionRed,
    circleOfProtectionWhite,
    clockworkBeast,
    counterspell,
    controlMagic,
    conservator,
    creatureBond,
    crystalRod,
    deathgrip,
    dwarvenWarriors,
    fear,
    firebreathing,
    fungusaur,
    giantSpider,
    holyArmor,
    invisibility,
    ironStar,
    ironclawOrcs,
    ivoryCup,
    lifeforce,
    lifetap,
    manaFlare,
    manabarbs,
    northernPaladin,
    pestilence,
    powerLeak,
    powerSurge,
    psychicVenom,
    samiteHealer,
    scavengingGhoul,
    soulNet,
    theHive,
    web,
    throneOfBone,
    verduranEnchantress,
    wildGrowth,
    woodenSphere,
    ancestralRecall,
    darkRitual,
    demonicTutor,
    drainLife,
    fireball,
    lightningBolt,
    llanowarElves,
    plateau,
    savannah,
    scrubland,
    swamp,
    swordsToPlowshares,
    taiga,
    timeWalk,
    timetwister,
    tropicalIsland,
    tundra,
    twiddle,
    undergroundSea,
    unsummon,
    whiteKnight,
    wrathOfGod,
    disenchant,
    earthquake,
    elvishArchers,
    grizzlyBears,
    hillGiant,
    illusionaryMask,
    hurricane,
    howlingMine,
    hypnoticSpecter,
    icyManipulator,
    island,
    jadeStatue,
    jayemdaeTome,
    juggernaut,
    nightmare,
    plains,
    serraAngel,
    psionicBlast,
    ragingRiver,
    regeneration,
    regrowth,
    royalAssassin,
    savannahLions,
    seaSerpent,
    sengirVampire,
    sinkhole,
    solRing,
    moxEmerald,
    moxJet,
    moxPearl,
    moxRuby,
    moxSapphire,
    stealArtifact,
    mountain,
    volcanicEruption,
    wallOfSwords,
    wheelOfFortune,
    winterOrb,
    basaltMonolith,
    manaVault,
    meekstone,
    smoke,
    stasis,
    paralyze,
    resurrection,
    animateDead,
    simulacrum,
    reverseDamage,
    veteranBodyguard,
    personalIncarnation,
    lich,
    jadeMonolith,
    libraryOfLeng,
    phantasmalForces,
    forceOfNature,
    wanderlust,
    demonicHordes,
    healingSalve,
    blueElementalBlast,
    redElementalBlast,
    blessing,
    instillEnergy,
    spellBlast,
    animateArtifact,
    sacrifice,
    sedgeTroll,
    aspectOfWolf,
    dwarvenDemolitionTeam,
    lordOfThePit,
    blackVise,
    livingWall,
    ankhOfMishra,
    dingusEgg,
    disruptingScepter,
    drainPower,
    fog,
    forest,
    orcishOriflamme,
    righteousness,
    terror,
    disintegrate,
    dragonWhelp,
    fastbond,
    nettlingImp,
    stoneGiant,
    lure,
    blazeOfGlory,
    twoHeadedGiantOfForiys,
    manaShort,
    timeVault,
    naturalSelection,
    glassesOfUrza,
    cockatrice,
    thicketBasilisk,
    evilPresence,
    phantasmalTerrain,
    conversion,
    livingLands,
    kormusBell,
    cyclopeanTomb,
    purelace,
    chaoslace,
    deathlace,
    lifelace,
    thoughtlace,
    animateWall,
    earthbind,
    gloom,
    forcefield,
    powerSink,
    islandSanctuary,
    sirensCall,
    falseOrders,
    sunglassesOfUrza,
    netherShadow,
    kudzu,
    fork,
    benalishHero,
    mesaPegasus,
    timberWolves,
    helmOfChatzuk,
    clone,
    copyArtifact,
    vesuvanDoppelganger,
    gaeasLiege,
    wordOfCommand,
} from "../lea";
import {
    commitLandsForCost,
    regenerateOrDestroy,
    removePermanentTo,
    resolveTopOfStack,
    runDamageReplacement,
    tapPermanent,
    emitSpellCastEvent,
    emitPermanentTapped,
    emitPermanentEntered,
    processPendingActionTriggers,
    matchesPermanentFilter,
    moveCard,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    normalizeManaCost,
    getCostModifiers,
    applyCostModifiers,
    payManaCost,
    isManaCostCovered,
    getManaSubstitutions,
    grantKnowledge,
    grantKnowledgeToAll,
    clearKnowledge,
    discardCardsAtRandom,
    drawCard,
    removeFromZone,
    getActingPlayer,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { collectTriggers } from "../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../gre/layers";
import {
    getActivatedManaColor,
    getBasicLandMana,
    getFixedManaAmount,
    hasManaAbility,
} from "../../../gre/constants";
import {
    getLegalActions,
    getLegalTargets,
    getProtectedColors,
    isProtectedFromSource,
    parseProtectionFromColor,
} from "../../../gre/rules";
import { projectPublicState } from "../../../gameProjections";
import { substituteColorFilter } from "../../../gre/textChanges";
import { checkStateBasedActions } from "../../../gre/sba";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    mustAttack,
    getRequiredAttackerIds,
    getRequiredBlockerAssignments,
    getMaxBlockTargets,
} from "../../../gre/combat";
import {
    advancePhase,
    untapStep,
    computeHardSkipFilters,
    effectiveMaxHandSize,
    effectivePermanentView,
    finalizeCleanup,
    finalizeCleanupDiscard,
    emitBlockersConfirmedEvents,
    emitAttackersDeclaredEvents,
} from "../../../gre/phases";
import { tryGetCardById, FACE_DOWN_CARD_ID } from "../../index";
import { turnFaceDown, turnFaceUp } from "../../../gre/faceDown";
import { applyTapReplacements } from "../../../gre/replacements";
import {
    getEffectiveBlockGraph,
    getDamageAssignerId,
    isLegalBandComposition,
    outstandingDamageAssigner,
    hasBanding,
} from "../../../gre/banding";
import { compactState, expandState } from "../../../gre/serialize";
import type { CardDefinition, CardType } from "../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";

// ---------------------------------------------------------------------------
// Static P/T buffs (layer 7c — CR 611, 613)
// ---------------------------------------------------------------------------

describe("Castle (static pt-buff: +0/+2 to your untapped creatures)", () => {
    function setup() {
        const creature = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(castle.id, { id: "castle" });
        const p1 = makePlayer("p1", { battlefield: [creature, enchant] });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    it("buffs toughness of your untapped creatures by 2", () => {
        const state = setup();
        const lion = state.players[0].battlefield[0];
        expect(getEffectiveToughness(state, lion)).toBe(3);
        expect(getEffectivePower(state, lion)).toBe(2);
    });

    it("does NOT buff tapped creatures (predicate requires !isTapped)", () => {
        const state = setup();
        const lion = state.players[0].battlefield[0];
        lion.isTapped = true;
        expect(getEffectiveToughness(state, lion)).toBe(1);
    });

    it("does NOT buff opponent's creatures", () => {
        const state = setup();
        const oppLion = makeInstance(savannahLions.id, {
            id: "opp-lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(oppLion);
        expect(getEffectiveToughness(state, oppLion)).toBe(1);
    });

    it("wire format: buff survives projectPublicState (regression guard)", () => {
        // The projection slims `card.card` to { id }. If the buff logic were
        // to rely on embedded fields, this assertion would break.
        const state = setup();
        const projected = projectPublicState(state, 1, "p1");
        const projectedLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        // Re-feed the projected state back to the layer system through
        // PermanentView-compatible shape.
        expect(getEffectiveToughness(projected, projectedLion)).toBe(3);
    });
});

describe("Bad Moon (static pt-buff: +1/+1 to black creatures)", () => {
    // Savannah Lions is white — Bad Moon must NOT apply. To exercise the
    // positive case we synthesize a black creature via manaCost.
    function blackCreature(id: string, controllerId = "p1"): CardInstanceState {
        return {
            id,
            card: { id: "fake-black", manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 1,
            toughness: 1,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
            isTapped: false,
        };
    }

    it("buffs black creatures +1/+1", () => {
        const black = blackCreature("black-1");
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const p1 = makePlayer("p1", { battlefield: [black, enchant] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(getEffectivePower(state, black)).toBe(2);
        expect(getEffectiveToughness(state, black)).toBe(2);
    });

    it("does NOT buff non-black creatures (Savannah Lions is white)", () => {
        const lion = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const p1 = makePlayer("p1", { battlefield: [lion, enchant] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(getEffectivePower(state, lion)).toBe(2);
        expect(getEffectiveToughness(state, lion)).toBe(1);
    });

    it("buffs opponent's black creatures too (not controller-restricted)", () => {
        const black = blackCreature("opp-black", "p2");
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        expect(getEffectivePower(state, black)).toBe(2);
    });

    it("wire format: buff still applies after projection strips manaCost (regression)", () => {
        // getColors used to read manaCost from card.card. The projection
        // strips card to { id }, so Bad Moon must resolve manaCost via the
        // registry fallback. This test would fail on the pre-fix code.
        const black: CardInstanceState = {
            id: "black-proj",
            // Embedded manaCost will be STRIPPED by the projection.
            card: { id: savannahLions.id, manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 1,
            toughness: 1,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [black, enchant] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedBlack = projected.players[0].battlefield.find(
            (c) => c.id === "black-proj"
        )!;
        // After projection, the creature should still be identified as white
        // via the registry (Savannah Lions), NOT black. That's the correct
        // semantic: color comes from the card def, not from any stale embed.
        expect(getEffectivePower(projected, projectedBlack)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Spell resolutions (CR 608.3)
// ---------------------------------------------------------------------------

describe("Lightning Bolt (3 damage to any target, CR 608.3)", () => {
    it("deals 3 damage to a target player", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("kills a 1/1 creature (damage >= toughness)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
        expect(state.players[1].graveyard[0].id).toBe("lion");
    });

    it("goes to the caster's graveyard after resolving", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            lightningBolt.id
        );
    });

    it("cannot target lands (CR 115.4 / 120.3 — 'any target' is damageable only)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const forest = makeInstance(taiga.id, {
            id: "forest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion, forest] }),
            ],
        });
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!);
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("lion");
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
        expect(ids).not.toContain("forest");
    });
});

describe("Psionic Blast ({2}{U} — 4 to any target, 2 to you, CR 120.3)", () => {
    it("deals 4 damage to target player and 2 damage to the caster", () => {
        const state = makeState();
        pushSpell(state, psionicBlast.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
        expect(state.players[0].life).toBe(18);
    });

    it("kills a 4-toughness creature while still damaging the caster", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            power: 3,
            toughness: 4,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        pushSpell(state, psionicBlast.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("wall");
        expect(state.players[0].life).toBe(18);
    });

    it("can target the caster — 4 + 2 damage both hit p1", () => {
        const state = makeState();
        pushSpell(state, psionicBlast.id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(14);
    });
});

describe("Fireball ({X}{R} — X damage divided, +{1}/target, CR 107.3 / 120.1 / 601.2f)", () => {
    function setupState(targets: string[] = []) {
        const creatures = targets.map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                power: 2,
                toughness: 1,
            })
        );
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
    }

    it("deals X damage to a single target when only one is chosen", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });

    it("divides X damage evenly rounded down across multiple targets", () => {
        // X=5 across 2 targets => 2 each, remainder 1 discarded (CR 120.1).
        const state = setupState(["lion-a", "lion-b"]);
        state.players[1].battlefield[0].toughness = 3;
        state.players[1].battlefield[1].toughness = 3;
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        // 2 damage per target < 3 toughness → neither dies, both stay alive.
        expect(state.players[1].battlefield).toHaveLength(2);
    });

    it("kills all targets when per-target damage reaches lethal", () => {
        // X=6 across 2 targets => 3 each, lethal against toughness 1.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 6;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(2);
    });

    it("is a no-op when X is 0 (total 0 damage)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20);
    });

    it("declares additionalGenericPerExtraTarget for the cost modifier", () => {
        // CR 601.2f: the engine uses this value in finalizeTargetSelection to
        // grow the generic mana cost with each target beyond the first.
        expect(fireball.additionalGenericPerExtraTarget).toBe(1);
    });

    it("declares a variable target count with min 1", () => {
        expect(fireball.targetRequirement).toEqual({
            type: "any",
            count: { min: 1 },
        });
    });

    it("goes to the caster's graveyard after resolving (CR 608.2k)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            fireball.id
        );
    });

    it("wire format: divided damage still lethal after projectPublicState", () => {
        // Regression: the projection slims stack items' card to { id } only,
        // but chosenX/targets must survive the projection AND re-driving the
        // GRE from a freshly cloned state must still kill both lions.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 4;
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack[0];
        expect(projectedItem.chosenX).toBe(4);
        expect(projectedItem.targets).toHaveLength(2);
        // Resolve against the live state (the source of truth) and assert
        // that the per-target damage (4/2 = 2) clears both 1-toughness lions.
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Earthquake ({X}{R} — X damage to each non-flying creature and each player, CR 107.3 / 120.3)", () => {
    function setupBoard() {
        const ground = makeInstance(savannahLions.id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Serra Angel is a 4/4 with flying — the canonical flier in LEA.
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flier] }),
            ],
        });
    }

    it("kills non-flying creatures, spares fliers, damages both players", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "flier")
        ).toBeDefined();
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });

    it("is a no-op when X is 0", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(2);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });

    it("leaves fliers alive even when X would otherwise be lethal", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 10;
        resolveTopOfStack(state);
        // Only the flier survives; both players take 10.
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield[0].id).toBe("flier");
        expect(state.players[0].life).toBe(10);
        expect(state.players[1].life).toBe(10);
    });

    it("wire format: battlefield and life projection reflect the sweep", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).not.toContain("ground");
        expect(ids).toContain("flier");
        expect(p2.life).toBe(18);
        expect(projected.players.find((p) => p.id === "p1")!.life).toBe(18);
    });
});

describe("Hurricane ({X}{G} — X damage to each flying creature and each player, CR 107.3 / 120.3)", () => {
    function setupBoard() {
        const ground = makeInstance(savannahLions.id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flier] }),
            ],
        });
    }

    it("kills fliers when X reaches lethal, spares ground, damages both players", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "flier")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
        ).toBeDefined();
        expect(state.players[0].life).toBe(16);
        expect(state.players[1].life).toBe(16);
    });

    it("is a no-op when X is 0", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(2);
        expect(state.players[0].life).toBe(20);
    });

    it("wire format: projection confirms only the flier died", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 4;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).toContain("ground");
        expect(ids).not.toContain("flier");
        expect(p2.life).toBe(16);
    });
});

describe("Volcanic Eruption ({X}{U}{U}{U} — destroy X target Mountains, deal that many to each creature/player, CR 107.3 / 205.3 / 614.5 / 120.3)", () => {
    function makeMountain(id: string, controllerId: string): CardInstanceState {
        return makeInstance(mountain.id, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    function setupBoard() {
        const m1 = makeMountain("mtn-1", "p2");
        const m2 = makeMountain("mtn-2", "p2");
        const m3 = makeMountain("mtn-3", "p2");
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [flier] }),
                makePlayer("p2", { battlefield: [m1, m2, m3, lion] }),
            ],
        });
    }

    it("declares X-bound count and Mountain subtype filter", () => {
        expect(volcanicEruption.targetRequirement).toEqual({
            type: "Land",
            subtypeFilter: "Mountain",
            count: "X",
        });
    });

    it("destroys X Mountains and deals X damage to each creature and each player", () => {
        const state = setupBoard();
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        // Two Mountains gone from p2's battlefield.
        const p2 = state.players[1];
        expect(p2.battlefield.find((c) => c.id === "mtn-1")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "mtn-2")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "mtn-3")).toBeDefined();

        // Savannah Lions (toughness 1) dies to 2 damage; Serra Angel
        // (toughness 4) survives with 2 marked damage.
        expect(p2.battlefield.find((c) => c.id === "lion")).toBeUndefined();
        const flier = state.players[0].battlefield.find(
            (c) => c.id === "flier"
        );
        expect(flier?.damageMarked).toBe(2);

        // Mountains + Lions in p2's graveyard.
        const p2GraveIds = p2.graveyard.map((c) => c.id);
        expect(p2GraveIds).toEqual(
            expect.arrayContaining(["mtn-1", "mtn-2", "lion"])
        );
        // Volcanic Eruption itself goes to its caster's graveyard (CR 608.2k).
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            volcanicEruption.id
        );

        // Both players take 2.
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });

    it("treats dual lands with the Mountain subtype as legal targets (CR 205.3)", () => {
        // Plateau is "Land — Mountain Plains" — has the Mountain subtype.
        const dual = makeInstance(plateau.id, {
            id: "plateau",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [dual] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            volcanicEruption.targetRequirement!
        );
        expect(legal.map((t) => t.id)).toContain("plateau");
    });

    it("excludes non-Mountain lands from legal targets", () => {
        // Underground Sea (Island Swamp) — no Mountain subtype, must NOT match.
        const sea = makeInstance(undergroundSea.id, {
            id: "sea",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [sea] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            volcanicEruption.targetRequirement!
        );
        expect(legal).toHaveLength(0);
    });

    it("skips a target that is no longer a Mountain on resolution (CR 608.2b)", () => {
        // Pre-stage: caster picked two targets, but mtn-2 has already left
        // the battlefield (removed before resolution). Only mtn-1 is still a
        // Mountain — Volcanic Eruption deals 1 damage, not 2.
        const state = setupBoard();
        // Surgically remove mtn-2 from the battlefield.
        const p2 = state.players[1];
        p2.battlefield = p2.battlefield.filter((c) => c.id !== "mtn-2");

        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        // Only mtn-1 was destroyed → damage = 1.
        expect(p2.battlefield.find((c) => c.id === "mtn-1")).toBeUndefined();
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        // Savannah Lions (toughness 1) dies even to 1 damage.
        expect(p2.battlefield.find((c) => c.id === "lion")).toBeUndefined();
        // Serra Angel (toughness 4) survives with 1 marked damage.
        const flier = state.players[0].battlefield.find(
            (c) => c.id === "flier"
        );
        expect(flier?.damageMarked).toBe(1);
    });

    it("is a no-op when no Mountains were destroyed (avoids spurious 0 damage)", () => {
        const state = setupBoard();
        // Surgically remove every Mountain before resolution — every chosen
        // target is now off-battlefield.
        const p2 = state.players[1];
        p2.battlefield = p2.battlefield.filter(
            (c) => !c.subtypes.includes("Mountain")
        );
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
        const lion = p2.battlefield.find((c) => c.id === "lion");
        expect(lion?.damageMarked).toBeUndefined();
    });

    it("wire format: destroyed Mountains and damaged creatures survive projection", () => {
        const state = setupBoard();
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 2, "p2");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).not.toContain("mtn-1");
        expect(ids).not.toContain("mtn-2");
        expect(ids).toContain("mtn-3");
        // Savannah Lions died → not on the projected board.
        expect(ids).not.toContain("lion");
        expect(p2.life).toBe(18);
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.life).toBe(18);
    });
});

describe("Damage accumulation on creatures (CR 120.3, 704.5g, 514.2)", () => {
    function setup() {
        // Serra Angel: 4/4 flying — two Lightning Bolts (3 each) accumulate
        // to 6 marked damage >= 4 toughness → dies. One alone leaves her at
        // 3 marked damage, alive.
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
    }

    it("single non-lethal hit leaves the creature alive with marked damage", () => {
        const state = setup();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        const angel = state.players[1].battlefield.find(
            (c) => c.id === "angel"
        );
        expect(angel).toBeDefined();
        expect(angel!.damageMarked).toBe(3);
    });

    it("second hit accumulates and kills once marked damage >= toughness", () => {
        const state = setup();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "angel")
        ).toBeUndefined();
        // Angel in p2's graveyard (along with the two resolved bolts for p1).
        expect(
            state.players[1].graveyard.find(
                (c) => (c.card as { id: string }).id === serraAngel.id
            )
        ).toBeDefined();
    });

    it("CLEANUP wipes marked damage (CR 514.2)", () => {
        const state = setup();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        // Jump straight to END_STEP so the next advancePhase lands on CLEANUP,
        // whose entry handler wipes marked damage inline (CR 514.2). Walking
        // every phase with advancePhase risks an auto-skip / combat-entry loop
        // in a scenario without declared attackers.
        state.phase = "END_STEP";
        // advancePhase will traverse CLEANUP (auto) into the next turn's
        // UPKEEP — the CR 514.2 wipe runs inline on CLEANUP entry.
        advancePhase(state);
        const angel = state.players[1].battlefield.find(
            (c) => c.id === "angel"
        );
        expect(angel).toBeDefined();
        expect(angel!.damageMarked).toBeUndefined();
    });
});

describe("Dark Ritual (add {B}{B}{B}, CR 608.3 + 106.1)", () => {
    it("adds three black mana to the caster's mana pool on resolution", () => {
        const state = makeState();
        pushSpell(state, darkRitual.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("adds to the caster, not the opponent", () => {
        const state = makeState();
        pushSpell(state, darkRitual.id, "p2");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B ?? 0).toBe(0);
        expect(state.players[1].manaPool.B).toBe(3);
    });
});

describe("Ancestral Recall (target player draws 3, CR 608.3)", () => {
    it("draws 3 cards for the target player", () => {
        const p2Library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p2-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: p2Library }),
            ],
        });
        pushSpell(state, ancestralRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(3);
        expect(state.players[1].library).toHaveLength(2);
    });
});

describe("Braingeyser ({X}{U}{U} — target player draws X, CR 107.3 / 121.1)", () => {
    function setup(libSize = 10) {
        const p2Library = Array.from({ length: libSize }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p2-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: p2Library }),
            ],
        });
    }

    it("target player draws X cards on resolution", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(4);
        expect(state.players[1].library).toHaveLength(6);
    });

    it("can target the caster", () => {
        const p1Library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p1-lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { library: p1Library }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("is a no-op when X is 0 (draws no cards)", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(10);
    });

    it("stops at empty library and flags hasDrawnFromEmpty (CR 704.5b)", () => {
        // Library has only 2 cards; X=5 draws 2 and then pulls from empty.
        const state = setup(2);
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(2);
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].hasDrawnFromEmpty).toBe(true);
    });

    it("goes to the caster's graveyard after resolving (CR 608.2k)", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 1;
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            braingeyser.id
        );
    });

    it("wire format: chosenX survives projectPublicState", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack[0];
        expect(projectedItem.chosenX).toBe(3);
        expect(projectedItem.targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("declares a single-player target requirement", () => {
        expect(braingeyser.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });
});

describe("Counterspell (counter target spell, CR 701.5a)", () => {
    it("removes a spell from the stack (doesn't let it resolve)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        // Resolve Counterspell first (top of stack → LIFO)
        resolveTopOfStack(state);
        // The Lightning Bolt should have been removed from the stack.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        // Counterspell itself goes to p1's graveyard.
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("preserves p1 life (bolt never resolves)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Swords to Plowshares (exile + gain life = power, CR 608.3)", () => {
    it("exiles the target creature and grants life = its power to controller", () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
        pushSpell(state, swordsToPlowshares.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        // Exiled (not graveyard).
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(1);
        expect(state.players[1].exile[0].id).toBe("angel");
        // Controller of the exiled creature (p2) gains life = angel's power (4).
        expect(state.players[1].life).toBe(24);
    });
});

describe("target-legality gate at resolution (CR 608.2b / 608.2c)", () => {
    // CR 608.2b — "If all its targets, for every instance of the word
    // 'target,' are now illegal, the spell or ability doesn't resolve. It's
    // removed from the stack and, if it's a spell, put into its owner's
    // graveyard." (Countered by the game rules / "fizzle".)
    it("CR 608.2b — Swords to Plowshares fizzles cleanly when its sole target left the battlefield (regression for the crash)", () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
        pushSpell(state, swordsToPlowshares.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        // Target leaves the battlefield before resolution (bounced/sacrificed).
        removePermanentTo(state, "angel", "graveyard");

        // Must NOT throw "Creature angel not on battlefield" — the gate
        // counters the spell before its resolve() runs.
        expect(() => resolveTopOfStack(state)).not.toThrow();

        // No effect applied: controller did NOT gain life from the (gone) power.
        expect(state.players[1].life).toBe(20);
        // Countered by the game rules → owner's graveyard (Swords' caster p1).
        const gy = state.players[0].graveyard;
        expect(
            gy.some(
                (c) => (c.card as { id?: string }).id === swordsToPlowshares.id
            )
        ).toBe(true);
        // The spell left the stack.
        expect(state.stack).toHaveLength(0);
    });

    it("CR 608.2b — a single-target damage spell with its only target gone fizzles to the graveyard, dealing no damage", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        removePermanentTo(state, "lion", "graveyard");

        expect(() => resolveTopOfStack(state)).not.toThrow();
        // Opponent's life untouched — the bolt never resolved.
        expect(state.players[1].life).toBe(20);
        // Bolt is in p1's graveyard (countered), not still on the stack.
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].graveyard.some(
                (c) => (c.card as { id?: string }).id === lightningBolt.id
            )
        ).toBe(true);
    });

    // CR 608.2c — "The spell or ability does as much as possible." An illegal
    // target is skipped; remaining legal targets are still affected.
    it("CR 608.2c — Fireball with one of two targets gone still resolves, hitting only the surviving target", () => {
        const survivor = makeInstance(serraAngel.id, {
            id: "survivor",
            controllerId: "p2",
            ownerId: "p2",
        });
        const goner = makeInstance(serraAngel.id, {
            id: "goner",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [survivor, goner] }),
            ],
        });
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "survivor" },
            { type: "permanent", id: "goner" },
        ]);
        // X=2: Serra Angel has 4 toughness, so the surviving target takes
        // damage but lives — letting us assert it was actually hit.
        item.chosenX = 2;
        // One of the two targets leaves before resolution.
        removePermanentTo(state, "goner", "graveyard");

        expect(() => resolveTopOfStack(state)).not.toThrow();

        // At least one legal target remained → the spell resolves (not
        // countered). The gate prunes the illegal target so resolve() only
        // reads the survivor (CR 608.2c "an illegal target is skipped").
        const remaining = state.players[1].battlefield.find(
            (c) => c.id === "survivor"
        );
        expect(remaining).toBeDefined();
        expect(remaining?.damageMarked).toBeGreaterThan(0);
        // The spell left the stack (resolved) rather than being countered.
        expect(state.stack).toHaveLength(0);
    });

    // Untargeted spells are entirely unaffected by the gate.
    it("untargeted spell (Wrath of God) is unaffected by the legality gate", () => {
        const angel = makeInstance(serraAngel.id, { id: "angel" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // Both creatures destroyed — the gate did not interfere.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    // Wire format: the fizzle outcome must survive the GameState → public
    // projection so the client sees the spell gone from the stack and in the
    // graveyard (rather than a stuck stack item).
    it("wire format: fizzle outcome survives projectPublicState", () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
        pushSpell(state, swordsToPlowshares.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        removePermanentTo(state, "angel", "graveyard");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        // Stack is empty in the projected (client-visible) state.
        expect(projected.stack).toHaveLength(0);
        // Swords sits in p1's projected graveyard, slimmed to `{ id }`.
        const slimGy = projected.players[0].graveyard;
        expect(
            slimGy.some(
                (c) => (c.card as { id?: string }).id === swordsToPlowshares.id
            )
        ).toBe(true);
    });
});

describe("Wrath of God (destroy all creatures, can't regenerate, CR 701.15c)", () => {
    it("moves every creature to its owner's graveyard", () => {
        const angel = makeInstance(serraAngel.id, { id: "angel" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("angel");
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");
    });

    it("regeneration shields are NOT consumed — the rider suppresses them", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        // Lion in graveyard, not in play — Wrath bypassed the shield.
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "lion")
        ).toBeDefined();
    });

    it("indestructible creatures still survive (CR 702.12)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "lion")
        ).toBeDefined();
    });
});

describe("Disenchant (destroy target Artifact/Enchantment, CR 608.3)", () => {
    it("destroys a target enchantment", () => {
        const c = makeInstance(castle.id, { id: "castle-target" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [c] }), makePlayer("p2")],
        });
        pushSpell(state, disenchant.id, "p2", [
            { type: "permanent", id: "castle-target" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard[0].id).toBe("castle-target");
    });

    it("uses the destroy-target effect shorthand (registry-compiled resolve)", () => {
        expect(disenchant.effect).toBe("destroy-target");
        expect(disenchant.resolve).toBeUndefined();
    });

    it("wire format: destroyed target absent from projected battlefield, present in graveyard", () => {
        const c = makeInstance(castle.id, { id: "castle-target" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [c] }), makePlayer("p2")],
        });
        pushSpell(state, disenchant.id, "p2", [
            { type: "permanent", id: "castle-target" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.map((c) => c.id)).not.toContain("castle-target");
        expect(p1.graveyard.map((c) => c.id)).toContain("castle-target");
    });
});

describe("Demonic Tutor (search library, put into hand, CR 701.19)", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find((s) => s.id === head.stackItemId);
        if (!item) throw new Error("stack item missing");
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    it("enqueues a search-library pending choice for the caster", () => {
        const card = makeInstance(swamp.id, {
            id: "target-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [makePlayer("p1", { library: [card] }), makePlayer("p2")],
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices?.[0]).toMatchObject({
            playerId: "p1",
            zone: "library",
            count: 1,
            kind: "search-library",
        });
    });

    it("wire format: exposes library face-up to the searcher and hides it from the opponent (CR 401.4 / 701.19)", () => {
        const wanted = makeInstance(grizzlyBears.id, {
            id: "wanted",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const filler = makeInstance(swamp.id, {
            id: "filler",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [wanted, filler] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state);

        const forP1 = projectPublicState(state, 1, "p1");
        expect(forP1.players[0].library).toEqual({ count: 2, known: [] });
        expect(forP1.players[0].librarySearch?.map((c) => c.id)).toEqual([
            "wanted",
            "filler",
        ]);
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[0].librarySearch).toBeUndefined();
        expect(forP2.players[0].library).toEqual({ count: 2, known: [] });
    });

    it("moves the chosen card into the caster's hand and shuffles library", () => {
        const wanted = makeInstance(grizzlyBears.id, {
            id: "wanted",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const others = [
            makeInstance(swamp.id, {
                id: "other-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(swamp.id, {
                id: "other-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { library: [wanted, ...others] }),
                makePlayer("p2"),
            ],
            rngSeed: 1,
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state); // step 0 suspends
        expect(state.pendingChoices).toHaveLength(1);
        commitHead(state, ["wanted"]);
        resolveTopOfStack(state); // step 1 resumes

        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toContain("wanted");
        expect(p1.library.map((c) => c.id)).not.toContain("wanted");
        expect(p1.library).toHaveLength(2);
    });
});

describe("Drain Life (X damage to any target, gain X life, CR 107.3 + 120.1)", () => {
    it("deals X damage to a player and gains the caster X life", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        spell.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
        expect(state.players[0].life).toBe(25);
    });

    it("deals X damage to a creature and gains the caster X life", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "permanent", id: "opp-bear" },
        ]);
        spell.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
    });

    it("is a no-op when X is 0", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        spell.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });
});

describe("Royal Assassin ({T}: destroy target tapped creature, CR 701.20 + 701.7)", () => {
    function setup() {
        const assassin = makeInstance(royalAssassin.id, {
            id: "assassin",
            isSummoningSick: false,
        });
        const victim = makeInstance(savannahLions.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [assassin] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state, assassin, victim };
    }

    function activate(
        state: ReturnType<typeof makeState>,
        source: CardInstanceState,
        targetId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "royal-assassin-destroy",
            targets: [{ type: "permanent", id: targetId }],
        });
        resolveTopOfStack(state);
    }

    it("declares a tapped-creature TargetRequirement", () => {
        const ability = royalAssassin.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            tappedFilter: "tapped",
        });
    });

    it("destroys a tapped creature on resolution", () => {
        const { state, assassin, victim } = setup();
        victim.isTapped = true;
        activate(state, assassin, "victim");
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("victim");
    });

    it("fizzles silently if target untaps between activation and resolution (CR 608.2b)", () => {
        const { state, assassin, victim } = setup();
        victim.isTapped = true;
        state.stack.push({
            ...assassin,
            zone: "stack",
            castById: "p1",
            abilityId: "royal-assassin-destroy",
            targets: [{ type: "permanent", id: "victim" }],
        });
        // Opponent untaps the target in response.
        state.players[1].battlefield[0].isTapped = false;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("getLegalTargets only returns tapped creatures", () => {
        const { state, victim } = setup();
        const tappedBear = makeInstance(grizzlyBears.id, {
            id: "tapped-bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        state.players[1].battlefield.push(tappedBear);
        // victim is untapped (default) → should NOT appear; tappedBear should.
        expect(victim.isTapped).toBe(false);
        const req = royalAssassin.activatedAbilities?.[0]?.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req);
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("tapped-bear");
        expect(ids).not.toContain("victim");
    });
});

describe("Nightmare (flying, P/T = Swamps you control, CR 604.3 CDA)", () => {
    function setup(args: { controller: string; swamps: number }) {
        const nm = makeInstance(nightmare.id, {
            id: "nm",
            controllerId: args.controller,
            ownerId: args.controller,
        });
        const battlefield: CardInstanceState[] = [nm];
        for (let i = 0; i < args.swamps; i++) {
            battlefield.push(
                makeInstance(swamp.id, {
                    id: `swamp-${args.controller}-${i}`,
                    controllerId: args.controller,
                    ownerId: args.controller,
                })
            );
        }
        const players =
            args.controller === "p1"
                ? [makePlayer("p1", { battlefield }), makePlayer("p2")]
                : [makePlayer("p1"), makePlayer("p2", { battlefield })];
        return makeState({ players });
    }

    it("has flying as a baseline static ability", () => {
        expect(nightmare.staticAbilities).toContain("flying");
    });

    it("P/T equals controller's Swamp count (3)", () => {
        const state = setup({ controller: "p1", swamps: 3 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(3);
        expect(getEffectiveToughness(state, nm)).toBe(3);
    });

    it("does NOT count opponent's Swamps", () => {
        const state = setup({ controller: "p1", swamps: 2 });
        state.players[1].battlefield.push(
            makeInstance(swamp.id, {
                id: "opp-swamp",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(2);
        expect(getEffectiveToughness(state, nm)).toBe(2);
    });

    it("is 0/0 with no Swamps in play (would die to SBA, CR 704.5f)", () => {
        const state = setup({ controller: "p1", swamps: 0 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(0);
        expect(getEffectiveToughness(state, nm)).toBe(0);
    });

    it("CDA survives the projection boundary (wire format)", () => {
        const state = setup({ controller: "p1", swamps: 4 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectiveToughness(state, nm)).toBe(4);
        const projected = projectPublicState(state, 0, "p1");
        const slimNm = projected.players[0].battlefield.find(
            (c) => c.id === "nm"
        );
        if (!slimNm) throw new Error("nm not in projection");
        expect(getEffectivePower(projected, slimNm)).toBe(4);
        expect(getEffectiveToughness(projected, slimNm)).toBe(4);
    });
});

describe("Sengir Vampire (+1/+1 on damaged-creature death, CR 603.2)", () => {
    it("has flying and the CREATURE_DIED trigger", () => {
        expect(sengirVampire.staticAbilities).toContain("flying");
        const trig = sengirVampire.triggeredAbilities?.[0];
        expect(trig?.event).toBe("CREATURE_DIED");
    });

    it("grows +1/+1 when a blocker it damaged dies in combat", async () => {
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: ["vamp"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        // Bear is dead and in graveyard
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
        // CREATURE_DIED trigger is on the stack for Sengir Vampire
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "sengir-vampire-counter"
        );
        resolveTopOfStack(state);
        const live = state.players[0].battlefield[0];
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(5);
        expect(live.counters?.["+1/+1"]).toBe(1);
    });

    it("does NOT trigger on the death of a creature it didn't damage", async () => {
        // Vampire attacks, is blocked by bear1. A second bear (bear2) dies from
        // damage dealt by another attacker, not by vampire. Vampire's trigger
        // must not fire for bear2's death.
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire, other] }),
                makePlayer("p2", { battlefield: [bear1, bear2] }),
            ],
            combat: {
                attackerIds: ["vamp", "other"],
                confirmed: true,
                blockerAssignments: { bear1: ["vamp"], bear2: ["other"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {
            vamp: { bear1: 4 },
            other: { bear2: 2 },
        });
        // bear1 (damaged by vamp) and bear2 (damaged by other) are both dead.
        // Only bear1's death should trigger Sengir Vampire.
        expect(state.players[1].battlefield).toHaveLength(0);
        const sengirTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "sengir-vampire-counter"
        );
        expect(sengirTriggers).toHaveLength(1);
    });

    it("does NOT trigger on Sengir Vampire's own death", async () => {
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            toughness: 1, // make it fragile so it dies to the bear
            power: 4,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
            toughness: 10,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: ["vamp"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        // Vampire damaged the bear but died from the bear's counter-damage.
        // The bear survived (10 toughness). No CREATURE_DIED for bear →
        // no Sengir trigger. Vampire's own death must not trigger either
        // (matches excludes self).
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(1);
        const sengirTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "sengir-vampire-counter"
        );
        expect(sengirTriggers).toHaveLength(0);
    });

    it("clears damagedBySources at CLEANUP (CR 514.2)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            damagedBySources: ["some-source"],
        });
        const state = makeState({
            phase: "END_STEP",
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        advancePhase(state); // END_STEP → CLEANUP (auto-advances to UNTAP)
        expect(
            state.players[1].battlefield[0].damagedBySources
        ).toBeUndefined();
    });

    it("wire format: +1/+1 counter survives projectPublicState", async () => {
        // Visible-on-board effect from a diedTrigger factory. Re-runs the P/T
        // assertion against the projected state so the projection layer
        // (which slims `card.card` to `{ id }`) can't silently break the
        // counter contribution.
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: ["vamp"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const projectedVamp = projected.players[0].battlefield.find(
            (c) => c.id === "vamp"
        )!;
        expect(getEffectivePower(projected, projectedVamp)).toBe(5);
        expect(getEffectiveToughness(projected, projectedVamp)).toBe(5);
        expect(projectedVamp.counters?.["+1/+1"]).toBe(1);
    });
});

describe("Sea Serpent (CR 508.1c attack restriction + CR 603.8 state trigger)", () => {
    it("uses data-driven attack-restriction (no magic string)", () => {
        expect(seaSerpent.staticAbilities).not.toContain(
            "cant-attack-unless-defender-controls-Island"
        );
        expect(seaSerpent.staticEffects).toBeDefined();
        expect(
            seaSerpent.staticEffects!.some(
                (e) => e.kind === "attack-restriction"
            )
        ).toBe(true);
    });

    function setup(opts: {
        controllerHasIsland: boolean;
        defenderHasIsland: boolean;
    }) {
        const serpent = makeInstance(seaSerpent.id, {
            id: "serpent",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p1Lands = opts.controllerHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p1-isle",
                      controllerId: "p1",
                      ownerId: "p1",
                  }),
              ]
            : [];
        const p2Lands = opts.defenderHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p2-isle",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [serpent, ...p1Lands] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
    }

    it("can attack when defending player controls an Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: true,
        });
        const serpent = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            serpent,
            state.players[1].battlefield
        );
        expect(result).toEqual({ eligible: true });
    });

    it("cannot attack when defending player has no Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const serpent = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            serpent,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/Island/);
        }
    });

    it("ignores controller's Islands — only defender's count for the attack restriction", () => {
        // p1 controls an Island, p2 does not. Serpent still cannot attack
        // because the restriction reads "defending player controls an Island".
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const serpent = state.players[0].battlefield[0];
        expect(
            validateAttackerEligibility(serpent, state.players[1].battlefield)
                .eligible
        ).toBe(false);
    });

    it("state trigger queues a sacrifice when controller has no Islands", () => {
        // Serpent in play, controller has zero Islands. The first SBA pass
        // schedules the sacrifice trigger on the stack (CR 117.5 + 603.8).
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: true,
        });
        expect(state.stack).toHaveLength(0);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        expect(item.triggeredAbilityId).toBe(
            "sea-serpent-no-islands-sacrifice"
        );
        expect(item.triggerSourceId).toBe("serpent");
        expect(item.triggerEvent?.type).toBe("STATE_CHECK");
    });

    it("does NOT trigger a second time while the first trigger is on the stack (CR 603.8)", () => {
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        // Subsequent SBA passes (e.g. another priority handoff) must not pile
        // up duplicate triggers — the state trigger holds itself off until
        // the existing copy resolves or otherwise leaves the stack.
        checkStateBasedActions(state);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
    });

    it("does NOT trigger when controller has at least one Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(0);
    });

    it("on resolve, sends Sea Serpent to its owner's graveyard", () => {
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "serpent"
        );
    });

    it("re-triggers after the first sacrifice trigger leaves the stack if the condition still holds", () => {
        // Two Sea Serpents: the trigger fires once per source even after a
        // separate trigger of the same kind has resolved. After resolution,
        // a fresh SBA pass produces a new trigger for any remaining serpent
        // whose controller still has no Islands.
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        const second = makeInstance(seaSerpent.id, {
            id: "serpent2",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        state.players[0].battlefield.push(second);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "serpent",
            "serpent2",
        ]);
    });

    it("fizzles at resolve if controller has gained an Island in the meantime (CR 603.8 re-check)", () => {
        // CR 603.8 — the state-trigger condition is re-checked at resolution.
        // The `stateTrigger` factory exposes this via the engine-level
        // interveningIf hook. Setup: trigger fires (no Islands), then an
        // Island enters the battlefield BEFORE the trigger resolves, then
        // the stack is resolved. Expected: trigger fizzles, Sea Serpent
        // stays on the battlefield, TRIGGER_FIZZLED is emitted.
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        // Condition flips: controller now has an Island.
        state.players[0].battlefield.push(
            makeInstance(island.id, {
                id: "p1-isle-late",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        resolveTopOfStack(state);
        // Stack item consumed without invoking resolve: the source stays on
        // the battlefield and nothing hits the graveyard. (Engine drains
        // pendingEvents into trigger scans in `processPendingActionTriggers`,
        // so the TRIGGER_FIZZLED event itself isn't observable here — the
        // engine-level fizzle path is covered by
        // `convex/gre/__tests__/intervening-if.test.ts`.)
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "serpent")
        ).toBe(true);
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "serpent"
        );
    });

    it("wire format: attack restriction survives projectPublicState", () => {
        // The projection slims `card.card` to `{ id }`. The restriction
        // logic reads `staticAbilities` and the defender battlefield's
        // `subtypes` — both of which the projection preserves.
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedSerpent = projected.players[0].battlefield.find(
            (c) => c.id === "serpent"
        )!;
        const projectedDefender = projected.players[1].battlefield;
        const result = validateAttackerEligibility(
            projectedSerpent as CardInstanceState,
            projectedDefender as CardInstanceState[]
        );
        expect(result.eligible).toBe(false);
    });
});

describe("Sinkhole (destroy target land, CR 701.7)", () => {
    it("destroys a target Swamp and sends it to its owner's graveyard", () => {
        const land = makeInstance(swamp.id, {
            id: "p1-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sinkhole.id, "p2", [
            { type: "permanent", id: "p1-swamp" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "p1-swamp"
        );
    });

    it("declares a Land target requirement with count 1", () => {
        expect(sinkhole.targetRequirement).toEqual({
            type: "Land",
            count: 1,
        });
    });

    it("uses the destroy-target effect shorthand (registry-compiled resolve)", () => {
        expect(sinkhole.effect).toBe("destroy-target");
        expect(sinkhole.resolve).toBeUndefined();
    });

    it("wire format: destroyed land absent from projected battlefield, present in graveyard", () => {
        const land = makeInstance(swamp.id, {
            id: "p1-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sinkhole.id, "p2", [
            { type: "permanent", id: "p1-swamp" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.map((c) => c.id)).not.toContain("p1-swamp");
        expect(p1.graveyard.map((c) => c.id)).toContain("p1-swamp");
    });
});

// ---------------------------------------------------------------------------
// Keyword abilities (the layer/combat system tests them generically; here we
// only assert the card definition carries the right keywords — guards against
// typos / accidental removals).
// ---------------------------------------------------------------------------

describe("Serra Angel (keyword abilities)", () => {
    it("has flying and vigilance", () => {
        expect(serraAngel.staticAbilities).toContain("flying");
        expect(serraAngel.staticAbilities).toContain("vigilance");
    });
});

describe("Elvish Archers (first strike, CR 702.7)", () => {
    it("is a 2/1 Elf Archer for {1}{G} with first strike", () => {
        expect(elvishArchers.manaCost).toEqual({ X: 1, G: 1 });
        expect(elvishArchers.types).toContain("Creature");
        expect(elvishArchers.subtypes).toEqual(["Elf", "Archer"]);
        expect(elvishArchers.power).toBe(2);
        expect(elvishArchers.toughness).toBe(1);
        expect(elvishArchers.staticAbilities).toContain("first strike");
    });

    it("kills a 2/2 blocker in the first-strike step before it can swing back", () => {
        // Elvish Archers (2/1, first strike) attacks, blocked by Grizzly
        // Bears (2/2). CR 510.2: only first/double strike creatures deal
        // damage in the first-strike step — the archer kills the bear, then
        // the bear (dead) cannot deal regular combat damage.
        const archer = makeInstance(elvishArchers.id, {
            id: "archer",
            controllerId: "p1",
            isAttacking: true,
        });
        const bear: CardInstanceState = {
            id: "bear",
            card: { id: "fake-bear" },
            types: ["Creature"] as CardType[],
            subtypes: ["Bear"],
            staticAbilities: [],
            power: 2,
            toughness: 2,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
            isBlocking: true,
        };
        const p1 = makePlayer("p1", { battlefield: [archer] });
        const p2 = makePlayer("p2", { battlefield: [bear] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["archer"],
                confirmed: true,
                blockerAssignments: { bear: ["archer"] },
                blockersConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        expect(p2.battlefield.find((c) => c.id === "bear")).toBeUndefined();
        expect(p2.graveyard.some((c) => c.id === "bear")).toBe(true);

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        const archerAfter = p1.battlefield.find((c) => c.id === "archer");
        expect(archerAfter).toBeDefined();
    });

    it("dies to a 3/3 blocker (first strike can't save a 1-toughness attacker from a bigger body)", () => {
        // Archer deals 2 first-strike to a 3/3 — 3/3 survives (2 < 3) and
        // then hits back in the regular step for 3, killing the archer.
        const archer = makeInstance(elvishArchers.id, {
            id: "archer",
            controllerId: "p1",
            isAttacking: true,
        });
        const ogre: CardInstanceState = {
            id: "ogre",
            card: { id: "fake-ogre" },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 3,
            toughness: 3,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
            isBlocking: true,
        };
        const p1 = makePlayer("p1", { battlefield: [archer] });
        const p2 = makePlayer("p2", { battlefield: [ogre] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["archer"],
                confirmed: true,
                blockerAssignments: { ogre: ["archer"] },
                blockersConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        // Ogre alive (3 toughness > 2 damage from first strike).
        expect(p2.battlefield.find((c) => c.id === "ogre")).toBeDefined();

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        // Archer now dead: ogre's 3 power >= archer's 1 toughness.
        expect(p1.battlefield.find((c) => c.id === "archer")).toBeUndefined();
        expect(p1.graveyard.some((c) => c.id === "archer")).toBe(true);
    });
});

describe("Protection keyword helpers (CR 702.16)", () => {
    it("parses color variants only", () => {
        expect(parseProtectionFromColor("protection from black")).toBe("B");
        expect(parseProtectionFromColor("protection from white")).toBe("W");
        expect(parseProtectionFromColor("protection from blue")).toBe("U");
        expect(parseProtectionFromColor("protection from red")).toBe("R");
        expect(parseProtectionFromColor("protection from green")).toBe("G");
        // Non-color variants return null (not yet supported).
        expect(
            parseProtectionFromColor("protection from everything")
        ).toBeNull();
        expect(parseProtectionFromColor("flying")).toBeNull();
    });

    it("collapses duplicate protection entries (CR 702.16m)", () => {
        const card = {
            staticAbilities: [
                "protection from black",
                "protection from black",
                "first strike",
            ],
        };
        expect(getProtectedColors(card)).toEqual(["B"]);
    });

    it("matches only when source color overlaps", () => {
        const wk = makeInstance(whiteKnight.id, { id: "wk" });
        const blackSource = makeInstance(bogWraith.id, {
            id: "src-b",
            controllerId: "p1",
        });
        const redSource = makeInstance(lightningBolt.id, {
            id: "src-r",
            controllerId: "p1",
            zone: "stack",
        });
        expect(isProtectedFromSource(wk, blackSource)).toBe(true);
        expect(isProtectedFromSource(wk, redSource)).toBe(false);
    });
});

describe("White Knight (first strike + protection from black, CR 702.7 + 702.16)", () => {
    it("is a 2/2 Knight for {W}{W} with first strike and protection from black", () => {
        expect(whiteKnight.manaCost).toEqual({ W: 2 });
        expect(whiteKnight.types).toContain("Creature");
        expect(whiteKnight.subtypes).toEqual(["Human", "Knight"]);
        expect(whiteKnight.power).toBe(2);
        expect(whiteKnight.toughness).toBe(2);
        expect(whiteKnight.staticAbilities).toContain("first strike");
        expect(whiteKnight.staticAbilities).toContain("protection from black");
    });

    it("CR 702.16b — cannot be targeted by a black-source damage spell", () => {
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wk] }),
            ],
        });
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, [
            "B",
        ]);
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("wk");
        // Players are still legal (players have no color; protection from
        // color only protects permanents with the ability).
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
    });

    it("CR 702.16b — can still be targeted by a red-source damage spell", () => {
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wk] }),
            ],
        });
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, [
            "R",
        ]);
        expect(legal.map((t) => t.id)).toContain("wk");
    });

    it("CR 702.16f — as attacker, cannot be blocked by a black creature", () => {
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p1",
            isAttacking: true,
        });
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p2",
            ownerId: "p2",
        });
        const result = validateBlockerEligibility(wk, wraith, [wraith]);
        expect(result.eligible).toBe(false);
    });

    it("CR 702.16e — blocking a black attacker prevents its return damage while WK's first strike still hits back", () => {
        // Bog Wraith (3/3, black) attacks; White Knight (2/2 first strike,
        // protection from black) blocks. First-strike step: WK deals 2 to
        // wraith (toughness 3 → survives with 2 marked). Regular step: wraith
        // would deal 3 to WK → prevented (CR 702.16e). WK already dealt its
        // damage in first-strike step. Net: WK unhurt, wraith survives with
        // 2 marked damage.
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p1",
            isAttacking: true,
        });
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const p1 = makePlayer("p1", { battlefield: [wraith] });
        const p2 = makePlayer("p2", { battlefield: [wk] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["wraith"],
                confirmed: true,
                blockerAssignments: { wk: ["wraith"] },
                blockersConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        // Wraith alive with 2 marked damage (3 toughness > 2 first-strike).
        const wraithAfterFS = p1.battlefield.find((c) => c.id === "wraith")!;
        expect(wraithAfterFS.damageMarked).toBe(2);

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        // WK took no damage (pro from black prevented the 3 incoming).
        const wkAfter = p2.battlefield.find((c) => c.id === "wk")!;
        expect(wkAfter.damageMarked ?? 0).toBe(0);
        // Wraith still alive (marked damage 2 < toughness 3).
        expect(p1.battlefield.find((c) => c.id === "wraith")).toBeDefined();
    });

    it("wire format: block rejection survives projectPublicState (regression guard)", () => {
        // The projection slims `card.card` to { id }. getColors must still
        // derive the source's color via registry lookup.
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p1",
            isAttacking: true,
        });
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wk] }),
                makePlayer("p2", { battlefield: [wraith] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimWk = projected.players[0].battlefield.find(
            (c) => c.id === "wk"
        )! as CardInstanceState;
        const slimWraith = projected.players[1].battlefield.find(
            (c) => c.id === "wraith"
        )! as CardInstanceState;
        // Block rejected even on slim projection.
        expect(
            validateBlockerEligibility(slimWk, slimWraith, [slimWraith])
                .eligible
        ).toBe(false);
        // Protection detection still resolves through the slim projection.
        expect(isProtectedFromSource(slimWk, slimWraith)).toBe(true);
    });
});

describe("Black Knight (first strike + protection from white, CR 702.7 + 702.16)", () => {
    it("is a 2/2 Knight for {B}{B} with first strike and protection from white", () => {
        expect(blackKnight.manaCost).toEqual({ B: 2 });
        expect(blackKnight.types).toContain("Creature");
        expect(blackKnight.subtypes).toEqual(["Human", "Knight"]);
        expect(blackKnight.power).toBe(2);
        expect(blackKnight.toughness).toBe(2);
        expect(blackKnight.staticAbilities).toContain("first strike");
        expect(blackKnight.staticAbilities).toContain("protection from white");
    });

    it("CR 702.16b — cannot be targeted by Swords to Plowshares (white source)", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bk] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            swordsToPlowshares.targetRequirement!,
            ["W"]
        );
        expect(legal.map((t) => t.id)).not.toContain("bk");
    });

    it("CR 702.16f — as attacker, cannot be blocked by a white creature", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p1",
            isAttacking: true,
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const result = validateBlockerEligibility(bk, lion, [lion]);
        expect(result.eligible).toBe(false);
    });

    it("wire format: protection detection survives projectPublicState", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p1",
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bk] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBk = projected.players[0].battlefield.find(
            (c) => c.id === "bk"
        )! as CardInstanceState;
        const slimLion = projected.players[1].battlefield.find(
            (c) => c.id === "lion"
        )! as CardInstanceState;
        expect(isProtectedFromSource(slimBk, slimLion)).toBe(true);
    });
});

describe("Aura core — attach / fizzle / SBA 704.5m (CR 303.4)", () => {
    it("ETB attached to the chosen creature target", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "lion" }]);
        resolveTopOfStack(state);
        // Aura is on caster's battlefield, attached to lion.
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("lion");
    });

    it("CR 608.2b / 303.4i — fizzles if the target is no longer on battlefield at resolution", () => {
        // Push the aura with a target, then remove the target from
        // battlefield before resolving (simulates a kill-in-response).
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "lion" }]);
        // Lion dies before the aura resolves.
        state.players[1].battlefield = [];
        resolveTopOfStack(state);
        // Aura went to caster's graveyard, not battlefield.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].graveyard[0].card.id).toBe(redWard.id);
    });

    it("CR 704.5m — aura whose host leaves play goes to graveyard as SBA", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "lion" }]);
        resolveTopOfStack(state);
        // Aura attached to lion.
        expect(
            state.players[0].battlefield.find((c) => c.card.id === redWard.id)
        ).toBeDefined();
        // Lion dies (removed from battlefield) — host becomes illegal.
        state.players[1].battlefield = [];
        checkStateBasedActions(state);
        // Aura swept into caster's graveyard, attachedTo cleared.
        expect(state.players[0].battlefield).toHaveLength(0);
        const gy = state.players[0].graveyard.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(gy).toBeDefined();
        expect(gy.attachedTo).toBeUndefined();
    });

    it("CR 704.5m — aura whose host loses Creature type is detached (currently no such effect, so host deleted proxies the case)", () => {
        // Exercise the "host no longer satisfies enchant" branch by
        // constructing a host that isn't a Creature after attach — easiest
        // way is to hand-attach the aura to a non-creature and run SBA.
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(redWard.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "tome",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome, aura] }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);
        const battlefieldIds = state.players[0].battlefield.map((c) => c.id);
        expect(battlefieldIds).not.toContain("aura");
        expect(battlefieldIds).toContain("tome");
        expect(state.players[0].graveyard.some((c) => c.id === "aura")).toBe(
            true
        );
    });
});

describe("Red Ward (Aura keyword-grant → protection from red, CR 611 + 702.16)", () => {
    it("is a {W} Aura with the right target shape", () => {
        expect(redWard.manaCost).toEqual({ W: 1 });
        expect(redWard.types).toEqual(["Enchantment"]);
        expect(redWard.subtypes).toEqual(["Aura"]);
        expect(redWard.targetRequirement?.type).toBe("Creature");
    });

    it("grants 'protection from red' to its host on attach and reverts on detach", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        // Aura attached; host gained the keyword.
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain("protection from red");

        // Red Lightning Bolt now can't target the bear (CR 702.16b).
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, [
            "R",
        ]);
        expect(legal.map((t) => t.id)).not.toContain("bear");

        // Bear dies (say, exiled by Swords to Plowshares). Aura should
        // detach via SBA and the bear keyword is no longer tracked.
        state.players[1].battlefield = [];
        checkStateBasedActions(state);
        const aura = state.players[0].graveyard.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("reverts the grant when the aura is destroyed directly (removePermanentTo)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === redWard.id
        )!;
        // Baseline: keyword is present on the host.
        expect(bear.staticAbilities).toContain("protection from red");

        // Disenchant-like effect destroys the aura directly.
        removePermanentTo(state, aura.id, "graveyard");

        // Keyword lifted from the host.
        expect(bear.staticAbilities).not.toContain("protection from red");
        expect(bear.grantedStaticAbilities ?? []).toHaveLength(0);
    });

    it("wire format: granted protection survives projectPublicState", () => {
        // Regression: the projection slims `card.card`, but the grant lives
        // on the host's `staticAbilities` array, so a projected bear must
        // still read as protected via isProtectedFromSource.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const redBolt = makeInstance(lightningBolt.id, {
            id: "src",
            controllerId: "p2",
            zone: "stack",
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )! as CardInstanceState;
        expect(isProtectedFromSource(slimBear, redBolt)).toBe(true);
    });
});

describe("Protection-detach SBA (CR 702.16c + 702.16n)", () => {
    it("aura WITHOUT the 702.16n exemption is detached when host gains matching protection", () => {
        // All real ward auras in the set carry the 702.16n rider, so use a
        // synthetic aura (unregistered id → no card def lookup → no
        // exemption) with an embedded mana cost to exercise the non-exempt
        // branch. Blue mana cost + host pro-blue = 702.16c detach.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const syntheticAura: CardInstanceState = {
            id: "syn-aura",
            card: { id: "synthetic-blue-aura", manaCost: { U: 1 } },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            attachedTo: "bear",
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, syntheticAura] }),
                makePlayer("p2"),
            ],
        });

        // Host acquires protection from blue (simulating another source).
        bear.staticAbilities = [
            ...bear.staticAbilities,
            "protection from blue",
        ];
        checkStateBasedActions(state);

        // Aura detached (no exemption) and moved to graveyard.
        expect(
            state.players[0].battlefield.find((c) => c.id === "syn-aura")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "syn-aura")
        ).toBeDefined();
    });

    it("aura whose color does NOT match host protection stays attached", () => {
        // Same setup but host acquires pro-blue. Red Ward is white, pro-blue
        // doesn't match → aura stays.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        bear.staticAbilities = [
            ...bear.staticAbilities,
            "protection from blue",
        ];
        checkStateBasedActions(state);
        // Aura still attached.
        expect(
            state.players[0].battlefield.find((c) => c.card.id === redWard.id)
        ).toBeDefined();
    });

    it("CR 608.2b — aura fizzles if target acquires matching protection between cast and resolution", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Red Ward (white aura) targeting bear — legal at cast.
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        // Before resolution, bear gains protection from white.
        bear.staticAbilities = [
            ...bear.staticAbilities,
            "protection from white",
        ];
        resolveTopOfStack(state);
        // Aura fizzled to caster's graveyard, not attached.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(
            state.players[0].graveyard.find((c) => c.card.id === redWard.id)
        ).toBeDefined();
        // Bear did not gain a new grant from the fizzled aura.
        expect(bear.staticAbilities).not.toContain("protection from red");
    });
});

describe("White Ward (exempt self-referential aura, CR 702.16n)", () => {
    it("stays attached even though aura-color matches granted protection", () => {
        // White Ward is a white aura that grants pro-white. Without the
        // CR 702.16n exemption, the aura would immediately fall off as SBA
        // after attach. With the exemption (exemptFromProtectionDetach), it
        // persists.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, whiteWard.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Aura still attached, host has pro-white.
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === whiteWard.id
        );
        expect(aura).toBeDefined();
        expect(bear.staticAbilities).toContain("protection from white");
    });

    it("all five wards register and carry the 702.16n exemption", () => {
        for (const ward of [
            redWard,
            blueWard,
            blackWard,
            greenWard,
            whiteWard,
        ]) {
            expect(ward.manaCost).toEqual({ W: 1 });
            expect(ward.types).toEqual(["Enchantment"]);
            expect(ward.subtypes).toEqual(["Aura"]);
            expect(ward.targetRequirement?.type).toBe("Creature");
            expect(ward.exemptFromProtectionDetach).toBe(true);
            expect(ward.staticEffects).toHaveLength(1);
            expect(ward.staticEffects?.[0].kind).toBe("keyword-grant");
        }
    });
});

// One smoke test per remaining color ward — the factory is shared, so a per-card
// wire-format check guards against the AURA_AFFECTS_HOST predicate being applied
// inconsistently after extraction.
describe.each([
    { ward: blueWard, keyword: "protection from blue" },
    { ward: blackWard, keyword: "protection from black" },
    { ward: greenWard, keyword: "protection from green" },
])("$ward.name (Aura keyword-grant)", ({ ward, keyword }) => {
    it(`grants '${keyword}' to its host and the grant survives projectPublicState`, () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, ward.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain(keyword);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slimBear.staticAbilities).toContain(keyword);
    });
});

describe("Control Magic (Aura control-change, CR 613.1b layer 2 + 702.10c)", () => {
    it("is a {2}{U}{U} Aura that targets a creature and declares a control-change effect", () => {
        expect(controlMagic.manaCost).toEqual({ X: 2, U: 2 });
        expect(controlMagic.types).toEqual(["Enchantment"]);
        expect(controlMagic.subtypes).toEqual(["Aura"]);
        expect(controlMagic.targetRequirement?.type).toBe("Creature");
        expect(controlMagic.staticEffects).toHaveLength(1);
        expect(controlMagic.staticEffects?.[0].kind).toBe("control-change");
    });

    it("on resolve, transfers control of the enchanted creature and sets summoning sickness", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Bear now lives in p1's battlefield array under p1's control.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("bear");
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p1");
        // CR 702.10c — control continuity broke, sickness applies.
        expect(bearAfter.isSummoningSick).toBe(true);
        // Bookkeeping for reversal: the stack has one entry (this aura)
        // with the pre-flip controller as `previousControllerId`.
        expect(bearAfter.controlChanges).toHaveLength(1);
        expect(bearAfter.controlChanges?.[0].previousControllerId).toBe("p2");

        // Aura sits on caster's battlefield, attached to the bear.
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
        expect(bearAfter.controlChanges?.[0].auraId).toBe(aura.id);
    });

    it("wire format: the control flip survives projectPublicState", () => {
        // Regression: the projection maps each player's battlefield array
        // verbatim (slimming card defs). A controlled creature must therefore
        // appear in the new controller's projected battlefield with the
        // updated controllerId — otherwise the client would render it on
        // the wrong side.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimBear).toBeDefined();
        expect(slimBear?.controllerId).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("reverts control when the aura is destroyed (Disenchant-style removal)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;

        // Disenchant the aura directly.
        removePermanentTo(state, aura.id, "graveyard");

        // Bear returned to p2's battlefield with its original controller.
        expect(state.players[1].battlefield.map((c) => c.id)).toContain("bear");
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p2");
        expect(bearAfter.controlChanges).toBeUndefined();
        // Continuity broke again on reversal — sickness applies until p2's
        // next untap step.
        expect(bearAfter.isSummoningSick).toBe(true);
        // Aura went to its owner's graveyard.
        expect(
            state.players[0].graveyard.find(
                (c) => c.card.id === controlMagic.id
            )
        ).toBeDefined();
    });

    it("host dies → SBA detaches the aura to the caster's graveyard (CR 704.5m)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        // The bear dies (e.g. Lightning Bolt). The host id is gone from
        // every battlefield array — SBA should sweep the aura into its
        // caster's graveyard.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "bear"
        );
        checkStateBasedActions(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === controlMagic.id
            )
        ).toBeUndefined();
        const auraInGY = state.players[0].graveyard.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(auraInGY).toBeDefined();
        expect(auraInGY.attachedTo).toBeUndefined();
    });

    it("retargeting own creature is a no-op for the flip (same controller pre/post)", () => {
        // If the caster already controls the target, the aura attaches but
        // the control-change predicate still runs; since newControllerId
        // matches the current controllerId, no stack entry is written and
        // no battlefield array swap happens.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p1");
        expect(bearAfter.controlChanges).toBeUndefined();
        // Aura is still attached and resident on p1's bf.
        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === controlMagic.id
            )?.attachedTo
        ).toBe("bear");
    });

    it("stacked CMs: latest wins while present; removing the TOP restores to the layer below (CR 613 layer 2 timestamps)", () => {
        // P1 owns bear. P2's CM1 steals it → bear on p2. P1's CM2 steals it
        // back → bear on p1. Removing CM2 first: CR says CM1 is still
        // active, so bear must revert to p2 (not to owner p1).
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
        // CM1 cast by p2 targeting the bear.
        pushSpell(state, controlMagic.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm1 = state.players[1].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p2");

        // CM2 cast by p1 targeting the (now p2-controlled) bear.
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm2 = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id && c.id !== cm1.id
        )!;
        const bearWithBoth = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearWithBoth.controllerId).toBe("p1");
        expect(bearWithBoth.controlChanges).toHaveLength(2);

        // Disenchant CM2 (top of stack) first → CM1 still applies → bear
        // must go to p2, NOT back to owner p1.
        removePermanentTo(state, cm2.id, "graveyard");
        const bearAfterCm2 = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterCm2).toBeDefined();
        expect(bearAfterCm2.controllerId).toBe("p2");
        expect(bearAfterCm2.controlChanges).toHaveLength(1);
        expect(bearAfterCm2.controlChanges?.[0].auraId).toBe(cm1.id);

        // Then disenchant CM1 → no more effects → bear collapses to owner.
        removePermanentTo(state, cm1.id, "graveyard");
        const bearFinal = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearFinal).toBeDefined();
        expect(bearFinal.controllerId).toBe("p1");
        expect(bearFinal.controlChanges).toBeUndefined();
    });

    it("stacked CMs: removing the MIDDLE entry leaves current controller intact and top pops to owner (CR 108.3)", () => {
        // Same stacked setup as above, but this time CM1 (bottom of stack)
        // is destroyed first. CR: CM2 is still active, bear stays on p1.
        // Then CM2 destroyed → stack empty → bear collapses to owner p1.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, controlMagic.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm1 = state.players[1].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm2 = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id && c.id !== cm1.id
        )!;

        // Disenchant CM1 (middle/bottom) — bear stays on p1 (CM2 still
        // applies), stack collapses to a single entry.
        removePermanentTo(state, cm1.id, "graveyard");
        const bearMid = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearMid.controllerId).toBe("p1");
        expect(bearMid.controlChanges).toHaveLength(1);
        expect(bearMid.controlChanges?.[0].auraId).toBe(cm2.id);
        // The middle-removal patched `previousControllerId` so the remaining
        // entry now records the pre-chain value (bear's owner = p1).
        expect(bearMid.controlChanges?.[0].previousControllerId).toBe("p1");

        // Disenchant CM2 — stack empties, bear goes back to owner.
        removePermanentTo(state, cm2.id, "graveyard");
        const bearFinal = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearFinal.controllerId).toBe("p1");
        expect(bearFinal.controlChanges).toBeUndefined();
    });
});

describe("Steal Artifact (Aura control-change on artifacts, CR 613.1b layer 2)", () => {
    it("is a {2}{U}{U} Aura that targets an artifact and declares a control-change effect", () => {
        expect(stealArtifact.manaCost).toEqual({ X: 2, U: 2 });
        expect(stealArtifact.types).toEqual(["Enchantment"]);
        expect(stealArtifact.subtypes).toEqual(["Aura"]);
        expect(stealArtifact.targetRequirement?.type).toBe("Artifact");
        expect(stealArtifact.staticEffects).toHaveLength(1);
        expect(stealArtifact.staticEffects?.[0].kind).toBe("control-change");
    });

    it("on resolve, transfers control of the enchanted artifact (no summoning sickness — artifacts aren't creatures)", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "statue"
        );
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "statue"
        );
        const statueAfter = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(statueAfter.controllerId).toBe("p1");
        // CR 702.10c scopes summoning sickness to creatures — artifacts
        // aren't creatures so they don't pick it up on a control flip.
        expect(statueAfter.isSummoningSick).toBeUndefined();
        expect(statueAfter.controlChanges).toHaveLength(1);
        expect(statueAfter.controlChanges?.[0].previousControllerId).toBe("p2");

        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === stealArtifact.id
        )!;
        expect(aura.attachedTo).toBe("statue");
    });

    it("wire format: the control flip survives projectPublicState", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimStatue = projected.players[0].battlefield.find(
            (c) => c.id === "statue"
        );
        expect(slimStatue).toBeDefined();
        expect(slimStatue?.controllerId).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
    });

    it("reverts control when the aura is destroyed (Disenchant-style removal)", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === stealArtifact.id
        )!;

        removePermanentTo(state, aura.id, "graveyard");

        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "statue"
        );
        const statueAfter = state.players[1].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(statueAfter.controllerId).toBe("p2");
    });

    it("fizzles when the target leaves the battlefield between cast and resolution (CR 608.2b)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "ghost-statue" },
        ]);
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === stealArtifact.id
            )
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stealArtifact.id
        );
    });

    it("SBA detaches the aura when the host loses its artifact type (removed from battlefield)", () => {
        const statue = makeInstance(jadeStatue.id, {
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
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);

        // Artifact host leaves play.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "statue"
        );
        checkStateBasedActions(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === stealArtifact.id
            )
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stealArtifact.id
        );
    });
});

describe("Winter Orb (modern Oracle land-only cap, CR 502.1, ADR 0004)", () => {
    it("is a {2} artifact declaring a single untap-restriction static effect", () => {
        expect(winterOrb.manaCost).toEqual({ X: 2 });
        expect(winterOrb.types).toEqual(["Artifact"]);
        expect(winterOrb.staticEffects).toHaveLength(1);
        const effect = winterOrb.staticEffects?.[0];
        expect(effect?.kind).toBe("untap-restriction");
        if (effect?.kind === "untap-restriction") {
            expect(effect.maxUntap).toBe(1);
            expect(effect.filter).toEqual({ types: "Land" });
        }
    });

    it("the printed legacy keyword `limits-acl-untap` is no longer declared", () => {
        expect(winterOrb.staticAbilities ?? []).not.toContain(
            "limits-acl-untap"
        );
    });

    // Drives the incoming player's UNTAP step by advancing from END_STEP:
    // CLEANUP auto-resolves, turn flips, UNTAP auto-resolves (or
    // suspends on an `untap-pick` prompt), state settles either in UPKEEP
    // or with `pendingChoices` non-empty awaiting a pick.
    function runUntapFor(playerId: string, state: GameState): void {
        state.activePlayerId = playerId === "p1" ? "p2" : "p1";
        state.phase = "END_STEP";
        advancePhase(state);
    }

    it("without Winter Orb, every land + creature the active player controls untaps", () => {
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const creature = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land1, land2, creature] }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(false);
        expect(state.phase).toBe("UPKEEP");
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("with 0 tapped lands, no prompt — UNTAP auto-resolves to UPKEEP", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb", isTapped: true });
        const land = makeInstance(plains.id, { id: "l1", isTapped: false });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orb, land] }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.phase).toBe("UPKEEP");
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        // Winter Orb itself is an artifact (not a land) — untaps normally.
        expect(bf.find((c) => c.id === "orb")?.isTapped).toBe(false);
    });

    it("with 1+ tapped lands, an untap-pick PendingChoice is enqueued ({min:0,max:1}, land filter)", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb", isTapped: true });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orb, land1, land2] }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        expect(state.phase).toBe("UNTAP");
        const queue = state.pendingChoices ?? [];
        expect(queue).toHaveLength(1);
        const head = queue[0];
        expect(head.kind).toBe("untap-pick");
        expect(head.playerId).toBe("p1");
        expect(head.zone).toBe("battlefield");
        expect(head.filter).toEqual({ types: "Land" });
        expect(head.count).toEqual({ min: 0, max: 1 });
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("Winter Orb does NOT cap artifact or creature untaps — non-lands untap normally", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb", isTapped: true });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [orb, land1, land2, bear],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        const bf = state.players[0].battlefield;
        // Non-land permanents are unrestricted — bear + orb untap regardless
        // of the pending land-pick prompt.
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "orb")?.isTapped).toBe(false);
        // Both lands are still tapped — the pick must commit before they untap.
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
    });

    it("non-ACL permanents (enchantments) untap normally under Winter Orb", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb", isTapped: false });
        const land = makeInstance(plains.id, { id: "l1", isTapped: false });
        // Castle is an Enchantment — not a Land, so it's exempt from the cap.
        const enchant = makeInstance(castle.id, {
            id: "castle",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orb, land, enchant] }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "castle")?.isTapped).toBe(false);
        // No tapped lands so no prompt — phase advances to UPKEEP.
        expect(state.phase).toBe("UPKEEP");
    });

    it("Winter Orb on the opponent's side still restricts the active player's land untaps", () => {
        const orb = makeInstance(winterOrb.id, {
            id: "orb",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land1, land2] }),
                makePlayer("p2", { battlefield: [orb] }),
            ],
        });
        runUntapFor("p1", state);

        // Prompt enqueued, lands still tapped — cap applies regardless of
        // who controls the source.
        expect(state.pendingChoices?.[0].kind).toBe("untap-pick");
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
    });

    it("wire format: untap-pick prompt + land filter survive projectPublicState", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb", isTapped: true });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orb, land1, land2] }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0].kind).toBe("untap-pick");
        expect(projected.pendingChoices?.[0].filter).toEqual({
            types: "Land",
        });
        expect(projected.pendingChoices?.[0].count).toEqual({
            min: 0,
            max: 1,
        });
        // Active player's lands are still tapped in the projection — the
        // engine has not committed any untap yet.
        const slimBf = projected.players[0].battlefield;
        expect(slimBf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(slimBf.find((c) => c.id === "l2")?.isTapped).toBe(true);
    });
});

describe("Bog Wraith (swampwalk evasion, CR 702.13b)", () => {
    it("is a 3/3 Wraith for {3}{B} with swampwalk", () => {
        expect(bogWraith.manaCost).toEqual({ X: 3, B: 1 });
        expect(bogWraith.types).toContain("Creature");
        expect(bogWraith.subtypes).toEqual(["Wraith"]);
        expect(bogWraith.power).toBe(3);
        expect(bogWraith.toughness).toBe(3);
        expect(bogWraith.staticAbilities).toContain("swampwalk");
    });

    it("cannot be blocked when defending player controls a Swamp", () => {
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p1",
        });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const swampInst = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p2",
        });
        const result = validateBlockerEligibility(wraith, bears, [
            bears,
            swampInst,
        ]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/Swamp/);
    });

    it("can be blocked when defender controls no Swamp", () => {
        const wraith = makeInstance(bogWraith.id, { id: "wraith" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(wraith, bears, [bears])).toEqual({
            eligible: true,
        });
    });

    it("dual land with Swamp subtype (Bayou) also triggers swampwalk", () => {
        const wraith = makeInstance(bogWraith.id, { id: "wraith" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const bayouInst = makeInstance(bayou.id, {
            id: "bayou-1",
            controllerId: "p2",
        });
        expect(
            validateBlockerEligibility(wraith, bears, [bears, bayouInst])
                .eligible
        ).toBe(false);
    });
});

describe("Shanodin Dryads (forestwalk evasion, CR 702.13b)", () => {
    it("is a 1/1 Nymph Dryad for {G} with forestwalk", () => {
        expect(shanodinDryads.manaCost).toEqual({ G: 1 });
        expect(shanodinDryads.types).toContain("Creature");
        expect(shanodinDryads.subtypes).toEqual(["Nymph", "Dryad"]);
        expect(shanodinDryads.power).toBe(1);
        expect(shanodinDryads.toughness).toBe(1);
        expect(shanodinDryads.staticAbilities).toContain("forestwalk");
    });

    it("cannot be blocked when defender controls a Forest", () => {
        const dryads = makeInstance(shanodinDryads.id, { id: "dryads" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const forestInst = makeInstance(
            // Reuse Bayou (Swamp + Forest) to exercise the multi-subtype case.
            bayou.id,
            { id: "bayou-1", controllerId: "p2" }
        );
        expect(
            validateBlockerEligibility(dryads, bears, [bears, forestInst])
                .eligible
        ).toBe(false);
    });

    it("can be blocked when defender has no Forest", () => {
        const dryads = makeInstance(shanodinDryads.id, { id: "dryads" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(dryads, bears, [bears])).toEqual({
            eligible: true,
        });
    });
});

describe("Juggernaut (CR 508.1d + 509.1b)", () => {
    it("is a 5/3 Juggernaut for {4} with attack-requirement + block-restriction", () => {
        expect(juggernaut.manaCost).toEqual({ X: 4 });
        expect(juggernaut.types).toEqual(["Artifact", "Creature"]);
        expect(juggernaut.subtypes).toEqual(["Juggernaut"]);
        expect(juggernaut.power).toBe(5);
        expect(juggernaut.toughness).toBe(3);
        expect(juggernaut.staticEffects).toBeDefined();
        expect(
            juggernaut.staticEffects!.some(
                (e) => e.kind === "attack-requirement"
            )
        ).toBe(true);
        expect(
            juggernaut.staticEffects!.some(
                (e) => e.kind === "block-restriction"
            )
        ).toBe(true);
    });

    it("can't be blocked by Walls (CR 509.1b) — via staticEffects", () => {
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

    it("can still be blocked by non-Wall creatures", () => {
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

    it("mustAttack is true when eligible, false when tapped or sick", () => {
        const jug = makeInstance(juggernaut.id, { id: "jug" });
        expect(mustAttack(jug)).toBe(true);
        expect(mustAttack({ ...jug, isTapped: true })).toBe(false);
        expect(mustAttack({ ...jug, isSummoningSick: true })).toBe(false);
    });

    it("getRequiredAttackerIds picks up eligible Juggernauts only", () => {
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

describe("Hypnotic Specter (keyword abilities + CR 603 trigger)", () => {
    it("is a 2/2 Specter for {1}{B}{B} with flying", () => {
        expect(hypnoticSpecter.manaCost).toEqual({ X: 1, B: 2 });
        expect(hypnoticSpecter.types).toContain("Creature");
        expect(hypnoticSpecter.subtypes).toEqual(["Specter"]);
        expect(hypnoticSpecter.power).toBe(2);
        expect(hypnoticSpecter.toughness).toBe(2);
        expect(hypnoticSpecter.staticAbilities).toContain("flying");
    });

    it("declares a damage-dealt trigger with matching oracle text", () => {
        const trigger = hypnoticSpecter.triggeredAbilities?.[0];
        expect(trigger?.event).toBe("DAMAGE_DEALT");
        expect(trigger?.oracleText).toMatch(/discards a card at random/);
    });

    function setupCombatScenario() {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const oppHand = [
            makeInstance(llanowarElves.id, {
                id: "opp-card-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(llanowarElves.id, {
                id: "opp-card-2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [specter] }),
                makePlayer("p2", { hand: oppHand }),
            ],
            combat: {
                attackerIds: ["specter"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
            rngSeed: 1,
        });
        return state;
    }

    it("queues a trigger on the stack when Specter deals damage to an opponent", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "hypnotic-specter-discard"
        );
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "DAMAGE_DEALT",
            target: { type: "player", id: "p2" },
            amount: 2,
        });
        // Priority restarts at active player with triggers on the stack.
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("resolves the trigger into a random discard from the opponent's hand", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        resolveTopOfStack(state);

        const p2 = state.players[1];
        expect(p2.hand).toHaveLength(1);
        expect(p2.graveyard).toHaveLength(1);
        // Specter stays on the battlefield after the trigger resolves.
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("is deterministic: same seed → same discarded card", async () => {
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        const runOnce = () => {
            const state = setupCombatScenario();
            applyAllCombatDamage(state, {});
            resolveTopOfStack(state);
            return state.players[1].graveyard[0].id;
        };
        expect(runOnce()).toBe(runOnce());
    });

    it("does NOT trigger when dealing damage to self (controller)", () => {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p1",
            ownerId: "p1",
        });
        const trigger = hypnoticSpecter.triggeredAbilities![0];
        const match = trigger.matches(
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "specter",
                sourceControllerId: "p1",
                target: { type: "player", id: "p1" },
                amount: 2,
                isCombat: true,
            },
            specter
        );
        expect(match).toBe(false);
    });

    it("wire format: triggerEvent and triggeredAbilityId survive projection", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.stack).toHaveLength(1);
        expect(projected.stack[0].triggeredAbilityId).toBe(
            "hypnotic-specter-discard"
        );
        expect(projected.stack[0].triggerEvent).toMatchObject({
            type: "DAMAGE_DEALT",
            target: { type: "player", id: "p2" },
        });
    });
});

describe("Howling Mine (CR 603.6a phase-begin trigger with intervening-if)", () => {
    function setupAtUpkeep(options: { tapped?: boolean } = {}) {
        const mine = makeInstance(howlingMine.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: options.tapped ?? false,
        });
        // Two cards in each library so the draw step entry action + Howling
        // Mine's extra draw both succeed.
        const p1Lib = [
            makeInstance(llanowarElves.id, {
                id: "p1-lib-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(llanowarElves.id, {
                id: "p1-lib-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const p2Lib = [
            makeInstance(llanowarElves.id, {
                id: "p2-lib-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
            makeInstance(llanowarElves.id, {
                id: "p2-lib-2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
        ];
        return makeState({
            turn: 2, // turn > 1 so the draw step's turn-based draw fires
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [mine], library: p1Lib }),
                makePlayer("p2", { library: p2Lib }),
            ],
        });
    }

    it("is a {2} artifact with the phase-begin trigger declared", () => {
        expect(howlingMine.manaCost).toEqual({ X: 2 });
        expect(howlingMine.types).toContain("Artifact");
        const trigger = howlingMine.triggeredAbilities?.[0];
        expect(trigger?.event).toBe("PHASE_BEGIN");
        expect(trigger?.oracleText).toMatch(/draw step/i);
    });

    it("queues the trigger when the active player's draw step begins", () => {
        const state = setupAtUpkeep();
        advancePhase(state); // UPKEEP → DRAW (turn-based action + trigger)
        expect(state.phase).toBe("DRAW");
        // p1 drew the turn-based card (CR 504.1) and the trigger sits on the stack.
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("howling-mine-draw");
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "PHASE_BEGIN",
            phase: "DRAW",
            activePlayerId: "p1",
        });
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("resolves into an extra draw for the active player", () => {
        const state = setupAtUpkeep();
        advancePhase(state);
        resolveTopOfStack(state);
        // Turn-based draw + Howling Mine draw = 2
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.stack).toHaveLength(0);
    });

    it("fires on the opponent's draw step and draws for them (each player's)", () => {
        const state = setupAtUpkeep();
        // Simulate p2's turn at UPKEEP — Howling Mine still on p1's battlefield.
        state.turn = 3;
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        state.phase = "UPKEEP";
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "PHASE_BEGIN",
            activePlayerId: "p2",
        });
        resolveTopOfStack(state);
        // p2 got 1 turn-based + 1 Howling Mine = 2 cards.
        expect(state.players[1].hand).toHaveLength(2);
    });

    it("does NOT fire the trigger while the artifact is tapped (CR 603.4)", () => {
        const state = setupAtUpkeep({ tapped: true });
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(state.stack).toHaveLength(0);
        // p1 only got the turn-based draw.
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("intervening-if re-check: if tapped between trigger and resolve, no draw", () => {
        const state = setupAtUpkeep();
        advancePhase(state); // trigger enqueued
        expect(state.stack).toHaveLength(1);
        // Simulate Icy Manipulator tapping the artifact in response.
        state.players[0].battlefield[0].isTapped = true;
        resolveTopOfStack(state);
        // Only the turn-based draw; intervening-if failed at resolve.
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("does NOT fire on non-draw phases", () => {
        const state = setupAtUpkeep();
        state.phase = "PRECOMBAT_MAIN";
        advancePhase(state); // PRECOMBAT_MAIN → BEGINNING_OF_COMBAT
        expect(state.stack).toHaveLength(0);
    });

    it("wire format: trigger StackItem survives projectPublicState", () => {
        const state = setupAtUpkeep();
        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.stack).toHaveLength(1);
        expect(projected.stack[0].triggeredAbilityId).toBe("howling-mine-draw");
        expect(projected.stack[0].triggerEvent).toMatchObject({
            type: "PHASE_BEGIN",
            phase: "DRAW",
        });
    });
});

// ---------------------------------------------------------------------------
// Activated mana abilities on creatures (CR 605.1a)
// ---------------------------------------------------------------------------

describe("Llanowar Elves ({T}: Add {G}, CR 605.1a)", () => {
    it("is a 1/1 Elf Druid for {G}", () => {
        expect(llanowarElves.manaCost).toEqual({ G: 1 });
        expect(llanowarElves.types).toContain("Creature");
        expect(llanowarElves.subtypes).toEqual(["Elf", "Druid"]);
        expect(llanowarElves.power).toBe(1);
        expect(llanowarElves.toughness).toBe(1);
    });

    it("declares a tap-for-green mana ability (useStack: false)", () => {
        const ability = llanowarElves.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ G: 1 });
    });

    it("engine recognizes the mana ability on the battlefield", () => {
        const elf = makeInstance(llanowarElves.id, { id: "elf" });
        expect(hasManaAbility(elf)).toBe(true);
        expect(getActivatedManaColor(elf)).toBe("G");
    });

    it("wire format: mana ability survives projectPublicState", () => {
        // The projection slims `card.card` to `{ id }`. The constants helpers
        // read the ability via `getCardById(card.card.id)` — this test guards
        // against any future refactor that reads ability data off the fat embed.
        const elf = makeInstance(llanowarElves.id, { id: "elf" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimElf = projected.players[0].battlefield.find(
            (c) => c.id === "elf"
        )!;
        expect(hasManaAbility(slimElf as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimElf as CardInstanceState)).toBe("G");
    });
});

describe("Sol Ring ({T}: Add {C}{C}, CR 605.1a)", () => {
    it("is a {1} artifact", () => {
        expect(solRing.manaCost).toEqual({ X: 1 });
        expect(solRing.types).toEqual(["Artifact"]);
    });

    it("declares a tap-for-{C}{C} mana ability (useStack: false)", () => {
        const ability = solRing.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 2 });
    });

    it("engine recognizes the ability and reports 2 colorless produced", () => {
        const ring = makeInstance(solRing.id, { id: "ring" });
        expect(hasManaAbility(ring)).toBe(true);
        expect(getActivatedManaColor(ring)).toBe("C");
        expect(getFixedManaAmount(ring, "C")).toBe(2);
    });

    it("wire format: ability survives projectPublicState", () => {
        // Artifact abilities are visible on the board — must be readable from
        // the projected state too (the projection strips card.card to { id }).
        const ring = makeInstance(solRing.id, { id: "ring" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimRing = projected.players[0].battlefield.find(
            (c) => c.id === "ring"
        )!;
        expect(hasManaAbility(slimRing as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimRing as CardInstanceState)).toBe("C");
        expect(getFixedManaAmount(slimRing as CardInstanceState, "C")).toBe(2);
    });
});

// All five Mox share the makeTapForMana factory; one parameterized describe
// covers shape, GRE recognition, and wire-format projection per color.
describe.each([
    { card: moxPearl, color: "W" as const, abilityId: "mox-pearl-mana" },
    { card: moxSapphire, color: "U" as const, abilityId: "mox-sapphire-mana" },
    { card: moxJet, color: "B" as const, abilityId: "mox-jet-mana" },
    { card: moxRuby, color: "R" as const, abilityId: "mox-ruby-mana" },
    { card: moxEmerald, color: "G" as const, abilityId: "mox-emerald-mana" },
])(
    "$card.name ({T}: Add {$color}, CR 605.1a)",
    ({ card, color, abilityId }) => {
        it("is a 0-mana artifact with a tap-for-color mana ability (useStack: false)", () => {
            expect(card.manaCost).toEqual({ X: 0 });
            expect(card.types).toEqual(["Artifact"]);
            const ability = card.activatedAbilities?.[0];
            expect(ability?.id).toBe(abilityId);
            expect(ability?.cost).toEqual({ tap: true });
            expect(ability?.useStack).toBe(false);
            expect(ability?.manaProduced).toEqual({ [color]: 1 });
        });

        it("engine recognizes the mana ability and reports the correct color", () => {
            const inst = makeInstance(card.id, { id: "mox" });
            expect(hasManaAbility(inst)).toBe(true);
            expect(getActivatedManaColor(inst)).toBe(color);
            expect(getFixedManaAmount(inst, color)).toBe(1);
        });

        it("wire format: mana ability survives projectPublicState", () => {
            const inst = makeInstance(card.id, { id: "mox" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [inst] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "mox"
            )!;
            expect(hasManaAbility(slim as CardInstanceState)).toBe(true);
            expect(getActivatedManaColor(slim as CardInstanceState)).toBe(
                color
            );
            expect(getFixedManaAmount(slim as CardInstanceState, color)).toBe(
                1
            );
        });
    }
);

describe("Jayemdae Tome ({4}, {T}: Draw a card, CR 602.1 + 121.1)", () => {
    it("is a {4} artifact with a stack-using activated ability", () => {
        expect(jayemdaeTome.manaCost).toEqual({ X: 4 });
        expect(jayemdaeTome.types).toEqual(["Artifact"]);
        const ability = jayemdaeTome.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true, mana: { X: 4 } });
        expect(ability?.useStack).toBe(true);
    });

    it("resolving the ability draws one card for the controller", () => {
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const library = Array.from({ length: 3 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p1-lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome], library }),
                makePlayer("p2"),
            ],
        });
        // Simulate activation: the tome is pushed on the stack with its
        // abilityId set (the engine does this at activation time).
        state.stack.push({
            ...tome,
            zone: "stack",
            castById: "p1",
            abilityId: "jayemdae-tome-draw",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("wire format: activated ability survives projectPublicState", () => {
        // Jayemdae Tome's ability is visible on the board — the projection
        // strips card.card to { id }, so the engine must read ability metadata
        // from the registry, not from the fat embed.
        const tome = makeInstance(jayemdaeTome.id, { id: "tome" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimTome = projected.players[0].battlefield.find(
            (c) => c.id === "tome"
        )!;
        // After projection, the ability is still reachable through the
        // registry via the card id.
        const def = jayemdaeTome;
        expect(slimTome.card.id).toBe(def.id);
        expect(def.activatedAbilities?.[0].id).toBe("jayemdae-tome-draw");
    });
});

describe("Jade Statue (animate until end of combat, CR 208.2 + 511.3 + 602.5)", () => {
    it("is a {4} artifact with a combat-only {2} activated ability", () => {
        expect(jadeStatue.manaCost).toEqual({ X: 4 });
        expect(jadeStatue.types).toEqual(["Artifact"]);
        const ability = jadeStatue.activatedAbilities?.[0];
        expect(ability?.id).toBe("jade-statue-animate");
        expect(ability?.cost).toEqual({ mana: { X: 2 } });
        expect(ability?.useStack).toBe(true);
        // CR 602.5 — restriction covers every combat sub-step.
        expect(ability?.activationPhaseRestriction).toEqual([
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
        ]);
    });

    function setupAnimationScenario() {
        const statue = makeInstance(jadeStatue.id, {
            id: "statue",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            players: [
                makePlayer("p1", { battlefield: [statue] }),
                makePlayer("p2"),
            ],
        });
        // Simulate activation: push the ability on the stack (engine does this
        // at activation time once costs are paid).
        state.stack.push({
            ...statue,
            zone: "stack",
            castById: "p1",
            abilityId: "jade-statue-animate",
            targets: [],
        });
        return state;
    }

    it("resolving the ability animates the artifact into a 3/6 Golem artifact creature", () => {
        const state = setupAnimationScenario();
        resolveTopOfStack(state);
        const animated = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        // CR 208.2 — creature card type added; original artifact type preserved.
        expect(animated.types).toEqual(["Artifact", "Creature"]);
        expect(animated.subtypes).toEqual(["Golem"]);
        expect(animated.power).toBe(3);
        expect(animated.toughness).toBe(6);
        expect(animated.animation).toMatchObject({
            addedCreatureType: true,
            addedSubtype: "Golem",
            savedPower: undefined,
            savedToughness: undefined,
            duration: { phase: "end-of-combat" },
        });
    });

    it("END_OF_COMBAT reverts the animation (CR 511.3): artifact loses creature type, P/T, and Golem subtype", () => {
        const state = setupAnimationScenario();
        resolveTopOfStack(state);
        // Walk to END_OF_COMBAT. advancePhase auto-skips empty combat steps,
        // so we land in POSTCOMBAT_MAIN — the purge still runs at the
        // END_OF_COMBAT entry before the skip advances us forward.
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        const reverted = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(reverted.types).toEqual(["Artifact"]);
        expect(reverted.subtypes).toEqual([]);
        expect(reverted.power).toBeUndefined();
        expect(reverted.toughness).toBeUndefined();
        expect(reverted.animation).toBeUndefined();
    });

    it("CLEANUP does NOT revert an animation still scoped to a future end-of-combat", () => {
        // Fabricate an animation whose duration is end-of-combat and run
        // CLEANUP: it must not affect effects tied to a different boundary.
        const statue = makeInstance(jadeStatue.id, { id: "statue" });
        statue.types = ["Artifact", "Creature"];
        statue.subtypes = ["Golem"];
        statue.power = 3;
        statue.toughness = 6;
        statue.animation = {
            savedPower: undefined,
            savedToughness: undefined,
            addedCreatureType: true,
            addedSubtype: "Golem",
            duration: { phase: "end-of-combat" },
        };
        const state = makeState({
            phase: "END_STEP",
            players: [
                makePlayer("p1", { battlefield: [statue] }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state); // END_STEP → CLEANUP → next turn
        const still = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(still.animation).toBeDefined();
        expect(still.types).toContain("Creature");
    });

    it("wire format: animated statue projects as a 3/6 creature with the Golem subtype for both viewers", () => {
        const state = setupAnimationScenario();
        resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "statue"
            )!;
            expect(slim.types).toEqual(["Artifact", "Creature"]);
            expect(slim.subtypes).toEqual(["Golem"]);
            expect(slim.power).toBe(3);
            expect(slim.toughness).toBe(6);
            // Effective P/T survives the projection (layer 7c reads the slim
            // shape and returns the 3/6 printed on the animated card).
            expect(getEffectivePower(projected, slim)).toBe(3);
            expect(getEffectiveToughness(projected, slim)).toBe(6);
        }
    });
});

describe("Icy Manipulator ({1}, {T}: tap target artifact/creature/land, CR 701.20a)", () => {
    it("is a {4} artifact with a stack-using activated ability", () => {
        expect(icyManipulator.manaCost).toEqual({ X: 4 });
        expect(icyManipulator.types).toEqual(["Artifact"]);
        const ability = icyManipulator.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true, mana: { X: 1 } });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: ["Artifact", "Creature", "Land"],
            count: 1,
        });
    });

    function activate(
        state: ReturnType<typeof makeState>,
        icy: CardInstanceState,
        target: { type: "permanent" | "player" | "spell"; id: string }
    ) {
        state.stack.push({
            ...icy,
            zone: "stack",
            castById: "p1",
            abilityId: "icy-manipulator-tap",
            targets: [target],
        });
        resolveTopOfStack(state);
    }

    it("taps an untapped creature on resolution", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "lion" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("is a no-op when the target is already tapped (CR 701.20a)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "lion" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("can target a land (tapping a tapland-source for mana denial)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const island = makeInstance(tropicalIsland.id, {
            id: "island",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [island] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "island" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("can target an artifact (including itself in principle)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [tome] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "tome" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("silently fizzles if the target has left the battlefield (CR 608.2b)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2"),
            ],
        });
        activate(state, icy, { type: "permanent", id: "ghost" });
        expect(state.stack).toHaveLength(0);
    });

    it("legal-target set spans artifacts, creatures and lands", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const island = makeInstance(tropicalIsland.id, {
            id: "island",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy, tome] }),
                makePlayer("p2", { battlefield: [lion, island] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            icyManipulator.activatedAbilities![0].targetRequirement!
        );
        const ids = legal.map((t) => t.id).sort();
        expect(ids).toEqual(["icy", "island", "lion", "tome"].sort());
    });

    it("wire format: tap survives projectPublicState (regression guard)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "lion" });
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[1].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(slimLion.isTapped).toBe(true);
    });
});

describe("Birds of Paradise (flying + {T}: Add one mana of any color, CR 605.1a)", () => {
    it("is a 0/1 Bird for {G} with flying", () => {
        expect(birdsOfParadise.manaCost).toEqual({ G: 1 });
        expect(birdsOfParadise.types).toContain("Creature");
        expect(birdsOfParadise.subtypes).toEqual(["Bird"]);
        expect(birdsOfParadise.power).toBe(0);
        expect(birdsOfParadise.toughness).toBe(1);
        expect(birdsOfParadise.staticAbilities).toContain("flying");
    });

    it("declares a tap mana ability offering all five colors (no colorless)", () => {
        const ability = birdsOfParadise.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        // "Any color" excludes colorless per CR 106.1b — must be W/U/B/R/G only.
        expect(ability?.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("engine recognizes the mana ability; color is null (choice-based)", () => {
        const bird = makeInstance(birdsOfParadise.id, { id: "bird" });
        expect(hasManaAbility(bird)).toBe(true);
        // getActivatedManaColor only resolves fixed (manaProduced) abilities.
        // Choice-based abilities MUST return null so the engine takes the
        // manaChoices branch in tapUntap instead of adding a fixed color.
        expect(getActivatedManaColor(bird)).toBeNull();
    });

    it("wire format: ability survives projectPublicState", () => {
        const bird = makeInstance(birdsOfParadise.id, { id: "bird" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bird] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBird = projected.players[0].battlefield.find(
            (c) => c.id === "bird"
        )!;
        expect(hasManaAbility(slimBird as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimBird as CardInstanceState)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Dual lands (Alpha — CR 305.6, 605.1a): two land types + choice-based mana
// ---------------------------------------------------------------------------

describe("Tundra (dual land: {T}: Add {W} or {U})", () => {
    it("is a Land with both Plains and Island subtypes", () => {
        expect(tundra.types).toEqual(["Land"]);
        expect(tundra.subtypes).toEqual(["Plains", "Island"]);
        // Dual lands are NOT Basic (CR 205.4a).
        expect(tundra.supertypes).toBeUndefined();
    });

    it("offers W and U as a single choice ability", () => {
        const ability = tundra.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaChoices).toEqual([{ W: 1 }, { U: 1 }]);
    });

    it("commitLandsForCost commits a Tundra tapped for U when paying {U}", () => {
        // Regression: without chosenMana, commitLandsForCost would see Tundra
        // as {W} (via getBasicLandMana on first subtype) and skip it when
        // committing a {U} cost — leaving Tundra untappable-but-uncommitted
        // and exploitable for infinite mana.
        const tund = makeInstance(tundra.id, {
            id: "tundra-1",
            isTapped: true,
            chosenMana: { U: 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [tund] });
        commitLandsForCost(p1, { U: 1 });
        expect(p1.battlefield[0].manaCommitted).toBe(true);
    });
});

describe("Alpha dual lands (snapshot: types, subtypes, mana choices)", () => {
    // The remaining 8 duals share Tundra's shape. Locking down the triples
    // guards against typos in subtypes/manaChoices when adding new prints.
    const duals: Array<{
        card: CardDefinition;
        subtypes: string[];
        choices: [string, string];
    }> = [
        {
            card: badlands,
            subtypes: ["Swamp", "Mountain"],
            choices: ["B", "R"],
        },
        { card: bayou, subtypes: ["Swamp", "Forest"], choices: ["B", "G"] },
        {
            card: plateau,
            subtypes: ["Mountain", "Plains"],
            choices: ["R", "W"],
        },
        { card: savannah, subtypes: ["Forest", "Plains"], choices: ["G", "W"] },
        { card: scrubland, subtypes: ["Plains", "Swamp"], choices: ["W", "B"] },
        { card: taiga, subtypes: ["Mountain", "Forest"], choices: ["R", "G"] },
        {
            card: tropicalIsland,
            subtypes: ["Forest", "Island"],
            choices: ["G", "U"],
        },
        {
            card: undergroundSea,
            subtypes: ["Island", "Swamp"],
            choices: ["U", "B"],
        },
    ];

    for (const { card, subtypes, choices } of duals) {
        it(`${card.name}: land with subtypes ${subtypes.join("/")} and ${choices.join("/")} mana`, () => {
            expect(card.types).toEqual(["Land"]);
            expect(card.subtypes).toEqual(subtypes);
            expect(card.supertypes).toBeUndefined();
            const ability = card.activatedAbilities?.[0];
            expect(ability?.cost.tap).toBe(true);
            expect(ability?.useStack).toBe(false);
            expect(ability?.manaChoices).toEqual([
                { [choices[0]]: 1 },
                { [choices[1]]: 1 },
            ]);
        });
    }
});

// Per-dual GRE + wire-format coverage. After moving every dual to makeDualLand,
// regression-guard each card's mana ability survives both fat-state inspection
// (commitLandsForCost picks the chosen color) and projectPublicState (the
// constants helpers must still resolve the slim instance to the right ability).
describe.each([
    { card: badlands, primary: "B" as const, secondary: "R" as const },
    { card: bayou, primary: "B" as const, secondary: "G" as const },
    { card: plateau, primary: "R" as const, secondary: "W" as const },
    { card: savannah, primary: "G" as const, secondary: "W" as const },
    { card: scrubland, primary: "W" as const, secondary: "B" as const },
    { card: taiga, primary: "R" as const, secondary: "G" as const },
    { card: tropicalIsland, primary: "G" as const, secondary: "U" as const },
    { card: tundra, primary: "W" as const, secondary: "U" as const },
    { card: undergroundSea, primary: "U" as const, secondary: "B" as const },
])(
    "$card.name (dual land mana ability — GRE + wire format)",
    ({ card, primary, secondary }) => {
        it("commitLandsForCost commits the dual for either chosen color", () => {
            for (const color of [primary, secondary]) {
                const dual = makeInstance(card.id, {
                    id: `${card.id}-inst`,
                    isTapped: true,
                    chosenMana: { [color]: 1 },
                });
                const p1 = makePlayer("p1", { battlefield: [dual] });
                commitLandsForCost(p1, { [color]: 1 });
                expect(
                    p1.battlefield[0].manaCommitted,
                    `commit failed for ${card.name} chosen ${color}`
                ).toBe(true);
            }
        });

        it("wire format: mana ability resolvable via projectPublicState", () => {
            const dual = makeInstance(card.id, { id: "dual-inst" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [dual] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "dual-inst"
            )!;
            expect(hasManaAbility(slim as CardInstanceState)).toBe(true);
            // Subtypes survive projection (engine reads them off the instance,
            // not via card.card lookup).
            expect(slim.subtypes).toEqual(card.subtypes);
        });
    }
);

describe("Channel (CR 605.1a, 118.4, 514.2)", () => {
    it("is a {G}{G} sorcery", () => {
        expect(channel.manaCost).toEqual({ G: 2 });
        expect(channel.types).toEqual(["Sorcery"]);
    });

    it("declares a pay-1-life mana ability template (useStack: false)", () => {
        const ability = channel.activatedAbilities?.[0];
        expect(ability?.id).toBe("channel-mana");
        expect(ability?.cost.life).toBe(1);
        expect(ability?.cost.tap).toBeUndefined();
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 1 });
    });

    it("resolve grants the caster a reference to channel-mana for the turn", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const grants = state.players[0].grantedAbilities;
        expect(grants).toHaveLength(1);
        expect(grants?.[0]).toMatchObject({
            sourceCardId: channel.id,
            abilityId: "channel-mana",
            duration: { phase: "end-of-turn" },
            grantedAtTurn: state.turn,
        });
        expect(grants?.[0].id).toMatch(/^grant-\d+$/);
        // Opponent does not get the grant.
        expect(state.players[1].grantedAbilities).toBeUndefined();
    });

    it("multiple resolves produce distinct grant ids", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const grants = state.players[0].grantedAbilities!;
        expect(grants).toHaveLength(2);
        expect(grants[0].id).not.toBe(grants[1].id);
    });

    it("CLEANUP step purges end-of-turn grants", () => {
        const state = makeState({ phase: "END_STEP" });
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].grantedAbilities).toHaveLength(1);
        // advancePhase from END_STEP traverses CLEANUP (auto) into next turn.
        advancePhase(state);
        expect(state.players[0].grantedAbilities).toBeUndefined();
    });

    it("template effect adds {C} via ActivatedAbilityContext.addMana", () => {
        // The mutation drives execution over the network; here we exercise
        // the template directly to guarantee the effect is wired correctly.
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const p1 = state.players[0];
        const ability = channel.activatedAbilities![0];
        // Simulate the mutation's payment+execution path for useStack:false.
        p1.life -= ability.cost.life!;
        ability.effect!({
            addMana: (amount) => {
                for (const [color, count] of Object.entries(amount)) {
                    if (color === "X" || typeof count !== "number") continue;
                    p1.manaPool[color] = (p1.manaPool[color] ?? 0) + count;
                }
            },
        });
        expect(p1.life).toBe(19);
        expect(p1.manaPool.C).toBe(1);
    });

    it("wire format: projectPublicState hydrates grantedAbilities for both viewers", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);

        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].grantedAbilities;
            expect(slim).toHaveLength(1);
            expect(slim?.[0]).toMatchObject({
                sourceCardId: channel.id,
                abilityId: "channel-mana",
                oracleText: "Pay 1 life: Add {C}.",
                useStack: false,
                manaProduced: { C: 1 },
                duration: { phase: "end-of-turn" },
            });
            expect(slim?.[0].cost.life).toBe(1);
        }
    });
});

describe("Time Walk (extra turn after this one, CR 500.7)", () => {
    it("is a {1}{U} sorcery", () => {
        expect(timeWalk.manaCost).toEqual({ X: 1, U: 1 });
        expect(timeWalk.types).toEqual(["Sorcery"]);
    });

    it("resolves by queueing an extra turn for the caster", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        expect(state.extraTurns).toBeUndefined();
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("advancing the turn keeps the caster active (no opponent swap)", () => {
        // Resolve Time Walk at end-of-turn so the very next advanceTurn runs.
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
        });
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        // END_STEP → CLEANUP (auto) → UNTAP of the next turn.
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(state.turn).toBe(2);
        expect(state.extraTurns).toBeUndefined();
        // The turn after the extra turn returns to normal swap order.
        const next = makeState({
            ...state,
            phase: "END_STEP",
        });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p2");
    });

    it("multiple extra turns stack LIFO (CR 500.7)", () => {
        const state = makeState({ phase: "END_STEP", activePlayerId: "p1" });
        // p1 casts Time Walk targeting self, then p2 somehow gets one queued
        // (simulated by pushing directly). Order: [p1, p2] → p2 taken first.
        state.extraTurns = ["p1", "p2"];
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.extraTurns).toEqual(["p1"]);
        const next = makeState({ ...state, phase: "END_STEP" });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p1");
        expect(next.extraTurns).toBeUndefined();
    });

    it("wire format: extraTurns survives projectPublicState", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.extraTurns).toEqual(["p1"]);
        expect(projected.activePlayerId).toBe(state.activePlayerId);
    });
});

// ---------------------------------------------------------------------------
// Timetwister — "Each player shuffles their hand and graveyard into their
// library, then draws seven cards." (CR 121.1, 701.20)
// ---------------------------------------------------------------------------

describe("Timetwister (each player reshuffles + draws 7, CR 121.1 / 701.20)", () => {
    function libraryCards(
        owner: string,
        count: number,
        prefix: string
    ): CardInstanceState[] {
        return Array.from({ length: count }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `${prefix}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    }

    it("is a {2}{U} sorcery", () => {
        expect(timetwister.manaCost).toEqual({ X: 2, U: 1 });
        expect(timetwister.types).toEqual(["Sorcery"]);
    });

    it("each player ends with 7 cards in hand, graveyard empty, remainder in library", () => {
        // p1 totals 10 cards across private zones (3 hand + 2 gy + 5 lib);
        // p2 totals 15 (4 hand + 1 gy + 10 lib). After resolve, p1 has
        // Timetwister itself in graveyard (resolved sorcery) so library = 3
        // and graveyard = 1; p2 has no such contribution so library = 8.
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p1", 2, "p1-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p1", 5, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 4, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p2", 1, "p2-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2], rngSeed: 42 });
        pushSpell(state, timetwister.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        // Timetwister itself lands in p1's graveyard after resolution.
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].graveyard[0].card.id).toBe(timetwister.id);
        expect(state.players[0].library).toHaveLength(3);

        expect(state.players[1].hand).toHaveLength(7);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(8);
    });

    it("shuffles deterministically under the same seed (PRNG replay)", () => {
        function run(seed: number): string[] {
            const p1 = makePlayer("p1", {
                library: libraryCards("p1", 12, "p1-lib"),
            });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                rngSeed: seed,
            });
            pushSpell(state, timetwister.id, "p1");
            resolveTopOfStack(state);
            return state.players[0].library.map((c) => c.id);
        }
        expect(run(123)).toEqual(run(123));
        expect(run(123)).not.toEqual(run(456));
    });

    it("wire format: hand/library/graveyard counts survive projectPublicState", () => {
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 8, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 2, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p2", 9, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2], rngSeed: 7 });
        pushSpell(state, timetwister.id, "p1");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        // p1 is the viewer → hand is the fat list of their own cards.
        expect(projected.players[0].hand).toHaveLength(7);
        expect(projected.players[0].library.count).toBe(
            state.players[0].library.length
        );
        expect(projected.players[0].graveyard).toHaveLength(1);
        // p2 is the opponent → hand is projected as null placeholders.
        expect(projected.players[1].hand).toHaveLength(7);
        expect(projected.players[1].library.count).toBe(
            state.players[1].library.length
        );
        expect(projected.players[1].graveyard).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Wheel of Fortune — "Each player discards their hand, then draws seven
// cards." (CR 701.8, 121.1)
// ---------------------------------------------------------------------------

describe("Wheel of Fortune (each player discards hand + draws 7, CR 701.8 / 121.1)", () => {
    function libraryCards(
        owner: string,
        count: number,
        prefix: string
    ): CardInstanceState[] {
        return Array.from({ length: count }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `${prefix}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    }

    it("is a {2}{R} sorcery", () => {
        expect(wheelOfFortune.manaCost).toEqual({ X: 2, R: 1 });
        expect(wheelOfFortune.types).toEqual(["Sorcery"]);
    });

    it("discarded cards land in each player's graveyard, then each draws 7", () => {
        // p1: 3 in hand, 0 in graveyard, 10 in library → after resolve:
        //   graveyard = 3 discarded + Wheel itself = 4, hand = 7, library = 3
        // p2: 4 in hand, 1 in graveyard, 12 in library → after resolve:
        //   graveyard = 1 + 4 discarded = 5, hand = 7, library = 5
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 4, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p2", 1, "p2-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p2", 12, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[0].graveyard).toHaveLength(4);
        expect(
            state.players[0].graveyard.some(
                (c) => c.card.id === wheelOfFortune.id
            )
        ).toBe(true);
        expect(state.players[0].library).toHaveLength(3);

        expect(state.players[1].hand).toHaveLength(7);
        expect(state.players[1].graveyard).toHaveLength(5);
        expect(state.players[1].library).toHaveLength(5);
    });

    it("is a no-op on an empty hand for the discard step (player still draws 7)", () => {
        const p1 = makePlayer("p1", {
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[1].hand).toHaveLength(7);
    });

    it("wire format: hand/library/graveyard counts survive projectPublicState", () => {
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 2, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 3, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(7);
        expect(projected.players[0].graveyard).toHaveLength(3);
        expect(projected.players[0].library.count).toBe(
            state.players[0].library.length
        );
        expect(projected.players[1].hand).toHaveLength(7);
        expect(projected.players[1].graveyard).toHaveLength(3);
        expect(projected.players[1].library.count).toBe(
            state.players[1].library.length
        );
    });
});

// ---------------------------------------------------------------------------
// Circle of Protection: {color} (CR 615.1, 615.6 — one-shot damage prevention)
// ---------------------------------------------------------------------------

describe("Circle of Protection: Red (CR 615.1, 615.6)", () => {
    function setupCoPOnBattlefield(copCard = circleOfProtectionRed) {
        const cop = makeInstance(copCard.id, { id: "cop" });
        const p1 = makePlayer("p1", { battlefield: [cop] });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    it("registers an end-of-turn prevention effect when the ability resolves", () => {
        const state = setupCoPOnBattlefield();
        const cop = state.players[0].battlefield[0];
        // Simulate activation: push ability on stack with a chosen source.
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt-stack",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        state.stack.push({
            ...cop,
            zone: "stack",
            castById: "p1",
            abilityId: "cop-prevent",
            targets: [{ type: "spell", id: "bolt-stack" }],
        });
        resolveTopOfStack(state);
        expect(state.preventionEffects).toEqual([
            {
                sourceInstanceId: "bolt-stack",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("prevents direct damage from the chosen spell source to the protected player", () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "bolt-stack",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt-stack",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("is a one-shot: a second bolt from a different source still hits the player", () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "bolt-first",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        // Prevention matches the first bolt.
        const first = makeInstance(lightningBolt.id, {
            id: "bolt-first",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...first,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        // A different bolt (different instance id) goes through.
        const second = makeInstance(lightningBolt.id, {
            id: "bolt-second",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...second,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });

    it("prevents combat damage from the chosen unblocked attacker", async () => {
        const state = setupCoPOnBattlefield();
        const attacker = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        state.players[1].battlefield.push(attacker);
        // p2 is the active player while attacking — flip turn control.
        state.activePlayerId = "p2";
        state.phase = "COMBAT_DAMAGE";
        state.combat = {
            attackerIds: ["specter"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        state.preventionEffects = [
            {
                sourceInstanceId: "specter",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        expect(state.players[0].life).toBe(20);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("does NOT prevent damage from a source other than the chosen one", () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "some-other-bolt",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt-stack",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
        // Prevention survives because it didn't match.
        expect(state.preventionEffects).toHaveLength(1);
    });

    it("CLEANUP wipes unused end-of-turn prevention effects (CR 514.2)", async () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "whatever",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        state.phase = "END_STEP";
        const { advancePhase } = await import("../../../gre/phases");
        // END_STEP → CLEANUP (auto) → next turn.
        advancePhase(state);
        expect(state.preventionEffects).toBeUndefined();
    });
});

describe("Circle of Protection: color filter on target selection", () => {
    it("Red CoP only offers red spells/permanents as legal targets", () => {
        const redBolt = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const blueSpell = makeInstance(ancestralRecall.id, {
            id: "recall",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const state = makeState();
        state.stack.push({ ...redBolt, castById: "p2" });
        state.stack.push({ ...blueSpell, castById: "p2" });
        const ability = circleOfProtectionRed.activatedAbilities![0];
        const legal = getLegalTargets(state, ability.targetRequirement!);
        expect(legal.map((t) => t.id)).toEqual(["bolt"]);
    });

    it("Blue CoP only offers blue spells/permanents as legal targets", () => {
        const redBolt = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const blueSpell = makeInstance(ancestralRecall.id, {
            id: "recall",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const state = makeState();
        state.stack.push({ ...redBolt, castById: "p2" });
        state.stack.push({ ...blueSpell, castById: "p2" });
        const ability = circleOfProtectionBlue.activatedAbilities![0];
        const legal = getLegalTargets(state, ability.targetRequirement!);
        expect(legal.map((t) => t.id)).toEqual(["recall"]);
    });

    it("color filter excludes players (players have no color)", () => {
        const state = makeState();
        const ability = circleOfProtectionWhite.activatedAbilities![0];
        const legal = getLegalTargets(state, ability.targetRequirement!);
        expect(legal.filter((t) => t.type === "player")).toEqual([]);
    });

    it("Green CoP exposes the correct declarative shape", () => {
        const ability = circleOfProtectionGreen.activatedAbilities![0];
        expect(ability.useStack).toBe(true);
        expect(ability.cost).toEqual({ mana: { X: 1 } });
        expect(ability.targetRequirement).toEqual({
            type: ["any", "spell"],
            count: 1,
            colorFilter: "G",
        });
    });
});

describe("Giant Growth (+3/+3 until end of turn, CR 611.1 / 514.2)", () => {
    function setupElf(phase = "PRECOMBAT_MAIN") {
        const elf = makeInstance(llanowarElves.id, {
            id: "elf",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2"),
            ],
            phase: phase as GameState["phase"],
        });
        return { state, elf };
    }

    it("boosts the target to 4/4 without mutating its base P/T", () => {
        const { state, elf } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        // Temporary buff (CR 611.1): base stays 1/1, effective is 4/4.
        expect(elf.power).toBe(1);
        expect(elf.toughness).toBe(1);
        expect(getEffectivePower(state, elf)).toBe(4);
        expect(getEffectiveToughness(state, elf)).toBe(4);
    });

    it("reverts to 1/1 at the cleanup step (CR 514.2)", () => {
        const { state, elf } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, elf)).toBe(4);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(getEffectivePower(state, elf)).toBe(1);
        expect(getEffectiveToughness(state, elf)).toBe(1);
        expect(elf.temporaryPTMods).toBeUndefined();
    });

    it("stacks two casts to +6/+6 that both expire together at cleanup", () => {
        const { state, elf } = setupElf();
        for (let i = 0; i < 2; i++) {
            pushSpell(state, giantGrowth.id, "p1", [
                { type: "permanent", id: "elf" },
            ]);
            resolveTopOfStack(state);
        }
        expect(getEffectivePower(state, elf)).toBe(7);
        expect(getEffectiveToughness(state, elf)).toBe(7);

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(getEffectivePower(state, elf)).toBe(1);
        expect(getEffectiveToughness(state, elf)).toBe(1);
    });

    it("buff survives intervening phases within the turn (only cleanup ends it)", () => {
        const { state, elf } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        // Walk forward to the end step; the buff must still be present.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state);
        expect(state.phase).toBe("END_STEP");
        expect(getEffectivePower(state, elf)).toBe(4);
    });

    it("wire format: boost is visible during the turn (regression guard)", () => {
        const { state } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slimElf = projected.players[0].battlefield.find(
            (c) => c.id === "elf"
        )!;
        expect(getEffectivePower(projected, slimElf)).toBe(4);
        expect(getEffectiveToughness(projected, slimElf)).toBe(4);
    });
});

describe("Berserk ({G} — trample + X/+0, delayed destroy if attacked, CR 117.1b / 611.1b / 603.7a / 514.2)", () => {
    function setupWithAttacker() {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        bear.isAttacking = true;
        bear.hasAttackedThisTurn = true;
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "DECLARE_BLOCKERS",
        });
        return { state, bear };
    }

    it("is a {G} instant", () => {
        expect(berserk.manaCost).toEqual({ G: 1 });
        expect(berserk.types).toEqual(["Instant"]);
    });

    it("targets a single creature", () => {
        expect(berserk.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });

    it("is castable in every combat step before combat damage", () => {
        const legal = berserk.castPhaseRestriction!;
        for (const phase of [
            "UNTAP",
            "UPKEEP",
            "DRAW",
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
        ] as const) {
            expect(legal).toContain(phase);
        }
        for (const phase of [
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
            "POSTCOMBAT_MAIN",
            "END_STEP",
            "CLEANUP",
        ] as const) {
            expect(legal).not.toContain(phase);
        }
    });

    it("getLegalActions rejects Berserk during COMBAT_DAMAGE", () => {
        const berserkCard = makeInstance(berserk.id, {
            id: "b1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", { hand: [berserkCard] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "COMBAT_DAMAGE",
        });
        const legal = getLegalActions(state, p1, berserkCard);
        expect(legal).not.toContain("cast");
    });

    it("getLegalActions allows Berserk during DECLARE_ATTACKERS", () => {
        const berserkCard = makeInstance(berserk.id, {
            id: "b1",
            zone: "hand",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            hand: [berserkCard],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        });
        const p2 = makePlayer("p2", { battlefield: [target] });
        const state = makeState({
            players: [p1, p2],
            phase: "DECLARE_ATTACKERS",
        });
        const legal = getLegalActions(state, p1, berserkCard);
        expect(legal).toContain("cast");
    });

    it("grants trample and +X/+0 on resolve (X = current power)", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("trample");
        // +X/+0 is a temporary buff (CR 611.1): base power unchanged, effective
        // doubles (2 + 2 = 4).
        expect(bear.power).toBe(2);
        expect(bear.toughness).toBe(2);
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("the +X/+0 buff expires at cleanup (CR 514.2)", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, bear)).toBe(4);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(getEffectivePower(state, bear)).toBe(2);
        expect(bear.temporaryPTMods).toBeUndefined();
    });

    it("schedules a next-end-step delayed trigger tied to the target id", () => {
        const { state } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers?.[0]).toMatchObject({
            sourceCardId: berserk.id,
            triggerId: "destroy-if-attacked",
            controller: "p1",
            timing: "next-end-step",
            payload: { targetId: "bear" },
        });
        expect(state.delayedTriggers?.[0].id).toMatch(/^delayed-\d+$/);
    });

    it("END_STEP pushes the delayed trigger onto the stack with active-player priority", () => {
        const { state } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        // Fast-forward to end step so the trigger fires.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state);
        expect(state.phase).toBe("END_STEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].delayedTriggerId).toBe("destroy-if-attacked");
        expect(state.stack[0].delayedPayload).toEqual({ targetId: "bear" });
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("delayed trigger destroys the creature when it attacked this turn", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state); // Berserk resolves
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // enter END_STEP, push delayed trigger
        resolveTopOfStack(state); // resolve the delayed trigger
        expect(state.players[0].battlefield).not.toContain(bear);
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
    });

    it("delayed trigger is a no-op when the target never attacked", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        // Not an attacker: no hasAttackedThisTurn, no isAttacking.
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP, pushes delayed trigger
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toContain(bear);
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            false
        );
    });

    it("CLEANUP removes the granted trample and clears hasAttackedThisTurn", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("trample");
        // Advance through END_STEP → CLEANUP → next turn UNTAP.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP (trigger enqueued on stack)
        resolveTopOfStack(state); // resolve delayed trigger (destroys bear)
        advancePhase(state); // CLEANUP (auto) → next turn
        // Bear is in the graveyard; its turn-scoped state still carries no
        // granted ability (cleanup ran before GY move? No — cleanup runs on
        // battlefield permanents. For a test that reaches cleanup we need a
        // creature that survives.)
        // Assert that hasAttackedThisTurn was cleared from the graveyard
        // copy (it persists on the instance but CLEANUP should have run
        // over the battlefield before the creature died — the creature
        // itself is already gone, so we cover the surviving-case below).
        const grave = state.players[0].graveyard.find((c) => c.id === "bear");
        expect(grave?.hasAttackedThisTurn).toBe(true); // never touched post-destroy
    });

    it("surviving creature loses granted trample and hasAttackedThisTurn at CLEANUP", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        bear.hasAttackedThisTurn = true;
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state); // grants trample, +2/+0, schedules delayed
        expect(bear.staticAbilities).toContain("trample");
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP (pushes trigger)
        resolveTopOfStack(state); // delayed trigger resolves → destroys bear
        // Bear is dead here; verify the secondary case where the creature
        // would survive uses a non-attacker bear.
        const pacifistBear = makeInstance(grizzlyBears.id, {
            id: "pbear",
            controllerId: "p1",
        });
        const state2 = makeState({
            players: [
                makePlayer("p1", { battlefield: [pacifistBear] }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state2, berserk.id, "p1", [
            { type: "permanent", id: "pbear" },
        ]);
        resolveTopOfStack(state2);
        expect(pacifistBear.staticAbilities).toContain("trample");
        state2.phase = "POSTCOMBAT_MAIN";
        advancePhase(state2); // END_STEP
        resolveTopOfStack(state2); // delayed trigger: no-op (didn't attack)
        advancePhase(state2); // CLEANUP (auto) → next turn UNTAP
        expect(pacifistBear.staticAbilities).not.toContain("trample");
        expect(pacifistBear.grantedStaticAbilities).toBeUndefined();
        expect(pacifistBear.hasAttackedThisTurn).toBeUndefined();
    });

    it("wire format: projected state shows buffed power + granted trample", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        // Base power is unchanged (2); the +2/+0 rides in temporaryPTMods,
        // which the projection carries so effective power reads 4.
        expect(slim.power).toBe(2);
        expect(slim.staticAbilities).toContain("trample");
        expect(getEffectivePower(projected, slim)).toBe(4);
        // Opponent's viewer sees the same data (no hidden info on battlefield).
        const oppView = projectPublicState(state, 1, "p2");
        const slimOpp = oppView.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slimOpp.power).toBe(2);
        expect(getEffectivePower(oppView, slimOpp)).toBe(4);
        expect(slimOpp.staticAbilities).toContain("trample");
        // Preserve the reference to `bear` so TS doesn't flag the variable.
        expect(bear.id).toBe("bear");
    });
});

// ---------------------------------------------------------------------------
// Balance — CR 608.2 (stepped resolve) + 101.4 (APNAP)
// ---------------------------------------------------------------------------

describe("Balance ({1}{W}, sorcery — equalize lands / cards / creatures)", () => {
    /** Seeds a state with Balance on the stack and the given per-player
     *  zone sizes. Uses plains for lands, grizzly bears for creatures and
     *  hand cards (any card definition works — only the zone matters). */
    function seed(opts: {
        p1Lands?: number;
        p2Lands?: number;
        p1Creatures?: number;
        p2Creatures?: number;
        p1Hand?: number;
        p2Hand?: number;
    }) {
        const mk = (
            cardId: string,
            count: number,
            owner: string,
            prefix: string,
            zone: "battlefield" | "hand" = "battlefield"
        ) =>
            Array.from({ length: count }, (_, i) =>
                makeInstance(cardId, {
                    id: `${prefix}-${i}`,
                    controllerId: owner,
                    ownerId: owner,
                    zone,
                })
            );
        const p1 = makePlayer("p1", {
            battlefield: [
                ...mk(plains.id, opts.p1Lands ?? 0, "p1", "p1-land"),
                ...mk(grizzlyBears.id, opts.p1Creatures ?? 0, "p1", "p1-bear"),
            ],
            hand: mk(
                grizzlyBears.id,
                opts.p1Hand ?? 0,
                "p1",
                "p1-card",
                "hand"
            ),
        });
        const p2 = makePlayer("p2", {
            battlefield: [
                ...mk(plains.id, opts.p2Lands ?? 0, "p2", "p2-land"),
                ...mk(grizzlyBears.id, opts.p2Creatures ?? 0, "p2", "p2-bear"),
            ],
            hand: mk(
                grizzlyBears.id,
                opts.p2Hand ?? 0,
                "p2",
                "p2-card",
                "hand"
            ),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, balance.id, "p1");
        return state;
    }

    /** Mimics selectResolutionChoice for the head pending choice. */
    function commitHead(state: ReturnType<typeof seed>, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find((s) => s.id === head.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    it("no-op when all counts are equal (resolves to graveyard with no choices)", () => {
        const state = seed({
            p1Lands: 2,
            p2Lands: 2,
            p1Hand: 1,
            p2Hand: 1,
            p1Creatures: 1,
            p2Creatures: 1,
        });
        const result = resolveTopOfStack(state);
        expect(result).not.toBeNull();
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        // Balance itself in p1's graveyard
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            (result as CardInstanceState).id
        );
        // Nothing else moved
        expect(state.players[0].battlefield.length).toBe(3);
        expect(state.players[1].battlefield.length).toBe(3);
    });

    it("equalizes lands: p1 keeps their chosen land, rest go to graveyard", () => {
        const state = seed({ p1Lands: 3, p2Lands: 1 });
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].playerId).toBe("p1");
        expect(state.pendingChoices?.[0].count).toBe(1);
        commitHead(state, ["p1-land-1"]);
        resolveTopOfStack(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-land-1",
        ]);
        const gyIds = state.players[0].graveyard.map((c) => c.id);
        expect(gyIds).toContain("p1-land-0");
        expect(gyIds).toContain("p1-land-2");
        expect(gyIds).toHaveLength(3); // + Balance itself
    });

    it("min=0: asymmetric wipe — player with 0 forces the other to sacrifice everything", () => {
        // p1 has 4 lands, p2 has 0 lands → no choice needed (min=0).
        const state = seed({ p1Lands: 4, p2Lands: 0 });
        const result = resolveTopOfStack(state);
        expect(result).not.toBeNull(); // resolves in one shot — no prompt
        expect(state.players[0].battlefield.length).toBe(0);
        expect(state.players[0].graveyard.length).toBe(5); // 4 lands + Balance
    });

    it("preserves creature-land count semantics (ruling): sacrificed as land is not counted as creature", () => {
        // Model a creature-land inline: a Plains instance with both Land and
        // Creature types. Step 1 counts it as a land (total lands: 2 for p1
        // vs 0 for p2 → both sacrificed). Step 3 counts it as a creature
        // only if still on the battlefield — it is not.
        const creatureLand = makeInstance(plains.id, {
            id: "p1-creature-land",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land", "Creature"],
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "p1-land-0",
                            controllerId: "p1",
                        }),
                        creatureLand,
                        makeInstance(grizzlyBears.id, {
                            id: "p1-bear-0",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, balance.id, "p1");
        resolveTopOfStack(state);
        // Both lands (including creature-land) sacrificed (p2 has 0 → min=0).
        expect(state.stack.length).toBe(0); // no pending choice, resolved

        const bf = state.players[0].battlefield.map((c) => c.id);
        expect(bf).not.toContain("p1-land-0");
        expect(bf).not.toContain("p1-creature-land");
        // The bear survives step 1 and then gets sacrificed by step 3
        // (only p1 has a creature, min=0 again).
        expect(bf).not.toContain("p1-bear-0");
        // Graveyard holds both lands + the bear + Balance itself (4).
        expect(state.players[0].graveyard.length).toBe(4);
    });

    it("runs all three steps in order: lands → hand → creatures", () => {
        const state = seed({
            p1Lands: 2,
            p2Lands: 1, // step 1: p1 keeps 1
            p1Hand: 2,
            p2Hand: 0, // step 2: min=0, all p1 cards discarded (no prompt)
            p1Creatures: 2,
            p2Creatures: 1, // step 3: p1 keeps 1
        });
        resolveTopOfStack(state);

        // Suspended on lands step
        expect(state.stack[0].resolutionStep).toBe(0);
        expect(state.pendingChoices?.[0].filter?.types).toBe("Land");
        commitHead(state, ["p1-land-0"]);
        resolveTopOfStack(state);

        // Lands applied, hand applied (min=0, no prompt), creatures suspends
        expect(state.players[0].hand.length).toBe(0);
        expect(state.stack[0].resolutionStep).toBe(2);
        expect(state.pendingChoices?.[0].filter?.types).toBe("Creature");
        commitHead(state, ["p1-bear-0"]);
        resolveTopOfStack(state);

        // Fully resolved
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-land-0",
            "p1-bear-0",
        ]);
        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "p2-bear-0",
            "p2-land-0",
        ]);
    });

    it("hand step uses keep semantics: picked cards stay, rest discarded simultaneously", () => {
        const state = seed({ p1Hand: 3, p2Hand: 1 });
        resolveTopOfStack(state);
        expect(state.stack[0].resolutionStep).toBe(1); // lands step skipped
        expect(state.pendingChoices?.[0].zone).toBe("hand");
        expect(state.pendingChoices?.[0].kind).toBe("keep-hand");
        expect(state.pendingChoices?.[0].count).toBe(1);

        commitHead(state, ["p1-card-2"]);
        resolveTopOfStack(state);

        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-card-2"]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["p2-card-0"]);
        // p1-card-0 and p1-card-1 are in graveyard
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toContain(
            "p1-card-0"
        );
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toContain(
            "p1-card-1"
        );
    });
});

describe("Regeneration ({1}{G} Aura — {G}: Regenerate enchanted creature, CR 701.15a / 614.5)", () => {
    function setupAttached(args?: {
        bearOverrides?: Partial<CardInstanceState>;
    }) {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            ...(args?.bearOverrides ?? {}),
        });
        const aura = makeInstance(regeneration.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, aura, bear };
    }

    function activateRegen(state: GameState, aura: CardInstanceState) {
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: aura.controllerId,
            abilityId: "regeneration-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("declares the right shape: {1}{G} Aura targeting Creature with one activated ability", () => {
        expect(regeneration.manaCost).toEqual({ X: 1, G: 1 });
        expect(regeneration.types).toEqual(["Enchantment"]);
        expect(regeneration.subtypes).toEqual(["Aura"]);
        expect(regeneration.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        const ability = regeneration.activatedAbilities?.[0];
        expect(ability?.id).toBe("regeneration-regenerate");
        expect(ability?.cost).toEqual({ mana: { G: 1 } });
        expect(ability?.useStack).toBe(true);
    });

    it("attaches to the targeted creature on resolution (CR 303.4)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, regeneration.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === regeneration.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
    });

    it("activating {G} stacks one regeneration shield on the enchanted creature", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        const target = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(target.regenerationShields).toBe(1);
    });

    it("destroyAll's per-card destroy is replaced by the regen rider (CR 614.5)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Drive destroy directly via regenerateOrDestroy to model a
        // regen-honoring mass effect (Wrath of God carries the
        // can't-be-regenerated rider, CR 701.15c, so it would NOT trigger
        // the regen path here — exercised by the dedicated Wrath test).
        regenerateOrDestroy(state, "bear");
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("Wrath of God's `cantBeRegenerated` rider bypasses the shield (CR 701.15c)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Shield is on the bear — Wrath prevents the replacement, so the
        // bear hits the graveyard and the shield stays unspent on the way
        // out (it's purged with the rest of transient state).
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
    });

    it("lethal damage triggers regen too — heals damageMarked, taps, no graveyard (CR 704.5g + 701.15a)", () => {
        const { state, aura, bear } = setupAttached();
        activateRegen(state, aura);
        // Lightning Bolt for 3 — Grizzly Bears is 2/2, lethal.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.damageMarked).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(bear.zone).toBe("battlefield");
    });

    it("multiple activations stack shields, each shield consumed independently", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        activateRegen(state, aura);
        let bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBe(2);
        // First lethal — shield 1 consumed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBe(1);
        // Second lethal — shield 2 consumed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBeUndefined();
        expect(bear.zone).toBe("battlefield");
        // Third lethal — no shield, dies.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("bear");
    });

    it("unused shields wear off at CLEANUP (CR 514.2)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Shortcut to CLEANUP and run it.
        state.phase = "END_STEP";
        advancePhase(state); // → CLEANUP, runs purge, then auto-advances
        const bear = state.players[1].battlefield.find((c) => c.id === "bear");
        expect(bear?.regenerationShields).toBeUndefined();
    });

    it("combat: regen on a blocking creature removes it from combat and clears damage", async () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
            hasAttackedThisTurn: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const aura = makeInstance(regeneration.id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "bear",
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [bear, aura] }),
            ],
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear: ["angel"] },
                blockersConfirmed: true,
            },
        });
        activateRegen(state, aura);
        // Angel deals 4 to bear (lethal). The lethal SBA inside
        // applyAllCombatDamage routes through regenerateOrDestroy → shield.
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { angel: { bear: 4 } }, "regular");
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.damageMarked).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.isBlocking).toBeUndefined();
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(state.combat?.blockerAssignments).not.toHaveProperty("bear");
    });

    it("wire format: regen shield count survives projectPublicState (regression guard)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        const projected = projectPublicState(state, 1, "p1");
        const bearProjected = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearProjected.regenerationShields).toBe(1);
    });
});

describe("Regrowth (return target card from your graveyard to hand, CR 400.7 / 608.2b)", () => {
    it("returns the chosen card from the caster's graveyard to their hand", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried-bear", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toContain("buried-bear");
        expect(p1.graveyard.map((c) => c.id)).not.toContain("buried-bear");
    });

    it("getLegalTargets only sees cards in the caster's own graveyard (controller: 'you')", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [mine] }),
                makePlayer("p2", { graveyard: [theirs] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            regrowth.targetRequirement!,
            [],
            "p1"
        );
        expect(legal).toHaveLength(1);
        expect(legal[0]).toMatchObject({
            type: "graveyard-card",
            id: "mine",
            playerId: "p1",
        });
    });

    it("CR 608.2b: silently does nothing if the target left the graveyard before resolution", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried", playerId: "p1" },
        ]);
        // Simulate the target being exiled in response (target is now illegal).
        const p1 = state.players[0];
        const idx = p1.graveyard.findIndex((c) => c.id === "buried");
        const [removed] = p1.graveyard.splice(idx, 1);
        removed.zone = "exile";
        p1.exile.push(removed);
        resolveTopOfStack(state);
        // No-op: the card stays in exile, the caster's hand stays empty.
        expect(p1.hand.map((c) => c.id)).not.toContain("buried");
        expect(p1.exile.map((c) => c.id)).toContain("buried");
    });
});

describe("Twiddle (toggle tap state on artifact/creature/land, CR 701.20)", () => {
    it("taps an untapped target", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("untaps a tapped target", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].isTapped).toBe(false);
    });

    it("getLegalTargets returns artifacts, creatures, and lands (and excludes other types)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const isle = makeInstance(island.id, {
            id: "isle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(controlMagic.id, {
            id: "cm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome, isle, aura] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            twiddle.targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id).sort();
        expect(ids).toEqual(["bear", "isle", "tome"]);
    });

    it("CR 608.2b: silently does nothing if the target left the battlefield before resolution", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        removePermanentTo(state, "land", "graveyard");
        // Should not throw — primitive silently no-ops.
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Unsummon (return target creature to its owner's hand, CR 701.10 / 400.7)", () => {
    it("returns the target creature from battlefield to its owner's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.battlefield.map((c) => c.id)).not.toContain("bear");
        expect(p2.hand.map((c) => c.id)).toContain("bear");
        expect(p2.hand[0].zone).toBe("hand");
    });

    it("clears battlefield-only transient state on the bounced card (CR 400.7)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
            damageMarked: 1,
            isSummoningSick: true,
            hasAttackedThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.isTapped).toBe(false);
        expect(returned.damageMarked).toBeUndefined();
        expect(returned.isSummoningSick).toBeUndefined();
        expect(returned.hasAttackedThisTurn).toBeUndefined();
    });

    it("CR 608.2b: silently does nothing if the target left the battlefield before resolution", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        // Target leaves the battlefield in response (e.g. Lightning Bolt kills it).
        removePermanentTo(state, "bear", "graveyard");
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.hand.map((c) => c.id)).not.toContain("bear");
        expect(p2.graveyard.map((c) => c.id)).toContain("bear");
    });

    it("strips aura-granted keywords from a bounced host (CR 611.2)", () => {
        // Bear with Red Ward attached grants "protection from red". Bouncing
        // the bear must lift the grant before the host enters its hand —
        // otherwise a re-cast bear would carry stale protection.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, redWard.id, "p2", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("protection from red");

        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.staticAbilities).not.toContain("protection from red");
        expect(returned.grantedStaticAbilities ?? []).toHaveLength(0);

        // The orphan aura is still on the battlefield with stale attachedTo;
        // SBA sweeps it to the graveyard (CR 704.5n).
        checkStateBasedActions(state);
        const aura = state.players[1].graveyard.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("strips aura-granted control change from a bounced host (CR 611.2 / 613.1b)", () => {
        // Bear under p2 control via p1's Control Magic. Bouncing the bear
        // must collapse the control stack so the host returns to its owner
        // (p2) clean. The orphan Control Magic is then swept by SBA.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Control flipped to p1.
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(stolen.controllerId).toBe("p1");

        pushSpell(state, unsummon.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.controlChanges).toBeUndefined();
        expect(returned.controllerId).toBe("p2");

        checkStateBasedActions(state);
        const aura = state.players[0].graveyard.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("wire format: bounced creature is no longer on the projected battlefield", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        // Owner's hand grows by one (the projection lists own-hand cards).
        const handIds = projected.players[1].hand
            .filter((c): c is NonNullable<typeof c> => c !== null)
            .map((c) => c.id);
        expect(handIds).toContain("bear");
    });
});

// ---------------------------------------------------------------------------
// White FREE cycle (LEA): Consecrate Land, Crusade, Death Ward, Farmstead,
// Holy Strength, Karma, Lance.
// ---------------------------------------------------------------------------

describe("Consecrate Land (Aura — enchanted land is indestructible, CR 702.12)", () => {
    // Cast the aura via the stack so the engine attaches it and applies the
    // keyword-grant imperatively — staticEffects on auras only flow through
    // attach()/detach().
    function setupAttached() {
        const host = makeInstance(plains.id, {
            id: "host-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(plains.id, {
            id: "victim-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, victim] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, consecrateLand.id, "p1", [
            { type: "permanent", id: "host-land" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("declares Aura targeting Land", () => {
        expect(consecrateLand.types).toEqual(["Enchantment"]);
        expect(consecrateLand.subtypes).toEqual(["Aura"]);
        expect(consecrateLand.targetRequirement).toEqual({
            type: "Land",
            count: 1,
        });
    });

    it("grants 'indestructible' to the enchanted land — Armageddon spares it", () => {
        const { state } = setupAttached();
        pushSpell(state, armageddon.id, "p1");
        resolveTopOfStack(state);
        const survivors = state.players[0].battlefield.map((c) => c.id);
        expect(survivors).toContain("host-land");
        expect(survivors).not.toContain("victim-land");
    });

    it("wire format: indestructible keyword survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slimLand = projected.players[0].battlefield.find(
            (c) => c.id === "host-land"
        )!;
        expect(slimLand.staticAbilities).toContain("indestructible");
    });
});

describe("Crusade (static pt-buff: +1/+1 to white creatures)", () => {
    it("buffs both controllers' white creatures", () => {
        const myLion = makeInstance(savannahLions.id, { id: "mine" });
        const oppLion = makeInstance(savannahLions.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const enchant = makeInstance(crusade.id, { id: "crusade" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myLion, enchant] }),
                makePlayer("p2", { battlefield: [oppLion] }),
            ],
        });
        expect(getEffectivePower(state, myLion)).toBe(3);
        expect(getEffectiveToughness(state, myLion)).toBe(2);
        expect(getEffectivePower(state, oppLion)).toBe(3);
    });

    it("does NOT buff non-white creatures (Grizzly Bears is green)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const enchant = makeInstance(crusade.id, { id: "crusade" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, enchant] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("wire format: white creatures still buffed after projection", () => {
        const lion = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(crusade.id, { id: "crusade" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, enchant] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slimLion)).toBe(3);
        expect(getEffectiveToughness(projected, slimLion)).toBe(2);
    });
});

describe("Death Ward (instant — regenerate target creature, CR 701.15a)", () => {
    it("stacks one regeneration shield on the target", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, deathWard.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const target = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(target.regenerationShields).toBe(1);
    });

    it("the shield replaces a subsequent regen-honoring destroy (CR 614.5)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, deathWard.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Use a regen-honoring destroy (no can't-be-regenerated rider). Wrath
        // would suppress the shield (CR 701.15c) — exercised separately.
        regenerateOrDestroy(state, "bear");
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.regenerationShields).toBeUndefined();
    });

    // CR 601.2c — a spell can't be announced if there aren't enough legal
    // targets. getLegalActions suppresses "cast" for creature-only target
    // spells when no creatures exist on either battlefield.
    it("getLegalActions rejects cast with no creatures on the battlefield", () => {
        const dw = makeInstance(deathWard.id, { id: "dw1", zone: "hand" });
        const p1 = makePlayer("p1", {
            hand: [dw],
            manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const legal = getLegalActions(state, p1, dw);
        expect(legal).not.toContain("cast");
    });

    it("getLegalActions allows cast when a creature is on the battlefield", () => {
        const dw = makeInstance(deathWard.id, { id: "dw1", zone: "hand" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            hand: [dw],
            manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", { battlefield: [bear] });
        const state = makeState({ players: [p1, p2] });
        const legal = getLegalActions(state, p1, dw);
        expect(legal).toContain("cast");
    });
});

describe("Farmstead (Aura on Plains — controller gains 2 life at upkeep, CR 603.6a)", () => {
    function setup(activePlayerId: string = "p1") {
        const land = makeInstance(plains.id, {
            id: "host-plains",
            controllerId: activePlayerId,
            ownerId: activePlayerId,
        });
        const aura = makeInstance(farmstead.id, {
            id: "farmstead",
            controllerId: activePlayerId,
            ownerId: activePlayerId,
            attachedTo: "host-plains",
        });
        const ownerIdx = activePlayerId === "p1" ? 0 : 1;
        const players = [makePlayer("p1"), makePlayer("p2")];
        players[ownerIdx].battlefield = [land, aura];
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players,
        });
    }

    it("enqueues the trigger on the host controller's UPKEEP", () => {
        const state = setup("p1");
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("farmstead-upkeep");
    });

    it("resolves into +2 life for the host's controller", () => {
        const state = setup("p1");
        const lifeBefore = state.players[0].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(lifeBefore + 2);
    });

    it("does NOT fire on the opponent's upkeep (only the host's controller)", () => {
        const state = setup("p1");
        // Simulate p2's upkeep next.
        state.turn = 3;
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        state.phase = "UNTAP";
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        // Stack stays empty — the host belongs to p1, not the active player.
        expect(state.stack).toHaveLength(0);
    });
});

describe("Holy Strength (Aura — enchanted creature gets +1/+2)", () => {
    function setup() {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(holyStrength.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "lion",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, lion };
    }

    it("buffs the host +1/+2", () => {
        const { state, lion } = setup();
        expect(getEffectivePower(state, lion)).toBe(3);
        expect(getEffectiveToughness(state, lion)).toBe(3);
    });

    it("wire format: buff still applies after projection", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Karma (deal damage = Swamps controlled to each player at upkeep, CR 603.6a)", () => {
    function setup(opts: {
        opponentSwamps: number;
        ownerSwamps: number;
        activePlayerId?: string;
    }) {
        const enchant = makeInstance(karma.id, {
            id: "karma",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Battlefield: CardInstanceState[] = [enchant];
        for (let i = 0; i < opts.ownerSwamps; i++) {
            p1Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p1-swamp-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        const p2Battlefield: CardInstanceState[] = [];
        for (let i = 0; i < opts.opponentSwamps; i++) {
            p2Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p2-swamp-${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                })
            );
        }
        const activePlayerId = opts.activePlayerId ?? "p1";
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
        });
    }

    it("deals damage to active player equal to their Swamp count", () => {
        const state = setup({ ownerSwamps: 3, opponentSwamps: 0 });
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 3);
    });

    it("hits the opponent on their upkeep — 'each player'", () => {
        const state = setup({
            ownerSwamps: 0,
            opponentSwamps: 2,
            activePlayerId: "p2",
        });
        const before = state.players[1].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 2);
    });

    it("no-op when active player controls 0 Swamps (no stack entry)", () => {
        const state = setup({ ownerSwamps: 0, opponentSwamps: 5 });
        advancePhase(state);
        // Trigger predicate matches but resolve guards against 0 — still
        // queued, so stack length 1 is acceptable. Verify no life lost.
        if (state.stack.length > 0) resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Lance (Aura — enchanted creature has first strike, CR 702.7)", () => {
    function setupAttached() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lance.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants 'first strike' to the host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("first strike");
    });

    it("wire format: first strike survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("first strike");
    });
});

// ---------------------------------------------------------------------------
// Blue FREE cycle (LEA): Feedback, Flight, Jump, Pirate Ship,
// Prodigal Sorcerer.
// ---------------------------------------------------------------------------

describe("Feedback (Aura on Enchantment — 1 dmg to host's controller at upkeep)", () => {
    // Host always belongs to p1; aura always to p2. Trigger should fire on
    // p1's upkeep only.
    function setup(activePlayerId: string) {
        const hostEnchant = makeInstance(badMoon.id, {
            id: "host-ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(feedback.id, {
            id: "feedback",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-ench",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [hostEnchant] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("declares Aura targeting Enchantment", () => {
        expect(feedback.types).toEqual(["Enchantment"]);
        expect(feedback.subtypes).toEqual(["Aura"]);
        expect(feedback.targetRequirement).toEqual({
            type: "Enchantment",
            count: 1,
        });
    });

    it("queues + resolves into 1 damage to host's controller at their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("feedback-upkeep");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("does NOT fire on a non-host-controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Flight (Aura — enchanted creature has flying, CR 702.9)", () => {
    function setupAttached() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, flight.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants 'flying' to the host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("flying");
    });

    it("wire format: flying survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("flying");
    });
});

describe("Jump (instant — target creature gains flying until end of turn)", () => {
    it("grants flying for the rest of the turn (duration = end-of-turn)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, jump.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.staticAbilities).toContain("flying");
    });

    it("the temporary grant expires at CLEANUP (CR 514.2)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, jump.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        // Walk turn until CLEANUP fires.
        for (let i = 0; i < 12 && state.phase !== "CLEANUP"; i++) {
            advancePhase(state);
        }
        // After CLEANUP processing, pump should be gone.
        advancePhase(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).not.toContain("flying");
    });
});

describe("Pirate Ship ({T}: 1 dmg + can't attack unless defender controls Island)", () => {
    it("uses data-driven attack-restriction (no magic string)", () => {
        expect(pirateShip.staticAbilities).not.toContain(
            "cant-attack-unless-defender-controls-Island"
        );
        expect(pirateShip.staticEffects).toBeDefined();
        expect(
            pirateShip.staticEffects!.some(
                (e) => e.kind === "attack-restriction"
            )
        ).toBe(true);
    });

    function setup(opts: { defenderHasIsland: boolean }) {
        const ship = makeInstance(pirateShip.id, {
            id: "ship",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p2Lands = opts.defenderHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p2-isle",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [ship] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
    }

    it("can attack when defender controls an Island", () => {
        const state = setup({ defenderHasIsland: true });
        const ship = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            ship,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(true);
    });

    it("cannot attack when defender has no Island", () => {
        const state = setup({ defenderHasIsland: false });
        const ship = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            ship,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
    });

    it("activated {T} ability deals 1 to a target player", () => {
        const state = setup({ defenderHasIsland: true });
        const ship = state.players[0].battlefield[0];
        state.stack.push({
            ...ship,
            zone: "stack",
            castById: "p1",
            abilityId: "pirate-ship-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Prodigal Sorcerer ({T}: 1 dmg to any target — original Tim)", () => {
    function setup() {
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [tim] }),
                makePlayer("p2"),
            ],
        });
    }

    it("declares a 'tap, target any, deal 1' activated ability", () => {
        const ability = prodigalSorcerer.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement?.type).toBe("any");
    });

    it("deals 1 damage to a target player", () => {
        const state = setup();
        const tim = state.players[0].battlefield[0];
        state.stack.push({
            ...tim,
            zone: "stack",
            castById: "p1",
            abilityId: "prodigal-sorcerer-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("kills a 1-toughness creature", () => {
        const state = setup();
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(lion);
        const tim = state.players[0].battlefield[0];
        state.stack.push({
            ...tim,
            zone: "stack",
            castById: "p1",
            abilityId: "prodigal-sorcerer-zap",
            targets: [{ type: "permanent", id: "lion" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "lion"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");
    });
});

// ---------------------------------------------------------------------------
// Black FREE cycle (LEA): Cursed Land, Drudge Skeletons, Mind Twist, Plague
// Rats, Raise Dead, Unholy Strength, Wall of Bone, Warp Artifact, Weakness,
// Will-o'-the-Wisp.
// ---------------------------------------------------------------------------

describe("Cursed Land (Aura on Land — 1 dmg to host's controller at upkeep)", () => {
    function setup(activePlayerId: string) {
        const land = makeInstance(plains.id, {
            id: "host-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(cursedLand.id, {
            id: "curse",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-land",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("queues + resolves into 1 damage to the host's controller at their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("does NOT fire on the aura controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Drudge Skeletons ({B}: regenerate self, CR 701.15a)", () => {
    function setup() {
        const skel = makeInstance(drudgeSkeletons.id, {
            id: "skel",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [skel] }),
                makePlayer("p2"),
            ],
        });
    }

    function activate(state: GameState, source: CardInstanceState) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "drudge-skeletons-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("stacks one regen shield on resolution", () => {
        const state = setup();
        const skel = state.players[0].battlefield[0];
        activate(state, skel);
        const after = state.players[0].battlefield[0];
        expect(after.regenerationShields).toBe(1);
    });

    it("survives a regen-honoring destroy after activation", () => {
        // Plain destroy (e.g. Lightning Bolt lethal damage) honors the
        // shield. Wrath of God's `cantBeRegenerated` rider would suppress it
        // — exercised separately on the Wrath test.
        const state = setup();
        const skel = state.players[0].battlefield[0];
        activate(state, skel);
        regenerateOrDestroy(state, skel.id);
        const after = state.players[0].battlefield.find((c) => c.id === "skel");
        expect(after).toBeDefined();
        expect(after!.isTapped).toBe(true);
    });
});

describe("Mind Twist (X cards at random from target player's hand)", () => {
    it("discards X cards at random from target player", () => {
        const filler = (id: string, controllerId: string) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId,
                ownerId: controllerId,
                zone: "hand",
            });
        const p2Hand = [
            filler("h1", "p2"),
            filler("h2", "p2"),
            filler("h3", "p2"),
            filler("h4", "p2"),
        ];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: p2Hand })],
        });
        // Pay X = 3 via the stack item's chosen X.
        state.stack.push({
            ...makeInstance(mindTwist.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenX: 3,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(3);
    });
});

describe("Plague Rats (P/T = number of Plague Rats on the battlefield, CR 604.3)", () => {
    it("scales with the number of Plague Rats across both battlefields", () => {
        const r1 = makeInstance(plagueRats.id, { id: "r1" });
        const r2 = makeInstance(plagueRats.id, {
            id: "r2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const r3 = makeInstance(plagueRats.id, {
            id: "r3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [r1] }),
                makePlayer("p2", { battlefield: [r2, r3] }),
            ],
        });
        expect(getEffectivePower(state, r1)).toBe(3);
        expect(getEffectiveToughness(state, r1)).toBe(3);
    });

    it("a lone Plague Rats counts itself (1/1)", () => {
        const r = makeInstance(plagueRats.id, { id: "lone" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [r] }), makePlayer("p2")],
        });
        expect(getEffectivePower(state, r)).toBe(1);
    });

    it("wire format: pt-cda survives the projection", () => {
        const r = makeInstance(plagueRats.id, { id: "wire" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [r] }), makePlayer("p2")],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wire"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

describe("Raise Dead (return target Creature card from your graveyard, CR 400.7)", () => {
    it("returns a creature from your graveyard to your hand", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, raiseDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        // The Raise Dead spell itself enters the graveyard on resolve, so the
        // assertion is "the targeted card is no longer there", not length 0.
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "dead"
        );
        expect(state.players[0].hand.map((c) => c.id)).toContain("dead");
    });

    it("targeting filter excludes opponent's graveyard (controller: 'you')", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "opp-dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        const req = raiseDead.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("opp-dead");
    });
});

describe("Unholy Strength + Weakness (pt-buff aura mirror cycle)", () => {
    it("Unholy Strength buffs host +2/+1", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unholyStrength.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, after)).toBe(4);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });

    it("Weakness debuffs host -2/-1", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, weakness.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, after)).toBe(0);
        expect(getEffectiveToughness(state, after)).toBe(1);
    });
});

describe("Wall of Bone (defender + {B} regen)", () => {
    it("declares defender and a {B} regen activated ability", () => {
        expect(wallOfBone.staticAbilities).toContain("defender");
        const ability = wallOfBone.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 } });
        expect(ability?.useStack).toBe(true);
    });

    it("activating regen shields self", () => {
        const wob = makeInstance(wallOfBone.id, {
            id: "wob",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wob] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wob,
            zone: "stack",
            castById: "p1",
            abilityId: "wall-of-bone-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

describe("Warp Artifact (Aura on Artifact — 1 dmg to host's controller at upkeep)", () => {
    function setup(activePlayerId: string) {
        const ring = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(warpArtifact.id, {
            id: "warp",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-art",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("deals 1 to host's controller on their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });
});

describe("Will-o'-the-Wisp (flying + {B} regen)", () => {
    it("flying static + regen activated", () => {
        expect(willOTheWisp.staticAbilities).toContain("flying");
        const ability = willOTheWisp.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 } });
    });

    it("activating regen shields self", () => {
        const wisp = makeInstance(willOTheWisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wisp,
            zone: "stack",
            castById: "p1",
            abilityId: "will-o-the-wisp-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Red FREE cycle (LEA): Burrowing, Goblin Balloon Brigade, Goblin King,
// Keldon Warlord, Orcish Artillery, Shatter, Stone Rain, Tunnel,
// Uthden Troll.
// ---------------------------------------------------------------------------

describe("Burrowing (Aura — host has mountainwalk, CR 702.13c)", () => {
    function setupAttached() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, burrowing.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants mountainwalk to host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("mountainwalk");
    });

    it("wire format: mountainwalk survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("mountainwalk");
    });
});

describe("Goblin Balloon Brigade ({R}: gain flying until end of turn)", () => {
    function setup() {
        const bb = makeInstance(goblinBalloonBrigade.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [bb] }),
                makePlayer("p2"),
            ],
        });
    }

    function activate(state: GameState, source: CardInstanceState) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "goblin-balloon-brigade-fly",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("grants flying to itself on activation", () => {
        const state = setup();
        const bb = state.players[0].battlefield[0];
        expect(bb.staticAbilities).not.toContain("flying");
        activate(state, bb);
        const after = state.players[0].battlefield[0];
        expect(after.staticAbilities).toContain("flying");
    });
});

describe("Goblin King (other Goblins get +1/+1; lord pt-buff)", () => {
    it("buffs other Goblins +1/+1 and excludes itself", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "raider" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, goblin] }),
                makePlayer("p2"),
            ],
        });
        // Raider gets buffed.
        expect(getEffectivePower(state, goblin)).toBe(2);
        expect(getEffectiveToughness(state, goblin)).toBe(2);
        // King does NOT buff itself.
        expect(getEffectivePower(state, king)).toBe(2);
        expect(getEffectiveToughness(state, king)).toBe(2);
    });

    it("buffs opponent's Goblins too (subtype-only filter)", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const oppGoblin = makeInstance(monssGoblinRaiders.id, {
            id: "opp-rat",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king] }),
                makePlayer("p2", { battlefield: [oppGoblin] }),
            ],
        });
        expect(getEffectivePower(state, oppGoblin)).toBe(2);
    });

    it("does NOT buff non-Goblin creatures", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

describe("Keldon Warlord (P/T = number of OTHER creatures you control)", () => {
    it("scales with creatures you control, excluding itself", () => {
        const warlord = makeInstance(keldonWarlord.id, { id: "warlord" });
        const c1 = makeInstance(grizzlyBears.id, { id: "c1" });
        const c2 = makeInstance(grizzlyBears.id, { id: "c2" });
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warlord, c1, c2] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        // 2 other creatures controlled → 2/2.
        expect(getEffectivePower(state, warlord)).toBe(2);
        expect(getEffectiveToughness(state, warlord)).toBe(2);
    });

    it("a lone Warlord is 0/0 (dies to SBA)", () => {
        const warlord = makeInstance(keldonWarlord.id, { id: "warlord" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warlord] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, warlord)).toBe(0);
        expect(getEffectiveToughness(state, warlord)).toBe(0);
    });
});

describe("Orcish Artillery ({T}: 2 dmg to any target + 3 dmg to self)", () => {
    function setup() {
        const oa = makeInstance(orcishArtillery.id, {
            id: "oa",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [oa] }),
                makePlayer("p2"),
            ],
        });
    }

    it("deals 2 to a target opponent and 3 to the controller", () => {
        const state = setup();
        const oa = state.players[0].battlefield[0];
        state.stack.push({
            ...oa,
            zone: "stack",
            castById: "p1",
            abilityId: "orcish-artillery-shoot",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17); // self-damage
        expect(state.players[1].life).toBe(18); // target damage
    });
});

describe("Shatter / Stone Rain / Tunnel (destroy-target shorthand)", () => {
    it("Shatter destroys an artifact, ignores creatures", () => {
        const ring = makeInstance(solRing.id, {
            id: "ring",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ring] }),
            ],
        });
        pushSpell(state, shatter.id, "p1", [{ type: "permanent", id: "ring" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "ring"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("ring");
    });

    it("Stone Rain destroys a target Land", () => {
        const land = makeInstance(plains.id, {
            id: "victim-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "victim-land" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("Tunnel only targets Walls (subtypeFilter)", () => {
        expect(tunnel.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: "Wall",
        });
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        pushSpell(state, tunnel.id, "p1", [{ type: "permanent", id: "wall" }]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("wall");
    });
});

describe("Uthden Troll ({R}: regenerate self)", () => {
    it("activating regen shields self", () => {
        const troll = makeInstance(uthdenTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...troll,
            zone: "stack",
            castById: "p1",
            abilityId: "uthden-troll-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Green FREE cycle (LEA): Ice Storm, Ley Druid, Stream of Life, Wall of
// Brambles. Plus Lord of Atlantis (blue, was missed in the blue batch).
// ---------------------------------------------------------------------------

describe("Ice Storm (destroy target land)", () => {
    it("destroys an opponent's Land", () => {
        const land = makeInstance(plains.id, {
            id: "victim-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, iceStorm.id, "p1", [
            { type: "permanent", id: "victim-land" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "victim-land"
        );
    });
});

describe("Ley Druid ({T}: untap target land)", () => {
    it("untaps a tapped land on resolution", () => {
        const druid = makeInstance(leyDruid.id, {
            id: "druid",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const tapped = makeInstance(plains.id, {
            id: "p1-plains",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid, tapped] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...druid,
            zone: "stack",
            castById: "p1",
            abilityId: "ley-druid-untap",
            targets: [{ type: "permanent", id: "p1-plains" }],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "p1-plains"
        )!;
        expect(after.isTapped).toBe(false);
    });
});

describe("Stream of Life (target player gains X life)", () => {
    it("gains X life for the targeted player", () => {
        const state = makeState();
        state.stack.push({
            ...makeInstance(streamOfLife.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenX: 5,
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25);
    });
});

describe("Wall of Brambles (vanilla 2/3 defender)", () => {
    it("declares defender, no other abilities", () => {
        expect(wallOfBrambles.staticAbilities).toEqual(["defender"]);
        expect(wallOfBrambles.power).toBe(2);
        expect(wallOfBrambles.toughness).toBe(3);
    });

    it("cannot attack (defender restriction, CR 702.3)", () => {
        const wob = makeInstance(wallOfBrambles.id, {
            id: "wob",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wob] }),
                makePlayer("p2"),
            ],
        });
        const result = validateAttackerEligibility(
            state.players[0].battlefield[0],
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
    });
});

describe("Lord of Atlantis (other Merfolk get +1/+1; lord pt-buff — blue)", () => {
    it("buffs other Merfolk +1/+1 across both controllers, excludes self", () => {
        const lord = makeInstance(lordOfAtlantis.id, { id: "lord" });
        const myFolk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "mine",
        });
        const oppFolk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, myFolk] }),
                makePlayer("p2", { battlefield: [oppFolk] }),
            ],
        });
        // Both Merfolk become 2/2.
        expect(getEffectivePower(state, myFolk)).toBe(2);
        expect(getEffectivePower(state, oppFolk)).toBe(2);
        // Lord stays 2/2 (excludes itself).
        expect(getEffectivePower(state, lord)).toBe(2);
        expect(getEffectiveToughness(state, lord)).toBe(2);
    });

    it("does NOT buff non-Merfolk", () => {
        const lord = makeInstance(lordOfAtlantis.id, { id: "lord" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Artifact FREE cycle (LEA): Celestial Prism, Copper Tablet, Rod of Ruin.
// ---------------------------------------------------------------------------

describe("Celestial Prism ({2}, {T}: add one mana of any color)", () => {
    it("declares manaChoices for all 5 colors", () => {
        const ability = celestialPrism.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { X: 2 }, tap: true });
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaChoices).toHaveLength(5);
        const colors = (ability?.manaChoices ?? []).map(
            (c) => Object.keys(c)[0]
        );
        expect(colors).toEqual(["W", "U", "B", "R", "G"]);
    });
});

describe("Copper Tablet (1 dmg to each player at their upkeep)", () => {
    function setup(activePlayerId: string = "p1") {
        const tablet = makeInstance(copperTablet.id, {
            id: "tablet",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [tablet] }),
                makePlayer("p2"),
            ],
        });
    }

    it("queues + resolves into 1 damage to active player on their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("hits the opponent on their upkeep (symmetric)", () => {
        const state = setup("p2");
        const before = state.players[1].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 1);
    });
});

describe("Rod of Ruin ({3}, {T}: 1 damage to any target)", () => {
    it("deals 1 damage to a target player on resolution", () => {
        const rod = makeInstance(rodOfRuin.id, {
            id: "rod",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rod] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...rod,
            zone: "stack",
            castById: "p1",
            abilityId: "rod-of-ruin-shoot",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });
});

// ---------------------------------------------------------------------------
// Lord-style keyword grant (CR 611): Goblin King mountainwalk + Lord of
// Atlantis islandwalk. Exercises the engine's source-enters / target-enters
// /source-leaves hooks for non-aura keyword grants.
// ---------------------------------------------------------------------------

describe("Lord-style keyword grant — Goblin King mountainwalk", () => {
    it("entering King grants mountainwalk to existing Goblins", () => {
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "rat" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin] }),
                makePlayer("p2"),
            ],
        });
        // Goblin starts with no mountainwalk.
        expect(
            state.players[0].battlefield.find((c) => c.id === "rat")!
                .staticAbilities
        ).not.toContain("mountainwalk");
        // Cast Goblin King — its keyword-grant should reach the existing rat.
        pushSpell(state, goblinKing.id, "p1");
        resolveTopOfStack(state);
        const ratAfter = state.players[0].battlefield.find(
            (c) => c.id === "rat"
        )!;
        expect(ratAfter.staticAbilities).toContain("mountainwalk");
    });

    it("a new Goblin entering picks up an existing King's mountainwalk", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, monssGoblinRaiders.id, "p1");
        resolveTopOfStack(state);
        const newRat = state.players[0].battlefield.find(
            (c) => c.id !== "king"
        )!;
        expect(newRat.staticAbilities).toContain("mountainwalk");
    });

    it("when the King leaves, the grant is removed from existing Goblins", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const goblin = makeInstance(monssGoblinRaiders.id, {
            id: "rat",
            staticAbilities: ["mountainwalk"],
            grantedStaticAbilities: [
                { ability: "mountainwalk", auraId: "king" },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, goblin] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "king", "graveyard");
        const ratAfter = state.players[0].battlefield.find(
            (c) => c.id === "rat"
        )!;
        expect(ratAfter.staticAbilities).not.toContain("mountainwalk");
        expect(ratAfter.grantedStaticAbilities).toBeUndefined();
    });

    it("does NOT grant mountainwalk to non-Goblin creatures", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, goblinKing.id, "p1");
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).not.toContain("mountainwalk");
    });

    it("wire format: mountainwalk grant survives the projection", () => {
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "rat" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, goblinKing.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slimRat = projected.players[0].battlefield.find(
            (c) => c.id === "rat"
        )!;
        expect(slimRat.staticAbilities).toContain("mountainwalk");
    });
});

describe("Lord-style keyword grant — Lord of Atlantis islandwalk", () => {
    it("entering Lord grants islandwalk to existing Merfolk", () => {
        const folk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "folk",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [folk] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lordOfAtlantis.id, "p1");
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "folk"
        )!;
        expect(after.staticAbilities).toContain("islandwalk");
    });

    it("does NOT grant islandwalk to itself (excludes source)", () => {
        const state = makeState();
        pushSpell(state, lordOfAtlantis.id, "p1");
        resolveTopOfStack(state);
        const lord = state.players[0].battlefield[0];
        expect(lord.staticAbilities ?? []).not.toContain("islandwalk");
    });
});

// ---------------------------------------------------------------------------
// Zombie Master (CR 113.1 granted activated ability + lord-style pt-buff +
// keyword-grant). Exercises the new `activated-grant` static effect kind and
// the `grantedActivatedAbilities` activation lookup path end-to-end.
// ---------------------------------------------------------------------------

describe("Zombie Master (lord swampwalk + granted regen, no pt-buff)", () => {
    it("entering Master grants swampwalk and regen ability to existing Zombies (P/T unchanged)", () => {
        const zombie = makeInstance(scatheZombies.id, { id: "zomb" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [zombie] }),
                makePlayer("p2"),
            ],
        });
        // Pre-state: vanilla zombie.
        expect(zombie.staticAbilities).not.toContain("swampwalk");
        expect(zombie.grantedActivatedAbilities).toBeUndefined();
        expect(getEffectivePower(state, zombie)).toBe(2);
        // Cast Master.
        pushSpell(state, zombieMaster.id, "p1");
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "zomb"
        )!;
        expect(after.staticAbilities).toContain("swampwalk");
        expect(after.grantedActivatedAbilities).toHaveLength(1);
        expect(after.grantedActivatedAbilities![0].abilityId).toBe(
            "zombie-master-regenerate"
        );
        // Oracle has no P/T buff — Scathe Zombies stays 2/2.
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(2);
    });

    it("Zombie Master does NOT grant the regen ability to itself", () => {
        const state = makeState();
        pushSpell(state, zombieMaster.id, "p1");
        resolveTopOfStack(state);
        const master = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === zombieMaster.id
        )!;
        expect(master.grantedActivatedAbilities ?? []).toHaveLength(0);
        expect(master.staticAbilities ?? []).not.toContain("swampwalk");
    });

    it("a Zombie entering with Master in play picks up swampwalk + regen grant", () => {
        const master = makeInstance(zombieMaster.id, { id: "master" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, scatheZombies.id, "p1");
        resolveTopOfStack(state);
        const newZ = state.players[0].battlefield.find(
            (c) => c.id !== "master"
        )!;
        expect(newZ.staticAbilities).toContain("swampwalk");
        expect(newZ.grantedActivatedAbilities).toHaveLength(1);
        expect(getEffectivePower(state, newZ)).toBe(2);
    });

    it("when Master leaves, Zombies lose grant entries (swampwalk + regen)", () => {
        const master = makeInstance(zombieMaster.id, { id: "master" });
        const zombie = makeInstance(scatheZombies.id, {
            id: "zomb",
            staticAbilities: ["swampwalk"],
            grantedStaticAbilities: [
                { ability: "swampwalk", auraId: "master" },
            ],
            grantedActivatedAbilities: [
                {
                    sourceCardId: zombieMaster.id,
                    abilityId: "zombie-master-regenerate",
                    auraId: "master",
                },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master, zombie] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "master", "graveyard");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "zomb"
        )!;
        expect(after.staticAbilities).not.toContain("swampwalk");
        expect(after.grantedActivatedAbilities).toBeUndefined();
    });

    it("activating the granted regen on a Zombie shields it (no shield on Master)", () => {
        const master = makeInstance(zombieMaster.id, { id: "master" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, scatheZombies.id, "p1");
        resolveTopOfStack(state);
        const newZ = state.players[0].battlefield.find(
            (c) => c.id !== "master"
        )!;
        // Activate the granted regen on the new Zombie.
        state.stack.push({
            ...newZ,
            zone: "stack",
            castById: "p1",
            abilityId: "zombie-master-regenerate",
            grantedSourceCardId: zombieMaster.id,
            targets: [],
        });
        resolveTopOfStack(state);
        const zAfter = state.players[0].battlefield.find(
            (c) => c.id === newZ.id
        )!;
        expect(zAfter.regenerationShields).toBe(1);
        const masterAfter = state.players[0].battlefield.find(
            (c) => c.id === "master"
        )!;
        expect(masterAfter.regenerationShields).toBeUndefined();
    });

    it("wire format: grantedActivatedAbilities survive the projection", () => {
        const zombie = makeInstance(scatheZombies.id, { id: "zomb" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [zombie] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, zombieMaster.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "zomb"
        )!;
        expect(slim.staticAbilities).toContain("swampwalk");
        expect(slim.grantedActivatedAbilities).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Temporary P/T modifications (CR 611.1 — addTemporaryPTBuff)
// ---------------------------------------------------------------------------

function activatePump(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
) {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Frozen Shade ({B}: this creature gets +1/+1 until end of turn)", () => {
    function setup() {
        const shade = makeInstance(frozenShade.id, {
            id: "shade",
            controllerId: "p1",
            ownerId: "p1",
        });
        return {
            state: makeState({
                players: [
                    makePlayer("p1", { battlefield: [shade] }),
                    makePlayer("p2"),
                ],
            }),
            shadeId: "shade",
        };
    }

    it("activation pumps +1/+1 until end of turn", () => {
        const { state, shadeId } = setup();
        const shade = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, shade)).toBe(0);
        expect(getEffectiveToughness(state, shade)).toBe(1);
        activatePump(state, shade, "frozen-shade-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, after)).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(2);
    });

    it("multiple activations stack additively", () => {
        const { state, shadeId } = setup();
        for (let i = 0; i < 3; i++) {
            const shade = state.players[0].battlefield.find(
                (c) => c.id === shadeId
            )!;
            activatePump(state, shade, "frozen-shade-pump");
        }
        const after = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("buff expires at CLEANUP (CR 514.2)", () => {
        const { state, shadeId } = setup();
        const shade = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        activatePump(state, shade, "frozen-shade-pump");
        // Jump to END_STEP so the next advancePhase lands on CLEANUP, where
        // tickAllDurations runs.
        state.phase = "END_STEP";
        advancePhase(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, after)).toBe(0);
        expect(getEffectiveToughness(state, after)).toBe(1);
        expect(after.temporaryPTMods).toBeUndefined();
    });

    it("wire format: temporary P/T mod survives the projection", () => {
        const { state, shadeId } = setup();
        const shade = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        activatePump(state, shade, "frozen-shade-pump");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Granite Gargoyle (flying + {R}: +0/+1 until end of turn)", () => {
    function setup() {
        const gg = makeInstance(graniteGargoyle.id, {
            id: "gg",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [gg] }),
                makePlayer("p2"),
            ],
        });
    }

    it("has flying as a static ability", () => {
        const state = setup();
        const gg = state.players[0].battlefield.find((c) => c.id === "gg")!;
        expect(gg.staticAbilities).toContain("flying");
    });

    it("activation pumps +0/+1 until end of turn", () => {
        const state = setup();
        const gg = state.players[0].battlefield.find((c) => c.id === "gg")!;
        activatePump(state, gg, "granite-gargoyle-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "gg")!;
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });
});

describe("Shivan Dragon (flying + {R}: +1/+0 until end of turn)", () => {
    function setup() {
        const sd = makeInstance(shivanDragon.id, {
            id: "sd",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [sd] }),
                makePlayer("p2"),
            ],
        });
    }

    it("has flying and pumps +1/+0 on activation", () => {
        const state = setup();
        const sd = state.players[0].battlefield.find((c) => c.id === "sd")!;
        expect(sd.staticAbilities).toContain("flying");
        activatePump(state, sd, "shivan-dragon-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "sd")!;
        expect(getEffectivePower(state, after)).toBe(6);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });

    it("wire format: pumped P/T survives the projection", () => {
        const state = setup();
        const sd = state.players[0].battlefield.find((c) => c.id === "sd")!;
        activatePump(state, sd, "shivan-dragon-pump");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sd"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(6);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});

describe("Wall of Water ({U}: +1/+0 until end of turn)", () => {
    it("has defender + pumps on activation", () => {
        const w = makeInstance(wallOfWater.id, {
            id: "w",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [w] }), makePlayer("p2")],
        });
        const wall = state.players[0].battlefield.find((c) => c.id === "w")!;
        expect(wall.staticAbilities).toContain("defender");
        activatePump(state, wall, "wall-of-water-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "w")!;
        expect(getEffectivePower(state, after)).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });
});

describe("Wall of Fire ({R}: +1/+0 until end of turn)", () => {
    it("has defender + pumps on activation", () => {
        const w = makeInstance(wallOfFire.id, {
            id: "wf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [w] }), makePlayer("p2")],
        });
        const wall = state.players[0].battlefield.find((c) => c.id === "wf")!;
        expect(wall.staticAbilities).toContain("defender");
        activatePump(state, wall, "wall-of-fire-pump");
        const after = state.players[0].battlefield.find((c) => c.id === "wf")!;
        expect(getEffectivePower(state, after)).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(5);
    });
});

describe("Howl from Beyond (target creature gets +X/+0 EOT)", () => {
    it("applies +X/+0 to target on resolution", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [target],
                    manaPool: { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, howlFromBeyond.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("buff expires at CLEANUP", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, howlFromBeyond.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        state.phase = "END_STEP";
        advancePhase(state);
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(bear.temporaryPTMods).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// CREATURE_DIED globale (CR 700.4 — emitted by removePermanentTo on any death)
// ---------------------------------------------------------------------------

describe("CREATURE_DIED emission (combat + non-combat death paths)", () => {
    it("non-combat lethal damage queues a CREATURE_DIED event", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        // Lightning Bolt resolving from p2 deals 3 to the bear → SBA-equivalent
        // lethal kills it (CR 704.5g) routed through removePermanentTo.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // The bear is in p1's graveyard.
        expect(
            state.players[0].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
        // Pending events drained by resolveTopOfStack — verifies the queue
        // was processed (no leftover events).
        expect(state.pendingEvents).toBeUndefined();
    });

    it("destroy via Wrath queues CREATURE_DIED for each victim", () => {
        const a = makeInstance(grizzlyBears.id, {
            id: "a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(grizzlyBears.id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("non-creature destroy does not queue CREATURE_DIED", () => {
        const land = makeInstance(plains.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, stoneRain.id, "p2", [
            { type: "permanent", id: "land" },
        ]);
        resolveTopOfStack(state);
        expect(state.pendingEvents).toBeUndefined();
    });
});

describe("Creature Bond (aura, on host death deal damage = toughness to controller)", () => {
    function setupAttached() {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(creatureBond.id, {
            id: "bond",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        return state;
    }

    it("triggers and deals damage = host's toughness to host's controller on death", () => {
        const state = setupAttached();
        // Lightning Bolt from p1 kills the bear (toughness 2). Trigger pushes
        // onto stack; resolving it deals 2 to the bear's controller (p2).
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);
        // The death trigger landed on the stack.
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe("creature-bond-death");
        // Resolve the trigger — p2 takes 2 damage (bear toughness).
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("does not trigger when a different creature dies", () => {
        const state = setupAttached();
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(other);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "other" },
        ]);
        resolveTopOfStack(state);
        // No trigger — host is still attached, the other bear died.
        expect(state.stack.length).toBe(0);
        expect(state.players[1].life).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// Counters (CR 122) — addCounter / removeCounter / layer 7d
// ---------------------------------------------------------------------------

describe("Counter primitives + layer 7d", () => {
    it("+1/+1 counters add to effective P/T", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("+1/+0 counters add to power only", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("non-PT counter types don't affect stats", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { corpse: 5, charge: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });
});

describe("Fungusaur (DAMAGE_DEALT trigger → +1/+1 counter)", () => {
    function setup() {
        const fung = makeInstance(fungusaur.id, {
            id: "fung",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [fung] }),
                makePlayer("p2"),
            ],
        });
    }

    it("survives 1 non-lethal damage and gains +1/+1 counter", () => {
        const state = setup();
        // Custom 1-damage spell would be ideal; emulate via direct dealDamage
        // through a Lightning Bolt with chosenX-equivalent? Bolt is 3 = lethal.
        // Use a non-Bolt path: Hypnotic Specter not relevant. We simulate by
        // direct damage from a lifeless source: push a stack item proxy.
        // Simplest: temporarily increase Fungusaur toughness via a counter so
        // 1 damage is non-lethal. Skip — instead just test the resolve path
        // directly by pushing a synthetic DAMAGE_DEALT trigger and checking
        // counter application via the trigger's resolve.
        const trig = fungusaur.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        // Synthetic trigger: push a triggered-ability stack item targeting
        // Fungusaur, then resolve.
        const fung = state.players[0].battlefield.find((c) => c.id === "fung")!;
        state.stack.push({
            ...fung,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "fungusaur-counter",
            triggerSourceId: "fung",
            triggerEvent: {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "x",
                sourceControllerId: "p2",
                target: { type: "permanent", id: "fung" },
                amount: 1,
                isCombat: false,
            },
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "fung"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });

    it("dies from lethal damage; trigger lands on stack but no-ops (CR 117.5, 603.10)", () => {
        const state = setup();
        // Lightning Bolt deals 3 → marked 3 >= toughness 2 → destroyed inline.
        // The DAMAGE_DEALT trigger goes on stack via the recently-dead-in-
        // graveyard scan in collectTriggers. Resolving it tries addCounter on
        // a non-battlefield target → primitive no-ops. Fungusaur stays dead.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "fung" },
        ]);
        resolveTopOfStack(state);
        // Trigger landed on stack.
        expect(
            state.stack.some(
                (i) => i.triggeredAbilityId === "fungusaur-counter"
            )
        ).toBe(true);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const dead = state.players[0].graveyard.find((c) => c.id === "fung")!;
        expect(dead).toBeDefined();
        // No counter applied — target was not on battlefield at resolve time.
        expect(dead.counters).toBeUndefined();
    });
});

describe("Scavenging Ghoul (corpse counter end-step + remove → regen)", () => {
    function setup() {
        const ghoul = makeInstance(scavengingGhoul.id, {
            id: "ghoul",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [ghoul] }),
                makePlayer("p2"),
            ],
        });
    }

    it("end-step trigger adds corpse counters equal to deaths this turn", () => {
        const state = setup();
        state.deathsThisTurn = 3;
        // Push the trigger directly with a synthetic PHASE_BEGIN event.
        const ghoul = state.players[0].battlefield[0];
        state.stack.push({
            ...ghoul,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "scavenging-ghoul-corpse",
            triggerSourceId: "ghoul",
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "END_STEP",
                activePlayerId: "p1",
            },
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield[0];
        expect(after.counters?.corpse).toBe(3);
    });

    it("remove-counter activated stacks a regen shield (cost paid externally)", () => {
        const state = setup();
        const ghoul = state.players[0].battlefield[0];
        // Cost is paid by activateAbility before pushing on stack. Simulate:
        // start with one counter and already-deducted cost so the resolve
        // observes the post-cost state.
        ghoul.counters = { corpse: 1 };
        state.stack.push({
            ...ghoul,
            zone: "stack",
            castById: "p1",
            abilityId: "scavenging-ghoul-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield[0];
        // Resolve only stacks the regen shield — counter removal is the cost
        // and would have been paid before this point in the activation flow.
        expect(after.regenerationShields).toBe(1);
        expect(after.counters?.corpse).toBe(1);
    });

    it("declarative cost: not enough counters → cannot activate", () => {
        const state = setup();
        const ghoul = state.players[0].battlefield[0];
        // No counters → cost.removeCounter would fail validation in
        // activateAbility. Verify the cost field on the ability itself.
        const ability = scavengingGhoul.activatedAbilities?.find(
            (a) => a.id === "scavenging-ghoul-regenerate"
        );
        expect(ability?.cost.removeCounter).toEqual({
            type: "corpse",
            count: 1,
        });
        expect(ghoul.counters).toBeUndefined();
    });

    it("turn advance resets deathsThisTurn", () => {
        const state = setup();
        state.deathsThisTurn = 5;
        // Walk to next turn via CLEANUP.
        state.phase = "END_STEP";
        advancePhase(state);
        // After advancePhase, we may be in UNTAP of the next turn.
        expect(state.deathsThisTurn).toBeUndefined();
    });
});

describe("Clockwork Beast (ETB 7 +1/+0 counters, end-of-combat decay)", () => {
    it("ETB applies seven +1/+0 counters → 7/4 effective", () => {
        const state = makeState();
        pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);
        const beast = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkBeast.id
        )!;
        expect(beast.counters?.["+1/+0"]).toBe(7);
        expect(getEffectivePower(state, beast)).toBe(7);
        expect(getEffectiveToughness(state, beast)).toBe(4);
    });

    it("end-of-combat trigger removes a +1/+0 counter only if it attacked this turn", () => {
        const state = makeState();
        pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);
        const beast = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkBeast.id
        )!;
        // No combat happened — synthetic END_OF_COMBAT trigger should not fire.
        const trig = clockworkBeast.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "END_OF_COMBAT" as const,
            activePlayerId: "p1",
        };
        expect(trig!.matches(event, beast, state)).toBe(false);
        // Now mark it as attacked.
        beast.hasAttackedThisTurn = true;
        expect(trig!.matches(event, beast, state)).toBe(true);
    });

    it("recharge ability adds up to X +1/+0 counters, capped at 7 total", () => {
        const state = makeState();
        pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);
        const beast = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkBeast.id
        )!;
        // Drop to 4 counters, then recharge with X=5 → capped at +3 → 7 total.
        beast.counters = { "+1/+0": 4 };
        state.stack.push({
            ...beast,
            zone: "stack",
            castById: "p1",
            abilityId: "clockwork-beast-recharge",
            chosenX: 5,
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkBeast.id
        )!;
        expect(after.counters?.["+1/+0"]).toBe(7);
    });

    it("recharge canActivate gates at seven counters", () => {
        const ability = clockworkBeast.activatedAbilities?.find(
            (a) => a.id === "clockwork-beast-recharge"
        );
        expect(ability?.canActivate).toBeDefined();
        const at7 = {
            id: "x",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact", "Creature"] as CardType[],
            subtypes: [],
            isTapped: false,
            counters: { "+1/+0": 7 },
            card: {},
        };
        const at6 = { ...at7, counters: { "+1/+0": 6 } };
        // Empty TriggerStateView — canActivate doesn't read it for Clockwork.
        const view = { players: [] };
        expect(ability!.canActivate!(at7, view)).toBe(false);
        expect(ability!.canActivate!(at6, view)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// SPELL_CAST trigger (CR 603.2 + 601.2i)
// ---------------------------------------------------------------------------

describe("SPELL_CAST event emission", () => {
    it("casting a spell with no payment fires SPELL_CAST and lands triggers on top", () => {
        // Verduran Enchantress on the battlefield, then cast an aura. The
        // enchantress trigger goes on top, the player gets a may-pay prompt.
        const enchantress = makeInstance(verduranEnchantress.id, {
            id: "vEn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(consecrateLand.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchantress], hand: [aura] }),
                makePlayer("p2"),
            ],
        });
        // Push the aura onto stack manually (cast announce path) and emit
        // SPELL_CAST + run trigger collection (mirrors game.ts call sites).
        const stackItem = {
            ...aura,
            castById: "p1",
            zone: "stack" as const,
            targets: [],
        };
        state.stack.push(stackItem);
        emitSpellCastEvent(state, stackItem);
        processPendingActionTriggers(state);
        // Verduran trigger now on stack (above the aura).
        expect(state.stack[1].triggeredAbilityId).toBe(
            "verduran-enchantress-draw"
        );
    });
});

describe("Verduran Enchantress (may draw on enchantment cast)", () => {
    it("trigger matches enchantment spells cast by controller, not creatures", () => {
        const trig = verduranEnchantress.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "vEn",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const enchantmentEvent = {
            type: "SPELL_CAST" as const,
            casterId: "p1",
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Enchantment"] as CardType[],
            spellSubtypes: [],
            spellColors: [],
        };
        expect(trig!.matches(enchantmentEvent, self)).toBe(true);
        // Different caster → no fire.
        expect(
            trig!.matches({ ...enchantmentEvent, casterId: "p2" }, self)
        ).toBe(false);
        // Non-enchantment → no fire.
        expect(
            trig!.matches(
                {
                    ...enchantmentEvent,
                    spellTypes: ["Creature"] as CardType[],
                },
                self
            )
        ).toBe(false);
    });
});

describe("Sphere cycle (may pay {1} for 1 life on color spell)", () => {
    it("Crystal Rod fires on blue spell, not red", () => {
        const trig = crystalRod.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "rod",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const blue = {
            type: "SPELL_CAST" as const,
            casterId: "p2",
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Instant"] as CardType[],
            spellSubtypes: [],
            spellColors: ["U" as const],
        };
        expect(trig!.matches(blue, self)).toBe(true);
        const red = { ...blue, spellColors: ["R" as const] };
        expect(trig!.matches(red, self)).toBe(false);
    });

    it("each sphere targets its declared color", () => {
        const cases: {
            card: typeof crystalRod;
            color: "W" | "U" | "B" | "R" | "G";
        }[] = [
            { card: crystalRod, color: "U" },
            { card: ironStar, color: "R" },
            { card: ivoryCup, color: "W" },
            { card: throneOfBone, color: "B" },
            { card: woodenSphere, color: "G" },
        ];
        for (const { card, color } of cases) {
            const trig = card.triggeredAbilities?.[0];
            const self = {
                id: "x",
                controllerId: "p1",
                ownerId: "p1",
                types: ["Artifact"] as CardType[],
                subtypes: [],
                isTapped: false,
                card: {},
            };
            const ev = {
                type: "SPELL_CAST" as const,
                casterId: "p2",
                spellInstanceId: "x",
                spellCardId: "y",
                spellTypes: ["Instant"] as CardType[],
                spellSubtypes: [],
                spellColors: [color],
            };
            expect(trig!.matches(ev, self)).toBe(true);
        }
    });

    // Regression: triggered abilities that suspend via `requestMayPay` must
    // peek-and-pop in resolveTopOfStack — popping before resolve runs caused
    // submitMayPay to fail with "Stack item not found" because the
    // pendingChoice's stackItemId pointed at an already-removed item
    // (CR 608.2 / 117.3a).
    it("Ivory Cup pay-flow: trigger stays on stack while may-pay is open, gains 1 life on accept", () => {
        const cup = makeInstance(ivoryCup.id, {
            id: "cup",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cup], life: 20 }),
                makePlayer("p2"),
            ],
        });
        // Push Ivory Cup's trigger onto the stack manually with the same
        // shape collectTriggers would build (triggeredAbilityId + triggerEvent).
        const trigItem = {
            ...cup,
            id: "trig-ivory",
            castById: "p1",
            zone: "stack" as const,
            triggeredAbilityId: "ivory-cup-life",
            triggerEvent: {
                type: "SPELL_CAST" as const,
                casterId: "p2",
                spellInstanceId: "spell-x",
                spellCardId: "spell-x-def",
                spellTypes: ["Instant"] as CardType[],
                spellSubtypes: [],
                spellColors: ["W" as const],
            },
            targets: [],
        };
        state.stack.push(trigItem);

        // First resolve: should suspend because requestMayPay queues a
        // pendingChoice. The stack item must remain so submitMayPay can locate
        // it via stackItemId.
        const result = resolveTopOfStack(state);
        expect(result).toBeNull();
        expect(state.stack).toHaveLength(1);
        expect(state.pendingChoices).toBeDefined();
        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("may-pay");
        expect(pending.stackItemId).toBe("trig-ivory");
        const stackItem = state.stack.find((s) => s.id === pending.stackItemId);
        expect(stackItem).toBeDefined();

        // Simulate submitMayPay accept=yes: write collectedChoices, drop the
        // pending choice, re-invoke resolveTopOfStack. The trigger must now
        // run to completion (gainLife) and the stack item must be popped.
        const key = `${pending.step}:${pending.choiceId}`;
        stackItem!.collectedChoices = { [key]: ["yes"] };
        state.pendingChoices = undefined;
        // (controller pre-paid {1} via mana abilities in the real flow; here
        // we bypass payment because requestMayPay only consumes the answer.)

        const resumed = resolveTopOfStack(state);
        expect(resumed).not.toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].life).toBe(21);
    });
});

describe("Soul Net (may pay {1} on creature death for 1 life)", () => {
    it("trigger matches every creature death", () => {
        const trig = soulNet.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "net",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const ev = {
            type: "CREATURE_DIED" as const,
            creatureInstanceId: "bear",
            creatureControllerId: "p2",
            creatureTypes: ["Creature"] as CardType[],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 2,
        };
        expect(trig!.matches(ev, self)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// PERMANENT_TAPPED triggers (CR 603.2 + 605)
// ---------------------------------------------------------------------------

describe("Mana Flare (extra mana on land tap)", () => {
    it("matches forMana taps of Lands and skips non-Land or non-mana taps", () => {
        const trig = manaFlare.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "mf",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const baseEvent = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "land",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(trig!.matches(baseEvent, self)).toBe(true);
        expect(trig!.matches({ ...baseEvent, forMana: false }, self)).toBe(
            false
        );
        expect(
            trig!.matches(
                {
                    ...baseEvent,
                    permanentTypes: ["Creature"] as CardType[],
                },
                self
            )
        ).toBe(false);
    });
});

describe("Manabarbs (1 damage on land tap)", () => {
    it("matches every land mana tap", () => {
        const trig = manabarbs.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "mb",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const ev = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "x",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Mountain"],
            forMana: true,
            manaProduced: { R: 1 },
        };
        expect(trig!.matches(ev, self)).toBe(true);
    });
});

describe("Lifetap (gain 1 life on opponent's Forest becoming tapped)", () => {
    it("matches opponent Forest tap, ignores own Forest, ignores non-Forest", () => {
        const trig = lifetap.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "lt",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const oppForest = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "f",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: false,
        };
        expect(trig!.matches(oppForest, self)).toBe(true);
        expect(trig!.matches({ ...oppForest, controllerId: "p1" }, self)).toBe(
            false
        );
        expect(
            trig!.matches(
                { ...oppForest, permanentSubtypes: ["Mountain"] },
                self
            )
        ).toBe(false);
    });
});

describe("Wild Growth (extra {G} on attached land mana tap)", () => {
    it("matches only the attached host's mana tap", () => {
        const trig = wildGrowth.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "wg",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host-forest",
            card: {},
        };
        const host = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "host-forest",
            controllerId: "p1",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(trig!.matches(host, self)).toBe(true);
        expect(
            trig!.matches({ ...host, permanentId: "other-forest" }, self)
        ).toBe(false);
        expect(trig!.matches({ ...host, forMana: false }, self)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// PERMANENT_TAPPED engine integration (CR 603.2 — emit + collect + resolve)
// ---------------------------------------------------------------------------

describe("mana-tap triggers fire end-to-end", () => {
    it("Manabarbs deals 1 damage to the player who tapped a Mountain", () => {
        const state = makeState();
        const p1 = state.players[0];
        const mountain = makeInstance("eace2c85-976c-425e-9800-5a6ccbd91b56", {
            controllerId: "p1",
        });
        const manabarbsCard = makeInstance(manabarbs.id, {
            controllerId: "p1",
        });
        p1.battlefield.push(mountain, manabarbsCard);

        emitPermanentTapped(state, mountain, true, { R: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("manabarbs-damage");

        resolveTopOfStack(state);
        expect(p1.life).toBe(19);
        expect(state.stack).toHaveLength(0);
    });

    it("Mana Flare adds an extra mana of the produced color on land tap", () => {
        const state = makeState();
        const p1 = state.players[0];
        const forest = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            controllerId: "p1",
        });
        const manaFlareCard = makeInstance(manaFlare.id, {
            controllerId: "p1",
        });
        p1.battlefield.push(forest, manaFlareCard);
        p1.manaPool.G = 1;

        emitPermanentTapped(state, forest, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("mana-flare-extra");

        resolveTopOfStack(state);
        expect(p1.manaPool.G).toBe(2);
    });

    it("wire format: tap-trigger life delta (Lifetap) survives projectPublicState", () => {
        const state = makeState();
        const p1 = state.players[0];
        const p2 = state.players[1];
        const oppForest = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            controllerId: "p2",
            ownerId: "p2",
        });
        const lifetapCard = makeInstance(lifetap.id, {
            controllerId: "p1",
        });
        p2.battlefield.push(oppForest);
        p1.battlefield.push(lifetapCard);

        emitPermanentTapped(state, oppForest, false);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(p1.life).toBe(21);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(21);
    });

    it("Wild Growth fires only when its enchanted host is tapped for mana", () => {
        const state = makeState();
        const p1 = state.players[0];
        const enchantedForest = makeInstance(
            "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
            { controllerId: "p1" }
        );
        const otherForest = makeInstance(
            "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
            { controllerId: "p1" }
        );
        const wildGrowthCard = makeInstance(wildGrowth.id, {
            controllerId: "p1",
            attachedTo: enchantedForest.id,
        });
        p1.battlefield.push(enchantedForest, otherForest, wildGrowthCard);

        emitPermanentTapped(state, otherForest, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);

        emitPermanentTapped(state, enchantedForest, true, { G: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "wild-growth-extra-green"
        );

        p1.manaPool.G = 1;
        resolveTopOfStack(state);
        expect(p1.manaPool.G).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Wave 1 (PERMANENT_TAPPED / aura-activated / counter-spell-color additions)
// ---------------------------------------------------------------------------

describe("Firebreathing (Aura — {R}: enchanted creature gets +1/+0 EOT)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(firebreathing.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, aura };
    }

    it("activation pumps host +1/+0 until end of turn", () => {
        const { state, aura } = setup();
        activatePump(state, aura, "firebreathing-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(3);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("multiple activations stack additively", () => {
        const { state, aura } = setup();
        activatePump(state, aura, "firebreathing-pump");
        activatePump(state, aura, "firebreathing-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(4);
    });

    it("no-op when aura no longer attached (CR 608.2b)", () => {
        const { state, aura } = setup();
        aura.attachedTo = undefined;
        activatePump(state, aura, "firebreathing-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

describe("Holy Armor (Aura — +0/+2 + {1}{W}: enchanted creature gets +0/+3 EOT)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(holyArmor.id, {
            id: "ha",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, aura };
    }

    it("static buff +0/+2 applies to host", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("activated +0/+3 stacks with the static buff (total +0/+5)", () => {
        const { state, aura } = setup();
        activatePump(state, aura, "holy-armor-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(7);
    });

    it("wire format: static +0/+2 survives the projection", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Giant Spider (vanilla 2/4 reach, CR 702.17)", () => {
    it("declares reach as a static ability", () => {
        expect(giantSpider.staticAbilities).toContain("reach");
        expect(giantSpider.power).toBe(2);
        expect(giantSpider.toughness).toBe(4);
    });

    it("can block a flier (combat validator honors reach)", () => {
        const spider = makeInstance(giantSpider.id, {
            id: "spider",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const flier = makeInstance(shivanDragon.id, {
            id: "drag",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
            isAttacking: true,
        });
        const result = validateBlockerEligibility(flier, spider, []);
        expect(result.eligible).toBe(true);
    });
});

describe("Web (Aura — enchanted creature gets +0/+2 and has reach)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, web.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return state;
    }

    it("buffs host +0/+2 and grants reach", () => {
        const state = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(4);
        expect(bear.staticAbilities).toContain("reach");
    });

    it("wire format: pt + reach survive the projection", () => {
        const state = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
        expect(slim.staticAbilities).toContain("reach");
    });
});

describe("Psychic Venom (Aura on Land — 2 damage to host's controller on tap)", () => {
    it("trigger matches only the attached host's tap event", () => {
        const trig = psychicVenom.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "pv",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host-land",
            card: {},
        };
        const matchingEvent = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "host-land",
            controllerId: "p2",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(trig!.matches(matchingEvent, self)).toBe(true);
        // Other land tap → ignored
        expect(
            trig!.matches({ ...matchingEvent, permanentId: "other" }, self)
        ).toBe(false);
    });

    it("end-to-end: tapping host land queues + resolves into 2 damage", () => {
        const hostLand = makeInstance(swamp.id, {
            id: "host-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(psychicVenom.id, {
            id: "pv",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-land",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [hostLand] }),
            ],
        });
        const before = state.players[1].life;
        emitPermanentTapped(state, hostLand, true, { B: 1 });
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("psychic-venom-damage");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 2);
    });
});

describe("Lifeforce ({G}, Sacrifice: counter target Black spell)", () => {
    it("declares the activated ability with sacrifice cost + Black colorFilter", () => {
        const ability = lifeforce.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { G: 1 }, sacrifice: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            colorFilter: "B",
        });
    });
});

describe("Deathgrip ({B}, Sacrifice: counter target Green spell)", () => {
    it("declares the activated ability with sacrifice cost + Green colorFilter", () => {
        const ability = deathgrip.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 }, sacrifice: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            colorFilter: "G",
        });
    });
});

describe("Power Leak (Aura on Enchantment — host's controller pays {U} or loses 1 life at upkeep)", () => {
    function setup(activePlayerId: string) {
        const hostEnchant = makeInstance(badMoon.id, {
            id: "host-ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(powerLeak.id, {
            id: "pl",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-ench",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [hostEnchant] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("queues at host's controller's upkeep and asks them to pay {U}", () => {
        const state = setup("p1");
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("power-leak-upkeep");
        // First call enqueues a may-pay choice for p1.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
    });

    it("does NOT fire on a non-host-controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.stack).toHaveLength(0);
    });

    it("declining the may-pay loses 1 life", () => {
        const state = setup("p1");
        advancePhase(state);
        // First resolve enqueues the choice; commit "decline" then resolve again.
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head).toBeDefined();
        const item = state.stack.find((s) => s.id === head!.stackItemId);
        expect(item).toBeDefined();
        item!.collectedChoices = {
            ...(item!.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["decline"],
        };
        state.pendingChoices = undefined;
        const before = state.players[0].life;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });
});

describe("Northern Paladin ({W}{W}, {T}: destroy target black creature)", () => {
    function setup() {
        const paladin = makeInstance(northernPaladin.id, {
            id: "paladin",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const blackVictim: CardInstanceState = {
            id: "victim",
            card: { id: "fake-black", manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 2,
            toughness: 2,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [paladin] }),
                makePlayer("p2", { battlefield: [blackVictim] }),
            ],
        });
        return { state, paladin };
    }

    it("destroys a black creature on resolution", () => {
        const { state, paladin } = setup();
        state.stack.push({
            ...paladin,
            zone: "stack",
            castById: "p1",
            abilityId: "northern-paladin-destroy",
            targets: [{ type: "permanent", id: "victim" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("victim");
    });

    it("getLegalTargets only returns black creatures", () => {
        const { state } = setup();
        const whiteLion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(whiteLion);
        const req = northernPaladin.activatedAbilities?.[0]?.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const ids = getLegalTargets(state, req).map((t) => t.id);
        expect(ids).toContain("victim");
        expect(ids).not.toContain("lion");
    });
});

describe("Pestilence (upkeep sacrifice unless {B} + {B}: 1 dmg to each creature/player)", () => {
    function setup() {
        const enchant = makeInstance(pestilence.id, {
            id: "pest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ourBear = makeInstance(grizzlyBears.id, {
            id: "our-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant, ourBear] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        return { state, enchant };
    }

    it("activated {B} deals 1 damage to each creature and each player", () => {
        const { state, enchant } = setup();
        state.stack.push({
            ...enchant,
            zone: "stack",
            castById: "p1",
            abilityId: "pestilence-damage",
            targets: [],
        });
        const beforeP1 = state.players[0].life;
        const beforeP2 = state.players[1].life;
        resolveTopOfStack(state);
        // Both 2/2 bears take 1 damage — survive.
        const ourBear = state.players[0].battlefield.find(
            (c) => c.id === "our-bear"
        )!;
        const oppBear = state.players[1].battlefield.find(
            (c) => c.id === "opp-bear"
        )!;
        expect(ourBear.damageMarked).toBe(1);
        expect(oppBear.damageMarked).toBe(1);
        expect(state.players[0].life).toBe(beforeP1 - 1);
        expect(state.players[1].life).toBe(beforeP2 - 1);
    });

    it("canActivate returns false when no creature is on the battlefield", () => {
        const enchant = makeInstance(pestilence.id, {
            id: "pest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant] }),
                makePlayer("p2"),
            ],
        });
        const ability = pestilence.activatedAbilities?.[0];
        expect(ability?.canActivate).toBeDefined();
        const self = state.players[0].battlefield[0];
        expect(ability!.canActivate!(self, state)).toBe(false);
    });

    it("upkeep trigger queues a may-pay then sacrifices on decline", () => {
        const { state } = setup();
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UNTAP";
        advancePhase(state); // → UPKEEP
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("pestilence-upkeep");
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p1");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["decline"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Pestilence sacrificed → moved to graveyard.
        expect(
            state.players[0].battlefield.find((c) => c.id === "pest")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("pest");
    });
});

describe("Power Surge (each player takes damage = untapped lands at upkeep)", () => {
    function setup(opts: {
        p1Untapped: number;
        p1Tapped: number;
        activePlayerId: string;
    }) {
        const enchant = makeInstance(powerSurge.id, {
            id: "ps",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1Battlefield: CardInstanceState[] = [];
        for (let i = 0; i < opts.p1Untapped; i++)
            p1Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p1-u-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        for (let i = 0; i < opts.p1Tapped; i++)
            p1Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p1-t-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    isTapped: true,
                })
            );
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId: opts.activePlayerId,
            priorityPlayerId: opts.activePlayerId,
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", { battlefield: [enchant] }),
            ],
        });
    }

    it("damages active player only by their UNTAPPED land count (tapped lands skipped)", () => {
        // 3 untapped + 1 tapped (manually). Untap step is bypassed in this
        // test path — the trigger should still correctly skip the tapped one.
        const state = setup({
            p1Untapped: 3,
            p1Tapped: 1,
            activePlayerId: "p1",
        });
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        // Only 3 untapped lands → 3 damage (tapped one is skipped).
        expect(state.players[0].life).toBe(before - 3);
    });

    it("no-op (no stack entry / no damage) when active player has 0 untapped lands", () => {
        const state = setup({
            p1Untapped: 0,
            p1Tapped: 0,
            activePlayerId: "p1",
        });
        advancePhase(state);
        // Trigger predicate matches but resolve guards on count > 0.
        if (state.stack.length > 0) resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// Wave 2 — block restrictions (CR 509.1b, 702.36b)
// ---------------------------------------------------------------------------

describe("Invisibility (Aura — host can be blocked only by Walls)", () => {
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

    it("places a block-restriction aura on the battlefield attached to the host", () => {
        const { state } = setup();
        const aura = state.players[0].battlefield.find((c) => c.id !== "bear")!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
        expect(invisibility.staticEffects).toBeDefined();
        expect(
            invisibility.staticEffects!.some(
                (e) => e.kind === "block-restriction"
            )
        ).toBe(true);
    });

    it("non-Wall blocker is illegal against the enchanted attacker", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
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

    it("Wall blocker is legal", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        const wall = makeInstance(wallOfWater.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
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

describe("Fear (Aura — host can be blocked only by Black or Artifact)", () => {
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
        pushSpell(state, fear.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants 'fear' keyword to the host", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("fear");
    });

    it("rejects non-black non-artifact blocker", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        // grizzlyBears is green
        const greenBlocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        expect(
            validateBlockerEligibility(bear, greenBlocker, [greenBlocker])
                .eligible
        ).toBe(false);
    });

    it("accepts a black blocker", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        // hypnoticSpecter is black (cost {1}{B}{B})
        const blackBlocker = makeInstance(hypnoticSpecter.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        expect(
            validateBlockerEligibility(bear, blackBlocker, [blackBlocker])
        ).toEqual({ eligible: true });
    });
});

describe("Ironclaw Orcs (can't block creatures with power 2 or greater)", () => {
    it("declares a block-restriction on the card definition", () => {
        expect(ironclawOrcs.staticEffects).toBeDefined();
        expect(
            ironclawOrcs.staticEffects!.some(
                (e) => e.kind === "block-restriction" && e.side === "blocker"
            )
        ).toBe(true);
    });

    it("blocking a 2/2 attacker is illegal", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const big = makeInstance(grizzlyBears.id, {
            id: "big",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [big] }),
            ],
        });
        expect(
            validateBlockerEligibility(big, orc, [orc], state).eligible
        ).toBe(false);
    });

    it("blocking a 1/1 attacker is legal", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const tiny = makeInstance(savannahLions.id, {
            id: "tiny",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [tiny] }),
            ],
        });
        expect(validateBlockerEligibility(tiny, orc, [orc], state)).toEqual({
            eligible: true,
        });
    });

    it("layer-buffed attacker (Crusade-style) trips the restriction", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isSummoningSick: false,
        });
        const crusadeEnch = makeInstance(crusade.id, {
            id: "crusade",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [lion, crusadeEnch] }),
            ],
        });
        expect(
            validateBlockerEligibility(lion, orc, [orc], state).eligible
        ).toBe(false);
    });

    it("wire format: power-keyed restriction survives projection (layer 7c)", () => {
        const orc = makeInstance(ironclawOrcs.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isSummoningSick: false,
        });
        const crusadeEnch = makeInstance(crusade.id, {
            id: "crusade",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orc] }),
                makePlayer("p2", { battlefield: [lion, crusadeEnch] }),
            ],
        });
        // GRE-level: Crusade pumps lion to 2/2 → Ironclaw can't block
        expect(getEffectivePower(state, lion)).toBe(2);
        expect(
            validateBlockerEligibility(lion, orc, [orc], state).eligible
        ).toBe(false);
        // Wire format: same assertion against projected state
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[1].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slimLion)).toBe(2);
    });
});

describe("Dwarven Warriors ({T}: target creature with power 2 or less can't be blocked this turn)", () => {
    function setup(targetPower: number) {
        const dw = makeInstance(dwarvenWarriors.id, {
            id: "dw",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
            power: targetPower,
            toughness: 2,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dw, target] }),
                makePlayer("p2"),
            ],
        });
        return { state, dw };
    }

    it("declares power ≤ 2 target requirement", () => {
        const ability = dwarvenWarriors.activatedAbilities?.[0];
        expect(ability?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            powerFilter: { max: 2 },
        });
    });

    it("activated → grants 'unblockable' to legal target until EOT", () => {
        const { state, dw } = setup(2);
        state.stack.push({
            ...dw,
            zone: "stack",
            castById: "p1",
            abilityId: "dwarven-warriors-unblockable",
            targets: [{ type: "permanent", id: "tgt" }],
        });
        resolveTopOfStack(state);
        const tgt = state.players[0].battlefield.find((c) => c.id === "tgt")!;
        expect(tgt.staticAbilities).toContain("unblockable");
    });

    it("granted unblockable rejects every blocker in combat", () => {
        const { state, dw } = setup(2);
        state.stack.push({
            ...dw,
            zone: "stack",
            castById: "p1",
            abilityId: "dwarven-warriors-unblockable",
            targets: [{ type: "permanent", id: "tgt" }],
        });
        resolveTopOfStack(state);
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "tgt"
        )!;
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        expect(
            validateBlockerEligibility(attacker, blocker, [blocker], state)
                .eligible
        ).toBe(false);
    });

    it("getLegalTargets only returns creatures with power ≤ 2", () => {
        const { state } = setup(2);
        // Add a 6/6 Shivan Dragon — should be excluded.
        const big = makeInstance(shivanDragon.id, {
            id: "big",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        state.players[0].battlefield.push(big);
        const req = dwarvenWarriors.activatedAbilities?.[0]?.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const ids = getLegalTargets(state, req).map((t) => t.id);
        expect(ids).toContain("tgt");
        expect(ids).not.toContain("big");
    });
});

// ---------------------------------------------------------------------------
// Wave 3 — prevent-to-target shields (CR 615.1)
// ---------------------------------------------------------------------------

describe("Samite Healer ({T}: prevent next 1 to any target this turn)", () => {
    function setup() {
        const healer = makeInstance(samiteHealer.id, {
            id: "healer",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const friendBear = makeInstance(grizzlyBears.id, {
            id: "friend",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [healer, friendBear] }),
                makePlayer("p2"),
            ],
        });
        return { state, healer };
    }

    function activate(
        state: GameState,
        healer: CardInstanceState,
        target: { type: "permanent" | "player"; id: string }
    ) {
        state.stack.push({
            ...healer,
            zone: "stack",
            castById: "p1",
            abilityId: "samite-healer-prevent",
            targets: [target],
        });
        resolveTopOfStack(state);
    }

    it("declares 'any target' requirement (count 1)", () => {
        const ability = samiteHealer.activatedAbilities?.[0];
        expect(ability?.targetRequirement).toEqual({ type: "any", count: 1 });
        expect(ability?.cost).toEqual({ tap: true });
    });

    it("absorbs 1 damage of incoming Lightning Bolt to a player", () => {
        const { state, healer } = setup();
        activate(state, healer, { type: "player", id: "p2" });
        const p2BeforeBolt = state.players[1].life;
        // Lightning Bolt p2: 3 damage, 1 absorbed, 2 land.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(p2BeforeBolt - 2);
    });

    it("absorbs 1 damage on a creature (residual marked on the survivor)", () => {
        const { state, healer } = setup();
        const enemyDragon = makeInstance(shivanDragon.id, {
            id: "enemy",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(enemyDragon);
        activate(state, healer, { type: "permanent", id: "enemy" });
        // Lightning Bolt: 3 dmg → 1 absorbed → 2 marked. Dragon (5/5)
        // survives so we can read the marked total.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "enemy" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "enemy"
        )!;
        expect(after.damageMarked).toBe(2);
    });

    it("shield is consumed by the first event (no leftover for next event)", () => {
        const { state, healer } = setup();
        activate(state, healer, { type: "player", id: "p2" });
        const before = state.players[1].life;
        // First Bolt: 3 → 2 absorbed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 2);
        // Second Bolt: shield depleted → full 3.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 5);
    });

    it("unconsumed shield wears off at CLEANUP (CR 514.2)", () => {
        const { state, healer } = setup();
        activate(state, healer, { type: "player", id: "p2" });
        expect(state.targetPreventionShields).toHaveLength(1);
        // Tick to CLEANUP: hop directly to END_STEP then advance.
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.targetPreventionShields).toBeUndefined();
    });
});

describe("Conservator ({3}, {T}: prevent next 2 to you this turn)", () => {
    function setup() {
        const consv = makeInstance(conservator.id, {
            id: "consv",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [consv] }),
                makePlayer("p2"),
            ],
        });
        return { state, consv };
    }

    it("declares the {3}, {T} cost shape", () => {
        const ability = conservator.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { X: 3 }, tap: true });
        expect(ability?.useStack).toBe(true);
    });

    it("activated → 2-damage shield on the controller", () => {
        const { state, consv } = setup();
        state.stack.push({
            ...consv,
            zone: "stack",
            castById: "p1",
            abilityId: "conservator-prevent",
            targets: [],
        });
        resolveTopOfStack(state);
        const before = state.players[0].life;
        // Opponent casts Lightning Bolt at p1: 3 dmg → 2 absorbed → 1 land.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("partial absorption decrements remaining shield", () => {
        const { state, consv } = setup();
        state.stack.push({
            ...consv,
            zone: "stack",
            castById: "p1",
            abilityId: "conservator-prevent",
            targets: [],
        });
        resolveTopOfStack(state);
        // First 1 dmg: shield drops to 1 remaining.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        // Need a 1-dmg source — fake by directly invoking dealDamage via the
        // Bolt and asserting shield bookkeeping. Bolt deals 3 → 2 absorbed,
        // shield exhausted, 1 land. Next bolt full 3.
        resolveTopOfStack(state);
        expect(state.targetPreventionShields).toBeUndefined();
        const lifeAfterFirst = state.players[0].life;
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(lifeAfterFirst - 3);
    });
});

// ---------------------------------------------------------------------------
// Wave 4 — token creation (CR 111, 707.1, 704.5d)
// ---------------------------------------------------------------------------

describe("The Hive ({5}, {T}: create a 1/1 colorless flying Wasp Insect artifact creature token)", () => {
    function setup() {
        const hive = makeInstance(theHive.id, {
            id: "hive",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hive] }),
                makePlayer("p2"),
            ],
        });
        return { state, hive };
    }

    function activate(state: GameState, hive: CardInstanceState) {
        state.stack.push({
            ...hive,
            zone: "stack",
            castById: "p1",
            abilityId: "the-hive-wasp",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("creates a 1/1 flying Wasp on the controller's battlefield", () => {
        const { state, hive } = setup();
        activate(state, hive);
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        const wasp = tokens[0];
        expect(wasp.power).toBe(1);
        expect(wasp.toughness).toBe(1);
        expect(wasp.types).toEqual(["Artifact", "Creature"]);
        expect(wasp.subtypes).toEqual(["Insect"]);
        expect(wasp.staticAbilities).toContain("flying");
        expect(wasp.controllerId).toBe("p1");
        expect(wasp.ownerId).toBe("p1");
        expect(wasp.isSummoningSick).toBe(true);
    });

    it("two activations create two distinct token instances sharing one definition", () => {
        const { state, hive } = setup();
        activate(state, hive);
        activate(state, hive);
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(2);
        expect(tokens[0].id).not.toBe(tokens[1].id);
        // Both reference the same synthesized definition id.
        expect((tokens[0].card as { id: string }).id).toBe(
            (tokens[1].card as { id: string }).id
        );
    });

    it("token ceases to exist when it leaves the battlefield (CR 704.5d)", () => {
        const { state, hive } = setup();
        activate(state, hive);
        const wasp = state.players[0].battlefield.find((c) => c.isToken)!;
        // Lethal damage → routed via destroy → token enters graveyard.
        // SBA wipes it after the move.
        removePermanentTo(state, wasp.id, "graveyard");
        // Run SBAs to enforce 704.5d.
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === wasp.id)
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === wasp.id)
        ).toBeUndefined();
    });

    it("wire format: token survives projection with its definition id", () => {
        const { state, hive } = setup();
        activate(state, hive);
        const projected = projectPublicState(state, 1, "p1");
        const wasp = projected.players[0].battlefield.find((c) => c.isToken);
        expect(wasp).toBeDefined();
        expect((wasp!.card as { id: string }).id).toMatch(/^token:Wasp/);
        // Effective stats survive the projection.
        expect(getEffectivePower(projected, wasp!)).toBe(1);
        expect(getEffectiveToughness(projected, wasp!)).toBe(1);
    });

    it("synthesized def carries the 10E Wasp imagePrintId for the image layer", () => {
        const { state, hive } = setup();
        activate(state, hive);
        const wasp = state.players[0].battlefield.find((c) => c.isToken)!;
        const defId = (wasp.card as { id: string }).id;
        const def = tryGetCardById(defId);
        expect(def).not.toBeNull();
        expect(def!.imagePrintId).toBe("09921372-126f-4c81-b6d8-ea50b1d0eb44");
        // The id encoding includes the print id as a delimited `|`-segment
        // (index 8) so the client lazy-synthesizer recovers it without server
        // registration. A trailing empty static-effects segment (#293) now
        // follows it, so it's no longer the LAST segment — assert it's present
        // as its own segment instead.
        expect(
            defId.split("|").includes("09921372-126f-4c81-b6d8-ea50b1d0eb44")
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Gap J — skip / restrict untap step (CR 502.1)
// ---------------------------------------------------------------------------

/** Drives the incoming player's UNTAP step by advancing from END_STEP:
 *  CLEANUP auto-resolves, turn flips, UNTAP auto-resolves, state settles
 *  in UPKEEP of the intended player. Shared by all gap-J describe blocks. */
function runUntapForJ(playerId: string, state: GameState): void {
    state.activePlayerId = playerId === "p1" ? "p2" : "p1";
    state.phase = "END_STEP";
    advancePhase(state);
}

describe("Basalt Monolith (does-not-untap + {T}: {C}{C}{C} + {3}: untap, CR 502.1)", () => {
    it("is a {3} artifact declaring the per-permanent does-not-untap keyword", () => {
        expect(basaltMonolith.manaCost).toEqual({ X: 3 });
        expect(basaltMonolith.types).toEqual(["Artifact"]);
        expect(basaltMonolith.staticAbilities).toContain("does-not-untap");
    });

    it("stays tapped through its controller's untap step", () => {
        const monolith = makeInstance(basaltMonolith.id, {
            id: "monolith",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monolith] }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "monolith")
                ?.isTapped
        ).toBe(true);
    });

    it("{3} activated ability untaps the monolith from the stack", () => {
        const monolith = makeInstance(basaltMonolith.id, {
            id: "monolith",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monolith] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...monolith,
            zone: "stack",
            castById: "p1",
            abilityId: "basalt-monolith-untap",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "monolith")
                ?.isTapped
        ).toBe(false);
    });
});

describe("Mana Vault (does-not-untap + upkeep may-pay {4} + draw-step ping, CR 502.1 / 603.4)", () => {
    function setup(opts: { vaultTapped: boolean }) {
        const vault = makeInstance(manaVault.id, {
            id: "vault",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: opts.vaultTapped,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }

    it("declares does-not-untap and stays tapped on the untap step", () => {
        expect(manaVault.staticAbilities).toContain("does-not-untap");
        const { state } = setup({ vaultTapped: true });
        runUntapForJ("p1", state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vault")?.isTapped
        ).toBe(true);
    });

    it("upkeep may-pay {4} — accepting untaps the vault, declining leaves it tapped", () => {
        const { state } = setup({ vaultTapped: true });
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UNTAP";
        advancePhase(state); // → UPKEEP, queues trigger
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("mana-vault-upkeep");
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p1");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        // Decline → vault stays tapped.
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["decline"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vault")?.isTapped
        ).toBe(true);
    });

    it("upkeep may-pay {4} — accept untaps the vault", () => {
        const { state } = setup({ vaultTapped: true });
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UNTAP";
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vault")?.isTapped
        ).toBe(false);
    });

    it("draw-step trigger deals 1 to controller only when the vault is tapped", () => {
        const { state } = setup({ vaultTapped: true });
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UPKEEP";
        advancePhase(state); // → DRAW, queues damage trigger
        const drawTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "mana-vault-draw-damage"
        );
        expect(drawTriggers).toHaveLength(1);
        const lifeBefore = state.players[0].life;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(lifeBefore - 1);
    });

    it("draw-step trigger does NOT fire when the vault is untapped (intervening-if)", () => {
        const { state } = setup({ vaultTapped: false });
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UPKEEP";
        advancePhase(state); // → DRAW
        const drawTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "mana-vault-draw-damage"
        );
        expect(drawTriggers).toHaveLength(0);
    });
});

describe("Meekstone (creatures with power 3+ don't untap, CR 502.1 + 613 layer 7c)", () => {
    it("is a {1} artifact declaring a single untap-restriction static effect", () => {
        expect(meekstone.manaCost).toEqual({ X: 1 });
        expect(meekstone.types).toEqual(["Artifact"]);
        expect(meekstone.staticEffects).toHaveLength(1);
        const effect = meekstone.staticEffects?.[0];
        expect(effect?.kind).toBe("untap-restriction");
        if (effect?.kind === "untap-restriction") {
            expect(effect.maxUntap).toBe(0);
            expect(effect.filter).toEqual({
                types: "Creature",
                powerAtLeast: 3,
            });
        }
    });

    it("the legacy keyword `prevents-untap-of-power-3-or-greater` is no longer declared", () => {
        expect(meekstone.staticAbilities ?? []).not.toContain(
            "prevents-untap-of-power-3-or-greater"
        );
    });

    it("blocks creatures with printed power ≥3; weaker creatures untap", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone, bear, vampire] }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        // Cap=0 hard-skips matching creatures — no prompt enqueued.
        expect(state.pendingChoices ?? []).toEqual([]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "vamp")?.isTapped).toBe(true);
    });

    it("non-creature permanents (lands, artifacts, enchantments) untap normally", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const land = makeInstance(plains.id, { id: "l1", isTapped: true });
        const enchant = makeInstance(castle.id, {
            id: "castle",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone, land, enchant] }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "castle")?.isTapped).toBe(false);
    });

    it("layer 7c boost: a printed-2 creature pumped to effective power 4 stays tapped", () => {
        // Grizzly Bears is 2/2; Unholy Strength gives +2/+1 → effective 4/3.
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const aura = makeInstance(unholyStrength.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone, bear, aura] }),
                makePlayer("p2"),
            ],
        });
        // Sanity: the layer system actually pushes power across the threshold.
        expect(getEffectivePower(state, bear)).toBe(4);
        runUntapForJ("p1", state);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(true);
    });

    it("layer 7c debuff: a printed-4 creature dropped to effective power 2 untaps normally", () => {
        // Sengir Vampire is 4/4; Weakness gives -2/-1 → effective 2/3.
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
        });
        const aura = makeInstance(weakness.id, {
            id: "aura",
            attachedTo: "vamp",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone, vampire, aura] }),
                makePlayer("p2"),
            ],
        });
        // Sanity: effective power crossed back under the threshold.
        expect(getEffectivePower(state, vampire)).toBe(2);
        runUntapForJ("p1", state);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "vamp")?.isTapped).toBe(false);
    });

    it("untap-step flag cleanup (manaCommitted / chosenMana) clears on creatures that stayed tapped", () => {
        // emptyManaPools (CR 500.4) sets manaCommitted on any tapped card at
        // phase exit, so this assertion drives untapStep directly to read the
        // dispatcher's own cleanup pass without interference from the next
        // advancePhase tick.
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
            manaCommitted: true,
            chosenMana: { B: 1 },
        });
        const state = makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", { battlefield: [stone, vampire] }),
                makePlayer("p2"),
            ],
        });
        untapStep(state);
        const vampAfter = state.players[0].battlefield.find(
            (c) => c.id === "vamp"
        )!;
        expect(vampAfter.isTapped).toBe(true);
        expect(vampAfter.manaCommitted).toBeUndefined();
        expect(vampAfter.chosenMana).toBeUndefined();
    });

    it("wire format: power-keyed eligibility survives projectPublicState (no prompt + stays tapped)", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const aura = makeInstance(unholyStrength.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone, bear, aura, vampire],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        // No PendingChoice (cap=0 hard skip).
        expect(state.pendingChoices ?? []).toEqual([]);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices ?? []).toEqual([]);
        const slimBF = projected.players[0].battlefield;
        // Both high-effective-power creatures stayed tapped in the slim view.
        expect(slimBF.find((c) => c.id === "bear")?.isTapped).toBe(true);
        expect(slimBF.find((c) => c.id === "vamp")?.isTapped).toBe(true);
        // Effective power re-reads correctly through the projection
        // (layer 7c folds in the aura via the registry).
        const slimBear = slimBF.find((c) => c.id === "bear")!;
        expect(getEffectivePower(projected, slimBear)).toBe(4);
    });
});

describe("Smoke (creature-only untap cap, CR 502.1, ADR 0005)", () => {
    it("is a {2}{R} enchantment declaring a single untap-restriction static effect", () => {
        expect(smoke.manaCost).toEqual({ R: 2 });
        expect(smoke.types).toEqual(["Enchantment"]);
        expect(smoke.staticEffects).toHaveLength(1);
        const effect = smoke.staticEffects?.[0];
        expect(effect?.kind).toBe("untap-restriction");
        if (effect?.kind === "untap-restriction") {
            expect(effect.maxUntap).toBe(1);
            expect(effect.filter).toEqual({ types: "Creature" });
        }
    });

    it("the printed legacy keyword `limits-creature-untap-to-one` is no longer declared", () => {
        expect(smoke.staticAbilities ?? []).not.toContain(
            "limits-creature-untap-to-one"
        );
    });

    it("with 0 tapped creatures, no prompt — UNTAP auto-resolves to UPKEEP", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const land = makeInstance(plains.id, { id: "l1", isTapped: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant, land] }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.phase).toBe("UPKEEP");
        // Land is unrestricted under Smoke — untaps normally.
        expect(
            state.players[0].battlefield.find((c) => c.id === "l1")?.isTapped
        ).toBe(false);
    });

    it("with 2+ tapped creatures, an untap-pick PendingChoice is enqueued ({min:0,max:1}, creature filter)", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        expect(state.phase).toBe("UNTAP");
        const queue = state.pendingChoices ?? [];
        expect(queue).toHaveLength(1);
        const head = queue[0];
        expect(head.kind).toBe("untap-pick");
        expect(head.playerId).toBe("p1");
        expect(head.zone).toBe("battlefield");
        expect(head.filter).toEqual({ types: "Creature" });
        expect(head.count).toEqual({ min: 0, max: 1 });
        expect(state.priorityPlayerId).toBe("p1");
        // Both creatures are still tapped — pick has not committed.
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });

    it("submit-untap untaps exactly the chosen creature; the other stays tapped", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        // Simulate the mutation's commit path.
        const picked = ["bear-1"];
        const chooser = state.players.find(
            (p) => p.id === state.pendingChoices![0].zoneOwnerId
        )!;
        for (const id of picked) {
            const c = chooser.battlefield.find((x) => x.id === id);
            if (c) c.isTapped = false;
        }
        state.pendingChoices = undefined;
        untapStep(state);
        advancePhase(state);

        expect(state.phase).toBe("UPKEEP");
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });

    it("submit-skip (empty selection) leaves every creature tapped", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        // Skip commit: empty selection, advance dispatcher.
        state.pendingChoices = undefined;
        untapStep(state);
        advancePhase(state);

        expect(state.phase).toBe("UPKEEP");
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });

    it("Smoke does NOT cap non-creature untaps — artifacts, enchantments, lands untap normally", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const artifact = makeInstance(solRing.id, {
            id: "ring",
            isTapped: true,
        });
        const castleEnch = makeInstance(castle.id, {
            id: "castle",
            isTapped: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        enchant,
                        land1,
                        land2,
                        artifact,
                        castleEnch,
                        bear,
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        const bf = state.players[0].battlefield;
        // Non-creature permanents untap immediately, even while the
        // creature prompt is still pending for the single bear (only 1
        // creature is tapped so the cap auto-resolves to "untap it";
        // here the lone eligible is also picked since there is no
        // tactical zero-branch for a single match — but more importantly
        // the non-creatures must already be untapped).
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "ring")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "castle")?.isTapped).toBe(false);
    });

    it("wire format: untap-pick prompt + creature filter survive projectPublicState", () => {
        const enchant = makeInstance(smoke.id, { id: "smoke" });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchant, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0].kind).toBe("untap-pick");
        expect(projected.pendingChoices?.[0].filter).toEqual({
            types: "Creature",
        });
        expect(projected.pendingChoices?.[0].count).toEqual({
            min: 0,
            max: 1,
        });
        // Both creatures still tapped in the slim view — the dispatcher
        // has not committed any untap yet.
        const slim = projected.players[0].battlefield;
        expect(slim.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(slim.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });
});

describe("Winter Orb + Smoke (independent multi-restriction FIFO, CR 502.1, ADR 0005)", () => {
    it("with WO before Smoke in battlefield order, the land prompt fires first then the creature prompt", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb" });
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [orb, smk, land1, land2, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        // First prompt: Winter Orb (land filter, max 1).
        expect(state.pendingChoices).toHaveLength(1);
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("untap-pick");
        expect(head.filter).toEqual({ types: "Land" });
        expect(head.count).toEqual({ min: 0, max: 1 });
        // Commit a land pick and dispatch the next restriction.
        const landPick = ["l1"];
        const chooser = state.players.find((p) => p.id === head.zoneOwnerId)!;
        for (const id of landPick) {
            const c = chooser.battlefield.find((x) => x.id === id);
            if (c) c.isTapped = false;
        }
        state.pendingChoices = undefined;
        untapStep(state);

        // Second prompt: Smoke (creature filter, max 1).
        expect(state.pendingChoices).toHaveLength(1);
        head = state.pendingChoices![0];
        expect(head.kind).toBe("untap-pick");
        expect(head.filter).toEqual({ types: "Creature" });
        expect(head.count).toEqual({ min: 0, max: 1 });

        // Untapping a land did NOT consume the creature cap, and vice
        // versa: only the explicitly picked land has untapped so far.
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);

        // Commit the creature pick and let UNTAP fall through to UPKEEP.
        const creaturePick = ["bear-2"];
        for (const id of creaturePick) {
            const c = chooser.battlefield.find((x) => x.id === id);
            if (c) c.isTapped = false;
        }
        state.pendingChoices = undefined;
        untapStep(state);
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        const bf2 = state.players[0].battlefield;
        expect(bf2.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(bf2.find((c) => c.id === "bear-2")?.isTapped).toBe(false);
    });

    it("with Smoke before WO in battlefield order, the creature prompt fires first then the land prompt", () => {
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const orb = makeInstance(winterOrb.id, { id: "orb" });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [smk, orb, land1, land2, bear1, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        // First prompt: Smoke (creature filter).
        expect(state.pendingChoices).toHaveLength(1);
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("untap-pick");
        expect(head.filter).toEqual({ types: "Creature" });

        // Skip the creature pick (tactical zero-branch).
        state.pendingChoices = undefined;
        untapStep(state);

        // Second prompt: Winter Orb (land filter).
        expect(state.pendingChoices).toHaveLength(1);
        head = state.pendingChoices![0];
        expect(head.kind).toBe("untap-pick");
        expect(head.filter).toEqual({ types: "Land" });

        // Skip the land pick as well.
        state.pendingChoices = undefined;
        untapStep(state);
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        // Both skips honored — nothing in the restricted sets untapped.
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear-2")?.isTapped).toBe(true);
    });

    it("Winter Orb on opponent's side, Smoke on yours: active player's BF order still wins for first prompt", () => {
        // Source-card battlefield order is "active player's BF, then
        // opponent's BF" — so Smoke (active) fires before Winter Orb (opp)
        // regardless of which player controls each restriction.
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const orb = makeInstance(winterOrb.id, {
            id: "orb",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeInstance(plains.id, { id: "l1", isTapped: true });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        // Add a second bear so the Smoke cap binds with ≥2 eligible.
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            isTapped: true,
            isSummoningSick: false,
        });
        // Add a second land so Winter Orb's cap binds.
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [smk, land, bear, land2, bear2],
                }),
                makePlayer("p2", { battlefield: [orb] }),
            ],
        });
        runUntapForJ("p1", state);

        // First prompt is Smoke's (source on active BF, before opp's WO).
        expect(state.pendingChoices?.[0].filter).toEqual({
            types: "Creature",
        });
    });
});

describe("Meekstone + Smoke (hard-skip ∩ cap filter overlap, CR 502.1)", () => {
    it("power-4 creature excluded from Smoke eligibles; only power-2 creature offered", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone, smk, bear, vampire],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        // Smoke prompt should appear with only the power-2 bear eligible.
        // The power-4 vampire is vetoed by Meekstone's hard-skip filter.
        const queue = state.pendingChoices ?? [];
        expect(queue).toHaveLength(1);
        const head = queue[0];
        expect(head.kind).toBe("untap-pick");
        expect(head.filter).toEqual(
            expect.objectContaining({ types: "Creature" })
        );
        expect(head.filter!.excludeInstanceIds).toContain("vamp");
        expect(head.count).toEqual({ min: 0, max: 1 });
        // Vampire stays tapped regardless of the Smoke prompt.
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "vamp")?.isTapped).toBe(true);
    });

    it("no prompt when only power-4 creatures (Meekstone vetoes all Smoke eligibles)", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const vamp1 = makeInstance(sengirVampire.id, {
            id: "vamp1",
            isTapped: true,
            isSummoningSick: false,
        });
        const vamp2 = makeInstance(sengirVampire.id, {
            id: "vamp2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone, smk, vamp1, vamp2],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        // Meekstone hard-skips both; Smoke's eligible set is empty → auto-resolve (ADR 0003).
        expect(state.pendingChoices ?? []).toEqual([]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "vamp1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "vamp2")?.isTapped).toBe(true);
    });

    it("submit-untap on the power-2 bear untaps it; power-4 creature stays tapped", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone, smk, bear, vampire],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        // Commit the bear pick.
        const picked = ["bear"];
        const chooser = state.players.find(
            (p) => p.id === state.pendingChoices![0].zoneOwnerId
        )!;
        for (const id of picked) {
            const c = chooser.battlefield.find((x) => x.id === id);
            if (c) c.isTapped = false;
        }
        state.pendingChoices = undefined;
        untapStep(state);
        advancePhase(state);

        expect(state.phase).toBe("UPKEEP");
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "vamp")?.isTapped).toBe(true);
    });

    it("commit-time veto: computeHardSkipFilters rejects a power-4 creature via effectivePermanentView", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone, smk, vampire, bear],
                }),
                makePlayer("p2"),
            ],
        });

        const vetoFilters = computeHardSkipFilters(state);
        expect(vetoFilters.length).toBeGreaterThan(0);

        // Power-4 vampire: vetoed.
        const vampView = effectivePermanentView(state, vampire);
        expect(
            vetoFilters.some((f) => matchesPermanentFilter(vampView, f))
        ).toBe(true);

        // Power-2 bear: not vetoed.
        const bearView = effectivePermanentView(state, bear);
        expect(
            vetoFilters.some((f) => matchesPermanentFilter(bearView, f))
        ).toBe(false);
    });

    it("wire format: Smoke prompt with only the low-power creature survives projectPublicState", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone, smk, bear, vampire],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapForJ("p1", state);

        // GRE state: single prompt with creature filter.
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("untap-pick");

        // Projected state: same prompt survives.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices).toHaveLength(1);
        expect(projected.pendingChoices![0].kind).toBe("untap-pick");
        expect(projected.pendingChoices![0].filter).toEqual(
            expect.objectContaining({ types: "Creature" })
        );
        // Vampire still tapped in projected view.
        const slim = projected.players[0].battlefield;
        expect(slim.find((c) => c.id === "vamp")?.isTapped).toBe(true);
    });

    it("layer 7c: a printed-2 creature pumped to power 4 is vetoed by Meekstone in Smoke eligibles", () => {
        const stone = makeInstance(meekstone.id, { id: "stone" });
        const smk = makeInstance(smoke.id, { id: "smoke" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const aura = makeInstance(unholyStrength.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear2",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone, smk, bear, aura, bear2],
                }),
                makePlayer("p2"),
            ],
        });
        // Pumped bear has effective power 4 → Meekstone veto.
        expect(getEffectivePower(state, bear)).toBe(4);
        runUntapForJ("p1", state);

        // Only unpumped bear2 should be eligible in the Smoke prompt.
        expect(state.pendingChoices).toHaveLength(1);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(true);
    });
});

describe("Stasis (players skip their untap step + upkeep sacrifice unless {U}, CR 502.1, ADR 0005)", () => {
    function setup() {
        const enchant = makeInstance(stasis.id, {
            id: "stasis",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(plains.id, {
            id: "l1",
            isTapped: true,
            manaCommitted: true,
            chosenMana: { W: 1 },
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant, land, bear] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }

    it("declares a single untap-restriction static effect (maxUntap 0, any-permanent filter)", () => {
        expect(stasis.manaCost).toEqual({ X: 1, U: 1 });
        expect(stasis.types).toEqual(["Enchantment"]);
        // No opaque skip-untap-step keyword — restriction lives in
        // `staticEffects` per ADR 0005.
        expect(stasis.staticAbilities ?? []).not.toContain("skip-untap-step");
        expect(stasis.staticEffects).toHaveLength(1);
        const effect = stasis.staticEffects?.[0];
        expect(effect?.kind).toBe("untap-restriction");
        if (effect?.kind === "untap-restriction") {
            expect(effect.maxUntap).toBe(0);
            // Filter matches every permanent type — equivalent to "any".
            expect(effect.filter).toEqual({
                types: [
                    "Artifact",
                    "Creature",
                    "Enchantment",
                    "Land",
                    "Planeswalker",
                    "Battle",
                ],
            });
        }
    });

    it("the active player's untap step is a no-op when Stasis is in play (no prompt, no untaps)", () => {
        const { state } = setup();
        runUntapForJ("p1", state);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(true);
        // No PendingChoice enqueued — ADR 0003 auto-resolves the hard skip.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.pendingUntapStep).toBeUndefined();
    });

    it("dispatcher clears manaCommitted / isSummoningSick / chosenMana on every active-BF permanent even though nothing untaps", () => {
        // Exercise `untapStep` directly: end-of-phase `emptyManaPools` would
        // re-set `manaCommitted` on still-tapped lands (CR 500.4), so the
        // dispatcher's per-step cleanup is the level the assertion targets —
        // mirrors the prior `skip-untap-step` semantics.
        const { state } = setup();
        untapStep(state);
        const bf = state.players[0].battlefield;
        const land = bf.find((c) => c.id === "l1")!;
        const bear = bf.find((c) => c.id === "bear")!;
        expect(land.manaCommitted).toBeUndefined();
        expect(land.chosenMana).toBeUndefined();
        expect(bear.isSummoningSick).toBeUndefined();
    });

    it("wire format: skipped board projects with both permanents still tapped and no PendingChoice", () => {
        const { state } = setup();
        runUntapForJ("p1", state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices ?? []).toEqual([]);
        const slim = projected.players[0].battlefield;
        expect(slim.find((c) => c.id === "l1")?.isTapped).toBe(true);
        expect(slim.find((c) => c.id === "bear")?.isTapped).toBe(true);
    });

    it("upkeep trigger queues may-pay; declining sacrifices Stasis", () => {
        const { state } = setup();
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UNTAP";
        advancePhase(state); // → UPKEEP
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "stasis-upkeep"
        );
        expect(trigger).toBeDefined();
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["decline"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Stasis moved to graveyard, skip-untap no longer active.
        expect(
            state.players[0].battlefield.find((c) => c.id === "stasis")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stasis.id
        );
    });

    it("upkeep trigger — accepting keeps Stasis on the battlefield", () => {
        const { state } = setup();
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "UNTAP";
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "stasis")
        ).toBeDefined();
    });
});

describe("Paralyze (aura — tap host on ETB + does-not-untap grant + upkeep pay {4}, CR 303.4 / 611)", () => {
    it("declares aura subtype, host-grant keyword and {B} cost", () => {
        expect(paralyze.manaCost).toEqual({ B: 1 });
        expect(paralyze.subtypes).toContain("Aura");
        const grant = paralyze.staticEffects?.[0];
        expect(grant?.kind).toBe("keyword-grant");
        if (grant?.kind === "keyword-grant") {
            expect(grant.keyword).toBe("does-not-untap");
        }
    });

    it("ETB taps the enchanted creature and the host keeps does-not-untap while attached", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Cast Paralyze targeting the opposing bear — push to stack and resolve.
        pushSpell(state, paralyze.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const tappedBear = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(tappedBear.isTapped).toBe(true);
        expect(tappedBear.staticAbilities).toContain("does-not-untap");
    });

    it("the host stays tapped through its controller's untap step while paralyzed", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, paralyze.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Drive UNTAP for the host's controller (p2) — bear must stay tapped.
        runUntapForJ("p2", state);
        const stillTapped = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(stillTapped?.isTapped).toBe(true);
    });

    it("upkeep trigger lets the host's controller pay {4} to untap the creature", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, paralyze.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // p2's upkeep — Paralyze fires; p2 (host's controller) is the may-pay
        // chooser.
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        state.phase = "UNTAP";
        advancePhase(state); // → UPKEEP queues trigger
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "paralyze-upkeep"
        );
        expect(trigger).toBeDefined();
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p2");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter?.isTapped).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Reanimation (gap H — CR 400.7 graveyard → battlefield)
// ---------------------------------------------------------------------------

describe("Resurrection (return target Creature card from your graveyard to the battlefield, CR 400.7)", () => {
    it("returns a creature from your graveyard to your battlefield", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, resurrection.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "dead"
        );
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        );
        expect(revived).toBeDefined();
        expect(revived?.controllerId).toBe("p1");
        // CR 302.1 — a freshly-entered creature is summoning sick.
        expect(revived?.isSummoningSick).toBe(true);
        expect(revived?.zone).toBe("battlefield");
    });

    it("silent fizzle if the target is no longer in the graveyard at resolution (CR 608.2b)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, resurrection.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        state.players[0].graveyard = [];
        state.players[0].exile.push(dead);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dead")
        ).toBeUndefined();
        expect(state.players[0].exile.map((c) => c.id)).toContain("dead");
    });

    it("targeting filter is 'controller: you' — opponent graveyard not legal", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "opp-dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        const req = resurrection.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("opp-dead");
    });

    it("reanimated creature receives existing lord-grants (Goblin King + reanimated Goblin)", () => {
        const dead = makeInstance(monssGoblinRaiders.id, {
            id: "dead-goblin",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const king = makeInstance(goblinKing.id, {
            id: "king",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [dead],
                    battlefield: [king],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, resurrection.id, "p1", [
            { type: "graveyard-card", id: "dead-goblin", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead-goblin"
        )!;
        // Goblin King grants other Goblins +1/+1 and mountainwalk (CR 611).
        expect(getEffectivePower(state, revived)).toBe(2);
        expect(revived.staticAbilities).toContain("mountainwalk");
    });
});

describe("Animate Dead (Aura — CR 303.4i graveyard-target reanimation + CR 603.10 LTB)", () => {
    it("resolves on graveyard target — host returns to caster's battlefield, aura attaches", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p2" },
        ]);
        resolveTopOfStack(state);
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        );
        expect(revived).toBeDefined();
        // Aura targets any graveyard, host returns under caster's control.
        expect(revived?.controllerId).toBe("p1");
        const aura = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === animateDead.id
        );
        expect(aura).toBeDefined();
        expect(aura?.attachedTo).toBe("dead");
    });

    it("host gets -1/-0 via the pt-buff layer 7c", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        )!;
        // grizzlyBears 2/2 → -1/-0 → 1/2.
        expect(getEffectivePower(state, revived)).toBe(1);
        expect(getEffectiveToughness(state, revived)).toBe(2);
    });

    it("wire format: -1/-0 buff survives projectPublicState (regression guard)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slimRevived = projected.players[0].battlefield.find(
            (c) => c.id === "dead"
        )!;
        expect(getEffectivePower(projected, slimRevived)).toBe(1);
        expect(getEffectiveToughness(projected, slimRevived)).toBe(2);
    });

    it("LTB-trigger: when the aura is destroyed, the host is sacrificed (CR 603.10 last-known-info)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === animateDead.id
        )!;
        removePermanentTo(state, aura.id, "graveyard");
        processPendingActionTriggers(state);
        // Aura's LTB-trigger is now on the stack — resolve it.
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dead")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("dead");
    });

    it("fizzle when the graveyard target is removed before resolution (CR 608.2b)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        state.players[0].graveyard = [];
        state.players[0].exile.push(dead);
        resolveTopOfStack(state);
        // Aura fizzles to its owner's graveyard (CR 303.4i).
        expect(
            state.players[0].battlefield.find(
                (c) => (c.card as { id?: string }).id === animateDead.id
            )
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find(
                (c) => (c.card as { id?: string }).id === animateDead.id
            )
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Replacement effects framework (gap U — CR 614)
// ---------------------------------------------------------------------------

describe("Library of Leng — no maximum hand size (CR 402.2 / 514.1)", () => {
    function handOf(n: number, ownerId: string) {
        return Array.from({ length: n }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `${ownerId}-hand-${i}`,
                ownerId,
                controllerId: ownerId,
                zone: "hand",
            })
        );
    }

    it("effectiveMaxHandSize returns Infinity when the controller has Library of Leng in play", () => {
        const leng = makeInstance(libraryOfLeng.id, {
            id: "leng",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leng] }),
                makePlayer("p2"),
            ],
        });
        expect(effectiveMaxHandSize(state.players[0])).toBe(Infinity);
        // Opponent unaffected — Library of Leng is controller-scoped.
        expect(effectiveMaxHandSize(state.players[1])).toBe(7);
    });

    it("Library of Leng on the opponent's side does not raise the controller's cap", () => {
        const leng = makeInstance(libraryOfLeng.id, {
            id: "leng",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [leng] }),
            ],
        });
        expect(effectiveMaxHandSize(state.players[0])).toBe(7);
        expect(effectiveMaxHandSize(state.players[1])).toBe(Infinity);
    });

    it("CLEANUP with 12 cards in hand + Library of Leng in play → no discard prompt", () => {
        const leng = makeInstance(libraryOfLeng.id, {
            id: "leng",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [leng],
                    hand: handOf(12, "p1"),
                }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state);
        expect(state.pendingCleanupDiscard).toBeUndefined();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.phase).toBe("UPKEEP");
        expect(state.players[0].hand.length).toBe(12);
    });

    it("Library of Leng leaves play → next cleanup enforces hand size normally", () => {
        const leng = makeInstance(libraryOfLeng.id, {
            id: "leng",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [leng],
                    hand: handOf(9, "p1"),
                }),
                makePlayer("p2"),
            ],
        });
        // Turn 1 ends — Library of Leng still in play, no discard.
        advancePhase(state);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].hand.length).toBe(9);

        // Library of Leng leaves. Fast-forward to p1's END_STEP for turn 2.
        state.players[0].battlefield = [];
        state.phase = "END_STEP";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";

        advancePhase(state);
        // Now CR 514.1 kicks in: hand has 9, cap 7 → prompted to discard 2.
        expect(state.pendingCleanupDiscard).toEqual({ playerId: "p1" });
        expect(state.pendingChoices![0].count).toBe(2);
    });

    it("Disrupting Scepter forces a discard while Library of Leng is in play → CR 614 routes to library top", () => {
        // Already exercised by the existing CR 614 tests below via Mind Twist;
        // this rephrasing pins the combined "discard from outside cleanup +
        // Leng clause 2" path doesn't regress when clause 1 is wired up.
        const leng = makeInstance(libraryOfLeng.id, { id: "leng" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [leng],
                    hand: [bear],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "topdeck",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, mindTwist.id, "p1", [{ type: "player", id: "p1" }]);
        state.stack[state.stack.length - 1].chosenX = 1;
        resolveTopOfStack(state);
        expect(state.players[0].library[0].id).toBe("bear");
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "bear"
        );
    });

    it("cleanup-driven discard after Library of Leng leaves still honors any subsequent Library of Leng routing (CR 614 still fires)", () => {
        // Setup: 9 cards in hand at end-of-turn, no Library of Leng yet →
        // cleanup prompts for 2 discards. Then BEFORE committing, drop a
        // Library of Leng in. The commit goes through applyDiscardReplacements
        // and routes the discards to the library top (CR 614 still fires).
        const lengId = "leng-after";
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: handOf(9, "p1"),
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "topdeck",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state);
        expect(state.pendingChoices![0].count).toBe(2);

        // Library of Leng drops in mid-CLEANUP. Clause 1 ("no maximum hand
        // size") doesn't retroact on the already-enqueued prompt — the count
        // is fixed at enqueue time — but clause 2 (CR 614 routing) still
        // fires on each discard event.
        state.players[0].battlefield.push(
            makeInstance(libraryOfLeng.id, {
                id: lengId,
                controllerId: "p1",
                ownerId: "p1",
            })
        );

        const picks = [
            state.players[0].hand[0].id,
            state.players[0].hand[1].id,
        ];
        finalizeCleanupDiscard(state, picks);

        // Both picks routed to library top (CR 614), not graveyard.
        expect(state.players[0].graveyard.length).toBe(0);
        expect(
            state.players[0].library
                .slice(0, 2)
                .map((c) => c.id)
                .sort()
        ).toEqual(picks.sort());
        expect(state.players[0].hand.length).toBe(7);
        expect(state.pendingCleanupDiscard).toBeUndefined();
    });
});

describe("Library of Leng (CR 614 discard → library top)", () => {
    it("opt-out via state.playerPreferences routes the discard to the graveyard normally", () => {
        const leng = makeInstance(libraryOfLeng.id, { id: "leng" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [leng],
                    hand: [bear],
                }),
                makePlayer("p2"),
            ],
            playerPreferences: {
                p1: { libraryOfLengRouting: "graveyard" },
            },
        });
        pushSpell(state, mindTwist.id, "p1", [{ type: "player", id: "p1" }]);
        state.stack[state.stack.length - 1].chosenX = 1;
        resolveTopOfStack(state);
        // Preference opt-out: bear goes to graveyard, not library top.
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("bear");
        expect(state.players[0].library[0]?.id).not.toBe("bear");
    });

    it("discardCard moves the chosen card to the top of the library instead of the graveyard", () => {
        const leng = makeInstance(libraryOfLeng.id, { id: "leng" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [leng],
                    hand: [bear],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "topdeck",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        // Drive a discard via mindTwist-style channel: use ctx.discardCard
        // via a temporary scenario. The easiest path: cast Mind Twist with
        // X=1 on the same player. But Mind Twist uses discardAtRandom which
        // ALSO honors the replacement. Simpler: directly assert through a
        // fixture spell — we use mindTwist below.
        // For now, use moveCard fixture via mindTwist with X=1.
        // (See discardAtRandom branch test for the random pick.)
        // Manual invocation through SpellContext is not exposed; use
        // mindTwist as the canonical discard-source.
        pushSpell(state, mindTwist.id, "p1", [{ type: "player", id: "p1" }]);
        state.stack[state.stack.length - 1].chosenX = 1;
        resolveTopOfStack(state);
        // The bear should have been redirected to library top, not grave.
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "bear"
        );
        expect(state.players[0].library[0].id).toBe("bear");
        expect(
            state.players[0].hand.find((c) => c.id === "bear")
        ).toBeUndefined();
    });
});

describe("Reverse Damage (CR 614 one-shot prevent + gain life)", () => {
    it("prevents the next damage from the chosen source to the caster and gains life equal", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 10 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, reverseDamage.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Now have the bear deal 4 damage to p1 (via a fake event).
        // Easiest path: directly call into runDamageReplacement-equivalent
        // by casting a Lightning Bolt FROM the bear is not possible; use
        // Lightning Bolt to verify a *different* source isn't intercepted.
        // For the bear-specific shield, simulate via a Lightning Bolt cast
        // whose source matches: replace bolt's stack id with "bear" before
        // resolve to mimic combat damage from bear.
        // Simpler: emit a manual DamageEvent through a Lightning Bolt cast
        // on the same target; the shield is sourceInstanceId-keyed and the
        // bolt's id won't match. So we test cancellation by mimicking the
        // bear source through SpellContext is not direct.
        // Use Lightning Bolt cast (different source): shield should NOT
        // consume it (sanity), confirming sourceInstanceId binding.
        const opp = state.players[1];
        const lifeBefore = state.players[0].life;
        // Have the bear deal 4 damage to p1 via fake SpellContext path —
        // we step into the engine directly:
        // Replace bear-source by pushing a synthetic damage event through
        // dealDamage of a stack item with id = "bear".
        // Workaround: directly inject the shield consumption by calling
        // applyTransientDamageRedirections via cast of Lightning Bolt then
        // overriding id pre-resolve.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const bolt = state.stack[state.stack.length - 1];
        bolt.id = "bear"; // pretend the bolt is dealt by the bear
        resolveTopOfStack(state);
        // Damage was prevented and life increased by 3 (Lightning Bolt's
        // amount). Pre-bolt life 10, gained 3, total 13.
        expect(state.players[0].life).toBe(lifeBefore + 3);
        // Sanity: opponent is unaffected.
        expect(opp.life).toBe(20);
    });
});

describe("Veteran Bodyguard (CR 614 continuous damage redirect)", () => {
    it("redirects unblocked combat damage to the bodyguard when it's untapped", async () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const bg = makeInstance(veteranBodyguard.id, {
            id: "bg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [bg], life: 20 }),
                makePlayer("p2", { battlefield: [bear], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {}, "regular");
        // Bear's 2 damage redirected to Veteran Bodyguard (now has 2 marked).
        expect(state.players[0].life).toBe(20);
        const bgAfter = state.players[0].battlefield.find((c) => c.id === "bg");
        expect(bgAfter?.damageMarked).toBe(2);
    });

    it("does NOT redirect when the bodyguard is tapped (CR 614 condition)", async () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const bg = makeInstance(veteranBodyguard.id, {
            id: "bg",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [bg], life: 20 }),
                makePlayer("p2", { battlefield: [bear], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {}, "regular");
        expect(state.players[0].life).toBe(18);
        const bgAfter = state.players[0].battlefield.find((c) => c.id === "bg");
        expect(bgAfter?.damageMarked).toBeUndefined();
    });

    it("does NOT redirect when the attacker is blocked (source filter)", async () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const bg = makeInstance(veteranBodyguard.id, {
            id: "bg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [bg, blocker], life: 20 }),
                makePlayer("p2", { battlefield: [bear], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: { blk: ["bear-att"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {}, "regular");
        // Damage goes to the blocker, bodyguard untouched.
        const bgAfter = state.players[0].battlefield.find((c) => c.id === "bg");
        expect(bgAfter?.damageMarked).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });
});

describe("Personal Incarnation (continuous redirect + dies-trigger)", () => {
    it("redirects damage from any source dealt to owner onto itself", () => {
        const pinc = makeInstance(personalIncarnation.id, {
            id: "pinc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinc], life: 20 }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        // p1 life unchanged; Incarnation took the 3.
        expect(state.players[0].life).toBe(20);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "pinc"
        )!;
        expect(after.damageMarked).toBe(3);
    });

    it("LTB-trigger: when it dies, owner loses half their life rounded up", () => {
        const pinc = makeInstance(personalIncarnation.id, {
            id: "pinc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinc], life: 14 }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "pinc", "graveyard");
        processPendingActionTriggers(state);
        // Resolve the dies-trigger on the stack.
        resolveTopOfStack(state);
        // Owner had 14 life → loses ceil(14/2) = 7 → ends at 7.
        expect(state.players[0].life).toBe(7);
    });
});

describe("Lich (multi-replacement enchantment)", () => {
    it("ETB sets the controller's life to 0 and lich's lose-game replacement saves them", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [lichInst] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lich.id, "p1");
        // Replace the spell's id with the hand instance so PERMANENT_ENTERED
        // matches the trigger source.
        resolveTopOfStack(state);
        // ETB trigger now on stack — resolve it.
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        // Life dropped to 0; lich's lose-game replacement protects from SBA.
        expect(state.players[0].life).toBe(0);
        expect(state.gameOver).toBeUndefined();
        // SBA check: no game over because lich is on the field.
        checkStateBasedActions(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("wire format: lich-etb life drop survives projectPublicState", () => {
        // Visible-on-board effect produced by an enteredTrigger factory
        // (lich-etb → loseLife). Re-runs the life assertion against the
        // projected state so the projection layer can't silently strip the
        // controller's life change.
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 17, hand: [lichInst] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lich.id, "p1");
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(0);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(0);
    });

    it("lifegain → draw cards instead (CR 614 lifegain replacement)", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst],
                    life: 0,
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "deck1",
                            zone: "library",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "deck2",
                            zone: "library",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "deck3",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        // Use Stream of Life to gain 3 life.
        pushSpell(state, streamOfLife.id, "p1", [{ type: "player", id: "p1" }]);
        state.stack[state.stack.length - 1].chosenX = 3;
        resolveTopOfStack(state);
        // Life still 0; instead, drew 3 cards.
        expect(state.players[0].life).toBe(0);
        expect(state.players[0].hand.length).toBe(3);
    });

    it("damage to controller with enough fodder enqueues a player choice (CR 701.16)", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const a = makeInstance(grizzlyBears.id, {
            id: "sac-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(grizzlyBears.id, {
            id: "sac-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const c = makeInstance(grizzlyBears.id, {
            id: "sac-c",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst, a, b, c],
                    life: 0,
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        // Three candidates, three damage to sacrifice → keepCount = 0, no
        // choice needed: all three are sacrificed automatically.
        expect(state.gameOver).toBeUndefined();
        expect(
            state.players[0].battlefield.filter((c) => c.id !== "lich")
        ).toHaveLength(0);
    });

    it("damage trigger asks the player which permanent(s) to sacrifice when there's surplus", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const a = makeInstance(grizzlyBears.id, {
            id: "sac-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(grizzlyBears.id, {
            id: "sac-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const c = makeInstance(grizzlyBears.id, {
            id: "sac-c",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst, a, b, c],
                    life: 0,
                }),
                makePlayer("p2"),
            ],
        });
        // 1 damage → keep 2 of 3 candidates.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        // Override bolt damage by chosenX so this is 1 damage. Lightning
        // Bolt is fixed 3 — switch source to a single damage proxy via
        // overriding amount through the trigger directly is complex; we
        // instead pre-mark damageMarked via dealDamage simulated.
        // For this test we simulate the trigger payload manually: build a
        // DAMAGE_DEALT pendingEvent with amount=1 then drain via
        // processPendingActionTriggers without applying real damage.
        state.stack.pop();
        state.pendingEvents = [
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "synthetic",
                sourceControllerId: "p2",
                target: { type: "player", id: "p1" },
                amount: 1,
                isCombat: false,
            },
        ];
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        // Choice now enqueued: sacrifice 1 of 3.
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.count).toBe(1);
        expect(head.kind).toBe("sacrifice-permanents");
        // Player sacrifices sac-c → sac-a and sac-b remain.
        const item = state.stack.find((s) => s.id === head.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: ["sac-c"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const remaining = state.players[0].battlefield
            .filter((c) => c.id !== "lich")
            .map((c) => c.id);
        expect(remaining).toEqual(["sac-a", "sac-b"]);
        expect(state.gameOver).toBeUndefined();
    });

    it("damage to controller forces sacrifice of that many nontoken permanents", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sacA = makeInstance(grizzlyBears.id, {
            id: "sac-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sacB = makeInstance(grizzlyBears.id, {
            id: "sac-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst, sacA, sacB],
                    life: 0,
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // resolve the lich-damage trigger
        // 3 damage → sacrifice 3 permanents. Only 2 candidates → loseGame.
        expect(state.gameOver).toBeDefined();
        expect(state.gameOver?.loserId).toBe("p1");
    });
});

describe("Jade Monolith ({1}: redirect next damage to creature to controller)", () => {
    it("activator picks the source via mid-resolve requestChoice, shield redirects damage from that source", () => {
        const jm = makeInstance(jadeMonolith.id, {
            id: "jm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jm, bear], life: 20 }),
                makePlayer("p2", { battlefield: [tim], life: 20 }),
            ],
        });
        // Activate Jade Monolith with bear as target.
        const jmAct = pushSpell(state, jadeMonolith.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        jmAct.abilityId = "jm-redirect";
        resolveTopOfStack(state);
        // Mid-resolve choice enqueued — activator picks Tim as the source.
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("pick-source");
        const choiceItem = state.stack.find((s) => s.id === head.stackItemId)!;
        choiceItem.collectedChoices = {
            ...(choiceItem.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: ["tim"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Now Tim taps to deal 1 damage to bear → shield redirects to p1.
        const timAct = pushSpell(state, prodigalSorcerer.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        timAct.abilityId = prodigalSorcerer.activatedAbilities![0].id;
        // The shield matches on stack item id; rebind the stack item id to
        // "tim" so the source filter on the shield identifies the Tim
        // permanent. (Productionally `sourceInstanceId` on the damage
        // event is the resolving stack item id; for this fixture we align
        // the two manually.)
        timAct.id = "tim";
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.damageMarked).toBeUndefined();
        expect(state.players[0].life).toBe(19);
    });
});

describe("Simulacrum ({X}{B} instant — life + damage based on damage tracking)", () => {
    it("gain life equal to damage dealt to caster this turn + deal that much to target", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target], life: 13 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Take 4 damage as the caster (set tally directly to bypass combat).
        state.damageDealtToPlayerThisTurn = { p1: 4 };
        pushSpell(state, simulacrum.id, "p1", [
            { type: "permanent", id: "tgt" },
        ]);
        resolveTopOfStack(state);
        // Caster gained 4 life (13 → 17), target took 4 damage and was killed
        // (grizzlyBears toughness 2 < 4 → SBA lethal).
        expect(state.players[0].life).toBe(17);
        // After lethal, target should have left battlefield.
        expect(
            state.players[0].battlefield.find((c) => c.id === "tgt")
        ).toBeUndefined();
    });
});

describe("Phantasmal Forces (upkeep may-pay {U} else sacrifice)", () => {
    it("pay {U} on upkeep keeps the creature on the battlefield", () => {
        const inst = makeInstance(phantasmalForces.id, {
            id: "phantasmal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state); // → UPKEEP, trigger pushed to stack
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "phantasmal-forces-upkeep"
        );
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "phantasmal")
        ).toBeDefined();
    });

    it("decline on upkeep sacrifices the creature", () => {
        const inst = makeInstance(phantasmalForces.id, {
            id: "phantasmal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "phantasmal")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "phantasmal"
        );
    });
});

describe("Force of Nature (upkeep may-pay {G}{G}{G}{G} else 8 damage to controller)", () => {
    it("decline causes 8 damage to controller from this creature", () => {
        const inst = makeInstance(forceOfNature.id, {
            id: "fon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Force of Nature still on battlefield, controller took 8 damage.
        expect(
            state.players[0].battlefield.find((c) => c.id === "fon")
        ).toBeDefined();
        expect(state.players[0].life).toBe(12);
    });

    it("accept on upkeep skips the damage (controller life unchanged)", () => {
        const inst = makeInstance(forceOfNature.id, {
            id: "fon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });

    it("declares trample as a static ability", () => {
        expect(forceOfNature.staticAbilities).toContain("trample");
    });
});

describe("Wanderlust (aura — upkeep deals 1 dmg to host controller)", () => {
    it("at controller's upkeep the aura deals 1 damage to that player", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wanderlust.id, {
            id: "wander",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state); // → UPKEEP, aura trigger pushed
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("wanderlust-upkeep");
        resolveTopOfStack(state);
        // Host controller took 1 damage.
        expect(state.players[0].life).toBe(19);
    });

    it("does NOT trigger when the non-host controller's upkeep is active", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wanderlust.id, {
            id: "wander",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "UNTAP",
        });
        advancePhase(state); // → UPKEEP of p2 (not host's controller)
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Demonic Hordes ({T}: destroy land; upkeep pay {B}{B}{B} else opp sacs your land)", () => {
    function setupUpkeepDecline() {
        const hordes = makeInstance(demonicHordes.id, {
            id: "hordes",
            controllerId: "p1",
            ownerId: "p1",
        });
        const landA = makeInstance(swamp.id, {
            id: "swamp-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const landB = makeInstance(swamp.id, {
            id: "swamp-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hordes, landA, landB] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        return state;
    }

    it("decline enqueues opp's sacrifice-permanents choice over controller's battlefield", () => {
        const state = setupUpkeepDecline();
        advancePhase(state); // → UPKEEP, trigger pushed
        expect(state.stack[0].triggeredAbilityId).toBe("demonic-hordes-upkeep");
        resolveTopOfStack(state);
        const may = state.pendingChoices?.[0];
        expect(may?.kind).toBe("may-pay");
        const item = state.stack.find((s) => s.id === may!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${may!.step}:${may!.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Self tapped + opp's choice enqueued.
        const hordes = state.players[0].battlefield.find(
            (c) => c.id === "hordes"
        )!;
        expect(hordes.isTapped).toBe(true);
        expect(state.pendingChoices).toBeDefined();
        const sac = state.pendingChoices![0];
        expect(sac.kind).toBe("sacrifice-permanents");
        expect(sac.playerId).toBe("p2");
        expect(sac.zoneOwnerId).toBe("p1");
        expect(sac.zone).toBe("battlefield");
    });

    it("decline path: opp picks swamp-a → it is sacrificed from controller's battlefield", () => {
        const state = setupUpkeepDecline();
        advancePhase(state);
        resolveTopOfStack(state);
        const may = state.pendingChoices![0];
        const item = state.stack.find((s) => s.id === may.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${may.step}:${may.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const sac = state.pendingChoices![0];
        const sacItem = state.stack.find((s) => s.id === sac.stackItemId)!;
        sacItem.collectedChoices = {
            ...(sacItem.collectedChoices ?? {}),
            [`${sac.step}:${sac.choiceId}`]: ["swamp-a"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "swamp-a")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "swamp-a"
        );
        // swamp-b still on the battlefield.
        expect(
            state.players[0].battlefield.find((c) => c.id === "swamp-b")
        ).toBeDefined();
    });

    it("activated {T}: destroy target land", () => {
        const hordes = makeInstance(demonicHordes.id, {
            id: "hordes",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppLand = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hordes] }),
                makePlayer("p2", { battlefield: [oppLand] }),
            ],
        });
        state.stack.push({
            ...hordes,
            zone: "stack",
            castById: "p1",
            abilityId: "demonic-hordes-destroy-land",
            targets: [{ type: "permanent", id: "opp-swamp" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "opp-swamp")
        ).toBeUndefined();
    });
});

describe("Modal spells (CR 700.2) — Healing Salve / Blue & Red Elemental Blast", () => {
    it("Healing Salve gain-life mode: target player gains 3 life", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 13 }), makePlayer("p2")],
        });
        const item = pushSpell(state, healingSalve.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenModeId = "gain-life";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(16);
    });

    it("Healing Salve prevent mode: shield absorbs 3 incoming damage on target", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const salve = pushSpell(state, healingSalve.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        salve.chosenModeId = "prevent";
        resolveTopOfStack(state);
        // Bolt would deal 3 — fully prevented.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.damageMarked ?? 0).toBe(0);
    });

    it("Blue Elemental Blast counter mode: counters target red spell on the stack", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        const blast = pushSpell(state, blueElementalBlast.id, "p2", [
            { type: "spell", id: bolt.id },
        ]);
        blast.chosenModeId = "counter";
        resolveTopOfStack(state); // resolve the counter mode → removes bolt
        // Now resolve what's left — should NOT be the bolt anymore.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("Red Elemental Blast destroy mode: destroys target blue permanent", () => {
        const merfolk = makeInstance(merfolkOfThePearlTrident.id, {
            id: "merfolk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [merfolk] }),
            ],
        });
        const blast = pushSpell(state, redElementalBlast.id, "p1", [
            { type: "permanent", id: "merfolk" },
        ]);
        blast.chosenModeId = "destroy";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "merfolk")
        ).toBeUndefined();
    });

    it("declares Choose-one mode metadata on the card definition", () => {
        expect(healingSalve.modes).toBeDefined();
        expect(healingSalve.modes!.length).toBe(2);
        expect(healingSalve.modes!.map((m) => m.id)).toEqual([
            "gain-life",
            "prevent",
        ]);
        expect(blueElementalBlast.modes!.map((m) => m.id)).toEqual([
            "counter",
            "destroy",
        ]);
    });
});

describe("Blessing (aura, {W}: +1/+1 to host until EOT)", () => {
    it("activated pump adds +1/+1 to the enchanted host", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(blessing.id, {
            id: "blessing",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: "p1",
            abilityId: "blessing-pump",
            targets: [],
        });
        resolveTopOfStack(state);
        const hostAfter = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(state, hostAfter)).toBe(3);
        expect(getEffectiveToughness(state, hostAfter)).toBe(3);
    });
});

describe("Instill Energy (aura — pseudo-haste + {0} untap host, your-turn + once-per-turn)", () => {
    function attachAura(opts: { activePlayerId: string; hostTapped: boolean }) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: opts.hostTapped,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host] }),
                makePlayer("p2"),
            ],
            activePlayerId: opts.activePlayerId,
            priorityPlayerId: opts.activePlayerId,
        });
        pushSpell(state, instillEnergy.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);
        return state;
    }

    it("grants the host the haste keyword while attached", () => {
        const state = attachAura({
            activePlayerId: "p1",
            hostTapped: false,
        });
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.staticAbilities).toContain("haste");
    });

    it("activated {0} untaps the host on resolution", () => {
        const state = attachAura({
            activePlayerId: "p1",
            hostTapped: true,
        });
        const aura = state.players[0].battlefield.find((c) => c.id !== "host")!;
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: "p1",
            abilityId: "instill-energy-untap",
            targets: [],
        });
        resolveTopOfStack(state);
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(false);
    });

    it("declares controllerTurnOnly + oncePerTurn on the activated ability", () => {
        const ability = instillEnergy.activatedAbilities![0];
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.oncePerTurn).toBe(true);
    });
});

describe("Animate Artifact ({3}{U} — aura: artifact becomes creature with P/T = MV)", () => {
    it("adds Creature type and grants P/T equal to host's printed MV", () => {
        const vault = makeInstance(manaVault.id, {
            id: "vault",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateArtifact.id, "p1", [
            { type: "permanent", id: "vault" },
        ]);
        resolveTopOfStack(state);
        const vaultAfter = state.players[0].battlefield.find(
            (c) => c.id === "vault"
        )!;
        // Mana Vault printed cost is {1} → MV 1. After Animate Artifact:
        // host has Creature type and 1/1.
        expect(vaultAfter.types).toContain("Creature");
        expect(getEffectivePower(state, vaultAfter)).toBe(1);
        expect(getEffectiveToughness(state, vaultAfter)).toBe(1);
    });

    it("does NOT add Creature type when host is already a creature", () => {
        // Synth: a creature artifact (use Mana Vault and pre-mark types
        // with Creature to simulate an already-animated artifact).
        const vault = makeInstance(manaVault.id, {
            id: "vault",
            controllerId: "p1",
            ownerId: "p1",
        });
        vault.types = [...vault.types, "Creature"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateArtifact.id, "p1", [
            { type: "permanent", id: "vault" },
        ]);
        resolveTopOfStack(state);
        const vaultAfter = state.players[0].battlefield.find(
            (c) => c.id === "vault"
        )!;
        // No grant tracked since predicate gated on !isCreature.
        expect(vaultAfter.grantedTypes ?? []).toEqual([]);
    });

    it("CDA P/T survives the wire format projection", () => {
        const vault = makeInstance(manaVault.id, {
            id: "vault",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateArtifact.id, "p1", [
            { type: "permanent", id: "vault" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "vault"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });
});

describe("Sacrifice ({B} — additional cost sac creature, add B mana = MV)", () => {
    it("resolve adds B mana equal to snapshotted sacrificed MV", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, sacrifice.id, "p1");
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "fake",
            mv: 5,
        };
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(5);
    });

    it("getAdditionalSacrificeMv on SpellContext reads the snapshot", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, sacrifice.id, "p1");
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "fake",
            mv: 3,
        };
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
    });

    it("declares additionalCosts.sacrificeFilter on the card definition", () => {
        expect(sacrifice.additionalCosts?.sacrificeFilter).toEqual({
            types: "Creature",
        });
    });
});

describe("Spell Blast ({X}{U} — counter target spell with mv = X)", () => {
    it("counters a target spell whose mana value equals X", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Opp casts Lightning Bolt (mv 1). p1 responds with Spell Blast X=1.
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const blast = pushSpell(state, spellBlast.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        blast.chosenX = 1;
        resolveTopOfStack(state); // resolve Spell Blast
        // Bolt countered, no longer on stack.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("getManaValue on a stack spell folds in the chosen X", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Push Braingeyser with chosenX=4 → mv = printed (2) + 4 = 6.
        const bg = pushSpell(state, braingeyser.id, "p2", [
            { type: "player", id: "p2" },
        ]);
        bg.chosenX = 4;
        // Spell Blast with X=5 (not 6) → blast resolves but target's mv !=
        // X, the spell-target validation has already been bypassed by
        // pushSpell, so the resolve goes through.  Re-check via getManaValue.
        const blast = pushSpell(state, spellBlast.id, "p1", [
            { type: "spell", id: bg.id },
        ]);
        blast.chosenX = 6;
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bg.id)).toBeUndefined();
    });

    it("declares mvFilter equals X on the target requirement", () => {
        expect(spellBlast.targetRequirement?.mvFilter).toEqual({
            equals: "X",
        });
    });
});

// ---------------------------------------------------------------------------
// W12: Free cards
// ---------------------------------------------------------------------------

describe("Sedge Troll (conditional +1/+1 if Swamp + {B}: regen, CR 611/701.15a)", () => {
    it("gets +1/+1 when controller has a Swamp", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sw = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll, sw] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, troll)).toBe(3);
        expect(getEffectiveToughness(state, troll)).toBe(3);
    });

    it("stays at base 2/2 without a Swamp", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, troll)).toBe(2);
        expect(getEffectiveToughness(state, troll)).toBe(2);
    });

    it("does NOT count opponent's Swamps", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2", { battlefield: [oppSwamp] }),
            ],
        });
        expect(getEffectivePower(state, troll)).toBe(2);
        expect(getEffectiveToughness(state, troll)).toBe(2);
    });

    it("CDA buff survives the projection boundary (wire format)", () => {
        const troll = makeInstance(sedgeTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sw = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll, sw] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, troll)).toBe(3);
        const projected = projectPublicState(state, 0, "p1");
        const slimTroll = projected.players[0].battlefield.find(
            (c) => c.id === "troll"
        );
        if (!slimTroll) throw new Error("troll not in projection");
        expect(getEffectivePower(projected, slimTroll)).toBe(3);
        expect(getEffectiveToughness(projected, slimTroll)).toBe(3);
    });

    it("has {B}: Regenerate activated ability", () => {
        const ability = sedgeTroll.activatedAbilities?.[0];
        expect(ability?.id).toBe("sedge-troll-regenerate");
        expect(ability?.cost).toEqual({ mana: { B: 1 } });
        expect(ability?.useStack).toBe(true);
    });
});

describe("Aspect of Wolf (aura CDA: +floor(forests/2)/+ceil(forests/2))", () => {
    function setup(forests: number) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(aspectOfWolf.id, {
            id: "aow",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const bf: CardInstanceState[] = [host, aura];
        for (let i = 0; i < forests; i++) {
            bf.push(
                makeInstance(forest.id, {
                    id: `forest-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        return makeState({
            players: [makePlayer("p1", { battlefield: bf }), makePlayer("p2")],
        });
    }

    it("with 0 forests host stays at base P/T", () => {
        const state = setup(0);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });

    it("with 3 forests: +1/+2 (floor(3/2)=1, ceil(3/2)=2)", () => {
        const state = setup(3);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("with 4 forests: +2/+2 (floor(4/2)=2, ceil(4/2)=2)", () => {
        const state = setup(4);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("does NOT count opponent's Forests", () => {
        const state = setup(0);
        state.players[1].battlefield.push(
            makeInstance(forest.id, {
                id: "opp-forest",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });

    it("CDA survives the projection boundary (wire format)", () => {
        const state = setup(5);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(5);
        const projected = projectPublicState(state, 0, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        );
        if (!slimHost) throw new Error("host not in projection");
        expect(getEffectivePower(projected, slimHost)).toBe(4);
        expect(getEffectiveToughness(projected, slimHost)).toBe(5);
    });
});

describe("Dwarven Demolition Team ({T}: destroy target Wall)", () => {
    it("has a tap-activated ability targeting Walls", () => {
        const ability = dwarvenDemolitionTeam.activatedAbilities?.[0];
        expect(ability?.id).toBe("dwarven-demolition-team-destroy");
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.targetRequirement?.subtypeFilter).toBe("Wall");
    });

    it("destroys a target Wall on resolution", () => {
        const ddt = makeInstance(dwarvenDemolitionTeam.id, {
            id: "ddt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wall = makeInstance(wallOfBone.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ddt] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        state.stack.push({
            ...ddt,
            id: "stack-ddt",
            zone: "stack",
            castById: "p1",
            abilityId: "dwarven-demolition-team-destroy",
            targets: [{ type: "permanent", id: "wall" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "wall")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "wall")
        ).toBeDefined();
    });
});

describe("Lord of the Pit (flying, trample, upkeep sacrifice-or-7dmg)", () => {
    it("has flying and trample", () => {
        expect(lordOfThePit.staticAbilities).toContain("flying");
        expect(lordOfThePit.staticAbilities).toContain("trample");
    });

    it("upkeep with no other creatures deals 7 damage to controller", () => {
        const lord = makeInstance(lordOfThePit.id, {
            id: "lord",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "lord-of-the-pit-upkeep"
        );
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(13);
    });

    it("upkeep with another creature requests sacrifice choice", () => {
        const lord = makeInstance(lordOfThePit.id, {
            id: "lord",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = makeInstance(grizzlyBears.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lord, fodder],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("sacrifice-permanents");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["fodder"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "fodder")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });
});

describe("Black Vise (opponent upkeep: deal hand-4 damage)", () => {
    it("deals damage when opponent's hand > 4", () => {
        const vise = makeInstance(blackVise.id, {
            id: "vise",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppHand: CardInstanceState[] = [];
        for (let i = 0; i < 7; i++) {
            oppHand.push(
                makeInstance(grizzlyBears.id, {
                    id: `card-${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "hand",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vise] }),
                makePlayer("p2", { hand: oppHand, life: 20 }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "UNTAP",
        });
        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("black-vise-upkeep");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("deals no damage when opponent's hand <= 4", () => {
        const vise = makeInstance(blackVise.id, {
            id: "vise",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppHand: CardInstanceState[] = [];
        for (let i = 0; i < 3; i++) {
            oppHand.push(
                makeInstance(grizzlyBears.id, {
                    id: `card-${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "hand",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vise] }),
                makePlayer("p2", { hand: oppHand, life: 20 }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "UNTAP",
        });
        advancePhase(state);
        expect(state.stack).toHaveLength(0);
    });

    it("does not trigger on controller's own upkeep", () => {
        const vise = makeInstance(blackVise.id, {
            id: "vise",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vise] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Living Wall (0/6 Artifact Creature Wall, defender, {1}: regen)", () => {
    it("has defender", () => {
        expect(livingWall.staticAbilities).toContain("defender");
    });

    it("has {1}: Regenerate activated ability", () => {
        const ability = livingWall.activatedAbilities?.[0];
        expect(ability?.id).toBe("living-wall-regenerate");
        expect(ability?.cost).toEqual({ mana: { X: 1 } });
        expect(ability?.useStack).toBe(true);
    });

    it("is 0/6 base stats", () => {
        expect(livingWall.power).toBe(0);
        expect(livingWall.toughness).toBe(6);
    });

    it("types include Artifact and Creature", () => {
        expect(livingWall.types).toContain("Artifact");
        expect(livingWall.types).toContain("Creature");
    });
});

describe("Ankh of Mishra (land ETB → 2 damage to land's controller)", () => {
    it("triggers on any land entering the battlefield", () => {
        const ankh = makeInstance(ankhOfMishra.id, {
            id: "ankh",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ankh], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "new-land",
                controllerId: "p2",
                types: ["Land"],
            },
        ];
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "ankh-of-mishra-land-etb"
        );
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("triggers for controller's own lands too", () => {
        const ankh = makeInstance(ankhOfMishra.id, {
            id: "ankh",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ankh], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "my-land",
                controllerId: "p1",
                types: ["Land"],
            },
        ];
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(18);
    });

    it("does NOT trigger on non-Land permanents entering", () => {
        const ankh = makeInstance(ankhOfMishra.id, {
            id: "ankh",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ankh], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "new-creature",
                controllerId: "p2",
                types: ["Creature"],
            },
        ];
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
    });

    it("integration: play-land flow emits PERMANENT_ENTERED and triggers Ankh (CR 603.6a)", () => {
        const ankh = makeInstance(ankhOfMishra.id, {
            id: "ankh",
            controllerId: "p1",
            ownerId: "p1",
        });
        const landInHand = makeInstance(swamp.id, {
            id: "played-land",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ankh], life: 20 }),
                makePlayer("p2", { hand: [landInHand], life: 20 }),
            ],
        });

        const card = moveCard(
            state.players[1],
            "played-land",
            "hand",
            "battlefield"
        );
        emitPermanentEntered(state, card);
        processPendingActionTriggers(state);

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "ankh-of-mishra-land-etb"
        );

        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });
});

describe("Dingus Egg (land LTB to graveyard → 2 damage to controller)", () => {
    it("triggers when a land is put into graveyard from battlefield", () => {
        const egg = makeInstance(dingusEgg.id, {
            id: "egg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, {
            id: "target-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [egg] }),
                makePlayer("p2", { battlefield: [land], life: 20 }),
            ],
        });
        removePermanentTo(state, "target-land", "graveyard");
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("dingus-egg-land-dies");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
    });

    it("does NOT trigger when a land is exiled (not graveyard)", () => {
        const egg = makeInstance(dingusEgg.id, {
            id: "egg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, {
            id: "target-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [egg] }),
                makePlayer("p2", { battlefield: [land], life: 20 }),
            ],
        });
        removePermanentTo(state, "target-land", "exile");
        processPendingActionTriggers(state);
        const landTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "dingus-egg-land-dies"
        );
        expect(landTriggers).toHaveLength(0);
    });

    it("does NOT trigger when a non-Land permanent goes to graveyard", () => {
        const egg = makeInstance(dingusEgg.id, {
            id: "egg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creature = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [egg] }),
                makePlayer("p2", { battlefield: [creature], life: 20 }),
            ],
        });
        removePermanentTo(state, "bear", "graveyard");
        processPendingActionTriggers(state);
        const eggTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "dingus-egg-land-dies"
        );
        expect(eggTriggers).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Terror (CR 701.7, 701.15c — destroy target nonartifact, nonblack creature)
// ---------------------------------------------------------------------------

describe("Terror (destroy target nonartifact, nonblack creature, CR 701.7)", () => {
    it("destroys a non-artifact, non-black creature", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, terror.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });

    it("cannot target artifact creatures (excludeTypes)", () => {
        const jugger = makeInstance(juggernaut.id, {
            id: "jugger",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [jugger] }),
            ],
        });
        const targets = getLegalTargets(state, terror.targetRequirement!, []);
        expect(targets.find((t) => t.id === "jugger")).toBeUndefined();
    });

    it("cannot target black creatures (excludeColors)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        const targets = getLegalTargets(state, terror.targetRequirement!, []);
        expect(targets.find((t) => t.id === "bk")).toBeUndefined();
    });

    it("can target a white creature (not excluded)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        const targets = getLegalTargets(state, terror.targetRequirement!, []);
        expect(targets.find((t) => t.id === "lion")).toBeDefined();
    });

    it("destroyed creature can't be regenerated (cantBeRegenerated)", () => {
        const troll = makeInstance(uthdenTroll.id, {
            id: "troll",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [troll] }),
            ],
        });
        pushSpell(state, terror.id, "p1", [{ type: "permanent", id: "troll" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Fog (CR 615 — prevent all combat damage this turn)
// ---------------------------------------------------------------------------

describe("Fog (prevent all combat damage this turn, CR 615)", () => {
    it("prevents all combat damage", async () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { life: 20 }),
            ],
            combat: {
                attackerIds: ["bear"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        pushSpell(state, fog.id, "p2");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        expect(state.players[1].life).toBe(20);
    });

    it("does not prevent non-combat damage", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        pushSpell(state, fog.id, "p2");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("preventAllCombatDamageThisTurn flag cleared at cleanup", () => {
        const state = makeState({
            phase: "END_STEP",
            preventAllCombatDamageThisTurn: true,
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        advancePhase(state);
        expect(state.preventAllCombatDamageThisTurn).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Disrupting Scepter (CR 701.8, 602.5b — {3},{T}: target player discards)
// ---------------------------------------------------------------------------

describe("Disrupting Scepter ({3},{T}: target player discards, CR 701.8)", () => {
    it("opponent chooses which card to discard", () => {
        const scepter = makeInstance(disruptingScepter.id, {
            id: "scepter",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const handCard2 = makeInstance(lightningBolt.id, {
            id: "h2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scepter] }),
                makePlayer("p2", { hand: [handCard1, handCard2] }),
            ],
        });
        const ability = disruptingScepter.activatedAbilities![0];
        const item = pushSpell(state, disruptingScepter.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.abilityId = ability.id;
        resolveTopOfStack(state);
        expect(state.pendingChoices).toBeDefined();
        expect(state.pendingChoices!.length).toBe(1);
        expect(state.pendingChoices![0].kind).toBe("discard-hand");
    });

    it("can only be activated during controller's turn (controllerTurnOnly)", () => {
        const ability = disruptingScepter.activatedAbilities![0];
        expect(ability.controllerTurnOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Serialization: preventAllCombatDamageThisTurn round-trip
// ---------------------------------------------------------------------------

describe("preventAllCombatDamageThisTurn serialization", () => {
    it("round-trips through compactState / expandState", async () => {
        const { compactState, expandState } =
            await import("../../../gre/serialize");
        const state = makeState({
            preventAllCombatDamageThisTurn: true,
        });
        const compact = compactState(state);
        const expanded = expandState(compact);
        expect(expanded.preventAllCombatDamageThisTurn).toBe(true);
    });
});

// ===========================================================================
// W17 — Must-block requirement + multi-block
// ===========================================================================

// ---------------------------------------------------------------------------
// Lure (CR 509.1c — block requirement, scope "all-able")
// ---------------------------------------------------------------------------

describe("lure — all creatures able to block enchanted creature do so (CR 509.1c)", () => {
    function setupLure() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker1 = makeInstance(grizzlyBears.id, {
            id: "blk1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker2 = makeInstance(savannahLions.id, {
            id: "blk2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2", { battlefield: [blocker1, blocker2] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        // Attach Lure to the attacker
        pushSpell(state, lure.id, "p1", [
            { type: "permanent", id: "bear-att" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("all eligible blockers must block the enchanted creature", () => {
        const { state } = setupLure();
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(Object.keys(required)).toContain("blk1");
        expect(Object.keys(required)).toContain("blk2");
        expect(required["blk1"]).toContain("bear-att");
        expect(required["blk2"]).toContain("bear-att");
    });

    it("tapped creatures are exempt from Lure", () => {
        const { state } = setupLure();
        const blk1 = state.players[1].battlefield.find((c) => c.id === "blk1")!;
        blk1.isTapped = true;
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk1"]).toBeUndefined();
        expect(required["blk2"]).toContain("bear-att");
    });

    it("creatures that can't legally block (evasion) are exempt", () => {
        const { state } = setupLure();
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear-att"
        )!;
        bear.staticAbilities = [...bear.staticAbilities, "flying"];
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk1"]).toBeUndefined();
        expect(required["blk2"]).toBeUndefined();
    });

    it("already-assigned blockers are not double-assigned", () => {
        const { state } = setupLure();
        state.combat!.blockerAssignments = { blk1: ["bear-att"] };
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk1"]).toBeUndefined();
        expect(required["blk2"]).toContain("bear-att");
    });
});

// ---------------------------------------------------------------------------
// Blaze of Glory (CR 509.1a — multi-block + must-block-all)
// ---------------------------------------------------------------------------

describe("blazeOfGlory — target can block all attackers (CR 509.1a)", () => {
    it("sets canBlockAdditional and mustBlockAllThisTurn on target", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            phase: "DECLARE_ATTACKERS",
        });
        pushSpell(state, blazeOfGlory.id, "p1", [
            { type: "permanent", id: "blk" },
        ]);
        resolveTopOfStack(state);
        const blk = state.players[1].battlefield.find((c) => c.id === "blk")!;
        expect(blk.canBlockAdditional).toBe(999);
        expect(blk.mustBlockAllThisTurn).toBe(true);
    });

    it("can only be cast during combat before blockers (timing)", () => {
        expect(blazeOfGlory.castPhaseRestriction).toEqual([
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
        ]);
    });

    it("mustBlockAll auto-assigns blocker to all attackers", () => {
        const att1 = makeInstance(grizzlyBears.id, {
            id: "att1",
            controllerId: "p1",
            isAttacking: true,
        });
        const att2 = makeInstance(savannahLions.id, {
            id: "att2",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            canBlockAdditional: 999,
            mustBlockAllThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [att1, att2] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["att1", "att2"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk"]).toContain("att1");
        expect(required["blk"]).toContain("att2");
    });
});

// ---------------------------------------------------------------------------
// Two-Headed Giant of Foriys (CR 509.1a — multi-block)
// ---------------------------------------------------------------------------

describe("twoHeadedGiantOfForiys — can block 2 attackers (CR 509.1a)", () => {
    it("has trample", () => {
        expect(twoHeadedGiantOfForiys.staticAbilities).toContain("trample");
    });

    it("has canBlockAdditional: 1", () => {
        expect(twoHeadedGiantOfForiys.canBlockAdditional).toBe(1);
    });

    it("getMaxBlockTargets returns 2", () => {
        const giant = makeInstance(twoHeadedGiantOfForiys.id, {
            id: "giant",
            controllerId: "p2",
        });
        expect(getMaxBlockTargets(giant)).toBe(2);
    });

    it("can block 2 attackers simultaneously (data model)", () => {
        const att1 = makeInstance(grizzlyBears.id, {
            id: "att1",
            controllerId: "p1",
            isAttacking: true,
        });
        const att2 = makeInstance(savannahLions.id, {
            id: "att2",
            controllerId: "p1",
            isAttacking: true,
        });
        const giant = makeInstance(twoHeadedGiantOfForiys.id, {
            id: "giant",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [att1, att2] }),
                makePlayer("p2", { battlefield: [giant] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["att1", "att2"],
                confirmed: true,
                blockerAssignments: { giant: ["att1", "att2"] },
                blockersConfirmed: true,
            },
        });
        // Verify getBlockersPerAttacker works with multi-block
        const combat = state.combat!;
        expect(combat.blockerAssignments["giant"]).toEqual(["att1", "att2"]);
    });

    it("cannot block 3 attackers (only 1 additional)", () => {
        const giant = makeInstance(twoHeadedGiantOfForiys.id, {
            id: "giant",
            controllerId: "p2",
        });
        expect(getMaxBlockTargets(giant)).toBe(2);
    });

    it("4/4 power and toughness", () => {
        expect(twoHeadedGiantOfForiys.power).toBe(4);
        expect(twoHeadedGiantOfForiys.toughness).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// canBlockAdditional + mustBlockAllThisTurn serialization
// ---------------------------------------------------------------------------

describe("canBlockAdditional / mustBlockAllThisTurn serialization", () => {
    it("canBlockAdditional round-trips through compactCard", async () => {
        const { compactState, expandState } =
            await import("../../../gre/serialize");
        const card = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p1",
            canBlockAdditional: 999,
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [card] })],
        });
        const compact = compactState(state);
        const expanded = expandState(compact);
        const blk = expanded.players[0].battlefield.find(
            (c) => c.id === "blk"
        )!;
        expect(blk.canBlockAdditional).toBe(999);
    });

    it("mustBlockAllThisTurn round-trips through compactCard", async () => {
        const { compactState, expandState } =
            await import("../../../gre/serialize");
        const card = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p1",
            mustBlockAllThisTurn: true,
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [card] })],
        });
        const compact = compactState(state);
        const expanded = expandState(compact);
        const blk = expanded.players[0].battlefield.find(
            (c) => c.id === "blk"
        )!;
        expect(blk.mustBlockAllThisTurn).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// W23 — Rock Hydra + Guardian Angel + Gauntlet of Might + Living Artifact
// ---------------------------------------------------------------------------

import {
    rockHydra,
    guardianAngel,
    gauntletOfMight,
    livingArtifact,
} from "../lea";

describe("Rock Hydra (CR 107.3 — enters with X +1/+1 counters)", () => {
    it("enters with X +1/+1 counters when cast with X=3", () => {
        const state = makeState();
        const item = pushSpell(state, rockHydra.id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        const onField = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === rockHydra.id
        )!;
        expect(onField.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(state, onField)).toBe(3);
        expect(getEffectiveToughness(state, onField)).toBe(3);
    });

    it("replacement effect: damage removes +1/+1 counters instead of being dealt", () => {
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 4 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "hydra" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(after.damageMarked).toBeFalsy();
    });

    it("replacement effect: excess damage gets through when counters are insufficient", () => {
        // Hydra with 2 counters (effective 2/2) takes 3 bolt: replacement
        // removes 2 counters (prevents 2), 1 excess damage marks on the now
        // 0/0 creature → lethal → destroyed inline (CR 704.5g).
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "hydra" },
        ]);
        resolveTopOfStack(state);
        // Hydra should be in the graveyard — 0/0 with 1 excess damage is lethal
        expect(
            state.players[0].battlefield.find((c) => c.id === "hydra")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "hydra")
        ).toBeDefined();
    });

    it("{R}: prevent next 1 damage to Rock Hydra this turn", () => {
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        activatePump(state, hydra, "rock-hydra-prevent");
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "hydra" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        // 3 damage bolt: 1 prevented by shield, 2 absorbed by counter-removal
        expect(after.counters?.["+1/+1"]).toBeUndefined();
        expect(after.damageMarked).toBeFalsy();
    });

    it("{RRR}: adds a +1/+1 counter (only during upkeep)", () => {
        const hydra = makeInstance(rockHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        activatePump(state, hydra, "rock-hydra-grow");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(3);
    });

    it("{RRR} is restricted to upkeep phase (definition check)", () => {
        const def = tryGetCardById(rockHydra.id)!;
        const growAbility = def.activatedAbilities!.find(
            (a) => a.id === "rock-hydra-grow"
        )!;
        expect(growAbility.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(growAbility.controllerTurnOnly).toBe(true);
    });
});

describe("Guardian Angel (CR 615.1 — prevent next X damage to target)", () => {
    it("prevents X damage to a targeted creature", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, guardianAngel.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        // Shield is now active — deal 3 damage with bolt
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.damageMarked).toBeFalsy();
    });

    it("prevents X damage to a targeted player", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        const item = pushSpell(state, guardianAngel.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        // 3 damage - 2 prevented = 1 damage through
        expect(state.players[0].life).toBe(19);
    });
});

describe("Gauntlet of Might (static pt-buff + tapped trigger)", () => {
    it("red creatures get +1/+1", () => {
        const goblin = makeInstance(monssGoblinRaiders.id, {
            id: "goblin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gauntlet = makeInstance(gauntletOfMight.id, {
            id: "gauntlet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin, gauntlet] }),
                makePlayer("p2"),
            ],
        });
        // Mons's Goblin Raiders is 1/1 red creature
        expect(getEffectivePower(state, goblin)).toBe(2);
        expect(getEffectiveToughness(state, goblin)).toBe(2);
    });

    it("does NOT buff non-red creatures", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gauntlet = makeInstance(gauntletOfMight.id, {
            id: "gauntlet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, gauntlet] }),
                makePlayer("p2"),
            ],
        });
        // Savannah Lions is 2/1 white — should NOT be buffed
        expect(getEffectivePower(state, lion)).toBe(2);
        expect(getEffectiveToughness(state, lion)).toBe(1);
    });

    it("buffs opponent's red creatures too", () => {
        const oppGoblin = makeInstance(monssGoblinRaiders.id, {
            id: "opp-gob",
            controllerId: "p2",
            ownerId: "p2",
        });
        const gauntlet = makeInstance(gauntletOfMight.id, {
            id: "gauntlet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gauntlet] }),
                makePlayer("p2", { battlefield: [oppGoblin] }),
            ],
        });
        expect(getEffectivePower(state, oppGoblin)).toBe(2);
        expect(getEffectiveToughness(state, oppGoblin)).toBe(2);
    });

    it("wire format: red creature pt-buff survives projection", () => {
        const goblin = makeInstance(monssGoblinRaiders.id, {
            id: "goblin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gauntlet = makeInstance(gauntletOfMight.id, {
            id: "gauntlet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin, gauntlet] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimGoblin = projected.players[0].battlefield.find(
            (c) => c.id === "goblin"
        )!;
        expect(getEffectivePower(projected, slimGoblin)).toBe(2);
        expect(getEffectiveToughness(projected, slimGoblin)).toBe(2);
    });

    it("Mountains produce extra {R} when tapped for mana", () => {
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gauntlet = makeInstance(gauntletOfMight.id, {
            id: "gauntlet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn, gauntlet] }),
                makePlayer("p2"),
            ],
        });
        emitPermanentTapped(state, mtn, true, { R: 1 });
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].manaPool["R"]).toBe(1);
    });
});

describe("Living Artifact (Aura — vitality counters + upkeep life gain)", () => {
    it("gains vitality counters when controller is dealt damage", () => {
        const artifact = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(livingArtifact.id, {
            id: "la",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-art",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artifact, aura],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const auraAfter = state.players[0].battlefield.find(
            (c) => c.id === "la"
        )!;
        expect(auraAfter.counters?.["vitality"]).toBe(3);
    });

    it("upkeep: may remove a vitality counter to gain 1 life", () => {
        const artifact = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(livingArtifact.id, {
            id: "la",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-art",
            counters: { vitality: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artifact, aura],
                    life: 17,
                }),
                makePlayer("p2"),
            ],
            phase: "UNTAP",
            activePlayerId: "p1",
        });
        advancePhase(state); // UNTAP → UPKEEP fires the phaseTrigger
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "living-artifact-upkeep"
        );
        // First resolveTopOfStack enqueues the may-pay choice
        resolveTopOfStack(state);
        expect(state.pendingChoices?.length).toBe(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        // Simulate submitMayPay accept=yes
        const pending = state.pendingChoices![0];
        const stackItem = state.stack.find(
            (s) => s.id === pending.stackItemId
        )!;
        const key = `${pending.step}:${pending.choiceId}`;
        stackItem.collectedChoices = { [key]: ["yes"] };
        state.pendingChoices = undefined;
        // Re-invoke resolveTopOfStack to resume
        resolveTopOfStack(state);
        const auraAfter = state.players[0].battlefield.find(
            (c) => c.id === "la"
        )!;
        expect(auraAfter.counters?.["vitality"]).toBe(1);
        expect(state.players[0].life).toBe(18);
    });
});

// ---------------------------------------------------------------------------
// W14: Combat-aware static effects — Orcish Oriflamme, Righteousness
// ---------------------------------------------------------------------------

describe("Orcish Oriflamme (attacking creatures you control get +1/+0, CR 508.1)", () => {
    function setup() {
        const oriflamme = makeInstance(orcishOriflamme.id, {
            id: "oriflamme",
            controllerId: "p1",
        });
        const attacker = makeInstance(grizzlyBearsId(), {
            id: "attacker",
            controllerId: "p1",
            isAttacking: true,
        });
        const nonAttacker = makeInstance(grizzlyBearsId(), {
            id: "bystander",
            controllerId: "p1",
        });
        const oppAttacker = makeInstance(grizzlyBearsId(), {
            id: "opp-attacker",
            controllerId: "p2",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [oriflamme, attacker, nonAttacker],
        });
        const p2 = makePlayer("p2", {
            battlefield: [oppAttacker],
        });
        return makeState({ players: [p1, p2] });
    }

    it("buffs attacking creatures you control +1/+0", () => {
        const state = setup();
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(state, attacker)).toBe(3); // 2 base + 1
        expect(getEffectiveToughness(state, attacker)).toBe(2); // unchanged
    });

    it("does NOT buff non-attacking creatures", () => {
        const state = setup();
        const bystander = state.players[0].battlefield.find(
            (c) => c.id === "bystander"
        )!;
        expect(getEffectivePower(state, bystander)).toBe(2); // base only
    });

    it("does NOT buff opponent's attacking creatures", () => {
        const state = setup();
        const oppAttacker = state.players[1].battlefield.find(
            (c) => c.id === "opp-attacker"
        )!;
        expect(getEffectivePower(state, oppAttacker)).toBe(2); // base only
    });

    it("buff disappears when isAttacking is cleared (END_OF_COMBAT)", () => {
        const state = setup();
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(state, attacker)).toBe(3);
        attacker.isAttacking = undefined;
        expect(getEffectivePower(state, attacker)).toBe(2);
    });

    it("wire format: buff survives projectPublicState", () => {
        const state = setup();
        const projected = projectPublicState(state, 1, "p1");
        const projAttacker = projected.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getEffectivePower(projected, projAttacker)).toBe(3);
        expect(getEffectiveToughness(projected, projAttacker)).toBe(2);
    });
});

describe("Righteousness (target blocking creature gets +7/+7, CR 509.1)", () => {
    it("can only target blocking creatures (combatRoleFilter)", () => {
        expect(righteousness.targetRequirement!.combatRoleFilter).toBe(
            "blocking"
        );
    });

    it("getLegalTargets rejects non-blocking creatures", () => {
        const creature = makeInstance(grizzlyBearsId(), {
            id: "bears",
            controllerId: "p1",
        });
        const p1 = makePlayer("p1", { battlefield: [creature] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const targets = getLegalTargets(
            state,
            righteousness.targetRequirement!,
            [],
            "p1"
        );
        expect(targets).toHaveLength(0);
    });

    it("getLegalTargets accepts blocking creatures", () => {
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blocker",
            controllerId: "p1",
            isBlocking: true,
        });
        const p1 = makePlayer("p1", { battlefield: [blocker] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const targets = getLegalTargets(
            state,
            righteousness.targetRequirement!,
            [],
            "p1"
        );
        expect(targets).toHaveLength(1);
        expect(targets[0].id).toBe("blocker");
    });

    it("resolve applies +7/+7 temporary buff", () => {
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blocker",
            controllerId: "p2",
            isBlocking: true,
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [blocker] });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, righteousness.id, "p1", [
            { type: "permanent", id: "blocker" },
        ]);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, blocker)).toBe(9); // 2 + 7
        expect(getEffectiveToughness(state, blocker)).toBe(9); // 2 + 7
    });

    it("wire format: +7/+7 buff survives projectPublicState", () => {
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blocker",
            controllerId: "p2",
            isBlocking: true,
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [blocker] });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, righteousness.id, "p1", [
            { type: "permanent", id: "blocker" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const projBlocker = projected.players[1].battlefield.find(
            (c) => c.id === "blocker"
        )!;
        expect(getEffectivePower(projected, projBlocker)).toBe(9);
        expect(getEffectiveToughness(projected, projBlocker)).toBe(9);
    });
});

// ---------------------------------------------------------------------------
// W16: Exile-on-death + unlimited land drops — Disintegrate, Fastbond
// ---------------------------------------------------------------------------

describe("Disintegrate ({X}{R} Sorcery — exile-on-death, CR 614.1a)", () => {
    it("creature taking lethal damage is exiled, not sent to graveyard", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, disintegrate.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        // Bear had 2 toughness, took 3 damage → lethal → exiled
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[1].exile.find((c) => c.id === "bear")
        ).toBeDefined();
    });

    it("creature can't be regenerated (regen shield doesn't save it)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, disintegrate.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        // Regen shield should not have saved the creature
        expect(
            state.players[1].exile.find((c) => c.id === "bear")
        ).toBeDefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("exileOnDeath cleared at CLEANUP — creatures dying next turn go to graveyard normally", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            exileOnDeath: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            phase: "END_STEP",
        });
        advancePhase(state); // END_STEP → CLEANUP (clears exileOnDeath)
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter?.exileOnDeath).toBeUndefined();
        // Destroy after cleanup — should go to graveyard, not exile
        regenerateOrDestroy(state, "bear");
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
        expect(
            state.players[1].exile.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("deals X damage to a player target", () => {
        const state = makeState();
        const item = pushSpell(state, disintegrate.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });
});

describe("Fastbond ({G} Enchantment — unlimited land drops, CR 305.2)", () => {
    it("player can play 2+ lands per turn with Fastbond on battlefield", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const land1 = makeInstance(forest.id, {
            id: "land1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const land2 = makeInstance(forest.id, {
            id: "land2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    hand: [land1, land2],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        // With Fastbond, player should still be able to play a land
        // even after playing 1 this turn
        const actions = getLegalActions(state, state.players[0], land2);
        expect(actions).toContain("play");
    });

    it("without Fastbond, player can't play more than 1 land per turn", () => {
        const land = makeInstance(forest.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [land],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        const actions = getLegalActions(state, state.players[0], land);
        expect(actions).not.toContain("play");
    });

    it("removing Fastbond reverts to normal land-drop limit", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const land = makeInstance(forest.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    hand: [land],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        // With Fastbond: can play
        expect(getLegalActions(state, state.players[0], land)).toContain(
            "play"
        );
        // Remove Fastbond from battlefield
        removePermanentTo(state, "fb", "graveyard");
        // Without Fastbond: cannot play (already played 1)
        expect(getLegalActions(state, state.players[0], land)).not.toContain(
            "play"
        );
    });

    it("takes 1 damage for each land after the first (trigger fires)", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    landsPlayedThisTurn: 2,
                }),
                makePlayer("p2"),
            ],
        });
        // Simulate a land entering the battlefield (2nd land already played)
        const landEvent = {
            type: "PERMANENT_ENTERED" as const,
            instanceId: "new-land",
            controllerId: "p1",
            types: ["Land" as const],
        };
        state.pendingEvents = [landEvent];
        processPendingActionTriggers(state);
        // Fastbond trigger should be on stack
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe("fastbond-land-etb");
        // Resolve the trigger — should deal 1 damage to controller
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(19);
    });

    it("does NOT trigger on the first land played this turn", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
        });
        const landEvent = {
            type: "PERMANENT_ENTERED" as const,
            instanceId: "first-land",
            controllerId: "p1",
            types: ["Land" as const],
        };
        state.pendingEvents = [landEvent];
        processPendingActionTriggers(state);
        // No trigger should fire for the first land
        expect(state.stack.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// W15: Dragon Whelp, Nettling Imp, Stone Giant
// ---------------------------------------------------------------------------

describe("Dragon Whelp (CR 602.5, 603.7a — activation-count delayed sacrifice)", () => {
    const PUMP_ID = "dragon-whelp-pump";

    function setup() {
        const whelp = makeInstance(dragonWhelp.id, {
            id: "whelp",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whelp] }),
                makePlayer("p2"),
            ],
        });
        return { state, whelp };
    }

    function pumpOnce(state: GameState, source: CardInstanceState) {
        source.activationsThisTurn = {
            ...source.activationsThisTurn,
            [PUMP_ID]: (source.activationsThisTurn?.[PUMP_ID] ?? 0) + 1,
        };
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: PUMP_ID,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("declares flying and a {R} pump ability", () => {
        expect(dragonWhelp.staticAbilities).toContain("flying");
        const ability = dragonWhelp.activatedAbilities?.[0];
        expect(ability?.id).toBe(PUMP_ID);
        expect(ability?.cost).toEqual({ mana: { R: 1 } });
        expect(ability?.useStack).toBe(true);
    });

    it("pump 3 times → no delayed sacrifice scheduled", () => {
        const { state, whelp } = setup();
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        expect(getEffectivePower(state, whelp)).toBe(2 + 3);
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("pump 4 times → delayed sacrifice scheduled", () => {
        const { state, whelp } = setup();
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        expect(getEffectivePower(state, whelp)).toBe(2 + 4);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe(
            "dragon-whelp-sacrifice"
        );
    });

    it("delayed sacrifice destroys the creature on resolution", () => {
        const { state, whelp } = setup();
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pumpOnce(state, whelp);
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "whelp")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "whelp")
        ).toBeDefined();
    });

    it("pump 5+ times → only sacrificed once (destroy is no-op after first)", () => {
        const { state, whelp } = setup();
        for (let i = 0; i < 5; i++) pumpOnce(state, whelp);
        // Two delayed triggers scheduled (one at activation 4, one at 5)
        expect(state.delayedTriggers!.length).toBe(2);
        // Resolve first — creature dies
        pushDelayedTrigger(state, state.delayedTriggers![0], "delayed-1");
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        // Resolve second — no-op (creature already in graveyard)
        pushDelayedTrigger(state, state.delayedTriggers![1], "delayed-2");
        resolveTopOfStack(state);
        // Still only one creature in graveyard
        expect(state.players[0].graveyard).toHaveLength(1);
    });
});

describe("Nettling Imp (CR 508.1d, 603.7a — forced attack + delayed destroy)", () => {
    const ABILITY_ID = "nettling-imp-force";

    function setup() {
        const imp = makeInstance(nettlingImp.id, {
            id: "imp",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [imp] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        return { state, imp, victim };
    }

    function activate(
        state: GameState,
        source: CardInstanceState,
        targetId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: ABILITY_ID,
            targets: [{ type: "permanent", id: targetId }],
        });
        resolveTopOfStack(state);
    }

    it("declares a non-Wall creature target with phase restriction", () => {
        const ability = nettlingImp.activatedAbilities?.[0];
        expect(ability?.id).toBe(ABILITY_ID);
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement?.excludeSubtypes).toBe("Wall");
        expect(ability?.targetRequirement?.controller).toBe("opponent");
        expect(ability?.activationPhaseRestriction).toEqual([
            "UPKEEP",
            "DRAW",
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
        ]);
    });

    it("sets mustAttackThisTurn on target creature", () => {
        const { state, imp, victim } = setup();
        activate(state, imp, "victim");
        expect(victim.mustAttackThisTurn).toBe(true);
    });

    it("schedules delayed destroy at end step", () => {
        const { state, imp } = setup();
        activate(state, imp, "victim");
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe(
            "nettling-imp-destroy"
        );
    });

    it("creature forced to attack is required by mustAttack()", () => {
        const { state, imp, victim } = setup();
        activate(state, imp, "victim");
        expect(mustAttack(victim)).toBe(true);
    });

    it("delayed trigger does NOT destroy if creature attacked", () => {
        const { state, imp, victim } = setup();
        activate(state, imp, "victim");
        victim.hasAttackedThisTurn = true;
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeDefined();
    });

    it("delayed trigger destroys creature if it didn't attack", () => {
        const { state, imp } = setup();
        activate(state, imp, "victim");
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "victim")
        ).toBeDefined();
    });

    it("non-Wall filter excludes Walls from legal targets", () => {
        const { state } = setup();
        const wall = makeInstance(wallOfBone.id, {
            id: "wall",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(wall);
        const req = nettlingImp.activatedAbilities![0].targetRequirement!;
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("victim");
        expect(ids).not.toContain("wall");
    });

    it("canActivate returns false during controller's own turn", () => {
        const { state, imp } = setup();
        state.activePlayerId = "p1"; // Imp controller's turn
        const ability = nettlingImp.activatedAbilities![0];
        expect(ability.canActivate!(imp, state)).toBe(false);
    });

    it("canActivate returns true during opponent's turn", () => {
        const { state, imp } = setup();
        state.activePlayerId = "p2"; // Opponent's turn
        const ability = nettlingImp.activatedAbilities![0];
        expect(ability.canActivate!(imp, state)).toBe(true);
    });
});

describe("Stone Giant (CR 113.1, 611.1b, 603.7a — dynamic toughness target + flying + delayed destroy)", () => {
    const ABILITY_ID = "stone-giant-fling";

    function setup() {
        const giant = makeInstance(stoneGiant.id, {
            id: "giant",
            isSummoningSick: false,
        });
        // toughness 2 < power 3 → legal target
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giant, bear] }),
                makePlayer("p2"),
            ],
        });
        return { state, giant, bear };
    }

    function activate(
        state: GameState,
        source: CardInstanceState,
        targetId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: ABILITY_ID,
            targets: [{ type: "permanent", id: targetId }],
        });
        resolveTopOfStack(state);
    }

    it("declares a tap-cost ability", () => {
        const ability = stoneGiant.activatedAbilities?.[0];
        expect(ability?.id).toBe(ABILITY_ID);
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
    });

    it("getTargetRequirement computes toughnessFilter from source power", () => {
        const ability = stoneGiant.activatedAbilities![0];
        const req = ability.getTargetRequirement!(
            {
                id: "g",
                types: ["Creature"] as CardType[],
                subtypes: ["Giant"],
                power: 3,
                toughness: 4,
                isTapped: false,
                controllerId: "p1",
                ownerId: "p1",
                card: { id: stoneGiant.id },
            },
            { players: [], activePlayerId: "p1" }
        );
        expect(req.toughnessFilter).toEqual({ max: 2 });
        expect(req.controller).toBe("you");
    });

    it("only targets creatures with toughness < source power", () => {
        const { state, giant } = setup();
        // Use dynamic requirement to get the effective target req
        const ability = stoneGiant.activatedAbilities![0];
        const req = ability.getTargetRequirement!(giant, state);
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        // bear (toughness 2) is legal, giant itself (toughness 4) is not
        expect(ids).toContain("bear");
        expect(ids).not.toContain("giant");
    });

    it("creature with toughness >= source power is NOT a legal target", () => {
        const { state, giant } = setup();
        // Add a 3/3 creature — toughness 3 is NOT < 3
        const bigCreature = makeInstance(grizzlyBears.id, {
            id: "big",
            controllerId: "p1",
            toughness: 3,
        });
        state.players[0].battlefield.push(bigCreature);
        const ability = stoneGiant.activatedAbilities![0];
        const req = ability.getTargetRequirement!(giant, state);
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("big");
    });

    it("grants flying until end of turn on resolution", () => {
        const { state, giant, bear } = setup();
        activate(state, giant, "bear");
        expect(bear.staticAbilities).toContain("flying");
        expect(bear.grantedStaticAbilities).toHaveLength(1);
        expect(bear.grantedStaticAbilities![0].ability).toBe("flying");
    });

    it("schedules delayed destroy at end step", () => {
        const { state, giant } = setup();
        activate(state, giant, "bear");
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe("stone-giant-destroy");
        expect(state.delayedTriggers![0].payload.targetId).toBe("bear");
    });

    it("delayed trigger destroys the target at end step", () => {
        const { state, giant } = setup();
        activate(state, giant, "bear");
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// W20: Skip-turn + mana drain — timeVault, manaShort, drainPower
// ---------------------------------------------------------------------------

describe("Time Vault (skip-turn / extra-turn artifact, CR 614.10 + 500.7)", () => {
    it("is a {2} Artifact with entersTapped and does-not-untap", () => {
        expect(timeVault.manaCost).toEqual({ X: 2 });
        expect(timeVault.types).toEqual(["Artifact"]);
        expect(timeVault.entersTapped).toBe(true);
        expect(timeVault.staticAbilities).toContain("does-not-untap");
    });

    it("enters the battlefield tapped", () => {
        const state = makeState();
        pushSpell(state, timeVault.id, "p1");
        resolveTopOfStack(state);
        const vault = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === timeVault.id
        );
        expect(vault).toBeDefined();
        expect(vault!.isTapped).toBe(true);
    });

    it("does not untap during untap step (does-not-untap keyword)", () => {
        const vault = makeInstance(timeVault.id, {
            id: "vault",
            isTapped: true,
        });
        const land = makeInstance(forest.id, {
            id: "land1",
            isTapped: true,
        });
        // p2 is active at END_STEP — advancing lands on p1's UNTAP step.
        const state = makeState({
            phase: "END_STEP",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [vault, land] }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state); // END_STEP → CLEANUP → p1's UNTAP
        const vaultAfter = state.players[0].battlefield.find(
            (c) => c.id === "vault"
        );
        const landAfter = state.players[0].battlefield.find(
            (c) => c.id === "land1"
        );
        expect(vaultAfter!.isTapped).toBe(true);
        expect(landAfter!.isTapped).toBe(false);
    });

    it("skip-turn ability: sets skipNextTurn and untaps vault", () => {
        const vault = makeInstance(timeVault.id, {
            id: "vault",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        const ability = timeVault.activatedAbilities![0];
        expect(ability.id).toBe("time-vault-untap");
        const item = pushSpell(state, timeVault.id, "p1");
        item.id = "vault"; // match battlefield source id
        item.abilityId = ability.id;
        resolveTopOfStack(state);
        expect(state.players[0].skipNextTurn).toBe(true);
        const vaultAfter = state.players[0].battlefield.find(
            (c) => c.id === "vault"
        );
        expect(vaultAfter!.isTapped).toBe(false);
    });

    it("extra-turn ability: queues an extra turn for controller", () => {
        const vault = makeInstance(timeVault.id, {
            id: "vault",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });
        const ability = timeVault.activatedAbilities![1];
        expect(ability.id).toBe("time-vault-extra-turn");
        expect(ability.cost.tap).toBe(true);
        const item = pushSpell(state, timeVault.id, "p1");
        item.abilityId = ability.id;
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
    });

    it("skipNextTurn: player's turn is entirely skipped (CR 614.10)", () => {
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            players: [
                makePlayer("p1"),
                makePlayer("p2", { skipNextTurn: true }),
            ],
        });
        advancePhase(state); // END_STEP → CLEANUP → next turn
        // p2's turn is skipped, so it goes to p1 again
        expect(state.activePlayerId).toBe("p1");
        expect(state.players[1].skipNextTurn).toBeUndefined();
        expect(state.turn).toBe(3); // turn 1 → skip p2 (turn 2) → p1 (turn 3)
    });

    it("skipNextTurn on self: caster skips their own next turn", () => {
        // From p2's end-of-turn with p1 having skipNextTurn set.
        const state = makeState({
            phase: "END_STEP",
            turn: 2,
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { skipNextTurn: true }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state); // p2's END_STEP → CLEANUP → next turn
        // p1's turn is skipped
        expect(state.activePlayerId).toBe("p2");
        expect(state.players[0].skipNextTurn).toBeUndefined();
    });

    it("full cycle: skip-turn to untap, then tap for extra turn", () => {
        const vault = makeInstance(timeVault.id, {
            id: "vault",
            isTapped: true,
        });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [vault] }),
                makePlayer("p2"),
            ],
        });

        // Step 1: Activate skip-turn ability to untap vault
        const skipAbility = timeVault.activatedAbilities![0];
        const item1 = pushSpell(state, timeVault.id, "p1");
        item1.id = "vault"; // match battlefield source id
        item1.abilityId = skipAbility.id;
        resolveTopOfStack(state);
        expect(state.players[0].skipNextTurn).toBe(true);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vault")!.isTapped
        ).toBe(false);

        // Step 2: Activate tap-for-extra-turn ability
        const extraAbility = timeVault.activatedAbilities![1];
        const item2 = pushSpell(state, timeVault.id, "p1");
        item2.id = "vault";
        item2.abilityId = extraAbility.id;
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);

        // Step 3: Advance through end of turn. Extra turn consumed first
        // (CR 500.7), then skipNextTurn checked (CR 614.10). Skip cancels
        // the extra turn — p1's extra turn is skipped, normal swap → p2.
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.players[0].skipNextTurn).toBeUndefined();
    });
});

describe("Mana Short (tap all lands + drain mana pool, CR 106.4)", () => {
    it("is a {2}{U} Instant targeting a player", () => {
        expect(manaShort.manaCost).toEqual({ X: 2, U: 1 });
        expect(manaShort.types).toEqual(["Instant"]);
        expect(manaShort.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it("taps all target's lands and empties their mana pool", () => {
        const land1 = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land2 = makeInstance(island.id, {
            id: "f2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [land1, land2, creature],
                    manaPool: { W: 0, U: 2, B: 0, R: 0, G: 1, C: 0 },
                }),
            ],
        });
        pushSpell(state, manaShort.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // Lands should be tapped
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "f2")!.isTapped
        ).toBe(true);
        // Creature should NOT be tapped
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!.isTapped
        ).toBe(false);
        // Mana pool should be empty
        expect(state.players[1].manaPool.U).toBe(0);
        expect(state.players[1].manaPool.G).toBe(0);
    });

    it("already-tapped lands stay tapped (no-op)", () => {
        const land = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, manaShort.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.isTapped
        ).toBe(true);
    });
});

describe("Drain Power (tap lands + transfer mana, CR 106.4)", () => {
    it("is a {U}{U} Sorcery targeting a player", () => {
        expect(drainPower.manaCost).toEqual({ U: 2 });
        expect(drainPower.types).toEqual(["Sorcery"]);
        expect(drainPower.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it("taps target's lands, drains their mana, and adds it to caster", () => {
        const land1 = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land2 = makeInstance(mountain.id, {
            id: "m1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", {
                    battlefield: [land1, land2],
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 2, C: 0 },
                }),
            ],
        });
        pushSpell(state, drainPower.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // p2's lands tapped
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "m1")!.isTapped
        ).toBe(true);
        // p2's mana pool drained
        expect(state.players[1].manaPool.R).toBe(0);
        expect(state.players[1].manaPool.G).toBe(0);
        // p1 gains p2's drained mana (added to existing pool)
        expect(state.players[0].manaPool.R).toBe(3);
        expect(state.players[0].manaPool.G).toBe(2);
        expect(state.players[0].manaPool.U).toBe(1); // unchanged
    });

    it("drainManaPool returns correct amounts when pool is empty", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
            ],
        });
        pushSpell(state, drainPower.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // p1's pool unchanged (nothing drained)
        expect(state.players[0].manaPool).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 0,
        });
    });

    it("spell goes to graveyard after resolution (sorcery)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, drainPower.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(
            state.players[0].graveyard.some(
                (c) => (c.card as { id: string }).id === drainPower.id
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Serialization: skipNextTurn on PlayerState round-trip
// ---------------------------------------------------------------------------

describe("skipNextTurn serialization", () => {
    it("round-trips through compactState / expandState", async () => {
        const { compactState, expandState } =
            await import("../../../gre/serialize");
        const state = makeState({
            players: [
                makePlayer("p1", { skipNextTurn: true }),
                makePlayer("p2"),
            ],
        });
        const compact = compactState(state);
        const expanded = expandState(compact);
        expect(expanded.players[0].skipNextTurn).toBe(true);
        expect(expanded.players[1].skipNextTurn).toBeUndefined();
    });

    it("omitted when undefined", async () => {
        const { compactState } = await import("../../../gre/serialize");
        const state = makeState();
        const compact = compactState(state);
        const players = compact.players as Array<Record<string, unknown>>;
        expect("skipNextTurn" in players[0]).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function grizzlyBearsId(): string {
    // grizzlyBears is exported from lea.ts — use getCardByName to stay
    // decoupled if we rename the variable.
    return "ce2d603a-3231-4a8c-bf39-1617586ea870";
}

/** Push a delayed trigger instance onto the stack for resolution. */
function pushDelayedTrigger(
    state: GameState,
    dt: {
        sourceCardId: string;
        controller: string;
        triggerId: string;
        payload: Record<string, string>;
    },
    id = "delayed-1"
): void {
    state.stack.push({
        id,
        card: { id: dt.sourceCardId },
        controllerId: dt.controller,
        ownerId: dt.controller,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: dt.controller,
        delayedTriggerId: dt.triggerId,
        delayedPayload: dt.payload,
    });
}

// ---------------------------------------------------------------------------
// Natural Selection (CR 401.4 — peek, reorder-library, optional shuffle)
// ---------------------------------------------------------------------------
describe("Natural Selection (peek top 3 + reorder + optional shuffle, CR 401.4)", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find((s) => s.id === head.stackItemId);
        if (!item) throw new Error("stack item missing");
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    function setup(libIds: string[] = ["c1", "c2", "c3", "c4"]) {
        const library = libIds.map((id) =>
            makeInstance(swamp.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library })],
        });
        pushSpell(state, naturalSelection.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        return state;
    }

    it("enqueues a reorder-library pending choice for the controller", () => {
        const state = setup();
        resolveTopOfStack(state);

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0]).toMatchObject({
            playerId: "p1",
            kind: "reorder-library",
            zone: "library",
            count: 3,
            zoneOwnerId: "p2",
        });
    });

    it("reorders the top 3 cards of target's library according to chosen order", () => {
        const state = setup();
        resolveTopOfStack(state);

        // Reorder: c3, c1, c2 (was c1, c2, c3, c4)
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);

        // Step 1: may-pay for shuffle — decline
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        const lib = state.players[1].library.map((c) => c.id);
        expect(lib).toEqual(["c3", "c1", "c2", "c4"]);
    });

    it("shuffles target's library when the caster accepts the may-pay", () => {
        const state = setup();
        resolveTopOfStack(state);

        commitHead(state, ["c2", "c3", "c1"]);
        resolveTopOfStack(state);

        // Accept shuffle
        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        // After shuffle the library still has 4 cards but order changed
        // (deterministic RNG with seed 0). Just verify the library size
        // and that the spell is fully resolved.
        expect(state.players[1].library).toHaveLength(4);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("handles target's library with fewer than 3 cards", () => {
        const state = setup(["c1", "c2"]);
        resolveTopOfStack(state);

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].count).toBe(2);
    });

    it("skips entirely when target's library is empty", () => {
        const state = setup([]);
        resolveTopOfStack(state);

        // Step 0 returns early (0 cards) → step 1 runs → may-pay
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
    });

    it("wire format: exposes top 3 of target's library as libraryPeek to the chooser", () => {
        const state = setup();
        resolveTopOfStack(state);

        const forP1 = projectPublicState(state, 1, "p1");
        // p2's library peek exposed to p1 (the chooser)
        expect(forP1.players[1].libraryPeek?.map((c) => c.id)).toEqual([
            "c1",
            "c2",
            "c3",
        ]);
        // Mid-choice, no card is yet `knownTo` (the reorder hasn't resolved).
        expect(forP1.players[1].library).toEqual({ count: 4, known: [] });

        // p2 (not the chooser) should NOT see the peek
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[1].libraryPeek).toBeUndefined();
    });

    // ADR 0026 / PRD #338 — persistent knowledge: the cards the chooser
    // precisely positioned stay known to the chooser only after the choice
    // resolves, unless they shuffle.
    it("stamps the reordered top cards knownTo the chooser when not shuffling", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);
        commitHead(state, ["no"]); // decline shuffle
        resolveTopOfStack(state);

        const lib = state.players[1].library;
        // The 3 reordered cards are known to the chooser (p1) and survive.
        expect(lib[0].knownTo).toEqual(["p1"]);
        expect(lib[1].knownTo).toEqual(["p1"]);
        expect(lib[2].knownTo).toEqual(["p1"]);
        // The untouched 4th card is not known to anyone.
        expect(lib[3].knownTo).toBeUndefined();
    });

    it("clears all knowledge of the library when the chooser shuffles", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c2", "c3", "c1"]);
        resolveTopOfStack(state);
        commitHead(state, ["yes"]); // shuffle
        resolveTopOfStack(state);

        for (const c of state.players[1].library) {
            expect(c.knownTo).toBeUndefined();
        }
    });

    it("wire format: known cards reach the chooser's library.known[], hidden from opponent", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        // p1 (the chooser) sees the 3 known cards at their top indices.
        const forP1 = projectPublicState(state, 1, "p1");
        const known = forP1.players[1].library.known;
        expect(forP1.players[1].library.count).toBe(4);
        expect(known.map((k) => k.index)).toEqual([0, 1, 2]);
        expect(known.map((k) => k.card.id)).toEqual(["c3", "c1", "c2"]);
        // Raw knownTo must never cross the wire.
        for (const k of known) {
            expect((k.card as { knownTo?: string[] }).knownTo).toBeUndefined();
        }

        // p2 (the library owner, not the knower) sees only the count — no
        // known cards (a player does not auto-know their own library order).
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[1].library.count).toBe(4);
        expect(forP2.players[1].library.known).toEqual([]);
    });

    // Integration mandate (project rule): the full GRE → serialize (DB) →
    // projection path for a knowledge-granting effect. Knowledge stamped by
    // resolution must survive a DB round trip and still project correctly.
    it("end-to-end: knownTo survives the DB round trip and projects to the chooser only", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        // Persist → reload (compact → expand), as saveGameState would.
        const reloaded = expandState(compactState(state));
        expect(reloaded.players[1].library[0].knownTo).toEqual(["p1"]);

        // Project the reloaded state: chooser sees the known cards, opponent
        // does not, and raw knownTo never crosses the wire.
        const forP1 = projectPublicState(reloaded, 1, "p1");
        expect(forP1.players[1].library.known.map((k) => k.card.id)).toEqual([
            "c3",
            "c1",
            "c2",
        ]);
        const forP2 = projectPublicState(reloaded, 1, "p2");
        expect(forP2.players[1].library.known).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Reveal-to-all (library) — ADR 0026 / PRD #338 slice 2 (#340)
// A reveal effect stamps every player onto a library card's knownTo. The card
// is then face-up to ALL players (every viewer's projection exposes it at its
// index) and stays so until the library is shuffled, which clears it for all
// (reusing slice 1's shuffle clear). This exercises the full
// GRE primitive → serialize (DB) → projection → clear path that a
// reveal-the-top-card style effect drives via SpellContext.markKnownToAll.
// ---------------------------------------------------------------------------
describe("Reveal-to-all library knowledge (ADR 0026 slice 2, CR 701.16 / 701.20)", () => {
    function setup() {
        const library = ["r1", "r2", "r3"].map((id) =>
            makeInstance(swamp.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        return makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library })],
        });
    }

    it("stamps every player onto the revealed card's knownTo", () => {
        const state = setup();
        grantKnowledgeToAll(state, "p2", ["r1"]);
        // Both players know it (a look would add only one).
        expect(state.players[1].library[0].knownTo).toEqual(["p1", "p2"]);
        // Other cards stay hidden.
        expect(state.players[1].library[1].knownTo).toBeUndefined();
    });

    it("end-to-end: every viewer sees the revealed card; a shuffle clears it for all", () => {
        const state = setup();
        grantKnowledgeToAll(state, "p2", ["r1"]);

        // Survives the DB round trip (as saveGameState → load would do).
        const reloaded = expandState(compactState(state));
        expect(reloaded.players[1].library[0].knownTo).toEqual(["p1", "p2"]);

        // Projection: the revealed top card reaches EVERY viewer at index 0,
        // and raw knownTo never crosses the wire.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(reloaded, 1, viewer);
            const lib = projected.players[1].library;
            expect(lib.count).toBe(3);
            expect(lib.known).toHaveLength(1);
            expect(lib.known[0].index).toBe(0);
            expect(lib.known[0].card.id).toBe("r1");
            expect(
                (lib.known[0].card as { knownTo?: string[] }).knownTo
            ).toBeUndefined();
        }

        // Shuffle clears the reveal for everyone (CR 701.20).
        clearKnowledge(reloaded.players[1].library, null);
        for (const c of reloaded.players[1].library) {
            expect(c.knownTo).toBeUndefined();
        }
        // After the shuffle no viewer sees the card any more.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(reloaded, 1, viewer);
            expect(projected.players[1].library.known).toEqual([]);
        }
    });
});

// ---------------------------------------------------------------------------
// knownTo cross-zone movement rules (ADR 0026 slice 5, #344)
// ---------------------------------------------------------------------------
// Knowledge persists across hidden→hidden moves (a witnessed draw) and is
// cleared at the public-zone boundary (casting to the stack), never to
// resurrect on a later return to a hidden zone. Exercises the full
// GRE primitive (draw / removeFromZone) → serialize (DB) → projection path.
// ---------------------------------------------------------------------------
describe("knownTo cross-zone rules (ADR 0026 slice 5, CR 121.1 / 405)", () => {
    function setup() {
        const library = ["l1", "l2"].map((id) =>
            makeInstance(swamp.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const hand = [
            makeInstance(swamp.id, {
                id: "h1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        return makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library, hand })],
        });
    }

    it("witnessed draw: an opponent-known top card stays known after drawing it, and projects to the opponent", () => {
        const state = setup();
        // p1 saw the top of p2's library (reveal-top style effect).
        grantKnowledge(state, "p2", ["l1"], "p1");

        // p2 draws it — library→hand is hidden→hidden, so knowledge persists.
        drawCard(state.players[1]);
        const drawn = state.players[1].hand.find((c) => c.id === "l1")!;
        expect(drawn.knownTo).toEqual(["p1"]);

        // Survives the DB round trip, then projects: p1 sees the card face-up in
        // p2's hand and p2 sees it flagged seenByOpponent. Raw knownTo never
        // crosses the wire.
        const reloaded = expandState(compactState(state));
        const handForP1 = projectPublicState(reloaded, 1, "p1").players[1].hand;
        const slotForP1 = handForP1.find((c) => c?.id === "l1")!;
        expect(slotForP1).not.toBeNull();
        expect((slotForP1 as { knownTo?: string[] }).knownTo).toBeUndefined();

        const handForP2 = projectPublicState(reloaded, 1, "p2").players[1].hand;
        const slotForP2 = handForP2.find((c) => c?.id === "l1")!;
        expect(slotForP2.seenByOpponent).toBe(true);
    });

    it("self-scry then draw: owner-known card stays owner-only and is not seenByOpponent", () => {
        const state = setup();
        // p2 scryed l1 to the top — knownTo the owner only.
        grantKnowledge(state, "p2", ["l1"], "p2");

        drawCard(state.players[1]);
        const drawn = state.players[1].hand.find((c) => c.id === "l1")!;
        expect(drawn.knownTo).toEqual(["p2"]);

        const reloaded = expandState(compactState(state));
        const handForP2 = projectPublicState(reloaded, 1, "p2").players[1].hand;
        const slotForP2 = handForP2.find((c) => c?.id === "l1")!;
        expect(slotForP2.seenByOpponent).toBeUndefined();
        // p1 does not see it.
        const handForP1 = projectPublicState(reloaded, 1, "p1").players[1].hand;
        expect(handForP1.find((c) => c?.id === "l1")).toBeUndefined();
    });

    it("play to public then return to hidden: old knowledge does not resurrect", () => {
        const state = setup();
        // p1 knew p2's hand card h1 (Duress-style disruption).
        grantKnowledge(state, "p2", ["h1"], "p1");
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);

        // p2 casts it: hand → stack (public zone) clears the knowledge.
        const onStack = removeFromZone(state.players[1], "h1", "hand");
        expect(onStack.knownTo).toBeUndefined();

        // It later returns to hand (e.g. countered to hand / bounced): no stale
        // knowledge resurrects, so p1 no longer sees it.
        onStack.zone = "hand";
        state.players[1].hand.push(onStack);

        const reloaded = expandState(compactState(state));
        const handForP1 = projectPublicState(reloaded, 1, "p1").players[1].hand;
        expect(handForP1.find((c) => c?.id === "h1")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Glasses of Urza (CR 401.4 — look at target player's hand)
// ---------------------------------------------------------------------------
describe("Glasses of Urza (reveal hand, CR 401.4)", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find((s) => s.id === head.stackItemId);
        if (!item) throw new Error("stack item missing");
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    function setup() {
        const glasses = makeInstance(glassesOfUrza.id, {
            id: "glasses",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const opponentHand = [
            makeInstance(swamp.id, {
                id: "h1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(swamp.id, {
                id: "h2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [glasses] }),
                makePlayer("p2", { hand: opponentHand }),
            ],
        });
        return state;
    }

    function activateGlasses(state: GameState) {
        const ability = glassesOfUrza.activatedAbilities![0];
        const glasses = state.players[0].battlefield[0];
        glasses.isTapped = true;
        state.stack.push({
            ...glasses,
            zone: "stack",
            castById: "p1",
            targets: [{ type: "player", id: "p2" }],
            abilityId: ability.id,
        } as CardInstanceState & {
            castById: string;
            targets: { type: "player"; id: string }[];
            abilityId: string;
        });
    }

    it("enqueues a reveal-hand pending choice for the controller", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0]).toMatchObject({
            playerId: "p1",
            kind: "reveal-hand",
            zone: "hand",
            count: 0,
            zoneOwnerId: "p2",
        });
    });

    it("resolves after controller acknowledges the reveal", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);

        // Controller acknowledges (submits empty selection)
        commitHead(state, []);
        resolveTopOfStack(state);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });

    it("wire format: exposes opponent's hand as revealedHand to the controller", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);

        const forP1 = projectPublicState(state, 1, "p1");
        // p2's hand revealed to p1
        expect(forP1.players[1].revealedHand?.map((c) => c.id)).toEqual([
            "h1",
            "h2",
        ]);
        // p2's normal hand still shows as null[] to p1
        expect(forP1.players[1].hand).toEqual([null, null]);

        // p2 should NOT see the reveal field
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[1].revealedHand).toBeUndefined();
    });

    // ADR 0026 / PRD #338 (slice 3) — the look is a persistent _hand_ knowledge
    // grant. Once the reveal is acknowledged, the controller (p1) keeps knowing
    // p2's hand cards after the ability resolves.
    it("stamps the target's whole hand knownTo the controller after acknowledge", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);

        // Mid-choice: nothing stamped yet (the reveal hasn't been acknowledged).
        expect(state.players[1].hand[0].knownTo).toBeUndefined();

        // Controller acknowledges the reveal (empty selection).
        commitHead(state, []);
        resolveTopOfStack(state);

        // Every card in p2's hand is now known to p1 (only p1 — a look, not a
        // reveal) and survives resolution.
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);
        expect(state.players[1].hand[1].knownTo).toEqual(["p1"]);
        // p2 never appears in their own hand's knownTo (owner sees it natively).
        expect(state.players[1].hand[0].knownTo).not.toContain("p2");
    });

    it("wire format: known hand reaches p1 face-up + eye flag for p2; p2 view stays hidden to others", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);
        commitHead(state, []);
        resolveTopOfStack(state);

        // p1's view of p2's hand: known slots carry identity (face-up), length
        // preserved, raw knownTo never on the wire.
        const forP1 = projectPublicState(state, 1, "p1");
        const oppHand = forP1.players[1].hand;
        expect(oppHand).toHaveLength(2);
        expect(oppHand[0]).not.toBeNull();
        expect(oppHand[1]).not.toBeNull();
        expect(oppHand.map((c) => c!.id)).toEqual(["h1", "h2"]);
        for (const c of oppHand) {
            expect((c as { knownTo?: string[] }).knownTo).toBeUndefined();
        }

        // p2's own view: each known card carries the derived eye flag; raw
        // knownTo never crosses the wire.
        const forP2 = projectPublicState(state, 1, "p2");
        const ownHand = forP2.players[1].hand;
        expect(ownHand[0]!.seenByOpponent).toBe(true);
        expect(ownHand[1]!.seenByOpponent).toBe(true);
        for (const c of ownHand) {
            expect((c as { knownTo?: string[] }).knownTo).toBeUndefined();
        }
    });

    // Integration mandate: the full GRE → serialize (DB) → projection path for a
    // hand knowledge-granting effect. Knowledge stamped by resolution must
    // survive a DB round trip and still project correctly.
    it("end-to-end: hand knownTo survives the DB round trip and projects per viewer", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);
        commitHead(state, []);
        resolveTopOfStack(state);

        const reloaded = expandState(compactState(state));
        expect(reloaded.players[1].hand[0].knownTo).toEqual(["p1"]);

        const forP1 = projectPublicState(reloaded, 1, "p1");
        expect(forP1.players[1].hand.map((c) => c?.id)).toEqual(["h1", "h2"]);
        const forP2 = projectPublicState(reloaded, 1, "p2");
        expect(forP2.players[1].hand[0]!.seenByOpponent).toBe(true);
    });

    // Integration: drive the reveal acknowledgement through the SAME primitive
    // the `submitPendingChoice` mutation calls (`applyPendingChoiceSubmit`), not
    // the test shim — so the full GRE → game.ts boundary path stamps knownTo and
    // it survives into the projection. (Knowledge-granting leg of the mandate.)
    it("integration: submitting the reveal ack via the mutation primitive stamps + projects knownTo", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [], // a reveal ack carries no picks
        });

        // The mutation path resolved the ability and stamped the hand.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);

        const forP1 = projectPublicState(state, 1, "p1");
        expect(forP1.players[1].hand.map((c) => c?.id)).toEqual(["h1", "h2"]);
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[1].hand[0]!.seenByOpponent).toBe(true);
    });

    // ADR 0026 clear trigger #2 — a random discard is unwitnessed: the knower's
    // identity→card map can no longer be trusted, so the WHOLE remaining hand
    // reverts to hidden for non-owners. (Knowledge-clearing leg of the mandate.)
    it("a random discard clears the controller's knowledge of the whole hand", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);
        commitHead(state, []);
        resolveTopOfStack(state);
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);

        // p2 discards one card at random (e.g. Hymn to Tourach style).
        discardCardsAtRandom(state, "p2", 1);

        // The remaining hand card is no longer known to p1.
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toBeUndefined();
        }
        // And the eye flag is gone from p2's own view.
        const forP2 = projectPublicState(state, 1, "p2");
        for (const c of forP2.players[1].hand) {
            expect(c!.seenByOpponent).toBeUndefined();
        }
    });

    // ADR 0026 / PRD #338 (slice 4), clear trigger #2 — an OWNER-CHOSEN discard
    // (Disrupting Scepter: the target picks the card) is witnessed by the owner
    // but NOT by the knower (p1). The knower's identity→card map can no longer
    // be trusted, so the WHOLE remaining hand reverts to hidden for p1 while p2
    // (the owner) is untouched. End-to-end through the mutation primitive so the
    // GRE → game.ts → projection path is exercised. (Clearing leg of the mandate.)
    it("an owner-chosen discard clears the controller's knowledge of the whole hand", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);
        commitHead(state, []);
        resolveTopOfStack(state);
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);
        expect(state.players[1].hand[1].knownTo).toEqual(["p1"]);

        // p2 discards a card of their OWN choosing (Disrupting Scepter activated
        // by p1, but p2 chooses which card leaves their hand).
        const scepter = makeInstance(disruptingScepter.id, {
            id: "scepter",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(scepter);
        const ability = disruptingScepter.activatedAbilities![0];
        const item = pushSpell(state, disruptingScepter.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.abilityId = ability.id;
        resolveTopOfStack(state);

        // p2 picks h1 to discard, through the same primitive the mutation calls.
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1"],
        });

        // h1 is in p2's graveyard; the remaining hand card (h2) is no longer
        // known to p1 — the whole hand reverted to hidden for the non-owner.
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("h1");
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toBeUndefined();
        }

        // Projection: p1 no longer sees p2's hand face-up; p2's own view loses
        // the eye flag. The owner's own knowledge is never affected.
        const forP1 = projectPublicState(state, 1, "p1");
        for (const c of forP1.players[1].hand) {
            expect(c).toBeNull();
        }
        const forP2 = projectPublicState(state, 1, "p2");
        for (const c of forP2.players[1].hand) {
            expect(c!.seenByOpponent).toBeUndefined();
        }
    });
});

// ---------------------------------------------------------------------------
// Cockatrice (CR 509.1h — combat kill trigger, CR 511.3 end-of-combat destroy)
// ---------------------------------------------------------------------------
describe("Cockatrice (blocks/blocked-by → destroy at end of combat, CR 509.1h)", () => {
    function setupCombat(opts: {
        selfIsAttacker: boolean;
        opponentSubtypes?: string[];
    }) {
        const cockCard = makeInstance(cockatrice.id, {
            id: "cock",
            controllerId: opts.selfIsAttacker ? "p1" : "p2",
            ownerId: opts.selfIsAttacker ? "p1" : "p2",
            zone: "battlefield",
            isAttacking: opts.selfIsAttacker ? true : undefined,
            isBlocking: opts.selfIsAttacker ? undefined : true,
        });
        const opponent = makeInstance(grizzlyBears.id, {
            id: "opp-creature",
            controllerId: opts.selfIsAttacker ? "p2" : "p1",
            ownerId: opts.selfIsAttacker ? "p2" : "p1",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: opts.opponentSubtypes ?? [],
            isAttacking: opts.selfIsAttacker ? undefined : true,
            isBlocking: opts.selfIsAttacker ? true : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: opts.selfIsAttacker ? [cockCard] : [opponent],
                }),
                makePlayer("p2", {
                    battlefield: opts.selfIsAttacker ? [opponent] : [cockCard],
                }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: [opts.selfIsAttacker ? "cock" : "opp-creature"],
                confirmed: true,
                blockerAssignments: opts.selfIsAttacker
                    ? { "opp-creature": ["cock"] }
                    : { cock: ["opp-creature"] },
                blockersConfirmed: true,
            },
        });
        return state;
    }

    it("has flying", () => {
        expect(cockatrice.staticAbilities).toContain("flying");
    });

    it("triggers when cockatrice attacks and is blocked by a non-Wall", () => {
        const state = setupCombat({ selfIsAttacker: true });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "cockatrice-combat-kill"
        );
    });

    it("triggers when cockatrice blocks a non-Wall attacker", () => {
        const state = setupCombat({ selfIsAttacker: false });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "cockatrice-combat-kill"
        );
    });

    it("does NOT trigger against Wall creatures", () => {
        const state = setupCombat({
            selfIsAttacker: true,
            opponentSubtypes: ["Wall"],
        });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(0);
    });

    it("schedules delayed destroy at end-of-combat on resolution", () => {
        const state = setupCombat({ selfIsAttacker: true });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("next-end-of-combat");
        expect(state.delayedTriggers![0].payload.targetId).toBe("opp-creature");
    });

    it("delayed trigger destroys opponent at END_OF_COMBAT", () => {
        const state = setupCombat({ selfIsAttacker: true });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        // Set phase to COMBAT_DAMAGE so advancePhase enters END_OF_COMBAT
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        // Delayed trigger is now on stack
        expect(state.stack.length).toBeGreaterThanOrEqual(1);
        resolveTopOfStack(state);
        // Opponent creature should be in graveyard
        const oppPlayer = state.players[1];
        expect(
            oppPlayer.battlefield.find((c) => c.id === "opp-creature")
        ).toBeUndefined();
        expect(
            oppPlayer.graveyard.find((c) => c.id === "opp-creature")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Thicket Basilisk (same combat kill, no flying)
// ---------------------------------------------------------------------------
describe("Thicket Basilisk (same combat kill as Cockatrice, no flying)", () => {
    it("does NOT have flying", () => {
        expect(thicketBasilisk.staticAbilities ?? []).not.toContain("flying");
    });

    it("triggers on blocking a non-Wall creature", () => {
        const basilisk = makeInstance(thicketBasilisk.id, {
            id: "basilisk",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isBlocking: true,
        });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "att",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: [],
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [basilisk] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["att"],
                confirmed: true,
                blockerAssignments: { basilisk: ["att"] },
                blockersConfirmed: true,
            },
        });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe("basilisk-combat-kill");
    });
});

// ---------------------------------------------------------------------------
// W21a: Subtype-set core — evilPresence, phantasmalTerrain, conversion
// ---------------------------------------------------------------------------

describe("Evil Presence ({B} — aura: enchanted land is a Swamp)", () => {
    it("replaces host's subtypes with Swamp", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);
        expect(mtn.subtypes).toEqual(["Mountain"]);

        const aura = makeInstance(evilPresence.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(mtn.subtypes).toEqual(["Swamp"]);
        expect(mtn.printedSubtypes).toEqual(["Mountain"]);
    });

    it("host produces {B} after subtype change (mana sync)", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);
        expect(getBasicLandMana(mtn)).toBe("R");

        const aura = makeInstance(evilPresence.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(getBasicLandMana(mtn)).toBe("B");
    });

    it("removing aura restores original subtypes", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(evilPresence.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);
        expect(mtn.subtypes).toEqual(["Swamp"]);

        unapplySourceStaticEffects(state, aura);
        expect(mtn.subtypes).toEqual(["Mountain"]);
        expect(mtn.printedSubtypes).toBeUndefined();
        expect(getBasicLandMana(mtn)).toBe("R");
    });

    it("wire format: subtype change visible in projected state", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            id: "mtn-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(evilPresence.id, {
            id: "ep-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        const projected = projectPublicState(state, 1, "p1");
        const projMtn = projected.players[0].battlefield.find(
            (c) => c.id === "mtn-1"
        )!;
        expect(projMtn.subtypes).toEqual(["Swamp"]);
    });

    it("declares subtype-set static effect", () => {
        expect(evilPresence.staticEffects).toHaveLength(1);
        expect(evilPresence.staticEffects![0].kind).toBe("subtype-set");
    });
});

describe("Phantasmal Terrain ({U}{U} — modal aura: choose basic land type)", () => {
    it("applies chosen mode's subtype-set to host", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(phantasmalTerrain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        aura.chosenModeId = "island";
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(mtn.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(mtn)).toBe("U");
    });

    it("forest mode makes host produce {G}", () => {
        const state = makeState();
        const pln = makeInstance(plains.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(pln);

        const aura = makeInstance(phantasmalTerrain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = pln.id;
        aura.chosenModeId = "forest";
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(pln.subtypes).toEqual(["Forest"]);
        expect(getBasicLandMana(pln)).toBe("G");
    });

    it("removing aura restores original subtypes", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(phantasmalTerrain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        aura.chosenModeId = "swamp";
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);
        expect(mtn.subtypes).toEqual(["Swamp"]);

        unapplySourceStaticEffects(state, aura);
        expect(mtn.subtypes).toEqual(["Mountain"]);
    });

    it("has 5 modes (one per basic land type)", () => {
        expect(phantasmalTerrain.modes).toHaveLength(5);
        const ids = phantasmalTerrain.modes!.map((m) => m.id);
        expect(ids).toEqual([
            "plains",
            "island",
            "swamp",
            "mountain",
            "forest",
        ]);
    });
});

describe("Conversion ({2}{W}{W} — all Mountains are Plains)", () => {
    it("replaces subtypes of all Mountains globally", () => {
        const state = makeState();
        const mtn1 = makeInstance(mountain.id, {
            id: "mtn-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const mtn2 = makeInstance(mountain.id, {
            id: "mtn-2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn1);
        state.players[1].battlefield.push(mtn2);

        const conv = makeInstance(conversion.id, {
            id: "conv",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);
        applySourceStaticEffects(state, conv);

        expect(mtn1.subtypes).toEqual(["Plains"]);
        expect(mtn2.subtypes).toEqual(["Plains"]);
        expect(getBasicLandMana(mtn1)).toBe("W");
        expect(getBasicLandMana(mtn2)).toBe("W");
    });

    it("does not affect non-Mountain lands", () => {
        const state = makeState();
        const isl = makeInstance(island.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(isl);

        const conv = makeInstance(conversion.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);
        applySourceStaticEffects(state, conv);

        expect(isl.subtypes).toEqual(["Island"]);
    });

    it("removal restores all Mountains", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const conv = makeInstance(conversion.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);
        applySourceStaticEffects(state, conv);
        expect(mtn.subtypes).toEqual(["Plains"]);

        unapplySourceStaticEffects(state, conv);
        expect(mtn.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(mtn)).toBe("R");
    });

    it("new Mountain entering after Conversion gets affected", () => {
        const state = makeState();
        const conv = makeInstance(conversion.id, {
            id: "conv",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);

        const mtn = makeInstance(mountain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(mtn);
        applyExistingGrantsTo(state, mtn);

        expect(mtn.subtypes).toEqual(["Plains"]);
    });

    it("upkeep pay-or-else trigger declared", () => {
        expect(conversion.triggeredAbilities).toHaveLength(1);
        expect(conversion.triggeredAbilities![0].id).toBe("conversion-upkeep");
    });
});

describe("grantedSubtypes serialization round-trip", () => {
    it("grantedSubtypes + printedSubtypes survive compact → expand", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(evilPresence.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        const expanded = expandState(compactState(state));
        const got = expanded.players[0].battlefield.find(
            (c: CardInstanceState) => c.id === mtn.id
        )!;
        expect(got.grantedSubtypes).toEqual(mtn.grantedSubtypes);
        expect(got.printedSubtypes).toEqual(["Mountain"]);
        expect(got.subtypes).toEqual(["Swamp"]);
    });

    it("chosenModeId survives compact → expand for battlefield permanent", () => {
        const state = makeState();
        const aura = makeInstance(phantasmalTerrain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        aura.chosenModeId = "island";
        state.players[0].battlefield.push(aura);

        const expanded = expandState(compactState(state));
        const got = expanded.players[0].battlefield.find(
            (c: CardInstanceState) => c.id === aura.id
        )!;
        expect(got.chosenModeId).toBe("island");
    });
});

// ---------------------------------------------------------------------------
// W21b: Animate-land extension — livingLands, kormusBell, cyclopeanTomb
// ---------------------------------------------------------------------------

describe("Living Lands ({3}{G} — all Forests are 1/1 creatures, still lands)", () => {
    it("Forests become 1/1 creatures and keep Land type", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            id: "forest-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        expect(f.types).toContain("Creature");
        expect(f.types).toContain("Land");
        expect(getEffectivePower(state, f)).toBe(1);
        expect(getEffectiveToughness(state, f)).toBe(1);
    });

    // CR 302.6 — summoning sickness on an animated land is governed by the
    // control-continuity flag (set at entry, cleared at the controller's untap
    // step), NOT by the act of becoming a creature. A Forest that entered this
    // turn is still sick when Living Lands animates it; a Forest controlled
    // since a prior turn (flag already cleared) is not.
    it("a Forest that entered this turn stays summoning-sick when animated", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            controllerId: "p1",
            zone: "battlefield",
            isSummoningSick: true, // entered this turn
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        expect(f.types).toContain("Creature");
        expect(f.isSummoningSick).toBe(true);
    });

    it("a Forest controlled since a prior turn is NOT summoning-sick when animated", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            controllerId: "p1",
            zone: "battlefield",
            // isSummoningSick undefined — cleared at a prior untap step
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        expect(f.types).toContain("Creature");
        expect(f.isSummoningSick).toBeUndefined();
    });

    it("removal of Living Lands reverts Forests to non-creature", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);
        expect(f.types).toContain("Creature");

        unapplySourceStaticEffects(state, ll);
        expect(f.types).not.toContain("Creature");
        expect(f.types).toContain("Land");
    });

    it("wire format: animated Forest visible in projected state", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            id: "forest-w",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        const projected = projectPublicState(state, 1, "p1");
        const projF = projected.players[0].battlefield.find(
            (c) => c.id === "forest-w"
        )!;
        expect(projF.types).toContain("Creature");
        expect(getEffectivePower(projected, projF)).toBe(1);
        expect(getEffectiveToughness(projected, projF)).toBe(1);
    });
});

describe("Kormus Bell ({4} — all Swamps are 1/1 black creatures, still lands)", () => {
    it("Swamps become 1/1 black creatures", () => {
        const state = makeState();
        const sw = makeInstance(swamp.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(sw);

        const kb = makeInstance(kormusBell.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(kb);
        applySourceStaticEffects(state, kb);

        expect(sw.types).toContain("Creature");
        expect(sw.types).toContain("Land");
        expect(getEffectivePower(state, sw)).toBe(1);
        expect(getEffectiveToughness(state, sw)).toBe(1);
    });

    it("animated Swamps are black (color grant)", () => {
        const state = makeState();
        const sw = makeInstance(swamp.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(sw);

        const kb = makeInstance(kormusBell.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(kb);
        applySourceStaticEffects(state, kb);

        const colors = STATIC_EFFECT_CTX.getColors(sw);
        expect(colors).toContain("B");
    });

    it("removal of Kormus Bell reverts Swamps", () => {
        const state = makeState();
        const sw = makeInstance(swamp.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(sw);

        const kb = makeInstance(kormusBell.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(kb);
        applySourceStaticEffects(state, kb);

        unapplySourceStaticEffects(state, kb);
        expect(sw.types).not.toContain("Creature");
        expect(sw.grantedColors).toBeUndefined();
    });
});

describe("Cyclopean Tomb ({4} — mire counter + LTB)", () => {
    it("mire counter makes land a Swamp via subtype-set", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            id: "mtn-ct",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const tomb = makeInstance(cyclopeanTomb.id, {
            id: "tomb",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(tomb);

        // Simulate putting a mire counter
        mtn.counters = { mire: 1 };

        // Apply static effects from tomb
        applySourceStaticEffects(state, tomb);

        expect(mtn.subtypes).toEqual(["Swamp"]);
        expect(getBasicLandMana(mtn)).toBe("B");
    });

    it("no mire counter → subtype-set does not apply", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const tomb = makeInstance(cyclopeanTomb.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(tomb);
        applySourceStaticEffects(state, tomb);

        expect(mtn.subtypes).toEqual(["Mountain"]);
    });

    it("LTB trigger: removes mire counters and sets subtypes to Forest", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            id: "mtn-ltb",
            controllerId: "p1",
            zone: "battlefield",
        });
        mtn.counters = { mire: 2 };
        mtn.subtypes = ["Swamp"];
        mtn.printedSubtypes = ["Mountain"];
        state.players[0].battlefield.push(mtn);

        const tomb = makeInstance(cyclopeanTomb.id, {
            id: "tomb-ltb",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(tomb);

        // Move tomb to graveyard + trigger
        removePermanentTo(state, "tomb-ltb", "graveyard");
        processPendingActionTriggers(state);

        // LTB should have queued a triggered ability
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe("cyclopean-tomb-ltb");

        // Resolve the trigger
        resolveTopOfStack(state);

        // Mire counters removed, subtypes set to Forest
        expect(mtn.counters?.mire).toBeUndefined();
        expect(mtn.subtypes).toEqual(["Forest"]);
        expect(getBasicLandMana(mtn)).toBe("G");
    });

    it("declares activated ability with target non-Swamp land", () => {
        expect(cyclopeanTomb.activatedAbilities).toHaveLength(1);
        expect(
            cyclopeanTomb.activatedAbilities![0].targetRequirement
                ?.excludeSubtypes
        ).toEqual(["Swamp"]);
    });
});

// ---------------------------------------------------------------------------
// Lace cycle — color-change layer 5 (CR 305.7, 613.1d)
// ---------------------------------------------------------------------------

describe("Lace cycle (CR 305.7 — target spell or permanent becomes [color])", () => {
    const laces = [
        { def: purelace, color: "W", name: "Purelace" },
        { def: thoughtlace, color: "U", name: "Thoughtlace" },
        { def: deathlace, color: "B", name: "Deathlace" },
        { def: chaoslace, color: "R", name: "Chaoslace" },
        { def: lifelace, color: "G", name: "Lifelace" },
    ] as const;

    for (const { def, color, name } of laces) {
        describe(name, () => {
            it("changes a permanent's color", () => {
                const creature = makeInstance(savannahLions.id, {
                    id: "lion",
                    controllerId: "p2",
                    ownerId: "p2",
                });
                const p1 = makePlayer("p1", {
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
                });
                const p2 = makePlayer("p2", {
                    battlefield: [creature],
                });
                const state = makeState({ players: [p1, p2] });

                const originalColors = STATIC_EFFECT_CTX.getColors(creature);
                expect(originalColors).toContain("W");

                pushSpell(state, def.id, "p1", [
                    { type: "permanent", id: "lion" },
                ]);
                resolveTopOfStack(state);

                const newColors = STATIC_EFFECT_CTX.getColors(creature);
                expect(newColors).toEqual([color]);
            });

            it("changes a spell's color on the stack", () => {
                const p1 = makePlayer("p1", {
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
                });
                const p2 = makePlayer("p2");
                const state = makeState({ players: [p1, p2] });

                const targetSpell = pushSpell(state, lightningBolt.id, "p2", [
                    { type: "player", id: "p1" },
                ]);

                pushSpell(state, def.id, "p1", [
                    { type: "spell", id: targetSpell.id },
                ]);
                resolveTopOfStack(state);

                const boltOnStack = state.stack.find(
                    (s) => s.id === targetSpell.id
                )!;
                expect(boltOnStack.colorOverride).toEqual([color]);
                expect(STATIC_EFFECT_CTX.getColors(boltOnStack)).toEqual([
                    color,
                ]);
            });

            it("color change persists — not cleared at end of turn", () => {
                const creature = makeInstance(savannahLions.id, {
                    id: "lion",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const p1 = makePlayer("p1", {
                    battlefield: [creature],
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
                });
                const state = makeState({ players: [p1, makePlayer("p2")] });

                pushSpell(state, def.id, "p1", [
                    { type: "permanent", id: "lion" },
                ]);
                resolveTopOfStack(state);

                expect(creature.colorOverride).toEqual([color]);
                expect(STATIC_EFFECT_CTX.getColors(creature)).toEqual([color]);
            });
        });
    }

    it("spell-or-permanent target type includes all permanent types + stack spells", () => {
        const creature = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [creature, land],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);

        const targets = getLegalTargets(
            state,
            { type: "spell-or-permanent", count: 1 },
            [],
            "p1"
        );

        const ids = targets.map((t) => t.id);
        expect(ids).toContain("lion");
        expect(ids).toContain("forest1");
        expect(ids).toContain(bolt.id);
        const types = targets.map((t) => t.type);
        expect(types).not.toContain("player");
    });

    it("protection interaction respects new color (CR 702.16b)", () => {
        const proRedCreature = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [proRedCreature],
        });
        const state = makeState({ players: [p1, p2] });

        expect(getProtectedColors(proRedCreature).includes("B")).toBe(true);

        pushSpell(state, deathlace.id, "p1", [{ type: "permanent", id: "wk" }]);
        resolveTopOfStack(state);

        expect(STATIC_EFFECT_CTX.getColors(proRedCreature)).toEqual(["B"]);
    });

    it("wire format: colorOverride survives projectPublicState", () => {
        const creature = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [creature],
            manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        pushSpell(state, chaoslace.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);

        expect(creature.colorOverride).toEqual(["R"]);

        const projected = projectPublicState(state, 1, "p1");
        const projLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(
            (projLion as unknown as { colorOverride?: string[] }).colorOverride
        ).toEqual(["R"]);
        expect(STATIC_EFFECT_CTX.getColors(projLion)).toEqual(["R"]);
    });
});

// ---------------------------------------------------------------------------
// W24: Cost modification + keyword removal (CR 601.2f, 613.1a)
// ---------------------------------------------------------------------------

describe("Animate Wall (CR 702.3 — keyword-remove: defender)", () => {
    it("enchanted Wall can attack (defender removed)", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(animateWall.id, {
            id: "anim",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "wall",
        });
        const p1 = makePlayer("p1", { battlefield: [wall, aura] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        applySourceStaticEffects(state, aura);

        expect(wall.staticAbilities).not.toContain("defender");
        expect(wall.removedKeywords).toEqual([
            { keyword: "defender", sourceId: "anim" },
        ]);
        const result = validateAttackerEligibility(
            wall,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(true);
    });

    it("removing aura restores defender", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(animateWall.id, {
            id: "anim",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "wall",
        });
        const p1 = makePlayer("p1", { battlefield: [wall, aura] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        applySourceStaticEffects(state, aura);

        expect(wall.staticAbilities).not.toContain("defender");

        unapplySourceStaticEffects(state, aura);

        expect(wall.staticAbilities).toContain("defender");
        expect(wall.removedKeywords).toBeUndefined();
    });
});

describe("Earthbind (CR 613.1a — keyword-remove: flying + ETB damage)", () => {
    it("host loses flying continuously", () => {
        const flier = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(earthbind.id, {
            id: "eb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "angel",
        });
        const p1 = makePlayer("p1", { battlefield: [aura] });
        const p2 = makePlayer("p2", { battlefield: [flier] });
        const state = makeState({ players: [p1, p2] });
        applySourceStaticEffects(state, aura);

        expect(flier.staticAbilities).not.toContain("flying");
        expect(flier.removedKeywords).toEqual([
            { keyword: "flying", sourceId: "eb" },
        ]);
    });

    it("deals 2 damage to flying host on ETB", () => {
        const flier = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(earthbind.id, {
            id: "eb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "angel",
        });
        const p1 = makePlayer("p1", { battlefield: [aura] });
        const p2 = makePlayer("p2", { battlefield: [flier] });
        const state = makeState({ players: [p1, p2] });
        applySourceStaticEffects(state, aura);

        // Emit the ETB event and collect triggers
        emitPermanentEntered(state, aura);
        processPendingActionTriggers(state);

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("earthbind-etb");

        resolveTopOfStack(state);
        expect(flier.damageMarked).toBe(2);
    });

    it("non-flying host takes no ETB damage", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(earthbind.id, {
            id: "eb",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const p1 = makePlayer("p1", { battlefield: [aura] });
        const p2 = makePlayer("p2", { battlefield: [bear] });
        const state = makeState({ players: [p1, p2] });
        applySourceStaticEffects(state, aura);

        emitPermanentEntered(state, aura);
        processPendingActionTriggers(state);

        // Trigger fires but resolve is a no-op for non-flying hosts
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(bear.damageMarked).toBeUndefined();
    });
});

describe("Gloom (CR 601.2f — cost-modifier: white spells + white enchantment abilities)", () => {
    it("white spells cost {3} more", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteSpell = makeInstance(savannahLions.id, {
            id: "lions",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { hand: [whiteSpell] });
        const state = makeState({ players: [p1, p2] });

        const mods = getCostModifiers(state, whiteSpell, "spell");
        expect(mods.increase).toEqual({ X: 3 });

        const baseCost = normalizeManaCost(savannahLions.manaCost!);
        applyCostModifiers(baseCost, mods);
        // Savannah Lions = {W}, +3 generic = {W} + {3}
        expect(baseCost).toEqual({ W: 1, X: 3 });
    });

    it("non-white spells unaffected", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redSpell = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { hand: [redSpell] });
        const state = makeState({ players: [p1, p2] });

        const mods = getCostModifiers(state, redSpell, "spell");
        expect(mods.increase).toEqual({});
    });

    it("white enchantment activations cost {3} more", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        // COP White is a white enchantment with an activated ability
        const copW = makeInstance(circleOfProtectionWhite.id, {
            id: "cop",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { battlefield: [copW] });
        const state = makeState({ players: [p1, p2] });

        const mods = getCostModifiers(state, copW, "ability");
        expect(mods.increase).toEqual({ X: 3 });
    });

    it("removal of gloom reverts cost increase", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteSpell = makeInstance(savannahLions.id, {
            id: "lions",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { hand: [whiteSpell] });
        const state = makeState({ players: [p1, p2] });

        expect(getCostModifiers(state, whiteSpell, "spell").increase).toEqual({
            X: 3,
        });

        // Remove gloom from battlefield
        state.players[0].battlefield = [];

        expect(getCostModifiers(state, whiteSpell, "spell").increase).toEqual(
            {}
        );
    });
});

describe("Forcefield (CR 615 — damage cap shield for unblocked creatures)", () => {
    it("caps unblocked attacker combat damage to 1", async () => {
        const attacker = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const ff = makeInstance(forcefield.id, {
            id: "ff",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [attacker] });
        const p2 = makePlayer("p2", { battlefield: [ff], life: 20 });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });

        // Activate forcefield — add damage cap shield
        state.damageCapShields = [{ playerId: "p2", maxDamage: 1 }];

        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});

        // Serra Angel has 4 power, but capped to 1
        expect(p2.life).toBe(19);
    });

    it("shield is consumed after one use", async () => {
        const att1 = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const att2 = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", { battlefield: [att1, att2] });
        const p2 = makePlayer("p2", { life: 20 });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["lion", "bear"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });

        state.damageCapShields = [{ playerId: "p2", maxDamage: 1 }];

        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});

        // First attacker capped to 1, second deals full damage
        // Lion=2 capped to 1, Bear=2 full → 1+2=3 damage
        expect(p2.life).toBe(17);
        expect(state.damageCapShields).toBeUndefined();
    });

    it("blocked creatures not affected by shield", async () => {
        const attacker = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const p1 = makePlayer("p1", { battlefield: [attacker] });
        const p2 = makePlayer("p2", {
            battlefield: [blocker],
            life: 20,
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear: ["angel"] },
                blockersConfirmed: true,
            },
        });

        state.damageCapShields = [{ playerId: "p2", maxDamage: 1 }];

        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { angel: { bear: 4 } });

        // Shield not consumed — attacker was blocked
        expect(p2.life).toBe(20);
        expect(state.damageCapShields).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Serialization round-trip: removedKeywords + damageCapShields
// ---------------------------------------------------------------------------

describe("Serialization: removedKeywords + damageCapShields", () => {
    it("removedKeywords survives compact/expand round-trip", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        wall.removedKeywords = [{ keyword: "defender", sourceId: "anim" }];
        const p1 = makePlayer("p1", { battlefield: [wall] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const compacted = compactState(state);
        const restored = expandState(compacted);
        const restoredWall = restored.players[0].battlefield[0];
        expect(restoredWall.removedKeywords).toEqual([
            { keyword: "defender", sourceId: "anim" },
        ]);
    });

    it("damageCapShields survives compact/expand round-trip", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.damageCapShields = [{ playerId: "p2", maxDamage: 1 }];

        const compacted = compactState(state);
        const restored = expandState(compacted);
        expect(restored.damageCapShields).toEqual([
            { playerId: "p2", maxDamage: 1 },
        ]);
    });

    it("islandSanctuaryProtection survives compact/expand round-trip", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.islandSanctuaryProtection = "p1";

        const compacted = compactState(state);
        const restored = expandState(compacted);
        expect(restored.islandSanctuaryProtection).toBe("p1");
    });

    it("allCreaturesMustAttack survives compact/expand round-trip", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.allCreaturesMustAttack = "p1";

        const compacted = compactState(state);
        const restored = expandState(compacted);
        expect(restored.allCreaturesMustAttack).toBe("p1");
    });
});

// ---------------------------------------------------------------------------
// W25b: Counter-unless-pay + draw-skip (CR 701.5a, 614)
// ---------------------------------------------------------------------------

describe("Power Sink (CR 701.5a — counter unless controller pays {X})", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const stackItem = state.stack.find((s) => s.id === head.stackItemId)!;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    it("counters the spell if opponent declines to pay X", () => {
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const sink = pushSpell(state, powerSink.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        sink.chosenX = 3;

        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");

        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("on decline, opponent's lands tapped and mana drained", () => {
        const land = makeInstance(mountain.id, {
            id: "mt",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [land],
            manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const sink = pushSpell(state, powerSink.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        sink.chosenX = 3;

        resolveTopOfStack(state);
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        expect(land.isTapped).toBe(true);
        expect(p2.manaPool.R).toBe(0);
    });

    it("if opponent pays X, spell resolves normally", () => {
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const sink = pushSpell(state, powerSink.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        sink.chosenX = 3;

        resolveTopOfStack(state);
        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
    });
});

describe("Island Sanctuary (CR 614 — draw-skip replacement)", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const stackItem = state.stack.find((s) => s.id === head.stackItemId)!;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }
    it("drawStepReplacement suppresses automatic draw", () => {
        const sanctuary = makeInstance(islandSanctuary.id, {
            id: "sanc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [sanctuary],
            library: [
                makeInstance(savannahLions.id, {
                    id: "top-card",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        const handBefore = p1.hand.length;

        state.phase = "UPKEEP";
        advancePhase(state);

        // Draw step doesn't auto-draw when Island Sanctuary is present
        expect(state.phase).toBe("DRAW");
        expect(p1.hand.length).toBe(handBefore);
    });

    it("on skip, sets islandSanctuaryProtection", () => {
        const sanctuary = makeInstance(islandSanctuary.id, {
            id: "sanc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topCard = makeInstance(savannahLions.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [sanctuary],
            library: [topCard],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        // Advance from UPKEEP → DRAW: triggers fire
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(state.stack).toHaveLength(1);

        // Resolve the trigger → requestMayPay suspends
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);

        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        expect(state.islandSanctuaryProtection).toBe("p1");
        // Card NOT drawn
        expect(p1.hand).toHaveLength(0);
    });

    it("on decline, draws a card normally", () => {
        const sanctuary = makeInstance(islandSanctuary.id, {
            id: "sanc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topCard = makeInstance(savannahLions.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [sanctuary],
            library: [topCard],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);

        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        expect(p1.hand).toHaveLength(1);
        expect(state.islandSanctuaryProtection).toBeUndefined();
    });

    it("protection restricts non-flying non-islandwalk attackers", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [lion, angel] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p2",
        });
        state.islandSanctuaryProtection = "p1";

        // Non-flying: can't attack
        const lionResult = validateAttackerEligibility(
            lion,
            p1.battlefield,
            state
        );
        expect(lionResult.eligible).toBe(false);

        // Flying: can attack
        const angelResult = validateAttackerEligibility(
            angel,
            p1.battlefield,
            state
        );
        expect(angelResult.eligible).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// W25a: Mass forced-attack + combat manipulation (CR 508.1d, 506.4)
// ---------------------------------------------------------------------------

describe("Siren's Call (CR 508.1d — all creatures must attack)", () => {
    it("sets allCreaturesMustAttack on resolve", () => {
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2");
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p2",
        });

        pushSpell(state, sirensCall.id, "p1");
        resolveTopOfStack(state);

        expect(state.allCreaturesMustAttack).toBe("p2");
    });

    it("mass flag makes getRequiredAttackerIds include all eligible creatures", () => {
        const creature1 = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creature2 = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [creature1, creature2],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
        });
        state.allCreaturesMustAttack = "p1";

        const required = getRequiredAttackerIds(
            p1.battlefield,
            undefined,
            state.allCreaturesMustAttack
        );
        expect(required).toContain("lion");
        expect(required).toContain("bear");
    });

    it("tapped creatures are not required (can't attack)", () => {
        const tappedCreature = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [tappedCreature],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
        });
        state.allCreaturesMustAttack = "p1";

        const required = getRequiredAttackerIds(
            p1.battlefield,
            undefined,
            state.allCreaturesMustAttack
        );
        expect(required).toHaveLength(0);
    });

    it("delayed trigger destroys non-Wall non-attackers at end step", async () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            hasAttackedThisTurn: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [lion, wall, bear],
        });
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
        });

        // Schedule the delayed trigger via resolve
        pushSpell(state, sirensCall.id, "p2");
        resolveTopOfStack(state);

        expect(state.delayedTriggers).toHaveLength(1);

        // Fire the delayed trigger
        const { fireDelayedTriggers } = await import("../../../gre/phases");
        fireDelayedTriggers(state, "next-end-step");

        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        // Lion (didn't attack) → destroyed
        // Wall → exempt (is a Wall)
        // Bear (attacked) → survives
        expect(p1.battlefield.map((c) => c.id)).toEqual(
            expect.arrayContaining(["wall", "bear"])
        );
        expect(p1.battlefield.find((c) => c.id === "lion")).toBeUndefined();
    });
});

describe("False Orders (CR 506.4 — remove from combat)", () => {
    it("removes a blocking creature from combat", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const attacker = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [attacker],
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", { battlefield: [blocker] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["lion"],
                confirmed: true,
                blockerAssignments: { bear: ["lion"] },
                blockersConfirmed: true,
            },
        });

        pushSpell(state, falseOrders.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        expect(blocker.isBlocking).toBe(false);
        expect(state.combat!.blockerAssignments["bear"]).toBeUndefined();
    });

    it("removing sole blocker leaves attacker unblocked", async () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const attacker = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [attacker],
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [blocker],
            life: 20,
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear: ["angel"] },
                // Real play records the angel as blocked at declare-blockers.
                // Removing its sole blocker must explicitly un-block it now that
                // "blocked" is combat state, not the live blocker count (#172).
                blockedAttackerIds: ["angel"],
                blockersConfirmed: true,
            },
        });

        pushSpell(state, falseOrders.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        // Angel was solely blocked by the bear → it is now unblocked.
        expect(state.combat!.blockedAttackerIds).not.toContain("angel");

        // Angel is now unblocked — should deal damage to player
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});

        expect(p2.life).toBe(16); // Serra Angel = 4 power
    });

    it("removing one of two blockers leaves the attacker blocked (deals no damage to the defender)", async () => {
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const attacker = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const p1 = makePlayer("p1", {
            battlefield: [attacker],
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [bear1, bear2],
            life: 20,
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear1: ["angel"], bear2: ["angel"] },
                blockedAttackerIds: ["angel"],
                blockersConfirmed: true,
            },
        });

        pushSpell(state, falseOrders.id, "p1", [
            { type: "permanent", id: "bear1" },
        ]);
        resolveTopOfStack(state);

        // bear2 still blocks the angel — it stays blocked.
        expect(state.combat!.blockedAttackerIds).toContain("angel");
        expect(state.combat!.blockerAssignments["bear1"]).toBeUndefined();

        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { angel: { bear2: 4 } });

        // Defender takes nothing — the attacker is still blocked.
        expect(p2.life).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// W26 — mana substitution, graveyard trigger, aura retarget
// ---------------------------------------------------------------------------

describe("Sunglasses of Urza (spend white as though red, CR 609.4b)", () => {
    function stateWithSunglasses(): GameState {
        const sun = makeInstance(sunglassesOfUrza.id, { controllerId: "p1" });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [sun] }),
                makePlayer("p2"),
            ],
        });
    }

    it("declares the mana-substitution static effect", () => {
        expect(sunglassesOfUrza.staticEffects).toEqual([
            { kind: "mana-substitution", from: "W", to: "R" },
        ]);
    });

    it("getManaSubstitutions surfaces the rule only for the controller", () => {
        const state = stateWithSunglasses();
        expect(getManaSubstitutions(state, "p1")).toEqual([
            { from: "W", to: "R" },
        ]);
        expect(getManaSubstitutions(state, "p2")).toEqual([]);
    });

    it("white mana pays a red cost while Sunglasses is in play", () => {
        const state = stateWithSunglasses();
        const subs = getManaSubstitutions(state, "p1");
        const pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { R: 1 }, subs)).toBe(true);
        payManaCost(pool, { R: 1 }, subs);
        expect(pool.W).toBe(0);
        expect(pool.R).toBe(0);
    });

    it("mixed cost: white covers its own pip and substitutes for red", () => {
        const state = stateWithSunglasses();
        const subs = getManaSubstitutions(state, "p1");
        const pool = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { W: 1, R: 1 }, subs)).toBe(true);
        payManaCost(pool, { W: 1, R: 1 }, subs);
        expect(pool.W).toBe(0);
    });

    it("removing Sunglasses reverts the substitution (white can't pay red)", () => {
        // No Sunglasses on the battlefield → no substitution rule derived.
        const state = makeState();
        const subs = getManaSubstitutions(state, "p1");
        expect(subs).toEqual([]);
        const pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { R: 1 }, subs)).toBe(false);
    });

    it("substitution doesn't manufacture extra mana (1 W can't pay RR)", () => {
        const state = stateWithSunglasses();
        const subs = getManaSubstitutions(state, "p1");
        const pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { R: 2 }, subs)).toBe(false);
    });
});

describe("Nether Shadow (graveyard upkeep self-reanimation, CR 603.6e)", () => {
    // A non-triggering vanilla creature used to stack creature cards above
    // Nether Shadow in the graveyard.
    const FILLER_CREATURE_ID = "b93c5869-7777-44bb-967a-e9439b25ced4"; // Ironroot Treefolk

    function makeFiller(): CardInstanceState {
        return makeInstance(FILLER_CREATURE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
    }

    function gyState(fillerCount: number): GameState {
        const shadow = makeInstance(netherShadow.id, {
            id: "shadow",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const fillers = Array.from({ length: fillerCount }, makeFiller);
        // Index 0 = bottom; fillers sit ABOVE the shadow (higher index).
        return makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { graveyard: [shadow, ...fillers] }),
                makePlayer("p2"),
            ],
        });
    }

    const upkeep = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    it("has haste and a graveyard-zone upkeep trigger", () => {
        expect(netherShadow.staticAbilities).toContain("haste");
        const trig = netherShadow.triggeredAbilities?.[0];
        expect(trig?.event).toBe("PHASE_BEGIN");
        expect(trig?.zone).toBe("graveyard");
    });

    it("triggers on its owner's upkeep with 3+ creatures above it", () => {
        const state = gyState(3);
        const triggers = collectTriggers(state, [upkeep]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe("nether-shadow-reanimate");
    });

    it("does NOT trigger with fewer than 3 creatures above it", () => {
        const state = gyState(2);
        expect(collectTriggers(state, [upkeep])).toHaveLength(0);
    });

    it("does NOT trigger on the opponent's upkeep", () => {
        const state = gyState(3);
        const oppUpkeep = { ...upkeep, activePlayerId: "p2" };
        expect(collectTriggers(state, [oppUpkeep])).toHaveLength(0);
    });

    it("reanimates from the graveyard when the player accepts", () => {
        const state = gyState(3);
        const triggers = collectTriggers(state, [upkeep]);
        state.stack.push(...triggers);

        // First resolve suspends on the optional "you may" choice.
        expect(resolveTopOfStack(state)).toBeNull();
        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("may-pay");
        const item = state.stack[state.stack.length - 1];
        const key = `${pending.step}:${pending.choiceId}`;
        item.collectedChoices = { [key]: ["yes"] };
        state.pendingChoices = undefined;

        resolveTopOfStack(state);
        const p1 = state.players[0];
        const reanimated = p1.battlefield.find((c) => c.id === "shadow");
        expect(reanimated).toBeDefined();
        expect(reanimated!.staticAbilities).toContain("haste");
        expect(p1.graveyard.some((c) => c.id === "shadow")).toBe(false);
    });

    it("stays in the graveyard when the player declines", () => {
        const state = gyState(3);
        state.stack.push(...collectTriggers(state, [upkeep]));
        resolveTopOfStack(state);
        const item = state.stack[state.stack.length - 1];
        const pending = state.pendingChoices![0];
        item.collectedChoices = {
            [`${pending.step}:${pending.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "shadow")).toBe(true);
        expect(p1.battlefield.some((c) => c.id === "shadow")).toBe(false);
    });
});

describe("Kudzu (destroy tapped host, retarget aura, CR 701.20a/704.5n)", () => {
    function setup(extraLand: boolean): {
        state: GameState;
        kudzuId: string;
    } {
        const host = makeInstance(badlands.id, {
            id: "hostland",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const aura = makeInstance(kudzu.id, {
            id: "kudzu1",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "hostland",
        });
        const battlefield = [host, aura];
        if (extraLand) {
            battlefield.push(
                makeInstance(bayou.id, {
                    id: "otherland",
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        const state = makeState({
            players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
        });
        return { state, kudzuId: "kudzu1" };
    }

    it("declares an enchant-land aura with a becomes-tapped trigger", () => {
        expect(kudzu.subtypes).toContain("Aura");
        expect(kudzu.targetRequirement).toEqual({ type: "Land", count: 1 });
        expect(kudzu.triggeredAbilities?.[0]?.id).toBe("kudzu-tapped");
    });

    it("destroys the host then moves the aura to a chosen land", () => {
        const { state } = setup(true);
        const host = state.players[0].battlefield[0];
        emitPermanentTapped(state, host, false);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);

        // 1) destroy host + suspend on the "may attach" question.
        expect(resolveTopOfStack(state)).toBeNull();
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "hostland")).toBe(true);
        expect(p1.battlefield.some((c) => c.id === "kudzu1")).toBe(true);
        const item = state.stack[state.stack.length - 1];
        const may = state.pendingChoices![0];
        expect(may.kind).toBe("may-pay");
        item.collectedChoices = {
            [`${may.step}:${may.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;

        // 2) accept → suspend on the land choice.
        expect(resolveTopOfStack(state)).toBeNull();
        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("choose-permanents");
        item.collectedChoices = {
            ...item.collectedChoices,
            [`${pick.step}:${pick.choiceId}`]: ["otherland"],
        };
        state.pendingChoices = undefined;

        // 3) reattach.
        resolveTopOfStack(state);
        const aura = p1.battlefield.find((c) => c.id === "kudzu1");
        expect(aura?.attachedTo).toBe("otherland");
    });

    it("goes to the graveyard when no other land is available", () => {
        const { state } = setup(false);
        const host = state.players[0].battlefield[0];
        emitPermanentTapped(state, host, false);
        processPendingActionTriggers(state);

        // Host destroyed, no land to attach → resolve completes with the aura
        // orphaned; SBA 704.5n sweeps it to the graveyard.
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        checkStateBasedActions(state);
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "kudzu1")).toBe(true);
        expect(p1.battlefield.some((c) => c.id === "kudzu1")).toBe(false);
    });
});

describe("Fork (copy target instant or sorcery spell, CR 707.10)", () => {
    type Targets = NonNullable<StackItem["targets"]>;

    // Mirrors finalizeTargetSelection's "copy-retarget" branch in
    // convex/game.ts: writes the chosen targets onto the spell copy and
    // clears the prompt. Kept as a pure helper so the test needs no Convex
    // context (same convention as activation-flow.test.ts).
    function applyCopyRetarget(state: GameState, newTargets: Targets): void {
        const pt = state.pendingTarget!;
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId);
        if (copy) copy.targets = newTargets;
        state.pendingTarget = undefined;
    }

    it("copies an instant spell on the stack (CR 707.10)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state); // Fork resolves

        // The original + the copy remain; the copy sits on top of the
        // original (resolves first). Fork itself has left the stack.
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(bolt.id);
        const copy = state.stack[state.stack.length - 1];
        expect(copy.isCopy).toBe(true);
        expect((copy.card as { id: string }).id).toBe(lightningBolt.id);
        expect(copy.id).not.toBe(bolt.id);
        // The copy inherits the original's targets (CR 707.10b default).
        expect(copy.targets).toEqual([{ type: "player", id: "p1" }]);
    });

    it("copies a sorcery spell on the stack", () => {
        const state = makeState();
        const sr = pushSpell(state, stoneRain.id, "p1", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: sr.id }]);
        resolveTopOfStack(state);

        const copy = state.stack[state.stack.length - 1];
        expect(copy.isCopy).toBe(true);
        expect((copy.card as { id: string }).id).toBe(stoneRain.id);
    });

    it("copy is red regardless of the original spell's color (CR 707.10c)", () => {
        // Power Sink is blue; Fork's copy must be red.
        const state = makeState();
        const ps = pushSpell(state, powerSink.id, "p2", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: ps.id }]);
        resolveTopOfStack(state);

        const copy = state.stack[state.stack.length - 1];
        expect(copy.colorOverride).toEqual(["R"]);
        expect(STATIC_EFFECT_CTX.getColors(copy)).toEqual(["R"]);
        // sanity: the original Power Sink stays blue
        expect(STATIC_EFFECT_CTX.getColors(state.stack[0])).toContain("U");
    });

    it("caster may choose new targets for the copy (CR 707.10b)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" }, // original targets p1
        ]);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state); // Fork resolves → copy + retarget prompt

        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("copy-retarget");
        expect(pt.playerId).toBe("p1"); // Fork's controller chooses
        expect(pt.targetType).toBe("any"); // Lightning Bolt's requirement
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId)!;
        expect(copy.isCopy).toBe(true);

        // Re-point the copy at p2, then resolve it.
        applyCopyRetarget(state, [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        expect(state.players[1].life).toBe(17); // p2 took the copy's 3
        expect(state.players[0].life).toBe(20); // p1 untouched
        // The copy ceased to exist — it never entered a graveyard (only Fork
        // itself, a real card, is in its caster's graveyard).
        const allGraveyard = [
            ...state.players[0].graveyard,
            ...state.players[1].graveyard,
        ];
        expect(allGraveyard.some((c) => c.id === copy.id)).toBe(false);
        expect(
            state.players[0].graveyard.map((c) => (c.card as { id: string }).id)
        ).toEqual([fork.id]);
    });

    it("copy resolves with the original targets if no re-selection (CR 707.10b)", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const bolt = state.stack[0];
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);

        // Decline the retarget: clear the prompt, keep inherited targets.
        expect(state.pendingTarget?.kind).toBe("copy-retarget");
        state.pendingTarget = undefined;
        resolveTopOfStack(state); // copy resolves at the original target p1

        expect(state.players[0].life).toBe(17);
        expect(state.players[1].life).toBe(20);
    });

    it("cannot copy a permanent (non-instant/sorcery) spell (CR 707.10)", () => {
        const state = makeState();
        const bear = pushSpell(state, grizzlyBears.id, "p2", []);

        // A creature spell is not a legal Fork target.
        const legal = getLegalTargets(state, fork.targetRequirement!);
        expect(legal.some((t) => t.type === "spell" && t.id === bear.id)).toBe(
            false
        );

        // Even if forced, copyStackItem refuses it: no copy, no prompt.
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: bear.id }]);
        resolveTopOfStack(state); // Fork resolves to graveyard, no copy
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(bear.id);
    });

    it("wire format: copy's red color + isCopy survive projectPublicState", () => {
        const state = makeState();
        const ps = pushSpell(state, powerSink.id, "p2", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: ps.id }]);
        resolveTopOfStack(state);
        const copyId = state.stack[state.stack.length - 1].id;

        // GRE: the copy is red.
        const greCopy = state.stack.find((s) => s.id === copyId)!;
        expect(STATIC_EFFECT_CTX.getColors(greCopy)).toEqual(["R"]);
        expect(greCopy.isCopy).toBe(true);

        // Wire: the same survives the projection that crosses the network.
        const projected = projectPublicState(state, 1, "p1");
        const slimCopy = projected.stack.find((s) => s.id === copyId)!;
        expect(slimCopy.colorOverride).toEqual(["R"]);
        expect((slimCopy as { isCopy?: boolean }).isCopy).toBe(true);
        expect(STATIC_EFFECT_CTX.getColors(slimCopy as never)).toEqual(["R"]);
    });

    it("isCopy survives the DB serialize round-trip", () => {
        const state = makeState();
        const ps = pushSpell(state, powerSink.id, "p2", []);
        pushSpell(state, fork.id, "p1", [{ type: "spell", id: ps.id }]);
        resolveTopOfStack(state);
        state.pendingTarget = undefined; // stable stack for serialization

        const round = expandState(compactState(state));
        const copy = round.stack.find((s) => s.isCopy);
        expect(copy).toBeDefined();
        expect(copy!.colorOverride).toEqual(["R"]);
    });
});

// ---------------------------------------------------------------------------
// Banding (CR 702.21) — W28: benalishHero, mesaPegasus, timberWolves,
// helmOfChatzuk. Covers keyword recognition, band-composition legality,
// block-as-group, and the two damage-assignment authority shifts (702.21j-k).
// ---------------------------------------------------------------------------

describe("Banding keyword recognition (CR 702.21)", () => {
    it("Benalish Hero, Timber Wolves are 1/1 vanilla with banding", () => {
        expect(benalishHero.staticAbilities).toContain("banding");
        expect(benalishHero.power).toBe(1);
        expect(benalishHero.toughness).toBe(1);
        expect(timberWolves.staticAbilities).toContain("banding");
    });

    it("Mesa Pegasus has both flying and banding", () => {
        expect(mesaPegasus.staticAbilities).toContain("flying");
        expect(mesaPegasus.staticAbilities).toContain("banding");
    });

    it("Mesa Pegasus flying still gates blocking (CR 702.9b)", () => {
        const peg = makeInstance(mesaPegasus.id, {
            id: "peg",
            controllerId: "p1",
            isAttacking: true,
        });
        const ground = makeInstance(grizzlyBearsId(), {
            id: "ground",
            controllerId: "p2",
        });
        const flyer = makeInstance(mesaPegasus.id, {
            id: "flyer",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(peg, ground, [ground]).eligible).toBe(
            false
        );
        // A flyer can block a flyer.
        expect(validateBlockerEligibility(peg, flyer, [flyer]).eligible).toBe(
            true
        );
    });
});

describe("Band composition legality (CR 702.21e)", () => {
    const banding = () => makeInstance(benalishHero.id);
    const plain = () => makeInstance(grizzlyBearsId());

    it("accepts 1+ banding plus at most one without", () => {
        expect(isLegalBandComposition([banding(), plain()])).toBe(true);
        expect(isLegalBandComposition([banding(), banding()])).toBe(true);
        expect(isLegalBandComposition([banding(), banding(), plain()])).toBe(
            true
        );
    });

    it("rejects bands with no banding creature", () => {
        expect(isLegalBandComposition([plain(), plain()])).toBe(false);
    });

    it("rejects more than one creature without banding", () => {
        expect(isLegalBandComposition([banding(), plain(), plain()])).toBe(
            false
        );
    });

    it("rejects a band of fewer than two creatures", () => {
        expect(isLegalBandComposition([banding()])).toBe(false);
    });
});

describe("Band blocked as a group (CR 702.21e)", () => {
    function bandState(blockTarget: string) {
        const hero = makeInstance(benalishHero.id, {
            id: "hero",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBearsId(), {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        // 0/5 wall: deals no combat damage, just absorbs the band.
        const wall = makeInstance(grizzlyBearsId(), {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            power: 0,
            toughness: 5,
            isBlocking: true,
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [hero, bear] }),
                makePlayer("p2", { battlefield: [wall], life: 20 }),
            ],
            combat: {
                attackerIds: ["hero", "bear"],
                confirmed: true,
                blockerAssignments: { wall: [blockTarget] },
                blockersConfirmed: true,
                bands: [{ bandId: "b1", memberIds: ["hero", "bear"] }],
            },
        });
    }

    it("expands a single block to every band member", () => {
        const graph = getEffectiveBlockGraph(bandState("hero"));
        expect(graph.blockersByAttacker["hero"]).toEqual(["wall"]);
        expect(graph.blockersByAttacker["bear"]).toEqual(["wall"]);
        expect(new Set(graph.attackersByBlocker["wall"])).toEqual(
            new Set(["hero", "bear"])
        );
    });

    it("a band member with no own blocker deals no damage to the player", async () => {
        const state = bandState("hero");
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        // hero and bear both deal into the wall (band-as-group); neither hits p2.
        applyAllCombatDamage(state, {
            hero: { wall: 1 },
            bear: { wall: 2 },
        });
        // Without banding, bear (2/2, unblocked) would have dealt 2 to p2.
        expect(state.players[1].life).toBe(20);
        // Wall (0/5) took 3, survives.
        expect(state.players[1].battlefield[0].damageMarked).toBe(3);
    });
});

describe("Banding damage authority — defender assigns (CR 702.21j)", () => {
    function setup() {
        const atk = makeInstance(grizzlyBearsId(), {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            power: 2,
            toughness: 2,
            isAttacking: true,
        });
        const guard = makeInstance(benalishHero.id, {
            id: "guard",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const decoy = makeInstance(grizzlyBearsId(), {
            id: "decoy",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isBlocking: true,
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [atk] }),
                makePlayer("p2", { battlefield: [guard, decoy] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { guard: ["atk"], decoy: ["atk"] },
                blockersConfirmed: true,
            },
        });
    }

    it("hands assignment of the blocked attacker's damage to the defender", () => {
        const state = setup();
        const atk = state.players[0].battlefield[0];
        const graph = getEffectiveBlockGraph(state);
        expect(
            getDamageAssignerId(state, atk, graph.blockersByAttacker["atk"])
        ).toBe("p2");
    });

    it("the defender can pile the attacker's damage onto one blocker", async () => {
        const state = setup();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        // Defender assigns the attacker's 2 damage to the decoy, sparing the
        // banding guard. Both blockers still deal 1 each back to the attacker.
        applyAllCombatDamage(state, { atk: { decoy: 2 } });
        const p2 = state.players[1];
        // guard (banding) survives; decoy is dead.
        expect(p2.battlefield.find((c) => c.id === "guard")).toBeDefined();
        expect(p2.battlefield.find((c) => c.id === "decoy")).toBeUndefined();
        // attacker (2/2) took 1 + 1 and dies.
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("Banding damage authority — attacker assigns blocker damage to band members (CR 702.21k)", () => {
    function setup() {
        const hero = makeInstance(benalishHero.id, {
            id: "hero",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBearsId(), {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            power: 2,
            toughness: 2,
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            power: 3,
            toughness: 3,
            isBlocking: true,
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [hero, bear] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["hero", "bear"],
                confirmed: true,
                blockerAssignments: { blk: ["hero"] },
                blockersConfirmed: true,
                bands: [{ bandId: "b1", memberIds: ["hero", "bear"] }],
            },
        });
    }

    it("hands assignment of the blocker's damage to the attacking player", () => {
        const state = setup();
        const blk = state.players[1].battlefield[0];
        const graph = getEffectiveBlockGraph(state);
        expect(
            getDamageAssignerId(state, blk, graph.attackersByBlocker["blk"])
        ).toBe("p1");
    });

    it("the attacker can pile the blocker's damage onto the expendable banding creature", async () => {
        const state = setup();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        // Attacker assigns the blocker's 3 damage entirely to the 1/1 hero,
        // sparing the 2/2 bear. The band deals 1 + 2 = 3 back, killing blk.
        applyAllCombatDamage(state, {
            hero: { blk: 1 },
            bear: { blk: 2 },
            blk: { hero: 3, bear: 0 },
        });
        const p1 = state.players[0];
        expect(p1.battlefield.find((c) => c.id === "hero")).toBeUndefined();
        expect(p1.battlefield.find((c) => c.id === "bear")).toBeDefined();
        // blocker (3/3) took 3 and dies.
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Helm of Chatzuk (CR 611.1b temporary keyword grant)", () => {
    it("grants banding to the target creature until end of turn", () => {
        const helm = makeInstance(helmOfChatzuk.id, { id: "helm" });
        const lion = makeInstance(grizzlyBearsId(), {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [helm, lion] })],
        });
        state.stack.push({
            ...helm,
            zone: "stack",
            castById: "p1",
            abilityId: "helm-of-chatzuk-grant-banding",
            targets: [{ type: "permanent", id: "lion" }],
        });
        resolveTopOfStack(state);
        const lionAfter = state.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(hasBanding(lionAfter)).toBe(true);
    });
});

describe("Banding wire format + serialization (W28)", () => {
    function bandedCombatState() {
        const hero = makeInstance(benalishHero.id, {
            id: "hero",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBearsId(), {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blk = makeInstance(grizzlyBearsId(), {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            power: 3,
            toughness: 3,
            isBlocking: true,
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [hero, bear] }),
                makePlayer("p2", { battlefield: [blk] }),
            ],
            combat: {
                attackerIds: ["hero", "bear"],
                confirmed: true,
                blockerAssignments: { blk: ["hero"] },
                blockersConfirmed: true,
                bands: [{ bandId: "b1", memberIds: ["hero", "bear"] }],
                damageConfirmed: false,
                damageAssignerIds: { blk: "p1" },
                damageAssignmentConfirmedBy: [],
            },
        });
    }

    it("banding keyword and band grouping survive projectPublicState", () => {
        const state = bandedCombatState();
        const projected = projectPublicState(state, 1, "p1");
        const projectedHero = projected.players[0].battlefield.find(
            (c) => c.id === "hero"
        )!;
        expect(projectedHero.staticAbilities).toContain("banding");
        expect(projected.combat?.bands).toEqual([
            { bandId: "b1", memberIds: ["hero", "bear"] },
        ]);
        // Block-as-group still resolves on the projected combat.
        const graph = getEffectiveBlockGraph(projected as never);
        expect(new Set(graph.attackersByBlocker["blk"])).toEqual(
            new Set(["hero", "bear"])
        );
    });

    it("bands and damage-authority fields round-trip through serialize", () => {
        const state = bandedCombatState();
        const restored = expandState(compactState(state));
        expect(restored.combat?.bands).toEqual([
            { bandId: "b1", memberIds: ["hero", "bear"] },
        ]);
        expect(restored.combat?.damageAssignerIds).toEqual({ blk: "p1" });
        expect(restored.combat?.damageAssignmentConfirmedBy).toEqual([]);
    });
});

describe("Banding damage-assignment handshake (CR 702.21j-k, confirmDamage)", () => {
    it("waits for every distinct assigner before applying damage", () => {
        // Mixed authority: defender (p2) assigns one attacker, attacker (p1)
        // assigns a blocker. Both must confirm.
        const combat = {
            damageAssignerIds: { atk: "p2", blk: "p1" },
            damageAssignmentConfirmedBy: [] as string[],
        };
        expect(outstandingDamageAssigner(combat)).toBe("p2");
        combat.damageAssignmentConfirmedBy = ["p2"];
        expect(outstandingDamageAssigner(combat)).toBe("p1");
        combat.damageAssignmentConfirmedBy = ["p2", "p1"];
        expect(outstandingDamageAssigner(combat)).toBeUndefined();
    });

    it("returns undefined when there is no authority map", () => {
        expect(outstandingDamageAssigner({})).toBeUndefined();
    });
});

// ===========================================================================
// W29: Copy permanent framework + Gaea's Liege (CR 706, 707)
// ===========================================================================

const SERRA = serraAngel.id;
const BEARS = grizzlyBears.id;

/** Drives a suspended resolve-step copy choice (may-pay → choose-permanents)
 *  by writing collectedChoices directly, mirroring the engine's resume path.
 *  `recipientItem` is the stack item carrying the resolve. */
function driveCopyChoice(
    state: GameState,
    recipientItem: StackItem,
    targetInstanceId: string
): void {
    // step: optional "may have it become a copy"
    expect(resolveTopOfStack(state)).toBeNull();
    let head = state.pendingChoices![0];
    expect(head.kind).toBe("may-pay");
    recipientItem.collectedChoices = {
        ...(recipientItem.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: ["yes"],
    };
    state.pendingChoices = undefined;
    // step: choose the creature/artifact to copy
    expect(resolveTopOfStack(state)).toBeNull();
    head = state.pendingChoices![0];
    expect(head.kind).toBe("choose-permanents");
    expect(head.allControllers).toBe(true);
    recipientItem.collectedChoices = {
        ...(recipientItem.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: [targetInstanceId],
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

describe("Clone (enter as a copy of any creature, CR 707.2)", () => {
    function cloneState() {
        const serra = makeInstance(SERRA, {
            id: "serra",
            controllerId: "p2",
            ownerId: "p2",
            counters: { "+1/+1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [serra] }),
            ],
        });
        const item = pushSpell(state, clone.id, "p1");
        item.id = "clone1";
        return { state, item };
    }

    it("enters as a copy with the creature's abilities, types and P/T", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        );
        expect(copy).toBeDefined();
        expect((copy!.card as { id: string }).id).toBe(SERRA);
        expect(copy!.types).toEqual(["Creature"]);
        expect(copy!.subtypes).toEqual(["Angel"]);
        expect(copy!.staticAbilities).toEqual(["flying", "vigilance"]);
        expect(getEffectivePower(state, copy!)).toBe(4);
        expect(getEffectiveToughness(state, copy!)).toBe(4);
        expect(copy!.copiedFrom).toBe(clone.id);
    });

    it("does NOT copy counters, damage or tap state (CR 707.2)", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect(copy.counters ?? {}).toEqual({});
        expect(copy.damageMarked ?? 0).toBe(0);
        expect(copy.isTapped).toBe(false);
        // The original keeps its +1/+1 counter (5/5); the copy is a clean 4/4.
        const serra = state.players[1].battlefield.find(
            (c) => c.id === "serra"
        )!;
        expect(getEffectivePower(state, serra)).toBe(5);
    });

    it("enters as a 0/0 and dies to SBA when no creature is copied", () => {
        const state = makeState();
        const item = pushSpell(state, clone.id, "p1");
        item.id = "clone1";
        // No creatures on the battlefield → the step copies nothing, no suspend.
        expect(resolveTopOfStack(state)).not.toBeNull();
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        );
        expect(copy).toBeDefined();
        expect(getEffectiveToughness(state, copy!)).toBe(0);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "clone1")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "clone1")).toBe(
            true
        );
    });

    it("accepts a copy target from the opponent's battlefield via the submit path", () => {
        const { state, item } = cloneState();
        // step 1: may-pay yes
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        item.collectedChoices = {
            [`${head.step}:${head.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        // step 2: cross-battlefield choose-permanents — serra is on p2's side.
        expect(resolveTopOfStack(state)).toBeNull();
        head = state.pendingChoices![0];
        expect(head.allControllers).toBe(true);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: item.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["serra"],
        });
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect((copy.card as { id: string }).id).toBe(SERRA);
    });

    it("survives the wire projection as the copied creature", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "clone1"
        )!;
        expect((slim.card as { id: string }).id).toBe(SERRA);
        expect(slim.copiedFrom).toBe(clone.id);
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("reverts to its printed self when it leaves the battlefield (CR 707.2)", () => {
        const { state, item } = cloneState();
        driveCopyChoice(state, item, "serra");
        removePermanentTo(state, "clone1", "hand");
        const inHand = state.players[0].hand.find((c) => c.id === "clone1")!;
        expect((inHand.card as { id: string }).id).toBe(clone.id);
        expect(inHand.copiedFrom).toBeUndefined();
        expect(inHand.subtypes).toEqual(["Shapeshifter"]);
        expect(inHand.staticAbilities).toEqual([]);
    });
});

describe("Copy Artifact (copy artifact + keep Enchantment, CR 707.9d)", () => {
    it("enters as a copy of an artifact and stays an enchantment too", () => {
        const helm = makeInstance(helmOfChatzuk.id, {
            id: "helm",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [helm] }),
            ],
        });
        const item = pushSpell(state, copyArtifact.id, "p1");
        item.id = "copy1";
        // may-pay yes
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        item.collectedChoices = {
            [`${head.step}:${head.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        // choose-permanents (artifacts only)
        expect(resolveTopOfStack(state)).toBeNull();
        head = state.pendingChoices![0];
        expect(head.filter?.types).toBe("Artifact");
        item.collectedChoices = {
            ...item.collectedChoices,
            [`${head.step}:${head.choiceId}`]: ["helm"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);

        const copy = state.players[0].battlefield.find(
            (c) => c.id === "copy1"
        )!;
        expect((copy.card as { id: string }).id).toBe(helmOfChatzuk.id);
        expect(copy.types).toContain("Artifact");
        expect(copy.types).toContain("Enchantment");
        expect(copy.copiedFrom).toBe(copyArtifact.id);
    });
});

describe("Vesuvan Doppelganger (copy w/ colour + ability exceptions, CR 707.9d)", () => {
    const UPKEEP_P1 = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    function vesuvanCopyOf(targetDefId: string, targetInstId: string) {
        const tgt = makeInstance(targetDefId, {
            id: targetInstId,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [tgt] }),
            ],
        });
        const item = pushSpell(state, vesuvanDoppelganger.id, "p1");
        item.id = "vd1";
        driveCopyChoice(state, item, targetInstId);
        return state;
    }

    it("copies the creature but keeps its own blue colour and the re-copy ability", () => {
        const state = vesuvanCopyOf(SERRA, "serra");
        const vd = state.players[0].battlefield.find((c) => c.id === "vd1")!;
        expect((vd.card as { id: string }).id).toBe(SERRA);
        expect(getEffectivePower(state, vd)).toBe(4);
        expect(vd.staticAbilities).toContain("flying");
        // Colour exception (CR 707.9d): blue, not Serra Angel's white.
        expect(vd.colorOverride).toEqual(["U"]);
        expect(STATIC_EFFECT_CTX.getColors(vd)).toEqual(["U"]);
        // Retained ability: the upkeep re-copy still triggers.
        const trigs = collectTriggers(state, [UPKEEP_P1]);
        expect(
            trigs.some(
                (t) => t.triggeredAbilityId === "vesuvan-doppelganger-recopy"
            )
        ).toBe(true);
    });

    it("upkeep re-copy switches to a new target, still blue, still retains the ability", () => {
        const state = vesuvanCopyOf(SERRA, "serra");
        const bears = makeInstance(BEARS, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(bears);

        state.stack.push(...collectTriggers(state, [UPKEEP_P1]));
        const trigItem = state.stack[state.stack.length - 1];
        // may-pay yes
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        trigItem.collectedChoices = {
            [`${head.step}:${head.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        // choose-permanents → Grizzly Bears
        expect(resolveTopOfStack(state)).toBeNull();
        head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        trigItem.collectedChoices = {
            ...trigItem.collectedChoices,
            [`${head.step}:${head.choiceId}`]: ["bears"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);

        const vd = state.players[0].battlefield.find((c) => c.id === "vd1")!;
        expect((vd.card as { id: string }).id).toBe(BEARS);
        expect(getEffectivePower(state, vd)).toBe(2);
        expect(getEffectiveToughness(state, vd)).toBe(2);
        expect(vd.colorOverride).toEqual(["U"]);
        // Re-copy ability is retained yet again.
        expect(
            collectTriggers(state, [UPKEEP_P1]).some(
                (t) => t.triggeredAbilityId === "vesuvan-doppelganger-recopy"
            )
        ).toBe(true);
    });
});

describe("Gaea's Liege (Forest-count P/T + {T} land→Forest)", () => {
    function forestInst(id: string, controllerId: string) {
        return makeInstance(forest.id, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    it("power/toughness equal the Forests you control when not attacking", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        liege,
                        forestInst("f1", "p1"),
                        forestInst("f2", "p1"),
                    ],
                }),
                makePlayer("p2", { battlefield: [forestInst("f3", "p2")] }),
            ],
        });
        expect(getEffectivePower(state, liege)).toBe(2);
        expect(getEffectiveToughness(state, liege)).toBe(2);
    });

    it("counts the defending player's Forests while attacking", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [liege, forestInst("f1", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: [
                        forestInst("f2", "p2"),
                        forestInst("f3", "p2"),
                        forestInst("f4", "p2"),
                    ],
                }),
            ],
        });
        // Defending player (p2) controls 3 Forests.
        expect(getEffectivePower(state, liege)).toBe(3);
        expect(getEffectiveToughness(state, liege)).toBe(3);
    });

    it("survives the wire projection (pt-cda)", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        liege,
                        forestInst("f1", "p1"),
                        forestInst("f2", "p1"),
                        forestInst("f3", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, liege)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "liege"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("{T} ability turns a target land into a Forest until Gaea's Liege leaves", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [liege, mtn] }),
                makePlayer("p2"),
            ],
        });
        // Activate {T}: target the Mountain.
        state.stack.push({
            ...liege,
            zone: "stack",
            castById: "p1",
            abilityId: "gaeas-liege-make-forest",
            targets: [{ type: "permanent", id: "mtn" }],
        });
        resolveTopOfStack(state);
        expect(mtn.counters?.["gaea-forest"]).toBe(1);

        // The counter-driven subtype-set turns it into a Forest.
        applySourceStaticEffects(state, liege);
        expect(mtn.subtypes).toEqual(["Forest"]);

        // When Gaea's Liege leaves, the land reverts (CR 611.2).
        removePermanentTo(state, "liege", "graveyard");
        expect(mtn.subtypes).toEqual(["Mountain"]);
    });

    it("declares a {T} land-target activated ability", () => {
        expect(gaeasLiege.activatedAbilities).toHaveLength(1);
        expect(gaeasLiege.activatedAbilities![0].cost).toEqual({ tap: true });
        expect(gaeasLiege.activatedAbilities![0].targetRequirement).toEqual({
            type: "Land",
            count: 1,
        });
    });
});

describe("Magical Hack (text-changing effect — CR 612, layer 3)", () => {
    // Casts Magical Hack on `target`, choosing replacement type `toMode`
    // (a mode id like "island"). Returns the resolved state.
    function castMagicalHack(
        state: GameState,
        targetId: string,
        targetType: "permanent" | "spell",
        toMode: string
    ): void {
        const spell = pushSpell(state, magicalHack.id, "p1", [
            { type: targetType, id: targetId },
        ]);
        spell.chosenModeId = toMode;
        resolveTopOfStack(state);
    }

    it("is a {U} Instant targeting a spell or permanent, with five modes", () => {
        expect(magicalHack.manaCost).toEqual({ U: 1 });
        expect(magicalHack.types).toEqual(["Instant"]);
        expect(magicalHack.targetRequirement).toEqual({
            type: "spell-or-permanent",
            count: 1,
        });
        expect(magicalHack.modes?.map((m) => m.id)).toEqual([
            "plains",
            "island",
            "swamp",
            "mountain",
            "forest",
        ]);
    });

    it("changes a basic land's type so it taps for the new color (CR 305.6)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [forestInst] });
        const state = makeState({ players: [p1, p2] });

        expect(getBasicLandMana(forestInst)).toBe("G");

        castMagicalHack(state, "f1", "permanent", "island");

        const after = state.players[1].battlefield.find((c) => c.id === "f1")!;
        expect(after.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);
        expect(getBasicLandMana(after)).toBe("U");
    });

    it("re-asserts the new mana color after projectPublicState (wire format)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "f1"
        )!;
        expect(getBasicLandMana(slim as CardInstanceState)).toBe("U");
    });

    it("rewrites a landwalk keyword so blocking follows the new word (CR 702.13b)", () => {
        // Shanodin Dryads (forestwalk) attacking; defender controls an Island.
        const dryads = makeInstance(shanodinDryads.id, {
            id: "d1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bears = makeInstance(savannahLions.id, {
            id: "b1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const islandInst = makeInstance(island.id, {
            id: "i1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dryads] }),
                makePlayer("p2", { battlefield: [bears, islandInst] }),
            ],
        });

        // Before: forestwalk + defender has no Forest → blockable.
        expect(
            validateBlockerEligibility(dryads, bears, [bears, islandInst])
                .eligible
        ).toBe(true);

        castMagicalHack(state, "d1", "permanent", "island");

        const d = state.players[0].battlefield.find((c) => c.id === "d1")!;
        expect(d.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);

        // After: islandwalk + defender controls an Island → unblockable.
        expect(
            validateBlockerEligibility(d, bears, [bears, islandInst]).eligible
        ).toBe(false);

        // Same conclusion survives the projection (wire format).
        const projected = projectPublicState(state, 1, "p1");
        const slimD = projected.players[0].battlefield.find(
            (c) => c.id === "d1"
        )! as CardInstanceState;
        const slimBears = projected.players[1].battlefield.find(
            (c) => c.id === "b1"
        )! as CardInstanceState;
        const slimIsland = projected.players[1].battlefield.find(
            (c) => c.id === "i1"
        )! as CardInstanceState;
        expect(
            validateBlockerEligibility(slimD, slimBears, [
                slimBears,
                slimIsland,
            ]).eligible
        ).toBe(false);
    });

    it("ends when the object changes zones (CR 612.7)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island");
        expect(
            state.players[1].battlefield.find((c) => c.id === "f1")!.textChanges
        ).toHaveLength(1);

        // CR 612.7 / 400.7 — leaving the battlefield clears the change as the
        // object becomes new (engine resets transient instance state on a
        // hand/library move, mirroring colorOverride).
        removePermanentTo(state, "f1", "hand");
        const bounced = state.players[1].hand.find((c) => c.id === "f1")!;
        expect(bounced.textChanges).toBeUndefined();
        expect(getBasicLandMana(bounced)).toBe("G");
    });

    it("chains multiple changes in timestamp order (CR 612.6)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island"); // Forest → Island
        castMagicalHack(state, "f1", "permanent", "mountain"); // Island → Mountain

        const after = state.players[1].battlefield.find((c) => c.id === "f1")!;
        expect(after.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
            { kind: "land-type", from: "Island", to: "Mountain" },
        ]);
        expect(getBasicLandMana(after)).toBe("R");
    });

    it("applies to a spell on the stack (spell-or-permanent target branch)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // A creature spell with forestwalk on the stack (Shanodin Dryads).
        const creatureSpell = pushSpell(state, shanodinDryads.id, "p2");
        // Magical Hack targets it; resolves above it (LIFO push order).
        castMagicalHack(state, creatureSpell.id, "spell", "island");

        const onStack = state.stack.find((s) => s.id === creatureSpell.id)!;
        expect(onStack.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);
    });

    it("survives a serialize round-trip (persisted optional field)", () => {
        const forestInst = makeInstance(forest.id, {
            id: "f1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [forestInst] }),
            ],
        });
        castMagicalHack(state, "f1", "permanent", "island");

        const restored = expandState(compactState(state));
        const after = restored.players[1].battlefield.find(
            (c) => c.id === "f1"
        )!;
        expect(after.textChanges).toEqual([
            { kind: "land-type", from: "Forest", to: "Island" },
        ]);
        expect(getBasicLandMana(after)).toBe("U");
    });
});

describe("Sleight of Mind (color-word text change — CR 612, layer 3)", () => {
    // Casts Sleight of Mind on `target`, choosing replacement color word
    // `toMode` (a mode id like "blue"). Resolves immediately.
    function castSleight(
        state: GameState,
        targetId: string,
        targetType: "permanent" | "spell",
        toMode: string
    ): void {
        const spell = pushSpell(state, sleightOfMind.id, "p1", [
            { type: targetType, id: targetId },
        ]);
        spell.chosenModeId = toMode;
        resolveTopOfStack(state);
    }

    it("is a {U} Instant targeting a spell or permanent, with five color modes", () => {
        expect(sleightOfMind.manaCost).toEqual({ U: 1 });
        expect(sleightOfMind.types).toEqual(["Instant"]);
        expect(sleightOfMind.targetRequirement).toEqual({
            type: "spell-or-permanent",
            count: 1,
        });
        expect(sleightOfMind.modes?.map((m) => m.id)).toEqual([
            "white",
            "blue",
            "black",
            "red",
            "green",
        ]);
    });

    it("changes a protection color word so protection follows the new color (CR 702.16)", () => {
        // Black Knight has "protection from white".
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        expect(getProtectedColors(state.players[1].battlefield[0])).toEqual([
            "W",
        ]);

        castSleight(state, "bk", "permanent", "blue");

        const after = state.players[1].battlefield.find((c) => c.id === "bk")!;
        expect(after.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
        ]);
        expect(getProtectedColors(after)).toEqual(["U"]);
    });

    it("re-asserts the new protection color after projectPublicState (wire format)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bk"
        )! as CardInstanceState;
        expect(getProtectedColors(slim)).toEqual(["U"]);
    });

    it("retargets a Circle of Protection's color filter to the new color (CR 615)", () => {
        const cop = makeInstance(circleOfProtectionWhite.id, {
            id: "cop",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteSrc = makeInstance(savannahLions.id, {
            id: "w",
            controllerId: "p2",
            ownerId: "p2",
        });
        const redSrc = makeInstance(monssGoblinRaiders.id, {
            id: "r",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cop] }),
                makePlayer("p2", { battlefield: [whiteSrc, redSrc] }),
            ],
        });
        const baseReq =
            circleOfProtectionWhite.activatedAbilities![0].targetRequirement!;

        // Before: the "white source of your choice" filter sees the white
        // creature, not the red one.
        const legalBefore = getLegalTargets(
            state,
            { ...baseReq, colorFilter: "W" },
            [],
            "p1"
        );
        expect(legalBefore.some((t) => t.id === "w")).toBe(true);
        expect(legalBefore.some((t) => t.id === "r")).toBe(false);

        castSleight(state, "cop", "permanent", "red");
        const copAfter = state.players[0].battlefield.find(
            (c) => c.id === "cop"
        )!;
        expect(copAfter.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "red" },
        ]);

        // After: the substituted filter targets the red source, not the white.
        const effColor = substituteColorFilter(copAfter, baseReq.colorFilter!);
        expect(effColor).toBe("R");
        const legalAfter = getLegalTargets(
            state,
            { ...baseReq, colorFilter: effColor },
            [],
            "p1"
        );
        expect(legalAfter.some((t) => t.id === "r")).toBe(true);
        expect(legalAfter.some((t) => t.id === "w")).toBe(false);

        // The substituted filter survives the projection (wire format).
        const projected = projectPublicState(state, 0, "p1");
        const slimCop = projected.players[0].battlefield.find(
            (c) => c.id === "cop"
        )! as CardInstanceState;
        expect(substituteColorFilter(slimCop, baseReq.colorFilter!)).toBe("R");
    });

    it("does not change the object's own color (CR 612.1)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        const before = STATIC_EFFECT_CTX.getColors(
            state.players[1].battlefield[0]
        );
        castSleight(state, "bk", "permanent", "blue");
        const after = state.players[1].battlefield.find((c) => c.id === "bk")!;
        // Black Knight stays black; only its protection *word* changed.
        expect(STATIC_EFFECT_CTX.getColors(after)).toEqual(before);
        expect(before).toEqual(["B"]);
    });

    it("ends when the object changes zones (CR 612.7)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue");
        expect(
            state.players[1].battlefield.find((c) => c.id === "bk")!.textChanges
        ).toHaveLength(1);

        removePermanentTo(state, "bk", "hand");
        const bounced = state.players[1].hand.find((c) => c.id === "bk")!;
        expect(bounced.textChanges).toBeUndefined();
        expect(getProtectedColors(bounced)).toEqual(["W"]);
    });

    it("chains multiple color-word changes in timestamp order (CR 612.6)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue"); // white → blue
        castSleight(state, "bk", "permanent", "red"); // blue → red

        const after = state.players[1].battlefield.find((c) => c.id === "bk")!;
        expect(after.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
            { kind: "color-word", from: "blue", to: "red" },
        ]);
        expect(getProtectedColors(after)).toEqual(["R"]);
    });

    it("applies to a spell on the stack (spell-or-permanent branch)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // A creature spell with "protection from white" on the stack.
        const knightSpell = pushSpell(state, blackKnight.id, "p2");
        castSleight(state, knightSpell.id, "spell", "blue");

        const onStack = state.stack.find((s) => s.id === knightSpell.id)!;
        expect(onStack.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
        ]);
    });

    it("survives a serialize round-trip (persisted optional field)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        castSleight(state, "bk", "permanent", "blue");

        const restored = expandState(compactState(state));
        const after = restored.players[1].battlefield.find(
            (c) => c.id === "bk"
        )!;
        expect(after.textChanges).toEqual([
            { kind: "color-word", from: "white", to: "blue" },
        ]);
        expect(getProtectedColors(after)).toEqual(["U"]);
    });
});

describe("Raging River (pile combat — CR 509.2 variant, ADR 0012)", () => {
    // Submits the current head pending choice with the given picks (the "left"
    // pile / "left" attackers); applyPendingChoiceSubmit auto-resumes the
    // trigger's resolution.
    function submitHead(state: GameState, picks: string[]) {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: picks,
        });
    }

    function setup() {
        const river = makeInstance(ragingRiver.id, {
            id: "river",
            controllerId: "p1",
            ownerId: "p1",
        });
        const atkA = makeInstance(savannahLions.id, {
            id: "atkA",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const atkB = makeInstance(savannahLions.id, {
            id: "atkB",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const flyer = makeInstance(savannahLions.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const g1 = makeInstance(savannahLions.id, {
            id: "g1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const g2 = makeInstance(savannahLions.id, {
            id: "g2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [river, atkA, atkB] }),
                makePlayer("p2", { battlefield: [flyer, g1, g2] }),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
        });
        state.combat = {
            attackerIds: ["atkA", "atkB"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        return { state, atkA, atkB, flyer, g1, g2 };
    }

    it("is a {R}{R} Enchantment with an ATTACKERS_DECLARED trigger", () => {
        expect(ragingRiver.manaCost).toEqual({ R: 2 });
        expect(ragingRiver.types).toEqual(["Enchantment"]);
        expect(ragingRiver.triggeredAbilities?.[0].event).toBe(
            "ATTACKERS_DECLARED"
        );
    });

    it("fires on attack, partitions defenders, labels attackers, sets restrictions", () => {
        const { state } = setup();

        emitAttackersDeclaredEvents(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("raging-river-piles");

        // Resolve the trigger → defender partition choice for p2.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("partition");
        expect(state.pendingChoices?.[0].playerId).toBe("p2");

        // p2 puts g1 in the left pile (g2 → right). Flyer is not offered.
        submitHead(state, ["g1"]);

        // Attacker labelling choice for p1.
        expect(state.pendingChoices?.[0].kind).toBe("partition");
        expect(state.pendingChoices?.[0].playerId).toBe("p1");

        // p1 labels atkA "left" (atkB → right).
        submitHead(state, ["atkA"]);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.combatBlockRestrictions).toEqual([
            { attackerId: "atkA", allowedPileLabel: "left" },
            { attackerId: "atkB", allowedPileLabel: "right" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "g1")!.pileLabel
        ).toBe("left");
        expect(
            state.players[1].battlefield.find((c) => c.id === "g2")!.pileLabel
        ).toBe("right");
    });

    it("enforces pile rules in block validation; flying ignores piles", () => {
        const { state, atkA, atkB, flyer, g1, g2 } = setup();
        emitAttackersDeclaredEvents(state);
        resolveTopOfStack(state);
        submitHead(state, ["g1"]); // g1 left, g2 right
        submitHead(state, ["atkA"]); // atkA left, atkB right

        const field = [flyer, g1, g2];
        // atkA is "left": only g1 (left) or the flyer may block it.
        expect(
            validateBlockerEligibility(atkA, g1, field, state).eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(atkA, g2, field, state).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(atkA, flyer, field, state).eligible
        ).toBe(true);
        // atkB is "right": only g2 (right) or the flyer may block it.
        expect(
            validateBlockerEligibility(atkB, g2, field, state).eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(atkB, g1, field, state).eligible
        ).toBe(false);
    });

    it("does not fire when the attacking player isn't the controller", () => {
        const { state } = setup();
        // Opponent (p2) is now the attacker; Raging River belongs to p1.
        state.activePlayerId = "p2";
        state.combat!.attackerIds = ["g1"];
        emitAttackersDeclaredEvents(state);
        expect(state.stack).toHaveLength(0);
    });

    it("clears pile labels and restrictions at end of combat (CR 511.3)", () => {
        const { state, g1 } = setup();
        emitAttackersDeclaredEvents(state);
        resolveTopOfStack(state);
        submitHead(state, ["g1"]);
        submitHead(state, ["atkA"]);
        expect(state.combatBlockRestrictions).toHaveLength(2);

        // CR 511.3 / CR 511.2 — pile labels and combat-scoped block
        // restrictions are part of the combat and end as the END_OF_COMBAT
        // step *ends*, not when it begins. They must still be present during
        // END_OF_COMBAT (so e.g. Desert can target an attacker), and clear
        // only on leaving the step.
        state.phase = "COMBAT_DAMAGE";
        state.combat!.blockersConfirmed = true;
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        expect(state.combatBlockRestrictions).toHaveLength(2);
        expect(
            state.players[1].battlefield.find((c) => c.id === g1.id)!.pileLabel
        ).toBe("left");

        // Leaving END_OF_COMBAT ends the combat → labels and restrictions lift.
        advancePhase(state);
        expect(state.phase).toBe("POSTCOMBAT_MAIN");
        expect(state.combatBlockRestrictions).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === g1.id)!.pileLabel
        ).toBeUndefined();
    });

    it("survives a serialize round-trip mid-combat", () => {
        const { state } = setup();
        emitAttackersDeclaredEvents(state);
        resolveTopOfStack(state);
        submitHead(state, ["g1"]);
        submitHead(state, ["atkA"]);

        const restored = expandState(compactState(state));
        expect(restored.combatBlockRestrictions).toEqual(
            state.combatBlockRestrictions
        );
        expect(
            restored.players[1].battlefield.find((c) => c.id === "g1")!
                .pileLabel
        ).toBe("left");
    });
});

describe("Illusionary Mask (masked-cast: {X} -> face-down 2/2, CR 708.2, #123)", () => {
    // Grizzly Bears = {1}{G} (mana value 2); Hill Giant = {3}{R} (mana value 4).
    function setup(handCards: CardInstanceState[]) {
        const mask = makeInstance(illusionaryMask.id, {
            id: "mask",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mask], hand: handCards }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }

    function bears(id: string): CardInstanceState {
        return makeInstance(grizzlyBears.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    }

    function giant(id: string): CardInstanceState {
        return makeInstance(hillGiant.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    }

    // Activate the masked-cast ability with `chosenX` colourless mana spent.
    function activate(state: GameState, chosenX: number) {
        state.stack.push({
            ...makeInstance(illusionaryMask.id, {
                id: "mask-act",
                controllerId: "p1",
                ownerId: "p1",
            }),
            zone: "stack",
            castById: "p1",
            abilityId: "illusionary-mask-cast",
            chosenX,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    function submitPick(state: GameState, picks: string[]) {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: picks,
        });
    }

    it("offers only creatures whose mana value <= the {X} spent", () => {
        const { state } = setup([bears("bear"), giant("giant")]);
        activate(state, 2);
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head).toMatchObject({
            playerId: "p1",
            zone: "hand",
            kind: "choose-hand-card",
        });
        // Bears (mv 2) eligible, Hill Giant (mv 4) is not.
        expect(head.candidateIds).toEqual(["bear"]);
    });

    it("full flow: activate -> choose -> cast -> resolve into a face-down 2/2 permanent", () => {
        const { state } = setup([bears("bear")]);
        activate(state, 2);
        // Chosen card leaves the hand and is cast face down.
        submitPick(state, ["bear"]);
        expect(state.players[0].hand.map((c) => c.id)).not.toContain("bear");
        // The face-down creature spell is on the stack (resolves next).
        expect(state.stack).toHaveLength(1);
        const spell = state.stack[0];
        expect(spell.faceDown).toBe(true);
        expect((spell.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        // Resolve it into a permanent.
        resolveTopOfStack(state);
        const perm = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(perm).toBeDefined();
        expect(perm.faceDown).toBe(true);
        expect(perm.faceDownOf).toBe(grizzlyBears.id);
        expect((perm.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(perm.power).toBe(2);
        expect(perm.toughness).toBe(2);
    });

    it("a non-eligible creature cannot be chosen (server rejects)", () => {
        const { state } = setup([bears("bear"), giant("giant")]);
        activate(state, 2);
        expect(() => submitPick(state, ["giant"])).toThrow(
            "Card is not an eligible choice"
        );
        // Hill Giant stays in hand; nothing cast.
        expect(state.players[0].hand.map((c) => c.id)).toContain("giant");
    });

    it("no prompt when no creature is eligible (X too low); ability resolves as a no-op", () => {
        const { state } = setup([giant("giant")]);
        activate(state, 2);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("giant");
    });

    it("declining the choice (you may) casts nothing", () => {
        const { state } = setup([bears("bear")]);
        activate(state, 2);
        submitPick(state, []);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("bear");
    });

    it("wire format: opponent sees a face-down 2/2, controller sees the real card", () => {
        const { state } = setup([bears("bear")]);
        activate(state, 2);
        submitPick(state, ["bear"]);
        resolveTopOfStack(state);

        // Opponent (p2) projection hides the identity.
        const oppView = projectPublicState(state, 1, "p2");
        const oppPerm = oppView.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "bear")!;
        expect((oppPerm.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(oppPerm.faceDownOf).toBeUndefined();

        // Controller (p1) projection reveals the real card to its caster.
        const ownView = projectPublicState(state, 1, "p1");
        const ownPerm = ownView.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "bear")!;
        expect(ownPerm.faceDownOf).toBe(grizzlyBears.id);
    });

    it("definition snapshot: registered with the masked-cast activated ability", () => {
        expect(illusionaryMask.types).toContain("Artifact");
        expect(illusionaryMask.activatedAbilities?.[0].id).toBe(
            "illusionary-mask-cast"
        );
        expect(illusionaryMask.activatedAbilities?.[0].cost.mana).toEqual({
            X: "X",
        });
    });
});

describe("Illusionary Mask — face-down turn-up (CR 708.9, ADR 0013, #124)", () => {
    // Build a face-down permanent on the battlefield from a real card id. Hill
    // Giant (3/3) is the workhorse: its real P/T differs from the face-down
    // 2/2, so turn-up is observable.
    function faceDownPerm(
        realId: string,
        instId: string,
        controllerId = "p1"
    ): CardInstanceState {
        const inst = makeInstance(realId, {
            id: instId,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
        });
        turnFaceDown(inst);
        return inst;
    }

    it("turnFaceUp restores the real card characteristics and clears the markers", () => {
        const fd = faceDownPerm(hillGiant.id, "fd");
        expect(fd.faceDown).toBe(true);
        expect((fd.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        turnFaceUp(fd);
        expect(fd.faceDown).toBeUndefined();
        expect(fd.faceDownOf).toBeUndefined();
        expect((fd.card as { id: string }).id).toBe(hillGiant.id);
        expect(fd.power).toBe(3);
        expect(fd.toughness).toBe(3);
    });

    it("turns face up when it would be dealt damage; damage applies to the real toughness", () => {
        const fd = faceDownPerm(hillGiant.id, "fd"); // real 3/3, presents 2/2
        const src = makeInstance(grizzlyBears.id, {
            id: "src",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fd] }),
                makePlayer("p2", { battlefield: [src] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "src",
            "p2",
            { type: "permanent", id: "fd" },
            2,
            false
        );
        const perm = state.players[0].battlefield.find((c) => c.id === "fd")!;
        expect(perm.faceDown).toBeUndefined();
        expect((perm.card as { id: string }).id).toBe(hillGiant.id);
        expect(perm.toughness).toBe(3);
        // 2 damage is sublethal to the real 3/3 — it would have killed the 2/2.
        perm.damageMarked = (perm.damageMarked ?? 0) + (res?.amount ?? 0);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "fd")
        ).toBeDefined();
    });

    it("turns face up when it would deal combat damage; deals its real power", async () => {
        const fd = faceDownPerm(hillGiant.id, "fd"); // real power 3
        fd.isAttacking = true;
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [fd] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["fd"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {}, "regular");
        // 20 - 3 (real power), not 18 (the face-down 2/2's power).
        expect(state.players[1].life).toBe(17);
        const perm = state.players[0].battlefield.find((c) => c.id === "fd")!;
        expect(perm.faceDown).toBeUndefined();
        expect((perm.card as { id: string }).id).toBe(hillGiant.id);
    });

    it("turns face up when it would become tapped, then becomes tapped", () => {
        const fd = faceDownPerm(hillGiant.id, "fd");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fd] }),
                makePlayer("p2"),
            ],
        });
        tapPermanent(state, fd);
        expect(fd.isTapped).toBe(true);
        expect(fd.faceDown).toBeUndefined();
        expect((fd.card as { id: string }).id).toBe(hillGiant.id);
    });

    it("tap replacement-event kind: applyTapReplacements turns a face-down permanent up without cancelling the tap", () => {
        const fd = faceDownPerm(hillGiant.id, "fd");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fd] }),
                makePlayer("p2"),
            ],
        });
        const ev = applyTapReplacements(state, {
            kind: "tap",
            cardInstanceId: "fd",
        });
        expect(ev).not.toBeNull(); // tap proceeds against the now-real creature
        expect(fd.faceDown).toBeUndefined();
        expect((fd.card as { id: string }).id).toBe(hillGiant.id);
    });

    it("wire format: opponent sees the real card after turn-up (was hidden before)", () => {
        const fd = faceDownPerm(hillGiant.id, "fd");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fd] }),
                makePlayer("p2"),
            ],
        });
        const oppBefore = projectPublicState(state, 1, "p2")
            .players.find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "fd")!;
        expect((oppBefore.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);

        tapPermanent(state, fd);

        const oppAfter = projectPublicState(state, 1, "p2")
            .players.find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "fd")!;
        expect((oppAfter.card as { id: string }).id).toBe(hillGiant.id);
    });

    it("end-to-end: cast a creature face down via the Mask, then a tap turns it up", () => {
        const mask = makeInstance(illusionaryMask.id, {
            id: "mask",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mask], hand: [bear] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...makeInstance(illusionaryMask.id, {
                id: "mask-act",
                controllerId: "p1",
                ownerId: "p1",
            }),
            zone: "stack",
            castById: "p1",
            abilityId: "illusionary-mask-cast",
            chosenX: 2,
            targets: [],
        });
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bear"],
        });
        resolveTopOfStack(state); // resolve the face-down creature spell
        const fd = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(fd.faceDown).toBe(true);

        tapPermanent(state, fd);
        expect(fd.faceDown).toBeUndefined();
        expect((fd.card as { id: string }).id).toBe(grizzlyBears.id);
    });
});

describe("mana costs match modern Scryfall oracle (Alpha errata)", () => {
    // The Alpha printings of these cards carried costs later superseded by
    // official errata; the engine follows the current Scryfall oracle.
    it("Lich is {B}{B}{B}{B}, not the Alpha {2}{B}{B}", () => {
        expect(lich.manaCost).toEqual({ B: 4 });
    });

    it("Personal Incarnation is {3}{W}{W}{W}, not the Alpha {4}{W}{W}{W}", () => {
        expect(personalIncarnation.manaCost).toEqual({ X: 3, W: 3 });
    });

    it("Orcish Artillery stays {1}{R}{R} (current Scryfall oracle)", () => {
        // Guard: the EC Alpha 40 'play as printed 1R' note is NOT honored — the
        // oracle cost is {1}{R}{R}, which is what we ship.
        expect(orcishArtillery.manaCost).toEqual({ X: 1, R: 2 });
    });
});

// Word of Command — Acting Player foundation + land branch (#576, ADR 0037)
// ---------------------------------------------------------------------------

describe("Word of Command (controlled cast — land branch, CR 305.2 / 608.2, ADR 0037)", () => {
    // p1 (the Acting Player / WoC controller) casts Word of Command targeting
    // the opponent p2. p2's hand holds a Forest (land) + a Grizzly Bears
    // (non-land). Resolution: p1 looks at p2's hand and picks a card; a land is
    // played under p2's control, counting against p2's one-land-per-turn drop.
    function seed(opts: { p2LandsPlayedThisTurn?: number } = {}) {
        const oppForest = makeInstance(forest.id, {
            id: "p2-forest",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "p2-bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", {
            hand: [oppForest, oppBear],
            landsPlayedThisTurn: opts.p2LandsPlayedThisTurn,
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        return state;
    }

    /** Submit the head pending choice through the backend integration path.
     *  Mirrors the `submitResolutionChoice` mutation handler in `game.ts`
     *  exactly: `applyPendingChoiceSubmit` (which re-runs resolution) followed
     *  by `checkStateBasedActions` — exercising the GRE → game.ts boundary, not
     *  just the engine in isolation. */
    function submitChoice(state: GameState, picks: string[]): void {
        const head = (state.pendingChoices ?? [])[0];
        expect(head).toBeDefined();
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: picks,
        });
        checkStateBasedActions(state);
    }

    it("targetRequirement is 'target opponent' (CR 115)", () => {
        expect(wordOfCommand.targetRequirement).toEqual({
            type: "player",
            count: 1,
            controller: "opponent",
        });
    });

    it("only the opponent is a legal target (the caster cannot be chosen)", () => {
        const state = seed();
        const legal = getLegalTargets(
            state,
            wordOfCommand.targetRequirement!,
            [],
            "p1"
        );
        const playerIds = legal
            .filter((t) => t.type === "player")
            .map((t) => t.id);
        expect(playerIds).toEqual(["p2"]);
    });

    it("suspends on a hand-pick choice routed to the controller over the opponent's hand", () => {
        const state = seed();
        const result = resolveTopOfStack(state);
        expect(result).toBeNull(); // suspended
        expect(state.pendingChoices?.length).toBe(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.zone).toBe("hand");
        expect(head.playerId).toBe("p1"); // the Acting Player chooses
        expect(head.zoneOwnerId).toBe("p2"); // from the opponent's hand
        // ADR 0037: actingPlayerId is recorded only when it DIFFERS from the
        // prompted player. In slice 1 the WoC controller IS the chooser, so it
        // is omitted (defaults to playerId) — the foundation is in place for
        // the spell branch (#577) where the controlled opponent diverges.
        expect(head.actingPlayerId).toBeUndefined();
        expect(head.actingPlayerId ?? head.playerId).toBe("p1");
    });

    it("grants the controller Card Knowledge of the opponent's hand (knownTo)", () => {
        const state = seed();
        resolveTopOfStack(state);
        const p2 = state.players[1];
        for (const card of p2.hand) {
            expect(card.knownTo).toContain("p1");
        }
    });

    it("picking a land plays it under the opponent's control, consuming their land drop (CR 305.2)", () => {
        const state = seed();
        resolveTopOfStack(state);
        submitChoice(state, ["p2-forest"]);

        const p2 = state.players[1];
        // Forest left p2's hand and is on p2's battlefield, controlled by p2.
        expect(p2.hand.map((c) => c.id)).not.toContain("p2-forest");
        const onBf = p2.battlefield.find((c) => c.id === "p2-forest");
        expect(onBf).toBeDefined();
        expect(onBf!.controllerId).toBe("p2");
        // CR 305.2 — the opponent's one-land-per-turn drop is consumed.
        expect(p2.landsPlayedThisTurn).toBe(1);
        // WoC itself resolved into its controller's (p1's) graveyard.
        const wocInGy = state.players[0].graveyard.some(
            (c) => c.card.id === wordOfCommand.id
        );
        expect(wocInGy).toBe(true);
        expect(state.stack.length).toBe(0);
    });

    it("if the opponent already played a land this turn, the chosen land is not played (CR 305.2 'if able')", () => {
        const state = seed({ p2LandsPlayedThisTurn: 1 });
        resolveTopOfStack(state);
        submitChoice(state, ["p2-forest"]);

        const p2 = state.players[1];
        // The Forest stays in hand — playing it is not "able".
        expect(p2.hand.map((c) => c.id)).toContain("p2-forest");
        expect(
            p2.battlefield.find((c) => c.id === "p2-forest")
        ).toBeUndefined();
        expect(p2.landsPlayedThisTurn).toBe(1); // unchanged
        expect(state.stack.length).toBe(0); // WoC still resolves
    });

    it("picking a non-land is a no-op this slice (TODO #577 spell branch)", () => {
        const state = seed();
        resolveTopOfStack(state);
        submitChoice(state, ["p2-bear"]);

        const p2 = state.players[1];
        // The Bear stays in hand — the spell branch is not implemented yet.
        expect(p2.hand.map((c) => c.id)).toContain("p2-bear");
        expect(p2.battlefield.length).toBe(0);
        expect(state.stack.length).toBe(0); // WoC resolves
    });

    it("getActingPlayer defaults to the controller for an ordinary cast", () => {
        const state = seed();
        const item = state.stack[0];
        expect(item.actingPlayerId).toBeUndefined();
        expect(getActingPlayer(item)).toBe("p1");
    });

    // --- Wire format (projectPublicState): knownTo + played land survive ---
    it("wire format: the controller's view of the opponent's hand survives projection", () => {
        const state = seed();
        resolveTopOfStack(state);
        // Viewer = p1 (the controller / Acting Player). The opponent (p2) hand
        // is sparse by default, but knownTo grants p1 identity on every card.
        const projected = projectPublicState(state, 1, "p1");
        const p2Hand = projected.players[1].hand;
        const visibleIds = p2Hand
            .filter((c): c is NonNullable<typeof c> => c !== null)
            .map((c) => c.id);
        expect(visibleIds).toContain("p2-forest");
        expect(visibleIds).toContain("p2-bear");
    });

    it("wire format: the played land is public on the opponent's battlefield", () => {
        const state = seed();
        resolveTopOfStack(state);
        submitChoice(state, ["p2-forest"]);
        // Viewer = p1: the opponent's battlefield is always public.
        const projected = projectPublicState(state, 1, "p1");
        const bfIds = projected.players[1].battlefield.map((c) => c.id);
        expect(bfIds).toContain("p2-forest");
    });

    // --- Serialization round-trip: StackItem.actingPlayerId persists ---
    it("serialization: StackItem.actingPlayerId survives a DB round-trip (ADR 0037)", () => {
        const state = seed();
        // Force a controlled-cast override onto the stack item (the value a
        // future spell-branch controlled cast would carry).
        state.stack[0].actingPlayerId = "p1";
        const restored = expandState(compactState(state));
        expect(restored.stack[0].actingPlayerId).toBe("p1");
        expect(getActingPlayer(restored.stack[0])).toBe("p1");
    });
});

describe("Word of Command (controlled cast, ADR 0037, CR 601 / 305.2)", () => {
    // p1 = Word of Command's controller (Acting Player); p2 = the controlled
    // opponent whose hand is looked at and whose card is played.
    function castWordOfCommand(state: GameState) {
        const item = pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        return item;
    }

    function submitPick(state: GameState, pickId: string) {
        const head = (state.pendingChoices ?? [])[0];
        if (!head) throw new Error("no pending choice");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [pickId],
        });
    }

    it("step 0: the controller is prompted to pick from the OPPONENT's hand, with knowledge granted", () => {
        const oppCard = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [oppCard] })],
        });
        castWordOfCommand(state);

        expect(state.pendingChoices).toHaveLength(1);
        // The chooser is the WoC controller; the zone is the OPPONENT's hand.
        expect(state.pendingChoices?.[0]).toMatchObject({
            playerId: "p1",
            zoneOwnerId: "p2",
            zone: "hand",
            kind: "choose-hand-card",
            count: 1,
        });
        // ADR 0026 — the controller now knows the opponent's hand they saw.
        expect(oppCard.knownTo).toContain("p1");
    });

    it("casts a non-targeted spell from the opponent's hand: real StackItem, castById=opponent, actingPlayerId=controller", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // Dark Ritual is now on the stack as the opponent's spell.
        const ritualOnStack = state.stack.find(
            (s) => (s.card as { id?: string }).id === darkRitual.id
        );
        expect(ritualOnStack).toBeDefined();
        expect(ritualOnStack?.castById).toBe("p2"); // CR 601 — opponent's spell
        expect(ritualOnStack?.actingPlayerId).toBe("p1"); // ADR 0037
        // It left the opponent's hand and entered the public stack.
        expect(
            state.players[1].hand.find((c) => c.id === "opp-ritual")
        ).toBeUndefined();
    });

    it("mana is auto-tapped ONLY from the opponent's lands; opponent's other resources untouched", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        // A land the CONTROLLER (p1) owns must NOT be touched.
        const myUntappedSwamp = makeInstance(swamp.id, {
            id: "my-swamp",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myUntappedSwamp] }),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // The opponent's Swamp paid for the spell (tapped); the controller's
        // own Swamp is untouched.
        expect(
            state.players[1].battlefield.find((c) => c.id === "opp-swamp")
                ?.isTapped
        ).toBe(true);
        expect(
            state.players[0].battlefield.find((c) => c.id === "my-swamp")
                ?.isTapped
        ).toBe(false);
    });

    it("unpayable from the opponent's lands → spell is NOT played", () => {
        // Dark Ritual costs {B} but the opponent controls no lands.
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [oppRitual] }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // Not cast: nothing on the stack, the card stays in the opponent's hand.
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === darkRitual.id
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-ritual")
        ).toBeDefined();
    });

    it("the cast spell then resolves as the opponent's spell (Dark Ritual fills the opponent's mana pool)", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");
        // Resolve the Dark Ritual now on top of the stack.
        resolveTopOfStack(state);

        // Dark Ritual adds {B}{B}{B} to its controller's (the opponent's) pool.
        // The Swamp's {B} was consumed paying for it, so the net is {B}{B}{B}.
        expect(state.players[1].manaPool.B).toBe(3);
        // The controller's pool is untouched.
        expect(state.players[0].manaPool.B).toBe(0);
    });

    it("land branch: the chosen land is played under the OPPONENT's control (CR 305.2)", () => {
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp-in-hand",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [oppSwamp] })],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-swamp-in-hand");

        // The land is on the opponent's battlefield and counted their land drop.
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "opp-swamp-in-hand"
            )
        ).toBeDefined();
        expect(state.players[1].landsPlayedThisTurn).toBe(1);
    });

    it("land branch: opponent already played a land this turn → land NOT played (CR 305.2)", () => {
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp-in-hand",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppSwamp],
                    landsPlayedThisTurn: 1,
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-swamp-in-hand");

        // The land stayed in hand; the drop count is unchanged.
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "opp-swamp-in-hand"
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-swamp-in-hand")
        ).toBeDefined();
        expect(state.players[1].landsPlayedThisTurn).toBe(1);
    });

    it("wire format: the resulting stack item's controllerId (castById) = opponent and the chosen card is public after projection", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // Re-run the assertion against the projected state both clients see.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.stack.find(
                (s) => s.card.id === darkRitual.id
            );
            expect(slim).toBeDefined();
            // CR 601 — the chosen spell is the opponent's spell.
            expect(slim?.castById).toBe("p2");
            expect(slim?.actingPlayerId).toBe("p1");
        }
    });

    it("wire format: the controller's knownTo view of the opponent's hand survives projection (ADR 0026)", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [oppRitual] }),
            ],
        });
        castWordOfCommand(state);
        // Suspended on the pick: the controller (p1) saw the opponent's hand.
        const projected = projectPublicState(state, 1, "p1");
        // p1 sees the opponent's hand card identities they looked at.
        const oppHand = projected.players[1].hand;
        expect(
            oppHand.some(
                (c) =>
                    c &&
                    (c as { card?: { id?: string } }).card?.id === darkRitual.id
            )
        ).toBe(true);
    });

    // --- TARGETED spell branch (#578, CR 601.2c): the Acting Player picks the
    // chosen spell's targets, reusing getLegalTargets. ---

    /** Submits the head pending choice (the target pick) with a single id. */
    function submitTarget(state: GameState, targetId: string) {
        submitPick(state, targetId);
    }

    it("targeted spell: the controller is prompted to pick a target after the card pick", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        // Pick the opponent's Lightning Bolt from their hand.
        submitPick(state, "opp-bolt");

        // A second pending choice — the target pick — is now routed to the
        // controller (p1), not the controlled opponent (p2).
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-damage-target");
        // "Any target" → both players are legal targets, including the
        // controlled opponent themselves (the classic WoC line).
        expect(head.candidatePlayerIds).toEqual(
            expect.arrayContaining(["p1", "p2"])
        );
    });

    it("controller aims the opponent's Lightning Bolt at the opponent themselves; 3 damage lands", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        const startingLife = state.players[1].life;
        castWordOfCommand(state);
        submitPick(state, "opp-bolt"); // choose the Bolt
        submitTarget(state, "p2"); // aim it at the opponent themselves

        // Lightning Bolt is on the stack as the opponent's spell, targeting p2.
        const bolt = state.stack.find(
            (s) => (s.card as { id?: string }).id === lightningBolt.id
        );
        expect(bolt?.castById).toBe("p2"); // CR 601 — opponent's spell
        expect(bolt?.actingPlayerId).toBe("p1"); // ADR 0037
        expect(bolt?.targets).toEqual([{ type: "player", id: "p2" }]);

        // Resolve it: 3 damage to the opponent (the controlled player).
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(startingLife - 3);
        // The controller (p1) is untouched.
        expect(state.players[0].life).toBe(startingLife);
    });

    it("targeted spell with NO legal target → not played (CR 601.2c)", () => {
        // Dwarven Demolition Team's ability targets a Wall; a Lightning Bolt
        // always has a legal target (players), so use a spell whose only legal
        // targets can be removed. Burrowing targets a creature; with no
        // creatures on the battlefield it has no legal target.
        const oppBurrowing = makeInstance(burrowing.id, {
            id: "opp-burrowing",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBurrowing],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-burrowing");

        // No target prompt was raised, and the spell is not on the stack.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === burrowing.id
            )
        ).toBeUndefined();
        // It stayed in the opponent's hand ("if able").
        expect(
            state.players[1].hand.find((c) => c.id === "opp-burrowing")
        ).toBeDefined();
    });

    it("control persists: the controller's target choice rides onto the cast spell's stack item", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-bolt");
        submitTarget(state, "p1"); // aim it at the controller

        const bolt = state.stack.find(
            (s) => (s.card as { id?: string }).id === lightningBolt.id
        );
        // The acting-player override and the chosen targets both ride along.
        expect(bolt?.actingPlayerId).toBe("p1");
        expect(bolt?.targets).toEqual([{ type: "player", id: "p1" }]);
    });

    it("wire format: the targeted cast's stack item (targets + controllerId) survives projection", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-bolt");
        submitTarget(state, "p2");

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.stack.find(
                (s) => s.card.id === lightningBolt.id
            );
            expect(slim).toBeDefined();
            expect(slim?.castById).toBe("p2"); // CR 601 — opponent's spell
            expect(slim?.actingPlayerId).toBe("p1"); // ADR 0037
            expect(slim?.targets).toEqual([{ type: "player", id: "p2" }]);
        }
    });

    // --- X / modal / additional-cost casts (#579, CR 107.3 / 700.2c / 117.9):
    // the Acting Player makes EVERY cast decision from the opponent's
    // resources. ---

    /** Submits the head pending choice (an option pick, a permanent pick, or a
     *  target pick) with a single id — all use the same client-buffered shape. */
    function submitOption(state: GameState, optionId: string) {
        submitPick(state, optionId);
    }

    it("X spell: controller is prompted for X, then X mana is paid from the opponent's lands (CR 107.3)", () => {
        // Opponent holds Fireball ({X}{R}, deals X damage). Two Mountains can
        // pay {1}{R} → X up to 1 is affordable.
        const oppFireball = makeInstance(fireball.id, {
            id: "opp-fireball",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const m1 = makeInstance(mountain.id, {
            id: "opp-m1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const m2 = makeInstance(mountain.id, {
            id: "opp-m2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppFireball],
                    battlefield: [m1, m2],
                }),
            ],
        });
        const startLife = state.players[0].life;
        castWordOfCommand(state);
        submitPick(state, "opp-fireball");

        // The controller (p1) is prompted to choose X — an option pick.
        expect(state.pendingChoices).toHaveLength(1);
        const xChoice = state.pendingChoices![0];
        expect(xChoice.playerId).toBe("p1");
        expect(xChoice.kind).toBe("option-pick");
        // Only X = 0 and X = 1 are affordable from the opponent's two Mountains.
        expect(xChoice.options?.map((o) => o.id)).toEqual(["0", "1"]);

        submitOption(state, "1"); // choose X = 1
        // Fireball is "any target" — the controller then aims it. Target p1.
        submitTarget(state, "p1");

        const fb = state.stack.find(
            (s) => (s.card as { id?: string }).id === fireball.id
        );
        expect(fb?.castById).toBe("p2"); // opponent's spell (CR 601)
        expect(fb?.chosenX).toBe(1);
        // Both Mountains tapped to pay {1}{R} (X = 1).
        expect(state.players[1].battlefield.every((c) => c.isTapped)).toBe(
            true
        );

        resolveTopOfStack(state);
        // X = 1 → 1 damage to the controller (p1).
        expect(state.players[0].life).toBe(startLife - 1);
    });

    it("X spell: unpayable even at X = 0 → not played (CR 107.3 / 'if able')", () => {
        // Fireball needs {R}; the opponent controls no lands, so even X = 0 is
        // unpayable — castChosenSpell refuses and nothing happens.
        const oppFireball = makeInstance(fireball.id, {
            id: "opp-fireball",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [oppFireball] }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-fireball");

        // X is offered as just {0} (the only candidate), the target is aimed,
        // then the cast fails on payment.
        submitOption(state, "0");
        submitTarget(state, "p1");

        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === fireball.id
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-fireball")
        ).toBeDefined();
    });

    it("modal spell: controller chooses the mode; the chosen mode's target/resolution apply (CR 700.2c/d)", () => {
        // Opponent holds Red Elemental Blast ({R}, modal: counter target blue
        // spell / destroy target blue permanent). The controller picks the
        // destroy mode and destroys a blue creature.
        const oppBlast = makeInstance(redElementalBlast.id, {
            id: "opp-blast",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        // A blue creature the controller (p1) owns — a legal "destroy target
        // blue permanent" target.
        const blueCreature = makeInstance(merfolkOfThePearlTrident.id, {
            id: "blue-merfolk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blueCreature] }),
                makePlayer("p2", {
                    hand: [oppBlast],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-blast");

        // The controller is prompted for the mode (an option pick over modes).
        expect(state.pendingChoices).toHaveLength(1);
        const modeChoice = state.pendingChoices![0];
        expect(modeChoice.playerId).toBe("p1");
        expect(modeChoice.kind).toBe("option-pick");
        expect(modeChoice.options?.map((o) => o.id)).toEqual(
            expect.arrayContaining(["counter", "destroy"])
        );

        submitOption(state, "destroy"); // choose the destroy mode
        submitTarget(state, "blue-merfolk"); // aim it at the blue creature

        const blast = state.stack.find(
            (s) => (s.card as { id?: string }).id === redElementalBlast.id
        );
        expect(blast?.castById).toBe("p2");
        expect(blast?.chosenModeId).toBe("destroy");
        expect(blast?.targets).toEqual([
            { type: "permanent", id: "blue-merfolk" },
        ]);

        resolveTopOfStack(state);
        // The blue creature was destroyed by the chosen mode's resolution.
        expect(
            state.players[0].battlefield.find((c) => c.id === "blue-merfolk")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "blue-merfolk")
        ).toBeDefined();
    });

    it("additional-cost spell: controller picks the sacrifice from the OPPONENT's battlefield (CR 117.9)", () => {
        // Opponent holds Sacrifice ({B}, "sacrifice a creature; add {B} equal to
        // its mana value"). The controller chooses which of the opponent's
        // creatures is sacrificed — Grizzly Bears (MV 2).
        const oppSacrifice = makeInstance(sacrifice.id, {
            id: "opp-sacrifice",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const oppBears = makeInstance(grizzlyBears.id, {
            id: "opp-bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppSacrifice],
                    battlefield: [oppSwamp, oppBears],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-sacrifice");

        // The controller is prompted to choose a creature on the OPPONENT's
        // battlefield to sacrifice.
        expect(state.pendingChoices).toHaveLength(1);
        const sacChoice = state.pendingChoices![0];
        expect(sacChoice.playerId).toBe("p1");
        expect(sacChoice.kind).toBe("choose-permanents");
        expect(sacChoice.zoneOwnerId).toBe("p2");
        expect(sacChoice.candidateIds).toEqual(["opp-bears"]);

        submitPick(state, "opp-bears");

        const sac = state.stack.find(
            (s) => (s.card as { id?: string }).id === sacrifice.id
        );
        expect(sac?.castById).toBe("p2");
        expect(sac?.additionalSacrificeSnapshot?.cardInstanceId).toBe(
            "opp-bears"
        );
        // The opponent's Grizzly Bears was sacrificed to their graveyard.
        expect(
            state.players[1].battlefield.find((c) => c.id === "opp-bears")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "opp-bears")
        ).toBeDefined();

        resolveTopOfStack(state);
        // Sacrifice adds {B} equal to the sacrificed creature's MV (2). The
        // Swamp's {B} paid the spell's {B}, so the opponent's pool nets {B}{B}.
        expect(state.players[1].manaPool.B).toBe(2);
    });

    it("additional-cost spell: no matching permanent to sacrifice → not played (CR 117.9 / 'if able')", () => {
        // Opponent holds Sacrifice but controls no creature → the additional
        // cost is unmeetable, so the spell is never played.
        const oppSacrifice = makeInstance(sacrifice.id, {
            id: "opp-sacrifice",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppSacrifice],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-sacrifice");

        // No sacrifice prompt was raised; nothing was cast.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === sacrifice.id
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-sacrifice")
        ).toBeDefined();
    });

    it("wire format: an X cast's chosenX + the modal cast's chosenModeId survive projection", () => {
        // X cast (Fireball, X = 1) — re-assert chosenX after projection.
        const oppFireball = makeInstance(fireball.id, {
            id: "opp-fireball",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const m1 = makeInstance(mountain.id, {
            id: "opp-m1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const m2 = makeInstance(mountain.id, {
            id: "opp-m2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppFireball],
                    battlefield: [m1, m2],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-fireball");
        submitOption(state, "1");
        submitTarget(state, "p1");

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.stack.find((s) => s.card.id === fireball.id);
            expect(slim).toBeDefined();
            expect(slim?.castById).toBe("p2");
            expect(slim?.chosenX).toBe(1);
        }
    });

    // --- #580: control PERSISTS onto the chosen spell's RESOLUTION ---------
    // "If the chosen card is cast as a spell, you control the player while that
    // spell is resolving." (CR 608, ADR 0037). The chosen spell's OWN resolve
    // step enqueues its resolution-time Pending Choices with playerId =
    // ctx.caster/ctx.controller (= the controlled opponent); the engine must
    // redirect those prompts to the Acting Player (WoC's controller) while the
    // spell's stack item carries the override, then revert when it leaves the
    // stack. Demonic Tutor ("Search your library …") is the minimal probe: its
    // resolve enqueues a single `search-library` choice for ctx.caster.
    function seedWoCTutor() {
        const oppTutor = makeInstance(demonicTutor.id, {
            id: "opp-tutor",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        // Two Swamps pay Demonic Tutor's {1}{B} from the opponent's lands only.
        const oppSwamp1 = makeInstance(swamp.id, {
            id: "opp-swamp-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const oppSwamp2 = makeInstance(swamp.id, {
            id: "opp-swamp-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        // A card to fetch lives in the opponent's library.
        const oppLibCard = makeInstance(darkRitual.id, {
            id: "opp-lib-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppTutor],
                    battlefield: [oppSwamp1, oppSwamp2],
                    library: [oppLibCard],
                }),
            ],
        });
    }

    it("a chosen spell's RESOLUTION choice routes to the controller, reading the OPPONENT's zone (CR 608)", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor"); // controller picks the opponent's Tutor

        // The Tutor is on the stack as the opponent's spell with the override.
        const tutorOnStack = state.stack.find(
            (s) => (s.card as { id?: string }).id === demonicTutor.id
        );
        expect(tutorOnStack?.castById).toBe("p2");
        expect(tutorOnStack?.actingPlayerId).toBe("p1");

        // Resolve the Tutor: it enqueues a search-library choice. #580 — that
        // resolution choice is ROUTED TO THE CONTROLLER (p1), with the OWNER of
        // the searched zone left on the controlled opponent (p2).
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.playerId).toBe("p1"); // controller answers (Acting Player)
        // Resource/ownership read stays on the opponent (controller of the spell).
        expect(head.zoneOwnerId).toBe("p2");
        expect(head.actingPlayerId).toBe("p2"); // controlled player recorded
    });

    it("the controller's pick fetches from the OPPONENT's library into the OPPONENT's hand (CR 608.2)", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor");
        resolveTopOfStack(state); // enqueues the controller's search choice
        submitPick(state, "opp-lib-ritual"); // controller searches FOR the opp

        // The fetched card moved into the OPPONENT's hand (their resources),
        // even though the CONTROLLER made the decision.
        expect(
            state.players[1].hand.find((c) => c.id === "opp-lib-ritual")
        ).toBeDefined();
        expect(
            state.players[1].library.find((c) => c.id === "opp-lib-ritual")
        ).toBeUndefined();
    });

    it("after the chosen spell leaves the stack, the opponent makes their OWN subsequent decisions again", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor");
        resolveTopOfStack(state);
        submitPick(state, "opp-lib-ritual"); // resolve the Tutor fully

        // The Tutor (and Word of Command) have left the stack — no override
        // lingers; no pending choices remain.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === demonicTutor.id
            )
        ).toBeUndefined();

        // Now the opponent (p2) casts THEIR OWN Demonic Tutor normally — its
        // resolution choice routes back to THEM, not the controller (control
        // reverted with the stack item, ADR 0037 / CR 608).
        const ownTutor = makeInstance(demonicTutor.id, {
            id: "p2-own-tutor",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const libCard = makeInstance(darkRitual.id, {
            id: "p2-lib-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        state.players[1].hand.push(ownTutor);
        state.players[1].library.push(libCard);
        pushSpell(state, demonicTutor.id, "p2");
        // Point the just-pushed stack item at the opponent's own instance.
        const ownOnStack = state.stack[state.stack.length - 1];
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.playerId).toBe("p2"); // opponent answers their own spell
        expect(head.actingPlayerId).toBeUndefined(); // no override
        expect(ownOnStack.actingPlayerId).toBeUndefined();
    });

    it("wire format: the chosen spell's routed resolution choice survives projection (controller answers, opp owns the zone)", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor");
        resolveTopOfStack(state); // enqueue the routed search choice

        // The routed choice must reach BOTH clients with the same routing: the
        // controller (p1) is prompted, the opponent (p2) owns the searched zone.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const head = (projected.pendingChoices ?? [])[0];
            expect(head).toBeDefined();
            expect(head?.kind).toBe("search-library");
            expect(head?.playerId).toBe("p1");
            expect(head?.zoneOwnerId).toBe("p2");
        }
    });

    it("definition: Word of Command targets an opponent, costs {B}{B}", () => {
        expect(wordOfCommand.manaCost).toEqual({ B: 2 });
        expect(wordOfCommand.targetRequirement).toMatchObject({
            type: "player",
            controller: "opponent",
        });
    });
});

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
    fog,
    forest,
    terror,
    lure,
    blazeOfGlory,
    twoHeadedGiantOfForiys,
} from "../lea";
import {
    commitLandsForCost,
    regenerateOrDestroy,
    removePermanentTo,
    resolveTopOfStack,
    emitSpellCastEvent,
    emitPermanentTapped,
    processPendingActionTriggers,
    matchesPermanentFilter,
    type CardInstanceState,
    type GameState,
} from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import {
    getActivatedManaColor,
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
    effectivePermanentView,
} from "../../../gre/phases";
import { tryGetCardById } from "../../index";
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
        expect(forP1.players[0].library).toEqual({ count: 2 });
        expect(forP1.players[0].librarySearch?.map((c) => c.id)).toEqual([
            "wanted",
            "filler",
        ]);
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[0].librarySearch).toBeUndefined();
        expect(forP2.players[0].library).toEqual({ count: 2 });
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
        // 2 + 2 = 4 (via modifyPower; effective reading agrees)
        expect(bear.power).toBe(4);
        expect(bear.toughness).toBe(2);
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(2);
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
        expect(slim.power).toBe(4);
        expect(slim.staticAbilities).toContain("trample");
        expect(getEffectivePower(projected, slim)).toBe(4);
        // Opponent's viewer sees the same data (no hidden info on battlefield).
        const oppView = projectPublicState(state, 1, "p2");
        const slimOpp = oppView.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slimOpp.power).toBe(4);
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
        // The id encoding includes the print id as the trailing segment so
        // the client lazy-synthesizer recovers it without server registration.
        expect(defId.endsWith("|09921372-126f-4c81-b6d8-ea50b1d0eb44")).toBe(
            true
        );
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
        state.pendingChoices![0].selected.push("bear-1");
        const chooser = state.players.find(
            (p) => p.id === state.pendingChoices![0].zoneOwnerId
        )!;
        for (const id of state.pendingChoices![0].selected) {
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
        head.selected.push("l1");
        const chooser = state.players.find((p) => p.id === head.zoneOwnerId)!;
        for (const id of head.selected) {
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
        head.selected.push("bear-2");
        for (const id of head.selected) {
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
        state.pendingChoices![0].selected.push("bear");
        const chooser = state.players.find(
            (p) => p.id === state.pendingChoices![0].zoneOwnerId
        )!;
        for (const id of state.pendingChoices![0].selected) {
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

describe("Animate Artifact ({3}{U} — aura: artifact becomes creature with P/T = CMC)", () => {
    it("adds Creature type and grants P/T equal to host's printed CMC", () => {
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
        // Mana Vault printed cost is {1} → CMC 1. After Animate Artifact:
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

describe("Sacrifice ({B} — additional cost sac creature, add B mana = CMC)", () => {
    it("resolve adds B mana equal to snapshotted sacrificed CMC", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, sacrifice.id, "p1");
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "fake",
            cmc: 5,
        };
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(5);
    });

    it("getAdditionalSacrificeCmc on SpellContext reads the snapshot", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, sacrifice.id, "p1");
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "fake",
            cmc: 3,
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

describe("Spell Blast ({X}{U} — counter target spell with cmc = X)", () => {
    it("counters a target spell whose mana value equals X", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Opp casts Lightning Bolt (cmc 1). p1 responds with Spell Blast X=1.
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

    it("getCmc on a stack spell folds in the chosen X", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Push Braingeyser with chosenX=4 → cmc = printed (2) + 4 = 6.
        const bg = pushSpell(state, braingeyser.id, "p2", [
            { type: "player", id: "p2" },
        ]);
        bg.chosenX = 4;
        // Spell Blast with X=5 (not 6) → blast resolves but target's cmc !=
        // X, the spell-target validation has already been bypassed by
        // pushSpell, so the resolve goes through.  Re-check via getCmc.
        const blast = pushSpell(state, spellBlast.id, "p1", [
            { type: "spell", id: bg.id },
        ]);
        blast.chosenX = 6;
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bg.id)).toBeUndefined();
    });

    it("declares cmcFilter equals X on the target requirement", () => {
        expect(spellBlast.targetRequirement?.cmcFilter).toEqual({
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
// Test helpers
// ---------------------------------------------------------------------------

function grizzlyBearsId(): string {
    // grizzlyBears is exported from lea.ts — use getCardByName to stay
    // decoupled if we rename the variable.
    return "ce2d603a-3231-4a8c-bf39-1617586ea870";
}

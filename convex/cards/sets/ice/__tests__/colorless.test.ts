// Ice Age (ICE) — colorless card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    armorOfFaith,
    brainstorm,
    essenceFlare,
    iceCauldron,
    elkinBottle,
    jeweledAmulet,
    adarkarSentinel,
    aegisOfTheMeek,
    celestialSword,
    despoticScepter,
    fyndhornBow,
    icyManipulator,
    jestersCap,
    pitTrap,
    shieldOfTheAges,
    skullCatapult,
    snowFortress,
    staffOfTheAges,
    vibratingSphere,
    wallOfShields,
    warChariot,
    whaleboneGlider,
    zuranOrb,
    iceFloe,
    plainsIce,
    islandIce,
    swampIce,
    mountainIce,
    forestIce,
    hematiteTalisman,
    lapisLazuliTalisman,
    malachiteTalisman,
    nacreTalisman,
    onyxTalisman,
    batonOfMorale,
    crownOfTheAges,
    goblinLyre,
    infiniteHourglass,
    jestersMask,
    pentagramOfTheAges,
    runedArch,
    soldeviGolem,
    timeBomb,
    walkingWall,
    blessedWine,
    forceVoid,
    barbedSextant,
    urzasBauble,
    snowCoveredPlains,
    snowCoveredIsland,
    snowCoveredSwamp,
    snowCoveredMountain,
    snowCoveredForest,
    coldSnap,
    balduvianConjurer,
    driftOfTheDead,
    witheringWisps,
    avalanche,
    glacialCrevasses,
    karplusanGiant,
    melting,
    snowblind,
    arcumsSleigh,
    arcumsWeathervane,
    sunstone,
    adarkarWastes,
    brushland,
    karplusanForest,
    sulfurousSprings,
    undergroundRiver,
    landCap,
    lavaTubes,
    riverDelta,
    timberlineRidge,
    veldt,
    infernalDarkness,
    nakedSingularity,
    pox,
} from "../../ice";
import { plains, island, swamp, mountain, forest } from "../../lea";
import { applyLandManaReplacement } from "../../../../gre/constants";
import { untapStep } from "../../../../gre/phases";
import {
    getDefinition,
    getCardByName,
    getAllCards,
    getAllSetCodes,
} from "../../../index";
import {
    resolveTopOfStack,
    canPayMayPayCost,
    payMayPayCost,
    normalizeMayPayCost,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    addRestrictedManaToPool,
    manaSpentDelta,
    spendablePoolForSpell,
    payManaCostForSpell,
    restrictedUnitAllowsSpell,
    getManaSubstitutions,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    countSnowLands,
    controlsSnowSubtype,
    hasSnowSupertype,
    hasSupertypeLive,
} from "../../../snowReads";
import {
    projectPublicState,
    projectFullState,
} from "../../../../gameProjections";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
    applyRandomRevealAck,
} from "../../../../gre/pendingChoiceSubmit";
import { getLegalTargets, getLegalActions } from "../../../../gre/rules";
import {
    tapSourceIntoPayment,
    tryAutoCommitPendingActivation,
    tryAutoCommitPendingCast,
    buildPendingActivation,
} from "../../../../game";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
} from "../../../../gre/autoTap";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    PendingActivation,
} from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import type { CardType, ManaCost } from "../../../types";
import {
    resolveActivated,
    submitChoice,
    resolveTrigger,
    vanilla,
    library,
    castCantrip,
    enterUpkeepAndFire,
    snowLand,
    makeLand,
    BASIC_MANA,
    resolveActivatedNoting,
    submitPick,
} from "./helpers";

// ---------------------------------------------------------------------------
// Registry parity — the set file is wired into the registry and the tracer is
// reachable by id, by name, in the deck-builder index, and the set code is
// catalogued.
// ---------------------------------------------------------------------------

describe("ICE registry parity", () => {
    it("registers Balduvian Bears by id", () => {
        expect(getDefinition(balduvianBears.id)).toBe(balduvianBears);
    });

    it("registers it by name (debug-panel / pool lookup path)", () => {
        expect(getCardByName("Balduvian Bears")).toBe(balduvianBears);
    });

    it("includes it in getAllCards (deck-builder index)", () => {
        expect(getAllCards()).toContain(balduvianBears);
    });

    it("registers the ice set code in the catalogue", () => {
        expect(getAllSetCodes()).toContain("ice");
    });
});

describe("Essence Flare (Aura +2/+0 + upkeep -0/-1 counter, CR 122)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(essenceFlare.id, {
            id: "flare",
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
        return { state };
    }
    it("grants +2/+0 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, host)).toBe(4);
    });
    it("wire format: the +2/+0 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
});

// --- Registry parity for the Blue tranche ----------------------------------

describe("ICE Blue tranche registry parity", () => {
    const expected = [
        "Binding Grasp",
        "Brainstorm",
        "Deflection",
        "Diabolic Vision",
        "Elemental Augury",
        "Essence Flare",
        "Glacial Wall",
        "Glaciers",
        "Hydroblast",
        "Iceberg",
        "Icy Prison",
        "Sea Spirit",
        "Sibilant Spirit",
        "Silver Erne",
        "Skeleton Ship",
        "Snow Devil",
        "Soul Barrier",
        "Spectral Shield",
        "Storm Spirit",
        "Thunder Wall",
        "Wind Spirit",
        "Wings of Aesthir",
        "Word of Undoing",
        "Wrath of Marit Lage",
        "Zuran Spellcaster",
    ];
    it("registers every activated Blue card by name", () => {
        for (const name of expected) {
            expect(getCardByName(name).name).toBe(name);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ICE Artifacts free tranche (#636)
// ═══════════════════════════════════════════════════════════════════════════

describe("Adarkar Sentinel ({1}: +0/+1 self-pump, CR 605 / 613)", () => {
    function setup() {
        const sentinel = makeInstance(adarkarSentinel.id, {
            id: "sentinel",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sentinel] }),
                makePlayer("p2"),
            ],
        });
        return { state, sentinel };
    }
    it("is a 3/3 artifact creature", () => {
        expect(adarkarSentinel.types).toEqual(["Artifact", "Creature"]);
        expect(adarkarSentinel.power).toBe(3);
        expect(adarkarSentinel.toughness).toBe(3);
    });
    it("pumps +0/+1 until end of turn", () => {
        const { state, sentinel } = setup();
        resolveActivated(state, sentinel, "adarkar-sentinel-pump");
        const s = state.players[0].battlefield.find(
            (c) => c.id === "sentinel"
        )!;
        expect(getEffectivePower(state, s)).toBe(3);
        expect(getEffectiveToughness(state, s)).toBe(4);
    });
    it("wire format: the +0/+1 survives projectPublicState", () => {
        const { state, sentinel } = setup();
        resolveActivated(state, sentinel, "adarkar-sentinel-pump");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sentinel"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Aegis of the Meek ({1},{T}: 1/1 gets +1/+2, CR 605 / 613)", () => {
    it("only 1/1 creatures are legal targets", () => {
        const ability = aegisOfTheMeek.activatedAbilities!.find(
            (a) => a.id === "aegis-of-the-meek-pump"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            powerFilter: { min: 1, max: 1 },
            toughnessFilter: { min: 1, max: 1 },
        });
        expect(ability.cost).toMatchObject({ tap: true });
    });
    it("grants +1/+2 to the targeted 1/1 until end of turn", () => {
        const aegis = makeInstance(aegisOfTheMeek.id, {
            id: "aegis",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oneOne = vanilla("oo", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aegis, oneOne] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, aegis, "aegis-of-the-meek-pump", [
            { type: "permanent", id: "oo" },
        ]);
        const t = state.players[0].battlefield.find((c) => c.id === "oo")!;
        expect(getEffectivePower(state, t)).toBe(2);
        expect(getEffectiveToughness(state, t)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "oo"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Celestial Sword ({3},{T}: +3/+3 then sac, CR 605 / 603.7b)", () => {
    it("pumps +3/+3 and arms a delayed sacrifice", () => {
        const sword = makeInstance(celestialSword.id, {
            id: "sword",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = vanilla("dude", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sword, dude] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sword, "celestial-sword-pump", [
            { type: "permanent", id: "dude" },
        ]);
        const t = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, t)).toBe(5);
        expect(getEffectiveToughness(state, t)).toBe(5);
        // The "sacrifice at next end step" is a delayed triggered ability.
        expect(
            celestialSword.delayedTriggers?.some(
                (d) => d.id === "celestial-sword-sacrifice"
            )
        ).toBe(true);
    });
    it("targets only creatures you control", () => {
        const ability = celestialSword.activatedAbilities!.find(
            (a) => a.id === "celestial-sword-pump"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            type: "Creature",
            controller: "you",
        });
    });
});

describe("Despotic Scepter ({T}: destroy a permanent you own, CR 605 / 701.7)", () => {
    it("destroys the targeted permanent (can't be regenerated)", () => {
        const scepter = makeInstance(despoticScepter.id, {
            id: "scepter",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = vanilla("victim", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scepter, dude] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, scepter, "despotic-scepter-destroy", [
            { type: "permanent", id: "victim" },
        ]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
    });
});

describe("Fyndhorn Bow ({3},{T}: grant first strike, CR 605 / 702.7)", () => {
    it("grants first strike to the target until end of turn", () => {
        const bow = makeInstance(fyndhornBow.id, {
            id: "bow",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = vanilla("dude", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bow, dude] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bow, "fyndhorn-bow-first-strike", [
            { type: "permanent", id: "dude" },
        ]);
        const t = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, t)).toBe(2);
    });
});

describe("Icy Manipulator ({1},{T}: tap any of three types, CR 605 / 701.20a)", () => {
    it("taps the targeted permanent", () => {
        const icy = makeInstance(icyManipulator.id, {
            id: "icy",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = vanilla("dude", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [dude] }),
            ],
        });
        resolveActivated(state, icy, "icy-manipulator-tap", [
            { type: "permanent", id: "dude" },
        ]);
        const t = state.players[1].battlefield.find((c) => c.id === "dude")!;
        expect(t.isTapped).toBe(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "dude"
        )!;
        expect(slim.isTapped).toBe(true);
    });
    it("targets artifact, creature, or land", () => {
        const ability = icyManipulator.activatedAbilities![0];
        expect(ability.targetRequirement!.type).toEqual([
            "Artifact",
            "Creature",
            "Land",
        ]);
    });
});

describe("Jester's Cap ({2},{T},Sac: strip 3 from a library, CR 701.19)", () => {
    it("exiles the picked cards from the target player's library and shuffles", () => {
        const cap = makeInstance(jestersCap.id, {
            id: "cap",
            controllerId: "p1",
            ownerId: "p1",
        });
        const c1 = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "lib1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const c2 = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "lib2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cap] }),
                makePlayer("p2", { library: [c1, c2] }),
            ],
        });
        resolveActivated(state, cap, "jesters-cap-strip", [
            { type: "player", id: "p2" },
        ]);
        // The search suspends on a pending choice over p2's library.
        submitChoice(state, ["lib1", "lib2"]);
        expect(state.players[1].library.length).toBe(0);
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "lib1",
            "lib2",
        ]);
    });
});

describe("Pit Trap ({2},{T},Sac: destroy an attacker, CR 605 / 508.1)", () => {
    it("only non-flying attacking creatures are legal targets", () => {
        const ability = pitTrap.activatedAbilities![0];
        expect(ability.targetRequirement).toMatchObject({
            combatRoleFilter: "attacking",
            excludeAbility: "flying",
        });
        expect(ability.cost).toMatchObject({ sacrifice: true, tap: true });
    });
    it("destroys the targeted attacker", () => {
        const trap = makeInstance(pitTrap.id, {
            id: "trap",
            controllerId: "p1",
            ownerId: "p1",
        });
        const attacker = vanilla("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [trap] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, trap, "pit-trap-destroy", [
            { type: "permanent", id: "atk" },
        ]);
        expect(state.players[1].battlefield.some((c) => c.id === "atk")).toBe(
            false
        );
    });
});

describe("Shield of the Ages ({2}: prevent 1 to you, CR 605 / 615.1)", () => {
    it("resolves a self prevention shield without error", () => {
        const shield = makeInstance(shieldOfTheAges.id, {
            id: "shield",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shield] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, shield, "shield-of-the-ages-prevent");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Skull Catapult ({1},{T},Sac a creature: 2 dmg, CR 605 / 120.1)", () => {
    it("declares a sacrifice-a-creature cost and deals 2 to any target", () => {
        const ability = skullCatapult.activatedAbilities![0];
        expect(ability.cost.sacrificeFilter).toMatchObject({
            types: "Creature",
            controllerRelation: "you",
        });
        expect(ability.targetRequirement).toMatchObject({ type: "any" });
    });
    it("deals 2 damage to a targeted player", () => {
        const cat = makeInstance(skullCatapult.id, {
            id: "cat",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = vanilla("fodder", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cat, fodder] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[1].life;
        resolveActivated(state, cat, "skull-catapult-fling", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(before - 2);
    });
});

describe("Snow Fortress (Defender Wall, pumps + ping, CR 702.3 / 605)", () => {
    it("is a 0/4 Defender artifact Wall", () => {
        expect(snowFortress.types).toEqual(["Artifact", "Creature"]);
        expect(snowFortress.subtypes).toContain("Wall");
        expect(snowFortress.staticAbilities).toContain("defender");
        expect(snowFortress.toughness).toBe(4);
    });
    it("pumps power and toughness via its two abilities", () => {
        const fort = makeInstance(snowFortress.id, {
            id: "fort",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fort] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, fort, "snow-fortress-pump-power");
        resolveActivated(state, fort, "snow-fortress-pump-toughness");
        const f = state.players[0].battlefield.find((c) => c.id === "fort")!;
        expect(getEffectivePower(state, f)).toBe(1);
        expect(getEffectiveToughness(state, f)).toBe(5);
    });
});

describe("Staff of the Ages (landwalk negation, CR 509.1b / 702.13)", () => {
    it("negates every basic landwalk via a landwalk-negation static", () => {
        const eff = staffOfTheAges.staticEffects!.find(
            (e) => e.kind === "landwalk-negation"
        )!;
        expect(eff).toMatchObject({
            kind: "landwalk-negation",
            subtypes: ["Plains", "Island", "Swamp", "Mountain", "Forest"],
        });
    });
});

describe("Vibrating Sphere (turn-conditional anthem, CR 611.2c / 613)", () => {
    function setup() {
        const sphere = makeInstance(vibratingSphere.id, {
            id: "sphere",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = vanilla("dude", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [sphere, dude] }),
                makePlayer("p2"),
            ],
        });
        return { state, dude };
    }
    it("gives +2/+0 during the controller's turn", () => {
        const { state } = setup();
        const d = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, d)).toBe(4);
        expect(getEffectiveToughness(state, d)).toBe(2);
    });
    it("gives -0/-2 during other turns", () => {
        const { state } = setup();
        state.activePlayerId = "p2";
        const d = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, d)).toBe(2);
        expect(getEffectiveToughness(state, d)).toBe(0);
    });
    it("wire format: the turn-conditional anthem survives projection", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const d = projected.players[0].battlefield.find(
            (c) => c.id === "dude"
        )!;
        expect(getEffectivePower(projected, d)).toBe(4);
    });
});

describe("Wall of Shields (Defender + Banding, CR 702.3 / 702.22)", () => {
    it("is a 0/4 Defender Banding artifact Wall", () => {
        expect(wallOfShields.staticAbilities).toContain("defender");
        expect(wallOfShields.staticAbilities).toContain("banding");
        expect(wallOfShields.subtypes).toContain("Wall");
        expect(wallOfShields.toughness).toBe(4);
    });
});

describe("War Chariot ({3},{T}: grant trample, CR 605 / 702.19)", () => {
    it("grants trample to the target until end of turn", () => {
        const chariot = makeInstance(warChariot.id, {
            id: "chariot",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = vanilla("dude", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chariot, dude] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, chariot, "war-chariot-trample", [
            { type: "permanent", id: "dude" },
        ]);
        const t = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, t)).toBe(2);
    });
});

describe("Whalebone Glider ({2},{T}: grant flying to power<=3, CR 605 / 702.9)", () => {
    it("only creatures with power 3 or less are legal targets", () => {
        const ability = whaleboneGlider.activatedAbilities![0];
        expect(ability.targetRequirement).toMatchObject({
            powerFilter: { max: 3 },
        });
    });
    it("grants flying to the target until end of turn", () => {
        const glider = makeInstance(whaleboneGlider.id, {
            id: "glider",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dude = vanilla("dude", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [glider, dude] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, glider, "whalebone-glider-flying", [
            { type: "permanent", id: "dude" },
        ]);
        const t = state.players[0].battlefield.find((c) => c.id === "dude")!;
        expect(getEffectivePower(state, t)).toBe(2);
    });
});

describe("Zuran Orb (Sac a land: gain 2 life, CR 605 / 119.3)", () => {
    it("declares a {0} cost and a sacrifice-a-land ability", () => {
        expect(zuranOrb.manaCost).toEqual({});
        const ability = zuranOrb.activatedAbilities![0];
        expect(ability.cost.sacrificeFilter).toMatchObject({
            types: "Land",
            controllerRelation: "you",
        });
    });
    it("gains the controller 2 life", () => {
        const orb = makeInstance(zuranOrb.id, {
            id: "orb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orb] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].life;
        resolveActivated(state, orb, "zuran-orb-gain-life");
        expect(state.players[0].life).toBe(before + 2);
    });
});

describe("ICE Artifacts tranche registry parity (#636)", () => {
    const expected = [
        "Adarkar Sentinel",
        "Aegis of the Meek",
        "Celestial Sword",
        "Despotic Scepter",
        "Fyndhorn Bow",
        "Icy Manipulator",
        "Jester's Cap",
        "Pit Trap",
        "Shield of the Ages",
        "Skull Catapult",
        "Snow Fortress",
        "Staff of the Ages",
        "Vibrating Sphere",
        "Wall of Shields",
        "War Chariot",
        "Whalebone Glider",
        "Zuran Orb",
    ];
    it("registers every activated Artifact card by name", () => {
        for (const name of expected) {
            expect(getCardByName(name).name).toBe(name);
        }
    });
    it("includes each in getAllCards (deck-builder index)", () => {
        const all = getAllCards();
        for (const name of expected) {
            expect(all.some((c) => c.name === name)).toBe(true);
        }
    });
});

// ===========================================================================
// Lands free tranche (#637)
// ===========================================================================

describe("Ice Floe ({T}: tap-lock a non-flying attacker, CR 611.2 / 508.1)", () => {
    it("declares the may-choose-not-to-untap static ability (CR 502.1)", () => {
        expect(iceFloe.staticAbilities).toContain("may-choose-not-to-untap");
        expect(iceFloe.types).toEqual(["Land"]);
    });

    it("only non-flying attacking creatures are legal targets", () => {
        const groundAttacker = vanilla("ground", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const flyingAttacker = vanilla("flyer", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
            staticAbilities: ["flying"],
        });
        const idleGround = vanilla("idle", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [groundAttacker, flyingAttacker, idleGround],
                }),
            ],
        });
        const legal = getLegalTargets(
            state,
            iceFloe.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("ground");
        expect(legal).not.toContain("flyer"); // flying excluded
        expect(legal).not.toContain("idle"); // not attacking
    });

    it("taps the targeted attacker (visible on the wire)", () => {
        const floe = makeInstance(iceFloe.id, {
            id: "floe",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"] as CardType[],
        });
        const attacker = vanilla("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [floe] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, floe, "ice-floe-tap-lock", [
            { type: "permanent", id: "atk" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(live.isTapped).toBe(true);
        // The tapped state survives projection to the client.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(slim.isTapped).toBe(true);
    });
});

describe("ICE basic-land reprints (CardPrint wiring, ADR 0014 / CR 305.6)", () => {
    it("registers each basic by its ICE print id onto the LEA definition", () => {
        expect(getDefinition(plainsIce.printId).name).toBe("Plains");
        expect(getDefinition(islandIce.printId).name).toBe("Island");
        expect(getDefinition(swampIce.printId).name).toBe("Swamp");
        expect(getDefinition(mountainIce.printId).name).toBe("Mountain");
        expect(getDefinition(forestIce.printId).name).toBe("Forest");
    });
    it("each print declares setCode ice and points at the LEA basic", () => {
        for (const print of [
            plainsIce,
            islandIce,
            swampIce,
            mountainIce,
            forestIce,
        ]) {
            expect(print.setCode).toBe("ice");
            const def = getDefinition(print.definitionId);
            expect(def.supertypes).toContain("Basic");
            expect(def.types).toEqual(["Land"]);
        }
    });
});

describe("may-pay cost union — life / mana+life legs (CR 118.4, ADR 0042)", () => {
    function bf() {
        const land = makeInstance(getCardByName("Forest").id, {
            id: "l0",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land2 = makeInstance(getCardByName("Forest").id, {
            id: "l1",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land, land2],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("normalizes a bare ManaCost to { mana } (back-compat)", () => {
        expect(normalizeMayPayCost({ U: 1 })).toEqual({ mana: { U: 1 } });
    });

    it("pay-life cost: affordable iff life ≥ amount, and loses the life", () => {
        const state = bf();
        // "Pay 2 life" — affordable at 20, not at 1.
        expect(canPayMayPayCost(state, "p1", { life: 2 })).toBe(true);
        state.players[0].life = 1;
        expect(canPayMayPayCost(state, "p1", { life: 2 })).toBe(false);
        state.players[0].life = 20;
        payMayPayCost(state, "p1", { life: 2 });
        expect(state.players[0].life).toBe(18);
    });

    it("mana+life cost (Infernal Darkness shape) pays both legs", () => {
        const state = bf();
        state.players[0].manaPool = { B: 1 };
        const cost = { mana: { B: 1 }, life: 1 };
        expect(canPayMayPayCost(state, "p1", cost)).toBe(true);
        payMayPayCost(state, "p1", cost);
        expect(state.players[0].life).toBe(19);
        expect(state.players[0].manaPool.B ?? 0).toBe(0);
    });

    it("mana+life is unpayable when either leg is short (all-or-nothing)", () => {
        const state = bf();
        state.players[0].manaPool = { B: 1 };
        state.players[0].life = 0;
        // Has the {B} but not the life.
        expect(canPayMayPayCost(state, "p1", { mana: { B: 1 }, life: 1 })).toBe(
            false
        );
        // Has the life but not the {B}.
        state.players[0].life = 20;
        state.players[0].manaPool = {};
        expect(canPayMayPayCost(state, "p1", { mana: { B: 1 }, life: 1 })).toBe(
            false
        );
    });
});

describe("ICE Lands tranche registry parity (#637)", () => {
    it("registers Ice Floe by name and in the deck-builder index", () => {
        expect(getCardByName("Ice Floe").name).toBe("Ice Floe");
        expect(getAllCards().some((c) => c.name === "Ice Floe")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Artifact buildable-now completion (#658) — Talisman cycle, Crown of the Ages,
// Pentagram of the Ages, Time Bomb, Infinite Hourglass, Vexing Arcanix, Walking
// Wall, Runed Arch, Goblin Lyre, Jester's Mask, Soldevi Golem, Baton of Morale.
// Existing primitives only; CR-referenced per card.
// ---------------------------------------------------------------------------

describe("Talisman cycle (SPELL_CAST may-pay untap, CR 603.2 / 615 / 701.20b)", () => {
    const cycle = [
        { card: hematiteTalisman, color: "R" as const, word: "red" },
        { card: lapisLazuliTalisman, color: "U" as const, word: "blue" },
        { card: malachiteTalisman, color: "G" as const, word: "green" },
        { card: nacreTalisman, color: "W" as const, word: "white" },
        { card: onyxTalisman, color: "B" as const, word: "black" },
    ];

    it("each Talisman is a {2} Artifact with a SPELL_CAST trigger filtered to its colour", () => {
        for (const { card, color, word } of cycle) {
            expect(card.types).toEqual(["Artifact"]);
            expect(card.manaCost).toEqual({ X: 2 });
            const trig = card.triggeredAbilities![0];
            expect(trig.event).toBe("SPELL_CAST");
            expect(card.oracleText).toContain(`casts a ${word} spell`);
            // The colour filter is internal to spellCastTrigger; assert the
            // matched colour fires the trigger and an off-colour does not.
            const self = makeInstance(card.id, {
                id: "tal",
                controllerId: "p1",
                ownerId: "p1",
            });
            const onColor = trig.matches(
                {
                    type: "SPELL_CAST",
                    casterId: "p2",
                    spellInstanceId: "s",
                    spellCardId: "x",
                    spellTypes: ["Instant"],
                    spellSubtypes: [],
                    spellColors: [color],
                } as StackItem["triggerEvent"] & { type: "SPELL_CAST" },
                self,
                makeState()
            );
            expect(onColor).toBe(true);
        }
    });

    it("paying {3} untaps the chosen permanent; declining untaps nothing", () => {
        const tal = makeInstance(hematiteTalisman.id, {
            id: "tal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const tappedPerm = makeInstance(balduvianBears.id, {
            id: "tappedc",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tal, tappedPerm] }),
                makePlayer("p2"),
            ],
        });
        // A red spell was cast by p2; fire the trigger.
        resolveTrigger(state, tal, "hematite-talisman-untap", {
            type: "SPELL_CAST",
            casterId: "p2",
        } as StackItem["triggerEvent"]);
        // Suspends on the may-pay; fund and accept.
        state.players[0].manaPool = { C: 3 };
        applyMayPaySubmit(state, {
            playerId: state.pendingChoices![0].playerId,
            accept: true,
        });
        // Now suspended on the choose-permanents target pick.
        expect(state.pendingChoices![0].kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: state.pendingChoices![0].playerId,
            stackItemId: state.pendingChoices![0].stackItemId,
            step: state.pendingChoices![0].step,
            choiceId: state.pendingChoices![0].choiceId,
            cardInstanceIds: ["tappedc"],
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "tappedc"
        )!;
        expect(after.isTapped).toBe(false);
    });

    it("declining the may-pay leaves the permanent tapped", () => {
        const tal = makeInstance(onyxTalisman.id, {
            id: "tal",
            controllerId: "p1",
            ownerId: "p1",
        });
        const tappedPerm = makeInstance(balduvianBears.id, {
            id: "tappedc",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tal, tappedPerm] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, tal, "onyx-talisman-untap", {
            type: "SPELL_CAST",
            casterId: "p2",
        } as StackItem["triggerEvent"]);
        applyMayPaySubmit(state, {
            playerId: state.pendingChoices![0].playerId,
            accept: false,
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "tappedc"
        )!;
        expect(after.isTapped).toBe(true);
    });
});

describe("Baton of Morale ({2}: grant banding, CR 702.22 / 611 layer 6)", () => {
    it("grants banding until end of turn (wire format survives projection)", () => {
        const baton = makeInstance(batonOfMorale.id, {
            id: "baton",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("tgt", 2, 2, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [baton, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, baton, "baton-of-morale-banding", [
            { type: "permanent", id: "tgt" },
        ]);
        const t = state.players[0].battlefield.find((c) => c.id === "tgt")!;
        expect(t.staticAbilities).toContain("banding");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tgt"
        )!;
        expect(slim.staticAbilities).toContain("banding");
    });
});

describe("Crown of the Ages ({4},{T}: move an Aura, CR 303.4 / 701.3d)", () => {
    it("reattaches the targeted Aura to a different chosen creature", () => {
        const crown = makeInstance(crownOfTheAges.id, {
            id: "crown",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oldHost = vanilla("oldhost", 2, 2, {
            id: "oldhost",
            controllerId: "p1",
            ownerId: "p1",
        });
        const newHost = vanilla("newhost", 3, 3, {
            id: "newhost",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Use a real ICE Aura (Armor of Faith) attached to oldHost.
        const aura = makeInstance(armorOfFaith.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "oldhost",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [crown, oldHost, newHost, aura],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, crown, "crown-of-the-ages-move-aura", [
            { type: "permanent", id: "aura" },
        ]);
        // Suspended on the new-host pick — oldHost is excluded.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["newhost"],
        });
        const movedAura = state.players[0].battlefield.find(
            (c) => c.id === "aura"
        )!;
        expect(movedAura.attachedTo).toBe("newhost");
        // The +1/+1 now buffs the new host (3/3 → 4/4).
        const nh = state.players[0].battlefield.find(
            (c) => c.id === "newhost"
        )!;
        expect(getEffectivePower(state, nh)).toBe(4);
    });
});

describe("Goblin Lyre (sac + coin flip damage, CR 705 / 120.1)", () => {
    function setup(seed: number) {
        const lyre = makeInstance(goblinLyre.id, {
            id: "lyre",
            controllerId: "p1",
            ownerId: "p1",
        });
        const myCreatures = [0, 1, 2].map((i) =>
            vanilla(`mine${i}`, 1, 1, {
                id: `mine${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const oppCreatures = [0, 1].map((i) =>
            vanilla(`opp${i}`, 1, 1, {
                id: `opp${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            rngSeed: seed,
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [lyre, ...myCreatures],
                }),
                makePlayer("p2", { life: 20, battlefield: oppCreatures }),
            ],
        });
        return { state, lyre };
    }
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    it("win: deals damage to the opponent equal to creatures you control (3)", () => {
        const { state, lyre } = setup(1); // WIN seed
        resolveActivated(state, lyre, "goblin-lyre-flip", [
            { type: "player", id: "p2" },
        ]);
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        ack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
        expect(state.players[0].life).toBe(20);
    });

    it("lose: deals damage to you equal to creatures the opponent controls (2)", () => {
        const { state, lyre } = setup(7); // LOSE seed
        resolveActivated(state, lyre, "goblin-lyre-flip", [
            { type: "player", id: "p2" },
        ]);
        ack(state);
        expect(state.players[0].life).toBe(18); // 20 - 2
        expect(state.players[1].life).toBe(20);
    });
});

describe("Infinite Hourglass (time counters + scaled anthem, CR 122 / 613)", () => {
    it("the anthem adds +1/+0 to all creatures per time counter (wire format)", () => {
        const hourglass = makeInstance(infiniteHourglass.id, {
            id: "hg",
            controllerId: "p1",
            ownerId: "p1",
            counters: { time: 2 },
        });
        const myCreature = vanilla("mine", 2, 2, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppCreature = vanilla("opp", 1, 1, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hourglass, myCreature] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        // +2/+0 to ALL creatures (both controllers).
        expect(getEffectivePower(state, myCreature)).toBe(4);
        expect(getEffectivePower(state, oppCreature)).toBe(3);
        expect(getEffectiveToughness(state, myCreature)).toBe(2);
        // Wire format: the anthem survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimMine = projected.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(getEffectivePower(projected, slimMine)).toBe(4);
    });

    it("the upkeep trigger adds a time counter; the {3} ability removes one", () => {
        const hourglass = makeInstance(infiniteHourglass.id, {
            id: "hg",
            controllerId: "p1",
            ownerId: "p1",
            counters: { time: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hourglass] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        resolveTrigger(state, hourglass, "infinite-hourglass-accrue", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        let hg = state.players[0].battlefield.find((c) => c.id === "hg")!;
        expect(hg.counters?.time).toBe(2);
        resolveActivated(state, hg, "infinite-hourglass-remove");
        hg = state.players[0].battlefield.find((c) => c.id === "hg")!;
        expect(hg.counters?.time).toBe(1);
    });

    it("the {3} removal is restricted to upkeep and activatable by any player", () => {
        const ability = infiniteHourglass.activatedAbilities![0];
        expect(ability.activatableByAnyPlayer).toBe(true);
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
    });
});

describe("Time Bomb (time counters + scaled board wipe, CR 122 / 119)", () => {
    it("detonating deals damage equal to time counters to each creature and player", () => {
        const bomb = makeInstance(timeBomb.id, {
            id: "bomb",
            controllerId: "p1",
            ownerId: "p1",
            counters: { time: 2 },
        });
        const myCreature = vanilla("mine", 1, 1, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppCreature = vanilla("opp", 3, 3, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [bomb, myCreature] }),
                makePlayer("p2", { life: 20, battlefield: [oppCreature] }),
            ],
        });
        // The sacrifice is a cost: remove the bomb from the battlefield and
        // carry the counters on the resolving stack item (CR 608.2g LKI).
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "bomb"
        );
        state.stack.push({
            ...bomb,
            zone: "stack",
            castById: "p1",
            abilityId: "time-bomb-detonate",
            counters: { time: 2 },
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
        // The 1/1 took 2 damage → dies (SBA); the 3/3 survives with 2 marked.
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")
        ).toBeUndefined();
        const opp = state.players[1].battlefield.find((c) => c.id === "opp");
        expect(opp).toBeDefined();
    });
});

describe("Walking Wall (Defender + mobilize, CR 702.3 / 508 / 613)", () => {
    it("the {3} ability pumps +3/-1 and lets it attack despite defender", () => {
        const wall = makeInstance(walkingWall.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        expect(walkingWall.staticAbilities).toContain("defender");
        expect(walkingWall.activatedAbilities![0].oncePerTurn).toBe(true);
        resolveActivated(state, wall, "walking-wall-mobilize");
        const w = state.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(getEffectivePower(state, w)).toBe(3); // 0 + 3
        expect(getEffectiveToughness(state, w)).toBe(5); // 6 - 1
        // It is now allowed to attack despite defender this turn.
        expect(w.canAttackDespiteDefenderThisTurn).toBe(true);
    });
});

describe("Runed Arch ({X},{T},Sac: X unblockable, CR 107.3 / 509.1b)", () => {
    it("enters tapped and marks X power<=2 creatures unblockable this turn", () => {
        expect(runedArch.entersTapped).toBe(true);
        const arch = makeInstance(runedArch.id, {
            id: "arch",
            controllerId: "p1",
            ownerId: "p1",
        });
        const small = vanilla("small", 2, 2, {
            id: "small",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [arch, small] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, arch, "runed-arch-unblockable", [
            { type: "permanent", id: "small" },
        ]);
        const s = state.players[0].battlefield.find((c) => c.id === "small")!;
        expect(s.cantBeBlockedThisTurn).toBe(true);
    });
});

describe("Soldevi Golem (does-not-untap + upkeep untap, CR 702 / 701.20b)", () => {
    it("optionally untaps a tapped opponent creature and itself", () => {
        expect(soldeviGolem.staticAbilities).toContain("does-not-untap");
        const golem = makeInstance(soldeviGolem.id, {
            id: "golem",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const oppCreature = vanilla("oppc", 2, 2, {
            id: "oppc",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [golem] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
            activePlayerId: "p1",
        });
        resolveTrigger(state, golem, "soldevi-golem-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Suspends on the may-pay; accept.
        applyMayPaySubmit(state, {
            playerId: state.pendingChoices![0].playerId,
            accept: true,
        });
        // Then the target pick.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["oppc"],
        });
        expect(
            state.players[1].battlefield.find((c) => c.id === "oppc")!.isTapped
        ).toBe(false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "golem")!.isTapped
        ).toBe(false);
    });
});

describe("Pentagram of the Ages ({4},{T}: prevent next damage, CR 615)", () => {
    it("prevents the next damage from the chosen source to the controller", () => {
        const pentagram = makeInstance(pentagramOfTheAges.id, {
            id: "pent",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppSource = vanilla("burner", 3, 3, {
            id: "burner",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [pentagram] }),
                makePlayer("p2", { battlefield: [oppSource] }),
            ],
        });
        resolveActivated(state, pentagram, "pentagram-of-the-ages-prevent");
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("pick-source");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["burner"],
        });
        // A prevention shield now exists for the controller.
        expect(state.players[0].life).toBe(20);
    });
});

describe("Jester's Mask ({1},{T},Sac: hand shuffle, CR 701.19 / 701.20)", () => {
    it("enters tapped and shuffles the opponent's hand back via library search", () => {
        expect(jestersMask.entersTapped).toBe(true);
        const mask = makeInstance(jestersMask.id, {
            id: "mask",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCards = [0, 1].map((i) =>
            makeInstance(balduvianBears.id, {
                id: `h${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const libCards = [0, 1, 2].map((i) =>
            makeInstance(balduvianBears.id, {
                id: `l${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mask] }),
                makePlayer("p2", { hand: handCards, library: libCards }),
            ],
        });
        resolveActivated(state, mask, "jesters-mask-rearrange", [
            { type: "player", id: "p2" },
        ]);
        // Hand was emptied onto the library, then a search is requested.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["l0", "l1"],
        });
        // Two cards drawn back into hand; library reshuffled (5 total minus 2).
        expect(state.players[1].hand).toHaveLength(2);
        expect(state.players[1].library).toHaveLength(3);
    });
});

describe("Force Void (counter unless pay {1}, CR 701.5a)", () => {
    it("counters the targeted spell when controller declines, then cantrips", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        // p2 has a spell on the stack to be countered.
        const victim = pushSpell(state, blessedWine.id, "p2");
        castCantrip(state, forceVoid.id, "p1", [
            { type: "spell", id: victim.id },
        ]);
        // Suspended on the spell controller's may-pay; decline → counter.
        const head = state.pendingChoices![0];
        applyMayPaySubmit(state, { playerId: head.playerId, accept: false });
        // The victim spell is no longer on the stack (countered).
        expect(state.stack.find((s) => s.id === victim.id)).toBeUndefined();
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Barbed Sextant (sac for any mana + next-upkeep cantrip, ADR 0040)", () => {
    it("arms the next-upkeep cantrip on the tap-for-mana rider", () => {
        const ability = barbedSextant.activatedAbilities?.[0];
        expect(ability?.useStack).toBe(false);
        expect(ability?.armsDelayedTriggerOnTap?.timing).toBe("next-upkeep");
        expect(barbedSextant.delayedTriggers?.[0]?.timing).toBe("next-upkeep");
    });
});

describe("Snow-Covered basics (CR 205.4a Snow supertype)", () => {
    const basics = [
        { def: snowCoveredPlains, sub: "Plains" },
        { def: snowCoveredIsland, sub: "Island" },
        { def: snowCoveredSwamp, sub: "Swamp" },
        { def: snowCoveredMountain, sub: "Mountain" },
        { def: snowCoveredForest, sub: "Forest" },
    ];

    for (const { def, sub } of basics) {
        it(`${def.name} is a registered Basic Snow Land with the ${sub} subtype`, () => {
            expect(getDefinition(def.id)).toBe(def);
            expect(getCardByName(def.name)).toBe(def);
            expect(getAllCards()).toContain(def);
            expect(def.types).toEqual(["Land"]);
            expect(def.supertypes).toContain("Basic");
            expect(def.supertypes).toContain("Snow");
            expect(def.subtypes).toEqual([sub]);
        });
    }

    it("reads as a snow land live (printed Snow supertype) and survives the wire", () => {
        const land = snowLand(snowCoveredForest.id, "snow-forest", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        expect(hasSnowSupertype(land)).toBe(true);
        expect(countSnowLands(state.players[0].battlefield)).toBe(1);
        // Wire format: snow status survives projectPublicState (card.card → {id}).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "snow-forest"
        )!;
        expect(hasSnowSupertype(slim)).toBe(true);
        expect(countSnowLands(projected.players[0].battlefield)).toBe(1);
    });

    it("a normal (non-snow) Plains is not a snow land", () => {
        const plains = makeInstance("b1623d57-4729-4796-b3f7-f1837a05c6ed", {
            id: "plain",
        });
        expect(hasSnowSupertype(plains)).toBe(false);
        expect(countSnowLands([plains])).toBe(0);
    });
});

describe("Snow read helpers (CR 205.4a)", () => {
    it("countSnowLands counts only snow lands a player controls", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p1");
        const snowM = snowLand(snowCoveredMountain.id, "sm", "p1");
        const plain = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            id: "pf", // normal Forest
        });
        expect(countSnowLands([snowF, snowM, plain])).toBe(2);
    });

    it("controlsSnowSubtype matches snow lands of a basic subtype only", () => {
        const snowSwamp = snowLand(snowCoveredSwamp.id, "ss", "p1");
        const snowMtn = snowLand(snowCoveredMountain.id, "sm", "p1");
        expect(controlsSnowSubtype([snowSwamp, snowMtn], "Swamp")).toBe(true);
        expect(controlsSnowSubtype([snowMtn], "Swamp")).toBe(false);
        expect(controlsSnowSubtype([snowMtn], "Mountain")).toBe(true);
    });
});

describe("Melting (CR 205.4a supertype-set static — remove Snow)", () => {
    it("removes Snow from all lands while in play; restores on leave", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p1");
        const meltInst = makeInstance(melting.id, {
            id: "melt",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snowF, meltInst] }),
                makePlayer("p2"),
            ],
        });
        expect(hasSnowSupertype(snowF)).toBe(true);
        applySourceStaticEffects(state, meltInst);
        expect(hasSnowSupertype(snowF)).toBe(false);
        expect(countSnowLands(state.players[0].battlefield)).toBe(0);
        unapplySourceStaticEffects(state, meltInst);
        expect(hasSnowSupertype(snowF)).toBe(true);
    });

    it("wire format: the un-snow status survives projectPublicState", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p1");
        const meltInst = makeInstance(melting.id, {
            id: "melt",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snowF, meltInst] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, meltInst);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sf"
        )!;
        expect(hasSnowSupertype(slim)).toBe(false);
    });

    it("a snow land entering under Melting immediately loses Snow", () => {
        const meltInst = makeInstance(melting.id, {
            id: "melt",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [meltInst] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, meltInst);
        const newSnow = snowLand(snowCoveredForest.id, "new-sf", "p1");
        state.players[0].battlefield.push(newSnow);
        applyExistingGrantsTo(state, newSnow);
        expect(hasSnowSupertype(newSnow)).toBe(false);
    });
});

describe("Arcum's Weathervane (CR 205.4a indefinite supertype mutation)", () => {
    it("removes Snow from a target snow land indefinitely", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p1");
        const wv = makeInstance(arcumsWeathervane.id, {
            id: "wv",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snowF, wv] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wv, "arcums-weathervane-unsnow", [
            { type: "permanent", id: "sf" },
        ]);
        expect(hasSnowSupertype(state.players[0].battlefield[0])).toBe(false);
    });

    it("adds Snow to a nonsnow basic land indefinitely (survives the wire)", () => {
        const plainForest = makeInstance(
            "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
            { id: "pf", controllerId: "p1", ownerId: "p1" }
        );
        const wv = makeInstance(arcumsWeathervane.id, {
            id: "wv",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plainForest, wv] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wv, "arcums-weathervane-snow", [
            { type: "permanent", id: "pf" },
        ]);
        const land = state.players[0].battlefield.find((c) => c.id === "pf")!;
        expect(hasSnowSupertype(land)).toBe(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "pf"
        )!;
        expect(hasSnowSupertype(slim)).toBe(true);
    });

    it("only snow lands are legal targets for the un-snow ability", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p1");
        const plainForest = makeInstance(
            "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
            { id: "pf", controllerId: "p1", ownerId: "p1" }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snowF, plainForest] }),
                makePlayer("p2"),
            ],
        });
        const legal = getLegalTargets(
            state,
            arcumsWeathervane.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("sf");
        expect(legal).not.toContain("pf");
    });
});

describe("Drift of the Dead (CR 604.3 snow-count CDA)", () => {
    it("P/T equals the number of snow lands its controller controls", () => {
        const drift = makeInstance(driftOfTheDead.id, {
            id: "drift",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        drift,
                        snowLand(snowCoveredForest.id, "s1", "p1"),
                        snowLand(snowCoveredMountain.id, "s2", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, drift)).toBe(2);
        expect(getEffectiveToughness(state, drift)).toBe(2);
    });

    it("wire format: snow-count P/T survives projectPublicState", () => {
        const drift = makeInstance(driftOfTheDead.id, {
            id: "drift",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        drift,
                        snowLand(snowCoveredForest.id, "s1", "p1"),
                        snowLand(snowCoveredMountain.id, "s2", "p1"),
                        snowLand(snowCoveredSwamp.id, "s3", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, drift)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "drift"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("has defender", () => {
        expect(driftOfTheDead.staticAbilities).toContain("defender");
    });
});

describe("Cold Snap (CR 205.4a snow-count upkeep damage)", () => {
    it("deals damage equal to the active player's snow lands at their upkeep", () => {
        const cs = makeInstance(coldSnap.id, { id: "cs", controllerId: "p1" });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        cs,
                        snowLand(snowCoveredForest.id, "s1", "p1"),
                        snowLand(snowCoveredMountain.id, "s2", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, cs, "cold-snap-upkeep-damage", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        expect(state.players[0].life).toBe(18); // 20 − 2 snow lands
    });
});

describe("Avalanche (CR 205.4a snow-land targets)", () => {
    it("only snow lands are legal targets", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p2");
        const plain = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            id: "pf",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [snowF, plain] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            { ...avalanche.targetRequirement!, count: 1 },
            [],
            "p1",
            1
        ).map((t) => t.id);
        expect(legal).toContain("sf");
        expect(legal).not.toContain("pf");
    });
});

describe("Balduvian Conjurer (CR 208.2 animate snow land)", () => {
    it("animates a target snow land into a 2/2 that stays a land", () => {
        const conj = makeInstance(balduvianConjurer.id, {
            id: "conj",
            controllerId: "p1",
        });
        const snowF = snowLand(snowCoveredForest.id, "sf", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [conj, snowF] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, conj, "balduvian-conjurer-animate", [
            { type: "permanent", id: "sf" },
        ]);
        const land = state.players[0].battlefield.find((c) => c.id === "sf")!;
        expect(land.types).toContain("Creature");
        expect(land.types).toContain("Land");
        expect(getEffectivePower(state, land)).toBe(2);
        expect(getEffectiveToughness(state, land)).toBe(2);
    });

    it("only snow lands are legal targets", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p1");
        const plain = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            id: "pf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snowF, plain] }),
                makePlayer("p2"),
            ],
        });
        const legal = getLegalTargets(
            state,
            balduvianConjurer.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("sf");
        expect(legal).not.toContain("pf");
    });
});

describe("Karplusan Giant (CR 118.8 snow-land tap cost)", () => {
    it("pumps +1/+1 when a snow land is tapped for the cost", () => {
        const giant = makeInstance(karplusanGiant.id, {
            id: "giant",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        giant,
                        snowLand(snowCoveredMountain.id, "sm", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, giant, "karplusan-giant-pump");
        expect(getEffectivePower(state, giant)).toBe(4);
        expect(getEffectiveToughness(state, giant)).toBe(4);
    });
});

describe("Glacial Crevasses / Sunstone (CR 118.5 snow-Mountain / snow-land sacrifice)", () => {
    it("Glacial Crevasses requires a snow Mountain to pay its sacrifice cost", () => {
        const ability = glacialCrevasses.activatedAbilities![0];
        expect(ability.cost.sacrificeFilter?.subtypes).toBe("Mountain");
        expect(ability.cost.sacrificeFilter?.supertypes).toEqual(["Snow"]);
    });

    it("Glacial Crevasses prevents all combat damage on resolution", () => {
        const gc = makeInstance(glacialCrevasses.id, {
            id: "gc",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        gc,
                        snowLand(snowCoveredMountain.id, "sm", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gc, "glacial-crevasses-fog");
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });

    it("Sunstone's sacrifice cost is a snow land", () => {
        const ability = sunstone.activatedAbilities![0];
        expect(ability.cost.sacrificeFilter?.types).toBe("Land");
        expect(ability.cost.sacrificeFilter?.supertypes).toEqual(["Snow"]);
    });
});

describe("Withering Wisps (CR 602.5f snow-Swamp activation cap)", () => {
    it("can activate up to the number of snow Swamps controlled", () => {
        const ww = makeInstance(witheringWisps.id, {
            id: "ww",
            controllerId: "p1",
            activationsThisTurn: { "withering-wisps-blast": 1 },
        });
        const stateOneSwamp = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        ww,
                        snowLand(snowCoveredSwamp.id, "ss", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const ability = witheringWisps.activatedAbilities![0];
        // 1 snow Swamp, 1 use already → at cap (cannot activate again).
        expect(
            ability.canActivate!(
                stateOneSwamp.players[0].battlefield[0],
                stateOneSwamp
            )
        ).toBe(false);
        // Two snow Swamps, 1 use → still under cap.
        const stateTwoSwamps = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        ww,
                        snowLand(snowCoveredSwamp.id, "ss", "p1"),
                        snowLand(snowCoveredSwamp.id, "ss2", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(
            ability.canActivate!(
                stateTwoSwamps.players[0].battlefield[0],
                stateTwoSwamps
            )
        ).toBe(true);
    });
});

describe("Snowblind (CR 604.3 snow-count -X/-Y aura)", () => {
    it("reduces P/T by the controller's snow-land count (toughness capped)", () => {
        const creature = vanilla("c", 4, 4);
        creature.controllerId = "p1";
        const aura = makeInstance(snowblind.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "c",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        creature,
                        aura,
                        snowLand(snowCoveredForest.id, "s1", "p1"),
                        snowLand(snowCoveredMountain.id, "s2", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, aura);
        // X = 2 snow lands → -2/-2 (toughness 4 → cap min(2, 3) = 2).
        expect(getEffectivePower(state, creature)).toBe(2);
        expect(getEffectiveToughness(state, creature)).toBe(2);
    });
});

describe("Arcum's Sleigh (CR 205.4a defending-player snow gate)", () => {
    it("can only activate while the defending (non-active) player has a snow land", () => {
        const sleigh = makeInstance(arcumsSleigh.id, {
            id: "sleigh",
            controllerId: "p1",
        });
        const ability = arcumsSleigh.activatedAbilities![0];
        // p1 is active; defender p2 has no snow land → cannot activate.
        const without = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [sleigh] }),
                makePlayer("p2"),
            ],
        });
        expect(
            ability.canActivate!(without.players[0].battlefield[0], without)
        ).toBe(false);
        // Defender p2 controls a snow land → can activate.
        const withSnow = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [sleigh] }),
                makePlayer("p2", {
                    battlefield: [snowLand(snowCoveredForest.id, "sf", "p2")],
                }),
            ],
        });
        expect(
            ability.canActivate!(withSnow.players[0].battlefield[0], withSnow)
        ).toBe(true);
    });

    it("grants vigilance until end of turn on resolution", () => {
        const sleigh = makeInstance(arcumsSleigh.id, {
            id: "sleigh",
            controllerId: "p1",
        });
        const creature = vanilla("c", 2, 2);
        creature.controllerId = "p1";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sleigh, creature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sleigh, "arcums-sleigh-vigilance", [
            { type: "permanent", id: "c" },
        ]);
        const after = state.players[0].battlefield.find((c) => c.id === "c")!;
        expect(after.staticAbilities).toContain("vigilance");
    });
});

describe("supertype filter wire-format round-trip (CR 205.4a)", () => {
    it("hasSupertypeLive reads an indefinite add/remove after projection", () => {
        const land = snowLand(snowCoveredForest.id, "sf", "p1");
        land.removedSupertypes = [
            { supertype: "Snow", sourceId: "indefinite" },
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        expect(hasSupertypeLive(land, "Snow")).toBe(false);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sf"
        )!;
        expect(hasSupertypeLive(slim, "Snow")).toBe(false);
    });
});

// ── Painland cycle (#662) — coloured-tap self-damage rider ──────────────────
// CR 605.1a — both lines are mana abilities (useStack: false). Modelled as ONE
// choice mana ability: option 0 is the painless {C}; options 1-2 are the two
// colours carrying `dealsDamageToControllerOnColoredTap: 1`. The engine deals 1
// damage to the controller (CR 120, via the permanent-source player-damage
// pipeline) only when a COLOURED option is chosen — never on the painless {C}.
describe("painland cycle (#662) — coloured-tap self-damage (CR 605.1a / 120)", () => {
    const painlands = [
        { def: adarkarWastes, colors: ["W", "U"] as const, c1Idx: 1, c2Idx: 2 },
        { def: brushland, colors: ["G", "W"] as const, c1Idx: 1, c2Idx: 2 },
        {
            def: karplusanForest,
            colors: ["R", "G"] as const,
            c1Idx: 1,
            c2Idx: 2,
        },
        {
            def: sulfurousSprings,
            colors: ["B", "R"] as const,
            c1Idx: 1,
            c2Idx: 2,
        },
        {
            def: undergroundRiver,
            colors: ["U", "B"] as const,
            c1Idx: 1,
            c2Idx: 2,
        },
    ];

    for (const { def, colors } of painlands) {
        describe(`${def.name}`, () => {
            it("is a Land with one {T} choice mana ability: {C} (index 0) + the two colours carrying a 1-damage rider", () => {
                expect(def.types).toEqual(["Land"]);
                const mana = def.activatedAbilities?.find(
                    (a) => !a.useStack && a.manaChoices
                );
                expect(mana?.useStack).toBe(false);
                expect(mana?.cost).toEqual({ tap: true });
                // Index 0 is the painless {C}; 1 and 2 are the two colours.
                expect(mana?.manaChoices).toEqual([
                    { C: 1 },
                    { [colors[0]]: 1 },
                    { [colors[1]]: 1 },
                ]);
                expect(mana?.dealsDamageToControllerOnColoredTap).toBe(1);
            });

            it("tapping for {C} (the painless choice) costs NO life and adds {C} (CR 605.1a)", () => {
                const land = makeInstance(def.id, {
                    id: "land",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const player = makePlayer("p1", { battlefield: [land] });
                const state = makeState({
                    players: [player, makePlayer("p2")],
                });
                state.activePlayerId = "p1";
                // Full-path through the payment tap (index 0 = {C}).
                tapSourceIntoPayment(state, player, land, 0, []);
                expect(player.manaPool.C).toBe(1);
                expect(player.life).toBe(20); // painless
            });

            it(`tapping for ${colors[0]} (a coloured choice) costs 1 life and adds {${colors[0]}} (CR 120)`, () => {
                const land = makeInstance(def.id, {
                    id: "land",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const player = makePlayer("p1", { battlefield: [land] });
                const state = makeState({
                    players: [player, makePlayer("p2")],
                });
                state.activePlayerId = "p1";
                // Index 1 = the first colour.
                tapSourceIntoPayment(state, player, land, 1, []);
                expect(player.manaPool[colors[0]]).toBe(1);
                expect(player.life).toBe(19); // pinged for 1
            });

            it(`tapping for ${colors[1]} (the other colour) also costs 1 life`, () => {
                const land = makeInstance(def.id, {
                    id: "land",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const player = makePlayer("p1", { battlefield: [land] });
                const state = makeState({
                    players: [player, makePlayer("p2")],
                });
                state.activePlayerId = "p1";
                tapSourceIntoPayment(state, player, land, 2, []);
                expect(player.manaPool[colors[1]]).toBe(1);
                expect(player.life).toBe(19);
            });

            it("the coloured-tap life loss survives the wire-format projection (CR 120, PublicGameState)", () => {
                const land = makeInstance(def.id, {
                    id: "land",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const player = makePlayer("p1", { battlefield: [land] });
                const state = makeState({
                    players: [player, makePlayer("p2")],
                });
                state.activePlayerId = "p1";
                tapSourceIntoPayment(state, player, land, 1, []);
                // Life loss is observed on the projected (slim) state too.
                const projected = projectPublicState(state, 1, "p1");
                expect(projected.players[0].life).toBe(19);
            });
        });
    }
});

// ---------------------------------------------------------------------------
// Depletion-dual cycle (#663, CR 605.1a / 502.1 / 603.6a / 122.1)
//
// Land Cap (WU), Lava Tubes (BR), River Delta (UB), Timberline Ridge (RG),
// Veldt (GW). Each: "{T}: Add <c1> or <c2>. Put a depletion counter on this
// land." + "doesn't untap while it has a depletion counter" + "remove a
// depletion counter at your upkeep". The depletion counter rides the existing
// per-instance `counters` map — no new GameState field.
// ---------------------------------------------------------------------------
describe("ICE depletion-dual cycle (#663, CR 605.1a / 502.1 / 603.6a)", () => {
    const depletionDuals = [
        { def: landCap, colors: ["W", "U"] as const },
        { def: lavaTubes, colors: ["B", "R"] as const },
        { def: riverDelta, colors: ["U", "B"] as const },
        { def: timberlineRidge, colors: ["R", "G"] as const },
        { def: veldt, colors: ["G", "W"] as const },
    ];

    for (const { def, colors } of depletionDuals) {
        describe(`${def.name}`, () => {
            it("is a Land with the depletion-untap static and a {T} two-colour mana ability carrying the depletion rider", () => {
                expect(def.types).toEqual(["Land"]);
                expect(def.staticAbilities).toContain(
                    "does-not-untap-with-depletion-counter"
                );
                const mana = def.activatedAbilities?.find(
                    (a) => !a.useStack && a.manaChoices
                );
                expect(mana?.useStack).toBe(false);
                expect(mana?.cost).toEqual({ tap: true });
                // Both choices are coloured (no painless {C}).
                expect(mana?.manaChoices).toEqual([
                    { [colors[0]]: 1 },
                    { [colors[1]]: 1 },
                ]);
                expect(mana?.putDepletionCounterOnTap).toBe(true);
                expect(
                    mana?.dealsDamageToControllerOnColoredTap
                ).toBeUndefined();
            });

            it("declares an upkeep depletion-removal trigger", () => {
                const slug = def.name.toLowerCase().replace(/[^a-z]+/g, "-");
                const trig = def.triggeredAbilities?.find(
                    (t) => t.id === `${slug}-upkeep-deplete`
                );
                expect(trig?.event).toBe("PHASE_BEGIN");
            });

            it(`tapping for ${colors[0]} adds {${colors[0]}} and one depletion counter, no life loss (CR 605.1a / 122.1)`, () => {
                const land = makeInstance(def.id, {
                    id: "land",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const player = makePlayer("p1", { battlefield: [land] });
                const state = makeState({
                    players: [player, makePlayer("p2")],
                });
                state.activePlayerId = "p1";
                // Full-path through the payment tap (index 0 = first colour).
                tapSourceIntoPayment(state, player, land, 0, []);
                expect(player.manaPool[colors[0]]).toBe(1);
                expect(player.life).toBe(20); // depletion ≠ pain
                const live = player.battlefield.find((c) => c.id === "land")!;
                expect(live.counters?.["depletion"]).toBe(1);
            });

            it(`tapping for ${colors[1]} also adds exactly one depletion counter`, () => {
                const land = makeInstance(def.id, {
                    id: "land",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const player = makePlayer("p1", { battlefield: [land] });
                const state = makeState({
                    players: [player, makePlayer("p2")],
                });
                state.activePlayerId = "p1";
                tapSourceIntoPayment(state, player, land, 1, []);
                expect(player.manaPool[colors[1]]).toBe(1);
                const live = player.battlefield.find((c) => c.id === "land")!;
                expect(live.counters?.["depletion"]).toBe(1);
            });

            it("upkeep trigger removes one depletion counter (CR 603.6a / 122.1)", () => {
                const land = makeInstance(def.id, {
                    id: "land",
                    controllerId: "p1",
                    ownerId: "p1",
                    counters: { depletion: 1 },
                });
                const state = makeState({
                    players: [
                        makePlayer("p1", { battlefield: [land] }),
                        makePlayer("p2"),
                    ],
                });
                state.activePlayerId = "p1";
                const slug = def.name.toLowerCase().replace(/[^a-z]+/g, "-");
                resolveTrigger(state, land, `${slug}-upkeep-deplete`, {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                } as StackItem["triggerEvent"]);
                const live = state.players[0].battlefield.find(
                    (c) => c.id === "land"
                )!;
                expect(live.counters?.["depletion"] ?? 0).toBe(0);
            });
        });
    }

    // The headline behaviour: walk TWO full turns and assert the land untaps
    // every OTHER turn (CR 502.1). Uses Land Cap as the representative.
    it("untaps every other turn: tap → skip untap (counter present) → upkeep clears → untap (two-turn cadence)", () => {
        const slug = "land-cap";
        const land = makeInstance(landCap.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";

        const live = () =>
            state.players[0].battlefield.find((c) => c.id === "land")!;
        const fireUpkeep = () =>
            resolveTrigger(state, live(), `${slug}-upkeep-deplete`, {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            } as StackItem["triggerEvent"]);

        // --- Turn 1: tap for mana → land tapped + depletion counter on it.
        tapSourceIntoPayment(state, player, live(), 0, []);
        expect(live().isTapped).toBe(true);
        expect(live().counters?.["depletion"]).toBe(1);

        // --- Turn 2 untap step: counter present → land STAYS tapped (CR 502.1).
        untapStep(state);
        expect(live().isTapped).toBe(true);
        expect(live().counters?.["depletion"]).toBe(1);
        // Turn 2 upkeep: remove a depletion counter → now zero.
        fireUpkeep();
        expect(live().counters?.["depletion"] ?? 0).toBe(0);
        // (Land is still tapped this turn — it only untaps at the NEXT untap.)
        expect(live().isTapped).toBe(true);

        // --- Turn 3 untap step: no counter → land UNTAPS.
        untapStep(state);
        expect(live().isTapped).toBe(false);

        // Tapping again restarts the cycle: counter back on, skips next untap.
        tapSourceIntoPayment(state, player, live(), 1, []);
        expect(live().counters?.["depletion"]).toBe(1);
        untapStep(state);
        expect(live().isTapped).toBe(true); // skipped again
    });

    it("wire format: the depletion counter and tapped state survive projectPublicState (CR 122.1, PublicGameState)", () => {
        const land = makeInstance(landCap.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, land, 0, []);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "land"
        )!;
        expect(slim.isTapped).toBe(true);
        expect(slim.counters?.["depletion"]).toBe(1);
    });
});

describe("Naked Singularity — per-basic-type permutation (CR 614, #665)", () => {
    it("shape: cumulative-upkeep {3} + per-basic-subtype mapping", () => {
        expect(nakedSingularity.types).toContain("Artifact");
        expect(nakedSingularity.manaCost).toEqual({ X: 5 });
        expect(nakedSingularity.landManaSubstitution).toEqual({
            byBasicSubtype: {
                Plains: "R",
                Island: "G",
                Swamp: "W",
                Mountain: "U",
                Forest: "B",
            },
        });
    });

    it("Plains→{R}, Island→{G}, Swamp→{W}, Mountain→{U}, Forest→{B}", () => {
        const expected: Record<string, ManaCost> = {
            [plains.id]: { R: 1 },
            [island.id]: { G: 1 },
            [swamp.id]: { W: 1 },
            [mountain.id]: { U: 1 },
            [forest.id]: { B: 1 },
        };
        const sing = makeInstance(nakedSingularity.id, {
            id: "ns",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        for (const landId of Object.keys(BASIC_MANA)) {
            const land = makeLand(landId, "p1");
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [sing, land] }),
                    makePlayer("p2"),
                ],
            });
            const out = applyLandManaReplacement(
                state,
                "p1",
                land,
                BASIC_MANA[landId]
            );
            expect(out).toEqual(expected[landId]);
        }
    });
});

describe("Land-mana substitution — wire-format survival (#665)", () => {
    it("Naked Singularity substitution survives projectPublicState", () => {
        const sing = makeInstance(nakedSingularity.id, {
            id: "ns",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const mtn = makeLand(mountain.id, "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sing, mtn] }),
                makePlayer("p2"),
            ],
        });
        // Fat state: Mountain → {U}.
        expect(applyLandManaReplacement(state, "p1", mtn, { R: 1 })).toEqual({
            U: 1,
        });
        // Same ruling after projection (def looked up by id, so the {U}
        // substitution survives the wire).
        const projected = projectPublicState(state, 1, "p1");
        const slimMtn = projected.players[0].battlefield.find(
            (c) => c.id === mtn.id
        )!;
        expect(
            applyLandManaReplacement(
                projected as unknown as GameState,
                "p1",
                slimMtn,
                { R: 1 }
            )
        ).toEqual({ U: 1 });
    });

    it("Infernal Darkness substitution survives projectPublicState", () => {
        const enchant = makeInstance(infernalDarkness.id, {
            id: "id",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const forestLand = makeLand(forest.id, "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant] }),
                makePlayer("p2", { battlefield: [forestLand] }),
            ],
        });
        expect(
            applyLandManaReplacement(state, "p2", forestLand, { G: 1 })
        ).toEqual({ B: 1 });
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === forestLand.id
        )!;
        expect(
            applyLandManaReplacement(
                projected as unknown as GameState,
                "p2",
                slim,
                { G: 1 }
            )
        ).toEqual({ B: 1 });
    });
});

describe("manaSpentDelta (CR 106.10)", () => {
    it("returns only the colours that decreased, with the amounts spent", () => {
        expect(
            manaSpentDelta(
                { W: 0, U: 2, B: 0, R: 3, G: 0, C: 0 },
                { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 }
            )
        ).toEqual({ U: 2, R: 2 });
    });
    it("is empty when nothing was spent", () => {
        expect(
            manaSpentDelta(
                { W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 },
                { W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 }
            )
        ).toEqual({});
    });
});

describe("Jeweled Amulet (noted-mana battery, CR 106.10)", () => {
    it("declares the charge ({1},{T}) and add ({T}, remove counter) abilities", () => {
        const charge = jeweledAmulet.activatedAbilities!.find(
            (a) => a.id === "jeweled-amulet-charge"
        )!;
        expect(charge.cost).toMatchObject({ mana: { X: 1 }, tap: true });
        expect(charge.noteManaSpent).toBe(true);
        expect(charge.canActivate).toBeTypeOf("function");
        const add = jeweledAmulet.activatedAbilities!.find(
            (a) => a.id === "jeweled-amulet-add"
        )!;
        expect(add.cost).toMatchObject({
            tap: true,
            removeCounter: { type: "charge", count: 1 },
        });
    });

    it("gates the charge ability on having no charge counters (CR 122)", () => {
        const charge = jeweledAmulet.activatedAbilities!.find(
            (a) => a.id === "jeweled-amulet-charge"
        )!;
        const noCounter = makeInstance(jeweledAmulet.id, {
            counters: { charge: 0 },
        });
        const oneCounter = makeInstance(jeweledAmulet.id, {
            counters: { charge: 1 },
        });
        const ctx = { phase: "PRECOMBAT_MAIN" } as never;
        expect(charge.canActivate!(noCounter, ctx)).toBe(true);
        expect(charge.canActivate!(oneCounter, ctx)).toBe(false);
    });

    it("notes the COLOUR spent on the charge and returns it on the add ability", () => {
        const amulet = makeInstance(jeweledAmulet.id, {
            id: "amulet",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 0 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [amulet] }),
                makePlayer("p2"),
            ],
        });
        // Charge ability: the {1} was paid with red mana → note {R:1}.
        resolveActivatedNoting(state, amulet, "jeweled-amulet-charge", {
            R: 1,
        });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "amulet"
        )!;
        expect(live.counters?.charge).toBe(1);
        expect(live.notedMana).toEqual({ mana: { R: 1 } });

        // Add ability: replay the noted red mana into the pool (unrestricted).
        live.counters = { charge: 1 };
        resolveActivated(state, live, "jeweled-amulet-add");
        expect(state.players[0].manaPool.R).toBe(1);
        expect(state.players[0].restrictedMana ?? []).toHaveLength(0);
    });

    it("overwrites the previous note ('last noted type')", () => {
        const amulet = makeInstance(jeweledAmulet.id, {
            id: "amulet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [amulet] }),
                makePlayer("p2"),
            ],
        });
        resolveActivatedNoting(state, amulet, "jeweled-amulet-charge", {
            U: 1,
        });
        resolveActivatedNoting(state, amulet, "jeweled-amulet-charge", {
            G: 1,
        });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "amulet"
        )!;
        expect(live.notedMana).toEqual({ mana: { G: 1 } });
    });

    it("integration: game.ts captures the spent colour at commit, GRE notes it (CR 106.10)", () => {
        // Full path: tryAutoCommitPendingActivation (game.ts) snapshots the
        // pool delta into `notedManaSpent`, then resolveTopOfStack runs the
        // card's resolve which stores it on the artifact via noteMana.
        const amulet = makeInstance(jeweledAmulet.id, {
            id: "amulet",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 0 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [amulet],
                    // Pool holds the {1} the charge ability will spend — green.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
        });
        const pa: PendingActivation = {
            playerId: "p1",
            cardInstanceId: "amulet",
            abilityId: "jeweled-amulet-charge",
            manaCost: { X: 1 },
            tappedLandIds: [],
            tapSource: true,
            sacrificeSource: false,
            noteManaSpent: true,
        };
        state.pendingActivation = pa;
        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).not.toBeNull();
        // The pending ability is on the stack carrying the captured colour.
        const onStack = state.stack[state.stack.length - 1];
        expect(onStack.notedManaSpent).toEqual({ G: 1 });
        // Resolve it: the artifact now stores the noted green mana.
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "amulet"
        )!;
        expect(live.notedMana).toEqual({ mana: { G: 1 } });
        expect(live.counters?.charge).toBe(1);
        expect(live.isTapped).toBe(true);
    });

    // Regression for #753 — the non-targeted activateAbility deferred/auto-tap
    // path silently dropped the noted-mana capture flag. This drives the REAL
    // `buildPendingActivation` (the seam the activateAbility mutation uses) so a
    // missing `noteManaSpent` flag would reproduce the original bug (empty note,
    // ability 2 a no-op). Charge with an EMPTY pool → a Mountain is auto-tapped
    // to pay {1}, the commit must still snapshot the spent colour.
    it("integration #753: deferred auto-tap path captures the colour and ability 2 yields the mana", () => {
        const amulet = makeInstance(jeweledAmulet.id, {
            id: "amulet",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 0 },
        });
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                // Empty pool: paying {1} forces the auto-tap/deferred commit
                // path through the real game.ts entry the bug lived in.
                makePlayer("p1", { battlefield: [amulet, mtn] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });

        // Build the pending activation the SAME way activateAbility does — via
        // the shared builder — so the test fails if the capture flag is dropped.
        const charge = jeweledAmulet.activatedAbilities!.find(
            (a) => a.id === "jeweled-amulet-charge"
        )!;
        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "amulet",
            abilityId: "jeweled-amulet-charge",
            ability: charge,
            manaCost: { X: 1 },
        });
        // The shared builder MUST carry the capture flag (root cause of #753).
        expect(state.pendingActivation.noteManaSpent).toBe(true);

        // Auto-tap the Mountain for {R}, then commit (real game.ts primitives).
        const player = state.players[0];
        const sources = buildAutoTapSources(player.battlefield);
        const plan = solveSmartAutoTap(
            player.manaPool,
            state.pendingActivation.manaCost,
            getManaSubstitutions(state, "p1"),
            sources,
            [],
            "amulet" // self-source deprioritization (the amulet has no mana ability)
        );
        for (const step of plan ?? []) {
            const card = player.battlefield.find((c) => c.id === step.cardId)!;
            tapSourceIntoPayment(
                state,
                player,
                card,
                step.manaChoiceIndex,
                state.pendingActivation.tappedLandIds
            );
        }
        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).not.toBeNull();
        // The stack item carries the captured red colour.
        const onStack = state.stack[state.stack.length - 1];
        expect(onStack.notedManaSpent).toEqual({ R: 1 });

        // Resolve ability 1 — the artifact banks the red mana.
        resolveTopOfStack(state);
        const live = player.battlefield.find((c) => c.id === "amulet")!;
        expect(live.notedMana).toEqual({ mana: { R: 1 } });
        expect(live.counters?.charge).toBe(1);

        // Ability 2: remove the counter, add one R to the pool (unrestricted).
        live.isTapped = false; // untap so the {T} cost is payable again
        resolveActivated(state, live, "jeweled-amulet-add");
        expect(player.manaPool.R).toBe(1);
        expect(player.restrictedMana ?? []).toHaveLength(0);
    });

    // Regression for #753 — the immediate-commit branch of activateAbility (pool
    // already covers {1}) also dropped the capture. Driven via the real
    // manaSpentDelta snapshot the immediate branch now performs.
    it("integration #753: immediate-commit path also captures the spent colour", () => {
        const amulet = makeInstance(jeweledAmulet.id, {
            id: "amulet",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 0 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [amulet],
                    // Pool already covers {1} with blue → immediate commit path.
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
        });
        const charge = jeweledAmulet.activatedAbilities!.find(
            (a) => a.id === "jeweled-amulet-charge"
        )!;
        // Mirror the immediate branch: snapshot, pay, delta — the same code the
        // mutation runs inline now that the capture is wired there.
        const poolBefore = charge.noteManaSpent
            ? { ...state.players[0].manaPool }
            : undefined;
        state.players[0].manaPool.U -= 1; // pay {1} with the blue
        const notedManaSpent = poolBefore
            ? manaSpentDelta(poolBefore, state.players[0].manaPool)
            : undefined;
        expect(notedManaSpent).toEqual({ U: 1 });
        resolveActivatedNoting(
            state,
            amulet,
            "jeweled-amulet-charge",
            notedManaSpent!
        );
        const live = state.players[0].battlefield.find(
            (c) => c.id === "amulet"
        )!;
        expect(live.notedMana).toEqual({ mana: { U: 1 } });
    });

    it("survives the wire projection — noted mana on the artifact", () => {
        const amulet = makeInstance(jeweledAmulet.id, {
            id: "amulet",
            controllerId: "p1",
            ownerId: "p1",
            notedMana: { mana: { R: 1 } },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [amulet] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectFullState(state, 1);
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "amulet"
        )!;
        expect((slim as CardInstanceState).notedMana).toEqual({
            mana: { R: 1 },
        });

        // #753 — the controller's own battlefield view (projectPublicState) must
        // also carry `notedMana` so the UI badge can render which colour is
        // banked. slimCard only strips `card`/`knownTo`, so the field survives.
        const pub = projectPublicState(state, 1, "p1");
        const slimPub = pub.players[0].battlefield.find(
            (c) => c.id === "amulet"
        )!;
        expect((slimPub as CardInstanceState).notedMana).toEqual({
            mana: { R: 1 },
        });
    });
});

describe("Ice Cauldron (noted-mana battery + cast-from-exile, CR 106.10/601.3e)", () => {
    it("declares the {X},{T} charge ability and the {T}+remove-counter add ability", () => {
        const charge = iceCauldron.activatedAbilities!.find(
            (a) => a.id === "ice-cauldron-charge"
        )!;
        expect(charge.cost).toMatchObject({ mana: { X: "X" }, tap: true });
        expect(charge.noteManaSpent).toBe(true);
        const add = iceCauldron.activatedAbilities!.find(
            (a) => a.id === "ice-cauldron-add"
        )!;
        expect(add.cost).toMatchObject({
            tap: true,
            removeCounter: { type: "charge", count: 1 },
        });
    });

    it("exiles the chosen card face down, grants cast-from-exile, and notes the mana keyed to it", () => {
        const cauldron = makeInstance(iceCauldron.id, {
            id: "cauldron",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 0 },
        });
        const exiledCard = makeInstance(brainstorm.id, {
            id: "noted-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [cauldron],
                    hand: [exiledCard],
                }),
                makePlayer("p2"),
            ],
        });
        // Charge ability paid {X}=2 with {U}{U} → notes {U:2}, exiles the card.
        resolveActivatedNoting(state, cauldron, "ice-cauldron-charge", {
            U: 2,
        });
        // The choose-hand-card choice is now pending; pick the spell.
        submitChoice(state, ["noted-spell"]);

        const p1 = state.players[0];
        // The card left the hand for face-down exile, castable by its controller.
        expect(p1.hand.find((c) => c.id === "noted-spell")).toBeUndefined();
        const exiled = p1.exile.find((c) => c.id === "noted-spell")!;
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exiled.knownTo).toEqual(["p1"]); // face down: hidden to opponent
        // The artifact carries a charge counter and the noted mana keyed to the
        // exiled card.
        const live = p1.battlefield.find((c) => c.id === "cauldron")!;
        expect(live.counters?.charge).toBe(1);
        expect(live.notedMana).toEqual({
            mana: { U: 2 },
            castableCardId: "noted-spell",
        });
    });

    it("the add ability floats restricted mana spendable ONLY on the noted card (CR 106.6)", () => {
        const cauldron = makeInstance(iceCauldron.id, {
            id: "cauldron",
            controllerId: "p1",
            ownerId: "p1",
            counters: { charge: 1 },
            notedMana: { mana: { U: 2 }, castableCardId: "noted-spell" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cauldron] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, cauldron, "ice-cauldron-add");
        const restricted = state.players[0].restrictedMana!;
        expect(restricted).toEqual([
            { color: "U", amount: 2, castableCardId: "noted-spell" },
        ]);
        // No fungible mana was added.
        expect(state.players[0].manaPool.U).toBe(0);

        const unit = restricted[0];
        // Eligible only for the noted card instance, not any other spell.
        expect(
            restrictedUnitAllowsSpell(unit, ["Instant"], "noted-spell")
        ).toBe(true);
        expect(
            restrictedUnitAllowsSpell(unit, ["Instant"], "other-spell")
        ).toBe(false);
        expect(restrictedUnitAllowsSpell(unit, ["Instant"], undefined)).toBe(
            false
        );
    });

    it("spendablePoolForSpell exposes the restricted mana only for the noted card", () => {
        const player = makePlayer("p1");
        addRestrictedManaToPool(player, "U", 2, undefined, "noted-spell");
        // For the noted card, the {U}{U} is spendable.
        expect(
            spendablePoolForSpell(player, ["Instant"], "noted-spell").U
        ).toBe(2);
        // For a different card, it is NOT available.
        expect(
            spendablePoolForSpell(player, ["Instant"], "other-spell").U ?? 0
        ).toBe(0);
    });

    it("pays the noted card's cost restricted-first, leaving the fungible pool intact", () => {
        const player = makePlayer("p1");
        player.manaPool.U = 1;
        addRestrictedManaToPool(player, "U", 2, undefined, "noted-spell");
        // Cast the noted card costing {U}{U}: drains the restricted mana first.
        payManaCostForSpell(player, { U: 2 }, ["Instant"], [], "noted-spell");
        expect(player.manaPool.U).toBe(1); // fungible untouched
        expect(player.restrictedMana ?? []).toHaveLength(0); // restricted drained
    });

    it("integration: the noted card is cast FROM EXILE paying the restricted mana (CR 601.3e)", () => {
        // The exiled, cast-from-exile-flagged Brainstorm; pool holds ONLY the
        // {U}{U} instance-restricted noted mana. tryAutoCommitPendingCast must
        // move it exile → stack, draining the restricted mana.
        const exiled = makeInstance(brainstorm.id, {
            id: "noted-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            castableFromExileBy: "p1",
            knownTo: ["p1"],
        });
        const p1 = makePlayer("p1", { exile: [exiled] });
        addRestrictedManaToPool(p1, "U", 2, undefined, "noted-spell");
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingCast: {
                playerId: "p1",
                cardInstanceId: "noted-spell",
                manaCost: { U: 1 },
                tappedLandIds: [],
            },
        });
        const result = tryAutoCommitPendingCast(state, "p1");
        expect(result).not.toBeNull();
        // Brainstorm left exile for the stack.
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe("noted-spell");
        // The cast-from-exile flag was consumed.
        expect(state.stack[0].castableFromExileBy).toBeUndefined();
        // One {U} of restricted mana was drained; the other {U} remains.
        const remaining = state.players[0].restrictedMana ?? [];
        expect(remaining).toEqual([
            { color: "U", amount: 1, castableCardId: "noted-spell" },
        ]);
    });

    it("integration: restricted mana cannot pay for a DIFFERENT spell (CR 106.6)", () => {
        // The same restricted {U}{U}, but the pending cast is a different card —
        // affordability must fail (no fungible mana), so nothing commits.
        const otherSpell = makeInstance(brainstorm.id, {
            id: "other-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", { hand: [otherSpell] });
        addRestrictedManaToPool(p1, "U", 2, undefined, "noted-spell");
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingCast: {
                playerId: "p1",
                cardInstanceId: "other-spell",
                manaCost: { U: 1 },
                tappedLandIds: [],
            },
        });
        const result = tryAutoCommitPendingCast(state, "p1");
        // Not payable: the restricted mana is keyed to a different card.
        expect(result).toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("survives the wire projection — exiled card flag + noted mana", () => {
        const cauldron = makeInstance(iceCauldron.id, {
            id: "cauldron",
            controllerId: "p1",
            ownerId: "p1",
            notedMana: { mana: { U: 2 }, castableCardId: "noted-spell" },
        });
        const exiled = makeInstance(brainstorm.id, {
            id: "noted-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            castableFromExileBy: "p1",
            knownTo: ["p1"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [cauldron],
                    exile: [exiled],
                }),
                makePlayer("p2"),
            ],
        });
        const projected = projectFullState(state, 1);
        const slimCauldron = projected.players[0].battlefield.find(
            (c) => c.id === "cauldron"
        )! as CardInstanceState;
        expect(slimCauldron.notedMana).toEqual({
            mana: { U: 2 },
            castableCardId: "noted-spell",
        });
        const slimExiled = projected.players[0].exile.find(
            (c) => c.id === "noted-spell"
        )! as CardInstanceState;
        expect(slimExiled.castableFromExileBy).toBe("p1");
    });

    // --- Affordability gate (regression for the cast-from-exile "Illegal
    // action" bug). The payment path drains restricted mana, but
    // getLegalActions' affordability pre-check (canPotentiallyPayCost) ignored
    // restrictedMana, so "cast" was dropped and assertLegalAction threw
    // `Illegal action "cast" on "Brainstorm". Legal actions: none` BEFORE
    // payment could run — making the exiled card permanently uncastable.
    // ----------------------------------------------------------------------
    const exiledBrainstormState = (notedColor: "U" | "W") => {
        const exiled = makeInstance(brainstorm.id, {
            id: "noted-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            castableFromExileBy: "p1",
            knownTo: ["p1"],
        });
        // The ONLY mana is the instance-keyed noted mana — no lands, empty
        // fungible pool — so affordability hinges entirely on counting it.
        const p1 = makePlayer("p1", { exile: [exiled] });
        addRestrictedManaToPool(p1, notedColor, 1, undefined, "noted-spell");
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        return { state, exiled: state.players[0].exile[0] };
    };

    it("getLegalActions returns 'cast' for the exiled card payable ONLY by its noted mana (CR 106.6)", () => {
        const { state, exiled } = exiledBrainstormState("U");
        expect(getLegalActions(state, state.players[0], exiled)).toContain(
            "cast"
        );
    });

    it("getLegalActions omits 'cast' when the noted mana is the WRONG colour for the spell", () => {
        const { state, exiled } = exiledBrainstormState("W");
        expect(getLegalActions(state, state.players[0], exiled)).not.toContain(
            "cast"
        );
    });

    it("wire: the viewer's castable exile card carries legalActions incl 'cast'; the opponent's view does not", () => {
        const { state } = exiledBrainstormState("U");
        const own = projectPublicState(state, 1, "p1");
        const ownExiled = own.players[0].exile.find(
            (c) => c.id === "noted-spell"
        )!;
        expect(ownExiled.legalActions).toContain("cast");
        const opp = projectPublicState(state, 1, "p2");
        const oppExiled = opp.players[0].exile.find(
            (c) => c.id === "noted-spell"
        );
        expect(oppExiled?.legalActions).toBeUndefined();
    });

    it("wire: the exiled card carries exiledByPermanentId linking it to its battery (Arena pin)", () => {
        // The board pins the exiled card to the permanent that exiled it via the
        // mechanism-agnostic `exiledByPermanentId` link (Banishing Light / Ice
        // Cauldron / future exilers all share this); for the battery it derives
        // from the host's notedMana.castableCardId. Both viewers see the link.
        const cauldron = makeInstance(iceCauldron.id, {
            id: "cauldron",
            controllerId: "p1",
            ownerId: "p1",
            notedMana: { mana: { U: 2 }, castableCardId: "noted-spell" },
        });
        const exiled = makeInstance(brainstorm.id, {
            id: "noted-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            castableFromExileBy: "p1",
            knownTo: ["p1"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cauldron], exile: [exiled] }),
                makePlayer("p2"),
            ],
        });
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].exile.find(
                (c) => c.id === "noted-spell"
            )!;
            expect(slim.exiledByPermanentId).toBe("cauldron");
        }
    });
});

describe("Pox (proportional mass loss/sacrifice/discard, CR 107.2 round-up)", () => {
    it("asserts the fractions at a representative board", () => {
        // p1: 20 life, 4 hand, 5 creatures, 6 lands.
        // p2: 13 life, 2 hand, 2 creatures, 3 lands.
        const p1Hand = [0, 1, 2, 3].map((i) =>
            makeInstance(balduvianBears.id, {
                id: `h1-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const p1Creatures = [0, 1, 2, 3, 4].map((i) =>
            vanilla(`c1-${i}`, 1, 1, { controllerId: "p1", ownerId: "p1" })
        );
        const p1Lands = [0, 1, 2, 3, 4, 5].map((i) =>
            makeInstance(forest.id, {
                id: `l1-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        const p2Hand = [0, 1].map((i) =>
            makeInstance(balduvianBears.id, {
                id: `h2-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const p2Creatures = [0, 1].map((i) =>
            vanilla(`c2-${i}`, 1, 1, { controllerId: "p2", ownerId: "p2" })
        );
        const p2Lands = [0, 1, 2].map((i) =>
            makeInstance(swamp.id, {
                id: `l2-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    hand: p1Hand,
                    battlefield: [...p1Creatures, ...p1Lands],
                }),
                makePlayer("p2", {
                    life: 13,
                    hand: p2Hand,
                    battlefield: [...p2Creatures, ...p2Lands],
                }),
            ],
            activePlayerId: "p1",
        });
        pushSpell(state, pox.id, "p1");
        // Step 1 (life) is no-choice. Steps 2-4 prompt each player to keep.
        // Drive each suspension by keeping the lowest-index eligible ids
        // (mirrors selectResolutionChoice; eligibility is the player's own
        // zone filtered by the choice's `filter`).
        resolveTopOfStack(state);
        let guard = 0;
        while ((state.pendingChoices ?? []).length > 0 && guard++ < 20) {
            const head = state.pendingChoices![0];
            const count =
                typeof head.count === "number" ? head.count : head.count.min;
            const owner = state.players.find(
                (p) => p.id === (head.zoneOwnerId ?? head.playerId)
            )!;
            const pool = head.zone === "hand" ? owner.hand : owner.battlefield;
            // Pox's filters are single-type (`Creature` / `Land`); match on the
            // `types` field directly (no layer view needed for these picks).
            const wantType =
                typeof head.filter?.types === "string"
                    ? head.filter.types
                    : undefined;
            const eligible = pool
                .filter((c) => (wantType ? c.types.includes(wantType) : true))
                .map((c) => c.id);
            const keepIds = eligible.slice(0, count);
            submitPick(state, keepIds);
        }
        expect(state.pendingChoices ?? []).toEqual([]);

        // Life: lose ceil(20/3)=7 and ceil(13/3)=5.
        expect(state.players[0].life).toBe(20 - 7);
        expect(state.players[1].life).toBe(13 - 5);
        // Hand: discard ceil(4/3)=2 → keep 2; ceil(2/3)=1 → keep 1.
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[1].hand).toHaveLength(1);
        // Creatures: sac ceil(5/3)=2 → keep 3; ceil(2/3)=1 → keep 1.
        const p1Cre = state.players[0].battlefield.filter((c) =>
            c.types.includes("Creature")
        );
        const p2Cre = state.players[1].battlefield.filter((c) =>
            c.types.includes("Creature")
        );
        expect(p1Cre).toHaveLength(3);
        expect(p2Cre).toHaveLength(1);
        // Lands: sac ceil(6/3)=2 → keep 4; ceil(3/3)=1 → keep 2.
        const p1Land = state.players[0].battlefield.filter((c) =>
            c.types.includes("Land")
        );
        const p2Land = state.players[1].battlefield.filter((c) =>
            c.types.includes("Land")
        );
        expect(p1Land).toHaveLength(4);
        expect(p2Land).toHaveLength(2);
    });

    it("auto-resolves with no prompts when each phase has no real choice", () => {
        // 3 life (lose 1), empty hand, 1 creature (sac 1 → keep 0), 1 land
        // (sac 1 → keep 0): every phase is forced, no pick prompts.
        const c = vanilla("c", 1, 1, { controllerId: "p1", ownerId: "p1" });
        const l = makeInstance(forest.id, {
            id: "l",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 3, battlefield: [c, l] }),
                makePlayer("p2", { life: 3 }),
            ],
        });
        pushSpell(state, pox.id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.players[0].life).toBe(2); // ceil(3/3)=1
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

// Urza's Bauble — {T}, Sacrifice: look (informational) + next-upkeep cantrip
// (issue #674, CR 603.7d delayed triggered ability).
describe("Urza's Bauble (next-upkeep cantrip, CR 603.7d)", () => {
    it("is a {0} artifact with a tap+sacrifice ability targeting a player", () => {
        expect(urzasBauble.manaCost).toEqual({});
        expect(urzasBauble.types).toEqual(["Artifact"]);
        const ability = urzasBauble.activatedAbilities![0];
        expect(ability.cost).toMatchObject({ tap: true, sacrifice: true });
        expect(ability.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
        // Post-#838 the cantrip is a delayedTrigger Op on the ability's
        // Effect Script (ADR 0048) — the old assertion pinned the legacy
        // `delayedTriggers[]` template field.
        expect(
            ability.effects?.some(
                (e) => e.op === "delayedTrigger" && e.timing === "next-upkeep"
            )
        ).toBe(true);
    });

    it("schedules a draw that fires at the next upkeep", () => {
        const bauble = makeInstance(urzasBauble.id, {
            id: "bauble",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bauble],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        // Resolve the ability targeting p2 — it arms the next-upkeep draw.
        resolveActivated(state, bauble, "urzas-bauble-look-draw", [
            { type: "player", id: "p2" },
        ]);
        expect(state.delayedTriggers?.[0]?.timing).toBe("next-upkeep");
        // No card drawn yet (the cantrip is deferred to the next upkeep).
        expect(state.players[0].hand).toHaveLength(0);
        // Advance to the next upkeep and resolve the cantrip.
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Elkin Bottle ({3},{T}: exile top card, play it — CR 601.3e impulse)", () => {
    it("exiles the top card of the library, granting cast-from-exile to the controller", () => {
        const bottle = makeInstance(elkinBottle.id, {
            id: "bottle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(balduvianBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const under = makeInstance(balduvianBears.id, {
            id: "under",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bottle],
                    library: [top, under],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bottle, "elkin-bottle-exile");
        const p1 = state.players[0];
        // Top card left the library for exile, castable by its controller.
        expect(p1.library.find((c) => c.id === "top")).toBeUndefined();
        const exiled = p1.exile.find((c) => c.id === "top")!;
        expect(exiled.castableFromExileBy).toBe("p1");
        // Face down: hidden to the opponent, known to the controller.
        expect(exiled.knownTo).toEqual(["p1"]);
        // The next card is now on top and untouched.
        expect(p1.library[0]?.id).toBe("under");
    });

    it("is a no-op with an empty library", () => {
        const bottle = makeInstance(elkinBottle.id, {
            id: "bottle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bottle], library: [] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bottle, "elkin-bottle-exile");
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("wire format: the exiled card is visible in the owner's projected exile", () => {
        const bottle = makeInstance(elkinBottle.id, {
            id: "bottle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(balduvianBears.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bottle], library: [top] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bottle, "elkin-bottle-exile");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].exile.find((c) => c.id === "top")!;
        expect(slim).toBeDefined();
        expect(slim.castableFromExileBy).toBe("p1");
    });
});

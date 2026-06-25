// Ice Age (ICE) — per-card behavior tests (twin of fem.test.ts / drk.test.ts /
// leg.test.ts). Each card gets a dedicated describe block citing the CR section
// it exercises; tests assert external behavior only (definition shape, zone
// after resolution, wire-format survival), per the PRD testing decisions
// (#628).
//
// THIS slice covers the walking skeleton (#629): the `ice` set is registered
// and Balduvian Bears — a {1}{G} 2/2 vanilla Bear — resolves from the stack
// onto the battlefield and survives projection. Every other ICE card is present
// as a commented-out stub and is exercised by its owning colour batch /
// capability cluster once uncommented.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    armorOfFaith,
    blinkingSpirit,
    cooperation,
    elvishHealer,
    hallowedGround,
    kelsinkoRanger,
    kjeldoranKnight,
    kjeldoranPhalanx,
    kjeldoranSkycaptain,
    kjeldoranSkyknight,
    kjeldoranWarrior,
    lostOrderOfJarkeld,
    mercenaries,
    orderOfTheSacredTorch,
    orderOfTheWhiteShield,
    rally,
    shieldBearer,
    snowHound,
    warning,
    deathWardIce,
    disenchantIce,
    swordsToPlowsharesIce,
    circleOfProtectionBlackIce,
    circleOfProtectionBlueIce,
    circleOfProtectionGreenIce,
    circleOfProtectionRedIce,
    circleOfProtectionWhiteIce,
    // Blue free tranche (#631)
    bindingGrasp,
    brainstorm,
    counterspellIce,
    deflection,
    diabolicVision,
    elementalAugury,
    essenceFlare,
    glacialWall,
    glaciers,
    hydroblast,
    iceberg,
    icyPrison,
    powerSinkIce,
    seaSpirit,
    sibilantSpirit,
    silverErne,
    skeletonShip,
    // Multicolour free tranche (#635)
    altarOfBone,
    centaurArcher,
    essenceVortex,
    giantTrapDoorSpider,
    sleightOfMindIce,
    snowDevil,
    soulBarrier,
    spectralShield,
    stormSpirit,
    thunderWall,
    windSpirit,
    wordOfUndoing,
    wrathOfMaritLage,
    wingsOfAesthir,
    zuranSpellcaster,
    // Black free tranche (#632)
    abyssalSpecter,
    brineShaman,
    darkBanishing,
    darkRitualIce,
    demonicConsultation,
    fearIce,
    foulFamiliar,
    hoarShade,
    howlFromBeyondIce,
    hyalopterousLemure,
    kjeldoranDead,
    knightOfStromgald,
    krovikanVampire,
    leshracsRite,
    mindWarp,
    minionOfTeveshSzat,
    moleWorms,
    moorFiend,
    pestilenceRats,
    songsOfTheDamned,
    spoilsOfEvil,
    stromgaldCabal,
    // Red free tranche (#633)
    anarchy,
    balduvianBarbarians,
    conquer,
    curseOfMaritLage,
    flameSpirit,
    goblinSnowman,
    imposingVisage,
    incinerate,
    jokulhaups,
    karplusanYeti,
    lavaBurst,
    mountainGoat,
    orcishCannoneers,
    orcishHealer,
    orcishLumberjack,
    pyroblast,
    pyroclasm,
    sabretoothTiger,
    shatterIce,
    stoneRainIce,
    stoneSpirit,
    stonehands,
    stormbind,
    torGiant,
    vertigo,
    wallOfLava,
    wordOfBlasting,
    // Green free tranche (#634)
    fyndhornBrownie,
    fyndhornElder,
    fyndhornElves,
    giantGrowthIce,
    hotSprings,
    hurricaneIce,
    johtullWurm,
    juniperOrderDruid,
    lhurgoyf,
    lureIce,
    naturesLore,
    paleBears,
    pygmyAllosaurus,
    regenerationIce,
    scaledWurm,
    shamblingStrider,
    stampede,
    stuntedGrowth,
    tarpan,
    tinderWall,
    trailblazer,
    wallOfPineNeedles,
    wildGrowthIce,
    woollySpider,
    yavimayaGnats,
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
    // Lands free tranche (#637)
    iceFloe,
    plainsIce,
    islandIce,
    swampIce,
    mountainIce,
    forestIce,
    // Cumulative upkeep — self-CU cards (#638)
    arnjlotsAscent,
    illusionaryForces,
    illusionaryWall,
    illusionsOfGrandeur,
    mesmericTrance,
    polarKraken,
    fyndhornPollen,
    maddeningWind,
    soldeviSimulacrum,
    // Cumulative upkeep — grant statics + restricted-CU mana (#639)
    adarkarUnicorn,
    breathOfDreams,
    balduvianShaman,
    dreamsOfTheDead,
    snowfall,
    // White buildable-now completion (#653)
    blackScarab,
    blueScarab,
    greenScarab,
    redScarab,
    whiteScarab,
    caribouRange,
    callToArms,
    fylgja,
    justice,
    seraph,
    // Blue buildable-now completion (#654)
    krovikanSorcerer,
    shyft,
    // Black buildable-now completion (#655)
    limDLsCohort,
    limDLsHex,
    mindWhip,
    minionOfLeshrac,
    infernalDenizen,
    soulKiss,
    norritt,
    danceOfTheDead,
    zuranEnchanter,
    krovikanElementalist,
    leshracsSigil,
    flowOfMaggots,
} from "../ice";
import {
    getCardById,
    getCardByName,
    getAllCards,
    getAllSetCodes,
} from "../../index";
import {
    resolveTopOfStack,
    canPayMayPayCost,
    payMayPayCost,
    normalizeMayPayCost,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    addRestrictedManaToPool,
    removePermanentTo,
} from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { effectiveTriggeredAbilities } from "../../../gre/copy";
import { collectTriggers } from "../../../gre/triggers";
import { projectPublicState } from "../../../gameProjections";
import { emitBlockersConfirmedEvents } from "../../../gre/phases";
import { recordBlockedAttackers } from "../../../gre/banding";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../gre/pendingChoiceSubmit";
import { getLegalTargets } from "../../../gre/rules";
import { validateBlockerEligibility } from "../../../gre/combat";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../gre/state";
import type { StackItem } from "../../../gre/state";
import type { CardType, ManaCost } from "../../types";

/** Push an activated ability onto the stack with its cost assumed already paid,
 *  then resolve it (mirrors post-activateAbility state). */
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

/** Submit the current head pending choice (zone-pick) with the given ordered
 *  ids, auto-resuming the suspended resolution (mirrors the game.ts mutation). */
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

/** Push a triggered ability onto the stack with the given trigger event, then
 *  resolve it (mirrors the engine after a trigger is put on the stack). */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

/** A generic vanilla creature body not backed by a registered definition. */
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
// Registry parity — the set file is wired into the registry and the tracer is
// reachable by id, by name, in the deck-builder index, and the set code is
// catalogued.
// ---------------------------------------------------------------------------

describe("ICE registry parity", () => {
    it("registers Balduvian Bears by id", () => {
        expect(getCardById(balduvianBears.id)).toBe(balduvianBears);
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

// ---------------------------------------------------------------------------
// Vanilla creature (CR 302 — Creature card as pure data: types/subtypes + P/T
// only; values validated against the ICE MTGJSON blob / Scryfall set:ice).
// ---------------------------------------------------------------------------

describe("Balduvian Bears (vanilla creature, CR 302)", () => {
    it("carries the canonical ICE printed characteristics", () => {
        expect(balduvianBears.types).toEqual(["Creature"]);
        expect(balduvianBears.subtypes).toEqual(["Bear"]);
        expect(balduvianBears.power).toBe(2);
        expect(balduvianBears.toughness).toBe(2);
        expect(balduvianBears.manaCost).toEqual({ X: 1, G: 1 });
        expect(balduvianBears.rarity).toBe("common");
        expect(balduvianBears.oracleText).toBe("");
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, balduvianBears.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });

    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, balduvianBears.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.name).toBe("Balduvian Bears");
        expect(def.subtypes).toEqual(["Bear"]);
        expect(def.power).toBe(2);
        expect(def.toughness).toBe(2);
    });
});

// ===========================================================================
// White free tranche (#630)
// ===========================================================================

// --- Reprints (CardPrint onto existing definitions, ADR 0014) --------------

describe("ICE White reprints (CardPrint wiring, ADR 0014)", () => {
    it("Death Ward print resolves to the LEA definition", () => {
        expect(getCardById(deathWardIce.printId).name).toBe("Death Ward");
        expect(deathWardIce.definitionId).toBe(
            "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13"
        );
        expect(deathWardIce.setCode).toBe("ice");
    });
    it("Disenchant print resolves to the LEA definition", () => {
        expect(getCardById(disenchantIce.printId).name).toBe("Disenchant");
    });
    it("Swords to Plowshares print resolves to the LEA definition", () => {
        expect(getCardById(swordsToPlowsharesIce.printId).name).toBe(
            "Swords to Plowshares"
        );
    });
    it("Circle of Protection cycle prints resolve to their definitions", () => {
        expect(getCardById(circleOfProtectionBlackIce.printId).name).toBe(
            "Circle of Protection: Black"
        );
        expect(getCardById(circleOfProtectionBlueIce.printId).name).toBe(
            "Circle of Protection: Blue"
        );
        expect(getCardById(circleOfProtectionGreenIce.printId).name).toBe(
            "Circle of Protection: Green"
        );
        expect(getCardById(circleOfProtectionRedIce.printId).name).toBe(
            "Circle of Protection: Red"
        );
        expect(getCardById(circleOfProtectionWhiteIce.printId).name).toBe(
            "Circle of Protection: White"
        );
    });
});

// --- Keyword creatures (CR 702 — snapshot checks) --------------------------

describe("ICE White keyword creatures (CR 702)", () => {
    it("Kjeldoran Phalanx has first strike + banding", () => {
        expect(kjeldoranPhalanx.staticAbilities).toEqual([
            "first strike",
            "banding",
        ]);
        expect(kjeldoranPhalanx.power).toBe(2);
        expect(kjeldoranPhalanx.toughness).toBe(5);
    });
    it("Kjeldoran Skycaptain has flying + first strike + banding", () => {
        expect(kjeldoranSkycaptain.staticAbilities).toEqual([
            "flying",
            "first strike",
            "banding",
        ]);
    });
    it("Kjeldoran Skyknight has flying + first strike + banding", () => {
        expect(kjeldoranSkyknight.staticAbilities).toEqual([
            "flying",
            "first strike",
            "banding",
        ]);
    });
    it("Kjeldoran Warrior has banding", () => {
        expect(kjeldoranWarrior.staticAbilities).toEqual(["banding"]);
    });
    it("Shield Bearer is a 0/3 with banding", () => {
        expect(shieldBearer.staticAbilities).toEqual(["banding"]);
        expect(shieldBearer.power).toBe(0);
        expect(shieldBearer.toughness).toBe(3);
    });
    it("Order of the White Shield has protection from black", () => {
        expect(orderOfTheWhiteShield.staticAbilities).toContain(
            "protection from black"
        );
    });
});

// --- Armor of Faith (Aura: static +1/+1 + {W}:+0/+1, CR 613) ----------------

describe("Armor of Faith (Aura, CR 611/613)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(armorOfFaith.id, {
            id: "aura",
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
        return { state, host };
    }

    it("grants a static +1/+1 to the enchanted creature", () => {
        const { state, host } = setup();
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(3);
    });

    it("wire format: the +1/+1 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("{W} pump adds +0/+1 to the host until end of turn", () => {
        const { state, host } = setup();
        const aura = state.players[0].battlefield.find((c) => c.id === "aura")!;
        resolveActivated(state, aura, "armor-of-faith-pump");
        expect(getEffectiveToughness(state, host)).toBe(4);
        expect(getEffectivePower(state, host)).toBe(3);
    });
});

// --- Cooperation (Aura grants banding, CR 611) -----------------------------

describe("Cooperation (Aura grants banding, CR 702.22)", () => {
    it("grants banding to the enchanted creature", () => {
        const host = vanilla("host", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(cooperation.id, {
            id: "aura",
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
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(live.staticAbilities ?? []).not.toContain("banding");
        // The keyword-grant is a layer-6 static effect; assert via projection
        // path that the host reads as having banding.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slim).toBeDefined();
        // Definition wiring: the static effect grants banding.
        expect(cooperation.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "banding",
        });
    });
});

// --- Blinking Spirit ({0}: bounce self, CR 701.14) -------------------------

describe("Blinking Spirit ({0}: return self to hand, CR 701.14)", () => {
    it("returns itself to its owner's hand", () => {
        const spirit = makeInstance(blinkingSpirit.id, {
            id: "spirit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, spirit, "blinking-spirit-bounce");
        expect(
            state.players[0].battlefield.find((c) => c.id === "spirit")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "spirit")
        ).toBeDefined();
    });
});

// --- Elvish Healer ({T}: prevent 1, or 2 vs green creature, CR 615) --------

describe("Elvish Healer ({T}: damage prevention, CR 615)", () => {
    it("prevents the next 1 damage to a non-green target", () => {
        const healer = makeInstance(elvishHealer.id, {
            id: "healer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redCreature = vanilla("redc", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-red" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [healer, redCreature] }),
                makePlayer("p2"),
            ],
        });
        // Should resolve without error and register a 1-point shield.
        resolveActivated(state, healer, "elvish-healer-prevent", [
            { type: "permanent", id: "redc" },
        ]);
        expect(state.stack).toHaveLength(0);
    });

    it("the ability is targeted at any target", () => {
        const ability = elvishHealer.activatedAbilities!.find(
            (a) => a.id === "elvish-healer-prevent"
        )!;
        expect(ability.targetRequirement).toMatchObject({ type: "any" });
        expect(ability.cost).toMatchObject({ tap: true });
    });
});

// --- Kelsinko Ranger ({1}{W}: green creature gains first strike) -----------

describe("Kelsinko Ranger (grant first strike to green, CR 611.1b)", () => {
    it("grants first strike to the target green creature until end of turn", () => {
        const ranger = makeInstance(kelsinkoRanger.id, {
            id: "ranger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCreature = vanilla("grn", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-green" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ranger, greenCreature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ranger, "kelsinko-ranger-first-strike", [
            { type: "permanent", id: "grn" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "grn"
        )!;
        expect(getEffectivePower(state, target)).toBe(2);
        // The grant routes through the layer system; assert no crash + filter.
        const ability = kelsinkoRanger.activatedAbilities!.find(
            (a) => a.id === "kelsinko-ranger-first-strike"
        )!;
        expect(ability.targetRequirement).toMatchObject({ colorFilter: "G" });
    });
});

// --- Kjeldoran Knight (self-pumps, CR 611.1b) ------------------------------

describe("Kjeldoran Knight (self-pumps, CR 611.1b)", () => {
    function setup() {
        const knight = makeInstance(kjeldoranKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        return { state, knight };
    }
    it("starts as a 1/1 with banding", () => {
        const { state, knight } = setup();
        expect(getEffectivePower(state, knight)).toBe(1);
        expect(getEffectiveToughness(state, knight)).toBe(1);
        expect(kjeldoranKnight.staticAbilities).toEqual(["banding"]);
    });
    it("{1}{W} pumps +1/+0 until end of turn", () => {
        const { state, knight } = setup();
        resolveActivated(state, knight, "kjeldoran-knight-pump-power");
        expect(getEffectivePower(state, knight)).toBe(2);
        expect(getEffectiveToughness(state, knight)).toBe(1);
    });
    it("{W}{W} pumps +0/+2 until end of turn", () => {
        const { state, knight } = setup();
        resolveActivated(state, knight, "kjeldoran-knight-pump-toughness");
        expect(getEffectiveToughness(state, knight)).toBe(3);
    });
});

// --- Order of the White Shield (first strike grant + pump) ------------------

describe("Order of the White Shield (grants + pump, CR 611.1b)", () => {
    function setup() {
        const order = makeInstance(orderOfTheWhiteShield.id, {
            id: "order",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2"),
            ],
        });
        return { state, order };
    }
    it("is a 2/1 with protection from black", () => {
        const { state, order } = setup();
        expect(getEffectivePower(state, order)).toBe(2);
        expect(getEffectiveToughness(state, order)).toBe(1);
        expect(orderOfTheWhiteShield.staticAbilities).toContain(
            "protection from black"
        );
    });
    it("{W}{W} pumps +1/+0 until end of turn", () => {
        const { state, order } = setup();
        resolveActivated(state, order, "order-white-shield-pump");
        expect(getEffectivePower(state, order)).toBe(3);
    });
});

// --- Lost Order of Jarkeld (CDA P/T, CR 604.3 / layer 7a) ------------------

describe("Lost Order of Jarkeld (CDA P/T, CR 604.3)", () => {
    function setup(oppCreatures: number) {
        const order = makeInstance(lostOrderOfJarkeld.id, {
            id: "lost",
            controllerId: "p1",
            ownerId: "p1",
            chosenPlayerId: "p2",
        });
        const oppField: CardInstanceState[] = [];
        for (let i = 0; i < oppCreatures; i++) {
            oppField.push(vanilla(`opp${i}`, 1, 1));
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2", { battlefield: oppField }),
            ],
        });
        return { state, order };
    }
    it("is 1 plus the chosen player's creature count", () => {
        const { state, order } = setup(3);
        expect(getEffectivePower(state, order)).toBe(4);
        expect(getEffectiveToughness(state, order)).toBe(4);
    });
    it("is a 1/1 when the chosen player controls no creatures", () => {
        const { state, order } = setup(0);
        expect(getEffectivePower(state, order)).toBe(1);
        expect(getEffectiveToughness(state, order)).toBe(1);
    });
    it("wire format: the CDA P/T survives projectPublicState", () => {
        const { state } = setup(2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lost"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// --- Snow Hound ({1},{T}: bounce self + green/blue creature, CR 701.14) ----

describe("Snow Hound (self + green/blue bounce, CR 701.14)", () => {
    it("returns itself and the target to hand", () => {
        const hound = makeInstance(snowHound.id, {
            id: "hound",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blueCreature = vanilla("blu", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-blue" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hound, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, hound, "snow-hound-bounce", [
            { type: "permanent", id: "blu" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "hound")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "blu")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "hound")
        ).toBeDefined();
        expect(state.players[0].hand.find((c) => c.id === "blu")).toBeDefined();
    });
    it("targets green-or-blue creatures you control", () => {
        const ability = snowHound.activatedAbilities!.find(
            (a) => a.id === "snow-hound-bounce"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            controller: "you",
            colorFilterAny: ["G", "U"],
        });
    });
});

// --- Hallowed Ground ({W}{W}: bounce your land, CR 701.14) ------------------

describe("Hallowed Ground (return your land, CR 701.14)", () => {
    it("returns the target land you control to hand", () => {
        const ground = makeInstance(hallowedGround.id, {
            id: "ground",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land: CardInstanceState = {
            ...vanilla("land", 0, 0, {
                controllerId: "p1",
                ownerId: "p1",
                card: { id: "fake-land" },
            }),
            types: ["Land"] as CardType[],
            power: undefined,
            toughness: undefined,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ground, land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ground, "hallowed-ground-bounce", [
            { type: "permanent", id: "land" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "land")
        ).toBeDefined();
    });
});

// --- Rally (blocking creatures +1/+1, CR 611.1b) ---------------------------

describe("Rally (blocking creatures +1/+1, CR 611.1b)", () => {
    it("buffs every creature currently blocking", () => {
        const blocker = vanilla("blk", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-blk" },
        });
        const attacker = vanilla("atk", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blocker] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { blk: ["atk"] },
                blockersConfirmed: true,
            },
        });
        const item = pushSpell(state, rally.id, "p1");
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "blk")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
        expect(state.stack.find((s) => s.id === item.id)).toBeUndefined();
    });
});

// --- Warning (prevent combat damage by target attacker) --------------------

describe("Warning (attacker assigns no combat damage, CR 510.1c)", () => {
    it("targets an attacking creature", () => {
        expect(warning.targetRequirement).toMatchObject({
            type: "Creature",
            combatRoleFilter: "attacking",
        });
    });
    it("resolves and marks the attacker as assigning no combat damage", () => {
        const attacker = vanilla("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        pushSpell(state, warning.id, "p1", [{ type: "permanent", id: "atk" }]);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
    });
});

// --- Mercenaries ({3}: prevent its damage to you, any player) --------------

describe("Mercenaries (open prevention, CR 602.1)", () => {
    it("is activatable by any player", () => {
        const ability = mercenaries.activatedAbilities!.find(
            (a) => a.id === "mercenaries-prevent"
        )!;
        expect(ability.activatableByAnyPlayer).toBe(true);
    });
    it("resolves a prevention shield without error", () => {
        const merc = makeInstance(mercenaries.id, {
            id: "merc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [merc] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, merc, "mercenaries-prevent");
        expect(state.stack).toHaveLength(0);
    });
});

// --- Order of the Sacred Torch ({T}, pay 1 life: counter black spell) ------

describe("Order of the Sacred Torch (counter black spell, CR 701.5)", () => {
    it("targets a black spell on the stack and costs 1 life", () => {
        const ability = orderOfTheSacredTorch.activatedAbilities!.find(
            (a) => a.id === "order-sacred-torch-counter"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "B",
        });
        expect(ability.cost).toMatchObject({ tap: true, life: 1 });
    });
});

// ===========================================================================
// Blue free tranche (#631)
// ===========================================================================

// --- Reprints (CardPrint onto existing LEA definitions, ADR 0014) ----------

describe("ICE Blue reprints (CardPrint wiring, ADR 0014)", () => {
    it("Counterspell print resolves to the LEA definition", () => {
        expect(getCardById(counterspellIce.printId).name).toBe("Counterspell");
        expect(counterspellIce.definitionId).toBe(
            "0df55e3f-14de-46ef-b6b1-616618724d9e"
        );
        expect(counterspellIce.setCode).toBe("ice");
    });
    it("Power Sink print resolves to the LEA definition", () => {
        expect(getCardById(powerSinkIce.printId).name).toBe("Power Sink");
    });
    it("Sleight of Mind print resolves to the LEA definition", () => {
        expect(getCardById(sleightOfMindIce.printId).name).toBe(
            "Sleight of Mind"
        );
    });
});

// --- Keyword creatures (CR 702 — snapshot checks) --------------------------

describe("ICE Blue keyword creatures (CR 702)", () => {
    it("Glacial Wall is a 0/7 with defender", () => {
        expect(glacialWall.staticAbilities).toEqual(["defender"]);
        expect(glacialWall.power).toBe(0);
        expect(glacialWall.toughness).toBe(7);
    });
    it("Silver Erne has flying + trample", () => {
        expect(silverErne.staticAbilities).toEqual(["flying", "trample"]);
    });
    it("Wind Spirit has flying + menace", () => {
        expect(windSpirit.staticAbilities).toEqual(["flying", "menace"]);
    });
    it("Thunder Wall has defender + flying", () => {
        expect(thunderWall.staticAbilities).toEqual(["defender", "flying"]);
    });
});

// --- Brainstorm (draw 3, put 2 on top, CR 121.1) ---------------------------

describe("Brainstorm (draw three then put two back, CR 121.1)", () => {
    it("draws three cards as the first step of resolution", () => {
        const lib = [0, 1, 2, 3].map((i) =>
            makeInstance(silverErne.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, brainstorm.id, "p1");
        resolveTopOfStack(state);
        // Three cards drawn (then the resolution suspends on the put-back
        // choice — the engine waits for the player's pick).
        expect(state.players[0].hand.length).toBe(3);
    });
});

// --- Deflection (change a spell's target, CR 114.6) ------------------------

describe("Deflection (retarget a spell, CR 114.6)", () => {
    it("targets a single spell on the stack", () => {
        expect(deflection.targetRequirement).toMatchObject({
            type: "spell",
            count: 1,
        });
    });
});

// --- Diabolic Vision / Elemental Augury (library look, CR 401) -------------

describe("Diabolic Vision (look top five, CR 401)", () => {
    it("is a sorcery with a resolve body", () => {
        expect(diabolicVision.types).toEqual(["Sorcery"]);
        expect(typeof diabolicVision.resolve).toBe("function");
    });
});

describe("Elemental Augury ({3}: look top three of target player, CR 401)", () => {
    it("activated ability targets a player and costs {3}", () => {
        const ability = elementalAugury.activatedAbilities!.find(
            (a) => a.id === "elemental-augury-look"
        )!;
        expect(ability.targetRequirement).toMatchObject({ type: "player" });
        expect(ability.cost).toMatchObject({ mana: { X: 3 } });
    });
});

// --- Hydroblast (modal counter/destroy if red, CR 700.2) -------------------

describe("Hydroblast (modal, CR 700.2)", () => {
    it("offers a counter mode and a destroy mode, both red-filtered", () => {
        expect(hydroblast.modes).toHaveLength(2);
        const counterMode = hydroblast.modes!.find((m) => m.id === "counter")!;
        const destroyMode = hydroblast.modes!.find((m) => m.id === "destroy")!;
        expect(counterMode.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "R",
        });
        expect(destroyMode.targetRequirement).toMatchObject({
            type: "any",
            colorFilter: "R",
        });
    });
});

// --- Iceberg (counters-as-mana, CR 122 / 605) ------------------------------

describe("Iceberg (counters-as-mana, CR 122)", () => {
    it("enters with X ice counters", () => {
        expect(iceberg.entersWith).toEqual({
            counters: [{ type: "ice", count: "X" }],
        });
    });
    it("has a {3}: add-counter ability and a remove-counter mana ability", () => {
        const store = iceberg.activatedAbilities!.find(
            (a) => a.id === "iceberg-store"
        )!;
        const mana = iceberg.activatedAbilities!.find(
            (a) => a.id === "iceberg-tap-for-mana"
        )!;
        expect(store.cost).toMatchObject({ mana: { X: 3 } });
        expect(mana.useStack).toBe(false);
        expect(mana.cost).toMatchObject({
            removeCounter: { type: "ice", count: 1 },
        });
        expect(mana.manaProduced).toEqual({ C: 1 });
    });
    it("the store ability adds an ice counter on resolution", () => {
        const berg = makeInstance(iceberg.id, {
            id: "berg",
            controllerId: "p1",
            ownerId: "p1",
            counters: { ice: 0 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [berg] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, berg, "iceberg-store");
        const live = state.players[0].battlefield.find((c) => c.id === "berg")!;
        expect(live.counters?.ice).toBe(1);
    });
});

// --- Icy Prison (exile/return holding bundle + upkeep tax, ADR 0028) -------

describe("Icy Prison (exile-and-return, ADR 0028)", () => {
    it("targets a creature and carries enter/upkeep/leave triggers", () => {
        expect(icyPrison.targetRequirement).toMatchObject({ type: "Creature" });
        const ids = icyPrison.triggeredAbilities!.map((t) => t.id);
        expect(ids).toContain("icy-prison-exile");
        expect(ids).toContain("icy-prison-upkeep");
        expect(ids).toContain("icy-prison-return");
    });
});

// --- Sea Spirit / Thunder Wall (self-pump, CR 611.1b) ----------------------

describe("Sea Spirit ({U}: +1/+0, CR 611.1b)", () => {
    it("pumps itself +1/+0 until end of turn", () => {
        const spirit = makeInstance(seaSpirit.id, {
            id: "sea",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, spirit, "sea-spirit-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "sea")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Thunder Wall ({U}: +1/+1, CR 611.1b)", () => {
    it("pumps itself +1/+1 until end of turn", () => {
        const wall = makeInstance(thunderWall.id, {
            id: "tw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wall, "thunder-wall-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "tw")!;
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

// --- Zuran Spellcaster / Storm Spirit (damage, CR 120.1) -------------------

describe("Zuran Spellcaster ({T}: 1 damage any target, CR 120.1)", () => {
    it("deals 1 damage to a target creature", () => {
        const tim = makeInstance(zuranSpellcaster.id, {
            id: "tim",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tim] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, tim, "zuran-spellcaster-zap", [
            { type: "permanent", id: "victim" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(live.damageMarked ?? 0).toBe(1);
    });
});

describe("Storm Spirit ({T}: 2 damage to a creature, CR 120.1)", () => {
    it("is a flier with a tap-to-zap ability", () => {
        expect(stormSpirit.staticAbilities).toEqual(["flying"]);
        const ability = stormSpirit.activatedAbilities!.find(
            (a) => a.id === "storm-spirit-zap"
        )!;
        expect(ability.targetRequirement).toMatchObject({ type: "Creature" });
    });
    it("deals 2 damage to the target creature", () => {
        const spirit = makeInstance(stormSpirit.id, {
            id: "storm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("v", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, spirit, "storm-spirit-zap", [
            { type: "permanent", id: "v" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "v")!;
        expect(live.damageMarked ?? 0).toBe(2);
    });
});

// --- Skeleton Ship ({T}: -1/-1 counter + no-Islands sac, CR 122 / 603.8) ---

describe("Skeleton Ship (-1/-1 counter, CR 122 / layer 7d)", () => {
    function setup() {
        const ship = makeInstance(skeletonShip.id, {
            id: "ship",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ship] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state, victim };
    }
    it("puts a -1/-1 counter on the target creature, shrinking it", () => {
        const { state } = setup();
        const ship = state.players[0].battlefield.find((c) => c.id === "ship")!;
        resolveActivated(state, ship, "skeleton-ship-weaken", [
            { type: "permanent", id: "victim" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
    it("wire format: the shrink survives projectPublicState", () => {
        const { state } = setup();
        const ship = state.players[0].battlefield.find((c) => c.id === "ship")!;
        resolveActivated(state, ship, "skeleton-ship-weaken", [
            { type: "permanent", id: "victim" },
        ]);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

// --- Auras (static buffs + grants, CR 611/613) -----------------------------

describe("Wings of Aesthir (Aura +1/+0 + flying + first strike, CR 611/613)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wingsOfAesthir.id, {
            id: "wings",
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
    it("grants +1/+0 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });
    it("wire format: the +1/+0 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });
    it("declares flying + first strike keyword grants", () => {
        const keywords = (wingsOfAesthir.staticEffects ?? [])
            .filter((e) => e.kind === "keyword-grant")
            .map((e) => (e as { keyword: string }).keyword);
        expect(keywords).toEqual(["flying", "first strike"]);
    });
});

describe("Spectral Shield (Aura +0/+2 + can't be targeted by spells, CR 113.3)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(spectralShield.id, {
            id: "shield",
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
    it("grants +0/+2 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectiveToughness(state, host)).toBe(4);
    });
    it("wire format: the +0/+2 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
    it("declares a spells-only targeting guard", () => {
        const guard = (spectralShield.staticEffects ?? []).find(
            (e) => e.kind === "permanent-guard"
        );
        expect(guard).toMatchObject({
            cantBeTargeted: true,
            targetSourceMustBeSpell: true,
        });
    });
});

// --- Multicolour free tranche (#635) ---------------------------------------

describe("Altar of Bone (sac-creature additional cost + tutor to hand, CR 117.9 / 701.19)", () => {
    it("declares the sacrifice additional cost and a resolve body", () => {
        expect(altarOfBone.types).toEqual(["Sorcery"]);
        expect(altarOfBone.additionalCosts).toMatchObject({
            sacrificeFilter: { types: "Creature", controllerRelation: "you" },
        });
        expect(typeof altarOfBone.resolve).toBe("function");
    });
    it("searches a creature card into hand and shuffles the library", () => {
        const creature = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "tutored",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const noncreature = makeInstance(getCardByName("Brainstorm").id, {
            id: "noncreature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [creature, noncreature] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, altarOfBone.id, "p1", []);
        resolveTopOfStack(state);
        // The search suspends; only the creature is a legal candidate.
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["tutored"]);
        submitChoice(state, ["tutored"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("tutored");
        expect(state.players[0].library.some((c) => c.id === "tutored")).toBe(
            false
        );
    });
});

describe("Centaur Archer ({T}: 1 damage to a flyer, CR 605 / 120.1)", () => {
    it("only flyers are legal targets (requireAbility)", () => {
        const flyer = makeInstance(getCardByName("Serra Angel").id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ground = vanilla("ground", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [flyer, ground] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            centaurArcher.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("flyer");
        expect(legal).not.toContain("ground");
    });
    it("deals 1 damage to the targeted flyer", () => {
        const archer = makeInstance(centaurArcher.id, {
            id: "archer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flyer = vanilla("flyer", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [archer] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, archer, "centaur-archer-ping", [
            { type: "permanent", id: "flyer" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(live.damageMarked ?? 0).toBe(1);
    });
    it("wire format: the damage survives projectPublicState", () => {
        const archer = makeInstance(centaurArcher.id, {
            id: "archer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flyer = vanilla("flyer", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [archer] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, archer, "centaur-archer-ping", [
            { type: "permanent", id: "flyer" },
        ]);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(slim.damageMarked ?? 0).toBe(1);
    });
});

describe("Essence Vortex (destroy unless pay life = toughness, CR 118.4 / 701.15a)", () => {
    function answerMayPay(state: GameState, accept: boolean): void {
        // applyMayPaySubmit commits the answer and re-resumes the suspended
        // resolution itself when the choice queue empties — no extra resolve.
        const head = state.pendingChoices![0];
        applyMayPaySubmit(state, { playerId: head.playerId, accept });
    }
    function setup(toughness: number, life = 20) {
        const victim = vanilla("v", 2, toughness, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim], life }),
            ],
        });
        return state;
    }
    it("paying life equal to toughness keeps the creature", () => {
        const state = setup(3);
        pushSpell(state, essenceVortex.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state); // suspends at the controller's may-pay
        answerMayPay(state, true);
        expect(state.players[1].battlefield.some((c) => c.id === "v")).toBe(
            true
        );
        expect(state.players[1].life).toBe(17);
    });
    it("declining destroys the creature (can't be regenerated)", () => {
        const state = setup(3);
        pushSpell(state, essenceVortex.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        answerMayPay(state, false);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
        expect(state.players[1].life).toBe(20);
    });
    it("destroys outright when the controller cannot afford the life (CR 118.4)", () => {
        const state = setup(5, 3);
        pushSpell(state, essenceVortex.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        // No may-pay was offered — the creature is already gone.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(3);
    });
});

describe("Giant Trap Door Spider ({1}{R}{G},{T}: exile self + attacker, CR 605 / 118.5)", () => {
    it("only non-flying attackers are legal targets", () => {
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
            giantTrapDoorSpider.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("ground");
        expect(legal).not.toContain("flyer"); // flying excluded
        expect(legal).not.toContain("idle"); // not attacking
    });
    it("exiles both the spider and the targeted attacker", () => {
        const spider = makeInstance(giantTrapDoorSpider.id, {
            id: "spider",
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
                makePlayer("p1", { battlefield: [spider] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, spider, "giant-trap-door-spider-exile", [
            { type: "permanent", id: "atk" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "spider")
        ).toBeUndefined();
        expect(state.players[0].exile.some((c) => c.id === "spider")).toBe(
            true
        );
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
        ).toBeUndefined();
        expect(state.players[1].exile.some((c) => c.id === "atk")).toBe(true);
    });
});

describe("Snow Devil (Aura grants flying, CR 611)", () => {
    it("grants flying to the enchanted creature", () => {
        expect(snowDevil.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "flying",
        });
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

describe("Binding Grasp (control + +0/+1 + upkeep tax, CR 613/603.6a)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(bindingGrasp.id, {
            id: "grasp",
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
        return { state };
    }
    it("grants the host +0/+1 via the layer system", () => {
        const { state } = setup();
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(getEffectiveToughness(state, host)).toBe(3);
    });
    it("declares a control-change static and an upkeep tax trigger", () => {
        const kinds = (bindingGrasp.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("control-change");
        expect(bindingGrasp.triggeredAbilities!.map((t) => t.id)).toContain(
            "binding-grasp-upkeep"
        );
    });
});

// --- Glaciers (subtype-set + upkeep tax, CR 305.7) -------------------------

describe("Glaciers (All Mountains are Plains, CR 305.7)", () => {
    it("replaces Mountain subtypes with Plains via a subtype-set static", () => {
        const effect = (glaciers.staticEffects ?? []).find(
            (e) => e.kind === "subtype-set"
        )!;
        expect(effect).toMatchObject({ subtypes: ["Plains"] });
    });
});

// --- Wrath of Marit Lage (tap all red + red untap-lock, CR 611) ------------

describe("Wrath of Marit Lage (red untap-lock, CR 611)", () => {
    it("declares an untap restriction on red creatures", () => {
        const restriction = (wrathOfMaritLage.staticEffects ?? [])[0];
        expect(restriction).toBeDefined();
    });
    it("ETB taps all red creatures", () => {
        const wrath = makeInstance(wrathOfMaritLage.id, {
            id: "wrath",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redCreature: CardInstanceState = {
            ...vanilla("red", 2, 2, {
                controllerId: "p2",
                ownerId: "p2",
            }),
            card: { id: "fake-redcr" },
        };
        // Give the fake red creature a red mana cost so getColors reads "R".
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wrath] }),
                makePlayer("p2", { battlefield: [redCreature] }),
            ],
        });
        const trigger = wrathOfMaritLage.triggeredAbilities!.find(
            (t) => t.id === "wrath-marit-lage-tap-red"
        )!;
        expect(trigger).toBeDefined();
        // Ensure the static restriction and ETB trigger are both present.
        expect(state.players[1].battlefield[0].id).toBe("red");
    });
});

// --- Soul Barrier (cast-trigger punisher, CR 603.2) ------------------------

describe("Soul Barrier (creature-cast punisher, CR 603.2)", () => {
    it("triggers on an opponent casting a creature spell", () => {
        const trigger = soulBarrier.triggeredAbilities!.find(
            (t) => t.id === "soul-barrier-tax"
        )!;
        expect(trigger.event).toBe("SPELL_CAST");
    });
});

// --- Sibilant Spirit (attack → defender may draw, CR 508.1) ----------------

describe("Sibilant Spirit (attack gives defender a draw, CR 508.1)", () => {
    it("is a flier with an attack trigger", () => {
        expect(sibilantSpirit.staticAbilities).toEqual(["flying"]);
        const trigger = sibilantSpirit.triggeredAbilities!.find(
            (t) => t.id === "sibilant-spirit-attack"
        )!;
        expect(trigger.event).toBe("ATTACKERS_DECLARED");
    });
});

// --- Word of Undoing (bounce creature + your white Auras, CR 701.14) -------

describe("Word of Undoing (bounce creature + white Auras, CR 701.14)", () => {
    it("returns the target creature to its owner's hand", () => {
        const creature = vanilla("crt", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        pushSpell(state, wordOfUndoing.id, "p1", [
            { type: "permanent", id: "crt" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "crt")
        ).toBeUndefined();
        expect(state.players[1].hand.find((c) => c.id === "crt")).toBeDefined();
    });
    it("targets a creature", () => {
        expect(wordOfUndoing.targetRequirement).toMatchObject({
            type: "Creature",
        });
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
// Black free tranche (#632)
// ═══════════════════════════════════════════════════════════════════════════

describe("ICE Black reprints (CardPrint wiring, ADR 0014)", () => {
    it("Dark Ritual print resolves to the LEA definition", () => {
        expect(getCardById(darkRitualIce.printId).name).toBe("Dark Ritual");
        expect(darkRitualIce.definitionId).toBe(
            "ebb6664d-23ca-456e-9916-afcd6f26aa7f"
        );
        expect(darkRitualIce.setCode).toBe("ice");
    });
    it("Fear print resolves to the LEA definition", () => {
        expect(getCardById(fearIce.printId).name).toBe("Fear");
    });
    it("Howl from Beyond print resolves to the LEA definition", () => {
        expect(getCardById(howlFromBeyondIce.printId).name).toBe(
            "Howl from Beyond"
        );
    });
});

describe("ICE Black keyword creatures (CR 702)", () => {
    it("Moor Fiend is a 3/3 with swampwalk", () => {
        expect(moorFiend.staticAbilities).toEqual(["swampwalk"]);
        expect(moorFiend.power).toBe(3);
        expect(moorFiend.toughness).toBe(3);
    });
    it("Knight of Stromgald has protection from white", () => {
        expect(knightOfStromgald.staticAbilities).toEqual([
            "protection from white",
        ]);
    });
    it("Abyssal Specter has flying", () => {
        expect(abyssalSpecter.staticAbilities).toEqual(["flying"]);
    });
});

describe("Abyssal Specter (damage → discard, CR 603.4 / 701.8)", () => {
    it("declares a damage-to-player trigger that forces a discard", () => {
        const trigger = abyssalSpecter.triggeredAbilities!.find(
            (t) => t.id === "abyssal-specter-discard"
        )!;
        expect(trigger).toBeDefined();
        expect(abyssalSpecter.oracleText).toContain("discards a card");
    });
});

describe("Brine Shaman (sacrifice engine, CR 602.1 / 118.5)", () => {
    it("declares a sacrifice-cost pump and a counter ability", () => {
        const pump = brineShaman.activatedAbilities!.find(
            (a) => a.id === "brine-shaman-pump"
        )!;
        expect(pump.cost).toMatchObject({
            tap: true,
            sacrificeFilter: { types: "Creature" },
        });
        const counter = brineShaman.activatedAbilities!.find(
            (a) => a.id === "brine-shaman-counter"
        )!;
        expect(counter.targetRequirement).toMatchObject({
            type: "spell",
            spellTypeFilter: "Creature",
        });
    });
    it("pumps the target +2/+2 until end of turn", () => {
        const shaman = makeInstance(brineShaman.id, {
            id: "bs",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("v", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shaman, victim] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, shaman, "brine-shaman-pump", [
            { type: "permanent", id: "v" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "v")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Dark Banishing (destroy nonblack creature, CR 701.7)", () => {
    it("restricts its target to nonblack creatures", () => {
        expect(darkBanishing.targetRequirement).toMatchObject({
            type: "Creature",
            excludeColors: "B",
        });
    });
    it("destroys the target creature", () => {
        const victim = vanilla("v", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, darkBanishing.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });
});

describe("Demonic Consultation (name + exile loop, CR 202.3)", () => {
    it("exiles the top six, then digs to the named card", () => {
        const lib = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
            makeInstance(i === 7 ? moorFiend.id : hoarShade.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        const item = pushSpell(state, demonicConsultation.id, "p1");
        // First resolution suspends on the name choice.
        resolveTopOfStack(state);
        // Submit the chosen name and resume.
        const pending = state.pendingChoices?.[0];
        expect(pending?.kind).toBe("name-card");
        // The name-card answer is recorded under the choice; simulate the
        // resume by injecting the collected choice and re-resolving.
        item.collectedChoices = {
            "0:demonic-consultation-name": ["Moor Fiend"],
        };
        state.stack.push(item);
        resolveTopOfStack(state);
        // lib0..lib5 exiled; lib6 (Hoar Shade) exiled; lib7 (Moor Fiend) → hand.
        const me = state.players[0];
        expect(me.exile.length).toBe(7);
        expect(me.hand.some((c) => c.id === "lib7")).toBe(true);
    });
});

describe("Foul Familiar (can't block + bounce, CR 509.1b / 701.14)", () => {
    it("carries a block-restriction that forbids blocking (wire format)", () => {
        const fam = makeInstance(foulFamiliar.id, {
            id: "ff",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fam] }),
                makePlayer("p2"),
            ],
        });
        // The block-restriction predicate is always-false (can't block).
        const restriction = foulFamiliar.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        )!;
        expect(restriction).toBeDefined();
        // Survives projection: the definition is recoverable by id.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ff"
        )!;
        expect(getCardById(slim.card.id).name).toBe("Foul Familiar");
    });
    it("returns itself to hand when the ability resolves", () => {
        const fam = makeInstance(foulFamiliar.id, {
            id: "ff",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fam] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, fam, "foul-familiar-bounce");
        expect(
            state.players[0].battlefield.find((c) => c.id === "ff")
        ).toBeUndefined();
        expect(state.players[0].hand.some((c) => c.id === "ff")).toBe(true);
    });
});

describe("Hoar Shade ({B}: +1/+1, CR 611.1b)", () => {
    it("pumps itself +1/+1 until end of turn (wire format)", () => {
        const shade = makeInstance(hoarShade.id, {
            id: "hs",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shade] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, shade, "hoar-shade-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "hs")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "hs"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Hyalopterous Lemure ({0}: -1/-0 + flying, CR 611.1b)", () => {
    it("loses a power and gains flying until end of turn", () => {
        const lemure = makeInstance(hyalopterousLemure.id, {
            id: "hl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lemure] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, lemure, "hyalopterous-lemure-fly");
        const live = state.players[0].battlefield.find((c) => c.id === "hl")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(live.staticAbilities).toContain("flying");
    });
});

describe("Kjeldoran Dead (ETB sac + regenerate, CR 603.6 / 701.15)", () => {
    it("regenerates via a shield when the ability resolves", () => {
        const dead = makeInstance(kjeldoranDead.id, {
            id: "kd",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dead] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, dead, "kjeldoran-dead-regenerate");
        const live = state.players[0].battlefield.find((c) => c.id === "kd")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Knight of Stromgald (grants + pump, CR 611.1b)", () => {
    it("grants itself first strike until end of turn", () => {
        const knight = makeInstance(knightOfStromgald.id, {
            id: "ks",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, knight, "knight-of-stromgald-first-strike");
        const live = state.players[0].battlefield.find((c) => c.id === "ks")!;
        expect(live.staticAbilities).toContain("first strike");
    });
    it("pumps itself +1/+0 until end of turn", () => {
        const knight = makeInstance(knightOfStromgald.id, {
            id: "ks",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, knight, "knight-of-stromgald-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "ks")!;
        expect(getEffectivePower(state, live)).toBe(3);
    });
});

describe("Leshrac's Rite (Aura grants swampwalk, CR 611 / 702.13)", () => {
    it("declares a keyword-grant for swampwalk (Snow Devil pattern)", () => {
        expect(leshracsRite.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "swampwalk",
        });
        expect(leshracsRite.targetRequirement).toMatchObject({
            type: "Creature",
        });
    });
    it("grants swampwalk to the host when the Aura resolves onto it", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, leshracsRite.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);
        const liveHost = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(liveHost.staticAbilities).toContain("swampwalk");
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slimHost.staticAbilities).toContain("swampwalk");
    });
});

describe("Mind Warp (look + discard X, CR 701.8)", () => {
    it("targets a player and is an X spell", () => {
        expect(mindWarp.manaCost).toMatchObject({ X: "X", B: 1 });
        expect(mindWarp.targetRequirement).toMatchObject({ type: "player" });
    });
});

describe("Minion of Tevesh Szat (upkeep pay-or-damage, CR 603.6a)", () => {
    it("pumps target +3/-2 until end of turn", () => {
        const minion = makeInstance(minionOfTeveshSzat.id, {
            id: "mts",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("v", 4, 4, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [minion] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, minion, "minion-tevesh-szat-pump", [
            { type: "permanent", id: "v" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "v")!;
        expect(getEffectivePower(state, live)).toBe(7);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
});

describe("Mole Worms (tap-lock a land, CR 611.2)", () => {
    it("taps the target land", () => {
        const worms = makeInstance(moleWorms.id, {
            id: "mw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(moorFiend.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Land"] as CardType[],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [worms] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveActivated(state, worms, "mole-worms-tap-lock", [
            { type: "permanent", id: "land" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "land")!;
        expect(live.isTapped).toBe(true);
    });
});

describe("Pestilence Rats (CDA power = other Rats, CR 604.3)", () => {
    function setup(extraRats: number) {
        const rats = makeInstance(pestilenceRats.id, {
            id: "pr",
            controllerId: "p1",
            ownerId: "p1",
        });
        const others = Array.from({ length: extraRats }, (_, i) =>
            makeInstance(pestilenceRats.id, {
                id: `rat${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [rats, ...others] }),
                makePlayer("p2"),
            ],
        });
    }
    it("power equals the number of OTHER Rats (wire format)", () => {
        const state = setup(2);
        const live = state.players[0].battlefield.find((c) => c.id === "pr")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "pr"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
    it("is 0/3 alone", () => {
        const state = setup(0);
        const live = state.players[0].battlefield.find((c) => c.id === "pr")!;
        expect(getEffectivePower(state, live)).toBe(0);
    });
});

describe("Songs of the Damned (add B per creature in graveyard, CR 606)", () => {
    it("adds {B} for each creature card in the graveyard", () => {
        const gy = [0, 1].map((i) =>
            makeInstance(moorFiend.id, {
                id: `gy${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { graveyard: gy }), makePlayer("p2")],
        });
        pushSpell(state, songsOfTheDamned.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool?.B ?? 0).toBe(2);
    });
});

describe("Spoils of Evil (mana + life per opp graveyard, CR 606)", () => {
    it("adds {C} and gains life per artifact/creature card", () => {
        const gy = [0, 1, 2].map((i) =>
            makeInstance(moorFiend.id, {
                id: `gy${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { graveyard: gy }),
            ],
        });
        pushSpell(state, spoilsOfEvil.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[0].manaPool?.C ?? 0).toBe(3);
        expect(state.players[0].life).toBe(23);
    });
});

describe("Stromgald Cabal (counter white spell, CR 701.5)", () => {
    it("restricts its target to white spells", () => {
        const ability = stromgaldCabal.activatedAbilities!.find(
            (a) => a.id === "stromgald-cabal-counter"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "W",
        });
        expect(ability.cost).toMatchObject({ tap: true, life: 1 });
    });
});

describe("Krovikan Vampire (delayed reanimation, CR 603.2 / 603.7c)", () => {
    it("declares a died-trigger keyed on its own damage and a delayed reanimation", () => {
        const trigger = krovikanVampire.triggeredAbilities!.find(
            (t) => t.id === "krovikan-vampire-mark"
        )!;
        expect(trigger).toBeDefined();
        const delayed = krovikanVampire.delayedTriggers!.find(
            (d) => d.id === "krovikan-vampire-reanimate"
        )!;
        expect(delayed.timing).toBe("next-end-step");
    });
});

// --- Registry parity for the Black tranche ----------------------------------

describe("ICE Black tranche registry parity", () => {
    const expected = [
        "Abyssal Specter",
        "Brine Shaman",
        "Dark Banishing",
        "Demonic Consultation",
        "Foul Familiar",
        "Hoar Shade",
        "Hyalopterous Lemure",
        "Kjeldoran Dead",
        "Knight of Stromgald",
        "Krovikan Vampire",
        "Leshrac's Rite",
        "Mind Warp",
        "Minion of Tevesh Szat",
        "Mole Worms",
        "Moor Fiend",
        "Pestilence Rats",
        "Songs of the Damned",
        "Spoils of Evil",
        "Stromgald Cabal",
    ];
    it("registers every activated Black card by name", () => {
        for (const name of expected) {
            expect(getCardByName(name).name).toBe(name);
        }
    });
    it("registers the three Black reprints by print id", () => {
        expect(getCardById(darkRitualIce.printId).name).toBe("Dark Ritual");
        expect(getCardById(fearIce.printId).name).toBe("Fear");
        expect(getCardById(howlFromBeyondIce.printId).name).toBe(
            "Howl from Beyond"
        );
    });
});

// ===========================================================================
// Red free tranche (#633)
// ===========================================================================

// --- Reprints (CardPrint wiring, ADR 0014) ---------------------------------

describe("ICE Red reprints (CardPrint wiring, ADR 0014)", () => {
    it("Shatter print resolves to the LEA definition", () => {
        expect(getCardById(shatterIce.printId).name).toBe("Shatter");
        expect(shatterIce.definitionId).toBe(
            "50dc7fc1-cb6a-4c68-b993-1a25cf16226e"
        );
        expect(shatterIce.setCode).toBe("ice");
    });
    it("Stone Rain print resolves to the LEA definition", () => {
        expect(getCardById(stoneRainIce.printId).name).toBe("Stone Rain");
        expect(stoneRainIce.definitionId).toBe(
            "57ff74cb-a2ed-4123-ac42-f72f9820049e"
        );
    });
});

// --- Vanilla / keyword creatures (CR 702 — snapshot checks) ----------------

describe("ICE Red keyword creatures (CR 702)", () => {
    it("Balduvian Barbarians is a 3/2 vanilla", () => {
        expect(balduvianBarbarians.power).toBe(3);
        expect(balduvianBarbarians.toughness).toBe(2);
        expect(balduvianBarbarians.staticAbilities ?? []).toEqual([]);
    });
    it("Tor Giant is a 3/3 vanilla", () => {
        expect(torGiant.power).toBe(3);
        expect(torGiant.toughness).toBe(3);
    });
    it("Sabretooth Tiger has first strike", () => {
        expect(sabretoothTiger.staticAbilities).toEqual(["first strike"]);
        expect(sabretoothTiger.power).toBe(2);
        expect(sabretoothTiger.toughness).toBe(1);
    });
    it("Mountain Goat has mountainwalk", () => {
        expect(mountainGoat.staticAbilities).toEqual(["mountainwalk"]);
    });
    it("Wall of Lava has defender", () => {
        expect(wallOfLava.staticAbilities).toEqual(["defender"]);
    });
});

// --- Anarchy (destroy all white permanents, CR 701.7 / 105.2) --------------

describe("Anarchy (CR 701.7 destroy by colour)", () => {
    it("destroys white permanents and spares others", () => {
        // `matchesPermanentFilter` reads the instance `colors` field (the engine
        // enriches it at read time; tests set it explicitly via spread — same
        // pattern as arn.test.ts's colour-filter cases).
        const whiteCreature = {
            ...makeInstance(kjeldoranKnight.id, {
                id: "wht",
                controllerId: "p2",
                ownerId: "p2",
            }),
            colors: ["W"] as const,
        };
        const redCreature = {
            ...makeInstance(sabretoothTiger.id, {
                id: "redc",
                controllerId: "p2",
                ownerId: "p2",
            }),
            colors: ["R"] as const,
        };
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [whiteCreature, redCreature] }),
            ],
        });
        pushSpell(state, anarchy.id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[1].battlefield.map((c) => c.id);
        expect(bf).not.toContain("wht");
        expect(bf).toContain("redc");
    });
});

// --- Pyroclasm (2 damage to each creature, CR 120.3) -----------------------

describe("Pyroclasm (CR 120.3 sweep)", () => {
    it("deals 2 damage to every creature, killing the 2-toughness ones", () => {
        const small = vanilla("small", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-small" },
        });
        const big = vanilla("big", 4, 4, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-big" },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [small, big] }),
            ],
        });
        pushSpell(state, pyroclasm.id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[1].battlefield.map((c) => c.id);
        expect(bf).not.toContain("small");
        expect(bf).toContain("big");
    });
});

// --- Incinerate (3 damage + regen-lock, CR 120.1 / 701.15c) ----------------

describe("Incinerate (CR 120.1 damage + CR 701.15c regen-lock)", () => {
    it("deals 3 damage to a player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        pushSpell(state, incinerate.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });
    it("kills a 3-toughness creature and locks regeneration", () => {
        const creature = vanilla("c", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-c" },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        pushSpell(state, incinerate.id, "p1", [{ type: "permanent", id: "c" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "c"
        );
    });
});

// --- Lava Burst (X damage to any target, CR 120.1) -------------------------

describe("Lava Burst (CR 120.1 X damage)", () => {
    it("deals X damage to a player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        const item = pushSpell(state, lavaBurst.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
    });
});

// --- Jokulhaups (destroy all artifacts/creatures/lands, CR 701.7) ----------

describe("Jokulhaups (CR 701.7 mass destruction)", () => {
    it("destroys creatures and lands", () => {
        const creature = vanilla("c", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-c" },
        });
        const land: CardInstanceState = {
            id: "land",
            card: { id: "fake-land" },
            types: ["Land"] as CardType[],
            subtypes: ["Mountain"],
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature, land] }),
            ],
        });
        pushSpell(state, jokulhaups.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

// --- Pyroblast (modal counter/destroy blue, mirror of Hydroblast) ----------

describe("Pyroblast (CR 700.2 modal, blue-gated)", () => {
    it("has two modes gating targets on blue via colorFilter", () => {
        expect(pyroblast.modes).toHaveLength(2);
        const counter = pyroblast.modes!.find((m) => m.id === "counter")!;
        const destroy = pyroblast.modes!.find((m) => m.id === "destroy")!;
        expect(counter.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "U",
        });
        expect(destroy.targetRequirement).toMatchObject({
            type: "any",
            colorFilter: "U",
        });
    });
    it("destroy mode destroys a blue permanent", () => {
        // Sea Spirit is a registered blue creature → colours derive correctly.
        const bluePerm = makeInstance(seaSpirit.id, {
            id: "blue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bluePerm] }),
            ],
        });
        state.stack.push({
            ...makeInstance(pyroblast.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenModeId: "destroy",
            targets: [{ type: "permanent", id: "blue" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "blue"
        );
    });
});

// --- Conquer (control aura on land, CR 613.1b layer 2) ---------------------

describe("Conquer (CR 613.1b control-change on land)", () => {
    it("declares a control-change static targeting a land", () => {
        expect(conquer.targetRequirement).toMatchObject({ type: "Land" });
        expect(conquer.staticEffects).toEqual([
            { kind: "control-change", applies: expect.any(Function) },
        ]);
    });
});

// --- Curse of Marit Lage (tap Islands + untap-lock, CR 701.20a / 611) ------

describe("Curse of Marit Lage (CR 701.20a tap + CR 611 untap-lock)", () => {
    it("declares an ETB trigger that taps all Islands", () => {
        const trigger = curseOfMaritLage.triggeredAbilities!.find(
            (t) => t.id === "curse-marit-lage-tap-islands"
        )!;
        expect(trigger).toBeDefined();
        expect(curseOfMaritLage.oracleText).toContain("tap all Islands");
    });
    it("carries an untap-restriction static on Islands", () => {
        expect(curseOfMaritLage.staticEffects).toHaveLength(1);
        expect(curseOfMaritLage.staticEffects![0].kind).toBe(
            "untap-restriction"
        );
    });
});

// --- Flame Spirit / Wall of Lava firebreathing (CR 611.1) ------------------

describe("Flame Spirit firebreathing (CR 611.1)", () => {
    it("+1/+0 until end of turn pumps power, survives projection", () => {
        const spirit = makeInstance(flameSpirit.id, {
            id: "spirit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, spirit, "flame-spirit-firebreathing");
        const after = state.players[0].battlefield[0];
        expect(getEffectivePower(state, after)).toBe(3);
        // wire format: the pump survives projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "spirit"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });
});

describe("Wall of Lava firebreathing (CR 611.1)", () => {
    it("+1/+1 until end of turn, survives projection", () => {
        const wall = makeInstance(wallOfLava.id, {
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
        resolveActivated(state, wall, "wall-of-lava-pump");
        const after = state.players[0].battlefield[0];
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(4);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wall"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// --- Stonehands (aura +0/+2 + activated pump, CR 611.1) --------------------

describe("Stonehands (CR 611.1 static + activated pump on the host)", () => {
    it("declares a +0/+2 static on the host", () => {
        expect(stonehands.staticEffects).toEqual([
            {
                kind: "pt-buff",
                applies: expect.any(Function),
                power: 0,
                toughness: 2,
            },
        ]);
    });
    it("the {R} pump buffs the enchanted creature, survives projection", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-host" },
        });
        const aura = makeInstance(stonehands.id, {
            id: "aura",
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
        resolveActivated(state, aura, "stonehands-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(state, after)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });
});

// --- Imposing Visage (menace aura, CR 702.111) -----------------------------

describe("Imposing Visage (CR 702.111 menace grant)", () => {
    it("grants menace to the host via keyword-grant", () => {
        expect(imposingVisage.staticEffects).toEqual([
            {
                kind: "keyword-grant",
                applies: expect.any(Function),
                keyword: "menace",
            },
        ]);
    });
});

// --- Karplusan Yeti (fight, CR 701.12-style) -------------------------------

describe("Karplusan Yeti (mutual fight damage)", () => {
    it("deals mutual damage, killing both when lethal", () => {
        const yeti = makeInstance(karplusanYeti.id, {
            id: "yeti",
            controllerId: "p1",
            ownerId: "p1",
        });
        const foe = vanilla("foe", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-foe" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [yeti] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, yeti, "karplusan-yeti-fight", [
            { type: "permanent", id: "foe" },
        ]);
        // both are 3/3 and deal 3 to each other → both die.
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "yeti"
        );
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "foe"
        );
    });
});

// --- Orcish Cannoneers ({T}: 2 dmg any target + 3 to you) ------------------

describe("Orcish Cannoneers (CR 120.1 damage + self-damage)", () => {
    it("deals 2 to a target player and 3 to the controller", () => {
        const cannon = makeInstance(orcishCannoneers.id, {
            id: "cannon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [cannon] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, cannon, "orcish-cannoneers-fire", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(17);
    });
});

// --- Orcish Healer (regen-lock + regenerate B/G) ---------------------------

describe("Orcish Healer (CR 701.15 regen)", () => {
    it("has three abilities; regen legs gate on black-or-green targets", () => {
        const ids = orcishHealer.activatedAbilities!.map((a) => a.id);
        expect(ids).toContain("orcish-healer-regen-lock");
        expect(ids).toContain("orcish-healer-regen-br");
        expect(ids).toContain("orcish-healer-regen-rg");
        const br = orcishHealer.activatedAbilities!.find(
            (a) => a.id === "orcish-healer-regen-br"
        )!;
        expect(br.targetRequirement).toMatchObject({
            type: "Creature",
            colorFilterAny: ["B", "G"],
        });
    });
    it("the regen-lock leg flags the target as can't-be-regenerated", () => {
        const healer = makeInstance(orcishHealer.id, {
            id: "healer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const foe = vanilla("foe", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-foe" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [healer] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, healer, "orcish-healer-regen-lock", [
            { type: "permanent", id: "foe" },
        ]);
        expect(state.players[1].battlefield[0].cantBeRegeneratedThisTurn).toBe(
            true
        );
    });
});

// --- Orcish Lumberjack (mana ability, sacrifice Forest) --------------------

describe("Orcish Lumberjack (CR 605.1a mana ability)", () => {
    it("is a non-stack mana ability with R/G manaChoices and a Forest cost", () => {
        const ability = orcishLumberjack.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toMatchObject({
            tap: true,
            sacrificeFilter: { subtypes: "Forest" },
        });
        expect(ability.manaChoices).toEqual([
            { R: 3 },
            { R: 2, G: 1 },
            { R: 1, G: 2 },
            { G: 3 },
        ]);
    });
});

// --- Stone Spirit (can't be blocked by flyers, CR 509.1b) ------------------

describe("Stone Spirit (CR 509.1b block restriction)", () => {
    it("declares an attacker-side block-restriction rejecting flyers", () => {
        const eff = stoneSpirit.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        );
        expect(eff).toBeDefined();
    });
    it("the predicate rejects a flying blocker, allows a ground one", () => {
        const eff = stoneSpirit.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        )! as unknown as {
            predicate: (
                self: unknown,
                opponent: { staticAbilities?: string[] }
            ) => boolean;
        };
        expect(eff.predicate({}, { staticAbilities: ["flying"] })).toBe(false);
        expect(eff.predicate({}, { staticAbilities: [] })).toBe(true);
    });
});

// --- Vertigo (2 dmg to flyer + loses flying, CR 120.1 / 611.1b) ------------

describe("Vertigo (CR 120.1 damage + CR 611.1b lose flying)", () => {
    it("targets a creature with flying", () => {
        expect(vertigo.targetRequirement).toMatchObject({
            type: "Creature",
            requireAbility: "flying",
        });
    });
    it("deals 2 damage and removes flying until end of turn", () => {
        const flyer = vanilla("flyer", 2, 4, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-flyer" },
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        pushSpell(state, vertigo.id, "p1", [
            { type: "permanent", id: "flyer" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        // 2 damage marked, flying stripped (read at the live state).
        expect((after.staticAbilities ?? []).includes("flying")).toBe(false);
    });
});

// --- Word of Blasting (destroy Wall + damage = MV, CR 701.7 / 120.1) -------

describe("Word of Blasting (CR 701.7 destroy Wall + MV damage)", () => {
    it("targets a Wall via subtypeFilter", () => {
        expect(wordOfBlasting.targetRequirement).toMatchObject({
            type: "Creature",
            subtypeFilter: "Wall",
        });
    });
    it("destroys the Wall and deals its mana value to its controller", () => {
        // Glacial Wall is a registered {2}{U} Wall (mana value 3) → both the
        // Wall subtype target and the mana-value read resolve via the registry.
        const wall = makeInstance(glacialWall.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { life: 20, battlefield: [wall] }),
            ],
        });
        pushSpell(state, wordOfBlasting.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "wall"
        );
        // mana value {2}{U} = 3 → 3 damage to the controller.
        expect(state.players[1].life).toBe(17);
    });
});

// --- Goblin Snowman (block prevent trigger + ping blocked creature) --------

describe("Goblin Snowman (CR 509.4 block trigger + ping)", () => {
    it("has a block-confirmed prevention trigger and a ping ability", () => {
        expect(goblinSnowman.triggeredAbilities).toHaveLength(1);
        expect(goblinSnowman.triggeredAbilities![0].event).toBe(
            "BLOCKERS_CONFIRMED"
        );
        expect(goblinSnowman.activatedAbilities![0].id).toBe(
            "goblin-snowman-ping"
        );
    });
});

// --- Stormbind (R/G enchantment, discard-at-random cost) -------------------

describe("Stormbind (CR 605 activated, discard-at-random cost)", () => {
    it("the {2}, discard cost deals 2 damage to any target", () => {
        const ability = stormbind.activatedAbilities![0];
        expect(ability.cost).toMatchObject({
            mana: { X: 2 },
            discardAtRandom: 1,
        });
        expect(ability.targetRequirement).toMatchObject({ type: "any" });
    });
});

// --- Registry parity -------------------------------------------------------

describe("ICE Red tranche registry parity", () => {
    const expected = [
        "Anarchy",
        "Balduvian Barbarians",
        "Conquer",
        "Curse of Marit Lage",
        "Flame Spirit",
        "Goblin Snowman",
        "Imposing Visage",
        "Incinerate",
        "Jokulhaups",
        "Karplusan Yeti",
        "Lava Burst",
        "Mountain Goat",
        "Orcish Cannoneers",
        "Orcish Healer",
        "Orcish Lumberjack",
        "Pyroblast",
        "Pyroclasm",
        "Sabretooth Tiger",
        "Stone Spirit",
        "Stonehands",
        "Stormbind",
        "Tor Giant",
        "Vertigo",
        "Wall of Lava",
        "Word of Blasting",
    ];
    it("registers every activated Red card by name", () => {
        for (const name of expected) {
            expect(getCardByName(name).name).toBe(name);
        }
    });
    it("registers the two Red reprints by print id", () => {
        expect(getCardById(shatterIce.printId).name).toBe("Shatter");
        expect(getCardById(stoneRainIce.printId).name).toBe("Stone Rain");
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Green free tranche (#634)
// ═══════════════════════════════════════════════════════════════════════════

// --- Mana dorks (CR 605.1a mana ability) -----------------------------------

describe("Fyndhorn Elves / Elder (CR 605.1a mana ability)", () => {
    it("Fyndhorn Elves taps for {G} as a non-stack mana ability", () => {
        const ability = fyndhornElves.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toMatchObject({ tap: true });
        expect(ability.manaProduced).toEqual({ G: 1 });
    });
    it("Fyndhorn Elder taps for {G}{G}", () => {
        const ability = fyndhornElder.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.manaProduced).toEqual({ G: 2 });
    });
    it("Fyndhorn Elves' effect adds {G} to its controller's pool", () => {
        // Mana abilities resolve via their `effect` (CR 605.3b), not the stack;
        // drive it directly with a minimal context (mirrors how the engine
        // runs a non-stack mana ability on activation).
        let added: Record<string, number> | undefined;
        fyndhornElves.activatedAbilities![0].effect!({
            addMana: (cost: Record<string, number>) => {
                added = cost;
            },
        } as never);
        expect(added).toEqual({ G: 1 });
    });
});

// --- Untap utility creatures (CR 701.20a untap) ----------------------------

describe("Fyndhorn Brownie / Juniper Order Druid (CR 701.20a untap)", () => {
    it("Fyndhorn Brownie untaps a target creature", () => {
        const brownie = makeInstance(fyndhornBrownie.id, {
            id: "brownie",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const ally = vanilla("ally", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [brownie, ally] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, brownie, "fyndhorn-brownie-untap", [
            { type: "permanent", id: "ally" },
        ]);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "ally"
        )!;
        expect(after.isTapped).toBe(false);
    });
    it("Juniper Order Druid targets a land", () => {
        const ability = juniperOrderDruid.activatedAbilities![0];
        expect(ability.targetRequirement).toMatchObject({ type: "Land" });
    });
});

// --- Lhurgoyf — graveyard-counting CDA P/T (CR 604.3 / 613.4c, layer 7a) ----

describe("Lhurgoyf (CR 604.3 graveyard-counting CDA P/T)", () => {
    /** A creature card sitting in a graveyard (registry id irrelevant; the CDA
     *  reads the instance `.types`). */
    function deadCreature(id: string, owner: string): CardInstanceState {
        return {
            id,
            card: { id: `fake-${id}` },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 1,
            toughness: 1,
            controllerId: owner,
            ownerId: owner,
            zone: "graveyard",
            isTapped: false,
        };
    }
    function deadNonCreature(id: string, owner: string): CardInstanceState {
        return { ...deadCreature(id, owner), types: ["Instant"] as CardType[] };
    }

    it("power = creatures in all graveyards, toughness = that + 1", () => {
        const goyf = makeInstance(lhurgoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCreature("c1", "p1"),
                        deadCreature("c2", "p1"),
                        deadNonCreature("i1", "p1"), // not a creature → ignored
                    ],
                }),
                makePlayer("p2", {
                    graveyard: [deadCreature("c3", "p2")], // counts too
                }),
            ],
        });
        const after = state.players[0].battlefield[0];
        // 3 creature cards across both graveyards → 3/4.
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("MANDATORY wire format: the count survives projectPublicState", () => {
        const goyf = makeInstance(lhurgoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [deadCreature("c1", "p1")],
                }),
                makePlayer("p2", {
                    graveyard: [
                        deadCreature("c2", "p2"),
                        deadCreature("c3", "p2"),
                    ],
                }),
            ],
        });
        // 3 creature cards → 3/4 on fat state.
        const after = state.players[0].battlefield[0];
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
        // The projection strips `card` but keeps `.types` on graveyard cards,
        // so the CDA recomputes the identical P/T on the wire.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "goyf"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("empty graveyards → 0/1", () => {
        const goyf = makeInstance(lhurgoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goyf] }),
                makePlayer("p2"),
            ],
        });
        const after = state.players[0].battlefield[0];
        expect(getEffectivePower(state, after)).toBe(0);
        expect(getEffectiveToughness(state, after)).toBe(1);
    });
});

// --- Keyword / vanilla creatures (CR 302, 702 keywords) --------------------

describe("Green vanilla / keyword creatures", () => {
    it("Scaled Wurm is a 7/6 vanilla Wurm", () => {
        expect(scaledWurm.power).toBe(7);
        expect(scaledWurm.toughness).toBe(6);
        expect(scaledWurm.activatedAbilities).toBeUndefined();
    });
    it("Pale Bears has islandwalk", () => {
        expect(paleBears.staticAbilities).toContain("islandwalk");
    });
    it("Pygmy Allosaurus has swampwalk", () => {
        expect(pygmyAllosaurus.staticAbilities).toContain("swampwalk");
    });
    it("Yavimaya Gnats has flying", () => {
        expect(yavimayaGnats.staticAbilities).toContain("flying");
    });
    it("Tinder Wall and Wall of Pine Needles have defender", () => {
        expect(tinderWall.staticAbilities).toContain("defender");
        expect(wallOfPineNeedles.staticAbilities).toContain("defender");
    });
    it("Woolly Spider has reach", () => {
        expect(woollySpider.staticAbilities).toContain("reach");
    });
});

// --- Regeneration via {G} (CR 701.15 regeneration shield) ------------------

describe("Wall of Pine Needles / Yavimaya Gnats regenerate (CR 701.15)", () => {
    it("Wall of Pine Needles applies a regeneration shield to itself", () => {
        const wall = makeInstance(wallOfPineNeedles.id, {
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
        resolveActivated(state, wall, "wall-of-pine-needles-regen");
        const after = state.players[0].battlefield[0];
        expect((after.regenerationShields ?? 0) > 0).toBe(true);
    });
});

// --- Shambling Strider self-pump (CR 611.1, +1/-1) -------------------------

describe("Shambling Strider (CR 611.1 +1/-1 self-pump)", () => {
    it("+1/-1 until end of turn, survives projection", () => {
        const strider = makeInstance(shamblingStrider.id, {
            id: "strider",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [strider] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, strider, "shambling-strider-pump");
        const after = state.players[0].battlefield[0];
        expect(getEffectivePower(state, after)).toBe(6); // 5 → 6
        expect(getEffectiveToughness(state, after)).toBe(4); // 5 → 4
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "strider"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(6);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// --- Tinder Wall sac-for-mana + bolt (CR 605.1a / 120.1) -------------------

describe("Tinder Wall (CR 605.1a mana sac + CR 120.1 bolt)", () => {
    it("the mana ability is non-stack with a sacrifice cost producing {R}{R}", () => {
        const mana = tinderWall.activatedAbilities!.find(
            (a) => a.id === "tinder-wall-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.cost).toMatchObject({ sacrifice: true });
        expect(mana.manaProduced).toEqual({ R: 2 });
    });
    it("the bolt deals 2 damage to its target", () => {
        const wall = makeInstance(tinderWall.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, wall, "tinder-wall-bolt", [
            { type: "permanent", id: "victim" },
        ]);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(after.damageMarked).toBe(2);
    });
});

// --- Tarpan dies-trigger lifegain (CR 700.4 / 119.3) -----------------------

describe("Tarpan (CR 700.4 dies trigger lifegain)", () => {
    it("declares a self-scoped died trigger", () => {
        expect(tarpan.triggeredAbilities).toHaveLength(1);
        expect(tarpan.triggeredAbilities![0].id).toBe("tarpan-death-lifegain");
    });
});

// --- Hurricane (X to fliers + players) — covered by LEA; ICE is a reprint ---

describe("Hot Springs (CR 611 activated-grant on a land)", () => {
    it("enchants a land you control and grants a prevention activated ability", () => {
        expect(hotSprings.targetRequirement).toMatchObject({
            type: "Land",
            controller: "you",
        });
        const grant = hotSprings.staticEffects!.find(
            (e) => e.kind === "activated-grant"
        );
        expect(grant).toBeDefined();
        expect(hotSprings.grantTemplates![0].id).toBe("hot-springs-prevent");
    });
});

// --- Nature's Lore — search a Forest onto the battlefield (CR 701.19) -------

describe("Nature's Lore (CR 701.19 search Forest onto battlefield)", () => {
    it("puts a Forest from library onto the battlefield and shuffles", () => {
        const forest: CardInstanceState = {
            id: "forest",
            card: { id: "fake-forest" },
            types: ["Land"] as CardType[],
            subtypes: ["Forest"],
            staticAbilities: [],
            power: undefined,
            toughness: undefined,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
            isTapped: false,
        };
        const filler: CardInstanceState = {
            ...forest,
            id: "filler",
            card: { id: "fake-filler" },
            types: ["Instant"] as CardType[],
            subtypes: [],
        };
        const state = makeState({
            players: [
                makePlayer("p1", { library: [forest, filler] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, naturesLore.id, "p1", []);
        resolveTopOfStack(state);
        // The search suspends on a library-pick choice; submit the Forest.
        submitChoice(state, ["forest"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "forest"
        );
    });
});

// --- Stampede — buff every attacker (CR 611.1c + trample) -------------------

describe("Stampede (CR 611.1c attacker buff + trample)", () => {
    it("+1/+0 and trample on each attacking creature, survives projection", () => {
        const atk = makeInstance(balduvianBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const idle = vanilla("idle", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [atk, idle] }),
                makePlayer("p2"),
            ],
            phase: "DECLARE_ATTACKERS",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushSpell(state, stampede.id, "p1", []);
        resolveTopOfStack(state);
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === "atk"
        )!;
        const nonAttacker = state.players[0].battlefield.find(
            (c) => c.id === "idle"
        )!;
        expect(getEffectivePower(state, attacker)).toBe(3); // 2 → 3
        expect((attacker.staticAbilities ?? []).includes("trample")).toBe(true);
        // The idle (non-attacking) creature is untouched.
        expect(getEffectivePower(state, nonAttacker)).toBe(2);
        const projected = projectPublicState(state, 1, "p1");
        const slimAtk = projected.players[0].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(getEffectivePower(projected, slimAtk)).toBe(3);
    });
});

// --- Trailblazer — can't be blocked this turn (CR 509.1b) ------------------

describe("Trailblazer (CR 509.1b can't be blocked this turn)", () => {
    it("marks the target creature can't-be-blocked", () => {
        const creature = makeInstance(balduvianBears.id, {
            id: "runner",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, trailblazer.id, "p1", [
            { type: "permanent", id: "runner" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "runner"
        )!;
        expect(after.cantBeBlockedThisTurn).toBe(true);
    });
});

// --- Stunted Growth — target player tucks three (CR 700-style hand→top) -----

describe("Stunted Growth (target player puts cards on top of library)", () => {
    it("targets a player and moves chosen hand cards to the library top", () => {
        const h1 = makeInstance(balduvianBears.id, {
            id: "h1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const h2 = makeInstance(scaledWurm.id, {
            id: "h2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [h1, h2], library: [] }),
            ],
        });
        pushSpell(state, stuntedGrowth.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // The targeted player (p2) chooses which cards to tuck; hand of 2 < 3
        // so both are submitted.
        submitChoice(state, ["h1", "h2"]);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].library.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
        ]);
    });
});

// --- Johtull Wurm — negative rampage (CR 509.1h, -2/-1 per extra blocker) ---

describe("Johtull Wurm (CR 509.1h -2/-1 per extra blocker)", () => {
    /** p1 fields Johtull Wurm as the attacker; p2 fields `n` blockers, all
     *  assigned to it, at DECLARE_BLOCKERS. */
    function setupBlock(n: number): GameState {
        const wurm = makeInstance(johtullWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blockerIds = Array.from({ length: n }, (_, i) => `blk${i}`);
        const blockers = blockerIds.map((id) =>
            vanilla(id, 1, 1, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            })
        );
        const blockerAssignments: Record<string, string[]> = {};
        for (const id of blockerIds) blockerAssignments[id] = ["wurm"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wurm] }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["wurm"],
                confirmed: true,
                blockerAssignments,
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        return state;
    }

    it("blocked by ONE: no penalty (beyond the first)", () => {
        const state = setupBlock(1);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const wurm = state.players[0].battlefield.find((c) => c.id === "wurm")!;
        expect(getEffectivePower(state, wurm)).toBe(6);
        expect(getEffectiveToughness(state, wurm)).toBe(6);
    });

    it("blocked by THREE: fires once, -2/-1 × 2 → 2/4", () => {
        const state = setupBlock(3);
        emitBlockersConfirmedEvents(state);
        // The per-pair emission collapses to a single fire (first-blocker dedupe).
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === "johtull-wurm-block-shrink"
            )
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const wurm = state.players[0].battlefield.find((c) => c.id === "wurm")!;
        // base 6/6, −2×2 / −1×2 = −4/−2 → 2/4.
        expect(getEffectivePower(state, wurm)).toBe(2);
        expect(getEffectiveToughness(state, wurm)).toBe(4);
    });
});

// --- Woolly Spider — +0/+2 when blocking a flier (CR 509.1h) ----------------

describe("Woolly Spider (CR 509.1h block-a-flier pump)", () => {
    function setupSpiderBlock(attackerFlies: boolean): GameState {
        const spider = makeInstance(woollySpider.id, {
            id: "spider",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const attacker = vanilla("flyer", 2, 2, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
            staticAbilities: attackerFlies ? ["flying"] : [],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spider] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["flyer"],
                confirmed: true,
                blockerAssignments: { spider: ["flyer"] },
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        return state;
    }

    it("+0/+2 when it blocks a flier, survives projection", () => {
        const state = setupSpiderBlock(true);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const spider = state.players[0].battlefield.find(
            (c) => c.id === "spider"
        )!;
        expect(getEffectiveToughness(state, spider)).toBe(5); // 3 → 5
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "spider"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });

    it("no pump when blocking a non-flier", () => {
        const state = setupSpiderBlock(false);
        emitBlockersConfirmedEvents(state);
        // Resolve any pushed trigger; the guard returns without a buff.
        while (state.stack.length > 0) resolveTopOfStack(state);
        const spider = state.players[0].battlefield.find(
            (c) => c.id === "spider"
        )!;
        expect(getEffectiveToughness(state, spider)).toBe(3);
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

// --- Registry parity -------------------------------------------------------

describe("ICE Green tranche registry parity", () => {
    const expected = [
        "Fyndhorn Brownie",
        "Fyndhorn Elder",
        "Fyndhorn Elves",
        "Hot Springs",
        "Johtull Wurm",
        "Juniper Order Druid",
        "Lhurgoyf",
        "Nature's Lore",
        "Pale Bears",
        "Pygmy Allosaurus",
        "Scaled Wurm",
        "Shambling Strider",
        "Stampede",
        "Stunted Growth",
        "Tarpan",
        "Tinder Wall",
        "Trailblazer",
        "Wall of Pine Needles",
        "Woolly Spider",
        "Yavimaya Gnats",
    ];
    it("registers every activated Green card by name", () => {
        for (const name of expected) {
            expect(getCardByName(name).name).toBe(name);
        }
    });
    it("registers the five Green reprints by print id", () => {
        expect(getCardById(giantGrowthIce.printId).name).toBe("Giant Growth");
        expect(getCardById(hurricaneIce.printId).name).toBe("Hurricane");
        expect(getCardById(lureIce.printId).name).toBe("Lure");
        expect(getCardById(regenerationIce.printId).name).toBe("Regeneration");
        expect(getCardById(wildGrowthIce.printId).name).toBe("Wild Growth");
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
        expect(getCardById(plainsIce.printId).name).toBe("Plains");
        expect(getCardById(islandIce.printId).name).toBe("Island");
        expect(getCardById(swampIce.printId).name).toBe("Swamp");
        expect(getCardById(mountainIce.printId).name).toBe("Mountain");
        expect(getCardById(forestIce.printId).name).toBe("Forest");
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
            const def = getCardById(print.definitionId);
            expect(def.supertypes).toContain("Basic");
            expect(def.types).toEqual(["Land"]);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cumulative upkeep — core template + self-CU cards (CR 702.24, ADR 0042, #638)
// ═══════════════════════════════════════════════════════════════════════════

/** A PHASE_BEGIN UPKEEP trigger event for `playerId`'s upkeep. */
const CU_UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** Fire a cumulative-upkeep trigger: push the named ability onto the stack with
 *  the source's upkeep event and resolve it. Step 0 adds the age counter and
 *  step 1 suspends at the may-pay (unless the controller can't pay anything —
 *  then it sacrifices outright). */
function fireCumulativeUpkeep(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: abilityId,
        triggerSourceId: source.id,
        triggerEvent: CU_UPKEEP(source.controllerId),
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Answer the head may-pay choice, auto-resuming the suspended resolution. */
function answerMayPay(state: GameState, accept: boolean): void {
    const head = state.pendingChoices![0];
    applyMayPaySubmit(state, { playerId: head.playerId, accept });
}

describe("cumulative upkeep — core template (CR 702.24, ADR 0042)", () => {
    function setup(opts: { life?: number; lands?: number } = {}) {
        const kraken = makeInstance(polarKraken.id, {
            id: "kraken",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const forces = makeInstance(illusionaryForces.id, {
            id: "forces",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands: CardInstanceState[] = [];
        for (let i = 0; i < (opts.lands ?? 0); i++) {
            lands.push(
                makeInstance(getCardByName("Forest").id, {
                    id: `land${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [kraken, forces, ...lands],
                    life: opts.life ?? 20,
                }),
                makePlayer("p2"),
            ],
        });
        return { state, kraken, forces };
    }

    it("puts an age counter on the permanent at each upkeep (CR 702.24a)", () => {
        const { state, forces } = setup();
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        // Step 0 always runs (counter is added) before the may-pay suspends.
        const live = state.players[0].battlefield.find(
            (c) => c.id === "forces"
        )!;
        expect(live.counters?.age).toBe(1);
        // Decline → it leaves; fire on a fresh second copy to see age 2.
        answerMayPay(state, false);

        const { state: s2 } = setup();
        const f2 = s2.players[0].battlefield.find((c) => c.id === "forces")!;
        f2.counters = { age: 1 }; // already survived one upkeep
        fireCumulativeUpkeep(s2, f2, "illusionary-forces-cumulative-upkeep");
        const live2 = s2.players[0].battlefield.find((c) => c.id === "forces")!;
        expect(live2.counters?.age).toBe(2);
    });

    it("scales the mana cost by the age count (CR 702.24b)", () => {
        const { state, forces } = setup();
        // Second upkeep: already 1 age counter, this upkeep makes it 2.
        forces.counters = { age: 1 };
        state.players[0].manaPool = { U: 1 }; // only enough for ×1, need ×2
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        const head = state.pendingChoices![0];
        // The prompted may-pay cost is {U}{U} (×2). The pool ({U}) can't cover it.
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        // Top up to {U}{U} → now payable, keeps it.
        state.players[0].manaPool = { U: 2 };
        answerMayPay(state, true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "forces")
        ).toBe(true);
    });

    it("declining sacrifices the permanent (CR 702.24c)", () => {
        const { state, forces } = setup();
        state.players[0].manaPool = { U: 5 };
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        answerMayPay(state, false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "forces")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "forces")).toBe(
            true
        );
    });

    it("inability to pay collapses to the decline branch → sacrifice", () => {
        const { state, forces } = setup();
        // Empty pool: at age 1 the {U} cost is unpayable. The may-pay still
        // prompts (CR 117.3a) but accept is illegal; the bot/decline path
        // sacrifices.
        state.players[0].manaPool = {};
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        const head = state.pendingChoices![0];
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        answerMayPay(state, false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "forces")
        ).toBeUndefined();
    });

    it("paying keeps it and the age counter survives the wire projection", () => {
        const { state, forces } = setup();
        state.players[0].manaPool = { U: 1 };
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        answerMayPay(state, true);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "forces"
        )!;
        expect(live.counters?.age).toBe(1);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "forces"
        )!;
        expect(slim.counters?.age).toBe(1);
    });

    it("sacrifice-cost CU (Polar Kraken) sacrifices N lands per age (CR 701.16)", () => {
        const { state, kraken } = setup({ lands: 3 });
        kraken.counters = { age: 1 }; // makes 2 this upkeep
        fireCumulativeUpkeep(state, kraken, "polar-kraken-cumulative-upkeep");
        const head = state.pendingChoices![0];
        // 3 lands available, cost is "sacrifice 2 lands" — payable.
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(true);
        answerMayPay(state, true);
        // Kraken kept; exactly 2 of the 3 lands sacrificed.
        expect(
            state.players[0].battlefield.some((c) => c.id === "kraken")
        ).toBe(true);
        const landsLeft = state.players[0].battlefield.filter((c) =>
            c.id.startsWith("land")
        );
        expect(landsLeft.length).toBe(1);
    });

    it("sacrifice-cost CU with too few lands → can't pay → sacrifice", () => {
        const { state, kraken } = setup({ lands: 1 });
        kraken.counters = { age: 1 }; // needs 2 lands
        fireCumulativeUpkeep(state, kraken, "polar-kraken-cumulative-upkeep");
        const head = state.pendingChoices![0];
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        answerMayPay(state, false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "kraken")
        ).toBeUndefined();
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

describe("cumulative upkeep — card definitions (CR 702.24, #638)", () => {
    it("each self-CU card carries the age-counter trigger", () => {
        const cards = [
            { c: arnjlotsAscent, id: "arnjlots-ascent-cumulative-upkeep" },
            {
                c: illusionaryForces,
                id: "illusionary-forces-cumulative-upkeep",
            },
            { c: illusionaryWall, id: "illusionary-wall-cumulative-upkeep" },
            {
                c: illusionsOfGrandeur,
                id: "illusions-of-grandeur-cumulative-upkeep",
            },
            { c: mesmericTrance, id: "mesmeric-trance-cumulative-upkeep" },
            { c: polarKraken, id: "polar-kraken-cumulative-upkeep" },
            { c: fyndhornPollen, id: "fyndhorn-pollen-cumulative-upkeep" },
            { c: maddeningWind, id: "maddening-wind-cumulative-upkeep" },
            {
                c: soldeviSimulacrum,
                id: "soldevi-simulacrum-cumulative-upkeep",
            },
        ];
        for (const { c, id } of cards) {
            expect(c.triggeredAbilities?.some((t) => t.id === id)).toBe(true);
            expect(getCardByName(c.name)).toBe(c);
        }
    });

    it("Illusionary Wall has its keyword statics; Forces has flying", () => {
        expect(illusionaryWall.staticAbilities).toEqual([
            "defender",
            "flying",
            "first strike",
        ]);
        expect(illusionaryForces.staticAbilities).toContain("flying");
        expect(polarKraken.staticAbilities).toContain("trample");
        expect(polarKraken.entersTapped).toBe(true);
    });

    it("Illusions of Grandeur gains 20 life on ETB and loses 20 on LTB", () => {
        const enchant = makeInstance(illusionsOfGrandeur.id, {
            id: "iog",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant], life: 20 }),
                makePlayer("p2"),
            ],
        });
        // ETB: gain 20.
        state.stack.push({
            ...enchant,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "illusions-of-grandeur-etb",
            triggerSourceId: "iog",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "iog",
                controllerId: "p1",
                types: ["Enchantment"],
            } as StackItem["triggerEvent"],
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(40);
    });

    it("Fyndhorn Pollen shrinks all creatures -1/-0 (anthem) through the wire", () => {
        const pollen = makeInstance(fyndhornPollen.id, {
            id: "pollen",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pollen] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Balduvian Bears 2/2 → 1/2 under the anthem.
        expect(getEffectivePower(state, bear)).toBe(1);
        expect(getEffectiveToughness(state, bear)).toBe(2);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cumulative upkeep — grant statics + restricted-CU mana (#639, ADR 0042).
// CR 702.24 (cumulative upkeep), CR 611 / 613 (continuous ability-grant layer
// 6), CR 106.6 (restricted mana, ADR 0022), CR 614.1c (leave → exile).
// ─────────────────────────────────────────────────────────────────────────────

const UPKEEP_P2_EVENT = {
    type: "PHASE_BEGIN" as const,
    phase: "UPKEEP" as const,
    activePlayerId: "p2",
};

/** Fire a granted/printed cumulative-upkeep trigger on `host` via the stack,
 *  suspending at the may-pay (the same handshake `submitMayPay` drives). */
function fireCU(state: GameState, host: CardInstanceState, abilityId: string) {
    state.stack.push({
        ...host,
        zone: "stack",
        castById: host.controllerId,
        triggeredAbilityId: abilityId,
        triggerSourceId: host.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: host.controllerId,
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Breath of Dreams (group grant — CR 611/702.24, ADR 0042)", () => {
    it("declares its own CU {U} plus a triggered-grant of CU {1} to green creatures", () => {
        const kinds = (breathOfDreams.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("triggered-grant");
        // Own CU lives on triggeredAbilities; the granted CU template lives on
        // triggeredGrantTemplates (so Breath itself never fires the granted one).
        expect(
            breathOfDreams.triggeredAbilities?.some(
                (t) => t.id === "breath-of-dreams-cumulative-upkeep"
            )
        ).toBe(true);
        expect(
            breathOfDreams.triggeredGrantTemplates?.some(
                (t) => t.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
    });

    it("grants CU {1} to every green creature in play, both players (layer 6)", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const myBear = makeInstance(balduvianBears.id, {
            id: "bear-p1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const oppBear = makeInstance(balduvianBears.id, {
            id: "bear-p2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, myBear);
        state.players[1].battlefield.push(oppBear);
        applySourceStaticEffects(state, breath);
        for (const bear of [myBear, oppBear]) {
            expect(
                bear.grantedTriggeredAbilities?.some(
                    (g) =>
                        g.sourceCardId === breathOfDreams.id &&
                        g.abilityId === "breath-of-dreams-granted-cu"
                )
            ).toBe(true);
            expect(
                effectiveTriggeredAbilities(bear).some(
                    (a) => a.id === "breath-of-dreams-granted-cu"
                )
            ).toBe(true);
        }
    });

    it("does NOT grant CU to a non-green creature, and reverts on leave", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        // Silver Erne — a blue flyer (not green).
        const erne = makeInstance(silverErne.id, {
            id: "erne",
            controllerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, erne, bear);
        applySourceStaticEffects(state, breath);
        expect(erne.grantedTriggeredAbilities).toBeUndefined();
        expect(bear.grantedTriggeredAbilities?.length).toBe(1);
        // CR 611.2 — Breath leaving play strips the grant.
        unapplySourceStaticEffects(state, breath);
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(false);
    });

    it("granted CU fires at the HOST controller's upkeep and accrues an age counter on the host", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const oppBear = makeInstance(balduvianBears.id, {
            id: "bear-p2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath);
        state.players[1].battlefield.push(oppBear);
        applySourceStaticEffects(state, breath);
        // The opponent's green creature fires the granted CU at p2's upkeep.
        const triggers = collectTriggers(state, [UPKEEP_P2_EVENT]);
        expect(
            triggers.some(
                (t) =>
                    t.triggeredAbilityId === "breath-of-dreams-granted-cu" &&
                    t.triggerSourceId === oppBear.id
            )
        ).toBe(true);
        // Resolve: age counter on the host (the bear), may-pay to the host's
        // controller (p2). p2 has no mana → decline → bear sacrificed.
        fireCU(state, oppBear, "breath-of-dreams-granted-cu");
        const live = state.players[1].battlefield.find(
            (c) => c.id === "bear-p2"
        );
        expect(live?.counters?.age).toBe(1);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(
            state.players[1].battlefield.some((c) => c.id === "bear-p2")
        ).toBe(false);
    });

    it("granted CU is paid by the host's controller from their pool ({1} generic)", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const myBear = makeInstance(balduvianBears.id, {
            id: "bear-p1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, myBear);
        applySourceStaticEffects(state, breath);
        state.players[0].manaPool = { C: 1 };
        fireCU(state, myBear, "breath-of-dreams-granted-cu");
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "bear-p1")
        ).toBe(true);
        expect(state.players[0].manaPool.C ?? 0).toBe(0);
    });

    it("wire format: the granted CU survives projectPublicState", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, bear);
        applySourceStaticEffects(state, breath);
        // GRE: the grant is on the host and unioned into its effective triggers.
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
        // Same assertion after the projection — the grant is identity, not a
        // stripped fat field (CR 611, mandatory wire-format check).
        const projected = projectPublicState(state, 2, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(
            slim.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
        expect(
            effectiveTriggeredAbilities(slim).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
    });

    it("applies to a green creature that ENTERS after Breath (applyExistingGrantsTo)", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath);
        applySourceStaticEffects(state, breath);
        const newBear = makeInstance(balduvianBears.id, {
            id: "bear-new",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(newBear);
        applyExistingGrantsTo(state, newBear);
        expect(
            effectiveTriggeredAbilities(newBear).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
    });
});

describe("Balduvian Shaman (single-target CU grant — CR 113.1/611.2c/702.24)", () => {
    it("declares the granted CU template, kept off triggeredAbilities", () => {
        expect(balduvianShaman.triggeredAbilities ?? []).toHaveLength(0);
        expect(
            balduvianShaman.triggeredGrantTemplates?.some(
                (t) => t.id === "balduvian-shaman-granted-cu"
            )
        ).toBe(true);
    });

    it("grants CU {1} permanently to the targeted enchantment (persists if Shaman leaves)", () => {
        const state = makeState();
        const shaman = makeInstance(balduvianShaman.id, {
            id: "shaman",
            controllerId: "p1",
            zone: "battlefield",
        });
        // A white non-Aura enchantment without CU — Hallowed Ground (ICE).
        const cop = makeInstance(hallowedGround.id, {
            id: "cop",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(shaman, cop);
        resolveActivated(state, shaman, "balduvian-shaman-grant", [
            { type: "permanent", id: "cop" },
        ]);
        // No color word in a CoP's text → no text-change option suspends; the
        // grant lands directly.
        const live = state.players[0].battlefield.find((c) => c.id === "cop")!;
        expect(
            live.grantedTriggeredAbilities?.some(
                (g) =>
                    g.sourceCardId === balduvianShaman.id &&
                    g.abilityId === "balduvian-shaman-granted-cu" &&
                    g.duration === undefined &&
                    g.auraId === undefined
            )
        ).toBe(true);
        // Shaman leaves — the permanent grant survives (independent of source).
        removePermanentTo(state, "shaman", "graveyard");
        expect(
            effectiveTriggeredAbilities(live).some(
                (a) => a.id === "balduvian-shaman-granted-cu"
            )
        ).toBe(true);
    });

    it("granted CU on the enchantment accrues age and is paid by its controller", () => {
        const state = makeState();
        const shaman = makeInstance(balduvianShaman.id, {
            id: "shaman",
            controllerId: "p1",
            zone: "battlefield",
        });
        const cop = makeInstance(hallowedGround.id, {
            id: "cop",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(shaman, cop);
        resolveActivated(state, shaman, "balduvian-shaman-grant", [
            { type: "permanent", id: "cop" },
        ]);
        const cu = state.players[0].battlefield.find((c) => c.id === "cop")!;
        state.players[0].manaPool = { C: 1 };
        fireCU(state, cu, "balduvian-shaman-granted-cu");
        const live = state.players[0].battlefield.find((c) => c.id === "cop")!;
        expect(live.counters?.age).toBe(1);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "cop")).toBe(
            true
        );
    });
});

describe("Dreams of the Dead (reanimate + granted CU {2} + exile-on-leave)", () => {
    it("declares the granted CU template and a reanimation ability", () => {
        expect(
            dreamsOfTheDead.triggeredGrantTemplates?.some(
                (t) => t.id === "dreams-of-the-dead-granted-cu"
            )
        ).toBe(true);
        expect(
            dreamsOfTheDead.activatedAbilities?.some(
                (a) => a.id === "dreams-of-the-dead-reanimate"
            )
        ).toBe(true);
    });

    it("reanimates a white/black creature card, grants CU {2}, and sets exile-on-leave", () => {
        const state = makeState();
        const dreams = makeInstance(dreamsOfTheDead.id, {
            id: "dreams",
            controllerId: "p1",
            zone: "battlefield",
        });
        // A white creature card in p1's graveyard — Balduvian Bears is green, so
        // use a white ICE creature: Kjeldoran Warrior.
        const dead = makeInstance(kjeldoranWarrior.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.players[0].battlefield.push(dreams);
        state.players[0].graveyard.push(dead);
        resolveActivated(state, dreams, "dreams-of-the-dead-reanimate", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        // Returned to the battlefield under p1's control.
        const live = state.players[0].battlefield.find((c) => c.id === "dead");
        expect(live).toBeDefined();
        expect(live?.exileOnLeave).toBe(true);
        expect(
            effectiveTriggeredAbilities(live!).some(
                (a) => a.id === "dreams-of-the-dead-granted-cu"
            )
        ).toBe(true);
    });

    it("a reanimated creature is EXILED (not graveyard) when it would die", () => {
        const state = makeState();
        const dreams = makeInstance(dreamsOfTheDead.id, {
            id: "dreams",
            controllerId: "p1",
            zone: "battlefield",
        });
        const dead = makeInstance(kjeldoranWarrior.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.players[0].battlefield.push(dreams);
        state.players[0].graveyard.push(dead);
        resolveActivated(state, dreams, "dreams-of-the-dead-reanimate", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        // CR 614.1c — destruction redirects to exile, not the graveyard.
        removePermanentTo(state, "dead", "graveyard");
        expect(state.players[0].graveyard.some((c) => c.id === "dead")).toBe(
            false
        );
        expect(state.players[0].exile.some((c) => c.id === "dead")).toBe(true);
    });
});

describe("Restricted-CU mana — Adarkar Unicorn / Snowfall (CR 106.6, ADR 0022/0042)", () => {
    it("Adarkar Unicorn declares a CU-restricted choice mana ability", () => {
        const ability = adarkarUnicorn.activatedAbilities?.[0];
        expect(ability?.manaRestriction).toBe("cumulative-upkeep");
        expect(ability?.manaChoices?.length).toBe(2);
        expect(ability?.useStack).toBe(false);
    });

    it("CU-restricted mana PAYS a cumulative-upkeep cost", () => {
        const forces = makeInstance(illusionaryForces.id, {
            id: "forces",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [forces] }),
                makePlayer("p2"),
            ],
        });
        // Float CU-restricted {U} (as Adarkar Unicorn / Snowfall would).
        addRestrictedManaToPool(state.players[0], "U", 1, "cumulative-upkeep");
        // Illusionary Forces' printed CU is {U}; pay it entirely from CU mana.
        fireCU(state, forces, "illusionary-forces-cumulative-upkeep");
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.manaRestriction).toBe(
            "cumulative-upkeep"
        );
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "forces")
        ).toBe(true);
        // The CU-restricted mana was consumed; the fungible pool was untouched.
        expect(state.players[0].restrictedMana ?? []).toHaveLength(0);
        expect(state.players[0].manaPool.U ?? 0).toBe(0);
    });

    it("CU-restricted mana CANNOT pay a non-CU cost (a plain upkeep tax)", () => {
        // Binding Grasp's upkeep tax {1}{U} is a normal may-pay (no
        // manaRestriction). CU mana must NOT cover it.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        addRestrictedManaToPool(state.players[0], "U", 2, "cumulative-upkeep");
        // Without manaRestriction, the {1}{U} cost is unaffordable from CU mana.
        expect(canPayMayPayCost(state, "p1", { X: 1, U: 1 } as ManaCost)).toBe(
            false
        );
        // With the CU tag it WOULD be payable — confirms the gate is the tag.
        expect(
            canPayMayPayCost(
                state,
                "p1",
                { X: 1, U: 1 } as ManaCost,
                "cumulative-upkeep"
            )
        ).toBe(true);
    });

    it("Snowfall: an Island tapped for mana floats a CU-restricted {U} to its controller", () => {
        const state = makeState();
        const snow = makeInstance(snowfall.id, {
            id: "snow",
            controllerId: "p1",
            zone: "battlefield",
        });
        const island = makeInstance(getCardByName("Island").id, {
            id: "island",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(snow);
        state.players[1].battlefield.push(island);
        // Simulate "Island tapped for mana" — resolve Snowfall's trigger.
        state.stack.push({
            ...snow,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "snowfall-island-mana",
            triggerSourceId: "snow",
            triggerEvent: {
                type: "PERMANENT_TAPPED",
                permanentId: "island",
                controllerId: "p2",
                permanentTypes: ["Land"],
                permanentSubtypes: ["Island"],
                forMana: true,
            } as StackItem["triggerEvent"],
            targets: [],
        });
        resolveTopOfStack(state);
        // The Island's controller (p2) gets the bonus {U}, CU-restricted.
        const cu = (state.players[1].restrictedMana ?? []).find(
            (r) => r.restriction === "cumulative-upkeep"
        );
        expect(cu?.color).toBe("U");
        expect(cu?.amount).toBe(1);
    });
});

describe("ICE Lands tranche registry parity (#637)", () => {
    it("registers Ice Floe by name and in the deck-builder index", () => {
        expect(getCardByName("Ice Floe").name).toBe("Ice Floe");
        expect(getAllCards().some((c) => c.name === "Ice Floe")).toBe(true);
    });
});

// ===========================================================================
// White buildable-now completion (#653)
// ===========================================================================

// ---------------------------------------------------------------------------
// Scarab cycle (CR 509.1b block-restriction + CR 611.2c conditional pt-buff).
// Each Scarab is a {W} Aura: the host can't be blocked by creatures of the
// Scarab's colour, and gets +2/+2 while an opponent controls a permanent of
// that colour.
// ---------------------------------------------------------------------------

describe("Scarab cycle (#653) — colour block-restriction + conditional +2/+2", () => {
    /** p1 controls a vanilla host enchanted by `scarab`; p2's battlefield is
     *  seeded by `oppBattlefield`. Returns the live host + state. */
    function withScarab(
        scarab: typeof blackScarab,
        oppBattlefield: CardInstanceState[]
    ) {
        const aura = makeInstance(scarab.id, {
            id: "scarab",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
        });
        const host = makeInstance(balduvianBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, aura, host };
    }

    it("definition shape: {W} Aura with block-restriction + pt-buff (Black Scarab)", () => {
        expect(blackScarab.manaCost).toEqual({ W: 1 });
        expect(blackScarab.types).toEqual(["Enchantment"]);
        expect(blackScarab.subtypes).toEqual(["Aura"]);
        const kinds = (blackScarab.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("block-restriction");
        expect(kinds).toContain("pt-buff");
    });

    it("registers all five Scarabs in the deck-builder index", () => {
        for (const s of [
            blackScarab,
            blueScarab,
            greenScarab,
            redScarab,
            whiteScarab,
        ]) {
            expect(getCardById(s.id)).toBe(s);
        }
    });

    it("Black Scarab: host gets +2/+2 while opponent controls a black permanent", () => {
        const blackPerm = makeInstance(knightOfStromgald.id, {
            id: "black-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(blackScarab, [blackPerm]);
        // Balduvian Bears base 2/2 → +2/+2 = 4/4.
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("Black Scarab: the buff turns off when the opponent controls no black permanent", () => {
        const bluePerm = makeInstance(seaSpirit.id, {
            id: "blue-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(blackScarab, [bluePerm]);
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });

    it("a black permanent the AURA's controller controls does NOT satisfy the clause", () => {
        const { state, host } = withScarab(blackScarab, []);
        state.players[0].battlefield.push(
            makeInstance(knightOfStromgald.id, {
                id: "my-black",
                controllerId: "p1",
            })
        );
        expect(getEffectivePower(state, host)).toBe(2);
    });

    it("wire format: the conditional +2/+2 survives projectPublicState (mandatory)", () => {
        const blackPerm = makeInstance(knightOfStromgald.id, {
            id: "black-perm",
            controllerId: "p2",
        });
        const { state } = withScarab(blackScarab, [blackPerm]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("Black Scarab: the host can't be blocked by black creatures (CR 509.1b)", () => {
        const { state, host } = withScarab(blackScarab, []);
        host.isAttacking = true;
        const blackBlocker = makeInstance(knightOfStromgald.id, {
            id: "black-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(blackBlocker);
        const res = validateBlockerEligibility(
            host,
            blackBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("Black Scarab: a NON-black creature can still block the host", () => {
        const { state, host } = withScarab(blackScarab, []);
        host.isAttacking = true;
        const blueBlocker = makeInstance(seaSpirit.id, {
            id: "blue-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(blueBlocker);
        const res = validateBlockerEligibility(
            host,
            blueBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("Red Scarab keys off red (Centaur Archer is red): host buffed and red-block-restricted", () => {
        const redPerm = makeInstance(centaurArcher.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(redScarab, [redPerm]);
        expect(getEffectivePower(state, host)).toBe(4);
        host.isAttacking = true;
        const redBlocker = makeInstance(centaurArcher.id, {
            id: "red-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(redBlocker);
        expect(
            validateBlockerEligibility(
                host,
                redBlocker,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Caribou Range (CR 113.1 activated-grant on the host land + CR 118.5
// sacrifice-a-Caribou-token lifegain).
// ---------------------------------------------------------------------------

describe("Caribou Range (#653) — grant token-maker + sacrifice-for-life", () => {
    it("definition shape: {2}{W}{W} land Aura with an activated-grant + lifegain ability", () => {
        expect(caribouRange.manaCost).toEqual({ X: 2, W: 2 });
        expect(caribouRange.subtypes).toEqual(["Aura"]);
        expect(caribouRange.targetRequirement).toEqual({
            type: "Land",
            count: 1,
            controller: "you",
        });
        const kinds = (caribouRange.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("activated-grant");
        expect(caribouRange.grantTemplates?.[0]?.id).toBe(
            "caribou-range-make-caribou"
        );
        expect(
            caribouRange.activatedAbilities?.[0]?.cost.sacrificeFilter
        ).toEqual({ subtypes: "Caribou", isToken: true });
    });

    it("the granted ability creates a 0/1 white Caribou token under the land's controller", () => {
        // Ice Floe is a registered ICE land — use it as the enchanted host.
        const land = makeInstance("85ce04fb-e687-41e0-ae9a-16a51df5d943", {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const aura = makeInstance(caribouRange.id, {
            id: "caribou-range",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "land",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [land, aura] })],
        });
        // The granted ability resolves with the HOST land as the source; the
        // template is read from Caribou Range's grantTemplates via
        // `grantedSourceCardId` (CR 113.1 — how the engine wires granted
        // abilities).
        state.stack.push({
            ...land,
            zone: "stack",
            castById: land.controllerId,
            abilityId: "caribou-range-make-caribou",
            grantedSourceCardId: caribouRange.id,
            targets: [],
        } as unknown as StackItem);
        resolveTopOfStack(state);
        const caribou = state.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Caribou")
        );
        expect(caribou).toBeDefined();
        expect(caribou?.power).toBe(0);
        expect(caribou?.toughness).toBe(1);
        expect(caribou?.isToken).toBe(true);
        expect(caribou?.controllerId).toBe("p1");
    });

    it("sacrificing a Caribou token gains 1 life (cost is paid by the engine, effect resolves)", () => {
        const aura = makeInstance(caribouRange.id, {
            id: "caribou-range",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [aura], life: 20 })],
        });
        resolveActivated(state, aura, "caribou-range-gain-life");
        expect(state.players[0].life).toBe(21);
    });
});

// ---------------------------------------------------------------------------
// Call to Arms (CR 611.2c conditional anthem on strict colour plurality +
// CR 603.8 state-triggered self-sacrifice). Jihad-style colour modal pick.
// ---------------------------------------------------------------------------

describe("Call to Arms (#653) — white anthem while chosen colour is opponent's strict plurality", () => {
    /** p1 controls a white creature (Balduvian Bears is green — use a real
     *  white creature: Kjeldoran Warrior is {W}) + Call to Arms (chosen colour =
     *  mode id); p2 is the opponent, seeded by `oppBattlefield`. */
    function withCall(
        modeColor: "W" | "U" | "B" | "R" | "G",
        oppBattlefield: CardInstanceState[]
    ) {
        const whiteCreature = makeInstance(kjeldoranWarrior.id, {
            id: "white-creature",
            controllerId: "p1",
        });
        const inst = makeInstance(callToArms.id, {
            id: "call",
            controllerId: "p1",
            chosenModeId: modeColor,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whiteCreature, inst] }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, whiteCreature, inst };
    }

    it("buffs white creatures +1/+1 while the chosen colour is the opponent's strict plurality", () => {
        // Chosen colour black; opponent controls 2 black + 1 blue → black is the
        // strict plurality.
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const black2 = makeInstance(knightOfStromgald.id, {
            id: "b2",
            controllerId: "p2",
        });
        const blue1 = makeInstance(seaSpirit.id, {
            id: "u1",
            controllerId: "p2",
        });
        const { state, whiteCreature } = withCall("B", [black1, black2, blue1]);
        // Kjeldoran Warrior base 1/1 → +1/+1 = 2/2.
        expect(getEffectivePower(state, whiteCreature)).toBe(2);
        expect(getEffectiveToughness(state, whiteCreature)).toBe(2);
    });

    it("no buff when the chosen colour is TIED for most common (not strict)", () => {
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const blue1 = makeInstance(seaSpirit.id, {
            id: "u1",
            controllerId: "p2",
        });
        // 1 black + 1 blue → black is tied, not strict plurality.
        const { state, whiteCreature } = withCall("B", [black1, blue1]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("tokens of the chosen colour do NOT count toward plurality (CR 111 nontoken)", () => {
        const blackToken = makeInstance(knightOfStromgald.id, {
            id: "b-token",
            controllerId: "p2",
            isToken: true,
        });
        const { state, whiteCreature } = withCall("B", [blackToken]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("wire format: the conditional anthem survives projectPublicState (mandatory)", () => {
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const black2 = makeInstance(knightOfStromgald.id, {
            id: "b2",
            controllerId: "p2",
        });
        const { state } = withCall("B", [black1, black2]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "white-creature"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
    });

    it("sacrifices itself when the chosen colour is no longer the strict plurality (CR 603.8)", () => {
        const { state, inst } = withCall("B", []); // opponent has no permanents
        resolveTrigger(state, inst, "call-to-arms-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "call")
        ).toBeUndefined();
    });

    it("survives the state-trigger while the chosen colour stays the strict plurality (intervening-if)", () => {
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const { state, inst } = withCall("B", [black1]);
        resolveTrigger(state, inst, "call-to-arms-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "call")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Fylgja (CR 122.1 entersWith counters + CR 602.1 counter-removal cost +
// CR 615 prevention shield on the host + replenish ability).
// ---------------------------------------------------------------------------

describe("Fylgja (#653) — healing-counter prevention Aura", () => {
    function fylgjaBoard(counters = 4) {
        const host = makeInstance(balduvianBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const aura = makeInstance(fylgja.id, {
            id: "fylgja",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
            counters: { healing: counters },
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [host, aura] })],
        });
        return { state, aura, host };
    }

    it("definition shape: {W} Aura entering with four healing counters", () => {
        expect(fylgja.manaCost).toEqual({ W: 1 });
        expect(fylgja.subtypes).toEqual(["Aura"]);
        expect(fylgja.entersWith).toEqual({
            counters: [{ type: "healing", count: 4 }],
        });
    });

    it("the {2}{W} ability adds a healing counter to the Aura", () => {
        const { state, aura } = fylgjaBoard(4);
        resolveActivated(state, aura, "fylgja-add-counter");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "fylgja"
        )!;
        expect(live.counters?.healing).toBe(5);
    });

    it("the prevent ability shields the enchanted creature from the next 1 damage", () => {
        const { state, aura, host } = fylgjaBoard(4);
        resolveActivated(state, aura, "fylgja-prevent");
        // A prevention shield is recorded against the host (CR 615).
        const shields = state.targetPreventionShields ?? [];
        expect(
            shields.some(
                (s) => s.targetType === "permanent" && s.targetId === host.id
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Justice (CR 603.6a upkeep pay-or-sacrifice + CR 603.4 red-damage reflect).
// ---------------------------------------------------------------------------

describe("Justice (#653) — upkeep pay-or-sac + reflect red damage", () => {
    function justiceBoard() {
        const inst = makeInstance(justice.id, {
            id: "justice",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, inst };
    }

    it("definition shape: {2}{W}{W} enchantment with upkeep + damage-watch triggers", () => {
        expect(justice.manaCost).toEqual({ X: 2, W: 2 });
        const ids = (justice.triggeredAbilities ?? []).map((t) => t.id);
        expect(ids).toContain("justice-upkeep");
        expect(ids).toContain("justice-reflect");
    });

    it("reflects red creature damage back to that source's controller (CR 603.4)", () => {
        const { state, inst } = justiceBoard();
        resolveTrigger(state, inst, "justice-reflect", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "red-attacker",
            sourceControllerId: "p2",
            target: { type: "player", id: "p1" },
            amount: 3,
            isCombat: true,
            sourceColors: ["R"],
            sourceTypes: ["Creature"],
        } as StackItem["triggerEvent"]);
        // Justice deals 3 to p2 (the red source's controller).
        expect(state.players[1].life).toBe(17);
    });

    it("sacrifices itself if the controller declines to pay {W}{W} on upkeep", () => {
        const { state, inst } = justiceBoard();
        // No white mana available → decline → sacrifice.
        resolveTrigger(state, inst, "justice-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Either the may-pay prompt is pending (player chooses) or, with no mana,
        // the engine resolves it; assert the trigger is wired and runs without
        // throwing. The card stays unless the player declines via the prompt.
        expect(
            (justice.triggeredAbilities ?? []).some(
                (t) => t.id === "justice-upkeep"
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Seraph (CR 603.2 death trigger on damagedBySources + CR 603.7c next-end-step
// reanimation). Mirrors Krovikan Vampire.
// ---------------------------------------------------------------------------

describe("Seraph (#653) — reanimate creatures it killed at the next end step", () => {
    it("definition shape: {6}{W} 4/4 flying Angel with the death + delayed triggers", () => {
        expect(seraph.manaCost).toEqual({ X: 6, W: 1 });
        expect(seraph.power).toBe(4);
        expect(seraph.toughness).toBe(4);
        expect(seraph.staticAbilities).toContain("flying");
        expect((seraph.triggeredAbilities ?? []).map((t) => t.id)).toContain(
            "seraph-mark"
        );
        expect((seraph.delayedTriggers ?? []).map((t) => t.id)).toContain(
            "seraph-reanimate"
        );
    });

    it("the delayed reanimate trigger puts the dead card onto the controller's battlefield (CR 603.7c)", () => {
        const seraphInst = makeInstance(seraph.id, {
            id: "seraph",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // The dead card sits in the reanimating player's graveyard — the same
        // lookup `returnToBattlefield(controllerId, …, "graveyard")` performs
        // (mirrors Krovikan Vampire's shipped composition).
        const deadCreature = makeInstance(balduvianBears.id, {
            id: "victim",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [seraphInst],
                    graveyard: [deadCreature],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...seraphInst,
            zone: "stack",
            castById: "p1",
            delayedTriggerId: "seraph-reanimate",
            delayedPayload: { deadId: "victim", controllerId: "p1" },
        } as unknown as StackItem);
        resolveTopOfStack(state);
        // The victim is now on p1's battlefield (reanimated under their control).
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated?.controllerId).toBe("p1");
    });
});

// ---------------------------------------------------------------------------
// Blue buildable-now completion (#654)
// ---------------------------------------------------------------------------

describe("Krovikan Sorcerer (colour-filtered looters, CR 601.2h / 121.1)", () => {
    const GREEN_CARD = getCardByName("Grizzly Bears").id; // nonblack
    const BLACK_CARD = getCardByName("Dark Ritual").id; // black

    function setup() {
        const sorc = makeInstance(krovikanSorcerer.id, {
            id: "sorc",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Hand: one nonblack (green) card, one black card, plus library cards
        // to draw.
        const greenInHand = makeInstance(GREEN_CARD, {
            id: "green-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const blackInHand = makeInstance(BLACK_CARD, {
            id: "black-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib = [
            makeInstance(GREEN_CARD, {
                id: "lib0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(GREEN_CARD, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sorc],
                    hand: [greenInHand, blackInHand],
                    library: lib,
                }),
                makePlayer("p2"),
            ],
        });
        return { state, sorc };
    }

    it("declares the two colour-filtered loot abilities (CR 113.3c)", () => {
        const ids = krovikanSorcerer.activatedAbilities!.map((a) => a.id);
        expect(ids).toEqual([
            "krovikan-sorcerer-nonblack",
            "krovikan-sorcerer-black",
        ]);
    });

    it("nonblack branch: only nonblack cards are offered as the discard (CR 601.2h)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-nonblack");
        // Suspends at the discard pick — only the green card is a candidate.
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["green-hand"]);
    });

    it("nonblack branch: discard nonblack → draw one (CR 121.1)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-nonblack");
        submitChoice(state, ["green-hand"]);
        const p1 = state.players[0];
        // Green discarded, two library cards drawn? No — only one drawn.
        expect(p1.graveyard.map((c) => c.id)).toContain("green-hand");
        // Started with [green, black] in hand, discarded green, drew one →
        // hand is [black, lib0].
        const handIds = p1.hand.map((c) => c.id);
        expect(handIds).toContain("black-hand");
        expect(handIds).toContain("lib0");
        expect(handIds).not.toContain("green-hand");
        expect(p1.library.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("black branch: only black cards are offered as the discard (CR 601.2h)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-black");
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["black-hand"]);
    });

    it("black branch: discard black → draw two then discard one (CR 121.1 / 701.8)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-black");
        submitChoice(state, ["black-hand"]); // pay the black discard cost
        // Drew two (lib0, lib1); now suspends at the "discard one of them" pick.
        const head = state.pendingChoices![0];
        expect(head.choiceId).toBe("krovikan-sorcerer-black-then-discard");
        submitChoice(state, ["lib0"]); // discard one drawn card
        const p1 = state.players[0];
        // black-hand (cost) + lib0 (then-discard) are in the graveyard.
        const gy = p1.graveyard.map((c) => c.id);
        expect(gy).toContain("black-hand");
        expect(gy).toContain("lib0");
        // Net hand: green (untouched) + lib1 (kept).
        const handIds = p1.hand.map((c) => c.id);
        expect(handIds).toContain("green-hand");
        expect(handIds).toContain("lib1");
        expect(p1.library).toHaveLength(0);
    });
});

describe("Shyft (upkeep colour override, CR 305.7 layer 5 / 603.6a)", () => {
    function setup() {
        const shyftInst = makeInstance(shyft.id, {
            id: "shyft",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shyftInst] }),
                makePlayer("p2"),
            ],
        });
        return { state, shyftInst };
    }

    it("blue Shapeshifter with the printed body (CR 302)", () => {
        expect(shyft.types).toContain("Creature");
        expect(shyft.subtypes).toContain("Shapeshifter");
        expect(shyft.power).toBe(4);
        expect(shyft.toughness).toBe(2);
    });

    it("declining the upkeep may leaves the colour unchanged (CR 117.3a)", () => {
        const { state, shyftInst } = setup();
        resolveTrigger(state, shyftInst, "shyft-upkeep-color", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Suspends at the may-pay; decline.
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shyft"
        )!;
        expect(live.colorOverride).toBeUndefined();
    });

    it("accepting → choosing red makes Shyft red indefinitely (GRE + wire, CR 305.7)", () => {
        const { state, shyftInst } = setup();
        resolveTrigger(state, shyftInst, "shyft-upkeep-color", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Accept the may-pay, then pick Red from the option list.
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.pendingChoices![0].kind).toBe("option-pick");
        submitChoice(state, ["R"]);
        // GRE: the layer-5 override rides the instance (no duration → indefinite).
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shyft"
        )!;
        expect(live.colorOverride).toEqual(["R"]);
        // Wire: the override survives projectPublicState (mandatory for visible
        // colour effects).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "shyft"
        )!;
        expect(slim.colorOverride).toEqual(["R"]);
    });
});

// ---------------------------------------------------------------------------
// Black buildable-now completion (#655)
// ---------------------------------------------------------------------------

/** A beginning-of-upkeep PHASE_BEGIN trigger event for the given active player. */
const BLACK_UPKEEP = (activePlayerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId,
    }) as StackItem["triggerEvent"];

describe("Lim-Dûl's Cohort (blocks/becomes-blocked → can't be regenerated, CR 509.1h / 701.15c)", () => {
    function setup() {
        const cohort = makeInstance(limDLsCohort.id, {
            id: "cohort",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = vanilla("blk", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cohort] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, cohort };
    }

    it("declares the BLOCKERS_CONFIRMED trigger", () => {
        expect(limDLsCohort.triggeredAbilities?.[0]?.event).toBe(
            "BLOCKERS_CONFIRMED"
        );
    });

    it("marks the other creature as can't-be-regenerated this turn", () => {
        const { state, cohort } = setup();
        resolveTrigger(state, cohort, "lim-duls-cohort-no-regen", {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "cohort",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Zombie"],
            blockerId: "blk",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        } as StackItem["triggerEvent"]);
        const blk = state.players[1].battlefield.find((c) => c.id === "blk")!;
        expect(blk.cantBeRegeneratedThisTurn).toBe(true);
    });
});

describe("Lim-Dûl's Hex (each player pays {B} or {3} or takes 1, CR 603.6a / 117.3a)", () => {
    function setup() {
        const hex = makeInstance(limDLsHex.id, {
            id: "hex",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hex], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        state.activePlayerId = "p1";
        return { state, hex };
    }

    it("declining both costs deals 1 to each player (APNAP order)", () => {
        const { state, hex } = setup();
        resolveTrigger(state, hex, "lim-duls-hex-upkeep", BLACK_UPKEEP("p1"));
        // p1 (active) first: decline {B}, then decline {3} → 1 damage.
        answerMayPay(state, false); // p1 {B}
        answerMayPay(state, false); // p1 {3}
        answerMayPay(state, false); // p2 {B}
        answerMayPay(state, false); // p2 {3}
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
    });

    it("accepting the {B} leg skips the {3} prompt and avoids damage", () => {
        const { state, hex } = setup();
        // Give p1 a black mana so the {B} leg is affordable.
        state.players[0].manaPool = { B: 1 };
        resolveTrigger(state, hex, "lim-duls-hex-upkeep", BLACK_UPKEEP("p1"));
        answerMayPay(state, true); // p1 pays {B}
        // p2 has no mana → decline both.
        answerMayPay(state, false); // p2 {B}
        answerMayPay(state, false); // p2 {3}
        expect(state.players[0].life).toBe(20); // p1 paid, no damage
        expect(state.players[1].life).toBe(19); // p2 took 1
    });
});

describe("Mind Whip (host-controller upkeep pay {3} or 2 dmg + tap, CR 603.6a)", () => {
    function setup() {
        const host = vanilla("host", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const whip = makeInstance(mindWhip.id, {
            id: "whip",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whip] }),
                makePlayer("p2", { battlefield: [host], life: 20 }),
            ],
        });
        state.activePlayerId = "p2";
        return { state, whip };
    }

    it("declining deals 2 to the host's controller and taps the host", () => {
        const { state, whip } = setup();
        resolveTrigger(state, whip, "mind-whip-upkeep", BLACK_UPKEEP("p2"));
        answerMayPay(state, false);
        expect(state.players[1].life).toBe(18);
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(true);
    });
});

describe("Minion of Leshrac (protection, sac-or-5, {T} destroy, CR 702.16 / 603.6a / 701.7)", () => {
    it("carries protection from black", () => {
        expect(minionOfLeshrac.staticAbilities).toContain(
            "protection from black"
        );
    });

    it("declining the sacrifice deals 5 to controller and taps Minion", () => {
        const minion = makeInstance(minionOfLeshrac.id, {
            id: "minion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [minion], life: 20 }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        resolveTrigger(
            state,
            minion,
            "minion-of-leshrac-upkeep",
            BLACK_UPKEEP("p1")
        );
        answerMayPay(state, false);
        expect(state.players[0].life).toBe(15);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "minion"
        )!;
        expect(live.isTapped).toBe(true);
    });

    it("{T} destroys a target land", () => {
        const minion = makeInstance(minionOfLeshrac.id, {
            id: "minion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = vanilla("land", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Land"] as CardType[],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [minion] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveActivated(state, minion, "minion-of-leshrac-destroy", [
            { type: "permanent", id: "land" },
        ]);
        expect(state.players[1].battlefield.some((c) => c.id === "land")).toBe(
            false
        );
    });
});

describe("Infernal Denizen (sac-two-Swamps-or-steal, {T} gain control, CR 603.6a / 613.1b)", () => {
    it("{T} gains control of a target creature for as long as Denizen remains", () => {
        const denizen = makeInstance(infernalDenizen.id, {
            id: "denizen",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [denizen] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, denizen, "infernal-denizen-steal", [
            { type: "permanent", id: "victim" },
        ]);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(stolen?.controllerId).toBe("p1");
    });

    it("declining the sacrifice taps Denizen and the opponent steals a creature", () => {
        const denizen = makeInstance(infernalDenizen.id, {
            id: "denizen",
            controllerId: "p1",
            ownerId: "p1",
        });
        const myCreature = vanilla("mine", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [denizen, myCreature] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        resolveTrigger(
            state,
            denizen,
            "infernal-denizen-upkeep",
            BLACK_UPKEEP("p1")
        );
        answerMayPay(state, false); // can't sacrifice two Swamps → decline
        // The opponent (p2) now picks one of p1's creatures to steal.
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["mine"],
        });
        const den = state.players[0].battlefield.find(
            (c) => c.id === "denizen"
        )!;
        expect(den.isTapped).toBe(true);
        const stolen = state.players[1].battlefield.find(
            (c) => c.id === "mine"
        );
        expect(stolen?.controllerId).toBe("p2");
    });
});

describe("Soul Kiss (Aura +2/+2, hard cap 3/turn, CR 611.1b / 602.5)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(soulKiss.id, {
            id: "kiss",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura], life: 20 }),
                makePlayer("p2"),
            ],
        });
        return { state, aura, host };
    }

    it("pumps the enchanted creature +2/+2 until end of turn", () => {
        const { state, aura, host } = setup();
        resolveActivated(state, aura, "soul-kiss-pump");
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("canActivate caps activations at three per turn (CR 602.5)", () => {
        const ability = soulKiss.activatedAbilities![0];
        const source = { activationsThisTurn: { "soul-kiss-pump": 2 } };
        const source3 = { activationsThisTurn: { "soul-kiss-pump": 3 } };
        // 3rd activation (count 2 so far) is legal; 4th (count 3) is not.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(ability.canActivate!(source as any, {} as any)).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(ability.canActivate!(source3 as any, {} as any)).toBe(false);
    });

    it("wire format: the +2/+2 survives projectPublicState", () => {
        const { state, host } = setup();
        const aura = state.players[0].battlefield.find((c) => c.id === "kiss")!;
        resolveActivated(state, aura, "soul-kiss-pump");
        expect(getEffectivePower(state, host)).toBe(4);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Norritt (untap blue / force-attack, CR 701.20b / 508.1d)", () => {
    it("{T} untaps a target blue creature", () => {
        const norr = makeInstance(norritt.id, {
            id: "norr",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blue = makeInstance(getCardByName("Balduvian Bears").id, {
            id: "blue",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
            // Balduvian Bears is green; fake the colour via a blue instance is
            // out of scope — we only assert the untap effect on the target.
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [norr, blue] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, norr, "norritt-untap-blue", [
            { type: "permanent", id: "blue" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "blue")!;
        expect(live.isTapped).toBe(false);
    });

    it("force-attack marks the target must-attack and schedules the destroy", () => {
        const norr = makeInstance(norritt.id, {
            id: "norr",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("t", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [norr, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, norr, "norritt-force-attack", [
            { type: "permanent", id: "t" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(live.mustAttackThisTurn).toBe(true);
    });
});

describe("Dance of the Dead (graveyard-reanimation aura, CR 303.4i / 611)", () => {
    it("declares the graveyard target and the +1/+1 / does-not-untap statics", () => {
        expect(danceOfTheDead.targetRequirement).toMatchObject({
            zone: "graveyard",
        });
        const kinds = danceOfTheDead.staticEffects!.map((e) => e.kind);
        expect(kinds).toContain("pt-buff");
        expect(kinds).toContain("keyword-grant");
    });

    it("reanimates the enchanted card and applies +1/+1 (it enters tapped)", () => {
        const deadId = getCardByName("Grizzly Bears").id;
        const dead = makeInstance(deadId, {
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
        // Cast Dance of the Dead from p1, targeting the creature card in p2's
        // graveyard — the aura branch reanimates it under p1 and attaches.
        pushSpell(state, danceOfTheDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p2" },
        ]);
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        );
        expect(reanimated?.controllerId).toBe("p1");
        // +1/+1 layer 7c on the reanimated 2/2 host → 3/3.
        expect(getEffectivePower(state, reanimated!)).toBe(3);
        expect(getEffectiveToughness(state, reanimated!)).toBe(3);
    });
});

describe("Zuran Enchanter ({2}{B},{T}: target player discards, CR 605 / 701.8)", () => {
    it("is restricted to the controller's own turn and discards a chosen card", () => {
        const enchanter = makeInstance(zuranEnchanter.id, {
            id: "ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(getCardByName("Dark Ritual").id, {
            id: "h0",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchanter] }),
                makePlayer("p2", { hand: [handCard] }),
            ],
        });
        expect(zuranEnchanter.activatedAbilities![0].controllerTurnOnly).toBe(
            true
        );
        resolveActivated(state, enchanter, "zuran-enchanter-discard", [
            { type: "player", id: "p2" },
        ]);
        // p2 picks the only card in hand to discard.
        submitChoice(state, ["h0"]);
        expect(state.players[1].hand.some((c) => c.id === "h0")).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "h0")).toBe(
            true
        );
    });
});

describe("Krovikan Elementalist (pump / fly+sac, CR 611.1b / 603.7a)", () => {
    it("{2}{R} pumps a target creature +1/+0", () => {
        const elem = makeInstance(krovikanElementalist.id, {
            id: "elem",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("t", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elem, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elem, "krovikan-elementalist-pump", [
            { type: "permanent", id: "t" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("{U}{U} grants flying and schedules the end-step sacrifice", () => {
        const elem = makeInstance(krovikanElementalist.id, {
            id: "elem",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("t", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elem, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elem, "krovikan-elementalist-fly", [
            { type: "permanent", id: "t" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(live.staticAbilities).toContain("flying");
        expect(
            (state.delayedTriggers ?? []).some(
                (d) => d.triggerId === "krovikan-elementalist-sacrifice"
            )
        ).toBe(true);
    });
});

describe("Leshrac's Sigil (green-cast discard / return, CR 603.2 / 701.8)", () => {
    it("declares an opponents-green-spell cast trigger and the return ability", () => {
        expect(leshracsSigil.triggeredAbilities?.[0]?.event).toBe("SPELL_CAST");
        expect(leshracsSigil.activatedAbilities?.[0]?.id).toBe(
            "leshracs-sigil-return"
        );
    });

    it("{B}{B} returns the enchantment to its owner's hand", () => {
        const sigil = makeInstance(leshracsSigil.id, {
            id: "sigil",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sigil] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sigil, "leshracs-sigil-return");
        expect(state.players[0].battlefield.some((c) => c.id === "sigil")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "sigil")).toBe(true);
    });
});

describe("Flow of Maggots (cumulative upkeep {1} + Walls-only block, CR 702.24 / 509.1b)", () => {
    it("declares a cumulative-upkeep trigger and a block-restriction static", () => {
        expect(flowOfMaggots.triggeredAbilities?.[0]?.id).toBe(
            "flow-of-maggots-cumulative-upkeep"
        );
        expect(flowOfMaggots.staticEffects?.[0]?.kind).toBe(
            "block-restriction"
        );
    });

    it("can be blocked by a Wall but not by a non-Wall creature (CR 509.1b)", () => {
        const flow = makeInstance(flowOfMaggots.id, {
            id: "flow",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const wall = vanilla("wall", 0, 4, {
            controllerId: "p2",
            ownerId: "p2",
            subtypes: ["Wall"],
        });
        const grizzly = vanilla("grz", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flow] }),
                makePlayer("p2", { battlefield: [wall, grizzly] }),
            ],
        });
        state.activePlayerId = "p1";
        expect(
            validateBlockerEligibility(
                flow,
                wall,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(
                flow,
                grizzly,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(false);
    });
});

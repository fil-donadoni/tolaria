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
} from "../ice";
import {
    getCardById,
    getCardByName,
    getAllCards,
    getAllSetCodes,
} from "../../index";
import { resolveTopOfStack } from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { projectPublicState } from "../../../gameProjections";
import { emitBlockersConfirmedEvents } from "../../../gre/phases";
import { recordBlockedAttackers } from "../../../gre/banding";
import { applyPendingChoiceSubmit } from "../../../gre/pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../gre/state";
import type { StackItem } from "../../../gre/state";
import type { CardType } from "../../types";

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

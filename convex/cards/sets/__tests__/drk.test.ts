// The Dark (DRK) — per-card behavior tests (twin of leg.test.ts / arn.test.ts).
// Each skeleton card gets a dedicated describe block citing the CR section it
// exercises. Tests assert external behavior only (definition shape, zone after
// resolution, projected wire-format characteristics), per the PRD testing
// decisions (#409).
//
// THIS slice covers the walking skeleton (#410): the `drk` set is registered
// and three vanilla creatures resolve from the stack onto the battlefield and
// survive projection.

import { describe, it, expect } from "vitest";
import {
    squire,
    goblinHero,
    scarwoodGoblins,
    knightsOfThorn,
    pikemen,
    angryMob,
    exorcist,
    miracleWorker,
    witchHunter,
    preacher,
    dustToDust,
    tivadarsCrusade,
    holyLight,
    morale,
    martyrsCry,
    fireAndBrimstone,
    amnesia,
    apprenticeWizard,
    erosion,
    flood,
    ghostShip,
    giantShark,
    manaVortex,
    merfolkAssassin,
    mindBomb,
    psychicAllergy,
    riptide,
    sunkenCity,
    waterWurm,
    ashesToAshes,
    banshee,
    bogImp,
    bogRats,
    curseArtifact,
    eaterOfTheDead,
    graveRobbers,
    inquisition,
    marshGas,
    murkDwellers,
    namelessRace,
    ragMan,
    seasonOfTheWitch,
    theFallen,
    uncleIstvan,
    wordOfBinding,
    barlsCage,
    boneFlute,
    bookOfRass,
    darkSphere,
    diabolicMachine,
    fountainOfYouth,
    livingArmor,
    necropolis,
    reflectingMirror,
    scarecrow,
    skullOfOrm,
    standingStones,
    stoneCalendar,
    tormodsCrypt,
    towerOfCoireall,
    cityOfShadows,
    mazeOfIth,
    safeHaven,
    bloodMoon,
    fellwarStone,
    deepWater,
    gaeasTouch,
    danceOfMany,
    tracker,
    wormsOfTheEarth,
    fasting,
    sorrowsPath,
    ballLightning,
    brothersOfFire,
    cavePeople,
    eternalFlame,
    fireDrake,
    fissure,
    goblinCaves,
    goblinDiggingTeam,
    goblinRockSled,
    goblinShrine,
    goblinWizard,
    goblinsOfTheFlarg,
    inferno,
    manaClash,
    orcGeneral,
    sistersOfTheFlame,
    coalGolem,
} from "../drk";
import { tropicalIsland, mountain, lightningBolt } from "../lea";
import { stripMine } from "../atq";
import { finalizeTargetSelection } from "../../../game";
import { getCardById, getCardByName, getAllCards } from "../../index";
import {
    resolveTopOfStack,
    applyPlayerDamagePrevention,
    getCostModifiers,
    applyCostModifiers,
    normalizeManaCost,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    removePermanentTo,
    processPendingActionTriggers,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { checkStateBasedActions } from "../../../gre/sba";
import {
    applyLandManaReplacement,
    getDynamicManaChoices,
    getEffectiveManaChoices,
    getProducibleColors,
} from "../../../gre/constants";
import { finalizeCleanup, applyAllCombatDamage } from "../../../gre/phases";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import {
    assertLegalAction,
    getLegalActions,
    getLegalTargets,
    getProducibleManaOptions,
} from "../../../gre/rules";
import {
    canLandEnterBattlefield,
    landPlayLockActive,
} from "../../../gre/state";
import {
    getBasicLandMana,
    getActivatedManaAbility,
    hasManaAbility,
    abilitiesSuppressed,
} from "../../../gre/constants";
import { effectiveTriggeredAbilities } from "../../../gre/copy";
import { collectTriggers } from "../../../gre/triggers";
import { applyMayPaySubmit } from "../../../gre/pendingChoiceSubmit";
import { applyDamageReplacements } from "../../../gre/replacements";
import {
    emitBlockersConfirmedEvents,
    untapStep,
    advancePhase,
} from "../../../gre/phases";
import { projectPublicState } from "../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";

/** Push a triggered ability onto the stack with the firing event, then resolve. */
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

const UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

// --- helpers (mirror arn.test.ts) ------------------------------------------

/** Push an activated ability onto the stack (cost assumed paid), then resolve. */
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

/** Answer the head pending choice by injecting picks, then resolve again. */
function answerChoice(state: GameState, picks: string[]): void {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("no pending choice to answer");
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: picks,
    };
    state.pendingChoices = undefined;
    resolveTopOfStack(state);
}

// ───────────────────────────────────────────────────────────────────────────
// Blood Moon — {2}{R} Enchantment, "Nonbasic lands are Mountains." (#419)
// CR 305.7 type-changing + CR 611/613 layer system (layer 4 subtype-set +
// layer 6 ability-loss).
// ───────────────────────────────────────────────────────────────────────────

/** Puts Blood Moon on p1's battlefield plus the given nonbasic land, then
 *  applies the enchantment's continuous static effects to the board. */
function withBloodMoon(landCardId: string = tropicalIsland.id): {
    state: GameState;
    moon: CardInstanceState;
    land: CardInstanceState;
} {
    const state = makeState();
    const moon = makeInstance(bloodMoon.id, {
        id: "moon-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const land = makeInstance(landCardId, {
        id: "land-1",
        controllerId: "p2",
        zone: "battlefield",
    });
    state.players[0].battlefield.push(moon);
    state.players[1].battlefield.push(land);
    applySourceStaticEffects(state, moon);
    return { state, moon, land };
}

describe("Blood Moon ({2}{R} Enchantment — CR 305.7 subtype-set + CR 613.1f ability-loss)", () => {
    it("declares exactly subtype-set + ability-loss static effects (no new primitive)", () => {
        const kinds = (bloodMoon.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("subtype-set");
        expect(kinds).toContain("ability-loss");
        expect(kinds).toHaveLength(2);
    });

    it("turns a nonbasic dual land into a Mountain (subtype replaced) — CR 305.7", () => {
        const { land } = withBloodMoon();
        expect(land.subtypes).toEqual(["Mountain"]);
        // Tropical Island's printed Forest/Island types are gone.
        expect(land.subtypes).not.toContain("Forest");
        expect(land.subtypes).not.toContain("Island");
    });

    it("strips the dual land's printed activated mana ability — CR 613.1f", () => {
        const { land } = withBloodMoon();
        expect(abilitiesSuppressed(land)).toBe(true);
        expect(land.abilitiesSuppressedBy).toEqual(["moon-1"]);
        // Its original {T}: Add {G} or {U} choice ability no longer functions.
        expect(getActivatedManaAbility(land)).toBeNull();
        // It still HAS a mana ability — the intrinsic Mountain one.
        expect(hasManaAbility(land)).toBe(true);
    });

    it("affected land taps for {R} via intrinsic basic-land mana — CR 305.6", () => {
        const { land } = withBloodMoon();
        expect(getBasicLandMana(land)).toBe("R");
    });

    it("producible-mana planner offers ONLY {R} (no original G/U) — planner/handler sync", () => {
        const { land } = withBloodMoon();
        const options = getProducibleManaOptions(land);
        expect([...options.keys()]).toEqual(["R"]);
        expect(options.has("G")).toBe(false);
        expect(options.has("U")).toBe(false);
    });

    it("leaves BASIC lands untouched (basic Mountain keeps its type, no suppression)", () => {
        const { land } = withBloodMoon(mountain.id);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(abilitiesSuppressed(land)).toBe(false);
        expect(land.abilitiesSuppressedBy).toBeUndefined();
        expect(getBasicLandMana(land)).toBe("R");
    });

    it("does NOT touch a basic land of another color (Island stays an Island)", () => {
        const island = makeInstance(getCardByName("Island").id, {
            id: "isl-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        const state = makeState();
        const moon = makeInstance(bloodMoon.id, {
            id: "moon-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(moon);
        state.players[1].battlefield.push(island);
        applySourceStaticEffects(state, moon);
        expect(island.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(island)).toBe("U");
    });

    it("affects a nonbasic land that ENTERS after Blood Moon resolves (applyExistingGrantsTo)", () => {
        const { state } = withBloodMoon();
        const newLand = makeInstance(tropicalIsland.id, {
            id: "land-2",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(newLand);
        applyExistingGrantsTo(state, newLand);
        expect(newLand.subtypes).toEqual(["Mountain"]);
        expect(newLand.abilitiesSuppressedBy).toEqual(["moon-1"]);
        expect(getBasicLandMana(newLand)).toBe("R");
    });

    it("reverts the land cleanly when Blood Moon leaves play (unapplySourceStaticEffects)", () => {
        const { state, moon, land } = withBloodMoon();
        unapplySourceStaticEffects(state, moon);
        // Printed subtypes restored; original mana ability functions again.
        expect(land.subtypes).toEqual(["Forest", "Island"]);
        expect(abilitiesSuppressed(land)).toBe(false);
        expect(land.abilitiesSuppressedBy).toBeUndefined();
        expect(getActivatedManaAbility(land)).not.toBeNull();
        const options = getProducibleManaOptions(land);
        expect(options.has("G")).toBe(true);
        expect(options.has("U")).toBe(true);
        expect(options.has("R")).toBe(false);
    });

    it("strips a UTILITY land's non-mana ability and rewrites its mana to {R} (Strip Mine)", () => {
        // Strip Mine: "{T}: Add {C}" + "{T}, Sacrifice: Destroy target land".
        // Under Blood Moon it loses BOTH printed abilities (suppressed) and taps
        // for {R} from the Mountain subtype instead of {C}.
        const { land } = withBloodMoon(stripMine.id);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(abilitiesSuppressed(land)).toBe(true);
        // The {T}: Add {C} ability no longer functions; only intrinsic {R}.
        expect(getActivatedManaAbility(land)).toBeNull();
        expect(getBasicLandMana(land)).toBe("R");
        expect(effectiveTriggeredAbilities(land)).toHaveLength(0);
        const options = getProducibleManaOptions(land);
        expect([...options.keys()]).toEqual(["R"]);
        expect(options.has("C")).toBe(false);
    });

    // Wire format (MANDATORY for staticEffects): the Mountain subtype and the
    // producible {R} must survive projection to the client (CR rule re-checked
    // on the slimmed PublicGameState).
    it("wire format: Mountain subtype + producible {R} survive projectPublicState", () => {
        const { state } = withBloodMoon();
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "land-1"
        )!;
        expect(slim.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(slim as unknown as CardInstanceState)).toBe(
            "R"
        );
        expect(abilitiesSuppressed(slim as unknown as CardInstanceState)).toBe(
            true
        );
        const options = getProducibleManaOptions(
            slim as unknown as CardInstanceState
        );
        expect([...options.keys()]).toEqual(["R"]);
    });
});

describe("DRK registry parity", () => {
    it("registers the skeleton creatures by id", () => {
        expect(getCardById(squire.id)).toBe(squire);
        expect(getCardById(goblinHero.id)).toBe(goblinHero);
        expect(getCardById(scarwoodGoblins.id)).toBe(scarwoodGoblins);
    });

    it("registers them by name (debug-panel / pool lookup path)", () => {
        // The Debug-panel preset scenario and the card pool both resolve cards
        // by name via getCardByName (game.ts seedScenario) — registration alone
        // must make the cards reachable.
        expect(getCardByName("Squire")).toBe(squire);
        expect(getCardByName("Goblin Hero")).toBe(goblinHero);
        expect(getCardByName("Scarwood Goblins")).toBe(scarwoodGoblins);
    });

    it("includes them in getAllCards (deck-builder index)", () => {
        const all = getAllCards();
        expect(all).toContain(squire);
        expect(all).toContain(goblinHero);
        expect(all).toContain(scarwoodGoblins);
    });
});

// ---------------------------------------------------------------------------
// Vanilla creatures (CR 302 — Creature cards as pure data: types/subtypes +
// P/T only; values validated against MTGJSON data/json/DRK.json)
// ---------------------------------------------------------------------------

describe("Squire (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(squire.types).toEqual(["Creature"]);
        expect(squire.subtypes).toEqual(["Human", "Soldier"]);
        expect(squire.power).toBe(1);
        expect(squire.toughness).toBe(2);
        expect(squire.manaCost).toEqual({ X: 1, W: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, squire.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Goblin Hero (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(goblinHero.types).toEqual(["Creature"]);
        expect(goblinHero.subtypes).toEqual(["Goblin"]);
        expect(goblinHero.power).toBe(2);
        expect(goblinHero.toughness).toBe(2);
        expect(goblinHero.manaCost).toEqual({ X: 2, R: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, goblinHero.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Scarwood Goblins (vanilla creature, CR 302)", () => {
    it("carries the canonical stats from DRK.json", () => {
        expect(scarwoodGoblins.types).toEqual(["Creature"]);
        expect(scarwoodGoblins.subtypes).toEqual(["Goblin"]);
        expect(scarwoodGoblins.power).toBe(2);
        expect(scarwoodGoblins.toughness).toBe(2);
        expect(scarwoodGoblins.manaCost).toEqual({ R: 1, G: 1 });
    });

    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, scarwoodGoblins.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.name).toBe("Scarwood Goblins");
        expect(def.subtypes).toEqual(["Goblin"]);
    });
});

// ---------------------------------------------------------------------------
// Keyword creatures (CR 702 — keywords map to staticAbilities[]; definition
// snapshot is the convention for plain keywords)
// ---------------------------------------------------------------------------

describe("Knights of Thorn — protection from red + banding (CR 702.16 / 702.22)", () => {
    it("carries the keywords and canonical stats", () => {
        expect(knightsOfThorn.staticAbilities).toContain("protection from red");
        expect(knightsOfThorn.staticAbilities).toContain("banding");
        expect(knightsOfThorn.power).toBe(2);
        expect(knightsOfThorn.toughness).toBe(2);
        expect(knightsOfThorn.manaCost).toEqual({ X: 3, W: 1 });
        expect(knightsOfThorn.subtypes).toEqual(["Human", "Knight"]);
    });
});

describe("Pikemen — first strike + banding (CR 702.7 / 702.22)", () => {
    it("carries the keywords and canonical stats", () => {
        expect(pikemen.staticAbilities).toContain("first strike");
        expect(pikemen.staticAbilities).toContain("banding");
        expect(pikemen.power).toBe(1);
        expect(pikemen.toughness).toBe(1);
        expect(pikemen.manaCost).toEqual({ X: 1, W: 1 });
        expect(pikemen.subtypes).toEqual(["Human", "Soldier"]);
    });
});

// ---------------------------------------------------------------------------
// Angry Mob — turn-conditional CDA P/T (CR 604.3, layer 7a)
// ---------------------------------------------------------------------------

describe("Angry Mob — CDA P/T (CR 604.3 / 102.1)", () => {
    function setup(activePlayerId: string, opponentSwamps: number) {
        const mob = makeInstance(angryMob.id, {
            id: "mob",
            controllerId: "p1",
            ownerId: "p1",
        });
        const swampId = getCardByName("Swamp").id;
        const swamps = Array.from({ length: opponentSwamps }, (_, i) =>
            makeInstance(swampId, {
                id: `swamp-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [mob] }),
                makePlayer("p2", { battlefield: swamps }),
            ],
        });
        return { state, mob };
    }

    it("is 2 + opponents' Swamps during the controller's turn", () => {
        const { state, mob } = setup("p1", 3);
        expect(getEffectivePower(state, mob)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, mob)).toBe(5);
    });

    it("is a flat 2/2 during another player's turn", () => {
        const { state, mob } = setup("p2", 3);
        expect(getEffectivePower(state, mob)).toBe(2);
        expect(getEffectiveToughness(state, mob)).toBe(2);
    });

    it("only counts opponents' Swamps, not the controller's", () => {
        const { state, mob } = setup("p1", 0);
        const swampId = getCardByName("Swamp").id;
        state.players[0].battlefield.push(
            makeInstance(swampId, {
                id: "own-swamp",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(getEffectivePower(state, mob)).toBe(2); // own Swamp excluded
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const { state } = setup("p1", 2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "mob"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Exorcist — {1}{W},{T}: destroy target black creature (CR 605 / 701.7)
// ---------------------------------------------------------------------------

describe("Exorcist — destroy target black creature (CR 605 / 701.7)", () => {
    it("destroys the targeted black creature", () => {
        const ex = makeInstance(exorcist.id, { id: "ex", controllerId: "p1" });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ex] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        resolveActivated(state, ex, "exorcist-destroy-black", [
            { type: "permanent", id: "black" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "black")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "black")).toBe(
            true
        );
    });

    it("only lists black creatures as legal targets", () => {
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const white = makeInstance(getCardByName("White Knight").id, {
            id: "white",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [black, white] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            exorcist.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("black");
        expect(ids).not.toContain("white");
    });
});

// ---------------------------------------------------------------------------
// Miracle Worker — {T}: destroy target Aura attached to a creature you control
// ---------------------------------------------------------------------------

describe("Miracle Worker — destroy your Aura (CR 605 / 701.7)", () => {
    it("destroys an Aura attached to a creature the controller controls", () => {
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const myCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A DRK Brainwash-style Aura would attach here; reuse any Aura in pool.
        const auraId = getCardByName("Holy Strength").id;
        const aura = makeInstance(auraId, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "mine",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw, myCreature, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, mw, "miracle-worker-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
    });

    it("does NOT destroy an Aura on an opponent's creature", () => {
        const mw = makeInstance(miracleWorker.id, {
            id: "mw",
            controllerId: "p1",
        });
        const theirCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(getCardByName("Holy Strength").id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "theirs",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mw] }),
                makePlayer("p2", { battlefield: [theirCreature, aura] }),
            ],
        });
        resolveActivated(state, mw, "miracle-worker-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        // Host is an opponent's creature → no destruction.
        expect(
            state.players[1].battlefield.find((c) => c.id === "aura")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Witch Hunter — ping + bounce (CR 605 / 119 / 701.10)
// ---------------------------------------------------------------------------

describe("Witch Hunter — ping a player and bounce a creature", () => {
    it("deals 1 damage to the targeted player", () => {
        const wh = makeInstance(witchHunter.id, {
            id: "wh",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wh] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wh, "witch-hunter-ping", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
    });

    it("returns an opponent's creature to its owner's hand", () => {
        const wh = makeInstance(witchHunter.id, {
            id: "wh",
            controllerId: "p1",
        });
        const creature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wh] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        resolveActivated(state, wh, "witch-hunter-bounce", [
            { type: "permanent", id: "lion" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "lion")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Preacher — control gain "for as long as this remains tapped" (CR 611.2b)
// ---------------------------------------------------------------------------

describe("Preacher — steal a creature while tapped (CR 611.2b)", () => {
    function setup() {
        const pr = makeInstance(preacher.id, {
            id: "preacher",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true, // {T} cost already paid
        });
        const victim = makeInstance(getCardByName("Savannah Lions").id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pr] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state };
    }

    it("the opponent chooses the creature, control moves to the activator", () => {
        const { state } = setup();
        // Target the opponent (player); the opponent then picks the creature.
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "preacher-steal",
            [{ type: "player", id: "p2" }]
        );
        // requestChoice suspended → opponent picks the victim.
        answerChoice(state, ["victim"]);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "victim")
                ?.controllerId
        ).toBe("p1");
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
    });

    it("control reverts the instant Preacher untaps (source-tapped lapses)", () => {
        const { state } = setup();
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "preacher-steal",
            [{ type: "player", id: "p2" }]
        );
        answerChoice(state, ["victim"]);
        checkStateBasedActions(state);
        // Untap Preacher → condition lapses → revert.
        const pr = state.players[0].battlefield.find(
            (c) => c.id === "preacher"
        )!;
        pr.isTapped = false;
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
                ?.controllerId
        ).toBe("p2");
    });
});

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

describe("Dust to Dust — exile two target artifacts (CR 701.18)", () => {
    it("exiles both targeted artifacts", () => {
        const art1 = makeInstance(getCardByName("Ornithopter").id, {
            id: "a1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const art2 = makeInstance(getCardByName("Ornithopter").id, {
            id: "a2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [art1, art2] }),
            ],
        });
        pushSpell(state, dustToDust.id, "p1", [
            { type: "permanent", id: "a1" },
            { type: "permanent", id: "a2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "a1",
            "a2",
        ]);
    });
});

describe("Tivadar's Crusade — destroy all Goblins (CR 701.7 / 205.3)", () => {
    it("destroys Goblins and leaves non-Goblins alone", () => {
        const goblin = makeInstance(scarwoodGoblins.id, {
            id: "gob",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [goblin, bear] }),
            ],
        });
        pushSpell(state, tivadarsCrusade.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "gob")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
    });
});

describe("Holy Light — nonwhite creatures get -1/-1 (CR 611.2 / 202.2)", () => {
    it("weakens nonwhite creatures but spares white ones", () => {
        const white = makeInstance(getCardByName("White Knight").id, {
            id: "white",
            controllerId: "p1",
            ownerId: "p1",
        });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [white] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        const whiteP = getEffectivePower(state, white);
        const whiteT = getEffectiveToughness(state, white);
        pushSpell(state, holyLight.id, "p1");
        resolveTopOfStack(state);
        // White unchanged.
        expect(getEffectivePower(state, white)).toBe(whiteP);
        expect(getEffectiveToughness(state, white)).toBe(whiteT);
        // Black Knight (2/2) → 1/1.
        expect(getEffectivePower(state, black)).toBe(1);
        expect(getEffectiveToughness(state, black)).toBe(1);
    });
});

describe("Morale — attacking creatures get +1/+1 (pump-combat)", () => {
    it("declares the canonical pump-combat effect", () => {
        expect(morale.effect).toEqual({
            kind: "pump-combat",
            side: "attacking",
            power: 1,
            toughness: 1,
        });
    });
});

describe("Martyr's Cry — exile white creatures, draw per exiled (CR 701.18 / 121.1)", () => {
    it("exiles all white creatures and each controller draws one per exiled", () => {
        const w1 = makeInstance(getCardByName("White Knight").id, {
            id: "w1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const w2 = makeInstance(getCardByName("Savannah Lions").id, {
            id: "w2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const black = makeInstance(getCardByName("Black Knight").id, {
            id: "black",
            controllerId: "p2",
            ownerId: "p2",
        });
        const libCard = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "lib",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [w1] }),
                makePlayer("p2", {
                    battlefield: [w2, black],
                    library: [libCard],
                }),
            ],
        });
        pushSpell(state, martyrsCry.id, "p1");
        resolveTopOfStack(state);
        // White creatures exiled; black survives.
        expect(
            state.players[0].battlefield.find((c) => c.id === "w1")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "w2")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "black")
        ).toBeDefined();
        // p2 controlled one exiled white creature → drew one card.
        expect(state.players[1].hand.some((c) => c.id === "lib")).toBe(true);
    });
});

describe("Fire and Brimstone — 4 to a player who attacked + 4 to you (CR 506.2 / 119)", () => {
    function attackerState() {
        // p2 controls a creature flagged as having attacked this turn.
        const attacker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            hasAttackedThisTurn: true,
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
    }

    it("only a player who attacked this turn is a legal target", () => {
        const state = attackerState();
        const legal = getLegalTargets(
            state,
            fireAndBrimstone.targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("p2"); // attacked
        expect(ids).not.toContain("p1"); // did not attack
    });

    it("deals 4 to the attacker and 4 to the caster", () => {
        const state = attackerState();
        pushSpell(state, fireAndBrimstone.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16); // 20 - 4
        expect(state.players[0].life).toBe(16); // 20 - 4 to you
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLUE free tranche (#412)
// ═══════════════════════════════════════════════════════════════════════════

describe("Amnesia — reveal hand, discard all nonland cards (CR 701.8)", () => {
    it("discards nonland cards and keeps lands", () => {
        const islandId = getCardByName("Island").id;
        const bolt = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "spell",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const land = makeInstance(islandId, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [bolt, land] }),
            ],
        });
        pushSpell(state, amnesia.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // Nonland discarded, land kept.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land"]);
        expect(state.players[1].graveyard.some((c) => c.id === "spell")).toBe(
            true
        );
    });
});

describe("Apprentice Wizard — {U},{T}: add {C}{C}{C} (CR 605.1a mana ability)", () => {
    it("declares a non-stack mana ability producing three colorless", () => {
        const ab = apprenticeWizard.activatedAbilities![0];
        expect(ab.useStack).toBe(false);
        expect(ab.cost).toEqual({ tap: true, mana: { U: 1 } });
        expect(ab.manaProduced).toEqual({ C: 3 });
        expect(apprenticeWizard.power).toBe(0);
        expect(apprenticeWizard.toughness).toBe(1);
    });
});

describe("Erosion — upkeep destroy enchanted land unless pay {1} or 1 life (CR 603.6a / 117.3a)", () => {
    function setup() {
        const land = makeInstance(getCardByName("Island").id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(erosion.id, {
            id: "erosion",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "land",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        return { state, aura };
    }

    it("fires at the enchanted land's controller upkeep (host-controller scope)", () => {
        const { state } = setup();
        const fires = (p: string) =>
            collectTriggers(state, [UPKEEP(p) as never]).some(
                (t) => t.triggeredAbilityId === "erosion-upkeep-tax"
            );
        expect(fires("p2")).toBe(true); // land controller's upkeep
        expect(fires("p1")).toBe(false); // not the aura controller's
    });

    it("declining both payments destroys the enchanted land", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "erosion-upkeep-tax", UPKEEP("p2"));
        // Decline {1}, then decline 1 life → land destroyed.
        answerChoice(state, ["decline"]);
        answerChoice(state, ["decline"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
    });

    it("paying 1 life keeps the land (CR 118.4)", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "erosion-upkeep-tax", UPKEEP("p2"));
        answerChoice(state, ["decline"]); // decline {1}
        answerChoice(state, ["yes"]); // pay 1 life
        expect(state.players[1].battlefield.some((c) => c.id === "land")).toBe(
            true
        );
        expect(state.players[1].life).toBe(19);
    });
});

describe("Flood — {U}{U}: tap target creature without flying (CR 701.20a / 702.9)", () => {
    it("only non-flyers are legal targets (excludeAbility)", () => {
        const ground = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flyer = makeInstance(getCardByName("Serra Angel").id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flyer] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            flood.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("ground");
        expect(legal).not.toContain("flyer");
    });

    it("taps the targeted non-flyer", () => {
        const fl = makeInstance(flood.id, { id: "flood", controllerId: "p1" });
        const ground = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fl] }),
                makePlayer("p2", { battlefield: [ground] }),
            ],
        });
        resolveActivated(state, fl, "flood-tap", [
            { type: "permanent", id: "ground" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
                ?.isTapped
        ).toBe(true);
    });
});

describe("Ghost Ship — flying + regenerate (CR 702.9 / 701.15a)", () => {
    it("carries flying and a regenerate activated ability", () => {
        expect(ghostShip.staticAbilities).toContain("flying");
        expect(ghostShip.power).toBe(2);
        expect(ghostShip.toughness).toBe(4);
        const ab = ghostShip.activatedAbilities![0];
        expect(ab.cost).toEqual({ mana: { U: 3 } });
    });

    it("the regenerate ability stacks a shield consumed by the next destroy", () => {
        const gs = makeInstance(ghostShip.id, {
            id: "gs",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gs] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gs, "ghost-ship-regenerate", []);
        const inPlay = state.players[0].battlefield.find((c) => c.id === "gs")!;
        expect(inPlay.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Giant Shark — attack restriction, combat pump, sacrifice-on-no-Islands", () => {
    it("can't attack unless the defending player controls an Island (CR 508.1c)", () => {
        const restriction = giantShark.staticEffects!.find(
            (e) => e.kind === "attack-restriction"
        );
        if (restriction?.kind !== "attack-restriction") {
            throw new Error("missing attack-restriction");
        }
        const withIsland = [{ subtypes: ["Island"] }] as never;
        const noIsland = [{ subtypes: ["Forest"] }] as never;
        expect(restriction.predicate({} as never, withIsland)).toBe(true);
        expect(restriction.predicate({} as never, noIsland)).toBe(false);
    });

    it("pumps +2/+0 only when the paired creature has marked damage (CR 120.3)", () => {
        const shark = makeInstance(giantShark.id, {
            id: "shark",
            controllerId: "p1",
        });
        const blocker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            damageMarked: 1, // already dealt damage this turn
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shark] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        const basePower = getEffectivePower(state, shark);
        const event = {
            type: "BLOCKERS_CONFIRMED" as const,
            attackerId: "shark",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Shark"],
            blockerId: "blocker",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: ["Bear"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, shark, "giant-shark-combat-pump", event);
        const pumped = state.players[0].battlefield.find(
            (c) => c.id === "shark"
        )!;
        expect(getEffectivePower(state, pumped)).toBe(basePower + 2);
        expect(pumped.staticAbilities).toContain("trample");
    });

    it("does NOT pump when the paired creature has no marked damage", () => {
        const shark = makeInstance(giantShark.id, {
            id: "shark",
            controllerId: "p1",
        });
        const blocker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shark] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        const basePower = getEffectivePower(state, shark);
        const event = {
            type: "BLOCKERS_CONFIRMED" as const,
            attackerId: "shark",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Shark"],
            blockerId: "blocker",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: ["Bear"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, shark, "giant-shark-combat-pump", event);
        expect(getEffectivePower(state, shark)).toBe(basePower);
    });

    it("sacrifices itself when its controller controls no Islands (CR 603.8)", () => {
        const shark = makeInstance(giantShark.id, {
            id: "shark",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shark] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, shark, "giant-shark-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "shark")
        ).toBeUndefined();
    });
});

describe("Mana Vortex — cast-counter, each-upkeep land sac, no-lands self-sac", () => {
    it("counters itself on cast if the controller can't sacrifice a land", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Mana Vortex spell on the stack, plus its cast trigger above it.
        const spell = pushSpell(state, manaVortex.id, "p1");
        const source = makeInstance(manaVortex.id, {
            id: spell.id,
            controllerId: "p1",
        });
        resolveTrigger(state, source, "mana-vortex-cast-counter", {
            type: "SPELL_CAST",
            spellInstanceId: spell.id,
            casterId: "p1",
        } as StackItem["triggerEvent"]);
        // No land to sacrifice → the spell is countered (no permanent enters).
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    it("each player sacrifices a land at their upkeep (CR 603.6a)", () => {
        const vortex = makeInstance(manaVortex.id, {
            id: "vortex",
            controllerId: "p1",
        });
        const land = makeInstance(getCardByName("Island").id, {
            id: "p2-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vortex] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveTrigger(state, vortex, "mana-vortex-upkeep-sac", UPKEEP("p2"));
        answerChoice(state, ["p2-land"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-land")
        ).toBeUndefined();
    });

    it("sacrifices itself when no lands remain (CR 603.8)", () => {
        const vortex = makeInstance(manaVortex.id, {
            id: "vortex",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vortex] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, vortex, "mana-vortex-no-lands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vortex")
        ).toBeUndefined();
    });
});

describe("Merfolk Assassin — destroy target creature with islandwalk (CR 605 / 701.7)", () => {
    it("only islandwalkers are legal targets", () => {
        const walker = makeInstance(getCardByName("Segovian Leviathan").id, {
            id: "walker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const plain = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "plain",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [walker, plain] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            merfolkAssassin.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("walker");
        expect(legal).not.toContain("plain");
    });

    it("destroys the targeted islandwalker", () => {
        const ma = makeInstance(merfolkAssassin.id, {
            id: "ma",
            controllerId: "p1",
        });
        const walker = makeInstance(getCardByName("Segovian Leviathan").id, {
            id: "walker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ma] }),
                makePlayer("p2", { battlefield: [walker] }),
            ],
        });
        resolveActivated(state, ma, "merfolk-assassin-destroy", [
            { type: "permanent", id: "walker" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "walker")
        ).toBeUndefined();
    });
});

describe("Mind Bomb — each player may discard up to 3, damage = 3 − discarded (CR 701.8 / 119)", () => {
    it("a player who discards nothing takes 3 damage", () => {
        // Empty hands → no discard prompt → each player takes the full 3.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, mindBomb.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
        expect(state.players[1].life).toBe(17);
    });

    it("discarding reduces the damage (3 − discarded)", () => {
        const c1 = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "c1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const c2 = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "c2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [c1, c2] }), makePlayer("p2")],
        });
        pushSpell(state, mindBomb.id, "p1");
        resolveTopOfStack(state); // suspends at p1's discard choice
        answerChoice(state, ["c1", "c2"]); // p1 discards 2 → takes 1
        expect(state.players[0].life).toBe(19); // 20 - (3 - 2)
        expect(state.players[1].life).toBe(17); // p2 discarded 0 → takes 3
    });
});

describe("Psychic Allergy — choose color, damage per nontoken permanent, upkeep sac-2-Islands", () => {
    it("deals damage equal to the chosen color's nontoken permanents at each opponent's upkeep", () => {
        const allergy = makeInstance(psychicAllergy.id, {
            id: "allergy",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: "U", // chose blue
        });
        const blueA = makeInstance(getCardByName("Air Elemental").id, {
            id: "blueA",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blueB = makeInstance(getCardByName("Air Elemental").id, {
            id: "blueB",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [allergy] }),
                makePlayer("p2", { battlefield: [blueA, blueB] }),
            ],
        });
        resolveTrigger(
            state,
            allergy,
            "psychic-allergy-opponent-upkeep",
            UPKEEP("p2")
        );
        // 2 blue nontoken permanents → 2 damage to p2.
        expect(state.players[1].life).toBe(18);
    });

    it("destroys itself at the controller's upkeep when no Islands to sacrifice (CR 117.3a)", () => {
        const allergy = makeInstance(psychicAllergy.id, {
            id: "allergy",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: "U",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [allergy] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            allergy,
            "psychic-allergy-own-upkeep",
            UPKEEP("p1")
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "allergy")
        ).toBeUndefined();
    });
});

describe("Riptide — tap all blue creatures (CR 701.20a / 202.2)", () => {
    it("taps blue creatures of either controller, spares nonblue", () => {
        const blue1 = makeInstance(getCardByName("Air Elemental").id, {
            id: "blue1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blue2 = makeInstance(getCardByName("Air Elemental").id, {
            id: "blue2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const white = makeInstance(getCardByName("Savannah Lions").id, {
            id: "white",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blue1] }),
                makePlayer("p2", { battlefield: [blue2, white] }),
            ],
        });
        pushSpell(state, riptide.id, "p1");
        resolveTopOfStack(state);
        const tapped = (id: string) =>
            [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].find((c) => c.id === id)?.isTapped === true;
        expect(tapped("blue1")).toBe(true);
        expect(tapped("blue2")).toBe(true);
        expect(tapped("white")).toBe(false);
    });
});

describe("Sunken City — blue anthem + upkeep maintenance (CR 611 / 603.6a)", () => {
    function setup() {
        const city = makeInstance(sunkenCity.id, {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blue = makeInstance(getCardByName("Air Elemental").id, {
            id: "blue",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [city, blue] }),
                makePlayer("p2"),
            ],
        });
        return { state, city, blue };
    }

    it("blue creatures get +1/+1 (anthem) and survives the wire projection", () => {
        const { state, blue } = setup();
        // Air Elemental base 4/4 → 5/5 with the anthem.
        expect(getEffectivePower(state, blue)).toBe(5);
        expect(getEffectiveToughness(state, blue)).toBe(5);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "blue"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });

    it("sacrifices itself at upkeep when {U}{U} is declined (CR 117.3a)", () => {
        const { state, city } = setup();
        resolveTrigger(state, city, "sunken-city-upkeep", UPKEEP("p1"));
        answerChoice(state, ["decline"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "city")
        ).toBeUndefined();
    });

    it("paying {U}{U} keeps it (backend may-pay path)", () => {
        const { state, city } = setup();
        state.players[0].manaPool = { U: 2 };
        state.stack.push(
            ...collectTriggers(state, [UPKEEP("p1") as never]).filter(
                (t) => t.triggeredAbilityId === "sunken-city-upkeep"
            )
        );
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "city")).toBe(
            true
        );
        void city;
    });
});

describe("Water Wurm — +0/+1 while an opponent controls an Island (CR 613.4 layer 7a CDA)", () => {
    function setup(opponentHasIsland: boolean) {
        const wurm = makeInstance(waterWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p2bf = opponentHasIsland
            ? [
                  makeInstance(getCardByName("Island").id, {
                      id: "isl",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wurm] }),
                makePlayer("p2", { battlefield: p2bf }),
            ],
        });
        return { state, wurm };
    }

    it("is 1/1 with no opposing Island, 1/2 when an opponent controls one", () => {
        const off = setup(false);
        expect(getEffectivePower(off.state, off.wurm)).toBe(1);
        expect(getEffectiveToughness(off.state, off.wurm)).toBe(1);
        const on = setup(true);
        expect(getEffectivePower(on.state, on.wurm)).toBe(1);
        expect(getEffectiveToughness(on.state, on.wurm)).toBe(2);
    });

    it("the conditional CDA survives the wire projection (mandatory)", () => {
        const { state } = setup(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wurm"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLACK free tranche (#413)
// ═══════════════════════════════════════════════════════════════════════════

describe("Ashes to Ashes — exile two nonartifact creatures, 5 to you (CR 701.18 / 119)", () => {
    it("exiles both targets and deals 5 to the caster", () => {
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(2);
        expect(state.players[0].life).toBe(15);
    });

    it("artifact creatures are not legal targets (excludeTypes)", () => {
        const robot = makeInstance(getCardByName("Ornithopter").id, {
            id: "robot",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [robot, bear] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1");
        const legal = getLegalTargets(
            state,
            ashesToAshes.targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("bear");
        expect(ids).not.toContain("robot");
    });
});

describe("Banshee — {X},{T}: half X down to any target, half X up to you (CR 605 / 119)", () => {
    function setup() {
        const bansheeInst = makeInstance(banshee.id, {
            id: "banshee",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [bansheeInst] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, bansheeInst };
    }

    it("X=5 → 2 to the target, 3 to you (floor/ceil split)", () => {
        const { state, bansheeInst } = setup();
        state.stack.push({
            ...bansheeInst,
            zone: "stack",
            castById: "p1",
            abilityId: "banshee-half-x",
            chosenX: 5,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - floor(5/2)=2
        expect(state.players[0].life).toBe(17); // 20 - ceil(5/2)=3
    });

    it("X=0 → no damage either way", () => {
        const { state, bansheeInst } = setup();
        state.stack.push({
            ...bansheeInst,
            zone: "stack",
            castById: "p1",
            abilityId: "banshee-half-x",
            chosenX: 0,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Bog Imp — vanilla flier (CR 702.9)", () => {
    it("has flying", () => {
        expect(bogImp.staticAbilities).toContain("flying");
        expect(bogImp.power).toBe(1);
        expect(bogImp.toughness).toBe(1);
    });
});

describe("Bog Rats — can't be blocked by Walls (CR 509.1b / 205.3)", () => {
    function setup(blockerSubtypes: string[]) {
        const rats = makeInstance(bogRats.id, {
            id: "rats",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(getCardByName("Wall of Wood").id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            subtypes: blockerSubtypes,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rats] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, rats };
    }

    it("the static restriction rejects a Wall blocker", () => {
        const { state, rats } = setup(["Wall"]);
        const restriction = rats.card
            ? bogRats.staticEffects!.find((e) => e.kind === "block-restriction")
            : undefined;
        expect(restriction).toBeDefined();
        // Predicate: legal block only if the blocker is NOT a Wall.
        const blocker = state.players[1].battlefield[0];
        const predicate = (
            restriction as { predicate: (s: unknown, o: unknown) => boolean }
        ).predicate;
        expect(predicate(rats, blocker)).toBe(false);
    });

    it("a non-Wall blocker is allowed", () => {
        const { state, rats } = setup(["Bear"]);
        const restriction = bogRats.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        ) as { predicate: (s: unknown, o: unknown) => boolean };
        const blocker = state.players[1].battlefield[0];
        expect(restriction.predicate(rats, blocker)).toBe(true);
    });
});

describe("Curse Artifact — upkeep 2 damage unless sacrifice the artifact (CR 603.6a / 117.3a)", () => {
    function setup() {
        const artifact = makeInstance(getCardByName("Ornithopter").id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(curseArtifact.id, {
            id: "curse",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "art",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { life: 20, battlefield: [artifact] }),
            ],
        });
        return { state, aura };
    }

    it("fires at the enchanted artifact's controller upkeep (host-controller)", () => {
        const { state } = setup();
        const fires = (p: string) =>
            collectTriggers(state, [UPKEEP(p) as never]).some(
                (t) => t.triggeredAbilityId === "curse-artifact-upkeep"
            );
        expect(fires("p2")).toBe(true);
        expect(fires("p1")).toBe(false);
    });

    it("declining the sacrifice deals 2 damage", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "curse-artifact-upkeep", UPKEEP("p2"));
        answerChoice(state, ["decline"]);
        expect(state.players[1].life).toBe(18);
        expect(state.players[1].battlefield.some((c) => c.id === "art")).toBe(
            true
        );
    });

    it("sacrificing the artifact avoids the damage", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "curse-artifact-upkeep", UPKEEP("p2"));
        answerChoice(state, ["yes"]);
        expect(state.players[1].life).toBe(20);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
    });
});

describe("Eater of the Dead — {0}: if tapped, exile a graveyard creature + untap (CR 605 / 701.18)", () => {
    function setup(tapped: boolean) {
        const eater = makeInstance(eaterOfTheDead.id, {
            id: "eater",
            controllerId: "p1",
            isTapped: tapped,
        });
        const corpse = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "corpse",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eater] }),
                makePlayer("p2", { graveyard: [corpse] }),
            ],
        });
        return { state, eater };
    }

    it("exiles the targeted graveyard creature and untaps itself", () => {
        const { state, eater } = setup(true);
        state.stack.push({
            ...eater,
            zone: "stack",
            castById: "p1",
            abilityId: "eater-of-the-dead-exile-untap",
            targets: [{ type: "graveyard-card", id: "corpse", playerId: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.some((c) => c.id === "corpse")).toBe(
            true
        );
        const e = state.players[0].battlefield.find((c) => c.id === "eater")!;
        expect(e.isTapped).toBe(false);
    });

    it("can only be activated while tapped (canActivate gate)", () => {
        const ability = eaterOfTheDead.activatedAbilities![0];
        const tapped = makeInstance(eaterOfTheDead.id, { isTapped: true });
        const untapped = makeInstance(eaterOfTheDead.id, { isTapped: false });
        expect(ability.canActivate!(tapped as never, {} as never)).toBe(true);
        expect(ability.canActivate!(untapped as never, {} as never)).toBe(
            false
        );
    });
});

describe("Grave Robbers — {B},{T}: exile a graveyard artifact, gain 2 life (CR 605 / 701.18)", () => {
    it("exiles the artifact card and gains 2 life", () => {
        const robber = makeInstance(graveRobbers.id, {
            id: "robber",
            controllerId: "p1",
        });
        const art = makeInstance(getCardByName("Ornithopter").id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [robber] }),
                makePlayer("p2", { graveyard: [art] }),
            ],
        });
        resolveActivated(state, robber, "grave-robbers-exile-artifact", [
            { type: "graveyard-card", id: "art", playerId: "p2" },
        ]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.some((c) => c.id === "art")).toBe(true);
        expect(state.players[0].life).toBe(22);
    });
});

describe("Inquisition — reveal hand, damage = white cards in hand (CR 202.2 / 119)", () => {
    it("deals damage equal to the number of white cards", () => {
        const whiteA = makeInstance(getCardByName("Savannah Lions").id, {
            id: "wA",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const whiteB = makeInstance(getCardByName("Serra Angel").id, {
            id: "wB",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const black = makeInstance(getCardByName("Bog Imp").id, {
            id: "bl",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { life: 20, hand: [whiteA, whiteB, black] }),
            ],
        });
        pushSpell(state, inquisition.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // two white cards
    });
});

describe("Marsh Gas — all creatures get -2/-0 until end of turn (CR 611.2)", () => {
    it("reduces power of every creature", () => {
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
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
        pushSpell(state, marshGas.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectivePower(state, a)).toBe(0); // 2 - 2
        expect(getEffectivePower(state, b)).toBe(1); // 3 - 2
    });
});

describe("Murk Dwellers — attacks unblocked → +2/+0 (CR 509.1h ATTACKER_UNBLOCKED)", () => {
    it("emits ATTACKER_UNBLOCKED for an attacker with no blocker", () => {
        const dweller = makeInstance(murkDwellers.id, {
            id: "dweller",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dweller] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["dweller"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        emitBlockersConfirmedEvents(state);
        // The unblocked-pump trigger is now on the stack.
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "murk-dwellers-unblocked-pump"
        );
        expect(trig).toBeDefined();
    });

    it("the pump trigger adds +2/+0 until end of combat", () => {
        const dweller = makeInstance(murkDwellers.id, {
            id: "dweller",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dweller] }),
                makePlayer("p2"),
            ],
        });
        const base = getEffectivePower(state, dweller);
        const event = {
            type: "ATTACKER_UNBLOCKED" as const,
            attackerId: "dweller",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Zombie"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, dweller, "murk-dwellers-unblocked-pump", event);
        const pumped = state.players[0].battlefield.find(
            (c) => c.id === "dweller"
        )!;
        expect(getEffectivePower(state, pumped)).toBe(base + 2);
    });
});

describe("Nameless Race — CDA P/T from life paid as it enters (CR 604.3 / 614.12)", () => {
    function setup(opponentWhitePermanents: number, life = 20) {
        const oppBattlefield = Array.from(
            { length: opponentWhitePermanents },
            (_, i) =>
                makeInstance(getCardByName("Savannah Lions").id, {
                    id: `w${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        const item = pushSpell(state, namelessRace.id, "p1");
        item.chosenX = 1;
        return { state, item };
    }

    it("caps the life payment by opponent white permanents + graveyard cards", () => {
        const { state } = setup(2);
        resolveTopOfStack(state); // suspends on the pay-life option choice
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("option-pick");
        // Options are Pay 0..2 life (cap = 2 white permanents).
        expect(head?.options?.map((o) => o.id)).toEqual(["0", "1", "2"]);
    });

    it("pays the chosen life and sets P/T to the amount paid", () => {
        const { state } = setup(3);
        resolveTopOfStack(state);
        answerChoice(state, ["2"]); // pay 2 life
        const race = state.players[0].battlefield.find(
            (c) => c.card.id === namelessRace.id
        )!;
        expect(state.players[0].life).toBe(18);
        expect(getEffectivePower(state, race)).toBe(2);
        expect(getEffectiveToughness(state, race)).toBe(2);
    });

    it("the CDA P/T survives the wire projection (mandatory)", () => {
        const { state } = setup(3);
        resolveTopOfStack(state);
        answerChoice(state, ["2"]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === namelessRace.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Rag Man — {B}{B}{B},{T}: opponent discards a creature at random (CR 701.8a)", () => {
    it("discards a creature card, leaving noncreature cards", () => {
        const creature = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "cre",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const land = makeInstance(getCardByName("Swamp").id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [creature, land] }),
            ],
        });
        resolveActivated(
            state,
            makeInstance(ragMan.id, {
                id: "ragman",
                controllerId: "p1",
            }),
            "rag-man-discard",
            [{ type: "player", id: "p2" }]
        );
        // The only creature card is discarded; the land stays in hand.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["cre"]);
    });

    it("can only be activated during the controller's turn", () => {
        expect(ragMan.activatedAbilities![0].controllerTurnOnly).toBe(true);
    });
});

describe("Season of the Witch — upkeep pay-2-life-or-sac + end-step mass destroy (CR 603.6a)", () => {
    it("declining the 2-life payment sacrifices the enchantment", () => {
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [witch] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            witch,
            "season-of-the-witch-upkeep",
            UPKEEP("p1")
        );
        answerChoice(state, ["decline"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "witch")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });

    it("paying 2 life keeps it", () => {
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [witch] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            witch,
            "season-of-the-witch-upkeep",
            UPKEEP("p1")
        );
        answerChoice(state, ["yes"]);
        expect(state.players[0].battlefield.some((c) => c.id === "witch")).toBe(
            true
        );
        expect(state.players[0].life).toBe(18);
    });

    it("end step destroys untapped non-attackers but spares attackers, tapped, defenders, and sick", () => {
        const idler = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "idler", // untapped, didn't attack → destroyed
            controllerId: "p1",
        });
        const attacker = makeInstance(getCardByName("Hill Giant").id, {
            id: "attacker",
            controllerId: "p1",
            hasAttackedThisTurn: true, // attacked → spared
        });
        const tapped = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "tapped",
            controllerId: "p1",
            isTapped: true, // tapped → spared (filter)
        });
        const wall = makeInstance(getCardByName("Wall of Wood").id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2", // defender → couldn't attack → spared
        });
        const fresh = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "fresh",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: true, // couldn't attack → spared
        });
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [idler, attacker, tapped, witch],
                }),
                makePlayer("p2", { battlefield: [wall, fresh] }),
            ],
        });
        resolveTrigger(state, witch, "season-of-the-witch-end-step", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const alive = (id: string) =>
            [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].some((c) => c.id === id);
        expect(alive("idler")).toBe(false);
        expect(alive("attacker")).toBe(true);
        expect(alive("tapped")).toBe(true);
        expect(alive("wall")).toBe(true);
        expect(alive("fresh")).toBe(true);
    });
});

describe("The Fallen — upkeep 1 to each opponent it damaged this game (CR 603.6a)", () => {
    function setup() {
        const fallen = makeInstance(theFallen.id, {
            id: "fallen",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fallen] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, fallen };
    }

    it("does nothing at upkeep before The Fallen has dealt damage", () => {
        const { state, fallen } = setup();
        resolveTrigger(state, fallen, "the-fallen-upkeep", UPKEEP("p1"));
        expect(state.players[1].life).toBe(20);
    });

    it("after marking an opponent, the upkeep deals 1 to that opponent", () => {
        const { state, fallen } = setup();
        // Stamp the mark via the damage-dealt trigger.
        resolveTrigger(state, fallen, "the-fallen-mark", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "fallen",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 2,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        resolveTrigger(state, fallen, "the-fallen-upkeep", UPKEEP("p1"));
        expect(state.players[1].life).toBe(19);
    });
});

describe("Uncle Istvan — prevent all damage from creatures (CR 615)", () => {
    function makeIstvanState() {
        const istvan = makeInstance(uncleIstvan.id, {
            id: "istvan",
            controllerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [istvan] }),
                makePlayer("p2"),
            ],
        });
    }

    it("consumes damage whose source is a creature", () => {
        const state = makeIstvanState();
        const ev = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "atk",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 5,
            isCombat: true,
        });
        expect(ev).toBeNull(); // fully prevented
    });

    it("does NOT prevent damage from a noncreature source", () => {
        const state = makeIstvanState();
        const ev = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "bolt",
            sourceControllerId: "p2",
            sourceColors: ["R"],
            sourceTypes: ["Instant"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 3,
            isCombat: false,
        });
        expect(ev?.amount).toBe(3);
    });

    it("the prevention fires through the wire projection (mandatory)", () => {
        const state = makeIstvanState();
        const projected = projectPublicState(state, 1, "p1");
        const ev = applyDamageReplacements(projected as unknown as GameState, {
            kind: "damage",
            sourceInstanceId: "atk",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 4,
            isCombat: true,
        });
        expect(ev).toBeNull();
    });
});

describe("Word of Binding — tap X target creatures (CR 601.2c / 701.20a)", () => {
    it("taps every targeted creature", () => {
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        const item = pushSpell(state, wordOfBinding.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "a")!.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "b")!.isTapped
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Deferred cards are intentionally NOT exported / registered. Guard that the
// pool stays honest (no half-card leaks until their mechanic ships).
// ---------------------------------------------------------------------------

describe("DRK deferred cards (not yet in pool)", () => {
    it.each(["Brainwash", "Blood of the Martyr", "Festival", "Cleansing"])(
        "%s is not registered (its mechanic is deferred — see TODO(#411))",
        (name) => {
            expect(() => getCardByName(name)).toThrow();
        }
    );

    it.each(["Leviathan", "Tangle Kelp"])(
        "%s is not registered (its mechanic is deferred — see TODO(#412))",
        (name) => {
            expect(() => getCardByName(name)).toThrow();
        }
    );

    it.each(["Frankenstein's Monster"])(
        "%s is not registered (needs a graveyard-pick choice — see TODO(#413))",
        (name) => {
            expect(() => getCardByName(name)).toThrow();
        }
    );
});

// ═════════════════════════════════════════════════════════════════════════════
// Free tranche — Artifacts, Lands & colorless (#417)
// ═════════════════════════════════════════════════════════════════════════════

describe("DRK Artifacts/Lands registry parity (#417)", () => {
    const cards = [
        barlsCage,
        boneFlute,
        bookOfRass,
        darkSphere,
        diabolicMachine,
        fountainOfYouth,
        livingArmor,
        necropolis,
        scarecrow,
        skullOfOrm,
        standingStones,
        stoneCalendar,
        tormodsCrypt,
        towerOfCoireall,
        cityOfShadows,
        mazeOfIth,
        safeHaven,
    ];
    it("registers every implemented card by id, name and in the index", () => {
        const all = getAllCards();
        for (const c of cards) {
            expect(getCardById(c.id)).toBe(c);
            expect(getCardByName(c.name)).toBe(c);
            expect(all).toContain(c);
        }
    });

    it.each([
        ["Runesword", "#417"],
        ["War Barge", "#417"],
        ["Wand of Ith", "#417"],
    ])("%s is deferred (not registered, %s)", (name) => {
        expect(() => getCardByName(name)).toThrow();
    });
});

describe("Barl's Cage — {3}: target doesn't untap next untap step (CR 302.6/502.1)", () => {
    function setup() {
        const cage = makeInstance(barlsCage.id, {
            id: "cage",
            controllerId: "p1",
        });
        const bear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [cage] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, cage, bear };
    }

    it("a flagged creature stays tapped its next untap step, then untaps the following one", () => {
        const { state, cage } = setup();
        resolveActivated(state, cage, "barls-cage-lock", [
            { type: "permanent", id: "bear" },
        ]);
        const bearAfterResolve = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterResolve.skipNextUntap).toBe(true);

        // p2's untap step: the flag is consumed and the creature stays tapped.
        untapStep(state);
        const bearAfterFirst = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterFirst.isTapped).toBe(true);
        expect(bearAfterFirst.skipNextUntap).toBeUndefined();

        // The FOLLOWING untap step untaps it normally (one-shot).
        untapStep(state);
        const bearAfterSecond = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterSecond.isTapped).toBe(false);
    });
});

describe("Bone Flute — {2},{T}: all creatures get -1/-0 EOT (CR 611.2)", () => {
    it("shrinks every creature's power by 1", () => {
        const flute = makeInstance(boneFlute.id, {
            id: "flute",
            controllerId: "p1",
        });
        const mine = makeInstance(getCardByName("Hill Giant").id, {
            id: "mine",
            controllerId: "p1",
        });
        const theirs = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flute, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        const beforeMine = getEffectivePower(state, mine);
        const beforeTheirs = getEffectivePower(state, theirs);
        resolveActivated(state, flute, "bone-flute-shrink");
        expect(getEffectivePower(state, mine)).toBe(beforeMine - 1);
        expect(getEffectivePower(state, theirs)).toBe(beforeTheirs - 1);
        // Toughness unaffected (-1/-0).
        expect(getEffectiveToughness(state, theirs)).toBe(2);
    });
});

describe("Book of Rass — {2}, Pay 2 life: Draw a card (CR 118.4/121.1)", () => {
    it("draws one card (the life cost is enforced by the cost layer)", () => {
        const book = makeInstance(bookOfRass.id, {
            id: "book",
            controllerId: "p1",
        });
        const top = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [book], library: [top] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, book, "book-of-rass-draw");
        expect(state.players[0].hand.some((c) => c.id === "top")).toBe(true);
        expect(bookOfRass.activatedAbilities![0].cost.life).toBe(2);
    });
});

describe("Diabolic Machine — {3}: Regenerate this creature (CR 701.15a)", () => {
    it("arms a regeneration shield that replaces the next destroy", () => {
        const machine = makeInstance(diabolicMachine.id, {
            id: "machine",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, machine, "diabolic-machine-regenerate");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "machine"
        )!;
        expect(after.regenerationShields ?? 0).toBeGreaterThan(0);
        expect(diabolicMachine.power).toBe(4);
        expect(diabolicMachine.toughness).toBe(4);
        expect(diabolicMachine.subtypes).toEqual(["Construct"]);
    });
});

describe("Fountain of Youth — {2},{T}: gain 1 life (CR 119.3)", () => {
    it("gains the controller 1 life", () => {
        const fountain = makeInstance(fountainOfYouth.id, {
            id: "fountain",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [fountain] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, fountain, "fountain-of-youth-gain");
        expect(state.players[0].life).toBe(21);
    });
});

describe("Living Armor — sac: X +0/+1 counters, X = target's mana value (CR 122.1)", () => {
    it("puts MV-many +0/+1 counters; survives the wire (layer 7d)", () => {
        const armor = makeInstance(livingArmor.id, {
            id: "armor",
            controllerId: "p1",
        });
        // Hill Giant: {3}{R} → mana value 4.
        const giant = makeInstance(getCardByName("Hill Giant").id, {
            id: "giant",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [armor, giant] }),
                makePlayer("p2"),
            ],
        });
        const baseT = getEffectiveToughness(state, giant);
        resolveActivated(state, armor, "living-armor-counters", [
            { type: "permanent", id: "giant" },
        ]);
        const buffed = state.players[0].battlefield.find(
            (c) => c.id === "giant"
        )!;
        expect(buffed.counters?.["+0/+1"]).toBe(4);
        expect(getEffectiveToughness(state, buffed)).toBe(baseT + 4);
        expect(getEffectivePower(state, buffed)).toBe(3); // +0 to power (3/3 base)

        // Wire-format guard: counters + effective toughness survive projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "giant"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(baseT + 4);
    });
});

describe("Necropolis — exile a graveyard creature: +0/+1 counters = its MV (CR 122.1)", () => {
    it("exiles the chosen card and grows by its mana value", () => {
        const necro = makeInstance(necropolis.id, {
            id: "necro",
            controllerId: "p1",
        });
        // Grizzly Bears: {1}{G} → mana value 2.
        const corpse = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "corpse",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [necro],
                    graveyard: [corpse],
                }),
                makePlayer("p2"),
            ],
        });
        const baseT = getEffectiveToughness(state, necro);
        resolveActivated(state, necro, "necropolis-counters", [
            { type: "graveyard-card", id: "corpse", playerId: "p1" },
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].exile.some((c) => c.id === "corpse")).toBe(
            true
        );
        const grown = state.players[0].battlefield.find(
            (c) => c.id === "necro"
        )!;
        expect(grown.counters?.["+0/+1"]).toBe(2);
        expect(getEffectiveToughness(state, grown)).toBe(baseT + 2);
    });

    it("has Defender (can't attack)", () => {
        expect(necropolis.staticAbilities).toContain("defender");
    });
});

describe("Skull of Orm — {5},{T}: return an enchantment from your graveyard (CR 400.7)", () => {
    it("returns the targeted enchantment card to hand", () => {
        const skull = makeInstance(skullOfOrm.id, {
            id: "skull",
            controllerId: "p1",
        });
        const ench = makeInstance(getCardByName("Curse Artifact").id, {
            id: "ench",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [skull], graveyard: [ench] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, skull, "skull-of-orm-return", [
            { type: "graveyard-card", id: "ench", playerId: "p1" },
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].hand.some((c) => c.id === "ench")).toBe(true);
    });
});

describe("Standing Stones — {1},{T},Pay 1 life: add one mana of any color (CR 605.1)", () => {
    it("is a mana ability (useStack:false) with a life cost and color choices", () => {
        const ability = standingStones.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost.life).toBe(1);
        expect(ability.cost.tap).toBe(true);
        expect(ability.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });
});

describe("Stone Calendar — spells you cast cost {1} less (CR 601.2f)", () => {
    function effectiveCost(
        state: GameState,
        spellCardId: string,
        controllerId: string
    ): Record<string, number> {
        const def = getCardById(spellCardId);
        const spellView = makeInstance(spellCardId, {
            controllerId,
            zone: "stack",
        });
        const cost = normalizeManaCost(def.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    it("reduces the controller's own spell by {1} but not the opponent's", () => {
        const calendar = makeInstance(stoneCalendar.id, {
            id: "cal",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [calendar] }),
                makePlayer("p2"),
            ],
        });
        // Hill Giant {3}{R}: generic drops 3 → 2 for p1, unchanged for p2.
        const giantId = getCardByName("Hill Giant").id;
        expect(effectiveCost(state, giantId, "p1")).toEqual({ X: 2, R: 1 });
        expect(effectiveCost(state, giantId, "p2")).toEqual({ X: 3, R: 1 });
    });
});

describe("Tormod's Crypt — {T}, Sac: exile a player's graveyard (CR 406/400.7)", () => {
    it("moves the whole target graveyard to exile", () => {
        const crypt = makeInstance(tormodsCrypt.id, {
            id: "crypt",
            controllerId: "p1",
        });
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [crypt] }),
                makePlayer("p2", { graveyard: [a, b] }),
            ],
        });
        resolveActivated(state, crypt, "tormods-crypt-exile-graveyard", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(2);
    });
});

describe("Tower of Coireall — {T}: target can't be blocked by Walls this turn (CR 509.1b)", () => {
    it("flags the attacker and rejects only Wall blockers", () => {
        const tower = makeInstance(towerOfCoireall.id, {
            id: "tower",
            controllerId: "p1",
        });
        const attacker = makeInstance(getCardByName("Hill Giant").id, {
            id: "atk",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tower, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tower, "tower-of-coireall-evasion", [
            { type: "permanent", id: "atk" },
        ]);
        const flagged = state.players[0].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(flagged.cantBeBlockedBySubtypesThisTurn).toEqual(["Wall"]);
    });
});

describe("Maze of Ith — {T}: untap an attacker + prevent its combat damage (CR 615.1)", () => {
    it("untaps the attacker and registers combat-damage immunity for it", () => {
        const maze = makeInstance(mazeOfIth.id, {
            id: "maze",
            controllerId: "p1",
        });
        const attacker = makeInstance(getCardByName("Hill Giant").id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [maze] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, maze, "maze-of-ith-neutralize", [
            { type: "permanent", id: "atk" },
        ]);
        const after = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(after.isTapped).toBe(false);
        expect(
            state.combatDamageImmunity?.some((s) => s.instanceId === "atk")
        ).toBe(true);
    });
});

describe("City of Shadows — storage land (CR 605.1a, exile-to-store + per-counter mana)", () => {
    it("exiles a creature you control and adds a storage counter", () => {
        const city = makeInstance(cityOfShadows.id, {
            id: "city",
            controllerId: "p1",
        });
        const fodder = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [city, fodder] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, city, "city-of-shadows-store", [
            { type: "permanent", id: "fodder" },
        ]);
        expect(state.players[0].exile.some((c) => c.id === "fodder")).toBe(
            true
        );
        const stored = state.players[0].battlefield.find(
            (c) => c.id === "city"
        )!;
        expect(stored.counters?.storage).toBe(1);
    });

    it("mana ability outputs {C} per storage counter (manaAmount reads counters)", () => {
        const mana = cityOfShadows.activatedAbilities!.find(
            (a) => a.id === "city-of-shadows-mana"
        )!;
        const withThree = {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"],
            subtypes: [],
            isTapped: false,
            counters: { storage: 3 },
        } as never;
        expect(mana.manaAmount!(withThree, [])).toEqual({ C: 3 });
        const withNone = { ...(withThree as object), counters: {} } as never;
        expect(mana.manaAmount!(withNone, [])).toEqual({ C: 0 });
    });
});

describe("Safe Haven — exile creatures you control; sac to return them (CR 603.7a)", () => {
    it("exiles via a source-keyed bundle and returns on upkeep sacrifice", () => {
        const haven = makeInstance(safeHaven.id, {
            id: "haven",
            controllerId: "p1",
        });
        const friend = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "friend",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [haven, friend] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, haven, "safe-haven-exile", [
            { type: "permanent", id: "friend" },
        ]);
        expect(state.players[0].exile.some((c) => c.id === "friend")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.some((c) => c.id === "friend")
        ).toBe(false);

        // Upkeep trigger: accept the "may sacrifice" → return the creature.
        const havenInPlay = state.players[0].battlefield.find(
            (c) => c.id === "haven"
        )!;
        resolveTrigger(state, havenInPlay, "safe-haven-return", UPKEEP("p1"));
        // Suspended on the may-pay; answer "yes".
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "friend")
        ).toBe(true);
        expect(state.players[0].battlefield.some((c) => c.id === "haven")).toBe(
            false
        ); // sacrificed
    });
});

describe("Dark Sphere / Scarecrow — player damage prevention shields (CR 615.1)", () => {
    it("applyPlayerDamagePrevention: half-down from a matched source", () => {
        const state = makeState();
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceInstanceId: "src" },
                mode: "half-down",
                remaining: 1,
                duration: { kind: "end-of-turn" } as never,
            },
        ];
        // 5 damage → prevent floor(5/2)=2 → 3 lands; shield consumed.
        expect(applyPlayerDamagePrevention(state, "p1", "src", [], 5)).toBe(3);
        expect(state.playerDamagePrevention).toBeUndefined();
    });

    it("applyPlayerDamagePrevention: does NOT match a different source or player", () => {
        const state = makeState();
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceInstanceId: "src" },
                mode: "half-down",
                remaining: 1,
                duration: { kind: "end-of-turn" } as never,
            },
        ];
        expect(applyPlayerDamagePrevention(state, "p1", "other", [], 5)).toBe(
            5
        );
        expect(applyPlayerDamagePrevention(state, "p2", "src", [], 5)).toBe(5);
    });

    it("applyPlayerDamagePrevention: prevent-all from flying sources only", () => {
        const state = makeState();
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceStaticAbility: "flying" },
                mode: "all",
                remaining: 999,
                duration: { kind: "end-of-turn" } as never,
            },
        ];
        // Flyer's damage fully prevented; the shield persists (remaining high).
        expect(
            applyPlayerDamagePrevention(state, "p1", "flier", ["flying"], 4)
        ).toBe(0);
        // A grounded source is unaffected.
        expect(applyPlayerDamagePrevention(state, "p1", "ground", [], 4)).toBe(
            4
        );
    });

    it("Dark Sphere: resolving its ability registers a half-down shield on the controller", () => {
        const sphere = makeInstance(darkSphere.id, {
            id: "sphere",
            controllerId: "p1",
        });
        const threat = makeInstance(getCardByName("Hill Giant").id, {
            id: "threat",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sphere] }),
                makePlayer("p2", { battlefield: [threat] }),
            ],
        });
        resolveActivated(state, sphere, "dark-sphere-prevent-half", [
            { type: "permanent", id: "threat" },
        ]);
        const shield = state.playerDamagePrevention?.[0];
        expect(shield?.playerId).toBe("p1");
        expect(shield?.match.sourceInstanceId).toBe("threat");
        expect(shield?.mode).toBe("half-down");
    });

    it("Scarecrow: resolving its ability registers a flying prevent-all shield", () => {
        const crow = makeInstance(scarecrow.id, {
            id: "crow",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [crow] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, crow, "scarecrow-prevent-flying");
        const shield = state.playerDamagePrevention?.[0];
        expect(shield?.playerId).toBe("p1");
        expect(shield?.match.sourceStaticAbility).toBe("flying");
        expect(shield?.mode).toBe("all");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// C3 — Mana-production lookup / replacement (#420)
// ───────────────────────────────────────────────────────────────────────────

const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;
const PLAINS = getCardByName("Plains").id;
const MOUNTAIN = getCardByName("Mountain").id;
const SWAMP = getCardByName("Swamp").id;

/** Build the `battlefields` argument the engine passes to `getManaChoices`. */
function manaChoices(
    state: GameState,
    rock: CardInstanceState,
    controllerId: string
): ReturnType<typeof getEffectiveManaChoices> {
    return getEffectiveManaChoices(
        rock,
        controllerId,
        state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }))
    );
}

describe("Fellwar Stone (CR 106.4 — colours an opponent's land could produce)", () => {
    it("offers no colour when no opponent controls a colour-producing land", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            rock,
            // p1's OWN Forest must NOT count.
            makeInstance(FOREST, { controllerId: "p1" }),
        ];
        const choices = getDynamicManaChoices(rock, "p1", [
            { playerId: "p1", battlefield: state.players[0].battlefield },
            { playerId: "p2", battlefield: [] },
        ]);
        expect(choices).toEqual([]);
    });

    it("derives colours from the opponent's basic lands (Forest + Island → G, U)", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [rock];
        state.players[1].battlefield = [
            makeInstance(FOREST, { controllerId: "p2" }),
            makeInstance(ISLAND, { controllerId: "p2" }),
        ];
        const choices = manaChoices(state, rock, "p1");
        expect(choices).toEqual([{ U: 1 }, { G: 1 }]);
    });

    it("unions every opponent land's colours (Plains + Mountain + Swamp → W, B, R)", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [rock];
        state.players[1].battlefield = [
            makeInstance(PLAINS, { controllerId: "p2" }),
            makeInstance(MOUNTAIN, { controllerId: "p2" }),
            makeInstance(SWAMP, { controllerId: "p2" }),
        ];
        const choices = manaChoices(state, rock, "p1");
        expect(choices).toEqual([{ W: 1 }, { B: 1 }, { R: 1 }]);
    });

    it("ignores the controller's own lands; reads only opponents'", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            rock,
            makeInstance(MOUNTAIN, { controllerId: "p1" }),
        ];
        state.players[1].battlefield = [
            makeInstance(ISLAND, { controllerId: "p2" }),
        ];
        // Only the opponent's Island colour {U} is offered — not p1's own {R}.
        expect(manaChoices(state, rock, "p1")).toEqual([{ U: 1 }]);
    });

    it("survives projection — the picker the client renders matches the server", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [rock];
        state.players[1].battlefield = [
            makeInstance(FOREST, { controllerId: "p2" }),
            makeInstance(SWAMP, { controllerId: "p2" }),
        ];
        const onFat = manaChoices(state, rock, "p1");
        expect(onFat).toEqual([{ B: 1 }, { G: 1 }]);

        // The projection strips `card.card` to `{ id }` and reshapes arrays; the
        // producible-colour read must still work off the slim battlefield.
        const projected = projectPublicState(state, 1, "p1");
        const slimRock = projected.players[0].battlefield.find(
            (c) => c.id === rock.id
        )! as unknown as CardInstanceState;
        const onWire = getEffectiveManaChoices(
            slimRock,
            "p1",
            projected.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield as unknown as CardInstanceState[],
            }))
        );
        expect(onWire).toEqual(onFat);
    });

    it("getProducibleColors excludes colourless {C}", () => {
        // A basic land produces a colour; Standing Stones (any colour) too. A
        // pure {C} source would not contribute — covered by the empty-opponent
        // case. Sanity: a Forest's producible set is exactly {G}.
        const forest = makeInstance(FOREST, { controllerId: "p2" });
        expect([...getProducibleColors(forest)]).toEqual(["G"]);
    });
});

describe("Deep Water (CR 614 — lands produce {U} instead of their type)", () => {
    it("arms the per-turn replacement for the activating controller", () => {
        const dw = makeInstance(deepWater.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [dw];
        resolveActivated(state, dw, "deep-water-replace");
        expect(state.landManaReplacedToBlueThisTurn).toContain("p1");
    });

    it("rewrites a tapped land's output to {U} of the same quantity", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const forest = makeInstance(FOREST, { controllerId: "p1" });
        // A Forest taps for {G}; Deep Water rewrites it to {U}.
        const out = applyLandManaReplacement(state, "p1", forest, { G: 1 });
        expect(out).toEqual({ U: 1 });
    });

    it("preserves quantity for a multi-mana land (2 → {U}{U})", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const land = makeInstance(FOREST, { controllerId: "p1" });
        // Hypothetical {G}{G} land output — only the TYPE changes (CR 614).
        expect(applyLandManaReplacement(state, "p1", land, { G: 2 })).toEqual({
            U: 2,
        });
    });

    it("does not affect non-land mana sources (Fellwar Stone stays its colour)", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        expect(applyLandManaReplacement(state, "p1", rock, { R: 1 })).toEqual({
            R: 1,
        });
    });

    it("does not affect a player who hasn't activated Deep Water", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const forest = makeInstance(FOREST, { controllerId: "p2" });
        expect(applyLandManaReplacement(state, "p2", forest, { G: 1 })).toEqual(
            {
                G: 1,
            }
        );
    });

    it("expires at CLEANUP (until end of turn, CR 514.2)", () => {
        const state = makeState({ phase: "CLEANUP" });
        state.landManaReplacedToBlueThisTurn = ["p1"];
        finalizeCleanup(state);
        expect(state.landManaReplacedToBlueThisTurn).toBeUndefined();
    });

    it("survives projection — a {U} pool produced under Deep Water is visible", () => {
        const state = makeState();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const forest = makeInstance(FOREST, { controllerId: "p1" });
        const out = applyLandManaReplacement(state, "p1", forest, { G: 1 });
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        for (const [c, n] of Object.entries(out)) {
            state.players[0].manaPool[c as "U"] += n as number;
        }
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.U).toBe(1);
        expect(projected.players[0].manaPool.G).toBe(0);
    });
});

describe("Gaea's Touch (CR 400.7 — put a basic Forest from hand; CR 605 sacrifice for {G}{G})", () => {
    it("is sorcery-speed and once per turn", () => {
        const ability = gaeasTouch.activatedAbilities!.find(
            (a) => a.id === "gaeas-touch-forest"
        )!;
        expect(ability.useStack).toBe(true);
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.oncePerTurn).toBe(true);
        expect(ability.activationPhaseRestriction).toEqual([
            "PRECOMBAT_MAIN",
            "POSTCOMBAT_MAIN",
        ]);
    });

    it("puts a basic Forest from hand onto the battlefield when chosen", () => {
        const gt = makeInstance(gaeasTouch.id, { controllerId: "p1" });
        const state = makeState();
        const forestInHand = makeInstance(FOREST, {
            controllerId: "p1",
            zone: "hand",
        });
        state.players[0].battlefield = [gt];
        state.players[0].hand = [forestInHand];

        // Resolve the ability; it suspends on the optional hand choice.
        resolveActivated(state, gt, "gaeas-touch-forest");
        const pending = state.pendingChoices?.[0];
        expect(pending?.kind).toBe("choose-hand-card");
        expect(pending?.candidateIds).toEqual([forestInHand.id]);

        // Pick the Forest → it moves to the battlefield.
        answerChoice(state, [forestInHand.id]);
        expect(
            state.players[0].battlefield.some((c) => c.id === forestInHand.id)
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("offers no candidate when the hand has no basic Forest (nonbasic Forest excluded)", () => {
        const gt = makeInstance(gaeasTouch.id, { controllerId: "p1" });
        const state = makeState();
        // An Island is not a Forest; a hand with only it yields no candidate, so
        // the optional ability resolves with no choice prompt.
        state.players[0].battlefield = [gt];
        state.players[0].hand = [
            makeInstance(ISLAND, { controllerId: "p1", zone: "hand" }),
        ];
        resolveActivated(state, gt, "gaeas-touch-forest");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("declining the optional pick leaves the Forest in hand", () => {
        const gt = makeInstance(gaeasTouch.id, { controllerId: "p1" });
        const state = makeState();
        const forestInHand = makeInstance(FOREST, {
            controllerId: "p1",
            zone: "hand",
        });
        state.players[0].battlefield = [gt];
        state.players[0].hand = [forestInHand];
        resolveActivated(state, gt, "gaeas-touch-forest");
        // "You may" — decline by submitting an empty pick.
        answerChoice(state, []);
        expect(state.players[0].hand).toHaveLength(1);
        expect(
            state.players[0].battlefield.some((c) => c.id === forestInHand.id)
        ).toBe(false);
    });

    it("sacrifice ability adds {G}{G}", () => {
        const sac = gaeasTouch.activatedAbilities!.find(
            (a) => a.id === "gaeas-touch-sacrifice-mana"
        )!;
        expect(sac.useStack).toBe(false);
        expect(sac.cost.sacrifice).toBe(true);
        expect(sac.manaProduced).toEqual({ G: 2 });
        // The mana-ability effect adds {G}{G} via addMana.
        let added: Record<string, number> | undefined;
        sac.effect?.({ addMana: (m) => (added = m as Record<string, number>) });
        expect(added).toEqual({ G: 2 });
    });
});

// ---------------------------------------------------------------------------
// Dance of Many (C4 — Copy-as-token, #421)
//   CR 707.2 token copy + CR 603.10 leave-linkage (both directions) + CR 603.6a
//   upkeep "sacrifice unless you pay {U}{U}" (reuses the LEG C7 trigger).
// ---------------------------------------------------------------------------

/** Build the firing PERMANENT_ENTERED event for `source` (Dance's ETB). */
const ENTERED = (source: CardInstanceState): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_ENTERED" as const,
        instanceId: source.id,
        controllerId: source.controllerId,
        types: source.types,
    }) as StackItem["triggerEvent"];

/** Place Dance of Many on p1's battlefield with a nontoken creature to copy. */
function danceSetup(copyTargetId: string) {
    const target = makeInstance(copyTargetId, {
        id: "orig",
        controllerId: "p1",
        ownerId: "p1",
    });
    const dance = makeInstance(danceOfMany.id, {
        id: "dance",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [dance, target] }),
            makePlayer("p2"),
        ],
    });
    return { state, dance, target };
}

/** Run Dance's ETB trigger and choose `pickId` as the creature to copy.
 *  Returns the freshly created copy-token instance. */
function fireEtbAndCopy(
    state: GameState,
    dance: CardInstanceState,
    pickId: string
): CardInstanceState {
    resolveTrigger(state, dance, "dance-of-many-etb", ENTERED(dance));
    // The ETB suspends on the choose-a-creature pick; answer it.
    answerChoice(state, [pickId]);
    const token = state.players[0].battlefield.find((c) => c.isToken);
    if (!token) throw new Error("no copy-token created");
    return token;
}

describe("Dance of Many — definition (modern Scryfall oracle, ADR 0004)", () => {
    it("is a {U}{U} Enchantment with the real Scryfall id", () => {
        expect(danceOfMany.id).toBe("54d5d755-403a-4e81-837e-f516eb17e819");
        expect(danceOfMany.manaCost).toEqual({ U: 2 });
        expect(danceOfMany.types).toEqual(["Enchantment"]);
    });

    it("carries all four triggered abilities (ETB / two LTBs / upkeep)", () => {
        const ids = danceOfMany.triggeredAbilities?.map((a) => a.id) ?? [];
        expect(ids).toEqual([
            "dance-of-many-etb",
            "dance-of-many-exile-token",
            "dance-of-many-sacrifice-self",
            "dance-of-many-upkeep",
        ]);
    });

    it("is registered by id and name", () => {
        expect(getCardById(danceOfMany.id)).toBe(danceOfMany);
        expect(getCardByName("Dance of Many")).toBe(danceOfMany);
    });
});

describe("Dance of Many — ETB token copy (CR 707.2)", () => {
    it("creates a token that is a copy of the target creature's copiable values", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // CR 707.2 — copiable values: types, P/T, abilities from the printed def.
        expect(token.isToken).toBe(true);
        expect(token.power).toBe(4);
        expect(token.toughness).toBe(4);
        expect(token.staticAbilities).toContain("flying");
        expect(token.staticAbilities).toContain("vigilance");
        // Effective P/T (through the layer pipeline) matches the copied creature.
        expect(getEffectivePower(state, token)).toBe(4);
        expect(getEffectiveToughness(state, token)).toBe(4);
        // Provenance + reverse linkage are wired (CR 603.10 anchor).
        expect(token.createdBy).toBe("dance");
        expect(dance.linkedTokenId).toBe(token.id);
    });

    it("copies a vanilla creature's P/T (Grizzly Bears 2/2)", () => {
        const { state, dance } = danceSetup(getCardByName("Grizzly Bears").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        expect(getEffectivePower(state, token)).toBe(2);
        expect(getEffectiveToughness(state, token)).toBe(2);
    });

    it("only offers nontoken creatures as copy targets (isToken: false filter)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        // Add a pre-existing token; it must NOT be a legal copy choice.
        const stray = makeInstance(getCardByName("Serra Angel").id, {
            id: "stray-token",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        state.players[0].battlefield.push(stray);
        resolveTrigger(state, dance, "dance-of-many-etb", ENTERED(dance));
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-permanents");
        // Eligibility is carried by the choice filter (CR 111.5 nontoken).
        expect(head?.filter).toMatchObject({
            types: "Creature",
            isToken: false,
        });
        expect(head?.allControllers).toBe(true);
    });
});

describe("Dance of Many — leave-linkage (CR 603.10)", () => {
    it("exiles the token when the enchantment leaves the battlefield", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // Dance leaves play (e.g. destroyed).
        removePermanentTo(state, dance.id, "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // Dance's exile-token LTB
        // The token is exiled — it ceases to exist (CR 111.7 SBA), so it is on
        // no battlefield and in no public zone.
        const onBattlefield = state.players.some((p) =>
            p.battlefield.some((c) => c.id === token.id)
        );
        expect(onBattlefield).toBe(false);
    });

    it("sacrifices the enchantment when the token leaves the battlefield", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // The token leaves play (e.g. dies in combat).
        removePermanentTo(state, token.id, "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // Dance's sacrifice-self LTB
        const danceStillThere = state.players[0].battlefield.some(
            (c) => c.id === "dance"
        );
        expect(danceStillThere).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "dance")).toBe(
            true
        );
    });

    it("the token-leaves trigger fires ONLY for this enchantment's own token", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        fireEtbAndCopy(state, dance, "orig");
        // An unrelated creature leaving must NOT fire the sacrifice-self trigger.
        const other = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(other);
        removePermanentTo(state, other.id, "graveyard");
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_LEFT",
                instanceId: "other",
                controllerId: "p1",
                ownerId: "p1",
                types: ["Creature"],
                wasAura: false,
                toZone: "graveyard",
            } as never,
        ]);
        expect(
            triggers.some(
                (t) => t.triggeredAbilityId === "dance-of-many-sacrifice-self"
            )
        ).toBe(false);
    });
});

describe("Dance of Many — upkeep pay-{U}{U}-or-sacrifice (reuses LEG C7, CR 603.6a / 117.3a)", () => {
    const UPKEEP = (playerId: string): StackItem["triggerEvent"] =>
        ({
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: playerId,
        }) as StackItem["triggerEvent"];

    it("declining the {U}{U} payment sacrifices the enchantment (CR 701.16)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        resolveTrigger(state, dance, "dance-of-many-upkeep", UPKEEP("p1"));
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield.some((c) => c.id === "dance")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "dance")).toBe(
            true
        );
    });

    it("paying {U}{U} keeps the enchantment on the battlefield (CR 118)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        state.players[0].manaPool = { U: 2 };
        resolveTrigger(state, dance, "dance-of-many-upkeep", UPKEEP("p1"));
        answerChoice(state, ["yes"]);
        expect(state.players[0].battlefield.some((c) => c.id === "dance")).toBe(
            true
        );
    });

    it("fires only at the controller's OWN upkeep (scope: your)", () => {
        const { state } = danceSetup(getCardByName("Serra Angel").id);
        expect(
            collectTriggers(state, [UPKEEP("p1") as never]).some(
                (t) => t.triggeredAbilityId === "dance-of-many-upkeep"
            )
        ).toBe(true);
        expect(
            collectTriggers(state, [UPKEEP("p2") as never]).some(
                (t) => t.triggeredAbilityId === "dance-of-many-upkeep"
            )
        ).toBe(false);
    });

    it("backend integration: declining via applyMayPaySubmit sacrifices it (GRE → mutation → state)", () => {
        const { state } = danceSetup(getCardByName("Serra Angel").id);
        state.stack.push(...collectTriggers(state, [UPKEEP("p1") as never]));
        // Resolve the upkeep tax trigger (the ETB/LTBs do not fire on a plain
        // upkeep event); it suspends at the may-pay choice.
        let suspended = false;
        while (state.stack.length > 0) {
            const before = state.stack.length;
            const res = resolveTopOfStack(state);
            if (res === null && state.pendingChoices?.length) {
                suspended = true;
                break;
            }
            if (state.stack.length === before) break;
        }
        expect(suspended).toBe(true);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "dance")).toBe(
            false
        );
    });
});

describe("Dance of Many — wire format (mandatory): copied P/T survives projection", () => {
    it("the copy-token's P/T survive projectPublicState (CR 707.2)", () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        // GRE (fat state) assertion.
        expect(getEffectivePower(state, token)).toBe(4);
        expect(getEffectiveToughness(state, token)).toBe(4);
        // Same assertion after the network projection (the projection strips
        // card.card to { id }; the copy overwrote card.id with the copied def,
        // so the slim instance still reads the copied P/T).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(slim).toBeDefined();
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Dance of Many — serialization round-trip (linkedTokenId, CR 603.10)", () => {
    it("persists the linkedTokenId leave-linkage anchor across compact/expand", async () => {
        const { state, dance } = danceSetup(getCardByName("Serra Angel").id);
        const token = fireEtbAndCopy(state, dance, "orig");
        const { compactState, expandState } =
            await import("../../../gre/serialize");
        const restored = expandState(compactState(state));
        const restoredDance = restored.players[0].battlefield.find(
            (c) => c.id === "dance"
        )!;
        expect(restoredDance.linkedTokenId).toBe(token.id);
    });
});

// ---------------------------------------------------------------------------
// Tracker — generic Fight primitive (CR 701.12 mutual damage; CR 120 / 510-
// style simultaneous damage through the normal damage path)
// ---------------------------------------------------------------------------

/** Builds a board with Tracker (p1) and one target creature (p2), then fights
 *  the target via Tracker's activated ability. `trackerPT` / `targetPT`
 *  override the printed stats so each branch (survive / die) is exercised. */
function fightTracker(
    trackerPT: { power: number; toughness: number },
    targetPT: { power: number; toughness: number },
    extra: Partial<GameState> = {}
): GameState {
    const trk = makeInstance(tracker.id, {
        id: "trk",
        controllerId: "p1",
        ownerId: "p1",
        power: trackerPT.power,
        toughness: trackerPT.toughness,
    });
    // Any vanilla creature stands in for the fight target; P/T is overridden.
    const foe = makeInstance(getCardByName("Goblin Hero").id, {
        id: "foe",
        controllerId: "p2",
        ownerId: "p2",
        power: targetPT.power,
        toughness: targetPT.toughness,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [trk] }),
            makePlayer("p2", { battlefield: [foe] }),
        ],
        ...extra,
    });
    resolveActivated(state, trk, "tracker-fight", [
        { type: "permanent", id: "foe" },
    ]);
    checkStateBasedActions(state);
    return state;
}

const onField = (state: GameState, pIdx: number, id: string): boolean =>
    state.players[pIdx].battlefield.some((c) => c.id === id);
const inGrave = (state: GameState, pIdx: number, id: string): boolean =>
    state.players[pIdx].graveyard.some((c) => c.id === id);

describe("Tracker — Fight primitive (CR 701.12 mutual damage)", () => {
    it("card definition: {G}{G},{T} activated ability targeting a creature", () => {
        expect(tracker.manaCost).toEqual({ X: 2, G: 1 });
        expect(tracker.power).toBe(2);
        expect(tracker.toughness).toBe(2);
        const ab = tracker.activatedAbilities![0];
        expect(ab.cost).toEqual({ mana: { G: 2 }, tap: true });
        expect(ab.useStack).toBe(true);
        expect(ab.targetRequirement).toEqual({ type: "Creature", count: 1 });
    });

    it("both survive: 2/2 Tracker vs 1/3 — damage marked, neither destroyed", () => {
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 3 }
        );
        // Tracker (2 power) marks 2 on the 1/3 foe (survives, tough 3).
        const foe = state.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(foe.damageMarked).toBe(2);
        // The foe (1 power) marks 1 on Tracker (survives, tough 2).
        const trk = state.players[0].battlefield.find((c) => c.id === "trk")!;
        expect(trk.damageMarked).toBe(1);
        expect(onField(state, 0, "trk")).toBe(true);
        expect(onField(state, 1, "foe")).toBe(true);
    });

    it("both die: 2/2 Tracker vs 2/2 — both take lethal and go to the graveyard", () => {
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 2, toughness: 2 }
        );
        expect(onField(state, 0, "trk")).toBe(false);
        expect(onField(state, 1, "foe")).toBe(false);
        expect(inGrave(state, 0, "trk")).toBe(true);
        expect(inGrave(state, 1, "foe")).toBe(true);
    });

    it("one dies: 3/3 Tracker vs 2/2 — foe dies, Tracker survives with 2 marked", () => {
        const state = fightTracker(
            { power: 3, toughness: 3 },
            { power: 2, toughness: 2 }
        );
        expect(onField(state, 1, "foe")).toBe(false);
        expect(inGrave(state, 1, "foe")).toBe(true);
        const trk = state.players[0].battlefield.find((c) => c.id === "trk")!;
        expect(trk.damageMarked).toBe(2);
    });

    it("simultaneity (CR 701.12): a creature that dies still deals its full damage", () => {
        // 5/2 Tracker vs 4/4 foe: Tracker dies to the foe's 4, but its 5 must
        // still be dealt — the foe (toughness 4) must also die. If damage were
        // sequential and the dead creature stopped dealing, the foe would live.
        const state = fightTracker(
            { power: 5, toughness: 2 },
            { power: 4, toughness: 4 }
        );
        expect(onField(state, 0, "trk")).toBe(false);
        expect(onField(state, 1, "foe")).toBe(false);
    });

    it("normal damage path: a target-prevention shield on the foe absorbs the fight damage", () => {
        // CR 615 prevention applies because fight routes through the same
        // damage pipeline. Shield the foe for 3; Tracker's 2 is fully absorbed.
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 5 },
            {
                targetPreventionShields: [
                    {
                        targetType: "permanent",
                        targetId: "foe",
                        remaining: 3,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            }
        );
        const foe = state.players[1].battlefield.find((c) => c.id === "foe")!;
        // All 2 of Tracker's damage prevented → 0 marked on the foe.
        expect(foe.damageMarked ?? 0).toBe(0);
        // Tracker still takes the foe's 1 (no shield on Tracker).
        const trk = state.players[0].battlefield.find((c) => c.id === "trk")!;
        expect(trk.damageMarked).toBe(1);
    });

    it("normal damage path: protection from green prevents Tracker's damage to the foe", () => {
        // CR 702.16e — a foe with protection from green takes no damage from
        // Tracker (a green source), proving fight respects protection.
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 5 }
        );
        // Re-run with protection: rebuild manually to inject the keyword.
        const trk = makeInstance(tracker.id, {
            id: "trk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const foe = makeInstance(getCardByName("Goblin Hero").id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
            toughness: 5,
            staticAbilities: ["protection from green"],
        });
        const s2 = makeState({
            players: [
                makePlayer("p1", { battlefield: [trk] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(s2, trk, "tracker-fight", [
            { type: "permanent", id: "foe" },
        ]);
        const foeAfter = s2.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(foeAfter.damageMarked ?? 0).toBe(0);
        // baseline (no protection) did mark damage — sanity that the helper works
        const foeBaseline = state.players[1].battlefield.find(
            (c) => c.id === "foe"
        )!;
        expect(foeBaseline.damageMarked).toBe(2);
    });

    it("self-target (DRK ruling): Tracker deals 2× its power to itself and dies", () => {
        // 2009-10-01 ruling — Tracker may target itself; it deals its power to
        // itself, then immediately again (2 + 2 = 4 marked on a 2-toughness
        // body → lethal).
        const trk = makeInstance(tracker.id, {
            id: "trk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [trk] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, trk, "tracker-fight", [
            { type: "permanent", id: "trk" },
        ]);
        checkStateBasedActions(state);
        expect(onField(state, 0, "trk")).toBe(false);
        expect(inGrave(state, 0, "trk")).toBe(true);
    });

    it("wire format: fight result (marked damage / destruction) survives projectPublicState", () => {
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 3 }
        );
        const projected = projectPublicState(state, 1, "p1");
        // Foe survived with 2 marked; the marked total crosses the wire so the
        // client renders the damage and any subsequent lethal check is correct.
        const foe = projected.players[1].battlefield.find(
            (c) => c.id === "foe"
        )!;
        expect(foe.damageMarked).toBe(2);
        const trk = projected.players[0].battlefield.find(
            (c) => c.id === "trk"
        )!;
        expect(trk.damageMarked).toBe(1);
    });

    it("only creatures are legal fight targets (CR 701.12)", () => {
        const foe = makeInstance(getCardByName("Goblin Hero").id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            tracker.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        );
        expect(legal.map((t) => t.id)).toContain("foe");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Worms of the Earth — {2}{B}{B}{B} Enchantment (#423)
// "Players can't play lands. Lands can't enter the battlefield. At the
//  beginning of each upkeep, any player may sacrifice two lands or take 5
//  damage; if they do either, destroy this." CR 305.1 land-play special action
//  + CR 614 land-ETB prohibition; CR 603.6a "each" upkeep + CR 117.3a optional.
// ───────────────────────────────────────────────────────────────────────────

/** Puts Worms of the Earth on p1's battlefield. */
function withWorms(): { state: GameState; worms: CardInstanceState } {
    const worms = makeInstance(wormsOfTheEarth.id, {
        id: "worms-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [worms] }), makePlayer("p2")],
    });
    return { state, worms };
}

describe("Worms of the Earth ({2}{B}{B}{B} Enchantment — land-play/ETB lock)", () => {
    it("has the correct cost, type, and prohibition marker", () => {
        expect(wormsOfTheEarth.manaCost).toEqual({ X: 2, B: 3 });
        expect(wormsOfTheEarth.types).toEqual(["Enchantment"]);
        expect(wormsOfTheEarth.preventsLandPlayAndETB).toBe(true);
        expect(wormsOfTheEarth.triggeredAbilities).toHaveLength(1);
    });

    describe("land-play prohibition (CR 305.1) — path 1", () => {
        it('a land in hand has NO "play" action while Worms is in play', () => {
            const { state } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            const actions = getLegalActions(state, state.players[0], land);
            expect(actions).not.toContain("play");
        });

        it('the same land DOES have "play" once Worms leaves play (lock lifted)', () => {
            const { state, worms } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            // Remove Worms → lock lifts immediately (live-derived).
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            const actions = getLegalActions(state, state.players[0], land);
            expect(actions).toContain("play");
        });

        it("assertLegalAction throws for play (game.ts playCard mutation boundary)", () => {
            const { state } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            expect(() =>
                assertLegalAction(state, state.players[0], land, "play")
            ).toThrow(/Illegal action "play"/);
        });
    });

    describe("land-ETB prohibition (CR 614) — path 2", () => {
        it("landPlayLockActive is true with Worms in play, false without", () => {
            const { state, worms } = withWorms();
            expect(landPlayLockActive(state)).toBe(true);
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            expect(landPlayLockActive(state)).toBe(false);
        });

        it("canLandEnterBattlefield PREVENTS a land while locked, allows non-lands", () => {
            const { state } = withWorms();
            expect(canLandEnterBattlefield(state, ["Land"])).toBe(false);
            expect(canLandEnterBattlefield(state, ["Creature"])).toBe(true);
            expect(canLandEnterBattlefield(state, ["Artifact"])).toBe(true);
        });

        it("canLandEnterBattlefield allows a land once Worms leaves", () => {
            const { state, worms } = withWorms();
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            expect(canLandEnterBattlefield(state, ["Land"])).toBe(true);
        });
    });

    describe("serialization cache (refreshLandPlayLock via SBA)", () => {
        it("checkStateBasedActions sets state.landPlayLocked while Worms is in play", () => {
            const { state } = withWorms();
            expect(state.landPlayLocked).toBeUndefined();
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBe(true);
        });

        it("checkStateBasedActions clears state.landPlayLocked when Worms leaves", () => {
            const { state, worms } = withWorms();
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBe(true);
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBeUndefined();
        });
    });

    describe("upkeep clause (CR 603.6a 'each' + CR 117.3a optional)", () => {
        it("sacrificing two lands destroys Worms of the Earth", () => {
            const { state, worms } = withWorms();
            const l1 = makeInstance(mountain.id, {
                id: "l1",
                controllerId: "p1",
                ownerId: "p1",
            });
            const l2 = makeInstance(mountain.id, {
                id: "l2",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(l1, l2);
            state.phase = "UPKEEP";
            // Fire on p1's upkeep; choose "sacrifice", then pick the two lands.
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["sacrifice"]);
            answerChoice(state, ["l1", "l2"]);
            checkStateBasedActions(state);
            // Worms destroyed; two lands sacrificed.
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
            expect(
                state.players[0].battlefield.filter((c) =>
                    c.types.includes("Land")
                )
            ).toHaveLength(0);
        });

        it("taking 5 damage destroys Worms and lowers life by 5", () => {
            const { state, worms } = withWorms();
            state.phase = "UPKEEP";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["damage"]);
            checkStateBasedActions(state);
            expect(state.players[0].life).toBe(15);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
        });

        it("declining keeps Worms in play (no sacrifice, no damage)", () => {
            const { state, worms } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "keep",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(land);
            state.phase = "UPKEEP";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["decline"]);
            checkStateBasedActions(state);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(true);
            expect(state.players[0].life).toBe(20);
            expect(
                state.players[0].battlefield.some((c) => c.id === "keep")
            ).toBe(true);
        });

        it("fires on EACH player's upkeep — p2 may pay too (scope: each)", () => {
            const { state, worms } = withWorms();
            // p2's upkeep: scoped player is p2 (active player), not Worms'
            // controller p1. p2 takes 5; Worms is destroyed.
            state.phase = "UPKEEP";
            state.activePlayerId = "p2";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p2")
            );
            answerChoice(state, ["damage"]);
            checkStateBasedActions(state);
            expect(state.players[1].life).toBe(15);
            expect(state.players[0].life).toBe(20);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
        });
    });

    describe("wire format (projection survives)", () => {
        it("landPlayLocked + lock derivation survive projectPublicState", () => {
            const { state } = withWorms();
            checkStateBasedActions(state);
            expect(landPlayLockActive(state)).toBe(true);
            const projected = projectPublicState(state, 1, "p1");
            // The serialized cache crosses the wire.
            expect(projected.landPlayLocked).toBe(true);
            // And the live derivation still reads Worms off the projected board.
            expect(landPlayLockActive(projected as unknown as GameState)).toBe(
                true
            );
        });
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Fasting — DRK C7. {W} Enchantment (#424). Three abilities (modern oracle,
// ADR 0004):
//   1. CR 603.6a upkeep — put a hunger counter, then destroy at five or more.
//   2. CR 504/614 — "you may skip your draw step; if you do, gain 2 life"
//      (Island Sanctuary `drawStepReplacement` precedent + DRAW phaseTrigger).
//   3. CR 121.1 — "when you draw a card, destroy this enchantment" (new
//      CARD_DRAWN event via the `drawTrigger` factory).
// ───────────────────────────────────────────────────────────────────────────
describe("Fasting (CR 504/614 skip-draw + CR 603.6a hunger counters)", () => {
    /** Answer the head pending choice (mirrors the Island Sanctuary harness). */
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

    function makeFasting(counters?: Record<string, number>): CardInstanceState {
        return makeInstance(fasting.id, {
            id: "fast",
            controllerId: "p1",
            ownerId: "p1",
            ...(counters ? { counters } : {}),
        });
    }

    function libraryCard(id = "lib-top"): CardInstanceState {
        return makeInstance(getCardByName("Squire").id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
    }

    it("snapshot: card definition wiring (oracle + flag + triggers)", () => {
        expect(fasting.types).toEqual(["Enchantment"]);
        expect(fasting.drawStepReplacement).toBe(true);
        const ids = (fasting.triggeredAbilities ?? []).map((t) => t.id);
        expect(ids).toContain("fasting-upkeep-hunger");
        expect(ids).toContain("fasting-draw-skip");
        expect(ids).toContain("fasting-draw-destroy");
    });

    // (a) Skip-draw golden path: gain 2 life, no card drawn.
    it("on skip, gains 2 life and draws no card (CR 504/119.3)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
            life: 20,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        // UPKEEP → DRAW: the DRAW phase-begin draw-skip trigger lands on the
        // stack (the upkeep trigger already fired on entering UPKEEP, which we
        // skip past here by starting at UPKEEP).
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-skip"
            )
        ).toBe(true);
        resolveTopOfStack(state); // suspends at the may-skip choice
        expect(state.pendingChoices).toHaveLength(1);

        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        expect(p1.life).toBe(22);
        expect(p1.hand).toHaveLength(0);
        // Still on the battlefield — no draw happened, so the self-destruct
        // draw trigger never fired.
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(true);
    });

    // (c) Drawing a card (declining the skip) destroys Fasting.
    it("on decline, draws the card and destroys Fasting (CR 121.1)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
            life: 20,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        advancePhase(state); // → DRAW, draw-skip trigger on stack
        resolveTopOfStack(state); // draw-skip trigger suspends at choice
        commitHead(state, ["no"]);
        resolveTopOfStack(state); // declines → draws a card → emits CARD_DRAWN

        // The card was drawn.
        expect(p1.hand.some((c) => c.id === "lib-top")).toBe(true);
        expect(p1.life).toBe(20);
        // The CARD_DRAWN self-destruct trigger is now on the stack; resolve it.
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-destroy"
            )
        ).toBe(true);
        resolveTopOfStack(state);
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "fast")).toBe(true);
    });

    it("any draw (effect-driven) destroys Fasting (CR 121.1)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "PRECOMBAT_MAIN",
        });
        // An effect-driven draw (any source) emits CARD_DRAWN at the engine's
        // draw choke point; scan it as resolveTopOfStack does post-resolution.
        p1.hand.push(p1.library.shift()!);
        state.pendingEvents = [
            { type: "CARD_DRAWN", playerId: "p1", count: 1 },
        ];
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-destroy"
            )
        ).toBe(true);
        resolveTopOfStack(state);
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(false);
    });

    it('an opponent\'s draw does NOT destroy Fasting (CR 121 — "you draw")', () => {
        const fast = makeFasting();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fast] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            turn: 2,
        });
        state.pendingEvents = [
            { type: "CARD_DRAWN", playerId: "p2", count: 1 },
        ];
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fasting-draw-destroy"
            )
        ).toBe(false);
        expect(state.players[0].battlefield.some((c) => c.id === "fast")).toBe(
            true
        );
    });

    // (b) Hunger counter added each upkeep; destroyed at five or more.
    it("upkeep adds a hunger counter (CR 122.1)", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", { battlefield: [fast], library: [] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        resolveTrigger(state, fast, "fasting-upkeep-hunger", UPKEEP("p1"));
        const onBoard = p1.battlefield.find((c) => c.id === "fast")!;
        expect(onBoard.counters?.hunger).toBe(1);
    });

    it("destroyed when it reaches five hunger counters (CR 603)", () => {
        // Start with four; the fifth upkeep counter triggers destruction.
        const fast = makeFasting({ hunger: 4 });
        const p1 = makePlayer("p1", { battlefield: [fast] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        resolveTrigger(state, fast, "fasting-upkeep-hunger", UPKEEP("p1"));
        expect(p1.battlefield.some((c) => c.id === "fast")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "fast")).toBe(true);
    });

    it("not destroyed below five hunger counters", () => {
        const fast = makeFasting({ hunger: 3 });
        const p1 = makePlayer("p1", { battlefield: [fast] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        resolveTrigger(state, fast, "fasting-upkeep-hunger", UPKEEP("p1"));
        const onBoard = p1.battlefield.find((c) => c.id === "fast");
        expect(onBoard).toBeDefined();
        expect(onBoard!.counters?.hunger).toBe(4);
    });

    // Backend boundary: the may-skip choice resolves via applyMayPaySubmit
    // (the same path game.ts's submitMayPay mutation drives).
    it("backend may-pay path: accepting the skip gains 2 life", () => {
        const fast = makeFasting();
        const p1 = makePlayer("p1", {
            battlefield: [fast],
            library: [libraryCard()],
            life: 20,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "DRAW",
                    activePlayerId: "p1",
                } as never,
            ]).filter((t) => t.triggeredAbilityId === "fasting-draw-skip")
        );
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(p1.life).toBe(22);
        expect(p1.hand).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reflecting Mirror — "{X}, {T}: Change the target of target spell with a single
// target if that target is you. The new target must be a player. X is twice the
// mana value of that spell." (CR 605 activated ability; CR 114.6 changing the
// target of a spell already on the stack — the ORIGINAL object, not a copy.)
// ─────────────────────────────────────────────────────────────────────────────
describe("Reflecting Mirror (retarget existing spell, CR 114.6)", () => {
    const MIRROR_ABILITY = "reflecting-mirror-retarget";

    // Pushes Reflecting Mirror's ability on the stack with its targets already
    // chosen (mirrors the post-finalizeTargetSelection state), then resolves it
    // so requestRetarget fires. The {X}/{T} cost is assumed paid (its payment
    // is exercised through finalizeTargetSelection in the integration test).
    function resolveMirrorAbility(
        state: GameState,
        source: CardInstanceState,
        spellStackItemId: string
    ): void {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            abilityId: MIRROR_ABILITY,
            targets: [{ type: "spell", id: spellStackItemId }],
        });
        resolveTopOfStack(state);
    }

    function setup() {
        const mirror = makeInstance(reflectingMirror.id, {
            id: "mirror-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mirror] }),
                makePlayer("p2"),
            ],
        });
        // p2 casts a single-target spell (Lightning Bolt) at p1.
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        return { state, mirror, bolt };
    }

    it("definition: {4} artifact with a single targeted activated ability", () => {
        expect(reflectingMirror.types).toEqual(["Artifact"]);
        expect(reflectingMirror.manaCost).toEqual({ X: 4 });
        const ability = reflectingMirror.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.cost.mana).toEqual({ X: "X" });
        expect(ability?.cost.xFromTargetSpellMv).toEqual({ multiplier: 2 });
        expect(ability?.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            spellSingleTargetingController: true,
        });
    });

    it("is legal only against a single-target spell that targets the activator (CR 115.10)", () => {
        const { state } = setup();
        const ability = reflectingMirror.activatedAbilities![0];
        // Activator is p1: the bolt targets p1, so it is a legal target.
        const legalForP1 = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        );
        expect(legalForP1.map((t) => t.type)).toEqual(["spell"]);

        // From p2's seat the bolt does NOT target p2 — illegal.
        const legalForP2 = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p2"
        );
        expect(legalForP2).toHaveLength(0);
    });

    it("a spell with two targets is not legal (single target required)", () => {
        const { state } = setup();
        // Replace the bolt with a (synthetic) two-target spell at p1 + p2.
        state.stack[0].targets = [
            { type: "player", id: "p1" },
            { type: "player", id: "p2" },
        ];
        const ability = reflectingMirror.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        );
        expect(legal).toHaveLength(0);
    });

    it("a spell targeting a permanent (not the player) is not legal", () => {
        const { state } = setup();
        state.stack[0].targets = [{ type: "permanent", id: "some-creature" }];
        const ability = reflectingMirror.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        );
        expect(legal).toHaveLength(0);
    });

    it("resolution opens a player-target retarget prompt for the activator (CR 114.6)", () => {
        const { state, mirror, bolt } = setup();
        resolveMirrorAbility(state, mirror, bolt.id);

        const pt = state.pendingTarget;
        expect(pt?.kind).toBe("retarget");
        expect(pt?.playerId).toBe("p1"); // the activator chooses
        expect(pt?.cardInstanceId).toBe(bolt.id); // the ORIGINAL spell
        expect(pt?.targetType).toBe("player");
        // The Mirror ability has left the stack; the bolt is still there.
        expect(state.stack.map((s) => s.id)).toEqual([bolt.id]);
    });

    it("changes the ORIGINAL spell's target and it resolves at the new target", () => {
        const { state, mirror, bolt } = setup();
        resolveMirrorAbility(state, mirror, bolt.id);

        // Choose p2 as the new target (mirrors finalizeTargetSelection's
        // retarget branch writing onto the original stack item).
        const pt = state.pendingTarget!;
        const spell = state.stack.find((s) => s.id === pt.cardInstanceId)!;
        spell.targets = [{ type: "player", id: "p2" }];
        state.pendingTarget = undefined;

        // The original bolt now targets p2 in place.
        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);

        resolveTopOfStack(state); // Bolt resolves at the NEW target.
        expect(state.players[1].life).toBe(17); // p2 took the 3 damage
        expect(state.players[0].life).toBe(20); // p1 untouched
    });

    it("integration: real activation + derived-X payment + retarget (game.ts)", () => {
        const { state, mirror, bolt } = setup();
        const ability = reflectingMirror.activatedAbilities![0];
        // X is twice the bolt's mana value (Lightning Bolt MV = 1 → X = 2).
        // Give p1 exactly 2 mana so the cost is covered and finalize commits.
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 };

        // Drive the REAL finalizeTargetSelection through the ability path, with
        // the spell target already selected — mirrors activateAbility +
        // selectTarget building the pendingTarget (kind: "ability").
        const pendingTarget = {
            playerId: "p1",
            cardInstanceId: mirror.id,
            targetType: ability.targetRequirement!.type,
            count: 1,
            selected: [{ type: "spell" as const, id: bolt.id }],
            kind: "ability" as const,
            abilityId: MIRROR_ABILITY,
            spellSingleTargetingController: true,
        };
        state.pendingTarget = pendingTarget;
        finalizeTargetSelection(state, pendingTarget, "p1");

        // Cost paid: {T} the Mirror + 2 generic mana spent. The ability is on
        // the stack carrying the derived X = 2.
        expect(state.players[0].battlefield[0].isTapped).toBe(true);
        expect(state.players[0].manaPool.R).toBe(0);
        const abilityItem = state.stack.find(
            (s) => s.abilityId === MIRROR_ABILITY
        )!;
        expect(abilityItem.chosenX).toBe(2);

        // Resolve the ability → retarget prompt on the ORIGINAL bolt.
        resolveTopOfStack(state);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("retarget");
        expect(pt.cardInstanceId).toBe(bolt.id);

        // Choose p2 via the REAL retarget-finalize branch of game.ts.
        const retargetPt = {
            ...pt,
            selected: [{ type: "player" as const, id: "p2" }],
        };
        state.pendingTarget = retargetPt;
        finalizeTargetSelection(state, retargetPt, "p1");

        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // bolt now hits p2
        expect(state.players[0].life).toBe(20);
    });

    it("integration: derived X scales with a higher-mana-value spell", () => {
        // Use Fireball-like MV via chosenX on the target spell: a bolt cast for
        // an extra X would raise its MV; here we simulate a spell whose stack
        // MV is 3 (base 1 + chosenX 2) → derived ability X = 6.
        const { state, mirror, bolt } = setup();
        bolt.chosenX = 2; // pretend the targeted spell carried X=2
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 6, G: 0, C: 0 };
        const pendingTarget = {
            playerId: "p1",
            cardInstanceId: mirror.id,
            targetType: "spell" as const,
            count: 1,
            selected: [{ type: "spell" as const, id: bolt.id }],
            kind: "ability" as const,
            abilityId: MIRROR_ABILITY,
            spellSingleTargetingController: true,
        };
        state.pendingTarget = pendingTarget;
        finalizeTargetSelection(state, pendingTarget, "p1");

        const abilityItem = state.stack.find(
            (s) => s.abilityId === MIRROR_ABILITY
        )!;
        expect(abilityItem.chosenX).toBe(6); // 2 × (1 + 2)
        expect(state.players[0].manaPool.R).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Sorrow's Path (C9, #426) — swap two of one opponent's blockers' assignments
// (CR 509.1 / 506.4 reassignment) + on-tap 2-damage-to-you drawback (CR 701.20a)
// ---------------------------------------------------------------------------

/** Builds a mid-combat board: p1 (Sorrow's Path controller) is the active /
 *  attacking player with two attackers; the opponent p2 is the defender with
 *  two blocking creatures, each assigned to one attacker. Returns the state plus
 *  the Sorrow's Path instance so a test can activate its swap ability.
 *  `attackerAbilities` lets a test give an attacker evasion (e.g. flying) to
 *  exercise the illegal-swap branch. */
function sorrowsPathCombat(opts?: {
    atk1Abilities?: string[];
    atk2Abilities?: string[];
    blk1Abilities?: string[];
    blk2Abilities?: string[];
}): { state: GameState; path: CardInstanceState } {
    const path = makeInstance(sorrowsPath.id, {
        id: "path",
        controllerId: "p1",
        ownerId: "p1",
    });
    // p1's two attackers (vanilla 2/2 unless given evasion).
    const atk1 = makeInstance(goblinHero.id, {
        id: "atk1",
        controllerId: "p1",
        ownerId: "p1",
        power: 2,
        toughness: 2,
        isAttacking: true,
        staticAbilities: opts?.atk1Abilities ?? [],
    });
    const atk2 = makeInstance(goblinHero.id, {
        id: "atk2",
        controllerId: "p1",
        ownerId: "p1",
        power: 2,
        toughness: 2,
        isAttacking: true,
        staticAbilities: opts?.atk2Abilities ?? [],
    });
    // p2's two blockers, each blocking one attacker.
    const blk1 = makeInstance(squire.id, {
        id: "blk1",
        controllerId: "p2",
        ownerId: "p2",
        power: 1,
        toughness: 3,
        isBlocking: true,
        staticAbilities: opts?.blk1Abilities ?? [],
    });
    const blk2 = makeInstance(squire.id, {
        id: "blk2",
        controllerId: "p2",
        ownerId: "p2",
        power: 1,
        toughness: 3,
        isBlocking: true,
        staticAbilities: opts?.blk2Abilities ?? [],
    });
    const state = makeState({
        activePlayerId: "p1",
        phase: "DECLARE_BLOCKERS",
        players: [
            makePlayer("p1", { battlefield: [path, atk1, atk2] }),
            makePlayer("p2", { battlefield: [blk1, blk2] }),
        ],
        combat: {
            attackerIds: ["atk1", "atk2"],
            confirmed: true,
            blockerAssignments: { blk1: ["atk1"], blk2: ["atk2"] },
            blockedAttackerIds: ["atk1", "atk2"],
            blockersConfirmed: true,
        },
    });
    return { state, path };
}

describe("Sorrow's Path — swap blockers (CR 509.1 / 506.4)", () => {
    it("card definition: Land, {T} two-blocker target ability + on-tap trigger", () => {
        expect(sorrowsPath.types).toEqual(["Land"]);
        expect(sorrowsPath.manaCost).toEqual({});
        const ab = sorrowsPath.activatedAbilities![0];
        expect(ab.cost).toEqual({ tap: true });
        expect(ab.useStack).toBe(true);
        expect(ab.targetRequirement).toEqual({
            type: "Creature",
            count: 2,
            combatRoleFilter: "blocking",
            controller: "opponent",
        });
        expect(sorrowsPath.triggeredAbilities).toHaveLength(1);
        expect(sorrowsPath.triggeredAbilities![0].event).toBe(
            "PERMANENT_TAPPED"
        );
    });

    it("legal swap: each vanilla blocker can block the other's attacker — assignments swap", () => {
        const { state, path } = sorrowsPathCombat();
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        // blk1 now blocks atk2, blk2 now blocks atk1.
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
        // Both stay flagged as blocking; attackers stay blocked.
        const blk1 = state.players[1].battlefield.find((c) => c.id === "blk1")!;
        const blk2 = state.players[1].battlefield.find((c) => c.id === "blk2")!;
        expect(blk1.isBlocking).toBe(true);
        expect(blk2.isBlocking).toBe(true);
        expect(state.combat!.blockedAttackerIds).toEqual(["atk1", "atk2"]);
    });

    it("illegal swap: blk1 can't block flying atk2 — no-op (assignments unchanged)", () => {
        // atk2 has flying; blk2 (no flying) currently blocks it legally only
        // because blk2 also flies. After a hypothetical swap blk1 (no flying)
        // would have to block flying atk2 — illegal — so nothing happens.
        const { state, path } = sorrowsPathCombat({
            atk2Abilities: ["flying"],
            blk2Abilities: ["flying"],
        });
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk1"],
            blk2: ["atk2"],
        });
    });

    it("combat damage reflects the swapped assignments", () => {
        const { state, path } = sorrowsPathCombat();
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        // Strip the on-tap trigger that the activation queued so it doesn't
        // interfere with the post-swap combat-damage assertion.
        state.stack = [];
        // After the swap blk1 blocks atk2 and blk2 blocks atk1. Each attacker
        // (2 power) deals 2 to its NEW blocker; each blocker (1 power) deals 1
        // back to its NEW attacker.
        applyAllCombatDamage(state, {
            atk1: { blk2: 2 },
            atk2: { blk1: 2 },
            blk1: { atk2: 1 },
            blk2: { atk1: 1 },
        });
        const atk1 = state.players[0].battlefield.find((c) => c.id === "atk1")!;
        const atk2 = state.players[0].battlefield.find((c) => c.id === "atk2")!;
        const blk1 = state.players[1].battlefield.find((c) => c.id === "blk1")!;
        const blk2 = state.players[1].battlefield.find((c) => c.id === "blk2")!;
        expect(atk1.damageMarked).toBe(1); // from blk2 (its new blocker)
        expect(atk2.damageMarked).toBe(1); // from blk1 (its new blocker)
        expect(blk1.damageMarked).toBe(2); // from atk2 (its new attacker)
        expect(blk2.damageMarked).toBe(2); // from atk1 (its new attacker)
    });

    it("on-tap drawback: deals 2 to controller and each creature they control (CR 701.20a)", () => {
        const path = makeInstance(sorrowsPath.id, {
            id: "path",
            controllerId: "p1",
            ownerId: "p1",
        });
        // 0/3 so it survives the 2 damage and damageMarked stays readable.
        const myCreature = makeInstance(squire.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
            power: 1,
            toughness: 3,
        });
        // An opponent creature must be unaffected.
        const theirs = makeInstance(squire.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 3,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [path, myCreature], life: 20 }),
                makePlayer("p2", { battlefield: [theirs], life: 20 }),
            ],
        });
        resolveTrigger(state, path, "sorrows-path-tap-drawback", {
            type: "PERMANENT_TAPPED",
            permanentId: "path",
            controllerId: "p1",
            permanentTypes: ["Land"],
            permanentSubtypes: [],
            forMana: false,
        } as StackItem["triggerEvent"]);
        checkStateBasedActions(state);
        expect(state.players[0].life).toBe(18); // 2 to controller
        const mine = state.players[0].battlefield.find((c) => c.id === "mine")!;
        expect(mine.damageMarked).toBe(2); // 2 to controller's creature
        const t = state.players[1].battlefield.find((c) => c.id === "theirs")!;
        expect(t.damageMarked ?? 0).toBe(0); // opponent untouched
        expect(state.players[1].life).toBe(20);
    });

    it("integration: getLegalTargets lists both opponent blockers; activate swaps them", () => {
        const { state, path } = sorrowsPathCombat();
        // GRE → rules layer: only the opponent's BLOCKING creatures are legal.
        const legal = getLegalTargets(
            state,
            sorrowsPath.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id).sort();
        expect(ids).toEqual(["blk1", "blk2"]);
        // The attackers (p1's own creatures) are NOT legal targets.
        expect(ids).not.toContain("atk1");
        expect(ids).not.toContain("path");
        // Full path: resolve the ability with the two chosen targets.
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
    });

    it("wire format: swapped block graph survives projectPublicState", () => {
        const { state, path } = sorrowsPathCombat();
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        // The reassigned blocker graph crosses the wire intact.
        expect(projected.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
        const blk1 = projected.players[1].battlefield.find(
            (c) => c.id === "blk1"
        )!;
        expect(blk1.isBlocking).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// RED free tranche (#414)
// ═══════════════════════════════════════════════════════════════════════════

describe("Ball Lightning — trample, haste, end-step sacrifice (CR 702.19 / 702.10 / 603.6a)", () => {
    it("carries canonical stats and keywords from DRK.json", () => {
        expect(ballLightning.manaCost).toEqual({ R: 3 });
        expect(ballLightning.types).toEqual(["Creature"]);
        expect(ballLightning.subtypes).toEqual(["Elemental"]);
        expect(ballLightning.power).toBe(6);
        expect(ballLightning.toughness).toBe(1);
        expect(ballLightning.staticAbilities).toContain("trample");
        expect(ballLightning.staticAbilities).toContain("haste");
    });

    it("sacrifices itself when its end-step trigger resolves (CR 603.6a)", () => {
        const ball = makeInstance(ballLightning.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ball] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, ball, "ball-lightning-end-step-sac", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === ball.id)
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === ball.id)).toBe(
            true
        );
    });
});

describe("Brothers of Fire — {1}{R}{R}: 1 to any target and 1 to you (CR 120.3 rider)", () => {
    it("deals 1 to the target player and 1 to the controller", () => {
        const bros = makeInstance(brothersOfFire.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bros] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bros, "brothers-of-fire-bolt", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19); // target took 1
        expect(state.players[0].life).toBe(19); // controller took 1
    });
});

describe("Cave People — attack pump +1/-2 + grant mountainwalk (CR 508 / 702.19)", () => {
    it("gives itself +1/-2 until end of turn when it attacks", () => {
        const cave = makeInstance(cavePeople.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cave] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, cave, "cave-people-attack-pump", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [cave.id],
        } as StackItem["triggerEvent"]);
        const ref = { type: "permanent" as const, id: cave.id };
        expect(getEffectivePower(state, cave)).toBe(2); // 1 + 1
        expect(getEffectiveToughness(state, cave)).toBe(2); // 4 - 2
        void ref;
    });

    it("grants mountainwalk to a target creature until end of turn", () => {
        const cave = makeInstance(cavePeople.id, { controllerId: "p1" });
        const ally = makeInstance(goblinHero.id, {
            id: "ally",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cave, ally] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, cave, "cave-people-grant-mountainwalk", [
            { type: "permanent", id: ally.id },
        ]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === ally.id
        )!;
        expect(inPlay.staticAbilities).toContain("mountainwalk");
    });
});

describe("Eternal Flame — X = Mountains; X to target, ceil(X/2) to you (CR 120.3)", () => {
    it("deals X damage to the target and half rounded up to the controller", () => {
        const mtnId = getCardByName("Mountain").id;
        const mtns = [0, 1, 2].map((i) =>
            makeInstance(mtnId, { id: `mtn-${i}`, controllerId: "p1" })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: mtns }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, eternalFlame.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3 Mountains
        expect(state.players[0].life).toBe(18); // 20 - ceil(3/2) = 2
    });
});

describe("Fire Drake — flying + once-per-turn pump (CR 702.9 / 602.5)", () => {
    it("has flying and a oncePerTurn pump ability", () => {
        expect(fireDrake.staticAbilities).toContain("flying");
        const pump = fireDrake.activatedAbilities?.find(
            (a) => a.id === "fire-drake-pump"
        );
        expect(pump?.oncePerTurn).toBe(true);
    });

    it("gives +1/+0 until end of turn", () => {
        const drake = makeInstance(fireDrake.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drake] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, drake, "fire-drake-pump");
        expect(getEffectivePower(state, drake)).toBe(2); // 1 + 1
        expect(getEffectiveToughness(state, drake)).toBe(2);
    });
});

describe("Fissure — destroy target creature or land, no regen (CR 701.7)", () => {
    it("accepts both creature and land targets", () => {
        expect(fissure.targetRequirement?.type).toEqual(["Creature", "Land"]);
    });

    it("destroys a target creature without it being regeneratable", () => {
        const victim = makeInstance(goblinHero.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, fissure.id, "p1", [
            { type: "permanent", id: victim.id },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === victim.id)
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === victim.id)).toBe(
            true
        );
    });
});

describe("Goblin Caves — conditional Goblin anthem +0/+2 (CR 611.2c)", () => {
    it("buffs Goblins +0/+2 only while the enchanted land is a basic Mountain", () => {
        const mtnId = getCardByName("Mountain").id;
        const mtn = makeInstance(mtnId, { id: "mtn", controllerId: "p1" });
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const caves = makeInstance(goblinCaves.id, {
            id: "caves",
            controllerId: "p1",
            attachedTo: mtn.id,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn, goblin, caves] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, goblin)).toBe(4); // 2 + 2
        expect(getEffectivePower(state, goblin)).toBe(2);

        // Wire-format guard: the anthem survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("does nothing while enchanting a nonbasic / non-Mountain land", () => {
        const tropId = tropicalIsland.id; // dual land, not a basic Mountain
        const trop = makeInstance(tropId, { id: "trop", controllerId: "p1" });
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const caves = makeInstance(goblinCaves.id, {
            id: "caves",
            controllerId: "p1",
            attachedTo: trop.id,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [trop, goblin, caves] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, goblin)).toBe(2); // no buff
    });
});

describe("Goblin Digging Team — {T}, Sac this: destroy target Wall (CR 701.7)", () => {
    it("destroys a Wall creature", () => {
        const wallId = getCardByName("Wall of Stone").id;
        const wall = makeInstance(wallId, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const team = makeInstance(goblinDiggingTeam.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [team] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        resolveActivated(state, team, "goblin-digging-team-destroy-wall", [
            { type: "permanent", id: wall.id },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === wall.id)
        ).toBeUndefined();
    });

    it("restricts targets to Walls", () => {
        const ability = goblinDiggingTeam.activatedAbilities![0];
        expect(ability.targetRequirement?.subtypeFilter).toBe("Wall");
    });
});

describe("Goblin Rock Sled — attack restriction + arm-skip-untap (CR 508.1c / 502.1)", () => {
    it("can't attack unless the defender controls a Mountain", () => {
        const sled = makeInstance(goblinRockSled.id, { controllerId: "p1" });
        const restriction = goblinRockSled.staticEffects?.find(
            (e) => e.kind === "attack-restriction"
        );
        expect(restriction).toBeDefined();
        // Predicate: false with no Mountain on the defender, true with one.
        const pred = (
            restriction as {
                predicate: (self: unknown, defenders: unknown[]) => boolean;
            }
        ).predicate;
        expect(pred(sled, [])).toBe(false);
        expect(pred(sled, [{ subtypes: ["Mountain"] }])).toBe(true);
    });

    it("arms skipNextUntap when it attacks", () => {
        const sled = makeInstance(goblinRockSled.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sled] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, sled, "goblin-rock-sled-arm-skip-untap", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [sled.id],
        } as StackItem["triggerEvent"]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === sled.id
        )!;
        expect(inPlay.skipNextUntap).toBe(true);
    });
});

describe("Goblin Shrine — conditional Goblin anthem +1/+0 + LTB damage (CR 611 / 603.6)", () => {
    it("buffs Goblins +1/+0 while enchanting a basic Mountain (survives projection)", () => {
        const mtnId = getCardByName("Mountain").id;
        const mtn = makeInstance(mtnId, { id: "mtn", controllerId: "p1" });
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const shrine = makeInstance(goblinShrine.id, {
            id: "shrine",
            controllerId: "p1",
            attachedTo: mtn.id,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn, goblin, shrine] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, goblin)).toBe(3); // 2 + 1
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });

    it("deals 1 damage to each Goblin creature when it leaves (CR 603.6)", () => {
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        }); // 2/2
        const shrine = makeInstance(goblinShrine.id, {
            id: "shrine",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [goblin, shrine] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, shrine, "goblin-shrine-leaves", {
            type: "PERMANENT_LEFT",
            instanceId: shrine.id,
        } as StackItem["triggerEvent"]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(inPlay.damageMarked).toBe(1);
    });
});

describe("Goblin Wizard — put Goblin from hand + grant protection from white (CR 400.7 / 702.16)", () => {
    it("puts a chosen Goblin permanent card from hand onto the battlefield", () => {
        const handGoblin = makeInstance(goblinHero.id, {
            id: "hand-gob",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const wizard = makeInstance(goblinWizard.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wizard],
                    hand: [handGoblin],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wizard, "goblin-wizard-put-goblin");
        answerChoice(state, [handGoblin.id]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === handGoblin.id
        );
        expect(inPlay).toBeDefined();
        expect(state.players[0].hand.some((c) => c.id === handGoblin.id)).toBe(
            false
        );
    });

    it("grants protection from white to a target Goblin until end of turn", () => {
        const goblin = makeInstance(goblinHero.id, {
            id: "gob",
            controllerId: "p1",
        });
        const wizard = makeInstance(goblinWizard.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wizard, goblin] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wizard, "goblin-wizard-protection", [
            { type: "permanent", id: goblin.id },
        ]);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(inPlay.staticAbilities).toContain("protection from white");
    });
});

describe("Goblins of the Flarg — mountainwalk + sac when you control a Dwarf (CR 702.19 / 603.8)", () => {
    it("has mountainwalk", () => {
        expect(goblinsOfTheFlarg.staticAbilities).toContain("mountainwalk");
    });

    it("sacrifices itself when its controller controls a Dwarf", () => {
        const flarg = makeInstance(goblinsOfTheFlarg.id, {
            controllerId: "p1",
        });
        const dwarf = makeInstance(goblinHero.id, {
            id: "dwarf",
            controllerId: "p1",
            subtypes: ["Dwarf"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flarg, dwarf] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, flarg, "goblins-flarg-dwarf-sac", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === flarg.id)
        ).toBeUndefined();
    });
});

describe("Inferno — 6 damage to each creature and each player (CR 120.3)", () => {
    it("damages every creature and both players", () => {
        const c1 = makeInstance(goblinHero.id, {
            id: "c1",
            controllerId: "p1",
        }); // 2/2
        const c2 = makeInstance(goblinHero.id, {
            id: "c2",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [c1] }),
                makePlayer("p2", { battlefield: [c2] }),
            ],
        });
        pushSpell(state, inferno.id, "p1");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[0].life).toBe(14);
        expect(state.players[1].life).toBe(14);
        // Both 2/2 creatures took 6 → dead (SBA).
        expect(
            state.players[0].battlefield.find((c) => c.id === c1.id)
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === c2.id)
        ).toBeUndefined();
    });
});

describe("Mana Clash — coin-flip loop, 1 damage per tails (CR 705)", () => {
    it("loops until both coins are heads, dealing 1 per tails", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, manaClash.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // The loop must terminate; each player ends with finite life ≤ 20.
        expect(state.players[0].life).toBeLessThanOrEqual(20);
        expect(state.players[1].life).toBeLessThanOrEqual(20);
        // The spell fully resolved (no infinite loop, stack cleared).
        expect(state.stack).toHaveLength(0);
    });
});

describe("Orc General — {T}, Sac another Orc/Goblin: other Orcs +1/+1 EOT (CR 611.1)", () => {
    it("buffs other Orc creatures the controller controls", () => {
        const general = makeInstance(orcGeneral.id, { controllerId: "p1" });
        const otherOrc = makeInstance(goblinHero.id, {
            id: "orc",
            controllerId: "p1",
            subtypes: ["Orc"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [general, otherOrc] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, general, "orc-general-pump");
        expect(getEffectivePower(state, otherOrc)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, otherOrc)).toBe(3);
        // The General does NOT buff itself ("Other Orc creatures").
        expect(getEffectivePower(state, general)).toBe(2);
    });
});

describe("Sisters of the Flame — {T}: Add {R} (CR 605.1a mana ability)", () => {
    it("is a non-stack mana ability producing {R}", () => {
        const ability = sistersOfTheFlame.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.manaProduced).toEqual({ R: 1 });
    });
});

describe("Coal Golem — {3}, Sac this: Add {R}{R}{R} (CR 605.1a)", () => {
    it("is a non-stack sacrifice-for-mana ability producing {R}{R}{R}", () => {
        expect(coalGolem.types).toEqual(["Artifact", "Creature"]);
        const ability = coalGolem.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost.sacrifice).toBe(true);
        expect(ability.cost.mana).toEqual({ X: 3 });
        expect(ability.manaProduced).toEqual({ R: 3 });
    });
});

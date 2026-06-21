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
} from "../drk";
import { tropicalIsland, mountain } from "../lea";
import { stripMine } from "../atq";
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
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { checkStateBasedActions } from "../../../gre/sba";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { getLegalTargets, getProducibleManaOptions } from "../../../gre/rules";
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
import { emitBlockersConfirmedEvents, untapStep } from "../../../gre/phases";
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

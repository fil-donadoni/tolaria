// Per-card behavior tests for colorless cards in `convex/cards/sets/lea/colorless.ts`
// (LEA, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises. Shared stack/resolve shims live in
// ./helpers; fixture builders stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    ankhOfMishra,
    badlands,
    basaltMonolith,
    bayou,
    benalishHero,
    blackVise,
    castle,
    celestialPrism,
    clockworkBeast,
    conservator,
    copperTablet,
    crystalRod,
    cyclopeanTomb,
    dingusEgg,
    disruptingScepter,
    evilPresence,
    forcefield,
    forest,
    gauntletOfMight,
    glassesOfUrza,
    grizzlyBears,
    helmOfChatzuk,
    hillGiant,
    howlingMine,
    icyManipulator,
    illusionaryMask,
    ironStar,
    ivoryCup,
    jadeMonolith,
    jadeStatue,
    jayemdaeTome,
    juggernaut,
    kormusBell,
    libraryOfLeng,
    lightningBolt,
    livingWall,
    llanowarElves,
    manaVault,
    meekstone,
    mindTwist,
    monssGoblinRaiders,
    mountain,
    moxEmerald,
    moxJet,
    moxPearl,
    moxRuby,
    moxSapphire,
    phantasmalTerrain,
    plains,
    plateau,
    prodigalSorcerer,
    rodOfRuin,
    savannah,
    savannahLions,
    scrubland,
    sengirVampire,
    serraAngel,
    smoke,
    solRing,
    soulNet,
    sunglassesOfUrza,
    swamp,
    taiga,
    theHive,
    throneOfBone,
    timeVault,
    tropicalIsland,
    tundra,
    undergroundSea,
    unholyStrength,
    wallOfSwords,
    weakness,
    winterOrb,
    woodenSphere,
} from "..";
import {
    commitLandsForCost,
    regenerateOrDestroy,
    removePermanentTo,
    resolveTopOfStack,
    runDamageReplacement,
    tapPermanent,
    emitPermanentTapped,
    emitPermanentEntered,
    processPendingActionTriggers,
    matchesPermanentFilter,
    moveCard,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    payManaCost,
    isManaCostCovered,
    getManaSubstitutions,
    grantKnowledge,
    grantKnowledgeToAll,
    clearKnowledge,
    discardCardsAtRandom,
    drawCard,
    removeFromZone,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { tapSourceIntoPayment } from "../../../../game";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import {
    getActivatedManaColor,
    getBasicLandMana,
    getFixedManaAmount,
    hasManaAbility,
} from "../../../../gre/constants";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    validateBlockerEligibility,
    mustAttack,
    getRequiredAttackerIds,
} from "../../../../gre/combat";
import {
    advancePhase,
    untapStep,
    computeHardSkipFilters,
    effectiveMaxHandSize,
    effectivePermanentView,
    finalizeCleanupDiscard,
} from "../../../../gre/phases";
import { tryGetDefinition, FACE_DOWN_CARD_ID } from "../../../index";
import { turnFaceDown, turnFaceUp } from "../../../../gre/faceDown";
import { applyTapReplacements } from "../../../../gre/replacements";
import {
    getEffectiveBlockGraph,
    outstandingDamageAssigner,
    hasBanding,
} from "../../../../gre/banding";
import { compactState, expandState } from "../../../../gre/serialize";
import type { CardType } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { grizzlyBearsId, runUntapForJ } from "./helpers";

describe("Winter Orb (modern Oracle land-only cap, CR 502.1, ADR 0004)", () => {
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

describe("Juggernaut (CR 508.1d + 509.1b)", () => {
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
        const state = makeState();
        expect(mustAttack(jug, state)).toBe(true);
        expect(mustAttack({ ...jug, isTapped: true }, state)).toBe(false);
        expect(mustAttack({ ...jug, isSummoningSick: true }, state)).toBe(
            false
        );
    });

    it("getRequiredAttackerIds picks up eligible Juggernauts only", () => {
        const eligible = makeInstance(juggernaut.id, { id: "jug1" });
        const sick = makeInstance(juggernaut.id, {
            id: "jug2",
            isSummoningSick: true,
        });
        const bears = makeInstance(savannahLions.id, { id: "bears" });
        const state = makeState();
        expect(getRequiredAttackerIds([eligible, sick, bears], state)).toEqual([
            "jug1",
        ]);
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

describe("Sol Ring ({T}: Add {C}{C}, CR 605.1a)", () => {
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
    { card: moxPearl, color: "W" as const },
    { card: moxSapphire, color: "U" as const },
    { card: moxJet, color: "B" as const },
    { card: moxRuby, color: "R" as const },
    { card: moxEmerald, color: "G" as const },
])("$card.name ({T}: Add {$color}, CR 605.1a)", ({ card, color }) => {
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
        expect(getActivatedManaColor(slim as CardInstanceState)).toBe(color);
        expect(getFixedManaAmount(slim as CardInstanceState, color)).toBe(1);
    });
});

describe("Jayemdae Tome ({4}, {T}: Draw a card, CR 602.1 + 121.1)", () => {
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

describe("Icy Manipulator ({1}, {T}: tap target artifact/creature/land, CR 701.26a)", () => {
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

    it("is a no-op when the target is already tapped (CR 701.26a)", () => {
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
            icyManipulator.activatedAbilities![0].targetRequirement!,
            NO_TARGETING_SOURCE
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

describe("Tundra (dual land: {T}: Add {W} or {U})", () => {
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
        const def = tryGetDefinition(defId);
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

describe("Basalt Monolith (does-not-untap + {T}: {C}{C}{C} + {3}: untap, CR 502.1)", () => {
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
// Terror (CR 701.8, 701.19c — destroy target nonartifact, nonblack creature)
// ---------------------------------------------------------------------------

describe("Disrupting Scepter ({3},{T}: target player discards, CR 701.9)", () => {
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
});

// ---------------------------------------------------------------------------
// Serialization: preventAllCombatDamageThisTurn round-trip
// ---------------------------------------------------------------------------

describe("preventAllCombatDamageThisTurn serialization", () => {
    it("round-trips through compactState / expandState", async () => {
        const { compactState, expandState } =
            await import("../../../../gre/serialize");
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

describe("canBlockAdditional / mustBlockAllThisTurn serialization", () => {
    it("canBlockAdditional round-trips through compactCard", async () => {
        const { compactState, expandState } =
            await import("../../../../gre/serialize");
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
            await import("../../../../gre/serialize");
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
        // CR 605.4 — Gauntlet's tap trigger is a mana ability: it resolves
        // immediately here, off the stack, so the bonus {R} is already in the
        // pool with nothing left to resolve.
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].manaPool["R"]).toBe(1);
    });
});

describe("Time Vault (skip-turn / extra-turn artifact, CR 614.10 + 500.7)", () => {
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
        expect(state.players[0].skipNextTurn).toBe(1);
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
            players: [makePlayer("p1"), makePlayer("p2", { skipNextTurn: 1 })],
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
            players: [makePlayer("p1", { skipNextTurn: 1 }), makePlayer("p2")],
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
        expect(state.players[0].skipNextTurn).toBe(1);
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

describe("skipNextTurn serialization", () => {
    it("round-trips through compactState / expandState", async () => {
        const { compactState, expandState } =
            await import("../../../../gre/serialize");
        const state = makeState({
            players: [makePlayer("p1", { skipNextTurn: 1 }), makePlayer("p2")],
        });
        const compact = compactState(state);
        const expanded = expandState(compact);
        expect(expanded.players[0].skipNextTurn).toBe(1);
        expect(expanded.players[1].skipNextTurn).toBeUndefined();
    });

    it("omitted when undefined", async () => {
        const { compactState } = await import("../../../../gre/serialize");
        const state = makeState();
        const compact = compactState(state);
        const players = compact.players as Array<Record<string, unknown>>;
        expect("skipNextTurn" in players[0]).toBe(false);
    });

    // issue #1957 — the boolean→count migration's whole point: a count > 1
    // (two accumulated skip effects, CR 614.10a) must round-trip as that
    // exact number, not collapse to a truthy flag.
    it("round-trips a count of 2 (two accumulated skips, CR 614.10a)", async () => {
        const { compactState, expandState } =
            await import("../../../../gre/serialize");
        const state = makeState({
            players: [makePlayer("p1", { skipNextTurn: 2 }), makePlayer("p2")],
        });
        const compact = compactState(state);
        const expanded = expandState(compact);
        expect(expanded.players[0].skipNextTurn).toBe(2);
    });

    // issue #1957 — backward compatibility: a row persisted BEFORE the
    // boolean→count migration carries a literal `true`. `expandPlayer` reads
    // that as exactly 1 pending skip rather than crashing or silently
    // dropping it.
    it("reads a legacy persisted boolean `true` as a count of 1", async () => {
        const { compactState, expandState } =
            await import("../../../../gre/serialize");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const compact = compactState(state) as {
            players: Array<Record<string, unknown>>;
        };
        // Simulate a pre-migration row: the OLD compactPlayer wrote a literal
        // boolean, not a count.
        compact.players[0].skipNextTurn = true;
        const expanded = expandState(
            compact as unknown as Parameters<typeof expandState>[0]
        );
        expect(expanded.players[0].skipNextTurn).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reveal-to-all (library) — ADR 0026 / PRD #338 slice 2 (#340)
// A reveal effect stamps every player onto a library card's knownTo. The card
// is then face-up to ALL players (every viewer's projection exposes it at its
// index) and stays so until the library is shuffled, which clears it for all
// (reusing slice 1's shuffle clear). This exercises the full
// GRE primitive → serialize (DB) → projection → clear path that a
// reveal-the-top-card style effect drives via SpellContext.markKnownToAll.
// ---------------------------------------------------------------------------
describe("Reveal-to-all library knowledge (ADR 0026 slice 2, CR 701.20 / 701.20)", () => {
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

    // ADR 0026 (revised) — a discard does NOT clear knowledge of the remaining
    // hand. The discarded card goes to the public graveyard and knowledge is
    // per-instance, so the cards left behind stay known to the prior knower (p1).
    it("keeps the controller's knowledge of the remaining hand after a random discard", () => {
        const state = setup();
        activateGlasses(state);
        resolveTopOfStack(state);
        commitHead(state, []);
        resolveTopOfStack(state);
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);

        // p2 discards one card at random (e.g. Hymn to Tourach style).
        discardCardsAtRandom(state, "p2", 1);

        // The remaining hand card is STILL known to p1 — the random discard of
        // the other (publicly revealed into the graveyard) introduced no
        // uncertainty about it.
        expect(state.players[1].hand.length).toBe(1);
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toEqual(["p1"]);
        }
        // The eye flag persists on p2's own view.
        const forP2 = projectPublicState(state, 1, "p2");
        for (const c of forP2.players[1].hand) {
            expect(c!.seenByOpponent).toBe(true);
        }
    });

    // ADR 0026 (revised) — an OWNER-CHOSEN discard (Disrupting Scepter: the
    // target picks the card) does NOT clear the knower's knowledge of the
    // remaining hand. h1 leaves to the public graveyard; h2 stays known to p1
    // (its identity→instance mapping is unchanged). End-to-end through the
    // mutation primitive so the GRE → game.ts → projection path is exercised.
    it("keeps the controller's knowledge of the remaining hand after an owner-chosen discard", () => {
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

        // h1 is in p2's graveyard; the remaining hand card (h2) is STILL known
        // to p1 — removing h1 introduced no uncertainty about h2.
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("h1");
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h2"]);
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toEqual(["p1"]);
        }

        // Projection: p1 still sees h2 face-up in p2's hand; p2's own view keeps
        // the eye flag. The owner's own knowledge is never affected.
        const forP1 = projectPublicState(state, 1, "p1");
        expect(forP1.players[1].hand.map((c) => c?.id)).toEqual(["h2"]);
        const forP2 = projectPublicState(state, 1, "p2");
        for (const c of forP2.players[1].hand) {
            expect(c!.seenByOpponent).toBe(true);
        }
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

    // REAL SEQUENCE (issue #1711). The test above hand-seeds the mire counter
    // and THEN calls `applySourceStaticEffects` — an ordering that never occurs
    // in play. `subtype-set` is a MATERIALIZED kind, so in a real game the
    // static pass had already run (at the Tomb's ETB, with no counter yet) and
    // nothing re-ran it when the {2},{T} ability put the counter on: the land
    // stayed a Mountain. This drives it from the real activation.
    it("the {2},{T} ability turns the land into a Swamp with no manual re-apply (CR 613.5)", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            id: "mtn-real",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const tomb = makeInstance(cyclopeanTomb.id, {
            id: "tomb-real",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(tomb);

        // ETB materialization, BEFORE any mire counter exists.
        applySourceStaticEffects(state, tomb);
        expect(mtn.subtypes).toEqual(["Mountain"]);

        state.stack.push({
            ...tomb,
            zone: "stack",
            castById: "p2",
            abilityId: "cyclopean-tomb-mire",
            targets: [{ type: "permanent", id: "mtn-real" }],
        } as StackItem);
        resolveTopOfStack(state);

        expect(mtn.counters?.mire).toBe(1);
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
});

// ---------------------------------------------------------------------------
// Lace cycle — color-change layer 5 (CR 305.7, 613.1d)
// ---------------------------------------------------------------------------

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

        const { applyAllCombatDamage } = await import("../../../../gre/phases");
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

        const { applyAllCombatDamage } = await import("../../../../gre/phases");
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

        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, { angel: { bear: 4 } });

        // Shield not consumed — attacker was blocked
        expect(p2.life).toBe(20);
        expect(state.damageCapShields).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Serialization round-trip: removedKeywords + damageCapShields
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

describe("Helm of Chatzuk (CR 611.2a temporary keyword grant)", () => {
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

describe("Banding damage-assignment handshake (CR 702.22j-k, confirmDamage)", () => {
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

    // --- Cast RESTRICTIONS bind the face-down cast too (CR 601.3a) ----------
    //
    // `ctx.castFaceDown` is the third cast that never produces a legal ACTION,
    // so it never passes through `getLegalActions` — the announce-path
    // chokepoint every other cast consumer shares. It therefore calls the
    // shared gate `castProhibitionReason` itself.
    //
    // CR 708.2 — the gate is evaluated against the FACE-DOWN characteristics (a
    // nameless 2/2 colourless creature spell with NO rules text), not the
    // printed card's: a per-player "can't cast spells this turn" lock and a
    // "can't cast creature spells" static both bind the face-down spell, while
    // a restriction printed on the card no longer exists once it is face down.
    it("a per-player cast lock forbids the masked cast — nothing leaves the hand (CR 601.3a / 708.2)", () => {
        const { state } = setup([bears("bear")]);
        // Xantid Swarm / Abeyance shape: p1 can't cast spells this turn.
        state.cannotCastSpellsThisTurn = [{ playerId: "p1" }];
        activate(state, 2);
        // The pick is still offered (the ability resolves; it is the CAST that
        // is forbidden) but nothing is cast.
        submitPick(state, ["bear"]);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("bear");
        expect(state.players[0].hand[0].faceDown).toBeUndefined();
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
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
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

// Word of Command — Acting Player foundation + land branch (#576, ADR 0037)
// ---------------------------------------------------------------------------

describe("Celestial Prism ({2}, {T}: Add one mana of any color, CR 605.1a)", () => {
    it("pays the {2} cost and taps for the chosen color", () => {
        const prism = makeInstance(celestialPrism.id, {
            id: "prism",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", {
            battlefield: [prism],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // manaChoices order is [W, U, B, R, G] — index 2 is black.
        tapSourceIntoPayment(state, player, prism, 2, []);
        expect(player.manaPool.B).toBe(1);
        expect(player.manaPool.C).toBe(0); // the {2} generic cost was spent
        expect(prism.isTapped).toBe(true);
    });

    it("wire format: tapped state and mana credit survive projectPublicState", () => {
        const prism = makeInstance(celestialPrism.id, {
            id: "prism",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", {
            battlefield: [prism],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, prism, 4, []); // index 4 is green
        expect(player.manaPool.G).toBe(1);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.G).toBe(1);
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "prism"
        )!;
        expect(slim.isTapped).toBe(true);
    });
});

describe("Living Wall (CR 701.19a regenerate)", () => {
    it("activating the regenerate ability shields it from a destroy effect", () => {
        const wall = makeInstance(livingWall.id, {
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
        state.stack.push({
            ...wall,
            zone: "stack",
            castById: "p1",
            abilityId: "living-wall-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(wall.regenerationShields).toBe(1);
        // A destroy effect (e.g. Terror) now consults `regenerateOrDestroy`:
        // the shield is consumed and the Wall survives instead of dying.
        const destroyed = regenerateOrDestroy(state, "wall");
        expect(destroyed).toBe(false);
        const onBattlefield = state.players[0].battlefield.find(
            (c) => c.id === "wall"
        );
        expect(onBattlefield).toBeDefined();
        expect(onBattlefield?.regenerationShields ?? 0).toBe(0);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("wire format: still on the battlefield (not the graveyard) after regenerating survives projection", () => {
        const wall = makeInstance(livingWall.id, {
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
        state.stack.push({
            ...wall,
            zone: "stack",
            castById: "p1",
            abilityId: "living-wall-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        regenerateOrDestroy(state, "wall");
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "wall")
        ).toBe(true);
        expect(projected.players[0].graveyard).toHaveLength(0);
    });
});

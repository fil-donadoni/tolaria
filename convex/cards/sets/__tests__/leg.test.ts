// Legends (LEG) — per-card behavior tests (twin of arn.test.ts / leb.test.ts).
// Each non-trivial card gets a describe block citing the CR section it
// exercises. Tests assert external behavior only (definition shape, zone after
// resolution, projected wire-format characteristics), per the PRD testing
// decisions (#369).
//
// THIS slice covers the walking skeleton (#370): the set is registered and a
// pair of vanilla legendary creatures resolve from the stack onto the
// battlefield and survive projection carrying the Legendary supertype.

import { describe, it, expect } from "vitest";
import {
    jasmineBoreal,
    ladyOrca,
    tundraWolves,
    thunderSpirit,
    wallOfLight,
    righteousAvengers,
    keepersOfTheFaith,
    amrouKithkin,
    angelicVoices,
    ivoryGuardians,
    fortifiedArea,
    divineTransformation,
    seeker,
    spiritLink,
    cleanse,
    divineOffering,
    greatDefender,
    shieldWall,
    holyDay,
    indestructibleAura,
    alabasterPotion,
    spiritualSanctuary,
    lifeblood,
    presenceOfTheMaster,
    visions,
    azureDrake,
    zephyrFalcon,
    devouringDeep,
    segovianLeviathan,
    psionicEntity,
    wallOfWonder,
    backfire,
    flashCounter,
    removeSoul,
    forceSpike,
    boomerang,
    acidRain,
    flashFlood,
    seaKingsBlessing,
    partWater,
    teleport,
    energyTap,
    reset,
    headlessHorseman,
    lostSoul,
    carrionAnts,
    walkingDead,
    ghostsOfTheDamned,
    fallenAngel,
    hellsCaretaker,
    blight,
    hellSwarm,
    hellfire,
    syphonSoul,
    jovialEvil,
    touchOfDarkness,
    horrorOfHorrors,
    cyclopeanMummy,
    greed,
    sylvanLibrary,
    darkness,
    crimsonKobolds,
    crookshankKobolds,
    koboldsOfKherKeep,
    ragingBull,
    mountainYeti,
    wallOfEarth,
    wallOfHeat,
    koboldTaskmaster,
    koboldDrillSergeant,
    koboldOverlord,
    beastsOfBogardan,
    spinalVillain,
    hyperionBlacksmith,
    wallOfOpposition,
    giantStrength,
    immolation,
    eternalWarrior,
    theBrute,
    dwarvenSong,
    bloodLust,
    glyphOfDestruction,
    activeVolcano,
    windsOfChange,
    barbaryApes,
    durkwoodBoars,
    mossMonster,
    catWarriors,
    hornetCobra,
    elvenRiders,
    rabidWombat,
    emeraldDragonfly,
    fireSprites,
    killerBees,
    pixieQueen,
    pradeshGypsies,
    stormSeeker,
    typhoon,
    winterBlast,
    sylvanParadise,
    barktoothWarbeard,
    jeditOjanen,
    jerrardOfTheClosedFist,
    kasimirTheLoneWolf,
    sirShandlarOfEberyn,
    sivitriScarzam,
    theLadyOfTheMountain,
    tobiasAndrion,
    torstenVonUrsus,
    ramirezDePietro,
    dakkonBlackblade,
    jacquesLeVert,
    solkanarTheSwampKing,
    adunOakenshield,
    angusMackenzie,
    borisDevilboon,
    gwendlynDiCorci,
    keiTakahashi,
    pavelMaliki,
    ragnar,
    tuknirDeathlock,
    xiraArien,
    princessLucrezia,
    rivenTurnbull,
    sunastianFalconer,
    manaMatrix,
    planarGate,
    relicBarrier,
    alchorsTomb,
    mirrorUniverse,
    pendelhaven,
    concordantCrossroads,
    gravitySphere,
    aerathiBerserker,
    frostGiant,
    crawGiant,
    wolverinePack,
    chromium,
    hundingGjornersen,
    marhaultElsdragon,
    adventurersGuildhouse,
    cathedralOfSerra,
    mountainStronghold,
    seafarersQuay,
    unholyCitadel,
    masterOfTheHunt,
    shelkinBrownie,
    tolaria,
    spectralCloak,
    antiMagicAura,
    bartelRuneaxe,
    arcadesSabboth,
    nicolBolas,
    palladiaMors,
    vaevictisAsmadi,
    cosmicHorror,
    moldDemon,
    theTabernacleAtPendrellVale,
    spiritShackle,
    venarianGold,
    cocoon,
    whirlingDervish,
    primordialOoze,
    rasputinDreamweaver,
    divineIntervention,
} from "../leg";
import { getCardById, getCardByName, getAllCards } from "../../index";
import { getLegalTargets } from "../../../gre/rules";
import { isGuardedAgainst } from "../../../gre/permanentGuard";
import {
    fireDelayedTriggers,
    emitBlockersConfirmedEvents,
    advancePhase,
    finalizeCleanup,
} from "../../../gre/phases";
import {
    recordBlockedAttackers,
    isLegalBandComposition,
} from "../../../gre/banding";
import {
    lightningBolt,
    mountain,
    forest,
    island,
    swamp,
    grizzlyBears,
    crusade,
    castle,
} from "../lea";
import {
    resolveTopOfStack,
    removePermanentTo,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    getCostModifiers,
    applyCostModifiers,
    normalizeManaCost,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { collectTriggers } from "../../../gre/triggers";
import { effectiveTriggeredAbilities } from "../../../gre/copy";
import { applyMayPaySubmit } from "../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../gre/layers";
import { validateBlockerEligibility } from "../../../gre/combat";
import { checkStateBasedActions } from "../../../gre/sba";
import { applyPendingChoiceSubmit } from "../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";

// --- helpers (mirrors arn.test.ts) ----------------------------------------

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

/** Push an activated ability onto the stack with its cost assumed already
 *  paid (mirrors the post-`activateAbility` state), then resolve it. */
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

// ---------------------------------------------------------------------------
// Sylvan Library — draw-step extra draws + per-card pay-4-or-topdeck.
// ---------------------------------------------------------------------------

const drawStepEvent: StackItem["triggerEvent"] = {
    type: "PHASE_BEGIN",
    phase: "DRAW",
    activePlayerId: "p1",
};

/** Builds a p1 board with Sylvan Library, a hand, a library, a `drawnThisTurn`
 *  tally, and a life total. Filler cards reuse `greed.id` (art only). */
function makeSylvanState(opts: {
    handIds: string[];
    libIds: string[];
    drawnThisTurn: string[];
    life?: number;
}): { state: GameState; sylvan: CardInstanceState } {
    const sylvan = makeInstance(sylvanLibrary.id, {
        id: "sylvan",
        controllerId: "p1",
    });
    const hand = opts.handIds.map((id) =>
        makeInstance(greed.id, { id, controllerId: "p1", zone: "hand" })
    );
    const library = opts.libIds.map((id) =>
        makeInstance(greed.id, { id, controllerId: "p1", zone: "library" })
    );
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [sylvan],
                hand,
                library,
                drawnThisTurn: opts.drawnThisTurn,
                life: opts.life ?? 20,
            }),
            makePlayer("p2"),
        ],
    });
    return { state, sylvan };
}

describe("Sylvan Library (draw step: draw two, pay 4 life or topdeck each)", () => {
    it("draws two, scopes the pick to cards drawn this turn, pays for one and topdecks the other", () => {
        // h0 was drawn this turn (e.g. the turn-based draw); x9 was not.
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0", "x9"],
            libIds: ["l0", "l1", "l2"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        // Step 0 — "you may draw two additional cards".
        answerChoice(state, ["draw"]);
        const p1 = () => state.players[0];
        // Drew l0, l1 exactly once (library 3 → 1, hand 2 → 4).
        expect(p1().library.length).toBe(1);
        expect(p1().hand.map((c) => c.id)).toEqual(["h0", "x9", "l0", "l1"]);
        // The pick is restricted to cards drawn this turn — x9 is excluded.
        expect(state.pendingChoices?.[0]?.choiceId).toBe("sylvan-pick");
        expect(state.pendingChoices?.[0]?.candidateIds).toEqual([
            "h0",
            "l0",
            "l1",
        ]);

        answerChoice(state, ["l0", "l1"]); // choose two
        answerChoice(state, ["pay"]); // l0 — pay 4 life, keep it
        answerChoice(state, ["top"]); // l1 — put on top of library

        expect(p1().life).toBe(16);
        expect(p1().hand.map((c) => c.id)).toEqual(["h0", "x9", "l0"]);
        expect(p1().library[0]?.id).toBe("l1"); // back on top
        expect(state.stack.length).toBe(0);
    });

    it("declining the draw ends the resolution with no choices and no changes", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["decline"]);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["h0"]);
        expect(p1.library.length).toBe(2);
        expect(p1.life).toBe(20);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack.length).toBe(0);
    });

    it("forces a topdeck when the player can't pay 4 life again (sequential CR 119.4)", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
            life: 6,
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]); // draw l0, l1
        answerChoice(state, ["h0", "l0"]); // choose two
        answerChoice(state, ["pay"]); // h0 — pay 4 (life 6 → 2)
        // Second card: life is now 2 (< 4), so it is auto-topdecked with NO
        // further prompt — the resolution is already complete.
        const p1 = state.players[0];
        expect(p1.life).toBe(2);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(p1.library[0]?.id).toBe("l0"); // forced onto the library
        expect(p1.hand.map((c) => c.id)).toEqual(["h0", "l1"]);
        expect(state.stack.length).toBe(0);
    });

    it("drives the full draw → pick → pay/topdeck chain through the real submit mutations", () => {
        // Integration: every choice resumes via the production
        // `applyPendingChoiceSubmit` (not the test injector), so the
        // candidateIds allow-list and option legality are exercised end-to-end.
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1", "l2"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        const submit = (ids: string[]) => {
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ids,
            });
        };
        submit(["draw"]); // option-pick: draw two (l0, l1)
        // A card NOT drawn this turn is rejected by the candidateIds allow-list.
        expect(() => submit(["l2"])).toThrow();
        submit(["h0", "l1"]); // choose-hand-card: two drawn-this-turn cards
        submit(["top"]); // h0 → top of library
        submit(["pay"]); // l1 → pay 4 life, keep

        const p1 = state.players[0];
        expect(p1.life).toBe(16);
        expect(p1.library[0]?.id).toBe("h0");
        expect(p1.hand.map((c) => c.id)).toEqual(["l0", "l1"]);
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
    });

    it("the life payment and library top survive the wire projection", () => {
        const { state, sylvan } = makeSylvanState({
            handIds: ["h0"],
            libIds: ["l0", "l1"],
            drawnThisTurn: ["h0"],
        });
        resolveTrigger(
            state,
            sylvan,
            "sylvan-library-draw-step",
            drawStepEvent
        );
        answerChoice(state, ["draw"]);
        answerChoice(state, ["h0", "l0"]);
        answerChoice(state, ["pay"]); // h0 — pay 4
        answerChoice(state, ["top"]); // l0 — topdeck
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(16);
        expect(projected.players[0].library.count).toBe(1);
        // h0 paid (kept), l0 topdecked, l1 still in hand → 2 cards in hand.
        expect(projected.players[0].hand.length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Registry parity (ADR 0014) — the `leg` set is registered.
// ---------------------------------------------------------------------------

describe("LEG registry parity", () => {
    it("registers the skeleton legendary creatures by id", () => {
        expect(getCardById(jasmineBoreal.id)).toBe(jasmineBoreal);
        expect(getCardById(ladyOrca.id)).toBe(ladyOrca);
    });

    it("registers them by name (debug-panel / pool lookup path)", () => {
        // The Debug-panel preset scenario and the card pool both resolve cards
        // by name via getCardByName (game.ts seedScenario) — registration alone
        // must make the cards reachable.
        expect(getCardByName("Jasmine Boreal")).toBe(jasmineBoreal);
        expect(getCardByName("Lady Orca")).toBe(ladyOrca);
    });

    it("includes them in getAllCards (deck-builder index)", () => {
        const all = getAllCards();
        expect(all).toContain(jasmineBoreal);
        expect(all).toContain(ladyOrca);
    });
});

// ---------------------------------------------------------------------------
// Vanilla legendary creatures (CR 205.4a — Legendary supertype as data)
// ---------------------------------------------------------------------------

describe("Jasmine Boreal (vanilla legendary creature, CR 205.4a)", () => {
    it("carries the Legendary supertype with the canonical stats", () => {
        expect(jasmineBoreal.types).toEqual(["Creature"]);
        expect(jasmineBoreal.supertypes).toEqual(["Legendary"]);
        expect(jasmineBoreal.power).toBe(4);
        expect(jasmineBoreal.toughness).toBe(5);
        expect(jasmineBoreal.manaCost).toEqual({ X: 3, G: 1, W: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, jasmineBoreal.id, "p1");
        resolveTopOfStack(state);
        const p1 = state.players[0];
        const inPlay = p1.battlefield.find((c) => c.id === item.id);
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Lady Orca (vanilla legendary creature, CR 205.4a)", () => {
    it("carries the Legendary supertype with the canonical stats", () => {
        expect(ladyOrca.types).toEqual(["Creature"]);
        expect(ladyOrca.supertypes).toEqual(["Legendary"]);
        expect(ladyOrca.power).toBe(7);
        expect(ladyOrca.toughness).toBe(4);
        expect(ladyOrca.manaCost).toEqual({ X: 5, B: 1, R: 1 });
    });

    it("resolves onto the battlefield and survives projection as Legendary", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its Legendary supertype must be recoverable from the
        // registry by id after projectPublicState (CR 205.4a survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, ladyOrca.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.supertypes).toContain("Legendary");
    });
});

// ---------------------------------------------------------------------------
// White free tranche (#371)
// ---------------------------------------------------------------------------

describe("LEG white keyword / vanilla creatures (CR 702)", () => {
    it("Tundra Wolves has first strike", () => {
        expect(tundraWolves.staticAbilities).toContain("first strike");
    });
    it("Thunder Spirit has flying and first strike", () => {
        expect(thunderSpirit.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "first strike"])
        );
    });
    it("Wall of Light has defender and protection from black", () => {
        expect(wallOfLight.staticAbilities).toEqual(
            expect.arrayContaining(["defender", "protection from black"])
        );
    });
    it("Righteous Avengers has plainswalk", () => {
        expect(righteousAvengers.staticAbilities).toContain("plainswalk");
    });
    it("Keepers of the Faith is a vanilla 2/3", () => {
        expect(keepersOfTheFaith.power).toBe(2);
        expect(keepersOfTheFaith.toughness).toBe(3);
        expect(keepersOfTheFaith.staticAbilities).toBeUndefined();
    });
});

describe("Amrou Kithkin (can't be blocked by power ≥3, CR 509.1b)", () => {
    function setup(blockerPower: number) {
        const attacker = makeInstance(amrouKithkin.id, {
            id: "amrou",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "blk",
            controllerId: "p2",
            power: blockerPower,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, attacker, blocker };
    }
    it("a power-2 creature may block it", () => {
        const { state, attacker, blocker } = setup(2);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
    it("a power-3 creature may not block it", () => {
        const { state, attacker, blocker } = setup(3);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });
});

describe("Angelic Voices (+1/+1 while no nonartifact nonwhite creature, CR 611)", () => {
    it("buffs your creatures only while the condition holds (GRE + wire)", () => {
        const voices = makeInstance(angelicVoices.id, {
            id: "voices",
            controllerId: "p1",
        });
        const knight = makeInstance(keepersOfTheFaith.id, {
            id: "knight",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [voices, knight] }),
                makePlayer("p2"),
            ],
        });
        // White creature only on board → anthem active.
        expect(getEffectivePower(state, knight)).toBe(3);
        expect(getEffectiveToughness(state, knight)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "knight"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);

        // Add a nonwhite, nonartifact creature → condition fails, anthem off.
        const ogre = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "ogre",
            controllerId: "p1",
        }); // Hill Giant (red)
        state.players[0].battlefield.push(ogre);
        expect(getEffectivePower(state, knight)).toBe(2);
        expect(getEffectiveToughness(state, knight)).toBe(3);
    });
});

describe("Ivory Guardians (protection from red + conditional anthem, CR 611/702.16)", () => {
    it("has protection from red", () => {
        expect(ivoryGuardians.staticAbilities).toContain("protection from red");
    });
    it("named copies get +1/+1 only while an opponent has a nontoken red permanent", () => {
        const guard = makeInstance(ivoryGuardians.id, {
            id: "guard",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guard] }),
                makePlayer("p2"),
            ],
        });
        // No opponent red permanent yet.
        expect(getEffectivePower(state, guard)).toBe(3);

        const redOgre = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "ogre",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(redOgre);
        expect(getEffectivePower(state, guard)).toBe(4);
        expect(getEffectiveToughness(state, guard)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "guard"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
});

describe("Fortified Area (Walls you control +1/+0 and have banding, CR 611)", () => {
    it("buffs and grants banding to your Walls only (GRE + wire)", () => {
        const area = makeInstance(fortifiedArea.id, {
            id: "area",
            controllerId: "p1",
        });
        const wall = makeInstance(wallOfLight.id, {
            id: "wall",
            controllerId: "p1",
        });
        const oppWall = makeInstance(wallOfLight.id, {
            id: "oppwall",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [area, wall] }),
                makePlayer("p2", { battlefield: [oppWall] }),
            ],
        });
        expect(getEffectivePower(state, wall)).toBe(2); // 1 + 1
        expect(getEffectivePower(state, oppWall)).toBe(1); // not yours

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wall"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
    });
    it("declares the banding keyword-grant filtered to your Walls", () => {
        const grant = fortifiedArea.staticEffects?.find(
            (e) => e.kind === "keyword-grant"
        );
        expect(grant).toBeDefined();
        expect(grant && "keyword" in grant && grant.keyword).toBe("banding");
    });
});

describe("Divine Transformation (aura +3/+3, CR 303.4)", () => {
    it("grants +3/+3 to the host (GRE + wire)", () => {
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
            power: 2,
            toughness: 2,
        });
        const aura = makeInstance(divineTransformation.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(5);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
    });
});

describe("Seeker (host can't be blocked except by artifact/white creatures, CR 509.1b)", () => {
    function setup(blockerCardId: string) {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
            isAttacking: true,
        }); // Hill Giant (nonwhite, nonartifact)
        const aura = makeInstance(seeker.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const blocker = makeInstance(blockerCardId, {
            id: "blk",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, host, blocker };
    }
    it("a white creature may block the enchanted creature", () => {
        // Savannah Lions is white.
        const { state, host, blocker } = setup(
            "d05b92bd-797e-413f-a8b0-32e0937a1ee0"
        );
        expect(
            validateBlockerEligibility(
                host,
                blocker,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
    });
    it("a nonwhite, nonartifact creature may not block it", () => {
        // Hill Giant is red and nonartifact.
        const { state, host, blocker } = setup(
            "0ddb98e8-13fe-4786-83f7-b72c56db135a"
        );
        expect(
            validateBlockerEligibility(
                host,
                blocker,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(false);
    });
});

describe("Spirit Link (gain life when enchanted creature deals damage, CR 303.4)", () => {
    it("gains life equal to damage dealt by the host", () => {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
        });
        const aura = makeInstance(spiritLink.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, aura, "spirit-link-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "host",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 3,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(23);
    });
});

describe("Cleanse (destroy all black creatures, CR 701.7)", () => {
    it("destroys black creatures and spares others", () => {
        // Scathe Zombies (black) dies; Hill Giant (red) survives.
        const zombie = makeInstance("e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", {
            id: "zombie",
            controllerId: "p2",
        });
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "giant",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [zombie, giant] }),
            ],
        });
        pushSpell(state, cleanse.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "zombie")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "giant")
        ).toBeDefined();
    });
});

describe("Divine Offering (destroy artifact + gain life = MV, CR 701.7)", () => {
    it("destroys the artifact and gains life equal to its mana value", () => {
        const artifact = makeInstance("4b71ff49-ee0a-4065-9131-380468d62a30", {
            id: "art",
            controllerId: "p2",
        }); // Flying Carpet (MV 4) from arn
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        pushSpell(state, divineOffering.id, "p1", [
            { type: "permanent", id: "art" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(24); // 20 + MV 4
    });
});

describe("Great Defender (+0/+X where X = target's MV, CR 202.3)", () => {
    it("buffs toughness by the target's mana value until end of turn", () => {
        // Serra Angel MV 5.
        const angel = makeInstance("f8ac5006-91bd-4803-93da-f87cf196dd2f", {
            id: "angel",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2"),
            ],
        });
        const baseTough = getEffectiveToughness(state, angel);
        pushSpell(state, greatDefender.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        expect(getEffectiveToughness(state, angel)).toBe(baseTough + 5);
    });
});

describe("Shield Wall (+0/+2 to your creatures EOT, CR 611.1)", () => {
    it("buffs every creature you control", () => {
        const c1 = makeInstance(keepersOfTheFaith.id, {
            id: "c1",
            controllerId: "p1",
        });
        const c2 = makeInstance(keepersOfTheFaith.id, {
            id: "c2",
            controllerId: "p1",
        });
        const opp = makeInstance(keepersOfTheFaith.id, {
            id: "opp",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [c1, c2] }),
                makePlayer("p2", { battlefield: [opp] }),
            ],
        });
        pushSpell(state, shieldWall.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectiveToughness(state, c1)).toBe(5); // 3 + 2
        expect(getEffectiveToughness(state, c2)).toBe(5);
        expect(getEffectiveToughness(state, opp)).toBe(3); // unaffected
    });
});

describe("Holy Day (prevent all combat damage this turn, CR 615)", () => {
    it("sets the combat-damage prevention flag", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, holyDay.id, "p1");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

describe("Indestructible Aura (prevent all damage to target this turn, CR 615)", () => {
    it("records a damage-prevention shield on the target", () => {
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, indestructibleAura.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect((state.targetPreventionShields ?? []).length).toBeGreaterThan(0);
    });
});

describe("Alabaster Potion (modal: gain X life / prevent X damage, CR 700.2)", () => {
    it("gain-life mode gives the target player X life", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, alabasterPotion.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenModeId = "gain-life";
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
    });
});

describe("Spiritual Sanctuary (upkeep: if Plains, gain 1, CR 603.6a)", () => {
    it("grants 1 life on the upkeep of a player controlling a Plains", () => {
        const sanct = makeInstance(spiritualSanctuary.id, {
            id: "sanct",
            controllerId: "p1",
        });
        const plains = makeInstance("b1623d57-4729-4796-b3f7-f1837a05c6ed", {
            id: "plains",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sanct, plains] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, sanct, "spiritual-sanctuary-lifegain", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Lifeblood (opponent's Mountain tapped → gain 1, CR 701.20a)", () => {
    it("gains 1 life when an opponent's Mountain becomes tapped", () => {
        const lb = makeInstance(lifeblood.id, {
            id: "lb",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lb] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, lb, "lifeblood-mountain-tapped", {
            type: "PERMANENT_TAPPED",
            permanentId: "mtn",
            controllerId: "p2",
            permanentTypes: ["Land"],
            permanentSubtypes: ["Mountain"],
            forMana: false,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Presence of the Master (counter enchantment spells, CR 701.5a)", () => {
    it("counters an enchantment spell cast by any player", () => {
        const presence = makeInstance(presenceOfTheMaster.id, {
            id: "presence",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [presence] }),
                makePlayer("p2"),
            ],
        });
        // An enchantment spell on the stack (Spiritual Sanctuary as a stand-in).
        const ench = pushSpell(state, spiritualSanctuary.id, "p2");
        resolveTrigger(state, presence, "presence-of-the-master-counter", {
            type: "SPELL_CAST",
            casterId: "p2",
            spellInstanceId: ench.id,
            spellCardId: spiritualSanctuary.id,
            spellTypes: ["Enchantment"],
            spellSubtypes: [],
            spellColors: ["W"],
        } as StackItem["triggerEvent"]);
        expect(state.stack.find((s) => s.id === ench.id)).toBeUndefined();
    });
});

describe("Visions (look at top 5, may shuffle, CR 401.4)", () => {
    it("marks the top five cards known to the caster then optionally shuffles", () => {
        const lib = Array.from({ length: 6 }, (_, i) =>
            makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
                id: `lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library: lib })],
        });
        pushSpell(state, visions.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // Suspended on the may-shuffle choice — answer "decline" (no shuffle).
        const top5 = state.players[1].library.slice(0, 5);
        expect(top5.every((c) => c.knownTo?.includes("p1"))).toBe(true);
        answerChoice(state, ["no"]);
        // No throw; resolution completed.
        expect(state.stack).toHaveLength(0);
    });
});

// ===========================================================================
// Blue free tranche (#372)
// ===========================================================================

// commit a single pending may-pay/choice head (shared by the counterspell
// and Recall-style tests below).
function commitHead(state: GameState, picks: string[]): void {
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

describe("LEG blue keyword / vanilla creatures (CR 702)", () => {
    it("Azure Drake has flying with canonical stats", () => {
        expect(azureDrake.staticAbilities).toContain("flying");
        expect(azureDrake.power).toBe(2);
        expect(azureDrake.toughness).toBe(4);
    });

    it("Zephyr Falcon has flying and vigilance", () => {
        expect(zephyrFalcon.staticAbilities).toEqual(["flying", "vigilance"]);
    });

    it("Devouring Deep and Segovian Leviathan have islandwalk", () => {
        expect(devouringDeep.staticAbilities).toContain("islandwalk");
        expect(segovianLeviathan.staticAbilities).toContain("islandwalk");
    });
});

describe("Psionic Entity ({T}: 2 to any target, 3 to itself, CR 120.1)", () => {
    it("deals 2 to the target and 3 to itself", () => {
        const pe = makeInstance(psionicEntity.id, {
            id: "pe",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pe] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...pe,
            zone: "stack",
            castById: "p1",
            abilityId: "psionic-entity-zap",
            targets: [{ type: "player", id: "p2" }],
        } as StackItem);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - 2
        // 3 damage marked on itself (CR 120.3) — lethal vs toughness 2 → dies.
        const self = state.players[0].battlefield.find((c) => c.id === "pe");
        expect(self).toBeUndefined();
    });
});

describe("Wall of Wonder (animate pump, CR 702.3 / 611.1)", () => {
    it("gives +4/-4 and grants the defender-suspend keyword until EOT", () => {
        const ww = makeInstance(wallOfWonder.id, {
            id: "ww",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ww] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, ww)).toBe(1);
        state.stack.push({
            ...ww,
            zone: "stack",
            castById: "p1",
            abilityId: "wall-of-wonder-animate",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const animated = state.players[0].battlefield.find(
            (c) => c.id === "ww"
        )!;
        expect(getEffectivePower(state, animated)).toBe(5); // 1 + 4
        expect(getEffectiveToughness(state, animated)).toBe(1); // 5 - 4
        expect(animated.staticAbilities).toContain("can-attack-with-defender");
    });
});

describe("Backfire (reflect host's damage to you back to its controller)", () => {
    it("deals damage to the host's controller equal to the reflected amount", () => {
        // Aura host controlled by p2; aura controlled by p1.
        const host = makeInstance(azureDrake.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(backfire.id, {
            id: "aura",
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
        resolveTrigger(state, aura, "backfire-reflect", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "host",
            sourceControllerId: "p2",
            target: { type: "player", id: "p1" },
            amount: 2,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        expect(state.players[1].life).toBe(18); // p2 (host controller) takes 2
    });
});

describe("Flash Counter / Remove Soul (type-restricted counters, CR 701.5a)", () => {
    it("Flash Counter counters an instant on the stack", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, flashCounter.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("Remove Soul restricts to creature spells via spellTypeFilter", () => {
        expect(removeSoul.targetRequirement?.spellTypeFilter).toBe("Creature");
        expect(flashCounter.targetRequirement?.spellTypeFilter).toBe("Instant");
    });
});

describe("Force Spike (counter unless controller pays {1}, CR 701.5a)", () => {
    it("counters the spell when the controller declines to pay", () => {
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceSpike.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("may-pay");
        commitHead(state, ["no"]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
    });

    it("lets the spell resolve when the controller pays {1}", () => {
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, p2] });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceSpike.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        commitHead(state, ["yes"]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
    });
});

describe("Boomerang (return target permanent to hand, CR 701.10)", () => {
    it("bounces a permanent to its owner's hand", () => {
        const drake = makeInstance(azureDrake.id, {
            id: "drake",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [drake] }),
            ],
        });
        pushSpell(state, boomerang.id, "p1", [
            { type: "permanent", id: "drake" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "drake")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "drake")).toBe(true);
    });
});

describe("Acid Rain (destroy all Forests, CR 701.7)", () => {
    it("destroys Forests and spares other lands", () => {
        const f = makeInstance(forest.id, {
            id: "f",
            controllerId: "p2",
            ownerId: "p2",
        });
        const m = makeInstance(mountain.id, {
            id: "m",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [f, m] }),
            ],
        });
        pushSpell(state, acidRain.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "f")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "m")
        ).toBeDefined();
    });
});

describe("Flash Flood (modal: destroy red / return Mountain, CR 700.2)", () => {
    it("return-mountain mode bounces a Mountain to hand", () => {
        const m = makeInstance(mountain.id, {
            id: "m",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { battlefield: [m] })],
        });
        const item = pushSpell(state, flashFlood.id, "p1", [
            { type: "permanent", id: "m" },
        ]);
        item.chosenModeId = "return-mountain";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "m")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "m")).toBe(true);
    });
});

describe("Sea Kings' Blessing (creatures become blue EOT, CR 305.7 layer 5)", () => {
    it("makes targeted creatures blue, surviving projection (wire format)", () => {
        const drake = makeInstance(azureDrake.id, {
            id: "drake",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Use a white creature so the colour change is observable.
        const lion = makeInstance(keepersOfTheFaith.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drake, lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, seaKingsBlessing.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(STATIC_EFFECT_CTX.getColors(lion)).toEqual(["U"]);

        // Wire format: the colour override survives projection.
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(slim)).toEqual(["U"]);
    });
});

describe("Part Water (X creatures gain islandwalk EOT, CR 702.19)", () => {
    it("grants islandwalk to each target", () => {
        const a = makeInstance(keepersOfTheFaith.id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(keepersOfTheFaith.id, {
            id: "b",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, partWater.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield
                .find((c) => c.id === "a")!
                .staticAbilities?.includes("islandwalk")
        ).toBe(true);
        expect(
            state.players[0].battlefield
                .find((c) => c.id === "b")!
                .staticAbilities?.includes("islandwalk")
        ).toBe(true);
    });
});

describe("Teleport (target creature can't be blocked, CR 509.1b)", () => {
    it("only castable during declare attackers and marks the target unblockable", () => {
        expect(teleport.castPhaseRestriction).toEqual(["DECLARE_ATTACKERS"]);
        const atk = makeInstance(azureDrake.id, {
            id: "atk",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [atk] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, teleport.id, "p1", [{ type: "permanent", id: "atk" }]);
        resolveTopOfStack(state);
        const marked = state.players[0].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(marked.cantBeBlockedThisTurn).toBe(true);
    });
});

describe("Energy Tap (tap your creature, add {C}=MV, CR 106.1)", () => {
    it("taps the creature and adds colorless equal to its mana value", () => {
        // Azure Drake MV 4.
        const drake = makeInstance(azureDrake.id, {
            id: "drake",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drake] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, energyTap.id, "p1", [
            { type: "permanent", id: "drake" },
        ]);
        resolveTopOfStack(state);
        const tapped = state.players[0].battlefield.find(
            (c) => c.id === "drake"
        )!;
        expect(tapped.isTapped).toBe(true);
        expect(state.players[0].manaPool.C).toBe(4);
    });
});

describe("Reset (untap your lands, opponent-turn only, CR 117.1b)", () => {
    it("is restricted to the opponent's turn and untaps the caster's lands", () => {
        expect(reset.castTurnRestriction).toBe("opponent");
        const land = makeInstance(island.id, {
            id: "isl",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, reset.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "isl")!.isTapped
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Black free tranche (#373)
// ---------------------------------------------------------------------------

describe("LEG black keyword / vanilla creatures (CR 702)", () => {
    it("Headless Horseman is a vanilla 2/2 with no abilities", () => {
        expect(headlessHorseman.power).toBe(2);
        expect(headlessHorseman.toughness).toBe(2);
        expect(headlessHorseman.staticAbilities ?? []).toEqual([]);
        expect(headlessHorseman.triggeredAbilities).toBeUndefined();
        expect(headlessHorseman.activatedAbilities).toBeUndefined();
    });
    it("Lost Soul has swampwalk", () => {
        expect(lostSoul.staticAbilities).toContain("swampwalk");
    });
    it("Fallen Angel has flying", () => {
        expect(fallenAngel.staticAbilities).toContain("flying");
    });
});

describe("Carrion Ants ({1}: +1/+1 EOT, CR 611.1)", () => {
    it("pumps itself by +1/+1 until end of turn (repeatable)", () => {
        const ants = makeInstance(carrionAnts.id, {
            id: "ants",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ants] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, ants)).toBe(0);
        expect(getEffectiveToughness(state, ants)).toBe(1);
        // Activate twice.
        for (let i = 0; i < 2; i++) {
            state.stack.push({
                ...ants,
                zone: "stack",
                castById: "p1",
                abilityId: "carrion-ants-pump",
                targets: [],
            } as StackItem);
            resolveTopOfStack(state);
        }
        const live = state.players[0].battlefield.find((c) => c.id === "ants")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
        // Wire format: the buff survives projection.
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ants"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Walking Dead ({B}: Regenerate this, CR 701.15a)", () => {
    it("arms a regeneration shield on itself", () => {
        const wd = makeInstance(walkingDead.id, {
            id: "wd",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wd] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wd,
            zone: "stack",
            castById: "p1",
            abilityId: "walking-dead-regenerate",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wd")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe("Ghosts of the Damned ({T}: target -1/-0 EOT, CR 611.1)", () => {
    it("debuffs the target's power by 1 until end of turn", () => {
        const ghosts = makeInstance(ghostsOfTheDamned.id, {
            id: "ghosts",
            controllerId: "p1",
        });
        const bear = makeInstance(headlessHorseman.id, {
            id: "bear",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ghosts] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        state.stack.push({
            ...ghosts,
            zone: "stack",
            castById: "p1",
            abilityId: "ghosts-of-the-damned-debuff",
            targets: [{ type: "permanent", id: "bear" }],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(1);
    });
});

describe("Fallen Angel (Sacrifice a creature: +2/+1 EOT, CR 602.1/611.1)", () => {
    it("sacrifices a creature and pumps itself +2/+1", () => {
        const angel = makeInstance(fallenAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = makeInstance(headlessHorseman.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel, fodder] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, angel)).toBe(3);
        state.stack.push({
            ...angel,
            zone: "stack",
            castById: "p1",
            abilityId: "fallen-angel-feast",
            sacrificedPermanentId: "fodder",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "angel"
        )!;
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(4);
    });
});

describe("Hell's Caretaker (reanimate from GY, upkeep only, CR 400.7)", () => {
    it("returns a creature card from the graveyard to the battlefield", () => {
        const caretaker = makeInstance(hellsCaretaker.id, {
            id: "ct",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = makeInstance(headlessHorseman.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const deadInst = makeInstance(carrionAnts.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [caretaker, fodder],
                    graveyard: [deadInst],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...caretaker,
            zone: "stack",
            castById: "p1",
            abilityId: "hells-caretaker-reanimate",
            sacrificedPermanentId: "fodder",
            targets: [{ type: "graveyard-card", id: "dead", playerId: "p1" }],
        } as StackItem);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dead")
        ).toBeDefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "dead")
        ).toBeUndefined();
    });
});

describe("Blight (enchanted land tapped → destroy, CR 303.4)", () => {
    it("destroys the host land when it becomes tapped", () => {
        const land = makeInstance(swamp.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(blight.id, {
            id: "aura",
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
        resolveTrigger(state, aura, "blight-destroy-land", {
            type: "PERMANENT_TAPPED",
            permanentId: "land",
            controllerId: "p2",
            permanentTypes: ["Land"],
            permanentSubtypes: ["Swamp"],
            forMana: false,
        } as StackItem["triggerEvent"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
    });
});

describe("Hell Swarm (all creatures -1/-0 EOT, CR 611.1)", () => {
    it("debuffs every creature's power by 1", () => {
        const a = makeInstance(headlessHorseman.id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(headlessHorseman.id, {
            id: "b",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });
        pushSpell(state, hellSwarm.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectivePower(state, a)).toBe(1);
        expect(getEffectivePower(state, b)).toBe(1);
    });
});

describe("Hellfire (destroy all nonblack creatures + X+3 to you, CR 701.7)", () => {
    it("destroys nonblack creatures, spares black, and deals X+3 to caster", () => {
        // Scathe Zombies (black) survives; Hill Giant (red) dies.
        const zombie = makeInstance("e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", {
            id: "zombie",
            controllerId: "p2",
        });
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "giant",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [zombie, giant] }),
            ],
        });
        pushSpell(state, hellfire.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "giant")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "zombie")
        ).toBeDefined();
        // X = 1 nonblack creature died → 1 + 3 = 4 damage to caster.
        expect(state.players[0].life).toBe(16);
    });
});

describe("Syphon Soul (2 to each opponent, gain that much, CR 120.1)", () => {
    it("deals 2 to the opponent and gains the caster 2 life", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, syphonSoul.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(22);
    });
});

describe("Jovial Evil (X = 2× white creatures opponent controls, CR 120.1)", () => {
    it("deals twice the opponent's white-creature count", () => {
        // keepersOfTheFaith is a white creature.
        const w1 = makeInstance(keepersOfTheFaith.id, {
            id: "w1",
            controllerId: "p2",
        });
        const w2 = makeInstance(keepersOfTheFaith.id, {
            id: "w2",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [w1, w2] }),
            ],
        });
        pushSpell(state, jovialEvil.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // 2 white creatures × 2 = 4 damage.
        expect(state.players[1].life).toBe(16);
    });
});

describe("Touch of Darkness (creatures become black EOT, CR 305.7 layer 5)", () => {
    it("makes targeted creatures black, surviving projection (wire format)", () => {
        const lion = makeInstance(keepersOfTheFaith.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, touchOfDarkness.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(STATIC_EFFECT_CTX.getColors(lion)).toEqual(["B"]);
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(slim)).toEqual(["B"]);
    });
});

describe("Horror of Horrors (Sac a Swamp: regenerate target black creature)", () => {
    it("arms a regeneration shield on a black creature", () => {
        const horror = makeInstance(horrorOfHorrors.id, {
            id: "hh",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, {
            id: "swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Scathe Zombies — black creature.
        const zombie = makeInstance("e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", {
            id: "zombie",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [horror, land, zombie] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...horror,
            zone: "stack",
            castById: "p1",
            abilityId: "horror-of-horrors-regenerate",
            sacrificedPermanentId: "swamp",
            targets: [{ type: "permanent", id: "zombie" }],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "zombie"
        )!;
        expect(live.regenerationShields ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe("Cyclopean Mummy (dies → exile, CR 603.2 / 406)", () => {
    it("moves the dead creature from graveyard to exile", () => {
        const mummy = makeInstance(cyclopeanMummy.id, {
            id: "mummy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [mummy] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, mummy, "cyclopean-mummy-exile", {
            type: "CREATURE_DIED",
            creatureInstanceId: "mummy",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 1,
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].graveyard.find((c) => c.id === "mummy")
        ).toBeUndefined();
        expect(
            state.players[0].exile.find((c) => c.id === "mummy")
        ).toBeDefined();
    });
});

describe("Greed ({B}, Pay 2 life: Draw a card, CR 118.4 / 121.1)", () => {
    it("draws a card and costs 2 life", () => {
        const greedInst = makeInstance(greed.id, {
            id: "greed",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libCard = makeInstance(headlessHorseman.id, {
            id: "lib",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [greedInst],
                    library: [libCard],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...greedInst,
            zone: "stack",
            castById: "p1",
            abilityId: "greed-draw",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        expect(state.players[0].hand.find((c) => c.id === "lib")).toBeDefined();
    });
});

describe("Darkness (prevent all combat damage this turn, CR 615)", () => {
    it("arms the global combat-damage prevention", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, darkness.id, "p1");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

// ===========================================================================
// Red free tranche (#374)
// ===========================================================================

describe("LEG red vanilla / keyword creatures (CR 110.1 / 702)", () => {
    it("Kobolds are 0/1 with cost {0}", () => {
        for (const k of [
            crimsonKobolds,
            crookshankKobolds,
            koboldsOfKherKeep,
        ]) {
            expect(k.power).toBe(0);
            expect(k.toughness).toBe(1);
            expect(k.manaCost).toEqual({});
            expect(k.subtypes).toContain("Kobold");
        }
    });
    it("Raging Bull is a vanilla 2/2 Ox", () => {
        expect(ragingBull.power).toBe(2);
        expect(ragingBull.toughness).toBe(2);
        expect(ragingBull.subtypes).toContain("Ox");
        expect(ragingBull.staticAbilities ?? []).toHaveLength(0);
    });
    it("Mountain Yeti has mountainwalk + protection from white", () => {
        expect(mountainYeti.staticAbilities).toContain("mountainwalk");
        expect(mountainYeti.staticAbilities).toContain("protection from white");
    });
    it("Wall of Earth / Wall of Heat have defender", () => {
        expect(wallOfEarth.staticAbilities).toContain("defender");
        expect(wallOfHeat.staticAbilities).toContain("defender");
    });
});

describe("Kobold Taskmaster (other Kobolds +1/+0, CR 611)", () => {
    it("buffs other Kobolds but not itself (GRE + wire)", () => {
        const lord = makeInstance(koboldTaskmaster.id, {
            id: "lord",
            controllerId: "p1",
        });
        const buddy = makeInstance(crimsonKobolds.id, {
            id: "buddy",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, buddy] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, buddy)).toBe(1); // 0 + 1
        expect(getEffectivePower(state, lord)).toBe(1); // unchanged (other only)

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

describe("Kobold Drill Sergeant (other Kobolds +0/+1 and trample, CR 611)", () => {
    it("buffs toughness and grants trample to other Kobolds (GRE + wire)", () => {
        const sergeant = makeInstance(koboldDrillSergeant.id, {
            id: "sgt",
            controllerId: "p1",
        });
        const buddy = makeInstance(crookshankKobolds.id, {
            id: "buddy",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sergeant, buddy] }),
                makePlayer("p2"),
            ],
        });
        // Keyword grants are pushed onto matching permanents at ETB; replicate
        // that here for a hand-built board.
        applySourceStaticEffects(state, sergeant);
        expect(getEffectiveToughness(state, buddy)).toBe(2); // 1 + 1
        const live = state.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(live.staticAbilities).toContain("trample");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(2);
        expect(slim.staticAbilities).toContain("trample");
    });
});

describe("Kobold Overlord (other Kobolds have first strike, CR 611/702.7)", () => {
    it("grants first strike to other Kobolds and has it itself", () => {
        expect(koboldOverlord.staticAbilities).toContain("first strike");
        const lord = makeInstance(koboldOverlord.id, {
            id: "lord",
            controllerId: "p1",
        });
        const buddy = makeInstance(koboldsOfKherKeep.id, {
            id: "buddy",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, buddy] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, lord);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(live.staticAbilities).toContain("first strike");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(slim.staticAbilities).toContain("first strike");
    });
});

describe("Beasts of Bogardan (+1/+1 vs nontoken white permanent, CR 611.2c)", () => {
    it("gains +1/+1 only while an opponent controls a nontoken white permanent (GRE + wire)", () => {
        const beast = makeInstance(beastsOfBogardan.id, {
            id: "beast",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beast] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, beast)).toBe(3); // base, no white opp
        // White creature for the opponent (Keepers of the Faith is white).
        const whiteOpp = makeInstance(keepersOfTheFaith.id, {
            id: "wopp",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(whiteOpp);
        expect(getEffectivePower(state, beast)).toBe(4); // 3 + 1
        expect(getEffectiveToughness(state, beast)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "beast"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
    it("a token white permanent does not switch it on", () => {
        const beast = makeInstance(beastsOfBogardan.id, {
            id: "beast",
            controllerId: "p1",
        });
        const tokenWhite = makeInstance(keepersOfTheFaith.id, {
            id: "tok",
            controllerId: "p2",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beast] }),
                makePlayer("p2", { battlefield: [tokenWhite] }),
            ],
        });
        expect(getEffectivePower(state, beast)).toBe(3);
    });
});

describe("Spinal Villain ({T}: destroy target blue creature, CR 701.7)", () => {
    it("destroys a blue creature", () => {
        const villain = makeInstance(spinalVillain.id, {
            id: "villain",
            controllerId: "p1",
        });
        const blueCreature = makeInstance(azureDrake.id, {
            id: "drake",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [villain] }),
                makePlayer("p2", { battlefield: [blueCreature] }),
            ],
        });
        state.stack.push({
            ...villain,
            zone: "stack",
            castById: "p1",
            abilityId: "spinal-villain-destroy",
            targets: [{ type: "permanent", id: "drake" }],
        } as StackItem);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "drake")
        ).toBeUndefined();
    });
});

describe("Hyperion Blacksmith ({T}: tap or untap opponent artifact, CR 701.20)", () => {
    it("untaps a tapped opponent artifact when the controller chooses untap", () => {
        const smith = makeInstance(hyperionBlacksmith.id, {
            id: "smith",
            controllerId: "p1",
        });
        // Use a registered artifact (Ornithopter from lea, 0-cost artifact).
        const artifact = makeInstance(
            "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0", // Ornithopter (artifact)
            {
                id: "arti",
                controllerId: "p2",
                ownerId: "p2",
                isTapped: true,
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [smith] }),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        state.stack.push({
            ...smith,
            zone: "stack",
            castById: "p1",
            abilityId: "hyperion-blacksmith-tap-untap",
            targets: [{ type: "permanent", id: "arti" }],
        } as StackItem);
        resolveTopOfStack(state); // suspends on the tap/untap option choice
        answerChoice(state, ["untap"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "arti")?.isTapped
        ).toBe(false);
    });
});

describe("Wall of Opposition ({1}: +1/+0 EOT, CR 611.1)", () => {
    it("pumps power for the turn", () => {
        const wall = makeInstance(wallOfOpposition.id, {
            id: "wall",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, wall)).toBe(0);
        state.stack.push({
            ...wall,
            zone: "stack",
            castById: "p1",
            abilityId: "wall-of-opposition-pump",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(getEffectivePower(state, live)).toBe(1);
    });
});

describe("Giant Strength / Immolation / Eternal Warrior auras (CR 303.4)", () => {
    function attach(auraDef: typeof giantStrength) {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
            power: 3,
            toughness: 3,
        }); // Hill Giant 3/3
        const aura = makeInstance(auraDef.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        // Push the aura's keyword grants onto the host (ETB replication).
        applySourceStaticEffects(state, aura);
        return { state, host };
    }
    it("Giant Strength grants +2/+2 (GRE + wire)", () => {
        const { state, host } = attach(giantStrength);
        expect(getEffectivePower(state, host)).toBe(5);
        expect(getEffectiveToughness(state, host)).toBe(5);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
    });
    it("Immolation grants +2/-2", () => {
        const { state, host } = attach(immolation);
        expect(getEffectivePower(state, host)).toBe(5);
        expect(getEffectiveToughness(state, host)).toBe(1);
    });
    it("Eternal Warrior grants vigilance (GRE + wire)", () => {
        const { state } = attach(eternalWarrior);
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(live.staticAbilities).toContain("vigilance");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slim.staticAbilities).toContain("vigilance");
    });
});

describe("The Brute (aura +1/+0 + {R}{R}{R} regenerate host, CR 303.4/701.15a)", () => {
    it("buffs the host and the activated ability shields it", () => {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
            power: 3,
            toughness: 3,
        });
        const aura = makeInstance(theBrute.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, host)).toBe(4); // 3 + 1
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: "p1",
            abilityId: "the-brute-regenerate",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Dwarven Song (creatures become red EOT, CR 305.7 layer 5)", () => {
    it("makes targeted creatures red, surviving projection (wire format)", () => {
        const lion = makeInstance(keepersOfTheFaith.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        }); // white creature
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, dwarvenSong.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(STATIC_EFFECT_CTX.getColors(lion)).toEqual(["R"]);

        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(slim)).toEqual(["R"]);
    });
});

describe("Blood Lust (+4/-4 if T>=5, else +4 power / toughness to 1, CR 611.1)", () => {
    it("a high-toughness creature gets +4/-4", () => {
        const wall = makeInstance(wallOfHeat.id, {
            id: "wall",
            controllerId: "p1",
        }); // 2/6
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, bloodLust.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(getEffectivePower(state, live)).toBe(6); // 2 + 4
        expect(getEffectiveToughness(state, live)).toBe(2); // 6 - 4
    });
    it("a low-toughness creature's toughness drops to 1", () => {
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "g",
            controllerId: "p1",
            power: 3,
            toughness: 3,
        }); // 3/3
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giant] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, bloodLust.id, "p1", [{ type: "permanent", id: "g" }]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "g")!;
        expect(getEffectivePower(state, live)).toBe(7); // 3 + 4
        expect(getEffectiveToughness(state, live)).toBe(1); // 3 - (3-1)
    });
});

describe("Glyph of Destruction (Wall +10/+0 + prevent + delayed destroy, CR 611.1/615/603.7a)", () => {
    it("pumps the Wall, shields it, and schedules its destruction at the next end step", () => {
        const wall = makeInstance(wallOfEarth.id, {
            id: "wall",
            controllerId: "p1",
            isBlocking: true,
        }); // 0/6 Wall
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, glyphOfDestruction.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(getEffectivePower(state, live)).toBe(10); // 0 + 10
        expect((state.delayedTriggers ?? []).length).toBe(1);

        // Fire the delayed destroy at the next end step.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "wall")
        ).toBeUndefined();
    });
});

describe("Active Volcano (modal: destroy blue / return Island, CR 700.2)", () => {
    it("return-island mode bounces an Island to hand", () => {
        const isl = makeInstance(island.id, {
            id: "isl",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [isl] }),
            ],
        });
        const item = pushSpell(state, activeVolcano.id, "p1", [
            { type: "permanent", id: "isl" },
        ]);
        item.chosenModeId = "return-island";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "isl")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "isl")).toBe(true);
    });
    it("destroy-blue mode destroys a blue permanent", () => {
        const drake = makeInstance(azureDrake.id, {
            id: "drake",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [drake] }),
            ],
        });
        const item = pushSpell(state, activeVolcano.id, "p1", [
            { type: "permanent", id: "drake" },
        ]);
        item.chosenModeId = "destroy-blue";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "drake")
        ).toBeUndefined();
    });
});

describe("Winds of Change (each player shuffles hand into library, redraws, CR 701.20/121.1)", () => {
    it("each player ends with the same hand size after the swap", () => {
        const h1 = [
            makeInstance(lightningBolt.id, { id: "h1a", zone: "hand" }),
            makeInstance(lightningBolt.id, { id: "h1b", zone: "hand" }),
        ];
        const l1 = [
            makeInstance(mountain.id, { id: "l1a", zone: "library" }),
            makeInstance(mountain.id, { id: "l1b", zone: "library" }),
            makeInstance(mountain.id, { id: "l1c", zone: "library" }),
        ];
        const h2 = [makeInstance(forest.id, { id: "h2a", zone: "hand" })];
        const l2 = [
            makeInstance(forest.id, { id: "l2a", zone: "library" }),
            makeInstance(forest.id, { id: "l2b", zone: "library" }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { hand: h1, library: l1 }),
                makePlayer("p2", { hand: h2, library: l2 }),
            ],
        });
        pushSpell(state, windsOfChange.id, "p1");
        resolveTopOfStack(state);
        // Same count back (old hand size); total cards per player preserved.
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[1].hand).toHaveLength(1);
        expect(
            state.players[0].hand.length + state.players[0].library.length
        ).toBe(5);
        expect(
            state.players[1].hand.length + state.players[1].library.length
        ).toBe(3);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Green free tranche (#375)
// ───────────────────────────────────────────────────────────────────────────

describe("LEG green — vanilla / keyword definitions (CR 110.1 / 702)", () => {
    it("registers the green vanilla creatures with correct P/T", () => {
        expect(getCardById(barbaryApes.id)).toBe(barbaryApes);
        expect(barbaryApes.power).toBe(2);
        expect(barbaryApes.toughness).toBe(2);
        expect(durkwoodBoars.power).toBe(4);
        expect(durkwoodBoars.toughness).toBe(4);
        expect(mossMonster.power).toBe(3);
        expect(mossMonster.toughness).toBe(6);
    });
    it("declares the printed keywords (CR 702)", () => {
        expect(catWarriors.staticAbilities).toContain("forestwalk");
        expect(hornetCobra.staticAbilities).toContain("first strike");
        expect(emeraldDragonfly.staticAbilities).toContain("flying");
        expect(fireSprites.staticAbilities).toContain("flying");
        expect(killerBees.staticAbilities).toContain("flying");
        expect(pixieQueen.staticAbilities).toContain("flying");
        expect(rabidWombat.staticAbilities).toContain("vigilance");
    });
});

describe("Elven Riders (can't be blocked except by Walls/flyers, CR 509.1b)", () => {
    function setup(blocker: CardInstanceState) {
        const attacker = makeInstance(elvenRiders.id, {
            id: "rider",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, attacker, blocker };
    }
    it("a ground non-Wall creature may NOT block it", () => {
        const blocker = makeInstance(barbaryApes.id, {
            id: "ground",
            controllerId: "p2",
        });
        const { state, attacker } = setup(blocker);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });
    it("a flyer may block it", () => {
        const blocker = makeInstance(emeraldDragonfly.id, {
            id: "flyer",
            controllerId: "p2",
        });
        const { state, attacker } = setup(blocker);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
    it("a Wall may block it", () => {
        // wallOfLight (LEG white) is a Wall; reuse it as a ground Wall blocker.
        const blocker = makeInstance(wallOfLight.id, {
            id: "wall",
            controllerId: "p2",
        });
        const { state, attacker } = setup(blocker);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
});

describe("Rabid Wombat (+2/+2 per attached Aura, CR 604.3 pt-cda + wire)", () => {
    function setup(auraCount: number) {
        const wombat = makeInstance(rabidWombat.id, {
            id: "wombat",
            controllerId: "p1",
        });
        const auras: CardInstanceState[] = [];
        for (let i = 0; i < auraCount; i++) {
            auras.push(
                makeInstance(spiritLink.id, {
                    id: `aura-${i}`,
                    controllerId: "p1",
                    attachedTo: "wombat",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wombat, ...auras] }),
                makePlayer("p2"),
            ],
        });
        return { state, wombat };
    }
    it("is base 0/1 with no Auras", () => {
        const { state, wombat } = setup(0);
        expect(getEffectivePower(state, wombat)).toBe(0);
        expect(getEffectiveToughness(state, wombat)).toBe(1);
    });
    it("gets +2/+2 per attached Aura (GRE + wire)", () => {
        const { state, wombat } = setup(2);
        // base 0/1 + 2 auras × (+2/+2) = 4 / 5
        expect(getEffectivePower(state, wombat)).toBe(4);
        expect(getEffectiveToughness(state, wombat)).toBe(5);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wombat"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});

describe("Emerald Dragonfly ({G}{G}: gains first strike EOT, CR 611.1b)", () => {
    it("grants first strike until end of turn", () => {
        const dragonfly = makeInstance(emeraldDragonfly.id, {
            id: "df",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragonfly] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, dragonfly, "emerald-dragonfly-first-strike");
        const live = state.players[0].battlefield.find((c) => c.id === "df")!;
        expect(
            live.grantedStaticAbilities?.some(
                (g) => g.ability === "first strike"
            )
        ).toBe(true);
    });
});

describe("Fire Sprites ({G}, {T}: Add {R}, CR 605.1a mana ability)", () => {
    it("declares a mana ability that does not use the stack", () => {
        const ability = fireSprites.activatedAbilities?.[0];
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ R: 1 });
    });
});

describe("Killer Bees ({G}: +1/+1 EOT, CR 611.1)", () => {
    it("pumps itself when activated", () => {
        const bees = makeInstance(killerBees.id, {
            id: "bees",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bees] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bees, "killer-bees-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "bees")!;
        // base 0/1 + 1/+1
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
});

describe("Pixie Queen ({G}{G}{G}, {T}: target gains flying EOT, CR 611.1b)", () => {
    it("grants flying to a chosen creature", () => {
        const queen = makeInstance(pixieQueen.id, {
            id: "queen",
            controllerId: "p1",
        });
        const grounded = makeInstance(barbaryApes.id, {
            id: "apes",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [queen, grounded] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, queen, "pixie-queen-grant-flying", [
            { type: "permanent", id: "apes" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "apes")!;
        expect(
            live.grantedStaticAbilities?.some((g) => g.ability === "flying")
        ).toBe(true);
    });
});

describe("Pradesh Gypsies ({1}{G}, {T}: target gets -2/-0 EOT, CR 611.1)", () => {
    it("debuffs the target's power", () => {
        const gypsies = makeInstance(pradeshGypsies.id, {
            id: "gyp",
            controllerId: "p1",
        });
        const victim = makeInstance(durkwoodBoars.id, {
            id: "boar",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gypsies] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, gypsies, "pradesh-gypsies-debuff", [
            { type: "permanent", id: "boar" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "boar")!;
        expect(getEffectivePower(state, live)).toBe(2); // 4 - 2
        expect(getEffectiveToughness(state, live)).toBe(4); // unchanged
    });
});

describe("Storm Seeker (damage = target's hand size, CR 120.1)", () => {
    it("deals damage equal to the target player's hand count", () => {
        const hand = [
            makeInstance(forest.id, { id: "g-h1", zone: "hand" }),
            makeInstance(forest.id, { id: "g-h2", zone: "hand" }),
            makeInstance(forest.id, { id: "g-h3", zone: "hand" }),
        ];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand })],
        });
        pushSpell(state, stormSeeker.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
    });
});

describe("Typhoon (damage to each opponent = their Islands, CR 120.1)", () => {
    it("deals damage equal to the opponent's Island count", () => {
        const islands = [
            makeInstance(island.id, { id: "i1", controllerId: "p2" }),
            makeInstance(island.id, { id: "i2", controllerId: "p2" }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: islands }),
            ],
        });
        pushSpell(state, typhoon.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - 2 islands
    });
});

describe("Winter Blast (tap X creatures, 2 dmg to those with flying, CR 120.1)", () => {
    it("taps every target and damages only the flyers", () => {
        // azureDrake (2/4 flyer) survives the 2 damage so it can be inspected.
        const flyer = makeInstance(azureDrake.id, {
            id: "fly",
            controllerId: "p2",
        });
        const ground = makeInstance(barbaryApes.id, {
            id: "grnd",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [flyer, ground] }),
            ],
        });
        const item = pushSpell(state, winterBlast.id, "p1", [
            { type: "permanent", id: "fly" },
            { type: "permanent", id: "grnd" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        const liveFly = state.players[1].battlefield.find(
            (c) => c.id === "fly"
        )!;
        const liveGround = state.players[1].battlefield.find(
            (c) => c.id === "grnd"
        )!;
        expect(liveFly.isTapped).toBe(true);
        expect(liveGround.isTapped).toBe(true);
        // the flyer takes 2 damage; the ground creature takes none.
        expect(liveFly.damageMarked ?? 0).toBe(2);
        expect(liveGround.damageMarked ?? 0).toBe(0);
    });
});

describe("Sylvan Paradise (creatures become green EOT, CR 305.7 layer 5)", () => {
    it("makes the targets green (GRE + wire)", () => {
        const apes = makeInstance(barbaryApes.id, {
            id: "apes",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [apes] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sylvanParadise.id, "p1", [
            { type: "permanent", id: "apes" },
        ]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "apes")!;
        expect(live.colorOverride).toEqual(["G"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "apes"
        )!;
        expect(slim.colorOverride).toEqual(["G"]);
    });
});

// ---------------------------------------------------------------------------
// Multicolor / gold free tranche (#376)
// ---------------------------------------------------------------------------

describe("LEG multicolor vanilla / keyword legendary creatures (CR 205.4a, 702)", () => {
    it("ships the vanilla legends with canonical stats and supertype", () => {
        for (const c of [
            barktoothWarbeard,
            jeditOjanen,
            jerrardOfTheClosedFist,
            kasimirTheLoneWolf,
            sirShandlarOfEberyn,
            sivitriScarzam,
            theLadyOfTheMountain,
            tobiasAndrion,
            torstenVonUrsus,
        ]) {
            expect(c.supertypes).toContain("Legendary");
            expect(c.types).toEqual(["Creature"]);
            expect(c.staticAbilities).toBeUndefined();
        }
        expect(barktoothWarbeard.power).toBe(6);
        expect(barktoothWarbeard.toughness).toBe(5);
        expect(sirShandlarOfEberyn.toughness).toBe(7);
    });

    it("Ramirez DePietro has first strike", () => {
        expect(ramirezDePietro.staticAbilities).toContain("first strike");
        expect(ramirezDePietro.supertypes).toContain("Legendary");
    });

    it("registers the multicolor cards by name (pool / debug lookup)", () => {
        expect(getCardByName("Dakkon Blackblade")).toBe(dakkonBlackblade);
        expect(getCardByName("Sol'kanar the Swamp King")).toBe(
            solkanarTheSwampKing
        );
        expect(getCardByName("Boris Devilboon")).toBe(borisDevilboon);
    });
});

describe("Dakkon Blackblade (P/T = lands you control, CR 604.3 pt-cda)", () => {
    it("scales with controlled lands (GRE + wire)", () => {
        const dakkon = makeInstance(dakkonBlackblade.id, {
            id: "dakkon",
            controllerId: "p1",
        });
        const l1 = makeInstance(mountain.id, { id: "l1", controllerId: "p1" });
        const l2 = makeInstance(forest.id, { id: "l2", controllerId: "p1" });
        const l3 = makeInstance(island.id, { id: "l3", controllerId: "p2" }); // opponent's land doesn't count
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dakkon, l1, l2] }),
                makePlayer("p2", { battlefield: [l3] }),
            ],
        });
        expect(getEffectivePower(state, dakkon)).toBe(2);
        expect(getEffectiveToughness(state, dakkon)).toBe(2);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "dakkon"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);

        // Add another land → grows.
        state.players[0].battlefield.push(
            makeInstance(swamp.id, { id: "l4", controllerId: "p1" })
        );
        expect(getEffectivePower(state, dakkon)).toBe(3);
    });
});

describe("Jacques le Vert (green creatures you control get +0/+2, CR 611)", () => {
    it("buffs only your green creatures (GRE + wire)", () => {
        const jacques = makeInstance(jacquesLeVert.id, {
            id: "jacques",
            controllerId: "p1",
        });
        // Barbary Apes (green 2/2) controlled by p1 — buffed.
        const ape = makeInstance("df25ffdd-995d-46ae-856b-f6368f9438ed", {
            id: "ape",
            controllerId: "p1",
        });
        // Red creature (Hill Giant 3/3) controlled by p1 — not buffed.
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "giant",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jacques, ape, giant] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, ape)).toBe(2);
        expect(getEffectiveToughness(state, ape)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(state, giant)).toBe(3); // unbuffed

        const projected = projectPublicState(state, 1, "p1");
        const slimApe = projected.players[0].battlefield.find(
            (c) => c.id === "ape"
        )!;
        expect(getEffectiveToughness(projected, slimApe)).toBe(4);
    });
});

describe("Sol'kanar the Swamp King (black-spell lifegain, CR 603.2)", () => {
    it("has swampwalk and gains 1 life per black spell cast", () => {
        expect(solkanarTheSwampKing.staticAbilities).toContain("swampwalk");
        const solkanar = makeInstance(solkanarTheSwampKing.id, {
            id: "solkanar",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [solkanar] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, solkanar, "solkanar-black-spell-lifegain", {
            type: "SPELL_CAST",
            casterId: "p2",
            spellInstanceId: "x",
            spellCardId: "x",
            spellTypes: ["Sorcery"],
            spellSubtypes: [],
            spellColors: ["B"],
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Adun Oakenshield ({B}{R}{G},{T}: graveyard creature → hand, CR 400.7)", () => {
    it("returns a creature card from your graveyard to your hand", () => {
        const adun = makeInstance(adunOakenshield.id, {
            id: "adun",
            controllerId: "p1",
        });
        const dead = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "dead",
            controllerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [adun],
                    graveyard: [dead],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, adun, "adun-oakenshield-regrowth", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        expect(
            state.players[0].graveyard.find((c) => c.id === "dead")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "dead")
        ).toBeDefined();
    });
});

describe("Angus Mackenzie ({G}{W}{U},{T}: fog, CR 615)", () => {
    it("sets the combat-damage prevention flag", () => {
        const angus = makeInstance(angusMackenzie.id, {
            id: "angus",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angus] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, angus, "angus-mackenzie-fog");
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

describe("Boris Devilboon ({2}{B}{R},{T}: make a Minor Demon, CR 111)", () => {
    it("creates a 1/1 black-and-red Demon token", () => {
        const boris = makeInstance(borisDevilboon.id, {
            id: "boris",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [boris] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].battlefield.length;
        resolveActivated(state, boris, "boris-devilboon-minor-demon");
        const token = state.players[0].battlefield.find(
            (c) => c.isToken && c.id !== "boris"
        );
        expect(state.players[0].battlefield.length).toBe(before + 1);
        expect(token).toBeDefined();
        expect(token!.power).toBe(1);
        expect(token!.toughness).toBe(1);
        expect(token!.subtypes).toContain("Demon");
    });
});

describe("Gwendlyn Di Corci ({T}: random discard, your turn, CR 701.8a)", () => {
    it("makes the target player discard a card at random", () => {
        const gwen = makeInstance(gwendlynDiCorci.id, {
            id: "gwen",
            controllerId: "p1",
        });
        const victimCard = makeInstance(
            "0ddb98e8-13fe-4786-83f7-b72c56db135a",
            { id: "hc", controllerId: "p2", zone: "hand" }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gwen] }),
                makePlayer("p2", { hand: [victimCard] }),
            ],
        });
        expect(state.players[1].hand.length).toBe(1);
        resolveActivated(state, gwen, "gwendlyn-di-corci-discard", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].hand.length).toBe(0);
    });
});

describe("Kei Takahashi ({T}: prevent next 2 to target creature, CR 615)", () => {
    it("records a damage-prevention shield on the target", () => {
        const kei = makeInstance(keiTakahashi.id, {
            id: "kei",
            controllerId: "p1",
        });
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kei, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, kei, "kei-takahashi-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        expect((state.targetPreventionShields ?? []).length).toBeGreaterThan(0);
    });
});

describe("Pavel Maliki ({B}{R}: +1/+0 EOT, CR 611.1)", () => {
    it("buffs its own power by 1 until end of turn", () => {
        const pavel = makeInstance(pavelMaliki.id, {
            id: "pavel",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pavel] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, pavel)).toBe(5);
        resolveActivated(state, pavel, "pavel-maliki-pump");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "pavel"
        )!;
        expect(getEffectivePower(state, live)).toBe(6);
    });
});

describe("Ragnar ({G}{W}{U},{T}: regenerate target creature, CR 701.15a)", () => {
    it("arms a regeneration shield on the target", () => {
        const ragnarInst = makeInstance(ragnar.id, {
            id: "ragnar",
            controllerId: "p1",
        });
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ragnarInst, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ragnarInst, "ragnar-regenerate", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe("Tuknir Deathlock ({R}{G},{T}: target +2/+2 EOT, CR 611.1)", () => {
    it("has flying and buffs the target by +2/+2", () => {
        expect(tuknirDeathlock.staticAbilities).toContain("flying");
        const tuknir = makeInstance(tuknirDeathlock.id, {
            id: "tuknir",
            controllerId: "p1",
        });
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tuknir, bear] }),
                makePlayer("p2"),
            ],
        });
        const baseP = getEffectivePower(state, bear);
        const baseT = getEffectiveToughness(state, bear);
        resolveActivated(state, tuknir, "tuknir-deathlock-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(baseP + 2);
        expect(getEffectiveToughness(state, live)).toBe(baseT + 2);
    });
});

describe("Xira Arien ({B}{R}{G},{T}: target player draws, CR 121.1)", () => {
    it("has flying and draws a card for the target player", () => {
        expect(xiraArien.staticAbilities).toContain("flying");
        const xira = makeInstance(xiraArien.id, {
            id: "xira",
            controllerId: "p1",
        });
        const lib = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "libcard",
            controllerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [xira], library: [lib] }),
                makePlayer("p2"),
            ],
        });
        expect(state.players[0].hand.length).toBe(0);
        resolveActivated(state, xira, "xira-arien-draw", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].hand.length).toBe(1);
    });
});

describe("LEG multicolor mana abilities (CR 605.1a)", () => {
    // Mana abilities don't use the stack (useStack: false) — assert the
    // declaration shape (mirrors Fire Sprites) and that the `effect` closure
    // adds the right mana to the pool.
    function manaOf(card: typeof princessLucrezia) {
        const ability = card.activatedAbilities?.[0];
        let added: Record<string, number> | undefined;
        ability?.effect?.({
            addMana: (cost) => {
                added = cost as Record<string, number>;
            },
        });
        return { ability, added };
    }
    it("Princess Lucrezia: {T}: Add {U}", () => {
        const { ability, added } = manaOf(princessLucrezia);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ U: 1 });
        expect(added).toEqual({ U: 1 });
    });
    it("Riven Turnbull: {T}: Add {B}", () => {
        const { ability, added } = manaOf(rivenTurnbull);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ B: 1 });
        expect(added).toEqual({ B: 1 });
    });
    it("Sunastian Falconer: {T}: Add {C}{C}", () => {
        const { ability, added } = manaOf(sunastianFalconer);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 2 });
        expect(added).toEqual({ C: 2 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts, lands & colorless free tranche (#377). Cost-reduction statics are
// asserted via getCostModifiers + applyCostModifiers (the exact path game.ts
// runs when casting); activated abilities are pushed via resolveActivated and
// the resulting state / projection is checked.
// ─────────────────────────────────────────────────────────────────────────────

describe("Mana Matrix (instant/enchantment spells you cast cost {2} less, CR 601.2f)", () => {
    /** Mirror game.ts spell-cost calc: normalize the spell's printed cost, then
     *  fold in battlefield cost modifiers for the casting player's spell. */
    function effectiveSpellCost(
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

    function boardWith(artifactId: string, controllerId = "p1") {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(artifactId, { id: "art", controllerId }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("definition: {6} colorless Artifact with a cost-modifier static", () => {
        expect(manaMatrix.manaCost).toEqual({ X: 6 });
        expect(manaMatrix.types).toEqual(["Artifact"]);
        expect(
            manaMatrix.staticEffects?.some((e) => e.kind === "cost-modifier")
        ).toBe(true);
    });

    it("reduces your instant by {2} (Lightning Bolt {R} stays {R})", () => {
        const state = boardWith(manaMatrix.id);
        // {R} has no generic to reduce → unchanged colored pip.
        expect(effectiveSpellCost(state, lightningBolt.id, "p1")).toEqual({
            R: 1,
        });
    });

    it("reduces your enchantment's generic by {2} (Castle {3}{W} → {1}{W})", () => {
        const state = boardWith(manaMatrix.id);
        // Generic-only reduction (CR 601.2f): {3} → {1}, colored {W} untouched.
        expect(effectiveSpellCost(state, castle.id, "p1")).toEqual({
            X: 1,
            W: 1,
        });
    });

    it("leaves a colored-only enchantment unchanged (Crusade {W}{W} has no generic)", () => {
        const state = boardWith(manaMatrix.id);
        expect(effectiveSpellCost(state, crusade.id, "p1")).toEqual({ W: 2 });
    });

    it("does not reduce a creature spell (Grizzly Bears {1}{G} unchanged)", () => {
        const state = boardWith(manaMatrix.id);
        expect(effectiveSpellCost(state, grizzlyBears.id, "p1")).toEqual({
            X: 1,
            G: 1,
        });
    });

    it("only reduces spells YOU cast (opponent's enchantment unchanged)", () => {
        const state = boardWith(manaMatrix.id, "p1");
        // p2 casts Castle — Mana Matrix is p1's, so no reduction.
        expect(effectiveSpellCost(state, castle.id, "p2")).toEqual({
            X: 3,
            W: 1,
        });
    });
});

describe("Planar Gate (creature spells you cast cost {2} less, CR 601.2f)", () => {
    function effectiveSpellCost(
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

    const board = (controllerId = "p1") =>
        makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(planarGate.id, {
                            id: "gate",
                            controllerId,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

    it("definition: {6} Artifact with a cost-modifier static", () => {
        expect(planarGate.manaCost).toEqual({ X: 6 });
        expect(
            planarGate.staticEffects?.some((e) => e.kind === "cost-modifier")
        ).toBe(true);
    });

    it("reduces your creature spell (Grizzly Bears {1}{G} → {G})", () => {
        const state = board();
        expect(effectiveSpellCost(state, grizzlyBears.id, "p1")).toEqual({
            G: 1,
        });
    });

    it("does not reduce a noncreature spell (Lightning Bolt {R} unchanged)", () => {
        const state = board();
        expect(effectiveSpellCost(state, lightningBolt.id, "p1")).toEqual({
            R: 1,
        });
    });

    it("only reduces creatures YOU cast", () => {
        const state = board("p1");
        expect(effectiveSpellCost(state, grizzlyBears.id, "p2")).toEqual({
            X: 1,
            G: 1,
        });
    });
});

describe("Relic Barrier ({T}: Tap target artifact, CR 701.20)", () => {
    it("taps the target artifact", () => {
        const barrier = makeInstance(relicBarrier.id, { id: "barrier" });
        const otherArtifact = makeInstance(manaMatrix.id, { id: "other" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [barrier, otherArtifact],
                }),
                makePlayer("p2"),
            ],
        });
        expect(otherArtifact.isTapped).toBe(false);
        resolveActivated(state, barrier, "relic-barrier-tap", [
            { type: "permanent", id: "other" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "other"
        )!;
        expect(target.isTapped).toBe(true);
    });
});

describe("Alchor's Tomb (target permanent becomes chosen color, CR 105.2 / 611)", () => {
    it("sets the chosen color override on the target and survives projection", () => {
        const tomb = makeInstance(alchorsTomb.id, { id: "tomb" });
        const bears = makeInstance(grizzlyBears.id, { id: "bears" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tomb, bears] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tomb, "alchors-tomb-color", [
            { type: "permanent", id: "bears" },
        ]);
        // The option choice suspends — answer "U" (blue).
        answerChoice(state, ["U"]);
        const colored = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(colored.colorOverride).toEqual(["U"]);
        // Wire-format: the color override survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(slim.colorOverride).toEqual(["U"]);
    });
});

describe("Mirror Universe (exchange life totals, CR 118.5)", () => {
    it("swaps the controller's and target opponent's life totals", () => {
        const mirror = makeInstance(mirrorUniverse.id, { id: "mirror" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 3, battlefield: [mirror] }),
                makePlayer("p2", { life: 18 }),
            ],
        });
        resolveActivated(state, mirror, "mirror-universe-exchange", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(3);
    });

    it("definition: upkeep-only, controller-turn-only, taps + sacrifices", () => {
        const ability = mirrorUniverse.activatedAbilities![0];
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.cost.tap).toBe(true);
        expect(ability.cost.sacrifice).toBe(true);
    });
});

describe("Pendelhaven (Legendary land: {T}: Add {G}; {T}: pump a 1/1, CR 305 / 611.1)", () => {
    it("definition: Legendary Land with a mana ability and a pump ability", () => {
        expect(pendelhaven.types).toEqual(["Land"]);
        expect(pendelhaven.supertypes).toEqual(["Legendary"]);
        const mana = pendelhaven.activatedAbilities!.find(
            (a) => a.id === "pendelhaven-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ G: 1 });
        const pump = pendelhaven.activatedAbilities!.find(
            (a) => a.id === "pendelhaven-pump"
        )!;
        expect(pump.targetRequirement?.powerFilter).toEqual({ min: 1, max: 1 });
        expect(pump.targetRequirement?.toughnessFilter).toEqual({
            min: 1,
            max: 1,
        });
    });

    it("pumps a 1/1 creature to 2/3 until end of turn and survives projection", () => {
        const land = makeInstance(pendelhaven.id, { id: "pendel" });
        // Use a 1/1 vanilla creature (Tundra Wolves is 1/1).
        const wolves = makeInstance(tundraWolves.id, { id: "wolves" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, wolves] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, land, "pendelhaven-pump", [
            { type: "permanent", id: "wolves" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "wolves"
        )!;
        expect(getEffectivePower(state, target)).toBe(2);
        expect(getEffectiveToughness(state, target)).toBe(3);
        // Wire-format: the buff survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wolves"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 — Legend rule SBA (CR 704.5j, #378)
// ─────────────────────────────────────────────────────────────────────────────

describe("legend rule SBA (CR 704.5j)", () => {
    /** Submits a `legend-keep` choice for `playerId`, keeping `keepId`. */
    function keepLegend(state: GameState, playerId: string, keepId: string) {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [keepId],
        });
    }

    it("offers a keep-which choice when a controller has two same-name legendaries", () => {
        const a = makeInstance(jasmineBoreal.id, {
            id: "jasmine-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(jasmineBoreal.id, {
            id: "jasmine-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("legend-keep");
        expect(head.playerId).toBe("p1");
        expect(head.stackItemId).toBe("");
        expect(head.count).toBe(1);
        expect(head.candidateIds).toEqual(["jasmine-a", "jasmine-b"]);
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("keeps the chosen legendary and puts the rest into their owners' graveyards", () => {
        const a = makeInstance(jasmineBoreal.id, {
            id: "jasmine-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(jasmineBoreal.id, {
            id: "jasmine-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);
        keepLegend(state, "p1", "jasmine-a");

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "jasmine-a",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "jasmine-b",
        ]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("puts a duplicate into its OWNER's graveyard, not the controller's (CR 704.5j)", () => {
        const mine = makeInstance(jasmineBoreal.id, {
            id: "jasmine-mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const borrowed = makeInstance(jasmineBoreal.id, {
            id: "jasmine-borrowed",
            controllerId: "p1",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine, borrowed] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);
        keepLegend(state, "p1", "jasmine-mine");

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "jasmine-mine",
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "jasmine-borrowed",
        ]);
    });

    it("leaves two DIFFERENT-name legendaries on the battlefield", () => {
        const jasmine = makeInstance(jasmineBoreal.id, { id: "jasmine" });
        const orca = makeInstance(ladyOrca.id, { id: "orca" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jasmine, orca] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "jasmine",
            "orca",
        ]);
    });

    it("does NOT fire across different controllers (per-controller, CR 704.5j)", () => {
        const a = makeInstance(jasmineBoreal.id, {
            id: "jasmine-p1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(jasmineBoreal.id, {
            id: "jasmine-p2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield).toHaveLength(1);
    });

    it("ignores two same-name NON-legendary permanents (CR 704.5j — Legendary only)", () => {
        const a = makeInstance(grizzlyBears.id, { id: "bears-a" });
        const b = makeInstance(grizzlyBears.id, { id: "bears-b" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield).toHaveLength(2);
    });

    it("groups a copy (Clone-style, CR 707.2) with the original by copied name", () => {
        const original = makeInstance(jasmineBoreal.id, {
            id: "jasmine-real",
            controllerId: "p1",
            ownerId: "p1",
        });
        const copy = makeInstance(grizzlyBears.id, {
            id: "the-copy",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A copy effect overwrites card.id with the copied definition's id.
        copy.card = { id: jasmineBoreal.id };
        copy.copiedFrom = grizzlyBears.id;
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [original, copy] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].candidateIds).toEqual([
            "jasmine-real",
            "the-copy",
        ]);
    });

    it("re-sweeps after a keep to resolve a SECOND same-name group", () => {
        const j1 = makeInstance(jasmineBoreal.id, { id: "j1" });
        const j2 = makeInstance(jasmineBoreal.id, { id: "j2" });
        const o1 = makeInstance(ladyOrca.id, { id: "o1" });
        const o2 = makeInstance(ladyOrca.id, { id: "o2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [j1, j2, o1, o2] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);
        expect(state.pendingChoices![0].candidateIds).toEqual(["j1", "j2"]);
        keepLegend(state, "p1", "j1");

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].candidateIds).toEqual(["o1", "o2"]);
        keepLegend(state, "p1", "o2");

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "j1",
            "o2",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "j2",
            "o1",
        ]);
    });

    it("surfaces the pending legend-keep choice across the wire projection", () => {
        const a = makeInstance(jasmineBoreal.id, { id: "jasmine-a" });
        const b = makeInstance(jasmineBoreal.id, { id: "jasmine-b" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);

        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices?.[0];
        expect(head?.kind).toBe("legend-keep");
        expect(head?.playerId).toBe("p1");
        expect(head?.candidateIds).toEqual(["jasmine-a", "jasmine-b"]);
        const ids = projected.players[0].battlefield.map((c) => c.id);
        expect(ids).toContain("jasmine-a");
        expect(ids).toContain("jasmine-b");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — World rule SBA (CR 704.5m, #379)
// ─────────────────────────────────────────────────────────────────────────────

describe("world rule SBA (CR 704.5m)", () => {
    /** Builds a World permanent instance. `worldSeq` lets a test pin the
     *  relative "time as a world permanent" (higher = newer = shorter time). */
    function world(
        id: string,
        opts: {
            cardId?: string;
            controllerId?: string;
            ownerId?: string;
            worldSeq?: number;
        } = {}
    ) {
        return makeInstance(opts.cardId ?? concordantCrossroads.id, {
            id,
            controllerId: opts.controllerId ?? "p1",
            ownerId: opts.ownerId ?? opts.controllerId ?? "p1",
            ...(opts.worldSeq !== undefined ? { worldSeq: opts.worldSeq } : {}),
        });
    }

    it("a single World permanent is unaffected (SBA no-op)", () => {
        const cc = world("cc");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cc] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["cc"]);
        expect(state.players[0].graveyard).toHaveLength(0);
        // Stamped with a timestamp so a later-arriving World can be compared.
        expect(state.players[0].battlefield[0].worldSeq).toBe(1);
    });

    it("a second, newer World permanent graveyards the older one (CR 704.5m)", () => {
        // `old` has been a world permanent longer (lower seq); `fresh` is
        // newer (higher seq) and survives.
        const older = world("older", { worldSeq: 1 });
        const newer = world("newer", {
            cardId: gravitySphere.id,
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [older, newer] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "newer",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["older"]);
        // Fully automatic — no prompt.
        expect(state.pendingChoices).toBeUndefined();
    });

    it("a simultaneous tie (equal seq) puts ALL tied World permanents into graveyards (CR 704.5m)", () => {
        // Two World permanents first observed in the same arrival event share a
        // seq — the world rule destroys all of them.
        const a = world("a", { cardId: concordantCrossroads.id, worldSeq: 5 });
        const b = world("b", { cardId: gravitySphere.id, worldSeq: 5 });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
    });

    it("stamps two unstamped World permanents with one shared seq → tie kills both", () => {
        // No worldSeq on either: this is the "single effect ETB-ed two World
        // permanents" case. The SBA stamps both with the SAME fresh seq in one
        // sweep, then resolves the tie by graveyarding both.
        const a = world("a", { cardId: concordantCrossroads.id });
        const b = world("b", { cardId: gravitySphere.id });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(2);
    });

    it("applies GLOBALLY across both players, unlike the per-controller legend rule (CR 704.5m)", () => {
        // Each player controls one World permanent. The world rule is global,
        // so the older one dies even though no single player controls two.
        const mine = world("mine", { controllerId: "p1", worldSeq: 1 });
        const yours = world("yours", {
            cardId: gravitySphere.id,
            controllerId: "p2",
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [yours] }),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "yours",
        ]);
    });

    it("puts a World permanent into its OWNER's graveyard, not the controller's (CR 704.5m)", () => {
        // p1 controls a World enchantment owned by p2 (e.g. via a control
        // effect); when it loses the world rule it goes to p2's graveyard.
        const borrowed = world("borrowed", {
            controllerId: "p1",
            ownerId: "p2",
            worldSeq: 1,
        });
        const ownNewer = world("own-newer", {
            cardId: gravitySphere.id,
            controllerId: "p1",
            ownerId: "p1",
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [borrowed, ownNewer] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "own-newer",
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "borrowed",
        ]);
    });

    it("clears worldSeq when a World permanent leaves the battlefield", () => {
        // The doomed permanent is re-stampable as a fresh world permanent on
        // any re-entry (CR 400.7) — its stale seq must not carry over.
        const older = world("older", { worldSeq: 1 });
        const newer = world("newer", {
            cardId: gravitySphere.id,
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [older, newer] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        const dead = state.players[0].graveyard.find((c) => c.id === "older")!;
        expect(dead.worldSeq).toBeUndefined();
    });
});

describe("Concordant Crossroads (World — all creatures have haste, CR 702.10)", () => {
    it("carries the World supertype as data", () => {
        expect(concordantCrossroads.supertypes).toEqual(["World"]);
        expect(concordantCrossroads.types).toEqual(["Enchantment"]);
    });

    it("grants haste to every creature, regardless of controller (wire format)", () => {
        const cc = makeInstance(concordantCrossroads.id, {
            id: "cc",
            controllerId: "p1",
        });
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cc, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        applySourceStaticEffects(state, cc);

        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")!
                .staticAbilities
        ).toContain("haste");
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")!
                .staticAbilities
        ).toContain("haste");

        // Survives projection (the grant is materialized on staticAbilities).
        const projected = projectPublicState(state, 1, "p1");
        const slimTheirs = projected.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(slimTheirs.staticAbilities).toContain("haste");
    });
});

describe("Gravity Sphere (World — all creatures lose flying, CR 702.9)", () => {
    it("carries the World supertype as data", () => {
        expect(gravitySphere.supertypes).toEqual(["World"]);
        expect(gravitySphere.types).toEqual(["Enchantment"]);
    });

    it("removes flying from every creature, regardless of controller (wire format)", () => {
        const gs = makeInstance(gravitySphere.id, {
            id: "gs",
            controllerId: "p1",
        });
        const mine = makeInstance(azureDrake.id, {
            id: "mine",
            controllerId: "p1",
            staticAbilities: ["flying"],
        });
        const theirs = makeInstance(azureDrake.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gs, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        applySourceStaticEffects(state, gs);

        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")!
                .staticAbilities
        ).not.toContain("flying");
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")!
                .staticAbilities
        ).not.toContain("flying");

        const projected = projectPublicState(state, 1, "p1");
        const slimTheirs = projected.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(slimTheirs.staticAbilities).not.toContain("flying");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// C3 — Rampage N (CR 702.23) — issue #380.
//
// Exercised through the REAL combat path: `emitBlockersConfirmedEvents` emits
// one BLOCKERS_CONFIRMED per attacker-blocker pair and pushes the matching
// triggers via `collectTriggers`, then `resolveTopOfStack` resolves the single
// deduped Rampage trigger. That proves both the per-pair dedupe (one fire per
// becoming-blocked) and the resolution-time blocker count (CR 702.23b).
// ──────────────────────────────────────────────────────────────────────────
describe("Rampage N (CR 702.23)", () => {
    /** p1 fields the Rampage `attacker`; p2 fields `blockerCount` blockers, all
     *  assigned to it, at DECLARE_BLOCKERS. Returns the live state plus the
     *  attacker instance for buff assertions. */
    function setupRampageCombat(
        def: { id: string },
        blockerCount: number
    ): { state: GameState; attacker: CardInstanceState } {
        const attacker = makeInstance(def.id, {
            id: "rampager",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blockerIds = Array.from(
            { length: blockerCount },
            (_, i) => `blk${i}`
        );
        const blockers = blockerIds.map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            })
        );
        const blockerAssignments: Record<string, string[]> = {};
        for (const id of blockerIds) blockerAssignments[id] = ["rampager"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["rampager"],
                confirmed: true,
                blockerAssignments,
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        return { state, attacker };
    }

    it("Aerathi Berserker (rampage 3) carries the keyword + factory trigger", () => {
        expect(aerathiBerserker.staticAbilities).toContain("rampage 3");
        expect(aerathiBerserker.triggeredAbilities?.[0].id).toBe("rampage-3");
        expect(aerathiBerserker.triggeredAbilities?.[0].event).toBe(
            "BLOCKERS_CONFIRMED"
        );
    });

    it("all seven Rampage cards carry the keyword + a rampageTrigger", () => {
        const cards: { def: typeof frostGiant; n: number }[] = [
            { def: aerathiBerserker, n: 3 },
            { def: frostGiant, n: 2 },
            { def: crawGiant, n: 2 },
            { def: wolverinePack, n: 2 },
            { def: chromium, n: 2 },
            { def: hundingGjornersen, n: 1 },
            { def: marhaultElsdragon, n: 1 },
        ];
        for (const { def, n } of cards) {
            expect(def.staticAbilities).toContain(`rampage ${n}`);
            const trig = def.triggeredAbilities?.find(
                (t) => t.id === `rampage-${n}`
            );
            expect(trig).toBeDefined();
            expect(trig!.event).toBe("BLOCKERS_CONFIRMED");
        }
    });

    it("blocked by ONE creature: no bonus (CR 702.23a — beyond the first)", () => {
        const { state } = setupRampageCombat(frostGiant, 1);
        emitBlockersConfirmedEvents(state);
        // Exactly one Rampage trigger fires (one pair, one fire).
        expect(
            state.stack.filter((s) => s.triggeredAbilityId === "rampage-2")
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atk)).toBe(4); // base 4/4, no boost
        expect(getEffectiveToughness(state, atk)).toBe(4);
    });

    it("blocked by THREE: fires ONCE, +2N/+2N (CR 702.23a-b)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        // Three pairs are emitted but the dedupe collapses Rampage to one fire.
        expect(
            state.stack.filter((s) => s.triggeredAbilityId === "rampage-2")
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        // rampage 2 × (3 − 1) = +4/+4 → base 4/4 becomes 8/8.
        expect(getEffectivePower(state, atk)).toBe(8);
        expect(getEffectiveToughness(state, atk)).toBe(8);
    });

    it("rampage 3 scales: blocked by THREE → +6/+6 (Aerathi Berserker)", () => {
        const { state } = setupRampageCombat(aerathiBerserker, 3);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        // base 2/4, rampage 3 × (3 − 1) = +6/+6 → 8/10.
        expect(getEffectivePower(state, atk)).toBe(8);
        expect(getEffectiveToughness(state, atk)).toBe(10);
    });

    it("blocker removed BEFORE resolution lowers the bonus (CR 702.23b)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        // A blocker dies (e.g. to a removal spell) after blocks are declared but
        // before the Rampage trigger resolves: it no longer counts.
        removePermanentTo(state, "blk2", "graveyard");
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        // Now only two live blockers → +2 × (2 − 1) = +2/+2 → 6/6.
        expect(getEffectivePower(state, atk)).toBe(6);
        expect(getEffectiveToughness(state, atk)).toBe(6);
    });

    it("boost wears off at end of turn (CR 514.2 cleanup)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const atkBefore = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atkBefore)).toBe(8);
        // Walk to the next turn's cleanup so the until-end-of-turn buff expires.
        state.phase = "COMBAT_DAMAGE";
        for (
            let i = 0;
            i < 12 && getEffectivePower(state, atkBefore) > 4;
            i++
        ) {
            advancePhase(state);
        }
        const atkAfter = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atkAfter)).toBe(4);
        expect(getEffectiveToughness(state, atkAfter)).toBe(4);
    });

    it("wire format: pumped P/T survives projectPublicState (CR 611 visible)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atk)).toBe(8);
        expect(getEffectiveToughness(state, atk)).toBe(8);
        // Re-run the assertion against the projected (slim) state.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(8);
        expect(getEffectiveToughness(projected, slim)).toBe(8);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C4 — Bands with other [quality] (CR 702.22j, #381)
// ─────────────────────────────────────────────────────────────────────────────

describe("Bands-with-other grant-lands (CR 702.22j, keyword-grant)", () => {
    const LANDS = [
        adventurersGuildhouse,
        cathedralOfSerra,
        mountainStronghold,
        seafarersQuay,
        unholyCitadel,
    ];

    for (const land of LANDS) {
        it(`${land.name} declares a legendary keyword-grant`, () => {
            const grant = land.staticEffects?.find(
                (e) => e.kind === "keyword-grant"
            );
            expect(grant).toBeDefined();
            expect(grant && "keyword" in grant && grant.keyword).toBe(
                "bands with other:legendary"
            );
        });
    }

    it("Adventurers' Guildhouse grants the keyword to your GREEN legendary creature only", () => {
        // Hunding Gjornersen ({W}{U}) is not green; Marhault Elsdragon ({R}{G}) is.
        const land = makeInstance(adventurersGuildhouse.id, {
            id: "guildhouse",
            controllerId: "p1",
        });
        const greenLegend = makeInstance(marhaultElsdragon.id, {
            id: "green",
            controllerId: "p1",
        });
        const nonGreenLegend = makeInstance(hundingGjornersen.id, {
            id: "nongreen",
            controllerId: "p1",
        });
        const oppGreenLegend = makeInstance(marhaultElsdragon.id, {
            id: "oppgreen",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land, greenLegend, nonGreenLegend],
                }),
                makePlayer("p2", { battlefield: [oppGreenLegend] }),
            ],
        });
        applySourceStaticEffects(state, land);

        const kw = "bands with other:legendary";
        expect(greenLegend.staticAbilities).toContain(kw); // green + legendary + yours
        expect(nonGreenLegend.staticAbilities).not.toContain(kw); // not green
        expect(oppGreenLegend.staticAbilities).not.toContain(kw); // not yours

        // Wire format: the granted keyword must survive projection so the band
        // panel (which reads staticAbilities client-side) can offer the band.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "green"
        )!;
        expect(slim.staticAbilities).toContain(kw);
    });

    it("the granted keyword forms a legal legendary band (end-to-end legality)", () => {
        const land = makeInstance(mountainStronghold.id, {
            id: "stronghold",
            controllerId: "p1",
        });
        // Marhault Elsdragon ({R}{G}) is red + legendary → gets the keyword.
        const a = makeInstance(marhaultElsdragon.id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(marhaultElsdragon.id, {
            id: "b",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, a, b] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, land);
        // Both legendary, one grants the legendary quality → band is legal.
        expect(isLegalBandComposition([a, b])).toBe(true);
    });
});

describe("Master of the Hunt (Wolves-of-the-Hunt token band, CR 702.22j)", () => {
    it("mints a 1/1 green Wolf with the name-quality keyword that bands with its kin", () => {
        const master = makeInstance(masterOfTheHunt.id, {
            id: "master",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2"),
            ],
        });
        // Make two Wolf tokens.
        resolveActivated(state, master, "master-of-the-hunt-wolves");
        resolveActivated(state, master, "master-of-the-hunt-wolves");

        const wolves = state.players[0].battlefield.filter(
            (c) =>
                getCardById(c.card.id as string).name === "Wolves of the Hunt"
        );
        expect(wolves).toHaveLength(2);
        for (const w of wolves) {
            expect(w.power).toBe(1);
            expect(w.toughness).toBe(1);
            expect(w.subtypes).toContain("Wolf");
            expect(w.staticAbilities).toContain(
                "bands with other:name=Wolves of the Hunt"
            );
        }
        // Two same-named Wolves, at least one with the keyword → legal band.
        expect(isLegalBandComposition(wolves)).toBe(true);
    });
});

describe("Shelkin Brownie (strip 'bands with other' until EOT, CR 611.1b)", () => {
    it("removes the bands-with-other keyword and restores it at cleanup", () => {
        const brownie = makeInstance(shelkinBrownie.id, {
            id: "brownie",
            controllerId: "p1",
        });
        const target = makeInstance(hundingGjornersen.id, {
            id: "legend",
            controllerId: "p2",
            staticAbilities: ["bands with other:legendary"],
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [brownie] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveActivated(state, brownie, "shelkin-brownie-strip", [
            { type: "permanent", id: "legend" },
        ]);
        expect(target.staticAbilities).not.toContain(
            "bands with other:legendary"
        );

        // CR 514.2 — the strip ends at cleanup; the keyword comes back.
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(target.staticAbilities).toContain("bands with other:legendary");
    });

    it("leaves plain banding alone (only strips bands-with-other)", () => {
        const brownie = makeInstance(shelkinBrownie.id, {
            id: "brownie",
            controllerId: "p1",
        });
        const target = makeInstance(hundingGjornersen.id, {
            id: "legend",
            controllerId: "p2",
            staticAbilities: ["banding", "bands with other:legendary"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [brownie] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveActivated(state, brownie, "shelkin-brownie-strip", [
            { type: "permanent", id: "legend" },
        ]);
        expect(target.staticAbilities).toContain("banding"); // untouched
        expect(target.staticAbilities).not.toContain(
            "bands with other:legendary"
        );
    });
});

describe("Tolaria (strip banding + bands-with-other, upkeep-only, CR 611.1b)", () => {
    it("restricts the strip ability to the upkeep step", () => {
        const strip = tolaria.activatedAbilities?.find(
            (a) => a.id === "tolaria-strip"
        );
        expect(strip?.activationPhaseRestriction).toEqual(["UPKEEP"]);
    });

    it("strips both banding and bands-with-other until cleanup", () => {
        const land = makeInstance(tolaria.id, {
            id: "tolaria",
            controllerId: "p1",
        });
        const target = makeInstance(marhaultElsdragon.id, {
            id: "legend",
            controllerId: "p2",
            staticAbilities: [
                "banding",
                "bands with other:legendary",
                "flying",
            ],
        });
        const state = makeState({
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveActivated(state, land, "tolaria-strip", [
            { type: "permanent", id: "legend" },
        ]);
        expect(target.staticAbilities).not.toContain("banding");
        expect(target.staticAbilities).not.toContain(
            "bands with other:legendary"
        );
        expect(target.staticAbilities).toContain("flying"); // unrelated keyword kept

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(target.staticAbilities).toContain("banding");
        expect(target.staticAbilities).toContain("bands with other:legendary");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Shroud / "can't be the target" static (#382)
//
// CR 702.18 (shroud) / 611 (continuous guard) / 113.3 (spell-vs-ability) /
// 109.5 (source characteristics). Each card declares a `permanent-guard`
// `cantBeTargeted` static effect; the targeting gates (`getLegalTargets`,
// `selectTarget`) read it live. Tests assert the gate excludes the guarded
// permanent under the card's condition, and that the exclusion survives the
// wire-format projection.
// ─────────────────────────────────────────────────────────────────────────────

const CREATURE_REQ = { type: "Creature", count: 1 } as const;

describe("Spectral Cloak (shroud while untapped, CR 702.18 / 611)", () => {
    it("declares a cantBeTargeted guard scoped to the untapped host", () => {
        expect(spectralCloak.subtypes).toContain("Aura");
        const guard = spectralCloak.staticEffects?.find(
            (e) => e.kind === "permanent-guard"
        );
        expect(guard).toBeDefined();
        expect((guard as { cantBeTargeted?: boolean }).cantBeTargeted).toBe(
            true
        );
    });

    it("excludes the untapped enchanted creature from getLegalTargets", () => {
        const bear = makeInstance(jasmineBoreal.id, {
            id: "bear",
            isTapped: false,
        });
        const cloak = makeInstance(spectralCloak.id, {
            id: "cloak",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, cloak] }),
                makePlayer("p2"),
            ],
        });
        // A spell trying to target a creature: the cloaked bear is not legal.
        const legal = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Instant"],
            [],
            true
        ).map((t) => t.id);
        expect(legal).not.toContain("bear");
    });

    it("stops guarding once the host taps (live read of CR 611)", () => {
        const bear = makeInstance(jasmineBoreal.id, {
            id: "bear",
            isTapped: true,
        });
        const cloak = makeInstance(spectralCloak.id, {
            id: "cloak",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, cloak] }),
                makePlayer("p2"),
            ],
        });
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", {
                isSpell: true,
            })
        ).toBe(false);
        const legal = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Instant"],
            [],
            true
        ).map((t) => t.id);
        expect(legal).toContain("bear");
    });

    it("shroud exclusion survives the wire-format projection (#382)", () => {
        const bear = makeInstance(jasmineBoreal.id, {
            id: "bear",
            isTapped: false,
        });
        const cloak = makeInstance(spectralCloak.id, {
            id: "cloak",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, cloak] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        // The guard reads card definitions by id from the registry, so the
        // restriction must hold on the slim projected state too.
        expect(
            isGuardedAgainst(projected, slimBear, "cantBeTargeted", {
                isSpell: true,
            })
        ).toBe(true);
    });
});

describe("Anti-Magic Aura (can't be targeted by spells, CR 113.3)", () => {
    it("declares a spell-only cantBeTargeted guard plus cantBeEnchanted", () => {
        const guards = (antiMagicAura.staticEffects ?? []).filter(
            (e) => e.kind === "permanent-guard"
        );
        const noTarget = guards.find(
            (g) => (g as { cantBeTargeted?: boolean }).cantBeTargeted
        ) as { targetSourceMustBeSpell?: boolean } | undefined;
        expect(noTarget?.targetSourceMustBeSpell).toBe(true);
        const noEnchant = guards.find(
            (g) => (g as { cantBeEnchanted?: boolean }).cantBeEnchanted
        );
        expect(noEnchant).toBeDefined();
    });

    it("blocks a spell source but allows an ability source", () => {
        const bear = makeInstance(jasmineBoreal.id, { id: "bear" });
        const aura = makeInstance(antiMagicAura.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        // Spell source → guarded.
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: true })
        ).toBe(true);
        // Activated/triggered ability source → NOT guarded (CR 113.3).
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: false })
        ).toBe(false);
    });

    it("excludes the host from getLegalTargets for a spell (sourceIsSpell)", () => {
        const bear = makeInstance(jasmineBoreal.id, { id: "bear" });
        const aura = makeInstance(antiMagicAura.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        const spellLegal = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Sorcery"],
            [],
            true
        ).map((t) => t.id);
        expect(spellLegal).not.toContain("bear");
        // An ability (sourceIsSpell = false) can still target it.
        const abilityLegal = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Artifact"],
            [],
            false
        ).map((t) => t.id);
        expect(abilityLegal).toContain("bear");
    });
});

describe("Bartel Runeaxe (can't be targeted by Aura spells, CR 109.5)", () => {
    it("is a vigilant Legendary 6/5 with an Aura-spell guard", () => {
        expect(bartelRuneaxe.supertypes).toContain("Legendary");
        expect(bartelRuneaxe.staticAbilities).toContain("vigilance");
        const guard = bartelRuneaxe.staticEffects?.find(
            (e) => e.kind === "permanent-guard"
        ) as
            | {
                  targetSourceSubtypeFilter?: string[];
                  targetSourceMustBeSpell?: boolean;
              }
            | undefined;
        expect(guard?.targetSourceMustBeSpell).toBe(true);
        expect(guard?.targetSourceSubtypeFilter).toContain("Aura");
    });

    it("blocks an Aura spell but not a non-Aura spell or an Aura ability", () => {
        const bartel = makeInstance(bartelRuneaxe.id, { id: "bartel" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bartel] }),
                makePlayer("p2"),
            ],
        });
        // Aura spell → guarded.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: ["Aura"],
                isSpell: true,
            })
        ).toBe(true);
        // Non-Aura spell (e.g. Lightning Bolt) → NOT guarded.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: [],
                isSpell: true,
            })
        ).toBe(false);
        // An ability whose source happens to carry the Aura subtype → NOT
        // guarded (the clause is "Aura SPELLS", CR 113.3).
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: ["Aura"],
                isSpell: false,
            })
        ).toBe(false);
    });

    it("getLegalTargets excludes Bartel for an Aura spell only", () => {
        const bartel = makeInstance(bartelRuneaxe.id, { id: "bartel" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bartel] }),
                makePlayer("p2"),
            ],
        });
        const auraSpell = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Enchantment"],
            ["Aura"],
            true
        ).map((t) => t.id);
        expect(auraSpell).not.toContain("bartel");
        const boltSpell = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Instant"],
            [],
            true
        ).map((t) => t.id);
        expect(boltSpell).toContain("bartel");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C7 — Upkeep "pay-or-sacrifice" maintenance cost (#383)
//
// CR 603.6a beginning-of-upkeep trigger + CR 117.3a "do X unless you pay
// [cost]". The five Elder Dragons sacrifice unless their controller pays a
// three-color cost; Cosmic Horror destroys-and-self-pings; Mold Demon's ETB
// sacrifices unless you sacrifice two Swamps; The Tabernacle grants the
// destroy-unless-pay-{1} tax to every creature (CR 113.1 triggered-grant).
// Mirrors Junún Efreet (arn) and Energy Flux (atq).
// ─────────────────────────────────────────────────────────────────────────────

const UPKEEP_C7 = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

const ENTERED_C7 = (source: CardInstanceState): StackItem["triggerEvent"] =>
    ({
        type: "PERMANENT_ENTERED" as const,
        instanceId: source.id,
        controllerId: source.controllerId,
        types: source.types,
    }) as StackItem["triggerEvent"];

/** Gives p1 a full mana pool of `n` of each color (enough to pay any three-
 *  color upkeep cost in this cluster). */
function fillManaPool(state: GameState, n = 5): void {
    state.players[0].manaPool = { W: n, U: n, B: n, R: n, G: n, C: n };
}

describe("Elder Dragon Legends (upkeep: sacrifice unless pay {C}{C}{C}, CR 603.6a / 117.3a / 701.16)", () => {
    const dragons = [
        { def: arcadesSabboth, ability: "arcades-sabboth-upkeep" },
        { def: chromium, ability: "chromium-upkeep" },
        { def: nicolBolas, ability: "nicol-bolas-upkeep" },
        { def: palladiaMors, ability: "palladia-mors-upkeep" },
        { def: vaevictisAsmadi, ability: "vaevictis-asmadi-upkeep" },
    ] as const;

    function setup(def: (typeof dragons)[number]["def"]) {
        const dragon = makeInstance(def.id, {
            id: "dragon",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        return { state, dragon };
    }

    for (const { def, ability } of dragons) {
        describe(def.name, () => {
            it("declining the payment sacrifices it (CR 701.16)", () => {
                const { state, dragon } = setup(def);
                resolveTrigger(state, dragon, ability, UPKEEP_C7("p1"));
                answerChoice(state, ["decline"]);
                expect(state.players[0].battlefield).toHaveLength(0);
                expect(
                    state.players[0].graveyard.some((c) => c.id === "dragon")
                ).toBe(true);
            });

            it("paying the cost keeps it on the battlefield (CR 118)", () => {
                const { state, dragon } = setup(def);
                fillManaPool(state);
                resolveTrigger(state, dragon, ability, UPKEEP_C7("p1"));
                answerChoice(state, ["yes"]);
                expect(
                    state.players[0].battlefield.some((c) => c.id === "dragon")
                ).toBe(true);
            });

            it("carries the upkeep trigger in its definition", () => {
                expect(
                    def.triggeredAbilities?.some((a) => a.id === ability)
                ).toBe(true);
            });
        });
    }

    it("fires only at the controller's OWN upkeep (scope: your, CR 603.6a)", () => {
        const dragon = makeInstance(chromium.id, {
            id: "chr",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        expect(
            collectTriggers(state, [UPKEEP_C7("p1") as never]).some(
                (t) => t.triggeredAbilityId === "chromium-upkeep"
            )
        ).toBe(true);
        expect(
            collectTriggers(state, [UPKEEP_C7("p2") as never]).some(
                (t) => t.triggeredAbilityId === "chromium-upkeep"
            )
        ).toBe(false);
    });

    it("backend integration: declining via applyMayPaySubmit sacrifices it (GRE → mutation → state)", () => {
        const dragon = makeInstance(nicolBolas.id, {
            id: "bolas",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "bolas")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "bolas")).toBe(
            true
        );
    });

    it("backend integration: paying via applyMayPaySubmit keeps it and spends mana", () => {
        const dragon = makeInstance(palladiaMors.id, {
            id: "pm",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { W: 1, U: 0, B: 0, R: 1, G: 1, C: 0 };
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "pm")).toBe(
            true
        );
        // {R}{G}{W} consumed.
        expect(state.players[0].manaPool.R).toBe(0);
        expect(state.players[0].manaPool.G).toBe(0);
        expect(state.players[0].manaPool.W).toBe(0);
    });
});

describe("Cosmic Horror (upkeep: destroy unless pay {3}{B}{B}{B}, then 7 to you, CR 603.6a / 701.7)", () => {
    function setup() {
        const horror = makeInstance(cosmicHorror.id, {
            id: "horror",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [horror] }),
                makePlayer("p2"),
            ],
        });
        return { state, horror };
    }

    it("declining destroys it AND deals 7 damage to its controller", () => {
        const { state, horror } = setup();
        resolveTrigger(state, horror, "cosmic-horror-upkeep", UPKEEP_C7("p1"));
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.some((c) => c.id === "horror")).toBe(
            true
        );
        expect(state.players[0].life).toBe(13); // 20 - 7
    });

    it("paying keeps it and deals no damage", () => {
        const { state, horror } = setup();
        fillManaPool(state);
        resolveTrigger(state, horror, "cosmic-horror-upkeep", UPKEEP_C7("p1"));
        answerChoice(state, ["yes"]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "horror")
        ).toBe(true);
        expect(state.players[0].life).toBe(20);
    });

    it("has first strike", () => {
        expect(cosmicHorror.staticAbilities).toContain("first strike");
    });
});

describe("Mold Demon (ETB: sacrifice unless you sacrifice two Swamps, CR 603.6a / 118.3)", () => {
    function setup(swampCount: number) {
        const demon = makeInstance(moldDemon.id, {
            id: "demon",
            controllerId: "p1",
        });
        const swamps = Array.from({ length: swampCount }, (_, i) =>
            makeInstance(swamp.id, { id: `swamp-${i}`, controllerId: "p1" })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [demon, ...swamps] }),
                makePlayer("p2"),
            ],
        });
        return { state, demon };
    }

    it("sacrifices two Swamps and keeps Mold Demon when the controller pays", () => {
        const { state } = setup(2);
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "mold-demon-etb",
            ENTERED_C7(state.players[0].battlefield[0])
        );
        answerChoice(state, ["yes"]); // accept the sacrifice cost
        answerChoice(state, ["swamp-0", "swamp-1"]); // pick the two Swamps
        const bf = state.players[0].battlefield;
        expect(bf.some((c) => c.id === "demon")).toBe(true);
        expect(bf.some((c) => c.subtypes.includes("Swamp"))).toBe(false);
    });

    it("declining the cost sacrifices Mold Demon", () => {
        const { state } = setup(2);
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "mold-demon-etb",
            ENTERED_C7(state.players[0].battlefield[0])
        );
        answerChoice(state, ["decline"]);
        const bf = state.players[0].battlefield;
        expect(bf.some((c) => c.id === "demon")).toBe(false);
        // The two Swamps remain.
        expect(bf.filter((c) => c.subtypes.includes("Swamp"))).toHaveLength(2);
        expect(state.players[0].graveyard.some((c) => c.id === "demon")).toBe(
            true
        );
    });

    it("auto-sacrifices when fewer than two Swamps are available (no real choice)", () => {
        const { state } = setup(1);
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "mold-demon-etb",
            ENTERED_C7(state.players[0].battlefield[0])
        );
        // Unpayable cost forces the consequence with no prompt.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].battlefield.some((c) => c.id === "demon")).toBe(
            false
        );
    });
});

// The Tabernacle at Pendrell Vale — grants the destroy-unless-pay-{1} tax to
// every creature (CR 113.1 triggered-grant + CR 611 filtered set + CR 603.6a).
function withTabernacle(creatureController: "p1" | "p2" = "p1"): {
    state: GameState;
    tabernacle: CardInstanceState;
    bear: CardInstanceState;
} {
    const tabernacle = makeInstance(theTabernacleAtPendrellVale.id, {
        id: "tab",
        controllerId: "p1",
        zone: "battlefield",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: creatureController,
        zone: "battlefield",
    });
    const state = makeState();
    state.players[0].battlefield.push(tabernacle);
    state.players[creatureController === "p1" ? 0 : 1].battlefield.push(bear);
    applySourceStaticEffects(state, tabernacle);
    return { state, tabernacle, bear };
}

describe("The Tabernacle at Pendrell Vale (CR 113.1 triggered-grant + CR 603.6a upkeep tax)", () => {
    it("declares a triggered-grant static and the granted template (not on triggeredAbilities)", () => {
        const kinds = (theTabernacleAtPendrellVale.staticEffects ?? []).map(
            (e) => e.kind
        );
        expect(kinds).toContain("triggered-grant");
        expect(
            theTabernacleAtPendrellVale.triggeredAbilities ?? []
        ).toHaveLength(0);
        expect(
            theTabernacleAtPendrellVale.triggeredGrantTemplates?.some(
                (t) => t.id === "tabernacle-upkeep"
            )
        ).toBe(true);
    });

    it("grants the upkeep tax to every creature in play (CR 611 filtered set)", () => {
        const { bear } = withTabernacle();
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(true);
    });

    it("does NOT grant the tax to a non-creature (the Tabernacle itself stays untaxed)", () => {
        const { tabernacle } = withTabernacle();
        expect(
            effectiveTriggeredAbilities(tabernacle).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(false);
    });

    it("fires the granted trigger at the creature controller's own upkeep (scope: your)", () => {
        const { state, bear } = withTabernacle("p1");
        const triggers = collectTriggers(state, [UPKEEP_C7("p1") as never]);
        expect(
            triggers.some(
                (t) =>
                    t.triggeredAbilityId === "tabernacle-upkeep" &&
                    t.triggerSourceId === bear.id
            )
        ).toBe(true);
        // Not on the OTHER player's upkeep.
        expect(
            collectTriggers(state, [UPKEEP_C7("p2") as never]).some(
                (t) => t.triggeredAbilityId === "tabernacle-upkeep"
            )
        ).toBe(false);
    });

    it("paying {1} keeps the creature (CR 118)", () => {
        const { state } = withTabernacle("p1");
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            true
        );
        expect(state.players[0].manaPool.C).toBe(0);
    });

    it("backend integration: declining destroys the creature (CR 701.7)", () => {
        const { state } = withTabernacle("p1");
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
    });

    it("grants the tax to a creature that ENTERS after the Tabernacle (applyExistingGrantsTo)", () => {
        const { state } = withTabernacle("p1");
        const ogre = makeInstance(grizzlyBears.id, {
            id: "ogre",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(ogre);
        applyExistingGrantsTo(state, ogre);
        expect(
            effectiveTriggeredAbilities(ogre).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(true);
    });

    it("removes the grant when the Tabernacle leaves play (unapplySourceStaticEffects)", () => {
        const { state, tabernacle, bear } = withTabernacle("p1");
        unapplySourceStaticEffects(state, tabernacle);
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(false);
    });

    it("wire format: the granted tax survives projectPublicState", () => {
        const { state, bear } = withTabernacle("p1");
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "tabernacle-upkeep"
            )
        ).toBe(true);
        const projected = projectPublicState(state, 1, "p1");
        const projBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(
            projBear.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "tabernacle-upkeep"
            )
        ).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// C5 — Named counters + counter-driven triggers (#384, CR 122).
// ═════════════════════════════════════════════════════════════════════════════

const UPKEEP_C5 = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

const END_STEP_C5 = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "END_STEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

describe("named counters: add / remove / count independent of +1/+1 (CR 122.6)", () => {
    it("named counters are stored and read separately from +1/+1, and P/T counters annihilate (CR 704.5q)", () => {
        // A vanilla bear carrying named counters AND P/T counters.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            counters: { sleep: 2, "+1/+1": 3, "-1/-1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        // The named "sleep" counters are inert to layer 7d.
        expect(bear.counters?.sleep).toBe(2);
        // CR 704.5q — +1/+1 and -1/-1 annihilate via SBA, leaving +2/+2.
        checkStateBasedActions(state);
        expect(bear.counters?.["+1/+1"]).toBe(2);
        expect(bear.counters?.["-1/-1"]).toBeUndefined();
        // Named counters untouched by the annihilation SBA.
        expect(bear.counters?.sleep).toBe(2);
    });
});

describe("Spirit Shackle (becomes-tapped → -0/-2 counter, CR 701.20a / 122.1 / 613.4d)", () => {
    function setup() {
        const creature = makeInstance(grizzlyBears.id, {
            id: "creature",
            controllerId: "p2",
            power: 2,
            toughness: 2,
        });
        const aura = makeInstance(spiritShackle.id, {
            id: "shackle",
            controllerId: "p1",
            attachedTo: "creature",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        return { state, creature, aura };
    }

    it("puts a -0/-2 counter on the host when it becomes tapped, dropping its toughness", () => {
        const { state, creature } = setup();
        expect(getEffectiveToughness(state, creature)).toBe(2);
        const tapEvent: StackItem["triggerEvent"] = {
            type: "PERMANENT_TAPPED",
            permanentId: "creature",
            controllerId: "p2",
            permanentTypes: creature.types,
            permanentSubtypes: creature.subtypes,
            forMana: false,
        } as StackItem["triggerEvent"];
        const aura = state.players[0].battlefield[0];
        resolveTrigger(state, aura, "spirit-shackle-tap", tapEvent);
        expect(creature.counters?.["-0/-2"]).toBe(1);
        // CR 613.4d — the -0/-2 counter rides layer 7d.
        expect(getEffectiveToughness(state, creature)).toBe(0);
    });

    it("the -0/-2 toughness drop survives projection (wire format)", () => {
        const { state, creature } = setup();
        creature.counters = { "-0/-2": 1 };
        expect(getEffectiveToughness(state, creature)).toBe(0);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "creature"
        )!;
        expect(slim.counters?.["-0/-2"]).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(0);
    });
});

describe("Venarian Gold (sleep counters: ETB tap + counter-gated does-not-untap + upkeep removal, CR 122 / 502.1)", () => {
    function setup(sleep = 2) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p2",
        });
        const aura = makeInstance(venarianGold.id, {
            id: "gold",
            controllerId: "p1",
            attachedTo: "host",
            counters: undefined,
        });
        if (sleep > 0) host.counters = { sleep };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        return { state, host, aura };
    }

    it("grants the host does-not-untap while it carries a sleep counter", () => {
        const { state, host, aura } = setup(2);
        // Layer-6 keyword grant is pushed onto the host when the aura's static
        // effects are applied (the `applies` predicate reads host.counters.sleep).
        applySourceStaticEffects(state, aura);
        expect(host.staticAbilities).toContain("does-not-untap");
    });

    it("does NOT grant does-not-untap when the host has no sleep counter", () => {
        const { state, host, aura } = setup(0);
        applySourceStaticEffects(state, aura);
        expect(host.staticAbilities).not.toContain("does-not-untap");
    });

    it("upkeep removes one sleep counter from the host (host-controller scope)", () => {
        const { state, aura } = setup(2);
        resolveTrigger(state, aura, "venarian-gold-upkeep", UPKEEP_C5("p2"));
        expect(state.players[1].battlefield[0].counters?.sleep).toBe(1);
    });

    it("sleep counters survive projection (wire format)", () => {
        const { state } = setup(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slim.counters?.sleep).toBe(3);
    });
});

describe("Cocoon (pupa counters on the Aura + hatch into +1/+1 and flying, CR 122 / 611.2c)", () => {
    function setup(pupa = 3) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
        });
        const aura = makeInstance(cocoon.id, {
            id: "cocoon",
            controllerId: "p1",
            attachedTo: "host",
            counters: pupa > 0 ? { pupa } : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, host, aura };
    }

    it("the host doesn't untap while the Aura carries a pupa counter", () => {
        const { state, host, aura } = setup(3);
        applySourceStaticEffects(state, aura);
        expect(host.staticAbilities).toContain("does-not-untap");
    });

    it("upkeep removes a pupa counter while any remain", () => {
        const { state, aura } = setup(3);
        resolveTrigger(state, aura, "cocoon-upkeep", UPKEEP_C5("p1"));
        const live = state.players[0].battlefield.find(
            (c) => c.id === "cocoon"
        );
        expect(live?.counters?.pupa).toBe(2);
    });

    it("upkeep with no pupa counters left hatches: sacrifices the Aura, +1/+1 counter and flying on the host", () => {
        const { state, aura } = setup(0);
        resolveTrigger(state, aura, "cocoon-upkeep", UPKEEP_C5("p1"));
        // Aura sacrificed.
        expect(
            state.players[0].battlefield.some((c) => c.id === "cocoon")
        ).toBe(false);
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.counters?.["+1/+1"]).toBe(1);
        expect(host.staticAbilities).toContain("flying");
        // Flying persists permanently (no aura link, no duration).
        expect(
            host.grantedStaticAbilities?.some(
                (g) => g.ability === "flying" && !g.duration && !g.auraId
            )
        ).toBe(true);
    });
});

describe("Whirling Dervish (end-step +1/+1 if it dealt damage to an opponent this turn, CR 120.3 / 603.4d)", () => {
    function setup(dealt: boolean) {
        const dervish = makeInstance(whirlingDervish.id, {
            id: "dervish",
            controllerId: "p1",
            dealtDamageToOpponentThisTurn: dealt ? true : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dervish] }),
                makePlayer("p2"),
            ],
        });
        return { state, dervish };
    }

    it("has protection from black", () => {
        expect(whirlingDervish.staticAbilities).toContain(
            "protection from black"
        );
    });

    it("the end-step trigger fires (and grows) only when it dealt damage to an opponent", () => {
        const yes = setup(true);
        const fired = collectTriggers(yes.state, [
            END_STEP_C5("p1") as never,
        ]).some((t) => t.triggeredAbilityId === "whirling-dervish-end-step");
        expect(fired).toBe(true);
        resolveTrigger(
            yes.state,
            yes.dervish,
            "whirling-dervish-end-step",
            END_STEP_C5("p1")
        );
        expect(yes.dervish.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(yes.state, yes.dervish)).toBe(2);
    });

    it("does NOT grow when it dealt no damage to an opponent (intervening-if fizzle)", () => {
        const no = setup(false);
        resolveTrigger(
            no.state,
            no.dervish,
            "whirling-dervish-end-step",
            END_STEP_C5("p1")
        );
        expect(no.dervish.counters?.["+1/+1"]).toBeUndefined();
    });
});

describe("Primordial Ooze (upkeep +1/+1 then pay {X} or tap + X damage, CR 122 / 117.3a)", () => {
    function setup(existing = 0) {
        const ooze = makeInstance(primordialOoze.id, {
            id: "ooze",
            controllerId: "p1",
            counters: existing > 0 ? { "+1/+1": existing } : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ooze] }),
                makePlayer("p2"),
            ],
        });
        return { state, ooze };
    }

    it("declining the {X} payment taps the Ooze and deals X damage to its controller", () => {
        const { state, ooze } = setup(1); // becomes 2 after the upkeep counter
        resolveTrigger(state, ooze, "primordial-ooze-upkeep", UPKEEP_C5("p1"));
        // X = 2 (+1/+1 counters after the upkeep bump).
        answerChoice(state, ["decline"]);
        expect(ooze.counters?.["+1/+1"]).toBe(2);
        expect(ooze.isTapped).toBe(true);
        expect(state.players[0].life).toBe(18); // 20 - 2
    });

    it("attacks each combat if able (CR 508.1d)", () => {
        expect(
            primordialOoze.staticEffects?.some(
                (e) => e.kind === "attack-requirement"
            )
        ).toBe(true);
    });
});

describe("Rasputin Dreamweaver (dream counters: enters with 7, mana / prevent removal, capped regrow, CR 122)", () => {
    it("enters with seven dream counters (CR 122.1)", () => {
        expect(rasputinDreamweaver.entersWith?.counters).toEqual([
            { type: "dream", count: 7 },
        ]);
    });

    it("the upkeep regrow is capped at seven and gated on starting the turn untapped", () => {
        const rasputin = makeInstance(rasputinDreamweaver.id, {
            id: "ras",
            controllerId: "p1",
            counters: { dream: 7 },
            startedTurnUntapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        // At the cap → intervening-if true (started untapped) but resolve no-ops.
        resolveTrigger(
            state,
            rasputin,
            "rasputin-upkeep-regrow",
            UPKEEP_C5("p1")
        );
        expect(rasputin.counters?.dream).toBe(7);
    });

    it("regrows a dream counter below the cap when it started the turn untapped", () => {
        const rasputin = makeInstance(rasputinDreamweaver.id, {
            id: "ras",
            controllerId: "p1",
            counters: { dream: 4 },
            startedTurnUntapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            rasputin,
            "rasputin-upkeep-regrow",
            UPKEEP_C5("p1")
        );
        expect(rasputin.counters?.dream).toBe(5);
    });

    it("does NOT regrow if it did not start the turn untapped (intervening-if)", () => {
        const rasputin = makeInstance(rasputinDreamweaver.id, {
            id: "ras",
            controllerId: "p1",
            counters: { dream: 4 },
            startedTurnUntapped: undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        const fired = collectTriggers(state, [UPKEEP_C5("p1") as never]).some(
            (t) => t.triggeredAbilityId === "rasputin-upkeep-regrow"
        );
        expect(fired).toBe(false);
    });

    it("the mana ability carries a remove-a-dream-counter cost (CR 122.6)", () => {
        const mana = rasputinDreamweaver.activatedAbilities?.find(
            (a) => a.id === "rasputin-dream-mana"
        );
        expect(mana?.cost.removeCounter).toEqual({ type: "dream", count: 1 });
        expect(mana?.useStack).toBe(false);
    });
});

describe("Divine Intervention (counter-driven game draw, CR 122 / 104.4a)", () => {
    function setup(counters: number) {
        const di = makeInstance(divineIntervention.id, {
            id: "di",
            controllerId: "p1",
            counters: { intervention: counters },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [di] }),
                makePlayer("p2"),
            ],
        });
        return { state, di };
    }

    it("enters with two intervention counters (CR 122.1)", () => {
        expect(divineIntervention.entersWith?.counters).toEqual([
            { type: "intervention", count: 2 },
        ]);
    });

    it("upkeep removal from two → one does NOT end the game", () => {
        const { state, di } = setup(2);
        resolveTrigger(
            state,
            di,
            "divine-intervention-upkeep",
            UPKEEP_C5("p1")
        );
        expect(di.counters?.intervention).toBe(1);
        expect(state.gameOver).toBeUndefined();
    });

    it("removing the LAST counter ends the game in a draw (CR 104.4a)", () => {
        const { state, di } = setup(1);
        resolveTrigger(
            state,
            di,
            "divine-intervention-upkeep",
            UPKEEP_C5("p1")
        );
        expect(state.gameOver?.isDraw).toBe(true);
        expect(state.gameOver?.reason).toBe("draw");
        expect(state.gameOver?.winnerId).toBe("");
        expect(state.gameOver?.loserId).toBe("");
    });
});

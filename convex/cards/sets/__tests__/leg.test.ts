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
} from "../leg";
import { getCardById, getCardByName, getAllCards } from "../../index";
import { fireDelayedTriggers } from "../../../gre/phases";
import { lightningBolt, mountain, forest, island, swamp } from "../lea";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../gre/layers";
import { validateBlockerEligibility } from "../../../gre/combat";
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

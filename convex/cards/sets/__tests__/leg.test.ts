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
} from "../leg";
import { getCardById, getCardByName, getAllCards } from "../../index";
import { lightningBolt, mountain, forest, island } from "../lea";
import {
    resolveTopOfStack,
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

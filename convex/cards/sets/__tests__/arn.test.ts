// Arabian Nights (ARN) Batch 1 — per-card behavior tests (twin of lea.test.ts).
// Each non-trivial card gets a describe block citing the CR section it exercises.
// Tests assert external behavior only (effective P/T, damage, zone, combat
// outcome), per the PRD testing decisions.

import { describe, it, expect } from "vitest";
import {
    flyingMen,
    birdMaiden,
    moorishCavalry,
    stoneThrowingDevils,
    dancingScimitar,
    repentantBlacksmith,
    warElephant,
    wyluliWolf,
    aliBaba,
    kingSuleiman,
    juzamDjinn,
    serendibEfreet,
    jununEfreet,
    serendibDjinn,
    hasranOgress,
    elHajjaj,
    khabalGhoul,
    rukhEgg,
    dandan,
    islandFishJasconius,
    kirdApe,
    giantTortoise,
    fishliverOil,
    unstableMutation,
    jandorsSaddlebags,
    flyingCarpet,
    aladdinsRing,
    brassMan,
    cityOfBrass,
    elephantGraveyard,
    libraryOfAlexandria,
    armyOfAllah,
    piety,
    sandstorm,
    desertTwister,
    oasis,
    aliFromCairo,
    ebonyHorse,
    eyeForAnEye,
    pyramids,
    singingTree,
    islandOfWakWak,
    sorceressQueen,
    aladdin,
    oldManOfTheSea,
    ghazbanOgre,
    desert,
    desertNomads,
    camel,
    nafsAsp,
    cyclone,
    dropOfHoney,
} from "../arn";
import {
    grizzlyBears,
    plains,
    mountain,
    forest,
    island,
    prodigalSorcerer,
    psionicBlast,
    stoneRain,
} from "../lea";
import { checkStateBasedActions } from "../../../gre/sba";
import { validateBlockerEligibility } from "../../../gre/combat";
import { applyAllCombatDamage, fireDelayedTriggers } from "../../../gre/phases";
import { applyDamageReplacements } from "../../../gre/replacements";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import {
    resolveTopOfStack,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { getLegalTargets } from "../../../gre/rules";
import { projectPublicState } from "../../../gameProjections";

// --- helpers ---------------------------------------------------------------

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

/** Push a triggered ability directly with a synthetic event, then resolve. */
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

/** Resolve the head may-pay / choice pending decision by injecting the picks
 *  into the suspended stack item, then resolve the item again. */
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

const upkeepEvent = (playerId: string) =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

// ---------------------------------------------------------------------------
// Vanilla / keyword creatures (CR 702)
// ---------------------------------------------------------------------------

describe("ARN keyword creatures (CR 702 — staticAbilities)", () => {
    it("Flying Men has flying", () => {
        expect(flyingMen.staticAbilities).toContain("flying");
    });
    it("Bird Maiden has flying", () => {
        expect(birdMaiden.staticAbilities).toContain("flying");
    });
    it("Moorish Cavalry has trample", () => {
        expect(moorishCavalry.staticAbilities).toContain("trample");
    });
    it("Stone-Throwing Devils has first strike", () => {
        expect(stoneThrowingDevils.staticAbilities).toContain("first strike");
    });
    it("Dancing Scimitar is an artifact creature with flying", () => {
        expect(dancingScimitar.types).toEqual(["Artifact", "Creature"]);
        expect(dancingScimitar.staticAbilities).toContain("flying");
    });
    it("Repentant Blacksmith has protection from red", () => {
        expect(repentantBlacksmith.staticAbilities).toContain(
            "protection from red"
        );
    });
    it("War Elephant has trample and banding", () => {
        expect(warElephant.staticAbilities).toEqual(
            expect.arrayContaining(["trample", "banding"])
        );
    });
});

// ---------------------------------------------------------------------------
// pump-combat EffectShorthand + isBlocking filter (CR 611.2)
// ---------------------------------------------------------------------------

describe("Army of Allah (attacking creatures +2/+0, CR 611.2)", () => {
    it("pumps only attacking creatures", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            isAttacking: true,
        });
        const idle = makeInstance(grizzlyBears.id, { id: "idle" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker, idle] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, armyOfAllah.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectivePower(state, attacker)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(state, attacker)).toBe(2);
        expect(getEffectivePower(state, idle)).toBe(2); // unaffected
    });
});

describe("Piety (blocking creatures +0/+3, CR 611.2 + isBlocking filter)", () => {
    it("pumps only blocking creatures", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const idle = makeInstance(grizzlyBears.id, {
            id: "idle",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [blocker, idle] }),
            ],
        });
        pushSpell(state, piety.id, "p2");
        resolveTopOfStack(state);
        expect(getEffectiveToughness(state, blocker)).toBe(5); // 2 + 3
        expect(getEffectivePower(state, blocker)).toBe(2);
        expect(getEffectiveToughness(state, idle)).toBe(2); // unaffected
    });
});

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

describe("Sandstorm (1 damage to each attacking creature)", () => {
    it("kills a 1-toughness attacker, spares a non-attacker", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
            toughness: 1,
            power: 1,
        });
        const idle = makeInstance(grizzlyBears.id, {
            id: "idle",
            controllerId: "p2",
            ownerId: "p2",
            toughness: 1,
            power: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker, idle] }),
            ],
        });
        pushSpell(state, sandstorm.id, "p1");
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.battlefield.find((c) => c.id === "atk")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "idle")).toBeDefined();
    });
});

describe("Desert Twister (destroy target permanent)", () => {
    it("destroys a target creature", () => {
        const victim = makeInstance(grizzlyBears.id, {
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
        pushSpell(state, desertTwister.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Activated abilities (CR 602)
// ---------------------------------------------------------------------------

describe("Wyluli Wolf ({T}: target creature +1/+1 EOT)", () => {
    it("pumps the target until end of turn", () => {
        const wolf = makeInstance(wyluliWolf.id, { id: "wolf" });
        const target = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wolf, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wolf, "wyluli-wolf-pump", [
            { type: "permanent", id: "bear" },
        ]);
        expect(getEffectivePower(state, target)).toBe(3);
        expect(getEffectiveToughness(state, target)).toBe(3);
    });
});

describe("Ali Baba ({R}: tap target Wall)", () => {
    it("taps a Wall", () => {
        const ali = makeInstance(aliBaba.id, { id: "ali" });
        // Synthetic Wall (no Wall card in lea registry needed — minimal view).
        const wall = makeInstance(grizzlyBears.id, {
            id: "wall",
            subtypes: ["Wall"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ali] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        resolveActivated(state, ali, "ali-baba-tap-wall", [
            { type: "permanent", id: "wall" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "wall")!.isTapped
        ).toBe(true);
    });
});

describe("King Suleiman ({T}: destroy target Djinn or Efreet)", () => {
    it("destroys a Djinn", () => {
        const king = makeInstance(kingSuleiman.id, { id: "king" });
        const djinn = makeInstance(juzamDjinn.id, {
            id: "djinn",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king] }),
                makePlayer("p2", { battlefield: [djinn] }),
            ],
        });
        resolveActivated(state, king, "king-suleiman-destroy", [
            { type: "permanent", id: "djinn" },
        ]);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Jandor's Saddlebags ({3},{T}: untap target creature)", () => {
    it("untaps a tapped creature", () => {
        const bags = makeInstance(jandorsSaddlebags.id, { id: "bags" });
        const tapped = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bags, tapped] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bags, "jandors-saddlebags-untap", [
            { type: "permanent", id: "bear" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")!.isTapped
        ).toBe(false);
    });
});

describe("Flying Carpet ({2},{T}: target creature gains flying EOT)", () => {
    it("grants flying to the target", () => {
        const carpet = makeInstance(flyingCarpet.id, { id: "carpet" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [carpet, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, carpet, "flying-carpet-grant", [
            { type: "permanent", id: "bear" },
        ]);
        expect(
            state.players[0].battlefield
                .find((c) => c.id === "bear")!
                .staticAbilities.includes("flying")
        ).toBe(true);
    });
});

describe("Aladdin's Ring ({8},{T}: 4 damage to any target)", () => {
    it("deals 4 damage to a player", () => {
        const ring = makeInstance(aladdinsRing.id, { id: "ring" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ring, "aladdins-ring-bolt", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(16);
    });
});

// ---------------------------------------------------------------------------
// Upkeep / damage / death / state triggers
// ---------------------------------------------------------------------------

describe("Juzám Djinn (upkeep: 1 damage to you)", () => {
    it("deals 1 to its controller on upkeep", () => {
        const juzam = makeInstance(juzamDjinn.id, { id: "juzam" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [juzam] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, juzam, "juzam-djinn-upkeep", upkeepEvent("p1"));
        expect(state.players[0].life).toBe(19);
    });
});

describe("Serendib Efreet (flying + upkeep: 1 damage to you)", () => {
    it("has flying and pings its controller", () => {
        expect(serendibEfreet.staticAbilities).toContain("flying");
        const efreet = makeInstance(serendibEfreet.id, { id: "eff" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [efreet] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            efreet,
            "serendib-efreet-upkeep",
            upkeepEvent("p1")
        );
        expect(state.players[0].life).toBe(19);
    });
});

describe("Junún Efreet (upkeep: sacrifice unless pay {B}{B})", () => {
    function setup() {
        const efreet = makeInstance(jununEfreet.id, { id: "junun" });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [efreet] }),
                makePlayer("p2"),
            ],
        });
    }
    it("declining the payment sacrifices it", () => {
        const state = setup();
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "junun-efreet-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
    });
    it("paying keeps it on the battlefield", () => {
        const state = setup();
        state.players[0].manaPool = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 0 };
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "junun-efreet-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["yes"]);
        expect(state.players[0].battlefield).toHaveLength(1);
    });
});

describe("Serendib Djinn (upkeep: sac a land, Island → 3 damage)", () => {
    it("dealing 3 when the sacrificed land is an Island", () => {
        const djinn = makeInstance(serendibDjinn.id, { id: "djinn" });
        const isl = makeInstance(island.id, { id: "isl" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn, isl] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            djinn,
            "serendib-djinn-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["isl"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "isl")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(17); // 20 - 3 (Island)
    });
    it("no damage when the sacrificed land is not an Island", () => {
        const djinn = makeInstance(serendibDjinn.id, { id: "djinn" });
        const mtn = makeInstance(mountain.id, { id: "mtn" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn, mtn] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            djinn,
            "serendib-djinn-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["mtn"]);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Hasran Ogress (attacks: 3 damage to you unless pay {2})", () => {
    function setup() {
        const ogress = makeInstance(hasranOgress.id, { id: "ogress" });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [ogress] }),
                makePlayer("p2"),
            ],
        });
    }
    it("declining deals 3 to its controller", () => {
        const state = setup();
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "hasran-ogress-attack",
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["ogress"],
            } as StackItem["triggerEvent"]
        );
        answerChoice(state, ["decline"]);
        expect(state.players[0].life).toBe(17);
    });
});

describe("El-Hajjâj (whenever it deals damage, gain that much life)", () => {
    it("gains life equal to combat damage dealt", () => {
        const elh = makeInstance(elHajjaj.id, {
            id: "elh",
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elh] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, elh, "el-hajjaj-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "elh",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 1,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Khabál Ghoul (end step: +1/+1 per creature that died this turn)", () => {
    it("adds counters equal to deaths this turn", () => {
        const ghoul = makeInstance(khabalGhoul.id, { id: "ghoul" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ghoul] }),
                makePlayer("p2"),
            ],
        });
        state.deathsThisTurn = 3;
        resolveTrigger(state, ghoul, "khabal-ghoul-end-step", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const after = state.players[0].battlefield[0];
        expect(after.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(state, after)).toBe(4);
    });
});

describe("Rukh Egg (dies → 4/4 flying Bird at next end step)", () => {
    it("schedules a delayed token on death", () => {
        const egg = makeInstance(rukhEgg.id, { id: "egg" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [egg] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, egg, "rukh-egg-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "egg",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 3,
        } as StackItem["triggerEvent"]);
        expect((state.delayedTriggers ?? []).length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Islands-matter (CR 508 attack restriction + state-trigger sacrifice)
// ---------------------------------------------------------------------------

describe("Dandân (can't attack unless defender has Island; no Islands → sac)", () => {
    it("declares an attack-restriction static effect", () => {
        const restr = dandan.staticEffects?.[0];
        expect(restr?.kind).toBe("attack-restriction");
    });
    it("sacrifices itself when controller has no Islands", () => {
        const dd = makeInstance(dandan.id, { id: "dd" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dd] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, dd, "dandan-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield).toHaveLength(0);
    });
    it("survives the state-trigger while it controls an Island", () => {
        const dd = makeInstance(dandan.id, { id: "dd" });
        const isl = makeInstance(island.id, { id: "isl" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dd, isl] }),
                makePlayer("p2"),
            ],
        });
        // Intervening-if re-check fizzles the trigger: Dandân stays.
        resolveTrigger(state, dd, "dandan-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dd")
        ).toBeDefined();
    });
});

describe("Island Fish Jasconius (does-not-untap + pay {U}{U}{U} to untap)", () => {
    it("has the does-not-untap keyword", () => {
        expect(islandFishJasconius.staticAbilities).toContain("does-not-untap");
    });
    it("paying {U}{U}{U} on upkeep untaps it", () => {
        const fish = makeInstance(islandFishJasconius.id, {
            id: "fish",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fish] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 };
        resolveTrigger(
            state,
            fish,
            "island-fish-untap-option",
            upkeepEvent("p1")
        );
        answerChoice(state, ["yes"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "fish")!.isTapped
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Conditional buffs (CR 613 layer 7) — GRE + wire format
// ---------------------------------------------------------------------------

describe("Kird Ape (+1/+2 while you control a Forest, CR 613)", () => {
    it("is 1/1 without a Forest and 2/3 with one (GRE + wire)", () => {
        const ape = makeInstance(kirdApe.id, { id: "ape" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ape] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, ape)).toBe(1);
        expect(getEffectiveToughness(state, ape)).toBe(1);

        state.players[0].battlefield.push(
            makeInstance(forest.id, { id: "forest" })
        );
        expect(getEffectivePower(state, ape)).toBe(2);
        expect(getEffectiveToughness(state, ape)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ape"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Giant Tortoise (+0/+3 while untapped, CR 613)", () => {
    it("is 1/4 untapped and 1/1 tapped (GRE + wire)", () => {
        const tortoise = makeInstance(giantTortoise.id, { id: "tort" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tortoise] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, tortoise)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tort"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);

        tortoise.isTapped = true;
        expect(getEffectiveToughness(state, tortoise)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Auras (CR 303)
// ---------------------------------------------------------------------------

describe("Unstable Mutation (aura +3/+3 + upkeep -1/-1 counter)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const aura = makeInstance(unstableMutation.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, bear, aura };
    }
    it("grants +3/+3 to the host (GRE + wire)", () => {
        const { state, bear } = setup();
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(5);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
    });
    it("puts a -1/-1 counter on the host each upkeep", () => {
        const { state, aura } = setup();
        resolveTrigger(
            state,
            aura,
            "unstable-mutation-decay",
            upkeepEvent("p1")
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["-1/-1"]).toBe(1);
        // 2/2 base + 3/3 aura - 1/1 counter = 4/4
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });
});

describe("Fishliver Oil (aura grants islandwalk)", () => {
    it("declares an islandwalk keyword-grant on the host", () => {
        const grant = fishliverOil.staticEffects?.[0];
        expect(grant?.kind).toBe("keyword-grant");
        if (grant?.kind === "keyword-grant") {
            expect(grant.keyword).toBe("islandwalk");
        }
    });
});

// ---------------------------------------------------------------------------
// Lands (CR 305)
// ---------------------------------------------------------------------------

describe("City of Brass (becomes tapped → 1 damage; {T}: any color)", () => {
    it("deals 1 damage to its controller when it becomes tapped", () => {
        const city = makeInstance(cityOfBrass.id, { id: "city" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [city] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, city, "city-of-brass-tap-damage", {
            type: "PERMANENT_TAPPED",
            permanentId: "city",
            controllerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(19);
    });
    it("offers all five colors as mana choices", () => {
        const mana = cityOfBrass.activatedAbilities?.find(
            (a) => a.id === "city-of-brass-mana"
        );
        expect(mana?.manaChoices).toHaveLength(5);
    });
});

describe("Elephant Graveyard ({T}: regenerate target Elephant)", () => {
    it("stacks a regeneration shield on an Elephant", () => {
        const grave = makeInstance(elephantGraveyard.id, { id: "grave" });
        const elephant = makeInstance(warElephant.id, { id: "ele" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [grave, elephant] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, grave, "elephant-graveyard-regen", [
            { type: "permanent", id: "ele" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "ele")!
                .regenerationShields
        ).toBe(1);
    });
});

describe("Library of Alexandria ({T}: draw if exactly 7 cards in hand)", () => {
    function setup(handSize: number) {
        const lib = makeInstance(libraryOfAlexandria.id, { id: "lib" });
        const hand = Array.from({ length: handSize }, (_, i) =>
            makeInstance(plains.id, { id: `h${i}`, zone: "hand" })
        );
        const library = [
            makeInstance(mountain.id, { id: "top", zone: "library" }),
        ];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [lib], hand, library }),
                makePlayer("p2"),
            ],
        });
    }
    it("can activate the draw with exactly seven cards", () => {
        const state = setup(7);
        const ability = libraryOfAlexandria.activatedAbilities?.find(
            (a) => a.id === "library-of-alexandria-draw"
        );
        const lib = state.players[0].battlefield[0];
        expect(
            ability?.canActivate?.(
                { ...lib, controllerId: "p1" } as never,
                state as never
            )
        ).toBe(true);
    });
    it("cannot activate the draw with six cards", () => {
        const state = setup(6);
        const ability = libraryOfAlexandria.activatedAbilities?.find(
            (a) => a.id === "library-of-alexandria-draw"
        );
        const lib = state.players[0].battlefield[0];
        expect(
            ability?.canActivate?.(
                { ...lib, controllerId: "p1" } as never,
                state as never
            )
        ).toBe(false);
    });
});

describe("Brass Man (does-not-untap + pay {1} to untap on upkeep)", () => {
    it("has the does-not-untap keyword", () => {
        expect(brassMan.staticAbilities).toContain("does-not-untap");
    });
    it("paying {1} untaps it on upkeep", () => {
        const brass = makeInstance(brassMan.id, {
            id: "brass",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [brass] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
        resolveTrigger(
            state,
            brass,
            "brass-man-untap-option",
            upkeepEvent("p1")
        );
        answerChoice(state, ["yes"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "brass")!.isTapped
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Batch 3 (#175) — prevention / replacement / destroy-replacement / reflect
// ---------------------------------------------------------------------------

describe("Oasis ({T}: prevent next 1 damage to target creature, CR 615.1)", () => {
    it("prevents the next 1 damage dealt to the target creature", () => {
        const oasisLand = makeInstance(oasis.id, { id: "oasis" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const tim = makeInstance(prodigalSorcerer.id, { id: "tim" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [oasisLand, bear, tim] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, oasisLand, "oasis-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        // Tim zaps the shielded bear for 1 — fully prevented.
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "permanent", id: "bear" },
        ]);
        const survivor = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(survivor.damageMarked ?? 0).toBe(0);
    });
});

describe("Ali from Cairo (clamp life >= 1, CR 614)", () => {
    it("keeps life >= 1 against otherwise-lethal damage", () => {
        const ali = makeInstance(aliFromCairo.id, { id: "ali" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 3, battlefield: [ali] }),
                makePlayer("p2"),
            ],
        });
        // p2 casts a 4-damage burn at p1 (life 3) — would be lethal.
        pushSpell(state, psionicBlast.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(1);
    });

    it("is repeatable across multiple damage events", () => {
        const ali = makeInstance(aliFromCairo.id, { id: "ali" });
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tim2 = makeInstance(prodigalSorcerer.id, {
            id: "tim2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 1, battlefield: [ali] }),
                makePlayer("p2", { battlefield: [tim, tim2] }),
            ],
        });
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(1);
        resolveActivated(state, tim2, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(1);
    });

    it("the replacement fires through the public projection (wire format)", () => {
        const ali = makeInstance(aliFromCairo.id, { id: "ali" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 3, battlefield: [ali] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        // The projection strips card.card to { id }; the replacement is looked
        // up from the registry by that id, so it must still fire (wire format).
        const ev = applyDamageReplacements(projected as unknown as GameState, {
            kind: "damage",
            sourceInstanceId: "x",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: [],
            sourceStaticAbilities: [],
            target: { type: "player", id: "p1" },
            amount: 9,
            isCombat: false,
        });
        // Clamped so the resulting life total would be exactly 1 (3 - 2).
        expect(ev?.amount).toBe(2);
    });
});

describe("Ebony Horse ({2},{T}: untap attacker + prevent its combat damage both ways, CR 615)", () => {
    it("untaps the target and records the immunity shield", () => {
        const horse = makeInstance(ebonyHorse.id, { id: "horse" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            isAttacking: true,
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [horse, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, horse, "ebony-horse-untap", [
            { type: "permanent", id: "atk" },
        ]);
        const a = state.players[0].battlefield.find((c) => c.id === "atk")!;
        expect(a.isTapped).toBe(false);
        expect(
            state.combatDamageImmunity?.some((s) => s.instanceId === "atk")
        ).toBe(true);
    });

    it("prevents all combat damage to and by the shielded creature", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { blk: ["atk"] },
                blockersConfirmed: true,
            },
            combatDamageImmunity: [
                { instanceId: "atk", duration: { phase: "end-of-turn" } },
            ],
        });
        applyAllCombatDamage(state, { atk: { blk: 2 } });
        const a = state.players[0].battlefield.find((c) => c.id === "atk");
        const b = state.players[1].battlefield.find((c) => c.id === "blk");
        // Neither dealt damage to the other — both survive unmarked.
        expect(a?.damageMarked ?? 0).toBe(0);
        expect(b?.damageMarked ?? 0).toBe(0);
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield).toHaveLength(1);
    });
});

describe("Eye for an Eye (reflect damage to source's controller, CR 614)", () => {
    it("reflects the chosen source's damage to its controller without reducing yours", () => {
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20, battlefield: [tim] }),
            ],
        });
        pushSpell(state, eyeForAnEye.id, "p1", [
            { type: "permanent", id: "tim" },
        ]);
        resolveTopOfStack(state);
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(19); // damage to you unchanged
        expect(state.players[1].life).toBe(19); // reflected to source's controller
    });

    it("is one-shot — a second hit from the source is not reflected", () => {
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tim2 = makeInstance(prodigalSorcerer.id, {
            id: "tim2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20, battlefield: [tim, tim2] }),
            ],
        });
        pushSpell(state, eyeForAnEye.id, "p1", [
            { type: "permanent", id: "tim" },
        ]);
        resolveTopOfStack(state);
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        // Second zap from the same source: shield consumed, no reflect.
        resolveActivated(state, tim2, "prodigal-sorcerer-zap", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].life).toBe(18); // took both hits
        expect(state.players[1].life).toBe(19); // reflected only once
    });
});

describe("Pyramids (modal destroy-aura / save land, CR 614 + ADR 0020)", () => {
    it("mode 1 destroys a target Aura", () => {
        const pyr = makeInstance(pyramids.id, { id: "pyr" });
        const land = makeInstance(forest.id, { id: "land" });
        const aura = makeInstance(fishliverOil.id, {
            id: "aura",
            attachedTo: "land",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pyr, land, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, pyr, "pyramids-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "aura")).toBe(
            true
        );
    });

    it("mode 2 saves the target land from the next destruction this turn", () => {
        const pyr = makeInstance(pyramids.id, { id: "pyr" });
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pyr] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveActivated(state, pyr, "pyramids-save-land", [
            { type: "permanent", id: "land" },
        ]);
        // Stone Rain would destroy the land — the shield replaces it.
        pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "land" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeDefined();
        // Survives through the public projection (wire format).
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "land")
        ).toBeDefined();
        // Shield consumed — a second Stone Rain destroys it.
        pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "land" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Layer 7b set-base-P/T cards (CR 613.4b, ADR 0017)
// ---------------------------------------------------------------------------

describe("Singing Tree ({T}: target attacking creature base power 0)", () => {
    it("sets the target's base power to 0, leaving toughness", () => {
        const tree = makeInstance(singingTree.id, { id: "tree" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tree] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, tree, "singing-tree-set-power", [
            { type: "permanent", id: "atk" },
        ]);
        const bear = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(getEffectivePower(state, bear)).toBe(0);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });
});

describe("Island of Wak-Wak ({T}: target flyer base power 0)", () => {
    it("sets a flyer's base power to 0", () => {
        const isl = makeInstance(islandOfWakWak.id, { id: "wakwak" });
        const flyer = makeInstance(grizzlyBears.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [isl] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, isl, "island-of-wak-wak-set-power", [
            { type: "permanent", id: "flyer" },
        ]);
        const f = state.players[1].battlefield.find((c) => c.id === "flyer")!;
        expect(getEffectivePower(state, f)).toBe(0);
    });
    it("only flyers are legal targets (requireAbility)", () => {
        const flyer = makeInstance(grizzlyBears.id, {
            id: "flyer",
            staticAbilities: ["flying"],
        });
        const ground = makeInstance(grizzlyBears.id, { id: "ground" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flyer, ground] }),
                makePlayer("p2"),
            ],
        });
        const req = islandOfWakWak.activatedAbilities![0].targetRequirement!;
        const legal = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(legal).toContain("flyer");
        expect(legal).not.toContain("ground");
    });
});

describe("Sorceress Queen ({T}: target other creature base 0/2)", () => {
    it("sets the target's base power and toughness to 0/2, +counter = 1/3", () => {
        const queen = makeInstance(sorceressQueen.id, { id: "queen" });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [queen] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, queen, "sorceress-queen-set", [
            { type: "permanent", id: "victim" },
        ]);
        const v = state.players[1].battlefield.find((c) => c.id === "victim")!;
        expect(getEffectivePower(state, v)).toBe(0);
        expect(getEffectiveToughness(state, v)).toBe(2);
        // 7b set then 7c counter (CR 613.4): 0/2 + a +1/+1 counter = 1/3.
        v.counters = { "+1/+1": 1 };
        expect(getEffectivePower(state, v)).toBe(1);
        expect(getEffectiveToughness(state, v)).toBe(3);
    });
    it("cannot target itself (excludeInstanceIds via getTargetRequirement)", () => {
        const queen = makeInstance(sorceressQueen.id, { id: "queen" });
        const other = makeInstance(grizzlyBears.id, { id: "other" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [queen, other] }),
                makePlayer("p2"),
            ],
        });
        const ability = sorceressQueen.activatedAbilities![0];
        const req = ability.getTargetRequirement!(
            { ...queen } as never,
            state as never
        );
        const legal = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(legal).toContain("other");
        expect(legal).not.toContain("queen");
    });
});

// ---------------------------------------------------------------------------
// Batch 5 (#176) — activated / triggered control-gain (CR 613.1b, layer 2)
// ---------------------------------------------------------------------------

describe("Aladdin ({1}{R}{R},{T}: gain control of an artifact while you control it)", () => {
    it("takes an artifact's control, reverting when Aladdin leaves", () => {
        const al = makeInstance(aladdin.id, {
            id: "aladdin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const art = makeInstance(brassMan.id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [al] }),
                makePlayer("p2", { battlefield: [art] }),
            ],
        });
        resolveActivated(state, al, "aladdin-steal-artifact", [
            { type: "permanent", id: "art" },
        ]);
        checkStateBasedActions(state);
        // Artifact now under p1, physically in p1's battlefield array.
        expect(
            state.players[0].battlefield.find((c) => c.id === "art")
                ?.controllerId
        ).toBe("p1");
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();

        // Aladdin leaves → "for as long as you control Aladdin" lapses → revert.
        removePermanentTo(state, "aladdin", "graveyard");
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
                ?.controllerId
        ).toBe("p2");
    });

    it("the control change survives the public projection (wire format)", () => {
        const al = makeInstance(aladdin.id, {
            id: "aladdin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const art = makeInstance(brassMan.id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [al] }),
                makePlayer("p2", { battlefield: [art] }),
            ],
        });
        resolveActivated(state, al, "aladdin-steal-artifact", [
            { type: "permanent", id: "art" },
        ]);
        checkStateBasedActions(state);
        const projected = projectPublicState(state, 1, "p1");
        // The stolen artifact projects under p1 (the new controller).
        expect(
            projected.players[0].battlefield.find((c) => c.id === "art")
                ?.controllerId
        ).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
    });
});

describe("Old Man of the Sea ({T}: steal a creature with power <= its own while tapped)", () => {
    it("gains control while tapped and reverts when it untaps", () => {
        const old = makeInstance(oldManOfTheSea.id, {
            id: "old",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [old] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Activation taps Old Man (cost {T}); resolveActivated assumes the cost
        // was paid, so tap the source to model the condition.
        old.isTapped = true;
        resolveActivated(state, old, "old-man-of-the-sea-steal", [
            { type: "permanent", id: "bear" },
        ]);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p1");

        // Old Man untaps → "remains tapped" lapses → control reverts.
        state.players[0].battlefield.find((c) => c.id === "old")!.isTapped =
            false;
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p2");
    });

    it("only creatures with power <= its own are legal targets", () => {
        const old = makeInstance(oldManOfTheSea.id, { id: "old" });
        const small = makeInstance(grizzlyBears.id, { id: "small" }); // 2/2
        const big = makeInstance(moorishCavalry.id, { id: "big" }); // 3/3
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [old, small, big] }),
                makePlayer("p2"),
            ],
        });
        const req = oldManOfTheSea.activatedAbilities![0].getTargetRequirement!(
            { ...old } as never,
            state as never
        );
        const legal = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(legal).toContain("small");
        expect(legal).not.toContain("big");
    });
});

describe("Ghazbán Ogre (upkeep: control to the unique most-life player, CR 603.4)", () => {
    it("moves to the player with strictly the most life at upkeep", () => {
        const ogre = makeInstance(ghazbanOgre.id, {
            id: "ogre",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 15, battlefield: [ogre] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveTrigger(state, ogre, "ghazban-ogre-upkeep", upkeepEvent("p1"));
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ogre")
                ?.controllerId
        ).toBe("p2");
    });

    it("does not move on a life tie (no unique most-life player)", () => {
        const ogre = makeInstance(ghazbanOgre.id, {
            id: "ogre",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [ogre] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveTrigger(state, ogre, "ghazban-ogre-upkeep", upkeepEvent("p1"));
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "ogre")
                ?.controllerId
        ).toBe("p1");
    });
});

// ---------------------------------------------------------------------------
// Batch 6 (#177) — Deserts (desertwalk + Desert-source damage prevention)
// ---------------------------------------------------------------------------

describe("Desert (mana + end-of-combat ping)", () => {
    it("taps for {C} and pings an attacking creature for 1", () => {
        expect(desert.subtypes).toContain("Desert");
        const manaAbility = desert.activatedAbilities!.find(
            (a) => a.id === "desert-mana"
        )!;
        expect(manaAbility.manaProduced).toEqual({ C: 1 });

        const des = makeInstance(desert.id, { id: "des" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [des] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "atk" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
                ?.damageMarked
        ).toBe(1);
    });
});

describe("Desert Nomads (desertwalk + prevent damage from Deserts)", () => {
    it("has desertwalk and is unblockable when the defender controls a Desert", () => {
        expect(desertNomads.staticAbilities).toContain("desertwalk");
        const nomads = makeInstance(desertNomads.id, { id: "nomads" });
        const blocker = makeInstance(grizzlyBears.id, { id: "blk" });
        const des = makeInstance(desert.id, { id: "des" });

        // Defender controls a Desert → desertwalk makes Nomads unblockable.
        expect(
            validateBlockerEligibility(nomads, blocker, [blocker, des]).eligible
        ).toBe(false);
        // No Desert → blockable normally.
        expect(
            validateBlockerEligibility(nomads, blocker, [blocker]).eligible
        ).toBe(true);
    });

    it("prevents Desert damage to itself but takes non-Desert damage", () => {
        const nomads = makeInstance(desertNomads.id, {
            id: "nomads",
            controllerId: "p2",
            ownerId: "p2",
        });
        const des = makeInstance(desert.id, { id: "des" });
        const tim = makeInstance(prodigalSorcerer.id, { id: "tim" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [des, tim] }),
                makePlayer("p2", { battlefield: [nomads] }),
            ],
        });
        // Desert ping → prevented (source is a Desert).
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "nomads" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "nomads")
                ?.damageMarked ?? 0
        ).toBe(0);
        // A non-Desert source still hits it.
        resolveActivated(state, tim, "prodigal-sorcerer-zap", [
            { type: "permanent", id: "nomads" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "nomads")
                ?.damageMarked
        ).toBe(1);
    });

    it("the Desert-damage prevention fires through the public projection (wire format)", () => {
        const nomads = makeInstance(desertNomads.id, {
            id: "nomads",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [nomads] }),
            ],
        });
        const projected = projectPublicState(state, 2, "p2");
        // The projection strips card.card to { id }; the replacement is looked
        // up from the registry by that id, so it must still consume the event.
        const ev = applyDamageReplacements(projected as unknown as GameState, {
            kind: "damage",
            sourceInstanceId: "des",
            sourceControllerId: "p1",
            sourceColors: [],
            sourceTypes: ["Land"],
            sourceSubtypes: ["Desert"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "nomads" },
            amount: 1,
            isCombat: false,
        });
        expect(ev).toBeNull();
    });
});

describe("Camel (banding + Desert-damage prevention for its band while attacking)", () => {
    it("has banding", () => {
        expect(camel.staticAbilities).toContain("banding");
    });

    it("while attacking, prevents Desert damage to itself and band-mates", () => {
        const cam = makeInstance(camel.id, {
            id: "camel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ally = makeInstance(grizzlyBears.id, {
            id: "ally",
            controllerId: "p2",
            ownerId: "p2",
        });
        const des = makeInstance(desert.id, { id: "des" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [des] }),
                makePlayer("p2", { battlefield: [cam, ally] }),
            ],
            combat: {
                attackerIds: ["camel", "ally"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
                bands: [{ bandId: "b1", memberIds: ["camel", "ally"] }],
            },
        });
        // Desert damage to the band-mate is prevented (Camel attacking).
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "ally" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ally")
                ?.damageMarked ?? 0
        ).toBe(0);
        // And to Camel itself.
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "camel" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "camel")
                ?.damageMarked ?? 0
        ).toBe(0);
    });

    it("does NOT prevent Desert damage while Camel is not attacking", () => {
        const cam = makeInstance(camel.id, {
            id: "camel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const des = makeInstance(desert.id, { id: "des" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [des] }),
                makePlayer("p2", { battlefield: [cam] }),
            ],
        });
        resolveActivated(state, des, "desert-ping", [
            { type: "permanent", id: "camel" },
        ]);
        // Damage lands (not prevented) — the 0/1 Camel takes lethal and dies.
        expect(
            state.players[1].battlefield.find((c) => c.id === "camel")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "camel")).toBe(
            true
        );
    });
});

// ---------------------------------------------------------------------------
// Batch 7 (#178) — scheduled pay-or-suffer (delayed trigger + may-pay)
// ---------------------------------------------------------------------------

/** Push a delayed trigger onto the stack as the engine's `fireDelayedTriggers`
 *  does, then resolve it. */
function resolveDelayed(
    state: GameState,
    sourceCardId: string,
    controller: string,
    delayedTriggerId: string,
    payload: Record<string, string>
): void {
    state.stack.push({
        id: `dt-stack-${delayedTriggerId}`,
        card: { id: sourceCardId },
        controllerId: controller,
        ownerId: controller,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: controller,
        delayedTriggerId,
        delayedPayload: payload,
    } as StackItem);
    resolveTopOfStack(state);
}

describe("Nafs Asp (damage → next-draw-step pay {1} or lose 1 life)", () => {
    it("schedules a next-draw-step delayed trigger on the damaged player", () => {
        const asp = makeInstance(nafsAsp.id, {
            id: "asp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [asp] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, asp, "nafs-asp-damage", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "asp",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 1,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        const dt = state.delayedTriggers?.[0];
        expect(dt?.timing).toBe("next-draw-step");
        expect(dt?.targetPlayerId).toBe("p2");
        expect(dt?.payload.playerId).toBe("p2");
    });

    it("fires only on the target player's draw step; declining loses 1 life", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
            delayedTriggers: [
                {
                    id: "delayed-1",
                    sourceCardId: nafsAsp.id,
                    triggerId: "nafs-asp-draw-step",
                    controller: "p1",
                    timing: "next-draw-step",
                    payload: { playerId: "p2" },
                    targetPlayerId: "p2",
                },
            ],
        });
        // p1's draw step does NOT fire it (wrong player).
        state.activePlayerId = "p1";
        fireDelayedTriggers(state, "next-draw-step");
        expect(state.stack).toHaveLength(0);
        expect(state.delayedTriggers).toHaveLength(1);

        // p2's draw step fires it.
        state.activePlayerId = "p2";
        fireDelayedTriggers(state, "next-draw-step");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state); // suspends at the may-pay
        answerChoice(state, ["decline"]);
        expect(state.players[1].life).toBe(19);
    });

    it("paying {1} avoids the life loss", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", {
                    life: 20,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
            ],
        });
        resolveDelayed(state, nafsAsp.id, "p1", "nafs-asp-draw-step", {
            playerId: "p2",
        });
        answerChoice(state, ["yes"]);
        expect(state.players[1].life).toBe(20);
    });
});

describe("Cyclone (upkeep: wind counter, pay {G}/counter or sacrifice + damage-each)", () => {
    it("declining the payment sacrifices Cyclone", () => {
        const cyc = makeInstance(cyclone.id, { id: "cyc" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cyc] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, cyc, "cyclone-upkeep", upkeepEvent("p1"));
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("paying adds a wind counter and deals that many to each creature and player", () => {
        const cyc = makeInstance(cyclone.id, { id: "cyc" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [cyc],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
                }),
                makePlayer("p2", { life: 20, battlefield: [bear] }),
            ],
        });
        resolveTrigger(state, cyc, "cyclone-upkeep", upkeepEvent("p1"));
        answerChoice(state, ["yes"]);
        const cycAfter = state.players[0].battlefield.find(
            (c) => c.id === "cyc"
        )!;
        expect(cycAfter.counters?.wind).toBe(1);
        // 1 damage to each creature and each player.
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.damageMarked
        ).toBe(1);
    });
});

describe("Drop of Honey (upkeep: destroy least-power; sac when no creatures)", () => {
    it("destroys the single least-power creature (can't be regenerated)", () => {
        const drop = makeInstance(dropOfHoney.id, { id: "drop" });
        const weak = makeInstance(flyingMen.id, { id: "weak" }); // 1/1
        const strong = makeInstance(grizzlyBears.id, {
            id: "strong",
            controllerId: "p2",
            ownerId: "p2",
        }); // 2/2
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drop, weak] }),
                makePlayer("p2", { battlefield: [strong] }),
            ],
        });
        resolveTrigger(state, drop, "drop-of-honey-upkeep", upkeepEvent("p1"));
        expect(
            state.players[0].battlefield.find((c) => c.id === "weak")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "strong")
        ).toBeDefined();
    });

    it("asks the controller to choose among power ties", () => {
        const drop = makeInstance(dropOfHoney.id, { id: "drop" });
        const g1 = makeInstance(grizzlyBears.id, { id: "g1" });
        const g2 = makeInstance(grizzlyBears.id, { id: "g2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drop, g1, g2] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, drop, "drop-of-honey-upkeep", upkeepEvent("p1"));
        answerChoice(state, ["g2"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "g2")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "g1")
        ).toBeDefined();
    });

    it("sacrifices itself when there are no creatures (state trigger)", () => {
        const drop = makeInstance(dropOfHoney.id, { id: "drop" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drop] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, drop, "drop-of-honey-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

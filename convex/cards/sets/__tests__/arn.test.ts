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
    singingTree,
    islandOfWakWak,
    sorceressQueen,
} from "../arn";
import { grizzlyBears, plains, mountain, forest, island } from "../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import {
    resolveTopOfStack,
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

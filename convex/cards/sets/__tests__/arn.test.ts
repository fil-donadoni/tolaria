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
    ergRaiders,
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
    metamorphosis,
    oubliette,
    magneticMountain,
    cuombajjWitches,
    ifhBiffEfreet,
    guardianBeast,
    abuJafar,
    jandorsRing,
    bottleOfSuleiman,
    mijaeDjinn,
    ydwenEfreet,
    jihad,
    aladdinsLamp,
    bazaarOfBaghdad,
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
    flight,
    blackLotus,
    shatter,
    stealArtifact,
    animateArtifact,
} from "../lea";
import { getInstanceManaCost, tryGetCardById } from "../../";
import type { Color, PhaseBeginEvent } from "../../types";
import { checkStateBasedActions } from "../../../gre/sba";
import { validateBlockerEligibility } from "../../../gre/combat";
import {
    advancePhase,
    applyAllCombatDamage,
    fireDelayedTriggers,
    untapStep,
} from "../../../gre/phases";
import {
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
} from "../../../gre/pendingChoiceSubmit";
import { applyDamageReplacements } from "../../../gre/replacements";
import { matchesPermanentFilter } from "../../filters";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";
import {
    resolveTopOfStack,
    removePermanentTo,
    spendablePoolForSpell,
    payManaCostForSpell,
    restrictionAllowsSpell,
    isManaCostCovered,
    getManaSubstitutions,
    normalizeManaCost,
    phaseOutPermanent,
    phaseInBundle,
    regenerateOrDestroy,
    destroyWithReplacements,
    applyControlChange,
    combatPartnerIds,
    drawCard,
    canPayDiscardLastDrawn,
    payDiscardLastDrawn,
    getPlayer,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../gre/layers";
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

const endStepEvent = (playerId: string): PhaseBeginEvent => ({
    type: "PHASE_BEGIN",
    phase: "END_STEP",
    activePlayerId: playerId,
});

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

describe("Jandor's Ring ({2},{T}, discard last drawn: Draw a card)", () => {
    // drawCard records the last-drawn card per player (CR — Jandor's Ring).
    it("drawCard tracks the last card drawn this turn", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
                makeInstance(plains.id, { id: "b", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];
        expect(player.lastDrawnCardId).toBeUndefined();
        const first = drawCard(player);
        expect(first?.id).toBe("a");
        expect(player.lastDrawnCardId).toBe("a");
        drawCard(player);
        expect(player.lastDrawnCardId).toBe("b");
    });

    it("can pay the discard cost only while the drawn card is still in hand", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];
        // No draw yet — cost unpayable.
        expect(canPayDiscardLastDrawn(player)).toBe(false);
        drawCard(player);
        expect(canPayDiscardLastDrawn(player)).toBe(true);
        // Card leaves hand (played/discarded elsewhere) — cost unpayable again.
        player.hand = [];
        expect(canPayDiscardLastDrawn(player)).toBe(false);
    });

    it("paying discards the last-drawn card and clears the tracker", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const player = state.players[0];
        drawCard(player);
        expect(player.hand.map((c) => c.id)).toEqual(["a"]);
        payDiscardLastDrawn(player);
        expect(player.hand).toHaveLength(0);
        expect(player.graveyard.map((c) => c.id)).toEqual(["a"]);
        expect(player.lastDrawnCardId).toBeUndefined();
        // Cost can no longer be paid — same draw can't fund a second use.
        expect(canPayDiscardLastDrawn(player)).toBe(false);
    });

    it("resolving the ability draws a card", () => {
        const ring = makeInstance(jandorsRing.id, { id: "ring" });
        const p1 = makePlayer("p1", {
            battlefield: [ring],
            library: [makeInstance(plains.id, { id: "top", zone: "library" })],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        resolveActivated(state, ring, "jandors-ring-draw");
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
    });

    it("wire format: lastDrawnCardId and the drawn hand card survive projection", () => {
        const p1 = makePlayer("p1", {
            library: [
                makeInstance(grizzlyBears.id, { id: "a", zone: "library" }),
            ],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        drawCard(state.players[0]);
        const projected = projectPublicState(state, 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.lastDrawnCardId).toBe("a");
        // The viewer's own hand keeps the card id (slimmed but identifiable),
        // so the UI can gate the discard cost on it.
        expect(me.hand.some((c) => c !== null && c.id === "a")).toBe(true);
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

describe("Erg Raiders (end step: 2 damage to you unless it attacked / just arrived, CR 603.3e/603.4)", () => {
    const ability = ergRaiders.triggeredAbilities!.find(
        (a) => a.id === "erg-raiders-end-step"
    )!;

    it("is a 2/3 Human Warrior costing {1}{B}", () => {
        expect(ergRaiders.power).toBe(2);
        expect(ergRaiders.toughness).toBe(3);
        expect(ergRaiders.subtypes).toEqual(["Human", "Warrior"]);
        expect(ergRaiders.manaCost).toEqual({ X: 1, B: 1 });
    });

    it("deals 2 damage to you at end step when it didn't attack", () => {
        const erg = makeInstance(ergRaiders.id, { id: "erg" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        // It triggers (didn't attack, not summoning sick)...
        expect(ability.matches(endStepEvent("p1"), erg, state)).toBe(true);
        resolveTrigger(state, erg, "erg-raiders-end-step", endStepEvent("p1"));
        expect(state.players[0].life).toBe(18);
    });

    it("deals no damage when it attacked this turn (CR 603.4 intervening-if)", () => {
        const erg = makeInstance(ergRaiders.id, {
            id: "erg",
            hasAttackedThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        // Intervening-if blocks it both at trigger time and at resolve time.
        expect(ability.matches(endStepEvent("p1"), erg, state)).toBe(false);
        resolveTrigger(state, erg, "erg-raiders-end-step", endStepEvent("p1"));
        expect(state.players[0].life).toBe(20);
    });

    it("does not trigger the turn it came under your control (CR 603.3e)", () => {
        const erg = makeInstance(ergRaiders.id, {
            id: "erg",
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        expect(ability.matches(endStepEvent("p1"), erg, state)).toBe(false);
    });

    it("only fires on its own controller's end step, not the opponent's", () => {
        const erg = makeInstance(ergRaiders.id, { id: "erg" });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [erg] }),
                makePlayer("p2"),
            ],
        });
        expect(ability.matches(endStepEvent("p2"), erg, state)).toBe(false);
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

describe("Abu Ja'far (dies → destroy combat partners; no regen; CR 603.2/603.10)", () => {
    /** Build combat with Abu Ja'far in it and return the assembled state. When
     *  `abuIsAttacker` is true Abu is the attacker and `partner` is its
     *  blocker; otherwise Abu is a blocker and `partner` is the attacker it
     *  blocks. `partnerRegen` gives the partner a regeneration shield. */
    function combatState(opts: {
        abuIsAttacker: boolean;
        partnerRegen?: boolean;
    }) {
        const abu = makeInstance(abuJafar.id, {
            id: "abu",
            controllerId: "p1",
            ownerId: "p1",
        });
        const partner = makeInstance(grizzlyBears.id, {
            id: "partner",
            controllerId: "p2",
            ownerId: "p2",
        });
        if (opts.partnerRegen) partner.regenerationShields = 1;
        const blockerAssignments: Record<string, string[]> = opts.abuIsAttacker
            ? { partner: ["abu"] }
            : { abu: ["partner"] };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [abu] }),
                makePlayer("p2", { battlefield: [partner] }),
            ],
            combat: {
                attackerIds: [opts.abuIsAttacker ? "abu" : "partner"],
                confirmed: true,
                blockerAssignments,
                blockedAttackerIds: [opts.abuIsAttacker ? "abu" : "partner"],
                blockersConfirmed: true,
            },
        });
        return { state, abu, partner };
    }

    it("combatPartnerIds finds the creature blocking it (Abu attacking)", () => {
        const { state } = combatState({ abuIsAttacker: true });
        expect(combatPartnerIds(state, "abu")).toEqual(["partner"]);
    });

    it("combatPartnerIds finds the creature it blocks (Abu blocking)", () => {
        const { state } = combatState({ abuIsAttacker: false });
        expect(combatPartnerIds(state, "abu")).toEqual(["partner"]);
    });

    it("destroys the creature blocking Abu Ja'far when it dies", () => {
        const { state, abu } = combatState({ abuIsAttacker: true });
        // Death snapshots combatPartnerIds onto CREATURE_DIED.
        removePermanentTo(state, "abu", "graveyard");
        const died = (state.pendingEvents ?? []).find(
            (e) => e.type === "CREATURE_DIED"
        ) as { combatPartnerIds?: string[] } | undefined;
        expect(died?.combatPartnerIds).toEqual(["partner"]);
        // Resolve the death trigger with that captured event.
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: ["partner"],
        } as StackItem["triggerEvent"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "partner")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "partner")).toBe(
            true
        );
    });

    it("destroys the attacker Abu Ja'far was blocking when it dies", () => {
        const { state, abu } = combatState({ abuIsAttacker: false });
        removePermanentTo(state, "abu", "graveyard");
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: ["partner"],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].graveyard.some((c) => c.id === "partner")).toBe(
            true
        );
    });

    it("partners can't be regenerated (regen shield does not save them)", () => {
        const { state, abu, partner } = combatState({
            abuIsAttacker: true,
            partnerRegen: true,
        });
        expect(partner.regenerationShields).toBe(1);
        removePermanentTo(state, "abu", "graveyard");
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: ["partner"],
        } as StackItem["triggerEvent"]);
        // cantBeRegenerated suppressed the shield (CR 701.15c).
        expect(state.players[1].graveyard.some((c) => c.id === "partner")).toBe(
            true
        );
    });

    it("does nothing when Abu Ja'far dies outside combat", () => {
        const abu = makeInstance(abuJafar.id, {
            id: "abu",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bystander = makeInstance(grizzlyBears.id, {
            id: "by",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [abu] }),
                makePlayer("p2", { battlefield: [bystander] }),
            ],
        });
        removePermanentTo(state, "abu", "graveyard");
        const died = (state.pendingEvents ?? []).find(
            (e) => e.type === "CREATURE_DIED"
        ) as { combatPartnerIds?: string[] } | undefined;
        expect(died?.combatPartnerIds ?? []).toEqual([]);
        resolveTrigger(state, abu, "abu-jafar-death", {
            type: "CREATURE_DIED",
            creatureInstanceId: "abu",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 0,
            creatureToughness: 1,
            combatPartnerIds: [],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].battlefield.some((c) => c.id === "by")).toBe(
            true
        );
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

    // CR 511.2 — attackers remain attacking until the END_OF_COMBAT step
    // *ends*. Regression for #310: Desert can only be activated during
    // END_OF_COMBAT and targets an attacking creature; clearing the attacking
    // status on step entry made `getLegalTargets` return nothing and threw
    // "No legal targets available".
    it("an attacker is still a legal Desert target throughout END_OF_COMBAT", () => {
        const pingAbility = desert.activatedAbilities!.find(
            (a) => a.id === "desert-ping"
        )!;
        const des = makeInstance(desert.id, { id: "des" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        // Active player p2 has the attacker; defending p1 controls the Desert.
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
            players: [
                makePlayer("p1", { battlefield: [des] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });

        // COMBAT_DAMAGE → END_OF_COMBAT: the attacker must STILL be attacking.
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        const atkInCombat = state.players[1].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(atkInCombat.isAttacking).toBe(true);

        // ...and therefore a legal target for Desert's "target attacking
        // creature" ability (caster = the Desert's controller, p1).
        const legal = getLegalTargets(
            state,
            pingAbility.targetRequirement!,
            [],
            "p1"
        );
        expect(
            legal.some((t) => t.type === "permanent" && t.id === "atk")
        ).toBe(true);

        // Leaving END_OF_COMBAT ends combat: the status clears (CR 511.2).
        advancePhase(state);
        expect(state.phase).toBe("POSTCOMBAT_MAIN");
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
                ?.isAttacking
        ).toBeUndefined();
        expect(state.combat).toBeUndefined();
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

describe("Metamorphosis (CR 106.6 restricted mana / 117.9 additional cost)", () => {
    // Push Metamorphosis as if cast: a color mode chosen at announcement
    // (CR 700.2c) and the sacrificed creature's mana value snapshotted
    // (CR 117.9), then resolve so the chosen mode's body runs.
    function resolveMetamorphosis(
        state: GameState,
        modeId: string,
        sacrificedMv: number
    ): void {
        const item = pushSpell(state, metamorphosis.id, "p1");
        item.chosenModeId = modeId;
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "sac",
            mv: sacrificedMv,
        };
        resolveTopOfStack(state);
    }

    it("adds 1 + sacrificed mana value as restricted mana of the chosen color", () => {
        const state = makeState();
        resolveMetamorphosis(state, "red", 3); // X = 1 + 3
        expect(state.players[0].restrictedMana).toEqual([
            { color: "R", amount: 4, restriction: "creature-spell" },
        ]);
        // Nothing leaks into the fungible pool.
        expect(state.players[0].manaPool.R).toBe(0);
    });

    it("maps each color mode to the matching mana color", () => {
        const cases: [string, string][] = [
            ["white", "W"],
            ["blue", "U"],
            ["black", "B"],
            ["red", "R"],
            ["green", "G"],
        ];
        for (const [modeId, color] of cases) {
            const state = makeState();
            resolveMetamorphosis(state, modeId, 0); // X = 1
            expect(state.players[0].restrictedMana).toEqual([
                { color, amount: 1, restriction: "creature-spell" },
            ]);
        }
    });

    it("restrictionAllowsSpell gates creature-spell mana correctly", () => {
        expect(restrictionAllowsSpell("creature-spell", ["Creature"])).toBe(
            true
        );
        expect(restrictionAllowsSpell("creature-spell", ["Sorcery"])).toBe(
            false
        );
    });

    // Integration across the GRE -> game.ts spell-cast boundary: mirror the
    // affordability check + payment that the cast mutations perform for a
    // creature vs a noncreature spell (CR 106.6).
    it("pays a creature spell from restricted mana but rejects a noncreature spell", () => {
        const subs = getManaSubstitutions(makeState(), "p1"); // [] — no Sunglasses
        const creatureCost = normalizeManaCost(
            getInstanceManaCost(
                makeInstance(grizzlyBears.id, { zone: "hand" })
            )!
        ); // Grizzly Bears {1}{G} -> { X: 1, G: 1 }
        const creatureTypes = tryGetCardById(grizzlyBears.id)!.types;

        const caster = makePlayer("p1", {
            restrictedMana: [
                { color: "G", amount: 4, restriction: "creature-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(caster, creatureTypes),
                creatureCost,
                subs
            )
        ).toBe(true);
        payManaCostForSpell(caster, creatureCost, creatureTypes, subs);
        // Cost is 2 (one green pip + one generic), both drawn from restricted.
        expect(caster.restrictedMana).toEqual([
            { color: "G", amount: 2, restriction: "creature-spell" },
        ]);
        expect(caster.manaPool.G).toBe(0);

        // Same pool, but the spell is NOT a creature spell -> not spendable.
        const noncreature = makePlayer("p1", {
            restrictedMana: [
                { color: "G", amount: 4, restriction: "creature-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(noncreature, ["Sorcery"]),
                creatureCost,
                subs
            )
        ).toBe(false);
    });

    it("drains restricted mana before the fungible pool (settlement policy)", () => {
        const player = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 },
            restrictedMana: [
                { color: "G", amount: 2, restriction: "creature-spell" },
            ],
        });
        payManaCostForSpell(player, { G: 2 }, ["Creature"], []);
        // Restricted mana emptied first; the fungible green is untouched.
        expect(player.restrictedMana).toBeUndefined();
        expect(player.manaPool.G).toBe(3);
    });

    it("restricted mana survives the wire projection (CR 106.6)", () => {
        const state = makeState();
        resolveMetamorphosis(state, "green", 1); // X = 2 green
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].restrictedMana).toEqual([
            { color: "G", amount: 2, restriction: "creature-spell" },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Oubliette — phasing (CR 702.26, ADR 0021)
// ---------------------------------------------------------------------------

describe("Oubliette (phasing CR 702.26)", () => {
    /** Oubliette controlled by p1, enchanting/targeting p2's creature, which
     *  itself carries an Aura. Returns the assembled state plus handles. */
    function setup() {
        const oubl = makeInstance(oubliette.id, {
            id: "oubl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creature = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            counters: { "+1/+1": 2 },
        });
        const aura = makeInstance(flight.id, {
            id: "flight-1",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [oubl, aura] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        return { state, oubl, creature, aura };
    }

    it("phases out the creature with its Aura, silently (no events, no graveyard)", () => {
        const { state } = setup();
        state.pendingEvents = undefined;
        const bundleId = phaseOutPermanent(state, "bear", {
            returnOn: { kind: "source-leaves", sourceId: "oubl" },
            onPhaseIn: { tap: true },
        });
        expect(bundleId).not.toBeNull();
        // Creature + aura are gone from every battlefield...
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "flight-1")
        ).toBeUndefined();
        // ...held in one bundle (host + aura), not in any graveyard...
        expect(state.phasedOut).toHaveLength(1);
        expect(state.phasedOut![0].cards).toHaveLength(2);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(0);
        // ...and the silent move emits no enters/leaves triggers.
        expect(state.pendingEvents ?? []).toHaveLength(0);
    });

    it("returns the creature tapped and still enchanted when Oubliette leaves", () => {
        const { state } = setup();
        phaseOutPermanent(state, "bear", {
            returnOn: { kind: "source-leaves", sourceId: "oubl" },
            onPhaseIn: { tap: true },
        });
        expect(state.phasedOut).toHaveLength(1);
        // Oubliette leaving the battlefield ends the duration → phase in.
        removePermanentTo(state, "oubl", "graveyard");
        const bear = state.players[1].battlefield.find((c) => c.id === "bear");
        expect(bear).toBeDefined();
        expect(bear!.isTapped).toBe(true); // "Tap that creature as it phases in"
        expect(bear!.counters?.["+1/+1"]).toBe(2); // counters preserved
        const aura = state.players[0].battlefield.find(
            (c) => c.id === "flight-1"
        );
        expect(aura).toBeDefined();
        expect(aura!.attachedTo).toBe("bear"); // still attached
        expect(state.phasedOut ?? []).toHaveLength(0);
    });

    it("does not return the bundle when an unrelated permanent leaves", () => {
        const { state } = setup();
        phaseOutPermanent(state, "bear", {
            returnOn: { kind: "source-leaves", sourceId: "oubl" },
        });
        // The aura's controller (p1) sacrifices something else — bundle stays.
        const filler = makeInstance(plains.id, { id: "filler" });
        state.players[0].battlefield.push(filler);
        removePermanentTo(state, "filler", "graveyard");
        expect(state.phasedOut).toHaveLength(1);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("phaseIn can be invoked directly by bundle id", () => {
        const { state } = setup();
        const bundleId = phaseOutPermanent(state, "bear", {
            returnOn: { kind: "untap-cycle" },
        })!;
        expect(phaseInBundle(state, bundleId)).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
        expect(phaseInBundle(state, bundleId)).toBe(false); // already gone
    });

    it("ETB trigger phases out the chosen creature (full path)", () => {
        const { state } = setup();
        resolveTrigger(
            state,
            state.players[0].battlefield[0],
            "oubliette-phase-out",
            {
                type: "PERMANENT_ENTERED",
                instanceId: "oubl",
                controllerId: "p1",
                types: ["Enchantment"],
            } as StackItem["triggerEvent"]
        );
        // requestChoice suspended the trigger — answer it with the bear.
        answerChoice(state, ["bear"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.phasedOut).toHaveLength(1);
        expect(state.phasedOut![0].returnOn).toEqual({
            kind: "source-leaves",
            sourceId: "oubl",
        });
    });
});

describe("Magnetic Mountain (CR 502.1 untap restriction + upkeep untap)", () => {
    // --- Static untap restriction (CR 502.1) -------------------------------
    it("blue creatures don't untap during the untap step; non-blue ones do", () => {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const blueCreature = makeInstance(flyingMen.id, {
            id: "blue",
            controllerId: "p1",
            isTapped: true,
        });
        const greenCreature = makeInstance(grizzlyBears.id, {
            id: "green",
            controllerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mm, blueCreature, greenCreature],
                }),
                makePlayer("p2"),
            ],
        });
        untapStep(state);
        // maxUntap 0 hard-skip auto-resolves: no prompt, blue stays tapped.
        expect(state.pendingChoices ?? []).toEqual([]);
        const blue = state.players[0].battlefield.find((c) => c.id === "blue")!;
        const green = state.players[0].battlefield.find(
            (c) => c.id === "green"
        )!;
        expect(blue.isTapped).toBe(true);
        expect(green.isTapped).toBe(false);
    });

    it("the no-untap filter matches a blue creature on the projected wire state (CR 202.2)", () => {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const blueCreature = makeInstance(flyingMen.id, {
            id: "blue",
            controllerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mm, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        const filter = { types: "Creature" as const, colors: ["U"] as Color[] };
        // GRE-side: colors derived via STATIC_EFFECT_CTX.getColors.
        expect(
            matchesPermanentFilter(
                {
                    ...blueCreature,
                    colors: STATIC_EFFECT_CTX.getColors(blueCreature),
                },
                filter
            )
        ).toBe(true);
        // Wire-format: the assertion survives the projection (colors derived
        // the same way client-side from the slim card's def).
        const projected = projectPublicState(state, 1, "p1");
        const slimBlue = projected.players[0].battlefield.find(
            (c) => c.id === "blue"
        )!;
        expect(
            matchesPermanentFilter(
                {
                    ...slimBlue,
                    colors: STATIC_EFFECT_CTX.getColors(
                        slimBlue as unknown as Parameters<
                            typeof STATIC_EFFECT_CTX.getColors
                        >[0]
                    ),
                },
                filter
            )
        ).toBe(true);
    });

    // --- Filter unit: colors + tapped ---------------------------------------
    it("matchesPermanentFilter gates on colors + tapped together", () => {
        const f = {
            types: "Creature" as const,
            colors: ["U"] as Color[],
            tapped: true,
        };
        const tappedBlue = {
            ...makeInstance(flyingMen.id, { id: "tb", isTapped: true }),
            colors: ["U"] as Color[],
        };
        const untappedBlue = {
            ...makeInstance(flyingMen.id, { id: "ub", isTapped: false }),
            colors: ["U"] as Color[],
        };
        const tappedGreen = {
            ...makeInstance(grizzlyBears.id, { id: "tg", isTapped: true }),
            colors: ["G"] as Color[],
        };
        expect(matchesPermanentFilter(tappedBlue, f)).toBe(true);
        expect(matchesPermanentFilter(untappedBlue, f)).toBe(false);
        expect(matchesPermanentFilter(tappedGreen, f)).toBe(false);
    });

    // --- Upkeep trigger: choose + pay + untap (CR 603.6a / 118) -------------
    function setupUpkeep() {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const b1 = makeInstance(flyingMen.id, {
            id: "b1",
            controllerId: "p1",
            isTapped: true,
        });
        const b2 = makeInstance(flyingMen.id, {
            id: "b2",
            controllerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mm, b1, b2],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 8 },
                }),
                makePlayer("p2"),
            ],
        });
        return { state, mm };
    }

    it("pays {4} each and untaps the chosen blue creatures", () => {
        const { state, mm } = setupUpkeep();
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        // First suspension: the choose-permanents pick.
        answerChoice(state, ["b1", "b2"]);
        // Second suspension: the may-pay (accept).
        answerChoice(state, ["yes"]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "b1")!.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "b2")!.isTapped).toBe(false);
    });

    it("declining the payment leaves the creatures tapped", () => {
        const { state, mm } = setupUpkeep();
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["b1", "b2"]);
        answerChoice(state, ["decline"]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "b1")!.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "b2")!.isTapped).toBe(true);
    });

    it("choosing none asks for no payment and untaps nothing", () => {
        const { state, mm } = setupUpkeep();
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, []);
        // No may-pay was enqueued (chose zero creatures).
        expect(state.pendingChoices ?? []).toEqual([]);
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "b1")!.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "b2")!.isTapped).toBe(true);
    });

    it("no trigger effect when the upkeep player controls no tapped blue creatures", () => {
        const mm = makeInstance(magneticMountain.id, { id: "mm" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mm] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            mm,
            "magnetic-mountain-upkeep",
            upkeepEvent("p1")
        );
        expect(state.pendingChoices ?? []).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Cuombajj Witches ({T}: 1 damage to any target + 1 to an opponent's choice)
// ---------------------------------------------------------------------------

describe("Cuombajj Witches (opponent-chosen second target, CR 115.4 / 608.2)", () => {
    /** Build a board: p1 controls the Witches, both players have a vanilla
     *  creature to ping. `aladdinsRing` isn't a creature — use Juzám Djinn as a
     *  damageable body on each side. */
    function setup() {
        const witches = makeInstance(cuombajjWitches.id, {
            id: "witches",
            controllerId: "p1",
        });
        const myBody = makeInstance(juzamDjinn.id, {
            id: "p1-body",
            controllerId: "p1",
        });
        const oppBody = makeInstance(juzamDjinn.id, {
            id: "p2-body",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [witches, myBody] }),
                makePlayer("p2", { battlefield: [oppBody] }),
            ],
        });
        return { state, witches };
    }

    it("resolution suspends for the opponent's pick before any damage lands", () => {
        const { state, witches } = setup();
        // Controller's target (ping 1): the opponent's body.
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "permanent", id: "p2-body" },
        ]);

        // No damage yet — both pings land only after the opponent picks (so
        // ping 1 isn't double-applied across the suspend/resume of the resolve
        // step). Life and damageMarked are still pristine.
        const oppBody = state.players[1].battlefield.find(
            (c) => c.id === "p2-body"
        )!;
        expect(oppBody.damageMarked).toBeUndefined();
        expect(state.players[0].life).toBe(20);

        // Resolution suspended: a choose-damage-target choice is owed to the
        // OPPONENT (p2), not the controller.
        const head = state.pendingChoices?.[0];
        expect(head).toBeDefined();
        expect(head!.kind).toBe("choose-damage-target");
        expect(head!.playerId).toBe("p2");
        // Candidate set spans every player + every damageable permanent.
        expect(head!.candidatePlayerIds).toEqual(["p1", "p2"]);
        expect(new Set(head!.candidateIds)).toEqual(
            new Set(["witches", "p1-body", "p2-body"])
        );
    });

    it("opponent's pick of a player lands the second ping on that player", () => {
        const { state, witches } = setup();
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "permanent", id: "p2-body" },
        ]);
        // Opponent (p2) chooses to ping the controller (p1).
        answerChoice(state, ["p1"]);

        expect(state.players[0].life).toBe(19); // p1 took 1 from ping 2
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-body")!
                .damageMarked
        ).toBe(1); // ping 1 still on p2's body
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("opponent's pick of a permanent lands the second ping on that permanent", () => {
        const { state, witches } = setup();
        // Controller's ping 1 targets p2 (the player).
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "player", id: "p2" },
        ]);
        // Opponent (p2) chooses to ping the controller's own body — both pings
        // now land.
        answerChoice(state, ["p1-body"]);
        expect(state.players[1].life).toBe(19); // ping 1 hit p2
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-body")!
                .damageMarked
        ).toBe(1); // ping 2 hit p1's body
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("both pings can hit the same player (controller and opponent both choose it)", () => {
        const { state, witches } = setup();
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "player", id: "p1" },
        ]);
        answerChoice(state, ["p1"]);
        expect(state.players[0].life).toBe(18); // 1 + 1
    });

    it("definition snapshot: {B}{B} 1/3 Human Wizard with the tap ability", () => {
        expect(cuombajjWitches.manaCost).toEqual({ B: 2 });
        expect(cuombajjWitches.power).toBe(1);
        expect(cuombajjWitches.toughness).toBe(3);
        expect(cuombajjWitches.subtypes).toEqual(["Human", "Wizard"]);
        const ability = cuombajjWitches.activatedAbilities![0];
        expect(ability.cost.tap).toBe(true);
        expect(ability.targetRequirement).toEqual({ type: "any", count: 1 });
    });

    it("wire format: the opponent's pending choice survives projection", () => {
        const { state, witches } = setup();
        resolveActivated(state, witches, "cuombajj-witches-pings", [
            { type: "permanent", id: "p2-body" },
        ]);
        // The choice is owed to p2 — project from p2's viewpoint and assert the
        // candidate allow-lists the frontend reads are intact across the wire.
        const projected = projectPublicState(state, 1, "p2");
        const head = projected.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-damage-target");
        expect(head?.playerId).toBe("p2");
        expect(head?.candidatePlayerIds).toEqual(["p1", "p2"]);
        expect(new Set(head?.candidateIds)).toEqual(
            new Set(["witches", "p1-body", "p2-body"])
        );
    });
});

describe("Ifh-Bíff Efreet (any-player-activatable mass flyer damage, CR 113.3c / 120.3)", () => {
    /** p1 controls the Efreet (3/3 flyer), a tough flyer (Bird Maiden 1/2,
     *  survives the ping so its `damageMarked` is observable), and a ground
     *  creature (Grizzly Bears). p2 controls a tough flyer (Bird Maiden), a
     *  ground creature (Grizzly Bears), and a fragile flyer (Flying Men 1/1)
     *  that dies to the 1 damage — proving the sweep hits flyers lethally. */
    function setup() {
        const efreet = makeInstance(ifhBiffEfreet.id, {
            id: "efreet",
            controllerId: "p1",
        });
        const myFlyer = makeInstance(birdMaiden.id, {
            id: "p1-flyer",
            controllerId: "p1",
        });
        const myGround = makeInstance(grizzlyBears.id, {
            id: "p1-ground",
            controllerId: "p1",
        });
        const oppFlyer = makeInstance(birdMaiden.id, {
            id: "p2-flyer",
            controllerId: "p2",
        });
        const oppGround = makeInstance(grizzlyBears.id, {
            id: "p2-ground",
            controllerId: "p2",
        });
        const fragileFlyer = makeInstance(flyingMen.id, {
            id: "p2-fragile-flyer",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [efreet, myFlyer, myGround],
                }),
                makePlayer("p2", {
                    battlefield: [oppFlyer, oppGround, fragileFlyer],
                }),
            ],
        });
        return { state, efreet };
    }

    /** Push the activated ability with a chosen activator (`castById`) — mirrors
     *  the post-`activateAbility` state where the activator may differ from the
     *  source's controller (CR 113.3c). */
    function fire(
        state: GameState,
        source: CardInstanceState,
        activator: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: activator,
            abilityId: "ifh-biff-efreet-rain",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    function bf(state: GameState, playerIdx: number, id: string) {
        return state.players[playerIdx].battlefield.find((c) => c.id === id)!;
    }

    it("damages each creature with flying and each player; spares non-flyers", () => {
        const { state, efreet } = setup();
        fire(state, efreet, "p1");

        // Both players take 1.
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        // Every surviving flyer (incl. the Efreet itself, a 3/3) takes 1.
        expect(bf(state, 0, "efreet").damageMarked).toBe(1);
        expect(bf(state, 0, "p1-flyer").damageMarked).toBe(1);
        expect(bf(state, 1, "p2-flyer").damageMarked).toBe(1);
        // The 1/1 flyer took lethal flying damage and left via SBA.
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "p2-fragile-flyer"
            )
        ).toBeUndefined();
        // Ground creatures are untouched.
        expect(bf(state, 0, "p1-ground").damageMarked).toBeUndefined();
        expect(bf(state, 1, "p2-ground").damageMarked).toBeUndefined();
    });

    it("is symmetric regardless of who activates it (any player)", () => {
        // Activated by the OPPONENT (p2), not the controller — same outcome.
        const { state, efreet } = setup();
        fire(state, efreet, "p2");

        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        expect(bf(state, 0, "p1-flyer").damageMarked).toBe(1);
        expect(bf(state, 1, "p2-flyer").damageMarked).toBe(1);
        expect(bf(state, 0, "p1-ground").damageMarked).toBeUndefined();
    });

    it("definition snapshot: {2}{G}{G} 3/3 Efreet with flying and an any-player {G} ability", () => {
        expect(ifhBiffEfreet.manaCost).toEqual({ X: 2, G: 2 });
        expect(ifhBiffEfreet.power).toBe(3);
        expect(ifhBiffEfreet.toughness).toBe(3);
        expect(ifhBiffEfreet.subtypes).toEqual(["Efreet"]);
        expect(ifhBiffEfreet.staticAbilities).toContain("flying");
        const ability = ifhBiffEfreet.activatedAbilities![0];
        expect(ability.cost).toEqual({ mana: { G: 1 } });
        expect(ability.useStack).toBe(true);
        expect(ability.activatableByAnyPlayer).toBe(true);
    });

    it("wire format: the flyer-only damage survives projection", () => {
        const { state, efreet } = setup();
        fire(state, efreet, "p2");
        const projected = projectPublicState(state, 1, "p2");
        // p2's own flyer took 1, ground creature did not — visible client-side.
        const projFlyer = projected.players[1].battlefield.find(
            (c) => c.id === "p2-flyer"
        )!;
        const projGround = projected.players[1].battlefield.find(
            (c) => c.id === "p2-ground"
        )!;
        expect(projFlyer.damageMarked).toBe(1);
        expect(projGround.damageMarked).toBeUndefined();
        expect(projected.players[1].life).toBe(19);
    });
});

// Guardian Beast — continuous `permanent-guard` (CR 611). While untapped, its
// controller's noncreature artifacts can't be targeted (CR 702.16b-style),
// can't be enchanted (CR 303.4), have indestructible (CR 702.12), and their
// control can't change (CR 613.1b). All four gates read the guard live, so a
// tap/untap transition flips the protections.
describe("Guardian Beast (permanent-guard while untapped, CR 611)", () => {
    /** p1 controls Guardian Beast + a noncreature artifact (Black Lotus). */
    function setup(opts: { beastTapped?: boolean } = {}) {
        const beast = makeInstance(guardianBeast.id, {
            id: "beast",
            controllerId: "p1",
            isTapped: opts.beastTapped ?? false,
        });
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beast, lotus] }),
                makePlayer("p2"),
            ],
        });
        return { state, beast, lotus };
    }

    const onBattlefield = (state: GameState, id: string) =>
        state.players.some((p) => p.battlefield.some((c) => c.id === id));
    const controllerOf = (state: GameState, id: string) =>
        state.players.find((p) => p.battlefield.some((c) => c.id === id))?.id;

    describe("indestructible (CR 702.12)", () => {
        it("a guarded artifact survives 'destroy' while the Beast is untapped", () => {
            const { state } = setup();
            const destroyed = destroyWithReplacements(state, "lotus");
            expect(destroyed).toBe(false);
            expect(onBattlefield(state, "lotus")).toBe(true);
        });

        it("the artifact is destroyed once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            const destroyed = destroyWithReplacements(state, "lotus");
            expect(destroyed).toBe(true);
            expect(onBattlefield(state, "lotus")).toBe(false);
        });

        it("integration: resolving Shatter at the artifact is a no-op while untapped", () => {
            const { state } = setup();
            pushSpell(state, shatter.id, "p2", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            expect(onBattlefield(state, "lotus")).toBe(true);
        });

        it("integration: Shatter destroys the artifact once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            pushSpell(state, shatter.id, "p2", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            expect(onBattlefield(state, "lotus")).toBe(false);
        });

        it("does not protect the Beast's controller's OTHER creatures, nor artifacts of another player", () => {
            // Only noncreature artifacts the Beast's controller controls are
            // guarded. A regular creature p1 controls is still destructible,
            // and an opponent's artifact is unguarded.
            const { state } = setup();
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
            });
            const oppLotus = makeInstance(blackLotus.id, {
                id: "opp-lotus",
                controllerId: "p2",
                ownerId: "p2",
            });
            state.players[0].battlefield.push(bear);
            state.players[1].battlefield.push(oppLotus);
            expect(regenerateOrDestroy(state, "bear")).toBe(true);
            expect(destroyWithReplacements(state, "opp-lotus")).toBe(true);
        });
    });

    describe("can't be targeted (CR 702.16b-style)", () => {
        it("getLegalTargets excludes the guarded artifact while untapped", () => {
            const { state } = setup();
            const targets = getLegalTargets(state, shatter.targetRequirement!, [
                "R",
            ]);
            expect(targets.some((t) => t.id === "lotus")).toBe(false);
        });

        it("getLegalTargets includes the artifact once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            const targets = getLegalTargets(state, shatter.targetRequirement!, [
                "R",
            ]);
            expect(targets.some((t) => t.id === "lotus")).toBe(true);
        });

        it("wire format: the targeting ban survives projection", () => {
            const { state } = setup();
            const projected = projectPublicState(state, 1, "p1");
            const targets = getLegalTargets(
                projected as unknown as GameState,
                shatter.targetRequirement!,
                ["R"]
            );
            expect(targets.some((t) => t.id === "lotus")).toBe(false);
        });
    });

    describe("can't be enchanted (CR 303.4)", () => {
        it("an Aura cast at the guarded artifact fizzles to the graveyard while untapped", () => {
            const { state } = setup();
            // Animate Artifact targets a noncreature artifact.
            pushSpell(state, animateArtifact.id, "p1", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            // Aura did not attach — it fizzled to its owner's graveyard.
            const aura = state.players[0].graveyard.find(
                (c) => (c.card as { id?: string }).id === animateArtifact.id
            );
            expect(aura).toBeDefined();
            const lotus = state.players[0].battlefield.find(
                (c) => c.id === "lotus"
            )!;
            expect(lotus.attachedTo).toBeUndefined();
            // The artifact stays a noncreature (Animate Artifact never applied).
            expect(lotus.types.includes("Creature")).toBe(false);
        });

        it("the Aura attaches once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            pushSpell(state, animateArtifact.id, "p1", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            const lotus = state.players[0].battlefield.find(
                (c) => c.id === "lotus"
            )!;
            expect(lotus.types.includes("Creature")).toBe(true);
        });
    });

    describe("control can't be changed (CR 613.1b)", () => {
        it("applyControlChange is a no-op on the guarded artifact while untapped", () => {
            const { state } = setup();
            applyControlChange(state, "lotus", "p2", "src-1");
            expect(controllerOf(state, "lotus")).toBe("p1");
        });

        it("control changes once the Beast is tapped", () => {
            const { state, beast } = setup();
            beast.isTapped = true;
            applyControlChange(state, "lotus", "p2", "src-1");
            expect(controllerOf(state, "lotus")).toBe("p2");
        });

        it("integration: Steal Artifact can't steal the guarded artifact while untapped", () => {
            const { state } = setup();
            pushSpell(state, stealArtifact.id, "p2", [
                { type: "permanent", id: "lotus" },
            ]);
            resolveTopOfStack(state);
            // The aura fizzles (can't enchant), so control never changes.
            expect(controllerOf(state, "lotus")).toBe("p1");
        });
    });

    it("definition snapshot: 2/4 Beast, {3}{B}, single permanent-guard", () => {
        expect(guardianBeast.power).toBe(2);
        expect(guardianBeast.toughness).toBe(4);
        expect(guardianBeast.manaCost).toEqual({ X: 3, B: 1 });
        const guards = (guardianBeast.staticEffects ?? []).filter(
            (e) => e.kind === "permanent-guard"
        );
        expect(guards).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Batch 4 (#191) — coin flip (CR 705). Seeds chosen so the FIRST flip is
// deterministic: rngSeed 1 → randomInt(2) === 1 (heads / win), rngSeed 7 →
// randomInt(2) === 0 (tails / lose). See rng.test.ts for the substrate proof.
// ---------------------------------------------------------------------------

const WIN_SEED = 1; // first flipCoin() → true
const LOSE_SEED = 7; // first flipCoin() → false

describe("Bottle of Suleiman (random-reveal coin flip, CR 705 / ADR 0023)", () => {
    /** Build a fresh state with Bottle in play, seeded for a known first flip. */
    function setup(seed: number) {
        const bottle = makeInstance(bottleOfSuleiman.id, {
            id: "bottle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            rngSeed: seed,
            players: [
                makePlayer("p1", { life: 20, battlefield: [bottle] }),
                makePlayer("p2"),
            ],
        });
        return { state, bottle };
    }

    /** Acknowledge the head random-reveal choice to resume resolution. */
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    it("definition snapshot: {4} Artifact, {1}+sacrifice flip ability", () => {
        expect(bottleOfSuleiman.types).toEqual(["Artifact"]);
        expect(bottleOfSuleiman.manaCost).toEqual({ X: 4 });
        const ability = bottleOfSuleiman.activatedAbilities![0];
        expect(ability.cost).toEqual({ mana: { X: 1 }, sacrifice: true });
    });

    it("suspends on a random-reveal choice BEFORE applying the consequence", () => {
        const { state, bottle } = setup(WIN_SEED);
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");

        // Resolution is suspended on a random-reveal pending choice.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p1");
        expect(head.randomKind).toBe("coin");
        expect(head.sides).toBe(2);
        // WIN seed → result 1 (heads), realized WIN face + Djinn consequence.
        expect(head.result).toBe(1);
        expect(head.realized).toEqual({
            face: "WIN",
            consequence: "Create a 5/5 flying Djinn",
        });
        // The consequence has NOT been applied yet (reveal precedes apply).
        expect(state.players[0].battlefield.filter((c) => c.isToken)).toEqual(
            []
        );
        expect(state.players[0].life).toBe(20);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 across suspend/resume (WIN)", () => {
        const { state, bottle } = setup(WIN_SEED);
        const before = state.rngCounter;
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");
        // The bit was drawn once on suspend.
        expect(state.rngCounter).toBe(before + 1);
        ack(state);
        // Resume reads the persisted outcome — no re-roll.
        expect(state.rngCounter).toBe(before + 1);

        // WIN consequence applied only after the ack.
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        const djinn = tokens[0];
        expect(djinn.types).toEqual(["Artifact", "Creature"]);
        expect(djinn.subtypes).toContain("Djinn");
        expect(djinn.power).toBe(5);
        expect(djinn.toughness).toBe(5);
        expect(djinn.staticAbilities).toContain("flying");
        expect(state.players[0].life).toBe(20);
        // Choice cleared, stack empty.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 across suspend/resume (LOSE)", () => {
        const { state, bottle } = setup(LOSE_SEED);
        const before = state.rngCounter;
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");
        const head = state.pendingChoices![0];
        expect(head.result).toBe(0);
        expect(head.realized).toEqual({
            face: "LOSE",
            consequence: "Bottle of Suleiman deals 5 damage to you",
        });
        expect(state.rngCounter).toBe(before + 1);
        // Damage NOT yet applied.
        expect(state.players[0].life).toBe(20);

        ack(state);
        expect(state.rngCounter).toBe(before + 1);
        // LOSE consequence applied: 5 damage, no token.
        expect(state.players[0].life).toBe(15);
        expect(state.players[0].battlefield.filter((c) => c.isToken)).toEqual(
            []
        );
        expect(state.pendingChoices).toBeUndefined();
    });

    it("wire format: random-reveal fields survive projection for BOTH viewers", () => {
        const { state, bottle } = setup(WIN_SEED);
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");

        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const head = projected.pendingChoices![0];
            expect(head.kind).toBe("random-reveal");
            expect(head.randomKind).toBe("coin");
            expect(head.result).toBe(1);
            // The result is public (CR 705) — both the flipper and the
            // opponent see the realized face + consequence.
            expect(head.realized).toEqual({
                face: "WIN",
                consequence: "Create a 5/5 flying Djinn",
            });
        }
    });

    it("ack mutation rejects a mismatched head (stack item / choice id)", () => {
        const { state, bottle } = setup(WIN_SEED);
        resolveActivated(state, bottle, "bottle-of-suleiman-flip");
        const head = state.pendingChoices![0];
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: "wrong",
                choiceId: head.choiceId,
            })
        ).toThrow();
        // Unchanged: still suspended.
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        // Sanity: ack resumes only on the correct identity (silences getPlayer).
        ack(state);
        expect(getPlayer(state, "p1").battlefield.some((c) => c.isToken)).toBe(
            true
        );
    });
});

describe("Mijae Djinn (random-reveal attack flip, CR 705 / ADR 0023 + CR 508)", () => {
    it("definition snapshot: 6/3 Djinn, {R}{R}{R}", () => {
        expect(mijaeDjinn.power).toBe(6);
        expect(mijaeDjinn.toughness).toBe(3);
        expect(mijaeDjinn.subtypes).toContain("Djinn");
        expect(mijaeDjinn.manaCost).toEqual({ R: 3 });
    });

    /** Build a fresh combat with Mijae attacking, seeded for a known first
     *  flip, and push+resolve its attack trigger (which suspends on the
     *  random-reveal). Returns the suspended state. */
    function attackingMijae(seed: number) {
        const mijae = makeInstance(mijaeDjinn.id, {
            id: "mijae",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            rngSeed: seed,
            players: [
                makePlayer("p1", { battlefield: [mijae] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["mijae"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const event: StackItem["triggerEvent"] = {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["mijae"],
        };
        resolveTrigger(state, mijae, "mijae-djinn-attack-flip", event);
        return { state, mijae };
    }

    /** Acknowledge the head random-reveal choice to resume the trigger. */
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    const mijaeOf = (state: GameState) =>
        state.players[0].battlefield.find((c) => c.id === "mijae")!;

    it("suspends on a random-reveal choice BEFORE applying the consequence", () => {
        const { state } = attackingMijae(LOSE_SEED);
        // Trigger is suspended on a random-reveal pending choice.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p1");
        expect(head.randomKind).toBe("coin");
        expect(head.sides).toBe(2);
        // LOSE seed → result 0 (tails), realized LOSE face + consequence.
        expect(head.result).toBe(0);
        expect(head.realized).toEqual({
            face: "LOSE",
            consequence: "Remove Mijae Djinn from combat and tap it",
        });
        // The consequence has NOT been applied yet (reveal precedes apply):
        // Mijae is still attacking and untapped.
        const m = mijaeOf(state);
        expect(m.isAttacking).toBe(true);
        expect(m.isTapped).toBe(false);
        expect(state.combat!.attackerIds).toContain("mijae");
    });

    it("won flip → stays attacking, untapped (flipCoin once across resume)", () => {
        const { state } = attackingMijae(WIN_SEED);
        const before = state.rngCounter;
        // WIN seed → result 1 (heads), realized WIN face.
        const head = state.pendingChoices![0];
        expect(head.result).toBe(1);
        expect(head.realized).toEqual({
            face: "WIN",
            consequence: "Mijae Djinn stays attacking",
        });
        ack(state);
        // Resume reads the persisted outcome — no re-roll.
        expect(state.rngCounter).toBe(before);
        const m = mijaeOf(state);
        expect(m.isAttacking).toBe(true);
        expect(m.isTapped).toBe(false);
        expect(state.combat!.attackerIds).toContain("mijae");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("lost flip → removed from combat and tapped (flipCoin once across resume)", () => {
        const { state } = attackingMijae(LOSE_SEED);
        const before = state.rngCounter;
        ack(state);
        // Resume reads the persisted outcome — no re-roll.
        expect(state.rngCounter).toBe(before);
        const m = mijaeOf(state);
        expect(m.isAttacking).toBeFalsy();
        expect(m.isTapped).toBe(true);
        expect(state.combat!.attackerIds).not.toContain("mijae");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 on suspend, then 0 on resume", () => {
        const { state } = attackingMijae(LOSE_SEED);
        const afterSuspend = state.rngCounter;
        // The bit was drawn once when the trigger suspended.
        expect(afterSuspend).toBe(1);
        ack(state);
        // Resume does NOT re-roll.
        expect(state.rngCounter).toBe(afterSuspend);
    });

    it("wire format: random-reveal fields survive projection for BOTH viewers", () => {
        const { state } = attackingMijae(LOSE_SEED);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const head = projected.pendingChoices![0];
            expect(head.kind).toBe("random-reveal");
            expect(head.randomKind).toBe("coin");
            expect(head.result).toBe(0);
            // The result is public (CR 705) — both the flipper and the
            // opponent see the realized face + consequence before the apply.
            expect(head.realized).toEqual({
                face: "LOSE",
                consequence: "Remove Mijae Djinn from combat and tap it",
            });
        }
    });

    it("ack mutation rejects a mismatched head (stack item id)", () => {
        const { state } = attackingMijae(LOSE_SEED);
        const head = state.pendingChoices![0];
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: "wrong",
                choiceId: head.choiceId,
            })
        ).toThrow();
        // Unchanged: still suspended, consequence not applied.
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        expect(mijaeOf(state).isTapped).toBe(false);
        // Sanity: ack resumes only on the correct identity.
        ack(state);
        expect(mijaeOf(state).isTapped).toBe(true);
    });
});

describe("Ydwen Efreet (block flip via requestCoinFlip, CR 705 / 509.1h / ADR 0023)", () => {
    it("definition snapshot: 3/6 Efreet, {R}{R}{R}", () => {
        expect(ydwenEfreet.power).toBe(3);
        expect(ydwenEfreet.toughness).toBe(6);
        expect(ydwenEfreet.subtypes).toContain("Efreet");
        expect(ydwenEfreet.manaCost).toEqual({ R: 3 });
    });

    /** p1 attacks with a bear; p2's Ydwen is its only blocker. When
     *  `secondBlocker` is set, a 2/2 bear ("blk2") also blocks "atk", so
     *  Ydwen is no longer the SOLE blocker — leaving combat must NOT unblock
     *  the attacker (CR 509.1h). Resolving the trigger suspends on the flip. */
    function blockingYdwen(seed: number, secondBlocker = false) {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const ydwen = makeInstance(ydwenEfreet.id, {
            id: "ydwen",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const blk2 = makeInstance(grizzlyBears.id, {
            id: "blk2",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const blockerAssignments: Record<string, string[]> = secondBlocker
            ? { ydwen: ["atk"], blk2: ["atk"] }
            : { ydwen: ["atk"] };
        const state = makeState({
            rngSeed: seed,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { life: 20, battlefield: [attacker] }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: secondBlocker ? [ydwen, blk2] : [ydwen],
                }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments,
                blockedAttackerIds: ["atk"],
                blockersConfirmed: true,
            },
        });
        const event: StackItem["triggerEvent"] = {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "atk",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "ydwen",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: ["Efreet"],
        };
        resolveTrigger(state, ydwen, "ydwen-efreet-block-flip", event);
        return state;
    }

    /** Acknowledge the head random-reveal choice to resume resolution. */
    function ack(state: GameState) {
        const head = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });
    }

    it("suspends on a random-reveal choice BEFORE applying the consequence (LOSE)", () => {
        const state = blockingYdwen(LOSE_SEED);
        // Suspended on a random-reveal pending choice owned by Ydwen's
        // controller — the flipping player is the blocker's controller.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p2");
        expect(head.randomKind).toBe("coin");
        expect(head.sides).toBe(2);
        // LOSE seed → result 0 (tails), realized LOSE face + consequence.
        expect(head.result).toBe(0);
        expect(head.realized?.face).toBe("LOSE");
        // Consequence NOT applied yet: Ydwen still blocking, attacker blocked.
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBe(true);
        expect(y.cantBlockThisTurn).toBeFalsy();
        expect(state.combat!.blockedAttackerIds).toContain("atk");
    });

    it("won flip → stays blocking, attacker stays blocked (only after ack)", () => {
        const state = blockingYdwen(WIN_SEED);
        const head = state.pendingChoices![0];
        expect(head.realized?.face).toBe("WIN");
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBe(true);
        expect(y.cantBlockThisTurn).toBeFalsy();
        expect(state.combat!.blockedAttackerIds).toContain("atk");
        expect(state.combat!.blockerAssignments.ydwen).toEqual(["atk"]);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("lost flip → removed from combat, can't block, solely-blocked attacker becomes unblocked and hits defender (only after ack)", () => {
        const state = blockingYdwen(LOSE_SEED);
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBeFalsy();
        expect(y.cantBlockThisTurn).toBe(true);
        // The bear it solely blocked is unblocked again (CR 509.1h).
        expect(state.combat!.blockedAttackerIds).not.toContain("atk");
        expect(state.combat!.blockerAssignments.ydwen ?? []).not.toContain(
            "atk"
        );
        // Damage step: the now-unblocked bear (2 power) hits the defender (p2).
        applyAllCombatDamage(state, { atk: { p2: 2 } });
        expect(state.players[1].life).toBe(18);
    });

    it("lost flip but NOT solely blocked → attacker stays blocked (CR 509.1h)", () => {
        const state = blockingYdwen(LOSE_SEED, /* secondBlocker */ true);
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        // Ydwen leaves combat and can't block again...
        expect(y.isBlocking).toBeFalsy();
        expect(y.cantBlockThisTurn).toBe(true);
        // ...but a second creature still blocks "atk", so it stays blocked.
        expect(state.combat!.blockedAttackerIds).toContain("atk");
        expect(state.combat!.blockerAssignments.ydwen ?? []).not.toContain(
            "atk"
        );
        expect(state.combat!.blockerAssignments.blk2).toEqual(["atk"]);
    });

    it("flipCoin runs exactly once: rngCounter advances by 1 across suspend/resume", () => {
        const state = blockingYdwen(LOSE_SEED);
        // The bit was drawn once on suspend; ack resumes without a re-roll.
        const afterSuspend = state.rngCounter;
        ack(state);
        expect(state.rngCounter).toBe(afterSuspend);
    });

    it("wire format: random-reveal fields survive projection for BOTH viewers", () => {
        const state = blockingYdwen(LOSE_SEED);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const head = projected.pendingChoices![0];
            expect(head.kind).toBe("random-reveal");
            expect(head.randomKind).toBe("coin");
            // The result is public (CR 705) — both flipper and opponent see the
            // realized LOSE face.
            expect(head.result).toBe(0);
            expect(head.realized?.face).toBe("LOSE");
        }
    });

    it("ack mutation rejects a mismatched head (stack item / choice id)", () => {
        const state = blockingYdwen(LOSE_SEED);
        const head = state.pendingChoices![0];
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: head.playerId,
                stackItemId: "wrong",
                choiceId: head.choiceId,
            })
        ).toThrow();
        // Unchanged: still suspended.
        expect(state.pendingChoices![0].kind).toBe("random-reveal");
        // Sanity: ack resumes only on the correct identity.
        ack(state);
        const y = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "ydwen"
        )!;
        expect(y.isBlocking).toBeFalsy();
    });

    it("can't block this turn is enforced by validateBlockerEligibility (CR 509.1b)", () => {
        const state = blockingYdwen(LOSE_SEED);
        ack(state);
        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        const newAttacker = makeInstance(grizzlyBears.id, {
            id: "atk2",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const result = validateBlockerEligibility(
            newAttacker,
            y,
            state.players[1].battlefield,
            state
        );
        expect(result.eligible).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Jihad (#188) — conditional white anthem + state-triggered self-sacrifice
// ---------------------------------------------------------------------------

describe("Jihad (#188) — white anthem while chosen player controls the chosen color", () => {
    /** p1 controls a white creature (Repentant Blacksmith, 1/2) + Jihad (chosen
     *  color = the mode id); p2 is the opponent. `oppBattlefield` seeds p2. */
    function withJihad(modeColor: Color, oppBattlefield: CardInstanceState[]) {
        const whiteCreature = makeInstance(repentantBlacksmith.id, {
            id: "white-creature",
            controllerId: "p1",
        });
        const jihadInst = makeInstance(jihad.id, {
            id: "jihad",
            controllerId: "p1",
            chosenModeId: modeColor,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [whiteCreature, jihadInst],
                }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, whiteCreature, jihadInst };
    }

    it("buffs white creatures +2/+1 while the opponent controls a nontoken permanent of the chosen color", () => {
        // Chosen color red; opponent controls a red creature (Mijae Djinn).
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state, whiteCreature } = withJihad("R", [redPermanent]);
        // Repentant Blacksmith is 1/2 → +2/+1 = 3/3.
        expect(getEffectivePower(state, whiteCreature)).toBe(3);
        expect(getEffectiveToughness(state, whiteCreature)).toBe(3);
    });

    it("the anthem turns off when the opponent controls no nontoken permanent of the chosen color", () => {
        // Opponent controls a BLUE permanent — chosen color is red → no buff.
        const bluePermanent = makeInstance(flyingMen.id, {
            id: "blue-perm",
            controllerId: "p2",
        });
        const { state, whiteCreature } = withJihad("R", [bluePermanent]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
        expect(getEffectiveToughness(state, whiteCreature)).toBe(2);
    });

    it("a token of the chosen color does NOT keep the anthem on (CR 111 nontoken)", () => {
        const redToken = makeInstance(mijaeDjinn.id, {
            id: "red-token",
            controllerId: "p2",
            isToken: true,
        });
        const { state, whiteCreature } = withJihad("R", [redToken]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("a permanent the source's controller controls does NOT satisfy the clause (must be the opponent's)", () => {
        // p1 (Jihad's controller) controls the only red permanent; the
        // opponent has none → anthem off.
        const myRed = makeInstance(mijaeDjinn.id, {
            id: "my-red",
            controllerId: "p1",
        });
        const { state, whiteCreature } = withJihad("R", []);
        state.players[0].battlefield.push(myRed);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("sacrifices itself when the opponent controls no nontoken permanent of the chosen color (CR 603.8)", () => {
        const { state, jihadInst } = withJihad("R", []);
        resolveTrigger(state, jihadInst, "jihad-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "jihad")
        ).toBeUndefined();
    });

    it("survives the state-trigger while the opponent controls the chosen color (intervening-if)", () => {
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state, jihadInst } = withJihad("R", [redPermanent]);
        resolveTrigger(state, jihadInst, "jihad-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "jihad")
        ).toBeDefined();
    });

    it("the conditional anthem survives the wire projection (mandatory)", () => {
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state } = withJihad("R", [redPermanent]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "white-creature"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("resolves from the stack carrying the chosen mode onto the battlefield (cast→resolve)", () => {
        const whiteCreature = makeInstance(repentantBlacksmith.id, {
            id: "white-creature",
            controllerId: "p1",
        });
        const redPermanent = makeInstance(mijaeDjinn.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whiteCreature] }),
                makePlayer("p2", { battlefield: [redPermanent] }),
            ],
        });
        // Announce Jihad with the chosen colour locked (CR 700.2c).
        state.stack.push({
            ...makeInstance(jihad.id, {
                id: "jihad",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenModeId: "R",
            targets: [],
        });
        resolveTopOfStack(state);
        const onBattlefield = state.players[0].battlefield.find(
            (c) => c.id === "jihad"
        );
        expect(onBattlefield?.chosenModeId).toBe("R");
        // The anthem is live now that Jihad is in play and p2 controls red.
        expect(getEffectivePower(state, whiteCreature)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Aladdin's Lamp (#189) — {X},{T} next-draw look/keep/bottom replacement
// ---------------------------------------------------------------------------

describe("Aladdin's Lamp (#189) — replace the next draw with look-X-keep-one", () => {
    /** Activate the Lamp's {X},{T} ability with the given X, arming the
     *  replacement on its controller. Resolves through the real stack. */
    function activateLamp(
        state: GameState,
        lamp: CardInstanceState,
        x: number
    ) {
        state.stack.push({
            ...lamp,
            zone: "stack",
            castById: lamp.controllerId,
            abilityId: "aladdins-lamp-look",
            chosenX: x,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("arms a turn-scoped draw replacement on activation", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lamp] }),
                makePlayer("p2"),
            ],
        });
        activateLamp(state, lamp, 3);
        expect(state.drawLookReplacements).toEqual([{ playerId: "p1", x: 3 }]);
    });

    it("X = 0 is a no-op (CR 107.3 — X can't be 0)", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lamp] }),
                makePlayer("p2"),
            ],
        });
        activateLamp(state, lamp, 0);
        expect(state.drawLookReplacements).toBeUndefined();
    });

    it("the draw step looks at the top X, keeps one, bottoms the rest, and draws the kept card", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        // Library top→bottom: c0, c1, c2, c3 (deeper).
        const lib = ["c0", "c1", "c2", "c3"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            turn: 2,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [lamp], library: lib }),
                makePlayer("p2"),
            ],
        });
        activateLamp(state, lamp, 3);
        // Advance UPKEEP → DRAW: the replacement fires and suspends on a choice.
        advancePhase(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("draw-look-keep");
        expect(head?.candidateIds).toEqual(["c0", "c1", "c2"]); // top 3
        expect(state.players[0].hand).toHaveLength(0); // not drawn yet

        // Keep c2 (the third card looked at).
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: "",
            step: 0,
            choiceId: "draw-look-p1",
            cardInstanceIds: ["c2"],
        });

        // c2 is drawn; the replacement is consumed.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["c2"]);
        expect(state.drawLookReplacements).toBeUndefined();
        // c3 (below the looked-at window) is now on top; c0 and c1 are bottomed.
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds[0]).toBe("c3");
        expect(libIds.slice(1).sort()).toEqual(["c0", "c1"]);
    });

    it("expires at the start of the next turn if never consumed", () => {
        const lamp = makeInstance(aladdinsLamp.id, { id: "lamp" });
        const state = makeState({
            turn: 2,
            phase: "POSTCOMBAT_MAIN",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [lamp],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "lone",
                            controllerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "p2lib",
                            controllerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
        });
        activateLamp(state, lamp, 3);
        expect(state.drawLookReplacements).toHaveLength(1);
        // Run to end of turn → p2's turn begins → the replacement is cleared.
        for (let i = 0; i < 12 && state.activePlayerId === "p1"; i++) {
            advancePhase(state);
        }
        expect(state.activePlayerId).toBe("p2");
        expect(state.drawLookReplacements).toBeUndefined();
    });
});

describe("Bazaar of Baghdad ({T}: Draw two cards, then discard three cards)", () => {
    // Each filler card is a distinct grizzly-bear instance in the named zone.
    const libCard = (id: string) =>
        makeInstance(grizzlyBears.id, {
            id,
            controllerId: "p1",
            zone: "library",
        });
    const handCard = (id: string) =>
        makeInstance(grizzlyBears.id, { id, controllerId: "p1", zone: "hand" });

    function bazaarState(libIds: string[], handIds: string[]): GameState {
        const bazaar = makeInstance(bazaarOfBaghdad.id, {
            id: "bazaar",
            controllerId: "p1",
            zone: "battlefield",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bazaar],
                    library: libIds.map(libCard),
                    hand: handIds.map(handCard),
                }),
                makePlayer("p2"),
            ],
        });
    }

    const bazaarInstance = (state: GameState) =>
        state.players[0].battlefield.find((c) => c.id === "bazaar")!;

    it("draws two BEFORE suspending for the discard choice, drawing exactly once (CR 121.6, 701.8)", () => {
        const state = bazaarState(
            ["l1", "l2", "l3", "l4", "l5"],
            ["h1", "h2", "h3", "h4"]
        );

        // Step 0 (draw two) commits, then step 1 suspends on the discard choice.
        resolveActivated(
            state,
            bazaarInstance(state),
            "bazaar-of-baghdad-draw-discard"
        );

        const p1 = () => state.players[0];
        // Draw happened exactly once: library 5 → 3, hand 4 → 6. A re-running
        // single `resolve` would have drawn twice (library 1) — the bug this
        // card was deferred for.
        expect(p1().library).toHaveLength(3);
        expect(p1().hand).toHaveLength(6);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].choiceId).toBe("bazaar-discard");
        // Still on the stack while suspended.
        expect(state.stack).toHaveLength(1);

        // Discard three of the six held cards.
        answerChoice(state, ["h1", "h2", "l1"]);

        // Library unchanged by the discard (no second draw): still 3.
        expect(p1().library).toHaveLength(3);
        expect(p1().hand).toHaveLength(3);
        expect(p1().graveyard).toHaveLength(3);
        expect(
            p1()
                .graveyard.map((c) => c.id)
                .sort()
        ).toEqual(["h1", "h2", "l1"]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);

        // Wire format — the visible draw/discard survives projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(3);
        expect(projected.players[0].graveyard).toHaveLength(3);
        expect(projected.players[0].library.count).toBe(3);
    });

    it("clamps the discard to hand size when fewer than three cards are held", () => {
        // Library 3, empty hand → draw two → hand 2 → discard min(3,2)=2.
        const state = bazaarState(["l1", "l2", "l3"], []);
        resolveActivated(
            state,
            bazaarInstance(state),
            "bazaar-of-baghdad-draw-discard"
        );

        expect(state.players[0].hand).toHaveLength(2);
        expect(state.pendingChoices).toHaveLength(1);

        answerChoice(state, ["l1", "l2"]);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });
});

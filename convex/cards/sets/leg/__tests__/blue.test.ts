// Legends (LEG) — blue per-card behaviour tests (ADR 0043 colour split;
// twin of arn/leb colour test files). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external
// behaviour only. Shared shims live in ./helpers; fixtures in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    CREATURE_REQ,
    UPKEEP_C5,
    answerChoice,
    castEvent,
    commitHead,
    makeRecallState,
    resolveTrigger,
    startRecall,
} from "./helpers";
import {
    acidRain,
    antiMagicAura,
    azureDrake,
    backfire,
    barbaryApes,
    boomerang,
    devouringDeep,
    energyTap,
    flashCounter,
    flashFlood,
    forceSpike,
    inTheEyeOfChaos,
    jasmineBoreal,
    keepersOfTheFaith,
    manaDrain,
    partWater,
    psionicEntity,
    recall,
    removeSoul,
    reset,
    seaKingsBlessing,
    segovianLeviathan,
    spectralCloak,
    teleport,
    venarianGold,
    wallOfVapor,
    wallOfWonder,
    winterBlast,
    zephyrFalcon,
} from "..";
import { projectPublicState } from "../../../../gameProjections";
import { isCombatDamagePreventedFromSource } from "../../../../gre/combatDamagePrevention";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import {
    advancePhase,
    applyAllCombatDamage,
    fireDelayedTriggers,
} from "../../../../gre/phases";
import { getLegalTargets } from "../../../../gre/rules";
import {
    applySourceStaticEffects,
    normalizeManaCost,
    resolveTopOfStack,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    forest,
    grizzlyBears,
    island,
    lightningBolt,
    mountain,
} from "../../lea";

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

describe("Mana Drain (counter + next-main-phase {C}=MV, CR 701.5a/603.7/505)", () => {
    // Build p1 (caster) with a Mana Drain on the stack targeting an opponent
    // spell, and the opponent spell beneath it. Returns the assembled state.
    function makeCounterScenario(targetMv: 4 = 4) {
        void targetMv;
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            // Cast on p2's turn (the typical reactive window).
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "PRECOMBAT_MAIN",
        });
        // Opponent's Azure Drake (MV 4) on the bottom of the stack.
        const drakeSpell = pushSpell(state, azureDrake.id, "p2");
        // p1's Mana Drain on top, targeting the Drake spell.
        pushSpell(state, manaDrain.id, "p1", [
            { type: "spell", id: drakeSpell.id },
        ]);
        return { state, drakeSpell };
    }

    it("counters the target spell (CR 701.5a) and the spell hits the graveyard", () => {
        const { state, drakeSpell } = makeCounterScenario();
        resolveTopOfStack(state); // resolve Mana Drain
        // Drake spell is gone from the stack, in its owner's graveyard.
        expect(state.stack.find((s) => s.id === drakeSpell.id)).toBeUndefined();
        expect(
            state.players[1].graveyard.some((c) => c.id === drakeSpell.id)
        ).toBe(true);
        // No mana added yet — the {C} is deferred to p1's next main phase.
        expect(state.players[0].manaPool.C).toBe(0);
    });

    it("schedules a next-main-phase delayed trigger carrying the spell's MV (CR 603.7/505)", () => {
        const { state } = makeCounterScenario();
        resolveTopOfStack(state);
        const queued = state.delayedTriggers ?? [];
        expect(queued).toHaveLength(1);
        expect(queued[0].timing).toBe("next-main-phase");
        expect(queued[0].targetPlayerId).toBe("p1");
        expect(queued[0].payload.mv).toBe("4");
        expect(queued[0].payload.controller).toBe("p1");
    });

    it("adds {C} equal to the countered spell's MV when the caster's next main phase begins (CR 505/107.4c)", () => {
        const { state } = makeCounterScenario();
        resolveTopOfStack(state);
        // Fire as p1's main phase begins (the gate keys on activePlayerId).
        state.activePlayerId = "p1";
        fireDelayedTriggers(state, "next-main-phase");
        // The trigger is on the stack; resolve it to add the mana.
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.C).toBe(4);
        // The delayed trigger is consumed (fires only once).
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("does NOT fire on the opponent's main phase (CR 505 — caster's own turn only)", () => {
        const { state } = makeCounterScenario();
        resolveTopOfStack(state);
        // p2 (opponent) reaches a main phase first: must not fire.
        state.activePlayerId = "p2";
        fireDelayedTriggers(state, "next-main-phase");
        expect(state.stack).toHaveLength(0);
        expect((state.delayedTriggers ?? []).length).toBe(1);
        expect(state.players[0].manaPool.C).toBe(0);
    });

    it("fires through advancePhase when the caster's turn reaches PRECOMBAT_MAIN (full phase path)", () => {
        const { state } = makeCounterScenario();
        resolveTopOfStack(state);
        // Hand the turn to p1 at the very start of their turn.
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "DRAW";
        // Advancing DRAW → PRECOMBAT_MAIN runs performPhaseEntry, which fires
        // the next-main-phase trigger and pushes it on the stack.
        advancePhase(state);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.C).toBe(4);
    });

    it("survives the wire projection — delayed {C} is observable client-side (gameProjections)", () => {
        const { state } = makeCounterScenario();
        resolveTopOfStack(state);
        state.activePlayerId = "p1";
        fireDelayedTriggers(state, "next-main-phase");
        resolveTopOfStack(state);
        // p1 viewer sees their own colorless mana in the projected state.
        const projected = projectPublicState(state, 0, "p1");
        expect(projected.players[0].manaPool.C).toBe(4);
    });

    it("is a {U}{U} instant with the modern oracle text", () => {
        expect(manaDrain.manaCost).toEqual({ U: 2 });
        expect(manaDrain.types).toEqual(["Instant"]);
        expect(manaDrain.oracleText).toBe(
            "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value."
        );
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

describe("In the Eye of Chaos (counter instants unless controller pays mana value, CR 117.3a / 202.3)", () => {
    it("is a World enchantment (CR 205.4) — supertype carried as data", () => {
        expect(inTheEyeOfChaos.supertypes).toEqual(["World"]);
        expect(inTheEyeOfChaos.types).toEqual(["Enchantment"]);
        expect(inTheEyeOfChaos.manaCost).toEqual({ X: 2, U: 1 });
    });

    it("taxes an instant at its mana value, then counters on decline", () => {
        const eye = makeInstance(inTheEyeOfChaos.id, {
            id: "eye",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eye] }),
                makePlayer("p2"),
            ],
        });
        // Reset is a {U}{U} instant — mana value 2.
        const spell = pushSpell(state, reset.id, "p2");
        resolveTrigger(
            state,
            eye,
            "in-the-eye-of-chaos-tax",
            castEvent("p2", spell, ["Instant"])
        );
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");
        // Tax = the spell's mana value (Reset = 2), not a flat amount.
        expect(head.cost).toEqual({ X: 2 });
        answerChoice(state, ["no"]);
        expect(state.stack.find((s) => s.id === spell.id)).toBeUndefined();
    });

    it("folds the chosen X into the mana value of an X instant (CR 601.2b)", () => {
        const eye = makeInstance(inTheEyeOfChaos.id, {
            id: "eye",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eye] }),
                makePlayer("p2"),
            ],
        });
        // partWater is {X}{U} — base mana value 1 ({U}) plus the chosen X.
        const spell = pushSpell(state, partWater.id, "p2");
        spell.chosenX = 4;
        resolveTrigger(
            state,
            eye,
            "in-the-eye-of-chaos-tax",
            castEvent("p2", spell, ["Instant"])
        );
        // Mana value on the stack = {U}(1) + chosen X(4) = 5 (CR 202.3b).
        expect(state.pendingChoices![0].cost).toEqual({ X: 5 });
    });

    it("ignores non-instant spells — a sorcery is not taxed", () => {
        const eye = makeInstance(inTheEyeOfChaos.id, {
            id: "eye",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eye] }),
                makePlayer("p2"),
            ],
        });
        // collectTriggers (the real fire path) must NOT raise the trigger for a
        // sorcery — the SpellFilter restricts to instants (CR 601.2i).
        const sorcery = pushSpell(state, acidRain.id, "p2");
        const fired = collectTriggers(state, [
            castEvent("p2", sorcery, ["Sorcery"]) as never,
        ]);
        expect(
            fired.some(
                (t) => t.triggeredAbilityId === "in-the-eye-of-chaos-tax"
            )
        ).toBe(false);
        // An instant DOES fire it.
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const firedInstant = collectTriggers(state, [
            castEvent("p2", bolt, ["Instant"]) as never,
        ]);
        expect(
            firedInstant.some(
                (t) => t.triggeredAbilityId === "in-the-eye-of-chaos-tax"
            )
        ).toBe(true);
    });

    it("backend integration: declining via applyMayPaySubmit counters the instant (GRE → mutation → stack)", () => {
        const eye = makeInstance(inTheEyeOfChaos.id, {
            id: "eye",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eye] }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        // Place the trigger above the cast spell and resolve it — it suspends on
        // the may-pay (the same shape submitMayPay drives in convex/game.ts).
        state.stack.push({
            ...eye,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "in-the-eye-of-chaos-tax",
            triggerSourceId: eye.id,
            triggerEvent: castEvent("p2", spell, ["Instant"]),
            targets: [],
        } as StackItem);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended at may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");
        // submitMayPay's core: decline → resume → counter the cast spell.
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.find((s) => s.id === spell.id)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === spell.id)).toBe(
            true
        );
    });

    it("backend integration: paying via applyMayPaySubmit keeps the instant and spends mana", () => {
        const eye = makeInstance(inTheEyeOfChaos.id, {
            id: "eye",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eye] }),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
                }),
            ],
        });
        // Lightning Bolt = mana value 1 → tax {1}.
        const spell = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        state.stack.push({
            ...eye,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "in-the-eye-of-chaos-tax",
            triggerSourceId: eye.id,
            triggerEvent: castEvent("p2", spell, ["Instant"]),
            targets: [],
        } as StackItem);
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paid {1} → the spell stays on the stack to resolve normally.
        expect(state.stack.find((s) => s.id === spell.id)).toBeDefined();
        expect(state.players[1].manaPool.R).toBe(4); // {1} paid from generic
    });
});

describe("Recall ({X}{X}{U} sorcery, CR 107.3/701.8/400.7/608.2)", () => {
    it("definition: {X}{X}{U} cost (xFactor 2) and self-exiling sorcery", () => {
        expect(recall.types).toEqual(["Sorcery"]);
        expect(recall.manaCost).toEqual({ X: "X", xFactor: 2, U: 1 });
    });

    it("X=2 discards two then returns two, including a just-discarded card", () => {
        // Hand: h0, h1; graveyard already holds g0. X = 2.
        const state = startRecall({
            handIds: ["h0", "h1"],
            graveyardIds: ["g0"],
            chosenX: 2,
        });
        // Step 0 — discard h0, h1 (CR 701.8). They land in the graveyard.
        answerChoice(state, ["h0", "h1"]);
        const p1 = () => state.players[0];
        expect(p1().hand.map((c) => c.id)).toEqual([]);
        // Graveyard now g0 + the two discarded cards → all three returnable.
        const grave = state.pendingChoices?.[0];
        expect(grave?.kind).toBe("choose-graveyard-card");
        expect(grave?.zone).toBe("graveyard");
        expect(grave?.count).toEqual({ min: 0, max: 2 });
        expect(new Set(grave?.candidateIds)).toEqual(
            new Set(["g0", "h0", "h1"])
        );
        // Return g0 and the just-discarded h0 (CR 400.7).
        answerChoice(state, ["g0", "h0"]);
        expect(new Set(p1().hand.map((c) => c.id))).toEqual(
            new Set(["g0", "h0"])
        );
        // h1 stays in the graveyard.
        expect(p1().graveyard.map((c) => c.id)).toEqual(["h1"]);
        // CR 608.2 — Recall exiled itself, never reached the graveyard.
        expect(p1().exile.map((c) => c.card?.id)).toEqual([recall.id]);
        expect(p1().graveyard.some((c) => c.card?.id === recall.id)).toBe(
            false
        );
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
    });

    it("X=0 discards nothing, returns nothing, and still exiles Recall", () => {
        const { state } = makeRecallState({
            handIds: ["h0", "h1"],
            graveyardIds: ["g0"],
            chosenX: 0,
        });
        // No discard pick and no return pick are raised — resolution completes
        // in a single pass.
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["h0", "h1"]);
        expect(p1.graveyard.map((c) => c.id)).toEqual(["g0"]);
        expect(p1.exile.map((c) => c.card?.id)).toEqual([recall.id]);
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
    });

    it("caps the return at graveyard size when fewer cards are available", () => {
        // X = 2 but only one card to discard (hand size 1). Discard count = 1,
        // so the return is capped at 1 even though the graveyard has more.
        const state = startRecall({
            handIds: ["h0"],
            graveyardIds: ["g0", "g1"],
            chosenX: 2,
        });
        // Step 0 — discard clamps to hand size (1), discarding h0.
        const discard = state.pendingChoices?.[0];
        expect(discard?.count).toBe(1);
        answerChoice(state, ["h0"]);
        // Return is capped at the one card actually discarded.
        const grave = state.pendingChoices?.[0];
        expect(grave?.count).toEqual({ min: 0, max: 1 });
        expect(new Set(grave?.candidateIds)).toEqual(
            new Set(["g0", "g1", "h0"])
        );
        answerChoice(state, ["g0"]);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["g0"]);
        expect(p1.exile.map((c) => c.card?.id)).toEqual([recall.id]);
        expect(state.stack.length).toBe(0);
    });

    it("X=2 with an empty graveyard discards but returns nothing, still exiles", () => {
        const state = startRecall({
            handIds: ["h0", "h1"],
            graveyardIds: [],
            chosenX: 2,
        });
        answerChoice(state, ["h0", "h1"]); // discard both
        // Discarded cards are the only graveyard contents → returnable.
        const grave = state.pendingChoices?.[0];
        expect(grave?.count).toEqual({ min: 0, max: 2 });
        answerChoice(state, []); // return none
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual([]);
        expect(new Set(p1.graveyard.map((c) => c.id))).toEqual(
            new Set(["h0", "h1"])
        );
        expect(p1.exile.map((c) => c.card?.id)).toEqual([recall.id]);
        expect(state.stack.length).toBe(0);
    });

    it("drives the discard → graveyard-return chain through the real submit mutations", () => {
        // Integration: every choice resumes via the production
        // `applyPendingChoiceSubmit`, exercising the candidateIds allow-list and
        // the [min,max] range guard end-to-end (GRE → game.ts boundary).
        const state = startRecall({
            handIds: ["h0", "h1"],
            graveyardIds: ["g0"],
            chosenX: 2,
        });
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
        submit(["h0", "h1"]); // discard both
        // A card outside the graveyard candidate set is rejected.
        expect(() => submit(["not-in-grave"])).toThrow();
        // Picking more than max (2) is rejected by the range guard.
        expect(() => submit(["g0", "h0", "h1"])).toThrow();
        submit(["g0", "h1"]); // return two
        const p1 = state.players[0];
        expect(new Set(p1.hand.map((c) => c.id))).toEqual(
            new Set(["g0", "h1"])
        );
        expect(p1.exile.map((c) => c.card?.id)).toEqual([recall.id]);
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
    });

    it("the self-exile and returned hand survive the wire projection (CR 608.2)", () => {
        const state = startRecall({
            handIds: ["h0"],
            graveyardIds: ["g0"],
            chosenX: 1,
        });
        answerChoice(state, ["h0"]); // discard h0
        answerChoice(state, ["g0"]); // return g0
        const projected = projectPublicState(state, 1, "p1");
        // Recall sits in p1's exile, not the graveyard, after the wire round.
        expect(projected.players[0].exile.map((c) => c.card?.id)).toEqual([
            recall.id,
        ]);
        expect(
            projected.players[0].graveyard.some((c) => c.card?.id === recall.id)
        ).toBe(false);
        // g0 returned to hand; h0 (discarded, not returned) stays in graveyard.
        expect(projected.players[0].hand.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// normalizeManaCost — {X}{X} doubles the chosen X (Recall), CR 107.3.
// ---------------------------------------------------------------------------

describe("normalizeManaCost xFactor ({X}{X} costs, CR 107.3)", () => {
    it("doubles the chosen X for a {X}{X}{U} cost (Recall)", () => {
        const norm = normalizeManaCost(recall.manaCost!, { chosenX: 3 });
        // 3 × 2 = 6 generic (folded into the `X` key), plus {U}. xFactor itself
        // is never emitted as a mana entry.
        expect(norm.X).toBe(6);
        expect(norm.U).toBe(1);
        expect(norm.xFactor).toBeUndefined();
    });

    it("X=0 yields just the colored portion", () => {
        const norm = normalizeManaCost(recall.manaCost!, { chosenX: 0 });
        expect(norm.X ?? 0).toBe(0);
        expect(norm.U).toBe(1);
    });
});

describe("Wall of Vapor (prevent combat damage from creatures it's blocking, CR 615/611)", () => {
    function makeWallBlockState() {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const wall = makeInstance(wallOfVapor.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        return makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { wall: ["atk"] },
                blockersConfirmed: true,
            },
        });
    }

    it("takes NO combat damage from a creature it blocks", () => {
        const state = makeWallBlockState();
        // 2/2 attacker assigns 2 to the 0/1 Wall — would be lethal, prevented.
        applyAllCombatDamage(state, { atk: { wall: 2 } });
        const wall = state.players[0].battlefield.find((c) => c.id === "wall");
        expect(wall).toBeDefined();
        expect(wall?.damageMarked ?? 0).toBe(0);
    });

    it("does NOT prevent damage from a creature it is NOT blocking", () => {
        const state = makeWallBlockState();
        const wall = state.players[0].battlefield.find((c) => c.id === "wall")!;
        // A different (unblocked) attacker is not in the Wall's block list.
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p2",
            ownerId: "p2",
        });
        expect(isCombatDamagePreventedFromSource(state, wall, other)).toBe(
            false
        );
    });

    it("has Defender and the prevention static", () => {
        expect(wallOfVapor.staticAbilities).toContain("defender");
        expect(
            wallOfVapor.staticEffects?.some(
                (e) => e.kind === "combat-damage-prevention"
            )
        ).toBe(true);
    });

    it("prevention survives the wire projection (client-visible static)", () => {
        const state = makeWallBlockState();
        const wall = state.players[0].battlefield.find((c) => c.id === "wall")!;
        const atk = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(isCombatDamagePreventedFromSource(state, wall, atk)).toBe(true);
        const projected = projectPublicState(state, 2, "p1");
        const pWall = projected.players[0].battlefield.find(
            (c) => c.id === "wall"
        )!;
        const pAtk = projected.players[1].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(
            isCombatDamagePreventedFromSource(
                projected as never,
                pWall as never,
                pAtk as never
            )
        ).toBe(true);
    });
});

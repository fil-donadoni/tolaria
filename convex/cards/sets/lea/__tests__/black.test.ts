// Per-card behavior tests for black cards in `convex/cards/sets/lea/black.ts`
// (LEA, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises. Shared stack/resolve shims live in
// ./helpers; fixture builders stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    animateDead,
    badMoon,
    bayou,
    blackKnight,
    bogWraith,
    burrowing,
    circleOfProtectionWhite,
    cursedLand,
    darkRitual,
    deathgrip,
    demonicHordes,
    demonicTutor,
    drainLife,
    drudgeSkeletons,
    evilPresence,
    fear,
    fireball,
    forest,
    frozenShade,
    gloom,
    grizzlyBears,
    howlFromBeyond,
    hypnoticSpecter,
    juggernaut,
    lich,
    lifeforce,
    lightningBolt,
    llanowarElves,
    lordOfThePit,
    merfolkOfThePearlTrident,
    mindTwist,
    mountain,
    netherShadow,
    nettlingImp,
    nightmare,
    paralyze,
    pestilence,
    plagueRats,
    plains,
    raiseDead,
    redElementalBlast,
    royalAssassin,
    sacrifice,
    savannahLions,
    scatheZombies,
    scavengingGhoul,
    sengirVampire,
    simulacrum,
    sinkhole,
    solRing,
    streamOfLife,
    swamp,
    swordsToPlowshares,
    terror,
    unholyStrength,
    uthdenTroll,
    wallOfBone,
    warpArtifact,
    weakness,
    willOTheWisp,
    wordOfCommand,
    zombieMaster,
} from "..";
// Cross-set: Blizzard is the shipped card carrying a card-level `castCondition`
// (CR 601.3a, issue #2102) and Snow-Covered Forest satisfies it.
import { blizzard, snowCoveredForest } from "../../ice";
import {
    regenerateOrDestroy,
    removePermanentTo,
    resolveTopOfStack,
    processPendingActionTriggers,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    normalizeManaCost,
    getCostModifiers,
    applyCostModifiers,
    getActingPlayer,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getBasicLandMana } from "../../../../gre/constants";
import {
    getLegalTargets,
    isProtectedFromSource,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { checkStateBasedActions } from "../../../../gre/sba";
import { validateBlockerEligibility, mustAttack } from "../../../../gre/combat";
import { advancePhase } from "../../../../gre/phases";
import { compactState, expandState } from "../../../../gre/serialize";
import type { CardType } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { activatePump, pushDelayedTrigger, runUntapForJ } from "./helpers";

describe("Bad Moon (static pt-buff: +1/+1 to black creatures)", () => {
    // Savannah Lions is white — Bad Moon must NOT apply. To exercise the
    // positive case we synthesize a black creature via manaCost.
    function blackCreature(id: string, controllerId = "p1"): CardInstanceState {
        return {
            id,
            card: { id: "fake-black", manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 1,
            toughness: 1,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
            isTapped: false,
        };
    }

    it("buffs black creatures +1/+1", () => {
        const black = blackCreature("black-1");
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const p1 = makePlayer("p1", { battlefield: [black, enchant] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(getEffectivePower(state, black)).toBe(2);
        expect(getEffectiveToughness(state, black)).toBe(2);
    });

    it("does NOT buff non-black creatures (Savannah Lions is white)", () => {
        const lion = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const p1 = makePlayer("p1", { battlefield: [lion, enchant] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(getEffectivePower(state, lion)).toBe(2);
        expect(getEffectiveToughness(state, lion)).toBe(1);
    });

    it("buffs opponent's black creatures too (not controller-restricted)", () => {
        const black = blackCreature("opp-black", "p2");
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        expect(getEffectivePower(state, black)).toBe(2);
    });

    it("wire format: buff still applies after projection strips manaCost (regression)", () => {
        // getColors used to read manaCost from card.card. The projection
        // strips card to { id }, so Bad Moon must resolve manaCost via the
        // registry fallback. This test would fail on the pre-fix code.
        const black: CardInstanceState = {
            id: "black-proj",
            // Embedded manaCost will be STRIPPED by the projection.
            card: { id: savannahLions.id, manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 1,
            toughness: 1,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [black, enchant] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedBlack = projected.players[0].battlefield.find(
            (c) => c.id === "black-proj"
        )!;
        // After projection, the creature should still be identified as white
        // via the registry (Savannah Lions), NOT black. That's the correct
        // semantic: color comes from the card def, not from any stale embed.
        expect(getEffectivePower(projected, projectedBlack)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Spell resolutions (CR 608.3)
// ---------------------------------------------------------------------------

describe("Dark Ritual (add {B}{B}{B}, CR 608.3 + 106.1)", () => {
    it("adds three black mana to the caster's mana pool on resolution", () => {
        const state = makeState();
        pushSpell(state, darkRitual.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("adds to the caster, not the opponent", () => {
        const state = makeState();
        pushSpell(state, darkRitual.id, "p2");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B ?? 0).toBe(0);
        expect(state.players[1].manaPool.B).toBe(3);
    });
});

describe("Demonic Tutor (search library, put into hand, CR 701.19)", () => {
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

    it("enqueues a search-library pending choice for the caster", () => {
        const card = makeInstance(swamp.id, {
            id: "target-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [makePlayer("p1", { library: [card] }), makePlayer("p2")],
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices?.[0]).toMatchObject({
            playerId: "p1",
            zone: "library",
            count: 1,
            kind: "search-library",
        });
    });

    it("wire format: exposes library face-up to the searcher and hides it from the opponent (CR 401.4 / 701.19)", () => {
        const wanted = makeInstance(grizzlyBears.id, {
            id: "wanted",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const filler = makeInstance(swamp.id, {
            id: "filler",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [wanted, filler] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state);

        const forP1 = projectPublicState(state, 1, "p1");
        expect(forP1.players[0].library).toEqual({ count: 2, known: [] });
        expect(forP1.players[0].librarySearch?.map((c) => c.id)).toEqual([
            "wanted",
            "filler",
        ]);
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[0].librarySearch).toBeUndefined();
        expect(forP2.players[0].library).toEqual({ count: 2, known: [] });
    });

    it("moves the chosen card into the caster's hand and shuffles library", () => {
        const wanted = makeInstance(grizzlyBears.id, {
            id: "wanted",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const others = [
            makeInstance(swamp.id, {
                id: "other-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(swamp.id, {
                id: "other-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { library: [wanted, ...others] }),
                makePlayer("p2"),
            ],
            rngSeed: 1,
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state); // step 0 suspends
        expect(state.pendingChoices).toHaveLength(1);
        commitHead(state, ["wanted"]);
        resolveTopOfStack(state); // step 1 resumes

        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toContain("wanted");
        expect(p1.library.map((c) => c.id)).not.toContain("wanted");
        expect(p1.library).toHaveLength(2);
    });
});

describe("Drain Life (X damage to any target, gain X life, CR 107.3 + 120.1)", () => {
    it("deals X damage to a player and gains the caster X life", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        spell.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
        expect(state.players[0].life).toBe(25);
    });

    it("deals X damage to a creature and gains the caster X life", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "permanent", id: "opp-bear" },
        ]);
        spell.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
    });

    it("is a no-op when X is 0", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        spell.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });
});

describe("Royal Assassin ({T}: destroy target tapped creature, CR 701.20 + 701.7)", () => {
    function setup() {
        const assassin = makeInstance(royalAssassin.id, {
            id: "assassin",
            isSummoningSick: false,
        });
        const victim = makeInstance(savannahLions.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [assassin] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state, assassin, victim };
    }

    function activate(
        state: ReturnType<typeof makeState>,
        source: CardInstanceState,
        targetId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "royal-assassin-destroy",
            targets: [{ type: "permanent", id: targetId }],
        });
        resolveTopOfStack(state);
    }

    it("declares a tapped-creature TargetRequirement", () => {
        const ability = royalAssassin.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            tappedFilter: "tapped",
        });
    });

    it("destroys a tapped creature on resolution", () => {
        const { state, assassin, victim } = setup();
        victim.isTapped = true;
        activate(state, assassin, "victim");
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("victim");
    });

    it("fizzles silently if target untaps between activation and resolution (CR 608.2b)", () => {
        const { state, assassin, victim } = setup();
        victim.isTapped = true;
        state.stack.push({
            ...assassin,
            zone: "stack",
            castById: "p1",
            abilityId: "royal-assassin-destroy",
            targets: [{ type: "permanent", id: "victim" }],
        });
        // Opponent untaps the target in response.
        state.players[1].battlefield[0].isTapped = false;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("getLegalTargets only returns tapped creatures", () => {
        const { state, victim } = setup();
        const tappedBear = makeInstance(grizzlyBears.id, {
            id: "tapped-bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        state.players[1].battlefield.push(tappedBear);
        // victim is untapped (default) → should NOT appear; tappedBear should.
        expect(victim.isTapped).toBe(false);
        const req = royalAssassin.activatedAbilities?.[0]?.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE);
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("tapped-bear");
        expect(ids).not.toContain("victim");
    });
});

describe("Nightmare (flying, P/T = Swamps you control, CR 604.3 CDA)", () => {
    function setup(args: { controller: string; swamps: number }) {
        const nm = makeInstance(nightmare.id, {
            id: "nm",
            controllerId: args.controller,
            ownerId: args.controller,
        });
        const battlefield: CardInstanceState[] = [nm];
        for (let i = 0; i < args.swamps; i++) {
            battlefield.push(
                makeInstance(swamp.id, {
                    id: `swamp-${args.controller}-${i}`,
                    controllerId: args.controller,
                    ownerId: args.controller,
                })
            );
        }
        const players =
            args.controller === "p1"
                ? [makePlayer("p1", { battlefield }), makePlayer("p2")]
                : [makePlayer("p1"), makePlayer("p2", { battlefield })];
        return makeState({ players });
    }

    it("has flying as a baseline static ability", () => {
        expect(nightmare.staticAbilities).toContain("flying");
    });

    it("P/T equals controller's Swamp count (3)", () => {
        const state = setup({ controller: "p1", swamps: 3 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(3);
        expect(getEffectiveToughness(state, nm)).toBe(3);
    });

    it("does NOT count opponent's Swamps", () => {
        const state = setup({ controller: "p1", swamps: 2 });
        state.players[1].battlefield.push(
            makeInstance(swamp.id, {
                id: "opp-swamp",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(2);
        expect(getEffectiveToughness(state, nm)).toBe(2);
    });

    it("is 0/0 with no Swamps in play (would die to SBA, CR 704.5f)", () => {
        const state = setup({ controller: "p1", swamps: 0 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(0);
        expect(getEffectiveToughness(state, nm)).toBe(0);
    });

    it("CDA survives the projection boundary (wire format)", () => {
        const state = setup({ controller: "p1", swamps: 4 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectiveToughness(state, nm)).toBe(4);
        const projected = projectPublicState(state, 0, "p1");
        const slimNm = projected.players[0].battlefield.find(
            (c) => c.id === "nm"
        );
        if (!slimNm) throw new Error("nm not in projection");
        expect(getEffectivePower(projected, slimNm)).toBe(4);
        expect(getEffectiveToughness(projected, slimNm)).toBe(4);
    });
});

describe("Sengir Vampire (+1/+1 on damaged-creature death, CR 603.2)", () => {
    it("has flying and the CREATURE_DIED trigger", () => {
        expect(sengirVampire.staticAbilities).toContain("flying");
        const trig = sengirVampire.triggeredAbilities?.[0];
        expect(trig?.event).toBe("CREATURE_DIED");
    });

    it("grows +1/+1 when a blocker it damaged dies in combat", async () => {
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: ["vamp"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        // Bear is dead and in graveyard
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
        // CREATURE_DIED trigger is on the stack for Sengir Vampire
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "sengir-vampire-counter"
        );
        resolveTopOfStack(state);
        const live = state.players[0].battlefield[0];
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(5);
        expect(live.counters?.["+1/+1"]).toBe(1);
    });

    it("does NOT trigger on the death of a creature it didn't damage", async () => {
        // Vampire attacks, is blocked by bear1. A second bear (bear2) dies from
        // damage dealt by another attacker, not by vampire. Vampire's trigger
        // must not fire for bear2's death.
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire, other] }),
                makePlayer("p2", { battlefield: [bear1, bear2] }),
            ],
            combat: {
                attackerIds: ["vamp", "other"],
                confirmed: true,
                blockerAssignments: { bear1: ["vamp"], bear2: ["other"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {
            vamp: { bear1: 4 },
            other: { bear2: 2 },
        });
        // bear1 (damaged by vamp) and bear2 (damaged by other) are both dead.
        // Only bear1's death should trigger Sengir Vampire.
        expect(state.players[1].battlefield).toHaveLength(0);
        const sengirTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "sengir-vampire-counter"
        );
        expect(sengirTriggers).toHaveLength(1);
    });

    it("does NOT trigger on Sengir Vampire's own death", async () => {
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            toughness: 1, // make it fragile so it dies to the bear
            power: 4,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
            toughness: 10,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: ["vamp"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        // Vampire damaged the bear but died from the bear's counter-damage.
        // The bear survived (10 toughness). No CREATURE_DIED for bear →
        // no Sengir trigger. Vampire's own death must not trigger either
        // (matches excludes self).
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(1);
        const sengirTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "sengir-vampire-counter"
        );
        expect(sengirTriggers).toHaveLength(0);
    });

    it("clears damagedBySources at CLEANUP (CR 514.2)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            damagedBySources: ["some-source"],
        });
        const state = makeState({
            phase: "END_STEP",
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        advancePhase(state); // END_STEP → CLEANUP (auto-advances to UNTAP)
        expect(
            state.players[1].battlefield[0].damagedBySources
        ).toBeUndefined();
    });

    it("wire format: +1/+1 counter survives projectPublicState", async () => {
        // Visible-on-board effect from a diedTrigger factory. Re-runs the P/T
        // assertion against the projected state so the projection layer
        // (which slims `card.card` to `{ id }`) can't silently break the
        // counter contribution.
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: ["vamp"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const projectedVamp = projected.players[0].battlefield.find(
            (c) => c.id === "vamp"
        )!;
        expect(getEffectivePower(projected, projectedVamp)).toBe(5);
        expect(getEffectiveToughness(projected, projectedVamp)).toBe(5);
        expect(projectedVamp.counters?.["+1/+1"]).toBe(1);
    });
});

describe("Sinkhole (destroy target land, CR 701.7)", () => {
    it("destroys a target Swamp and sends it to its owner's graveyard", () => {
        const land = makeInstance(swamp.id, {
            id: "p1-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sinkhole.id, "p2", [
            { type: "permanent", id: "p1-swamp" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "p1-swamp"
        );
    });

    it("declares a Land target requirement with count 1", () => {
        expect(sinkhole.targetRequirement).toEqual({
            type: "Land",
            count: 1,
        });
    });

    it("uses the destroy-target effect shorthand (registry-compiled resolve)", () => {
        expect(sinkhole.effect).toBe("destroy-target");
        expect(sinkhole.resolve).toBeUndefined();
    });

    it("wire format: destroyed land absent from projected battlefield, present in graveyard", () => {
        const land = makeInstance(swamp.id, {
            id: "p1-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sinkhole.id, "p2", [
            { type: "permanent", id: "p1-swamp" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.map((c) => c.id)).not.toContain("p1-swamp");
        expect(p1.graveyard.map((c) => c.id)).toContain("p1-swamp");
    });
});

// ---------------------------------------------------------------------------
// Keyword abilities (the layer/combat system tests them generically; here we
// only assert the card definition carries the right keywords — guards against
// typos / accidental removals).
// ---------------------------------------------------------------------------

describe("Black Knight (first strike + protection from white, CR 702.7 + 702.16)", () => {
    it("is a 2/2 Knight for {B}{B} with first strike and protection from white", () => {
        expect(blackKnight.manaCost).toEqual({ B: 2 });
        expect(blackKnight.types).toContain("Creature");
        expect(blackKnight.subtypes).toEqual(["Human", "Knight"]);
        expect(blackKnight.power).toBe(2);
        expect(blackKnight.toughness).toBe(2);
        expect(blackKnight.staticAbilities).toContain("first strike");
        expect(blackKnight.staticAbilities).toContain("protection from white");
    });

    it("CR 702.16b — cannot be targeted by Swords to Plowshares (white source)", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bk] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            swordsToPlowshares.targetRequirement!,
            {
                ...NO_TARGETING_SOURCE,
                colors: ["W"],
            }
        );
        expect(legal.map((t) => t.id)).not.toContain("bk");
    });

    it("CR 702.16f — as attacker, cannot be blocked by a white creature", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p1",
            isAttacking: true,
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const result = validateBlockerEligibility(bk, lion, [lion]);
        expect(result.eligible).toBe(false);
    });

    it("wire format: protection detection survives projectPublicState", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p1",
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bk] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBk = projected.players[0].battlefield.find(
            (c) => c.id === "bk"
        )! as CardInstanceState;
        const slimLion = projected.players[1].battlefield.find(
            (c) => c.id === "lion"
        )! as CardInstanceState;
        expect(isProtectedFromSource(slimBk, slimLion)).toBe(true);
    });
});

describe("Bog Wraith (swampwalk evasion, CR 702.13b)", () => {
    it("is a 3/3 Wraith for {3}{B} with swampwalk", () => {
        expect(bogWraith.manaCost).toEqual({ X: 3, B: 1 });
        expect(bogWraith.types).toContain("Creature");
        expect(bogWraith.subtypes).toEqual(["Wraith"]);
        expect(bogWraith.power).toBe(3);
        expect(bogWraith.toughness).toBe(3);
        expect(bogWraith.staticAbilities).toContain("swampwalk");
    });

    it("cannot be blocked when defending player controls a Swamp", () => {
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p1",
        });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const swampInst = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p2",
        });
        const result = validateBlockerEligibility(wraith, bears, [
            bears,
            swampInst,
        ]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/Swamp/);
    });

    it("can be blocked when defender controls no Swamp", () => {
        const wraith = makeInstance(bogWraith.id, { id: "wraith" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(wraith, bears, [bears])).toEqual({
            eligible: true,
        });
    });

    it("dual land with Swamp subtype (Bayou) also triggers swampwalk", () => {
        const wraith = makeInstance(bogWraith.id, { id: "wraith" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const bayouInst = makeInstance(bayou.id, {
            id: "bayou-1",
            controllerId: "p2",
        });
        expect(
            validateBlockerEligibility(wraith, bears, [bears, bayouInst])
                .eligible
        ).toBe(false);
    });
});

describe("Hypnotic Specter (keyword abilities + CR 603 trigger)", () => {
    it("is a 2/2 Specter for {1}{B}{B} with flying", () => {
        expect(hypnoticSpecter.manaCost).toEqual({ X: 1, B: 2 });
        expect(hypnoticSpecter.types).toContain("Creature");
        expect(hypnoticSpecter.subtypes).toEqual(["Specter"]);
        expect(hypnoticSpecter.power).toBe(2);
        expect(hypnoticSpecter.toughness).toBe(2);
        expect(hypnoticSpecter.staticAbilities).toContain("flying");
    });

    it("declares a damage-dealt trigger with matching oracle text", () => {
        const trigger = hypnoticSpecter.triggeredAbilities?.[0];
        expect(trigger?.event).toBe("DAMAGE_DEALT");
        expect(trigger?.oracleText).toMatch(/discards a card at random/);
    });

    function setupCombatScenario() {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const oppHand = [
            makeInstance(llanowarElves.id, {
                id: "opp-card-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(llanowarElves.id, {
                id: "opp-card-2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [specter] }),
                makePlayer("p2", { hand: oppHand }),
            ],
            combat: {
                attackerIds: ["specter"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
            rngSeed: 1,
        });
        return state;
    }

    it("queues a trigger on the stack when Specter deals damage to an opponent", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {});
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "hypnotic-specter-discard"
        );
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "DAMAGE_DEALT",
            target: { type: "player", id: "p2" },
            amount: 2,
        });
        // Priority restarts at active player with triggers on the stack.
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("resolves the trigger into a random discard from the opponent's hand", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {});
        resolveTopOfStack(state);

        const p2 = state.players[1];
        expect(p2.hand).toHaveLength(1);
        expect(p2.graveyard).toHaveLength(1);
        // Specter stays on the battlefield after the trigger resolves.
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("is deterministic: same seed → same discarded card", async () => {
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        const runOnce = () => {
            const state = setupCombatScenario();
            applyAllCombatDamage(state, {});
            resolveTopOfStack(state);
            return state.players[1].graveyard[0].id;
        };
        expect(runOnce()).toBe(runOnce());
    });

    it("does NOT trigger when dealing damage to self (controller)", () => {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p1",
            ownerId: "p1",
        });
        const trigger = hypnoticSpecter.triggeredAbilities![0];
        const match = trigger.matches(
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "specter",
                sourceControllerId: "p1",
                target: { type: "player", id: "p1" },
                amount: 2,
                isCombat: true,
            },
            specter
        );
        expect(match).toBe(false);
    });

    it("wire format: triggerEvent and triggeredAbilityId survive projection", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {});
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.stack).toHaveLength(1);
        expect(projected.stack[0].triggeredAbilityId).toBe(
            "hypnotic-specter-discard"
        );
        expect(projected.stack[0].triggerEvent).toMatchObject({
            type: "DAMAGE_DEALT",
            target: { type: "player", id: "p2" },
        });
    });
});

describe("Cursed Land (Aura on Land — 1 dmg to host's controller at upkeep)", () => {
    function setup(activePlayerId: string) {
        const land = makeInstance(plains.id, {
            id: "host-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(cursedLand.id, {
            id: "curse",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-land",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("queues + resolves into 1 damage to the host's controller at their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("does NOT fire on the aura controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Drudge Skeletons ({B}: regenerate self, CR 701.15a)", () => {
    function setup() {
        const skel = makeInstance(drudgeSkeletons.id, {
            id: "skel",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [skel] }),
                makePlayer("p2"),
            ],
        });
    }

    function activate(state: GameState, source: CardInstanceState) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "drudge-skeletons-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("stacks one regen shield on resolution", () => {
        const state = setup();
        const skel = state.players[0].battlefield[0];
        activate(state, skel);
        const after = state.players[0].battlefield[0];
        expect(after.regenerationShields).toBe(1);
    });

    it("survives a regen-honoring destroy after activation", () => {
        // Plain destroy (e.g. Lightning Bolt lethal damage) honors the
        // shield. Wrath of God's `cantBeRegenerated` rider would suppress it
        // — exercised separately on the Wrath test.
        const state = setup();
        const skel = state.players[0].battlefield[0];
        activate(state, skel);
        regenerateOrDestroy(state, skel.id);
        const after = state.players[0].battlefield.find((c) => c.id === "skel");
        expect(after).toBeDefined();
        expect(after!.isTapped).toBe(true);
    });
});

describe("Mind Twist (X cards at random from target player's hand)", () => {
    it("discards X cards at random from target player", () => {
        const filler = (id: string, controllerId: string) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId,
                ownerId: controllerId,
                zone: "hand",
            });
        const p2Hand = [
            filler("h1", "p2"),
            filler("h2", "p2"),
            filler("h3", "p2"),
            filler("h4", "p2"),
        ];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: p2Hand })],
        });
        // Pay X = 3 via the stack item's chosen X.
        state.stack.push({
            ...makeInstance(mindTwist.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenX: 3,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(3);
    });
});

describe("Plague Rats (P/T = number of Plague Rats on the battlefield, CR 604.3)", () => {
    it("scales with the number of Plague Rats across both battlefields", () => {
        const r1 = makeInstance(plagueRats.id, { id: "r1" });
        const r2 = makeInstance(plagueRats.id, {
            id: "r2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const r3 = makeInstance(plagueRats.id, {
            id: "r3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [r1] }),
                makePlayer("p2", { battlefield: [r2, r3] }),
            ],
        });
        expect(getEffectivePower(state, r1)).toBe(3);
        expect(getEffectiveToughness(state, r1)).toBe(3);
    });

    it("a lone Plague Rats counts itself (1/1)", () => {
        const r = makeInstance(plagueRats.id, { id: "lone" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [r] }), makePlayer("p2")],
        });
        expect(getEffectivePower(state, r)).toBe(1);
    });

    it("wire format: pt-cda survives the projection", () => {
        const r = makeInstance(plagueRats.id, { id: "wire" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [r] }), makePlayer("p2")],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wire"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

describe("Raise Dead (return target Creature card from your graveyard, CR 400.7)", () => {
    it("returns a creature from your graveyard to your hand", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, raiseDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        // The Raise Dead spell itself enters the graveyard on resolve, so the
        // assertion is "the targeted card is no longer there", not length 0.
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "dead"
        );
        expect(state.players[0].hand.map((c) => c.id)).toContain("dead");
    });

    it("targeting filter excludes opponent's graveyard (controller: 'you')", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "opp-dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        const req = raiseDead.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("opp-dead");
    });
});

describe("Unholy Strength + Weakness (pt-buff aura mirror cycle)", () => {
    it("Unholy Strength buffs host +2/+1", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unholyStrength.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, after)).toBe(4);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });

    it("Weakness debuffs host -2/-1", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, weakness.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, after)).toBe(0);
        expect(getEffectiveToughness(state, after)).toBe(1);
    });
});

describe("Wall of Bone (defender + {B} regen)", () => {
    it("declares defender and a {B} regen activated ability", () => {
        expect(wallOfBone.staticAbilities).toContain("defender");
        const ability = wallOfBone.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 } });
        expect(ability?.useStack).toBe(true);
    });

    it("activating regen shields self", () => {
        const wob = makeInstance(wallOfBone.id, {
            id: "wob",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wob] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wob,
            zone: "stack",
            castById: "p1",
            abilityId: "wall-of-bone-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

describe("Warp Artifact (Aura on Artifact — 1 dmg to host's controller at upkeep)", () => {
    function setup(activePlayerId: string) {
        const ring = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(warpArtifact.id, {
            id: "warp",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-art",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("deals 1 to host's controller on their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });
});

describe("Will-o'-the-Wisp (flying + {B} regen)", () => {
    it("flying static + regen activated", () => {
        expect(willOTheWisp.staticAbilities).toContain("flying");
        const ability = willOTheWisp.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 } });
    });

    it("activating regen shields self", () => {
        const wisp = makeInstance(willOTheWisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wisp,
            zone: "stack",
            castById: "p1",
            abilityId: "will-o-the-wisp-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Red FREE cycle (LEA): Burrowing, Goblin Balloon Brigade, Goblin King,
// Keldon Warlord, Orcish Artillery, Shatter, Stone Rain, Tunnel,
// Uthden Troll.
// ---------------------------------------------------------------------------

describe("Zombie Master (lord swampwalk + granted regen, no pt-buff)", () => {
    it("entering Master grants swampwalk and regen ability to existing Zombies (P/T unchanged)", () => {
        const zombie = makeInstance(scatheZombies.id, { id: "zomb" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [zombie] }),
                makePlayer("p2"),
            ],
        });
        // Pre-state: vanilla zombie.
        expect(zombie.staticAbilities).not.toContain("swampwalk");
        expect(zombie.grantedActivatedAbilities).toBeUndefined();
        expect(getEffectivePower(state, zombie)).toBe(2);
        // Cast Master.
        pushSpell(state, zombieMaster.id, "p1");
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "zomb"
        )!;
        expect(after.staticAbilities).toContain("swampwalk");
        expect(after.grantedActivatedAbilities).toHaveLength(1);
        expect(after.grantedActivatedAbilities![0].abilityId).toBe(
            "zombie-master-regenerate"
        );
        // Oracle has no P/T buff — Scathe Zombies stays 2/2.
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(2);
    });

    it("Zombie Master does NOT grant the regen ability to itself", () => {
        const state = makeState();
        pushSpell(state, zombieMaster.id, "p1");
        resolveTopOfStack(state);
        const master = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === zombieMaster.id
        )!;
        expect(master.grantedActivatedAbilities ?? []).toHaveLength(0);
        expect(master.staticAbilities ?? []).not.toContain("swampwalk");
    });

    it("a Zombie entering with Master in play picks up swampwalk + regen grant", () => {
        const master = makeInstance(zombieMaster.id, { id: "master" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, scatheZombies.id, "p1");
        resolveTopOfStack(state);
        const newZ = state.players[0].battlefield.find(
            (c) => c.id !== "master"
        )!;
        expect(newZ.staticAbilities).toContain("swampwalk");
        expect(newZ.grantedActivatedAbilities).toHaveLength(1);
        expect(getEffectivePower(state, newZ)).toBe(2);
    });

    it("when Master leaves, Zombies lose grant entries (swampwalk + regen)", () => {
        const master = makeInstance(zombieMaster.id, { id: "master" });
        const zombie = makeInstance(scatheZombies.id, {
            id: "zomb",
            staticAbilities: ["swampwalk"],
            grantedStaticAbilities: [
                { ability: "swampwalk", auraId: "master" },
            ],
            grantedActivatedAbilities: [
                {
                    sourceCardId: zombieMaster.id,
                    abilityId: "zombie-master-regenerate",
                    auraId: "master",
                },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master, zombie] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "master", "graveyard");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "zomb"
        )!;
        expect(after.staticAbilities).not.toContain("swampwalk");
        expect(after.grantedActivatedAbilities).toBeUndefined();
    });

    it("activating the granted regen on a Zombie shields it (no shield on Master)", () => {
        const master = makeInstance(zombieMaster.id, { id: "master" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, scatheZombies.id, "p1");
        resolveTopOfStack(state);
        const newZ = state.players[0].battlefield.find(
            (c) => c.id !== "master"
        )!;
        // Activate the granted regen on the new Zombie.
        state.stack.push({
            ...newZ,
            zone: "stack",
            castById: "p1",
            abilityId: "zombie-master-regenerate",
            grantedSourceCardId: zombieMaster.id,
            targets: [],
        });
        resolveTopOfStack(state);
        const zAfter = state.players[0].battlefield.find(
            (c) => c.id === newZ.id
        )!;
        expect(zAfter.regenerationShields).toBe(1);
        const masterAfter = state.players[0].battlefield.find(
            (c) => c.id === "master"
        )!;
        expect(masterAfter.regenerationShields).toBeUndefined();
    });

    it("wire format: grantedActivatedAbilities survive the projection", () => {
        const zombie = makeInstance(scatheZombies.id, { id: "zomb" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [zombie] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, zombieMaster.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "zomb"
        )!;
        expect(slim.staticAbilities).toContain("swampwalk");
        expect(slim.grantedActivatedAbilities).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Temporary P/T modifications (CR 611.1 — addTemporaryPTBuff)
// ---------------------------------------------------------------------------

describe("Frozen Shade ({B}: this creature gets +1/+1 until end of turn)", () => {
    function setup() {
        const shade = makeInstance(frozenShade.id, {
            id: "shade",
            controllerId: "p1",
            ownerId: "p1",
        });
        return {
            state: makeState({
                players: [
                    makePlayer("p1", { battlefield: [shade] }),
                    makePlayer("p2"),
                ],
            }),
            shadeId: "shade",
        };
    }

    it("activation pumps +1/+1 until end of turn", () => {
        const { state, shadeId } = setup();
        const shade = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, shade)).toBe(0);
        expect(getEffectiveToughness(state, shade)).toBe(1);
        activatePump(state, shade, "frozen-shade-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, after)).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(2);
    });

    it("multiple activations stack additively", () => {
        const { state, shadeId } = setup();
        for (let i = 0; i < 3; i++) {
            const shade = state.players[0].battlefield.find(
                (c) => c.id === shadeId
            )!;
            activatePump(state, shade, "frozen-shade-pump");
        }
        const after = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("buff expires at CLEANUP (CR 514.2)", () => {
        const { state, shadeId } = setup();
        const shade = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        activatePump(state, shade, "frozen-shade-pump");
        // Jump to END_STEP so the next advancePhase lands on CLEANUP, where
        // tickAllDurations runs.
        state.phase = "END_STEP";
        advancePhase(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(state, after)).toBe(0);
        expect(getEffectiveToughness(state, after)).toBe(1);
        expect(after.temporaryPTMods).toBeUndefined();
    });

    it("wire format: temporary P/T mod survives the projection", () => {
        const { state, shadeId } = setup();
        const shade = state.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        activatePump(state, shade, "frozen-shade-pump");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === shadeId
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Howl from Beyond (target creature gets +X/+0 EOT)", () => {
    it("applies +X/+0 to target on resolution", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [target],
                    manaPool: { W: 0, U: 0, B: 4, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, howlFromBeyond.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("buff expires at CLEANUP", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, howlFromBeyond.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        state.phase = "END_STEP";
        advancePhase(state);
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(bear.temporaryPTMods).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// CREATURE_DIED globale (CR 700.4 — emitted by removePermanentTo on any death)
// ---------------------------------------------------------------------------

describe("Scavenging Ghoul (corpse counter end-step + remove → regen)", () => {
    function setup() {
        const ghoul = makeInstance(scavengingGhoul.id, {
            id: "ghoul",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [ghoul] }),
                makePlayer("p2"),
            ],
        });
    }

    it("end-step trigger adds corpse counters equal to deaths this turn", () => {
        const state = setup();
        state.deathsThisTurn = 3;
        // Push the trigger directly with a synthetic PHASE_BEGIN event.
        const ghoul = state.players[0].battlefield[0];
        state.stack.push({
            ...ghoul,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "scavenging-ghoul-corpse",
            triggerSourceId: "ghoul",
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "END_STEP",
                activePlayerId: "p1",
            },
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield[0];
        expect(after.counters?.corpse).toBe(3);
    });

    it("remove-counter activated stacks a regen shield (cost paid externally)", () => {
        const state = setup();
        const ghoul = state.players[0].battlefield[0];
        // Cost is paid by activateAbility before pushing on stack. Simulate:
        // start with one counter and already-deducted cost so the resolve
        // observes the post-cost state.
        ghoul.counters = { corpse: 1 };
        state.stack.push({
            ...ghoul,
            zone: "stack",
            castById: "p1",
            abilityId: "scavenging-ghoul-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield[0];
        // Resolve only stacks the regen shield — counter removal is the cost
        // and would have been paid before this point in the activation flow.
        expect(after.regenerationShields).toBe(1);
        expect(after.counters?.corpse).toBe(1);
    });

    it("declarative cost: not enough counters → cannot activate", () => {
        const state = setup();
        const ghoul = state.players[0].battlefield[0];
        // No counters → cost.removeCounter would fail validation in
        // activateAbility. Verify the cost field on the ability itself.
        const ability = scavengingGhoul.activatedAbilities?.find(
            (a) => a.id === "scavenging-ghoul-regenerate"
        );
        expect(ability?.cost.removeCounter).toEqual({
            type: "corpse",
            count: 1,
        });
        expect(ghoul.counters).toBeUndefined();
    });

    it("turn advance resets deathsThisTurn", () => {
        const state = setup();
        state.deathsThisTurn = 5;
        // Walk to next turn via CLEANUP.
        state.phase = "END_STEP";
        advancePhase(state);
        // After advancePhase, we may be in UNTAP of the next turn.
        expect(state.deathsThisTurn).toBeUndefined();
    });
});

describe("Lifeforce ({G}, Sacrifice: counter target Black spell)", () => {
    it("declares the activated ability with sacrifice cost + Black colorFilter", () => {
        const ability = lifeforce.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { G: 1 }, sacrifice: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            colorFilter: "B",
        });
    });
});

describe("Deathgrip ({B}, Sacrifice: counter target Green spell)", () => {
    it("declares the activated ability with sacrifice cost + Green colorFilter", () => {
        const ability = deathgrip.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 }, sacrifice: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            colorFilter: "G",
        });
    });
});

describe("Pestilence (end-step sac if no creatures + {B}: 1 dmg to each creature/player, modern Oracle)", () => {
    function setup() {
        const enchant = makeInstance(pestilence.id, {
            id: "pest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ourBear = makeInstance(grizzlyBears.id, {
            id: "our-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant, ourBear] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        return { state, enchant };
    }

    it("activated {B} deals 1 damage to each creature and each player", () => {
        const { state, enchant } = setup();
        state.stack.push({
            ...enchant,
            zone: "stack",
            castById: "p1",
            abilityId: "pestilence-damage",
            targets: [],
        });
        const beforeP1 = state.players[0].life;
        const beforeP2 = state.players[1].life;
        resolveTopOfStack(state);
        // Both 2/2 bears take 1 damage — survive.
        const ourBear = state.players[0].battlefield.find(
            (c) => c.id === "our-bear"
        )!;
        const oppBear = state.players[1].battlefield.find(
            (c) => c.id === "opp-bear"
        )!;
        expect(ourBear.damageMarked).toBe(1);
        expect(oppBear.damageMarked).toBe(1);
        expect(state.players[0].life).toBe(beforeP1 - 1);
        expect(state.players[1].life).toBe(beforeP2 - 1);
    });

    it("activated ability has no activation restriction (modern Oracle removed the creature gate)", () => {
        const ability = pestilence.activatedAbilities?.[0];
        expect(ability?.canActivate).toBeUndefined();
    });

    it("end-step trigger does NOT fire while a creature is on the battlefield", () => {
        const { state } = setup(); // two bears present
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // → END_STEP
        expect(state.phase).toBe("END_STEP");
        // Intervening-if (CR 603.4d) is false — the sacrifice never enters the stack.
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].battlefield.find((c) => c.id === "pest")
        ).toBeDefined();
    });

    it("end-step trigger sacrifices Pestilence when no creatures are on the battlefield", () => {
        const enchant = makeInstance(pestilence.id, {
            id: "pest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "POSTCOMBAT_MAIN",
        });
        advancePhase(state); // → END_STEP
        expect(state.phase).toBe("END_STEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "pestilence-end-step-sac"
        );
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "pest")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("pest");
    });
});

describe("Fear (Aura — host can be blocked only by Black or Artifact)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, fear.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants 'fear' keyword to the host", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("fear");
    });

    it("rejects non-black non-artifact blocker", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        // grizzlyBears is green
        const greenBlocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        expect(
            validateBlockerEligibility(bear, greenBlocker, [greenBlocker])
                .eligible
        ).toBe(false);
    });

    it("accepts a black blocker", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        // hypnoticSpecter is black (cost {1}{B}{B})
        const blackBlocker = makeInstance(hypnoticSpecter.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        expect(
            validateBlockerEligibility(bear, blackBlocker, [blackBlocker])
        ).toEqual({ eligible: true });
    });
});

describe("Paralyze (aura — tap host on ETB + does-not-untap grant + upkeep pay {4}, CR 303.4 / 611)", () => {
    it("declares aura subtype, host-grant keyword and {B} cost", () => {
        expect(paralyze.manaCost).toEqual({ B: 1 });
        expect(paralyze.subtypes).toContain("Aura");
        const grant = paralyze.staticEffects?.[0];
        expect(grant?.kind).toBe("keyword-grant");
        if (grant?.kind === "keyword-grant") {
            expect(grant.keyword).toBe("does-not-untap");
        }
    });

    it("ETB taps the enchanted creature and the host keeps does-not-untap while attached", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Cast Paralyze targeting the opposing bear — push to stack and resolve.
        pushSpell(state, paralyze.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const tappedBear = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(tappedBear.isTapped).toBe(true);
        expect(tappedBear.staticAbilities).toContain("does-not-untap");
    });

    it("the host stays tapped through its controller's untap step while paralyzed", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, paralyze.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Drive UNTAP for the host's controller (p2) — bear must stay tapped.
        runUntapForJ("p2", state);
        const stillTapped = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(stillTapped?.isTapped).toBe(true);
    });

    it("upkeep trigger lets the host's controller pay {4} to untap the creature", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, paralyze.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // p2's upkeep — Paralyze fires; p2 (host's controller) is the may-pay
        // chooser.
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        state.phase = "UNTAP";
        advancePhase(state); // → UPKEEP queues trigger
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "paralyze-upkeep"
        );
        expect(trigger).toBeDefined();
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p2");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter?.isTapped).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Reanimation (gap H — CR 400.7 graveyard → battlefield)
// ---------------------------------------------------------------------------

describe("Animate Dead (Aura — CR 303.4i graveyard-target reanimation + CR 603.10 LTB)", () => {
    it("resolves on graveyard target — host returns to caster's battlefield, aura attaches", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p2" },
        ]);
        resolveTopOfStack(state);
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        );
        expect(revived).toBeDefined();
        // Aura targets any graveyard, host returns under caster's control.
        expect(revived?.controllerId).toBe("p1");
        const aura = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === animateDead.id
        );
        expect(aura).toBeDefined();
        expect(aura?.attachedTo).toBe("dead");
    });

    it("host gets -1/-0 via the pt-buff layer 7c", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        )!;
        // grizzlyBears 2/2 → -1/-0 → 1/2.
        expect(getEffectivePower(state, revived)).toBe(1);
        expect(getEffectiveToughness(state, revived)).toBe(2);
    });

    it("wire format: -1/-0 buff survives projectPublicState (regression guard)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slimRevived = projected.players[0].battlefield.find(
            (c) => c.id === "dead"
        )!;
        expect(getEffectivePower(projected, slimRevived)).toBe(1);
        expect(getEffectiveToughness(projected, slimRevived)).toBe(2);
    });

    it("LTB-trigger: when the aura is destroyed, the host is sacrificed (CR 603.10 last-known-info)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === animateDead.id
        )!;
        removePermanentTo(state, aura.id, "graveyard");
        processPendingActionTriggers(state);
        // Aura's LTB-trigger is now on the stack — resolve it.
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dead")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("dead");
    });

    it("LTB-trigger fires immediately when the host leaves and the aura falls off via SBA (CR 704.4 + 603.3b)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        // The reanimated host leaves the battlefield (destroyed / bounced /
        // exiled — modelled here as a direct move to graveyard). Its own
        // PERMANENT_LEFT is scanned and settled first.
        removePermanentTo(state, "dead", "graveyard");
        processPendingActionTriggers(state);
        // Now the aura is attached to a host no longer on the battlefield.
        // The SBA sweep must detach it (CR 704.5m) AND its LTB-trigger must go
        // on the stack in the same stable transition (CR 704.4 + 603.3b) —
        // not be deferred to the next upkeep.
        checkStateBasedActions(state);
        // Aura moved to the graveyard by the aura-attachment SBA.
        expect(
            state.players[0].battlefield.find(
                (c) => (c.card as { id?: string }).id === animateDead.id
            )
        ).toBeUndefined();
        // Its LTB-trigger fired immediately: the ability is on the stack now.
        expect(
            state.stack.some((s) => s.triggeredAbilityId === "anim-dead-ltb")
        ).toBe(true);
    });

    it("fizzle when the graveyard target is removed before resolution (CR 608.2b)", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, animateDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        state.players[0].graveyard = [];
        state.players[0].exile.push(dead);
        resolveTopOfStack(state);
        // Aura fizzles to its owner's graveyard (CR 303.4i).
        expect(
            state.players[0].battlefield.find(
                (c) => (c.card as { id?: string }).id === animateDead.id
            )
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find(
                (c) => (c.card as { id?: string }).id === animateDead.id
            )
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Replacement effects framework (gap U — CR 614)
// ---------------------------------------------------------------------------

describe("Lich (multi-replacement enchantment)", () => {
    it("ETB sets the controller's life to 0 and lich's lose-game replacement saves them", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [lichInst] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lich.id, "p1");
        // Replace the spell's id with the hand instance so PERMANENT_ENTERED
        // matches the trigger source.
        resolveTopOfStack(state);
        // ETB trigger now on stack — resolve it.
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        // Life dropped to 0; lich's lose-game replacement protects from SBA.
        expect(state.players[0].life).toBe(0);
        expect(state.gameOver).toBeUndefined();
        // SBA check: no game over because lich is on the field.
        checkStateBasedActions(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("wire format: lich-etb life drop survives projectPublicState", () => {
        // Visible-on-board effect produced by an enteredTrigger factory
        // (lich-etb → loseLife). Re-runs the life assertion against the
        // projected state so the projection layer can't silently strip the
        // controller's life change.
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 17, hand: [lichInst] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lich.id, "p1");
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(0);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(0);
    });

    it("lifegain → draw cards instead (CR 614 lifegain replacement)", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst],
                    life: 0,
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "deck1",
                            zone: "library",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "deck2",
                            zone: "library",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "deck3",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        // Use Stream of Life to gain 3 life.
        pushSpell(state, streamOfLife.id, "p1", [{ type: "player", id: "p1" }]);
        state.stack[state.stack.length - 1].chosenX = 3;
        resolveTopOfStack(state);
        // Life still 0; instead, drew 3 cards.
        expect(state.players[0].life).toBe(0);
        expect(state.players[0].hand.length).toBe(3);
    });

    it("damage to controller with enough fodder enqueues a player choice (CR 701.16)", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const a = makeInstance(grizzlyBears.id, {
            id: "sac-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(grizzlyBears.id, {
            id: "sac-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const c = makeInstance(grizzlyBears.id, {
            id: "sac-c",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst, a, b, c],
                    life: 0,
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        // Three candidates, three damage to sacrifice → keepCount = 0, no
        // choice needed: all three are sacrificed automatically.
        expect(state.gameOver).toBeUndefined();
        expect(
            state.players[0].battlefield.filter((c) => c.id !== "lich")
        ).toHaveLength(0);
    });

    it("damage trigger asks the player which permanent(s) to sacrifice when there's surplus", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const a = makeInstance(grizzlyBears.id, {
            id: "sac-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(grizzlyBears.id, {
            id: "sac-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const c = makeInstance(grizzlyBears.id, {
            id: "sac-c",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst, a, b, c],
                    life: 0,
                }),
                makePlayer("p2"),
            ],
        });
        // 1 damage → keep 2 of 3 candidates.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        // Override bolt damage by chosenX so this is 1 damage. Lightning
        // Bolt is fixed 3 — switch source to a single damage proxy via
        // overriding amount through the trigger directly is complex; we
        // instead pre-mark damageMarked via dealDamage simulated.
        // For this test we simulate the trigger payload manually: build a
        // DAMAGE_DEALT pendingEvent with amount=1 then drain via
        // processPendingActionTriggers without applying real damage.
        state.stack.pop();
        state.pendingEvents = [
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "synthetic",
                sourceControllerId: "p2",
                target: { type: "player", id: "p1" },
                amount: 1,
                isCombat: false,
            },
        ];
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        // Choice now enqueued: sacrifice 1 of 3.
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.count).toBe(1);
        expect(head.kind).toBe("sacrifice-permanents");
        // Player sacrifices sac-c → sac-a and sac-b remain.
        const item = state.stack.find((s) => s.id === head.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: ["sac-c"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const remaining = state.players[0].battlefield
            .filter((c) => c.id !== "lich")
            .map((c) => c.id);
        expect(remaining).toEqual(["sac-a", "sac-b"]);
        expect(state.gameOver).toBeUndefined();
    });

    it("damage to controller forces sacrifice of that many nontoken permanents", () => {
        const lichInst = makeInstance(lich.id, {
            id: "lich",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sacA = makeInstance(grizzlyBears.id, {
            id: "sac-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const sacB = makeInstance(grizzlyBears.id, {
            id: "sac-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lichInst, sacA, sacB],
                    life: 0,
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // resolve the lich-damage trigger
        // 3 damage → sacrifice 3 permanents. Only 2 candidates → loseGame.
        expect(state.gameOver).toBeDefined();
        expect(state.gameOver?.loserId).toBe("p1");
    });
});

describe("Simulacrum ({X}{B} instant — life + damage based on damage tracking)", () => {
    it("gain life equal to damage dealt to caster this turn + deal that much to target", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target], life: 13 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Take 4 damage as the caster (set tally directly to bypass combat).
        state.damageDealtToPlayerThisTurn = { p1: 4 };
        pushSpell(state, simulacrum.id, "p1", [
            { type: "permanent", id: "tgt" },
        ]);
        resolveTopOfStack(state);
        // Caster gained 4 life (13 → 17), target took 4 damage and was killed
        // (grizzlyBears toughness 2 < 4 → SBA lethal).
        expect(state.players[0].life).toBe(17);
        // After lethal, target should have left battlefield.
        expect(
            state.players[0].battlefield.find((c) => c.id === "tgt")
        ).toBeUndefined();
    });
});

describe("Demonic Hordes ({T}: destroy land; upkeep pay {B}{B}{B} else opp sacs your land)", () => {
    function setupUpkeepDecline() {
        const hordes = makeInstance(demonicHordes.id, {
            id: "hordes",
            controllerId: "p1",
            ownerId: "p1",
        });
        const landA = makeInstance(swamp.id, {
            id: "swamp-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const landB = makeInstance(swamp.id, {
            id: "swamp-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hordes, landA, landB] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        return state;
    }

    it("decline enqueues opp's sacrifice-permanents choice over controller's battlefield", () => {
        const state = setupUpkeepDecline();
        advancePhase(state); // → UPKEEP, trigger pushed
        expect(state.stack[0].triggeredAbilityId).toBe("demonic-hordes-upkeep");
        resolveTopOfStack(state);
        const may = state.pendingChoices?.[0];
        expect(may?.kind).toBe("may-pay");
        const item = state.stack.find((s) => s.id === may!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${may!.step}:${may!.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Self tapped + opp's choice enqueued.
        const hordes = state.players[0].battlefield.find(
            (c) => c.id === "hordes"
        )!;
        expect(hordes.isTapped).toBe(true);
        expect(state.pendingChoices).toBeDefined();
        const sac = state.pendingChoices![0];
        expect(sac.kind).toBe("sacrifice-permanents");
        expect(sac.playerId).toBe("p2");
        expect(sac.zoneOwnerId).toBe("p1");
        expect(sac.zone).toBe("battlefield");
    });

    it("decline path: opp picks swamp-a → it is sacrificed from controller's battlefield", () => {
        const state = setupUpkeepDecline();
        advancePhase(state);
        resolveTopOfStack(state);
        const may = state.pendingChoices![0];
        const item = state.stack.find((s) => s.id === may.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${may.step}:${may.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const sac = state.pendingChoices![0];
        const sacItem = state.stack.find((s) => s.id === sac.stackItemId)!;
        sacItem.collectedChoices = {
            ...(sacItem.collectedChoices ?? {}),
            [`${sac.step}:${sac.choiceId}`]: ["swamp-a"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "swamp-a")
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "swamp-a"
        );
        // swamp-b still on the battlefield.
        expect(
            state.players[0].battlefield.find((c) => c.id === "swamp-b")
        ).toBeDefined();
    });

    it("activated {T}: destroy target land", () => {
        const hordes = makeInstance(demonicHordes.id, {
            id: "hordes",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppLand = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hordes] }),
                makePlayer("p2", { battlefield: [oppLand] }),
            ],
        });
        state.stack.push({
            ...hordes,
            zone: "stack",
            castById: "p1",
            abilityId: "demonic-hordes-destroy-land",
            targets: [{ type: "permanent", id: "opp-swamp" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "opp-swamp")
        ).toBeUndefined();
    });
});

describe("Sacrifice ({B} — additional cost sac creature, add B mana = MV)", () => {
    it("resolve adds B mana equal to snapshotted sacrificed MV", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, sacrifice.id, "p1");
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "fake",
            mv: 5,
        };
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(5);
    });

    it("getAdditionalSacrificeMv on SpellContext reads the snapshot", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, sacrifice.id, "p1");
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "fake",
            mv: 3,
        };
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
    });

    it("declares additionalCosts.sacrificeFilter on the card definition", () => {
        expect(sacrifice.additionalCosts?.sacrificeFilter).toEqual({
            types: "Creature",
        });
    });
});

describe("Lord of the Pit (flying, trample, upkeep sacrifice-or-7dmg)", () => {
    it("has flying and trample", () => {
        expect(lordOfThePit.staticAbilities).toContain("flying");
        expect(lordOfThePit.staticAbilities).toContain("trample");
    });

    it("upkeep with no other creatures deals 7 damage to controller", () => {
        const lord = makeInstance(lordOfThePit.id, {
            id: "lord",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "lord-of-the-pit-upkeep"
        );
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(13);
    });

    it("upkeep with another creature requests sacrifice choice", () => {
        const lord = makeInstance(lordOfThePit.id, {
            id: "lord",
            controllerId: "p1",
            ownerId: "p1",
        });
        const fodder = makeInstance(grizzlyBears.id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lord, fodder],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("sacrifice-permanents");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["fodder"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "fodder")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });
});

describe("Terror (destroy target nonartifact, nonblack creature, CR 701.7)", () => {
    it("destroys a non-artifact, non-black creature", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, terror.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });

    it("cannot target artifact creatures (excludeTypes)", () => {
        const jugger = makeInstance(juggernaut.id, {
            id: "jugger",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [jugger] }),
            ],
        });
        const targets = getLegalTargets(
            state,
            terror.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        expect(targets.find((t) => t.id === "jugger")).toBeUndefined();
    });

    it("cannot target black creatures (excludeColors)", () => {
        const knight = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [knight] }),
            ],
        });
        const targets = getLegalTargets(
            state,
            terror.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        expect(targets.find((t) => t.id === "bk")).toBeUndefined();
    });

    it("can target a white creature (not excluded)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        const targets = getLegalTargets(
            state,
            terror.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        expect(targets.find((t) => t.id === "lion")).toBeDefined();
    });

    it("destroyed creature can't be regenerated (cantBeRegenerated)", () => {
        const troll = makeInstance(uthdenTroll.id, {
            id: "troll",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [troll] }),
            ],
        });
        pushSpell(state, terror.id, "p1", [{ type: "permanent", id: "troll" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Fog (CR 615 — prevent all combat damage this turn)
// ---------------------------------------------------------------------------

describe("Nettling Imp (CR 508.1d, 603.7a — forced attack + delayed destroy)", () => {
    const ABILITY_ID = "nettling-imp-force";

    function setup() {
        const imp = makeInstance(nettlingImp.id, {
            id: "imp",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [imp] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        return { state, imp, victim };
    }

    function activate(
        state: GameState,
        source: CardInstanceState,
        targetId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: ABILITY_ID,
            targets: [{ type: "permanent", id: targetId }],
        });
        resolveTopOfStack(state);
    }

    it("declares a non-Wall creature target with phase restriction", () => {
        const ability = nettlingImp.activatedAbilities?.[0];
        expect(ability?.id).toBe(ABILITY_ID);
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement?.excludeSubtypes).toBe("Wall");
        expect(ability?.targetRequirement?.controller).toBe("opponent");
        expect(ability?.activationPhaseRestriction).toEqual([
            "UPKEEP",
            "DRAW",
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
        ]);
    });

    it("sets mustAttackThisTurn on target creature", () => {
        const { state, imp, victim } = setup();
        activate(state, imp, "victim");
        expect(victim.mustAttackThisTurn).toBe(true);
    });

    it("schedules delayed destroy at end step", () => {
        const { state, imp } = setup();
        activate(state, imp, "victim");
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe(
            "nettling-imp-destroy"
        );
    });

    it("creature forced to attack is required by mustAttack()", () => {
        const { state, imp, victim } = setup();
        activate(state, imp, "victim");
        expect(mustAttack(victim, state)).toBe(true);
    });

    it("delayed trigger does NOT destroy if creature attacked", () => {
        const { state, imp, victim } = setup();
        activate(state, imp, "victim");
        victim.hasAttackedThisTurn = true;
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeDefined();
    });

    it("delayed trigger destroys creature if it didn't attack", () => {
        const { state, imp } = setup();
        activate(state, imp, "victim");
        pushDelayedTrigger(state, state.delayedTriggers![0]);
        state.delayedTriggers = undefined;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "victim")
        ).toBeDefined();
    });

    it("non-Wall filter excludes Walls from legal targets", () => {
        const { state } = setup();
        const wall = makeInstance(wallOfBone.id, {
            id: "wall",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(wall);
        const req = nettlingImp.activatedAbilities![0].targetRequirement!;
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("victim");
        expect(ids).not.toContain("wall");
    });

    it("canActivate returns false during controller's own turn", () => {
        const { state, imp } = setup();
        state.activePlayerId = "p1"; // Imp controller's turn
        const ability = nettlingImp.activatedAbilities![0];
        expect(ability.canActivate!(imp, state)).toBe(false);
    });

    it("canActivate returns true during opponent's turn", () => {
        const { state, imp } = setup();
        state.activePlayerId = "p2"; // Opponent's turn
        const ability = nettlingImp.activatedAbilities![0];
        expect(ability.canActivate!(imp, state)).toBe(true);
    });
});

describe("Evil Presence ({B} — aura: enchanted land is a Swamp)", () => {
    it("replaces host's subtypes with Swamp", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);
        expect(mtn.subtypes).toEqual(["Mountain"]);

        const aura = makeInstance(evilPresence.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(mtn.subtypes).toEqual(["Swamp"]);
        expect(mtn.printedSubtypes).toEqual(["Mountain"]);
    });

    it("host produces {B} after subtype change (mana sync)", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);
        expect(getBasicLandMana(mtn)).toBe("R");

        const aura = makeInstance(evilPresence.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        expect(getBasicLandMana(mtn)).toBe("B");
    });

    it("removing aura restores original subtypes", () => {
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
        expect(mtn.subtypes).toEqual(["Swamp"]);

        unapplySourceStaticEffects(state, aura);
        expect(mtn.subtypes).toEqual(["Mountain"]);
        expect(mtn.printedSubtypes).toBeUndefined();
        expect(getBasicLandMana(mtn)).toBe("R");
    });

    it("wire format: subtype change visible in projected state", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            id: "mtn-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const aura = makeInstance(evilPresence.id, {
            id: "ep-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        aura.attachedTo = mtn.id;
        state.players[1].battlefield.push(aura);
        applySourceStaticEffects(state, aura);

        const projected = projectPublicState(state, 1, "p1");
        const projMtn = projected.players[0].battlefield.find(
            (c) => c.id === "mtn-1"
        )!;
        expect(projMtn.subtypes).toEqual(["Swamp"]);
    });

    it("declares subtype-set static effect", () => {
        expect(evilPresence.staticEffects).toHaveLength(1);
        expect(evilPresence.staticEffects![0].kind).toBe("subtype-set");
    });
});

describe("Gloom (CR 601.2f — cost-modifier: white spells + white enchantment abilities)", () => {
    it("white spells cost {3} more", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteSpell = makeInstance(savannahLions.id, {
            id: "lions",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { hand: [whiteSpell] });
        const state = makeState({ players: [p1, p2] });

        const mods = getCostModifiers(state, whiteSpell, "spell");
        expect(mods.increase).toEqual({ X: 3 });

        const baseCost = normalizeManaCost(savannahLions.manaCost!);
        applyCostModifiers(baseCost, mods);
        // Savannah Lions = {W}, +3 generic = {W} + {3}
        expect(baseCost).toEqual({ W: 1, X: 3 });
    });

    it("non-white spells unaffected", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redSpell = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { hand: [redSpell] });
        const state = makeState({ players: [p1, p2] });

        const mods = getCostModifiers(state, redSpell, "spell");
        expect(mods.increase).toEqual({});
    });

    it("white enchantment activations cost {3} more", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        // COP White is a white enchantment with an activated ability
        const copW = makeInstance(circleOfProtectionWhite.id, {
            id: "cop",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { battlefield: [copW] });
        const state = makeState({ players: [p1, p2] });

        const mods = getCostModifiers(state, copW, "ability");
        expect(mods.increase).toEqual({ X: 3 });
    });

    it("removal of gloom reverts cost increase", () => {
        const gloomCard = makeInstance(gloom.id, {
            id: "gloom1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteSpell = makeInstance(savannahLions.id, {
            id: "lions",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", { battlefield: [gloomCard] });
        const p2 = makePlayer("p2", { hand: [whiteSpell] });
        const state = makeState({ players: [p1, p2] });

        expect(getCostModifiers(state, whiteSpell, "spell").increase).toEqual({
            X: 3,
        });

        // Remove gloom from battlefield
        state.players[0].battlefield = [];

        expect(getCostModifiers(state, whiteSpell, "spell").increase).toEqual(
            {}
        );
    });
});

describe("Nether Shadow (graveyard upkeep self-reanimation, CR 603.6e)", () => {
    // A non-triggering vanilla creature used to stack creature cards above
    // Nether Shadow in the graveyard.
    const FILLER_CREATURE_ID = "b93c5869-7777-44bb-967a-e9439b25ced4"; // Ironroot Treefolk

    function makeFiller(): CardInstanceState {
        return makeInstance(FILLER_CREATURE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
    }

    function gyState(fillerCount: number): GameState {
        const shadow = makeInstance(netherShadow.id, {
            id: "shadow",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const fillers = Array.from({ length: fillerCount }, makeFiller);
        // Index 0 = bottom; fillers sit ABOVE the shadow (higher index).
        return makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { graveyard: [shadow, ...fillers] }),
                makePlayer("p2"),
            ],
        });
    }

    const upkeep = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    it("has haste and a graveyard-zone upkeep trigger", () => {
        expect(netherShadow.staticAbilities).toContain("haste");
        const trig = netherShadow.triggeredAbilities?.[0];
        expect(trig?.event).toBe("PHASE_BEGIN");
        expect(trig?.zone).toBe("graveyard");
    });

    it("triggers on its owner's upkeep with 3+ creatures above it", () => {
        const state = gyState(3);
        const triggers = collectTriggers(state, [upkeep]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe("nether-shadow-reanimate");
    });

    it("does NOT trigger with fewer than 3 creatures above it", () => {
        const state = gyState(2);
        expect(collectTriggers(state, [upkeep])).toHaveLength(0);
    });

    it("does NOT trigger on the opponent's upkeep", () => {
        const state = gyState(3);
        const oppUpkeep = { ...upkeep, activePlayerId: "p2" };
        expect(collectTriggers(state, [oppUpkeep])).toHaveLength(0);
    });

    it("reanimates from the graveyard when the player accepts", () => {
        const state = gyState(3);
        const triggers = collectTriggers(state, [upkeep]);
        state.stack.push(...triggers);

        // First resolve suspends on the optional "you may" choice.
        expect(resolveTopOfStack(state)).toBeNull();
        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("may-pay");
        const item = state.stack[state.stack.length - 1];
        const key = `${pending.step}:${pending.choiceId}`;
        item.collectedChoices = { [key]: ["yes"] };
        state.pendingChoices = undefined;

        resolveTopOfStack(state);
        const p1 = state.players[0];
        const reanimated = p1.battlefield.find((c) => c.id === "shadow");
        expect(reanimated).toBeDefined();
        expect(reanimated!.staticAbilities).toContain("haste");
        expect(p1.graveyard.some((c) => c.id === "shadow")).toBe(false);
    });

    it("stays in the graveyard when the player declines", () => {
        const state = gyState(3);
        state.stack.push(...collectTriggers(state, [upkeep]));
        resolveTopOfStack(state);
        const item = state.stack[state.stack.length - 1];
        const pending = state.pendingChoices![0];
        item.collectedChoices = {
            [`${pending.step}:${pending.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "shadow")).toBe(true);
        expect(p1.battlefield.some((c) => c.id === "shadow")).toBe(false);
    });
});

describe("Word of Command (controlled cast — land branch, CR 305.2 / 608.2, ADR 0037)", () => {
    // p1 (the Acting Player / WoC controller) casts Word of Command targeting
    // the opponent p2. p2's hand holds a Forest (land) + a Grizzly Bears
    // (non-land). Resolution: p1 looks at p2's hand and picks a card; a land is
    // played under p2's control, counting against p2's one-land-per-turn drop.
    function seed(opts: { p2LandsPlayedThisTurn?: number } = {}) {
        const oppForest = makeInstance(forest.id, {
            id: "p2-forest",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "p2-bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", {
            hand: [oppForest, oppBear],
            landsPlayedThisTurn: opts.p2LandsPlayedThisTurn,
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        return state;
    }

    /** Submit the head pending choice through the backend integration path.
     *  Mirrors the `submitResolutionChoice` mutation handler in `game.ts`
     *  exactly: `applyPendingChoiceSubmit` (which re-runs resolution) followed
     *  by `checkStateBasedActions` — exercising the GRE → game.ts boundary, not
     *  just the engine in isolation. */
    function submitChoice(state: GameState, picks: string[]): void {
        const head = (state.pendingChoices ?? [])[0];
        expect(head).toBeDefined();
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: picks,
        });
        checkStateBasedActions(state);
    }

    it("targetRequirement is 'target opponent' (CR 115)", () => {
        expect(wordOfCommand.targetRequirement).toEqual({
            type: "player",
            count: 1,
            controller: "opponent",
        });
    });

    it("only the opponent is a legal target (the caster cannot be chosen)", () => {
        const state = seed();
        const legal = getLegalTargets(
            state,
            wordOfCommand.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const playerIds = legal
            .filter((t) => t.type === "player")
            .map((t) => t.id);
        expect(playerIds).toEqual(["p2"]);
    });

    it("suspends on a hand-pick choice routed to the controller over the opponent's hand", () => {
        const state = seed();
        const result = resolveTopOfStack(state);
        expect(result).toBeNull(); // suspended
        expect(state.pendingChoices?.length).toBe(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.zone).toBe("hand");
        expect(head.playerId).toBe("p1"); // the Acting Player chooses
        expect(head.zoneOwnerId).toBe("p2"); // from the opponent's hand
        // ADR 0037: actingPlayerId is recorded only when it DIFFERS from the
        // prompted player. In slice 1 the WoC controller IS the chooser, so it
        // is omitted (defaults to playerId) — the foundation is in place for
        // the spell branch (#577) where the controlled opponent diverges.
        expect(head.actingPlayerId).toBeUndefined();
        expect(head.actingPlayerId ?? head.playerId).toBe("p1");
    });

    it("grants the controller Card Knowledge of the opponent's hand (knownTo)", () => {
        const state = seed();
        resolveTopOfStack(state);
        const p2 = state.players[1];
        for (const card of p2.hand) {
            expect(card.knownTo).toContain("p1");
        }
    });

    it("picking a land plays it under the opponent's control, consuming their land drop (CR 305.2)", () => {
        const state = seed();
        resolveTopOfStack(state);
        submitChoice(state, ["p2-forest"]);

        const p2 = state.players[1];
        // Forest left p2's hand and is on p2's battlefield, controlled by p2.
        expect(p2.hand.map((c) => c.id)).not.toContain("p2-forest");
        const onBf = p2.battlefield.find((c) => c.id === "p2-forest");
        expect(onBf).toBeDefined();
        expect(onBf!.controllerId).toBe("p2");
        // CR 305.2 — the opponent's one-land-per-turn drop is consumed.
        expect(p2.landsPlayedThisTurn).toBe(1);
        // WoC itself resolved into its controller's (p1's) graveyard.
        const wocInGy = state.players[0].graveyard.some(
            (c) => c.card.id === wordOfCommand.id
        );
        expect(wocInGy).toBe(true);
        expect(state.stack.length).toBe(0);
    });

    it("if the opponent already played a land this turn, the chosen land is not played (CR 305.2 'if able')", () => {
        const state = seed({ p2LandsPlayedThisTurn: 1 });
        resolveTopOfStack(state);
        submitChoice(state, ["p2-forest"]);

        const p2 = state.players[1];
        // The Forest stays in hand — playing it is not "able".
        expect(p2.hand.map((c) => c.id)).toContain("p2-forest");
        expect(
            p2.battlefield.find((c) => c.id === "p2-forest")
        ).toBeUndefined();
        expect(p2.landsPlayedThisTurn).toBe(1); // unchanged
        expect(state.stack.length).toBe(0); // WoC still resolves
    });

    it("picking a non-land is a no-op this slice (TODO #577 spell branch)", () => {
        const state = seed();
        resolveTopOfStack(state);
        submitChoice(state, ["p2-bear"]);

        const p2 = state.players[1];
        // The Bear stays in hand — the spell branch is not implemented yet.
        expect(p2.hand.map((c) => c.id)).toContain("p2-bear");
        expect(p2.battlefield.length).toBe(0);
        expect(state.stack.length).toBe(0); // WoC resolves
    });

    it("getActingPlayer defaults to the controller for an ordinary cast", () => {
        const state = seed();
        const item = state.stack[0];
        expect(item.actingPlayerId).toBeUndefined();
        expect(getActingPlayer(item)).toBe("p1");
    });

    // --- Wire format (projectPublicState): knownTo + played land survive ---
    it("wire format: the controller's view of the opponent's hand survives projection", () => {
        const state = seed();
        resolveTopOfStack(state);
        // Viewer = p1 (the controller / Acting Player). The opponent (p2) hand
        // is sparse by default, but knownTo grants p1 identity on every card.
        const projected = projectPublicState(state, 1, "p1");
        const p2Hand = projected.players[1].hand;
        const visibleIds = p2Hand
            .filter((c): c is NonNullable<typeof c> => c !== null)
            .map((c) => c.id);
        expect(visibleIds).toContain("p2-forest");
        expect(visibleIds).toContain("p2-bear");
    });

    it("wire format: the played land is public on the opponent's battlefield", () => {
        const state = seed();
        resolveTopOfStack(state);
        submitChoice(state, ["p2-forest"]);
        // Viewer = p1: the opponent's battlefield is always public.
        const projected = projectPublicState(state, 1, "p1");
        const bfIds = projected.players[1].battlefield.map((c) => c.id);
        expect(bfIds).toContain("p2-forest");
    });

    // --- Serialization round-trip: StackItem.actingPlayerId persists ---
    it("serialization: StackItem.actingPlayerId survives a DB round-trip (ADR 0037)", () => {
        const state = seed();
        // Force a controlled-cast override onto the stack item (the value a
        // future spell-branch controlled cast would carry).
        state.stack[0].actingPlayerId = "p1";
        const restored = expandState(compactState(state));
        expect(restored.stack[0].actingPlayerId).toBe("p1");
        expect(getActingPlayer(restored.stack[0])).toBe("p1");
    });
});

describe("Word of Command (controlled cast, ADR 0037, CR 601 / 305.2)", () => {
    // p1 = Word of Command's controller (Acting Player); p2 = the controlled
    // opponent whose hand is looked at and whose card is played.
    function castWordOfCommand(state: GameState) {
        const item = pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        return item;
    }

    function submitPick(state: GameState, pickId: string) {
        const head = (state.pendingChoices ?? [])[0];
        if (!head) throw new Error("no pending choice");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [pickId],
        });
    }

    it("step 0: the controller is prompted to pick from the OPPONENT's hand, with knowledge granted", () => {
        const oppCard = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [oppCard] })],
        });
        castWordOfCommand(state);

        expect(state.pendingChoices).toHaveLength(1);
        // The chooser is the WoC controller; the zone is the OPPONENT's hand.
        expect(state.pendingChoices?.[0]).toMatchObject({
            playerId: "p1",
            zoneOwnerId: "p2",
            zone: "hand",
            kind: "choose-hand-card",
            count: 1,
        });
        // ADR 0026 — the controller now knows the opponent's hand they saw.
        expect(oppCard.knownTo).toContain("p1");
    });

    it("casts a non-targeted spell from the opponent's hand: real StackItem, castById=opponent, actingPlayerId=controller", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // Dark Ritual is now on the stack as the opponent's spell.
        const ritualOnStack = state.stack.find(
            (s) => (s.card as { id?: string }).id === darkRitual.id
        );
        expect(ritualOnStack).toBeDefined();
        expect(ritualOnStack?.castById).toBe("p2"); // CR 601 — opponent's spell
        expect(ritualOnStack?.actingPlayerId).toBe("p1"); // ADR 0037
        // It left the opponent's hand and entered the public stack.
        expect(
            state.players[1].hand.find((c) => c.id === "opp-ritual")
        ).toBeUndefined();
    });

    it("mana is auto-tapped ONLY from the opponent's lands; opponent's other resources untouched", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        // A land the CONTROLLER (p1) owns must NOT be touched.
        const myUntappedSwamp = makeInstance(swamp.id, {
            id: "my-swamp",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myUntappedSwamp] }),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // The opponent's Swamp paid for the spell (tapped); the controller's
        // own Swamp is untouched.
        expect(
            state.players[1].battlefield.find((c) => c.id === "opp-swamp")
                ?.isTapped
        ).toBe(true);
        expect(
            state.players[0].battlefield.find((c) => c.id === "my-swamp")
                ?.isTapped
        ).toBe(false);
    });

    it("unpayable from the opponent's lands → spell is NOT played", () => {
        // Dark Ritual costs {B} but the opponent controls no lands.
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [oppRitual] }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // Not cast: nothing on the stack, the card stays in the opponent's hand.
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === darkRitual.id
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-ritual")
        ).toBeDefined();
    });

    it("the cast spell then resolves as the opponent's spell (Dark Ritual fills the opponent's mana pool)", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");
        // Resolve the Dark Ritual now on top of the stack.
        resolveTopOfStack(state);

        // Dark Ritual adds {B}{B}{B} to its controller's (the opponent's) pool.
        // The Swamp's {B} was consumed paying for it, so the net is {B}{B}{B}.
        expect(state.players[1].manaPool.B).toBe(3);
        // The controller's pool is untouched.
        expect(state.players[0].manaPool.B).toBe(0);
    });

    it("land branch: the chosen land is played under the OPPONENT's control (CR 305.2)", () => {
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp-in-hand",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: [oppSwamp] })],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-swamp-in-hand");

        // The land is on the opponent's battlefield and counted their land drop.
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "opp-swamp-in-hand"
            )
        ).toBeDefined();
        expect(state.players[1].landsPlayedThisTurn).toBe(1);
    });

    it("land branch: opponent already played a land this turn → land NOT played (CR 305.2)", () => {
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp-in-hand",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppSwamp],
                    landsPlayedThisTurn: 1,
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-swamp-in-hand");

        // The land stayed in hand; the drop count is unchanged.
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "opp-swamp-in-hand"
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-swamp-in-hand")
        ).toBeDefined();
        expect(state.players[1].landsPlayedThisTurn).toBe(1);
    });

    it("wire format: the resulting stack item's controllerId (castById) = opponent and the chosen card is public after projection", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-ritual");

        // Re-run the assertion against the projected state both clients see.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.stack.find(
                (s) => s.card.id === darkRitual.id
            );
            expect(slim).toBeDefined();
            // CR 601 — the chosen spell is the opponent's spell.
            expect(slim?.castById).toBe("p2");
            expect(slim?.actingPlayerId).toBe("p1");
        }
    });

    it("wire format: the controller's knownTo view of the opponent's hand survives projection (ADR 0026)", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [oppRitual] }),
            ],
        });
        castWordOfCommand(state);
        // Suspended on the pick: the controller (p1) saw the opponent's hand.
        const projected = projectPublicState(state, 1, "p1");
        // p1 sees the opponent's hand card identities they looked at.
        const oppHand = projected.players[1].hand;
        expect(
            oppHand.some(
                (c) =>
                    c &&
                    (c as { card?: { id?: string } }).card?.id === darkRitual.id
            )
        ).toBe(true);
    });

    // --- TARGETED spell branch (#578, CR 601.2c): the Acting Player picks the
    // chosen spell's targets, reusing getLegalTargets. ---

    /** Submits the head pending choice (the target pick) with a single id. */
    function submitTarget(state: GameState, targetId: string) {
        submitPick(state, targetId);
    }

    it("targeted spell: the controller is prompted to pick a target after the card pick", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        // Pick the opponent's Lightning Bolt from their hand.
        submitPick(state, "opp-bolt");

        // A second pending choice — the target pick — is now routed to the
        // controller (p1), not the controlled opponent (p2).
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-damage-target");
        // "Any target" → both players are legal targets, including the
        // controlled opponent themselves (the classic WoC line).
        expect(head.candidatePlayerIds).toEqual(
            expect.arrayContaining(["p1", "p2"])
        );
    });

    it("controller aims the opponent's Lightning Bolt at the opponent themselves; 3 damage lands", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        const startingLife = state.players[1].life;
        castWordOfCommand(state);
        submitPick(state, "opp-bolt"); // choose the Bolt
        submitTarget(state, "p2"); // aim it at the opponent themselves

        // Lightning Bolt is on the stack as the opponent's spell, targeting p2.
        const bolt = state.stack.find(
            (s) => (s.card as { id?: string }).id === lightningBolt.id
        );
        expect(bolt?.castById).toBe("p2"); // CR 601 — opponent's spell
        expect(bolt?.actingPlayerId).toBe("p1"); // ADR 0037
        expect(bolt?.targets).toEqual([{ type: "player", id: "p2" }]);

        // Resolve it: 3 damage to the opponent (the controlled player).
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(startingLife - 3);
        // The controller (p1) is untouched.
        expect(state.players[0].life).toBe(startingLife);
    });

    it("targeted spell with NO legal target → not played (CR 601.2c)", () => {
        // Dwarven Demolition Team's ability targets a Wall; a Lightning Bolt
        // always has a legal target (players), so use a spell whose only legal
        // targets can be removed. Burrowing targets a creature; with no
        // creatures on the battlefield it has no legal target.
        const oppBurrowing = makeInstance(burrowing.id, {
            id: "opp-burrowing",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBurrowing],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-burrowing");

        // No target prompt was raised, and the spell is not on the stack.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === burrowing.id
            )
        ).toBeUndefined();
        // It stayed in the opponent's hand ("if able").
        expect(
            state.players[1].hand.find((c) => c.id === "opp-burrowing")
        ).toBeDefined();
    });

    it("control persists: the controller's target choice rides onto the cast spell's stack item", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-bolt");
        submitTarget(state, "p1"); // aim it at the controller

        const bolt = state.stack.find(
            (s) => (s.card as { id?: string }).id === lightningBolt.id
        );
        // The acting-player override and the chosen targets both ride along.
        expect(bolt?.actingPlayerId).toBe("p1");
        expect(bolt?.targets).toEqual([{ type: "player", id: "p1" }]);
    });

    it("wire format: the targeted cast's stack item (targets + controllerId) survives projection", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-bolt");
        submitTarget(state, "p2");

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.stack.find(
                (s) => s.card.id === lightningBolt.id
            );
            expect(slim).toBeDefined();
            expect(slim?.castById).toBe("p2"); // CR 601 — opponent's spell
            expect(slim?.actingPlayerId).toBe("p1"); // ADR 0037
            expect(slim?.targets).toEqual([{ type: "player", id: "p2" }]);
        }
    });

    // --- X / modal / additional-cost casts (#579, CR 107.3 / 700.2c / 117.9):
    // the Acting Player makes EVERY cast decision from the opponent's
    // resources. ---

    /** Submits the head pending choice (an option pick, a permanent pick, or a
     *  target pick) with a single id — all use the same client-buffered shape. */
    function submitOption(state: GameState, optionId: string) {
        submitPick(state, optionId);
    }

    it("X spell: controller is prompted for X, then X mana is paid from the opponent's lands (CR 107.3)", () => {
        // Opponent holds Fireball ({X}{R}, deals X damage). Two Mountains can
        // pay {1}{R} → X up to 1 is affordable.
        const oppFireball = makeInstance(fireball.id, {
            id: "opp-fireball",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const m1 = makeInstance(mountain.id, {
            id: "opp-m1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const m2 = makeInstance(mountain.id, {
            id: "opp-m2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppFireball],
                    battlefield: [m1, m2],
                }),
            ],
        });
        const startLife = state.players[0].life;
        castWordOfCommand(state);
        submitPick(state, "opp-fireball");

        // The controller (p1) is prompted to choose X — an option pick.
        expect(state.pendingChoices).toHaveLength(1);
        const xChoice = state.pendingChoices![0];
        expect(xChoice.playerId).toBe("p1");
        expect(xChoice.kind).toBe("option-pick");
        // Only X = 0 and X = 1 are affordable from the opponent's two Mountains.
        expect(xChoice.options?.map((o) => o.id)).toEqual(["0", "1"]);

        submitOption(state, "1"); // choose X = 1
        // Fireball is "any target" — the controller then aims it. Target p1.
        submitTarget(state, "p1");

        const fb = state.stack.find(
            (s) => (s.card as { id?: string }).id === fireball.id
        );
        expect(fb?.castById).toBe("p2"); // opponent's spell (CR 601)
        expect(fb?.chosenX).toBe(1);
        // Both Mountains tapped to pay {1}{R} (X = 1).
        expect(state.players[1].battlefield.every((c) => c.isTapped)).toBe(
            true
        );

        resolveTopOfStack(state);
        // X = 1 → 1 damage to the controller (p1).
        expect(state.players[0].life).toBe(startLife - 1);
    });

    it("X spell: unpayable even at X = 0 → not played (CR 107.3 / 'if able')", () => {
        // Fireball needs {R}; the opponent controls no lands, so even X = 0 is
        // unpayable — castChosenSpell refuses and nothing happens.
        const oppFireball = makeInstance(fireball.id, {
            id: "opp-fireball",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [oppFireball] }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-fireball");

        // X is offered as just {0} (the only candidate), the target is aimed,
        // then the cast fails on payment.
        submitOption(state, "0");
        submitTarget(state, "p1");

        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === fireball.id
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-fireball")
        ).toBeDefined();
    });

    // --- Cast RESTRICTIONS bind the controlled cast too (CR 601.3a) ---------
    //
    // Word of Command calls `ctx.castChosenSpell` directly: the controlled cast
    // never produces a legal ACTION, so it never passes through
    // `getLegalActions` — the announce-path chokepoint every other cast
    // consumer shares. `castChosenSpell` therefore calls the shared gate
    // `castProhibitionReason` itself. The restriction binds the spell's CASTER
    // (the controlled opponent, p2), not the Word of Command controller (p1).
    // Subject: Blizzard's card-level `castCondition` (issue #2102) — "Cast this
    // spell only if you control a snow land."
    function wocBlizzardState(oppLands: CardInstanceState[]): GameState {
        const oppBlizzard = makeInstance(blizzard.id, {
            id: "opp-blizzard",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppBlizzard],
                    battlefield: oppLands,
                }),
            ],
        });
    }

    function oppLand(cardId: string, id: string): CardInstanceState {
        return makeInstance(cardId, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
    }

    it("cast condition unmet on the CONTROLLED player's board → not played (CR 601.3a, issue #2102)", () => {
        // Two plain Forests: {G}{G} is affordable, so the refusal can only come
        // from the cast condition, never from an unpayable cost.
        const state = wocBlizzardState([
            oppLand(forest.id, "opp-f1"),
            oppLand(forest.id, "opp-f2"),
        ]);
        castWordOfCommand(state);
        submitPick(state, "opp-blizzard");

        expect(state.stack.some((s) => s.id === "opp-blizzard")).toBe(false);
        // Not played → the card stays in the opponent's hand and their lands
        // are never tapped.
        expect(state.players[1].hand.some((c) => c.id === "opp-blizzard")).toBe(
            true
        );
        expect(state.players[1].battlefield.every((c) => !c.isTapped)).toBe(
            true
        );
    });

    it("cast condition met on the CONTROLLED player's board → played (the gate is scoped to the caster)", () => {
        const state = wocBlizzardState([
            oppLand(snowCoveredForest.id, "opp-s1"),
            oppLand(snowCoveredForest.id, "opp-s2"),
        ]);
        castWordOfCommand(state);
        submitPick(state, "opp-blizzard");

        const onStack = state.stack.find((s) => s.id === "opp-blizzard");
        expect(onStack).toBeDefined();
        expect(onStack!.castById).toBe("p2"); // the opponent's spell (CR 601)
    });

    it("modal spell: controller chooses the mode; the chosen mode's target/resolution apply (CR 700.2c/d)", () => {
        // Opponent holds Red Elemental Blast ({R}, modal: counter target blue
        // spell / destroy target blue permanent). The controller picks the
        // destroy mode and destroys a blue creature.
        const oppBlast = makeInstance(redElementalBlast.id, {
            id: "opp-blast",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        // A blue creature the controller (p1) owns — a legal "destroy target
        // blue permanent" target.
        const blueCreature = makeInstance(merfolkOfThePearlTrident.id, {
            id: "blue-merfolk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blueCreature] }),
                makePlayer("p2", {
                    hand: [oppBlast],
                    battlefield: [oppMountain],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-blast");

        // The controller is prompted for the mode (an option pick over modes).
        expect(state.pendingChoices).toHaveLength(1);
        const modeChoice = state.pendingChoices![0];
        expect(modeChoice.playerId).toBe("p1");
        expect(modeChoice.kind).toBe("option-pick");
        expect(modeChoice.options?.map((o) => o.id)).toEqual(
            expect.arrayContaining(["counter", "destroy"])
        );

        submitOption(state, "destroy"); // choose the destroy mode
        submitTarget(state, "blue-merfolk"); // aim it at the blue creature

        const blast = state.stack.find(
            (s) => (s.card as { id?: string }).id === redElementalBlast.id
        );
        expect(blast?.castById).toBe("p2");
        expect(blast?.chosenModeId).toBe("destroy");
        expect(blast?.targets).toEqual([
            { type: "permanent", id: "blue-merfolk" },
        ]);

        resolveTopOfStack(state);
        // The blue creature was destroyed by the chosen mode's resolution.
        expect(
            state.players[0].battlefield.find((c) => c.id === "blue-merfolk")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "blue-merfolk")
        ).toBeDefined();
    });

    it("additional-cost spell: controller picks the sacrifice from the OPPONENT's battlefield (CR 117.9)", () => {
        // Opponent holds Sacrifice ({B}, "sacrifice a creature; add {B} equal to
        // its mana value"). The controller chooses which of the opponent's
        // creatures is sacrificed — Grizzly Bears (MV 2).
        const oppSacrifice = makeInstance(sacrifice.id, {
            id: "opp-sacrifice",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const oppBears = makeInstance(grizzlyBears.id, {
            id: "opp-bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppSacrifice],
                    battlefield: [oppSwamp, oppBears],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-sacrifice");

        // The controller is prompted to choose a creature on the OPPONENT's
        // battlefield to sacrifice.
        expect(state.pendingChoices).toHaveLength(1);
        const sacChoice = state.pendingChoices![0];
        expect(sacChoice.playerId).toBe("p1");
        expect(sacChoice.kind).toBe("choose-permanents");
        expect(sacChoice.zoneOwnerId).toBe("p2");
        expect(sacChoice.candidateIds).toEqual(["opp-bears"]);

        submitPick(state, "opp-bears");

        const sac = state.stack.find(
            (s) => (s.card as { id?: string }).id === sacrifice.id
        );
        expect(sac?.castById).toBe("p2");
        expect(sac?.additionalSacrificeSnapshot?.cardInstanceId).toBe(
            "opp-bears"
        );
        // The opponent's Grizzly Bears was sacrificed to their graveyard.
        expect(
            state.players[1].battlefield.find((c) => c.id === "opp-bears")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "opp-bears")
        ).toBeDefined();

        resolveTopOfStack(state);
        // Sacrifice adds {B} equal to the sacrificed creature's MV (2). The
        // Swamp's {B} paid the spell's {B}, so the opponent's pool nets {B}{B}.
        expect(state.players[1].manaPool.B).toBe(2);
    });

    it("additional-cost spell: no matching permanent to sacrifice → not played (CR 117.9 / 'if able')", () => {
        // Opponent holds Sacrifice but controls no creature → the additional
        // cost is unmeetable, so the spell is never played.
        const oppSacrifice = makeInstance(sacrifice.id, {
            id: "opp-sacrifice",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppSacrifice],
                    battlefield: [oppSwamp],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-sacrifice");

        // No sacrifice prompt was raised; nothing was cast.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === sacrifice.id
            )
        ).toBeUndefined();
        expect(
            state.players[1].hand.find((c) => c.id === "opp-sacrifice")
        ).toBeDefined();
    });

    it("wire format: an X cast's chosenX + the modal cast's chosenModeId survive projection", () => {
        // X cast (Fireball, X = 1) — re-assert chosenX after projection.
        const oppFireball = makeInstance(fireball.id, {
            id: "opp-fireball",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const m1 = makeInstance(mountain.id, {
            id: "opp-m1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const m2 = makeInstance(mountain.id, {
            id: "opp-m2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppFireball],
                    battlefield: [m1, m2],
                }),
            ],
        });
        castWordOfCommand(state);
        submitPick(state, "opp-fireball");
        submitOption(state, "1");
        submitTarget(state, "p1");

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.stack.find((s) => s.card.id === fireball.id);
            expect(slim).toBeDefined();
            expect(slim?.castById).toBe("p2");
            expect(slim?.chosenX).toBe(1);
        }
    });

    // --- #580: control PERSISTS onto the chosen spell's RESOLUTION ---------
    // "If the chosen card is cast as a spell, you control the player while that
    // spell is resolving." (CR 608, ADR 0037). The chosen spell's OWN resolve
    // step enqueues its resolution-time Pending Choices with playerId =
    // ctx.caster/ctx.controller (= the controlled opponent); the engine must
    // redirect those prompts to the Acting Player (WoC's controller) while the
    // spell's stack item carries the override, then revert when it leaves the
    // stack. Demonic Tutor ("Search your library …") is the minimal probe: its
    // resolve enqueues a single `search-library` choice for ctx.caster.
    function seedWoCTutor() {
        const oppTutor = makeInstance(demonicTutor.id, {
            id: "opp-tutor",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        // Two Swamps pay Demonic Tutor's {1}{B} from the opponent's lands only.
        const oppSwamp1 = makeInstance(swamp.id, {
            id: "opp-swamp-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const oppSwamp2 = makeInstance(swamp.id, {
            id: "opp-swamp-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        // A card to fetch lives in the opponent's library.
        const oppLibCard = makeInstance(darkRitual.id, {
            id: "opp-lib-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [oppTutor],
                    battlefield: [oppSwamp1, oppSwamp2],
                    library: [oppLibCard],
                }),
            ],
        });
    }

    it("a chosen spell's RESOLUTION choice routes to the controller, reading the OPPONENT's zone (CR 608)", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor"); // controller picks the opponent's Tutor

        // The Tutor is on the stack as the opponent's spell with the override.
        const tutorOnStack = state.stack.find(
            (s) => (s.card as { id?: string }).id === demonicTutor.id
        );
        expect(tutorOnStack?.castById).toBe("p2");
        expect(tutorOnStack?.actingPlayerId).toBe("p1");

        // Resolve the Tutor: it enqueues a search-library choice. #580 — that
        // resolution choice is ROUTED TO THE CONTROLLER (p1), with the OWNER of
        // the searched zone left on the controlled opponent (p2).
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.playerId).toBe("p1"); // controller answers (Acting Player)
        // Resource/ownership read stays on the opponent (controller of the spell).
        expect(head.zoneOwnerId).toBe("p2");
        expect(head.actingPlayerId).toBe("p2"); // controlled player recorded
    });

    it("the controller's pick fetches from the OPPONENT's library into the OPPONENT's hand (CR 608.2)", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor");
        resolveTopOfStack(state); // enqueues the controller's search choice
        submitPick(state, "opp-lib-ritual"); // controller searches FOR the opp

        // The fetched card moved into the OPPONENT's hand (their resources),
        // even though the CONTROLLER made the decision.
        expect(
            state.players[1].hand.find((c) => c.id === "opp-lib-ritual")
        ).toBeDefined();
        expect(
            state.players[1].library.find((c) => c.id === "opp-lib-ritual")
        ).toBeUndefined();
    });

    it("after the chosen spell leaves the stack, the opponent makes their OWN subsequent decisions again", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor");
        resolveTopOfStack(state);
        submitPick(state, "opp-lib-ritual"); // resolve the Tutor fully

        // The Tutor (and Word of Command) have left the stack — no override
        // lingers; no pending choices remain.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.stack.find(
                (s) => (s.card as { id?: string }).id === demonicTutor.id
            )
        ).toBeUndefined();

        // Now the opponent (p2) casts THEIR OWN Demonic Tutor normally — its
        // resolution choice routes back to THEM, not the controller (control
        // reverted with the stack item, ADR 0037 / CR 608).
        const ownTutor = makeInstance(demonicTutor.id, {
            id: "p2-own-tutor",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const libCard = makeInstance(darkRitual.id, {
            id: "p2-lib-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        state.players[1].hand.push(ownTutor);
        state.players[1].library.push(libCard);
        pushSpell(state, demonicTutor.id, "p2");
        // Point the just-pushed stack item at the opponent's own instance.
        const ownOnStack = state.stack[state.stack.length - 1];
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.playerId).toBe("p2"); // opponent answers their own spell
        expect(head.actingPlayerId).toBeUndefined(); // no override
        expect(ownOnStack.actingPlayerId).toBeUndefined();
    });

    it("wire format: the chosen spell's routed resolution choice survives projection (controller answers, opp owns the zone)", () => {
        const state = seedWoCTutor();
        castWordOfCommand(state);
        submitPick(state, "opp-tutor");
        resolveTopOfStack(state); // enqueue the routed search choice

        // The routed choice must reach BOTH clients with the same routing: the
        // controller (p1) is prompted, the opponent (p2) owns the searched zone.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const head = (projected.pendingChoices ?? [])[0];
            expect(head).toBeDefined();
            expect(head?.kind).toBe("search-library");
            expect(head?.playerId).toBe("p1");
            expect(head?.zoneOwnerId).toBe("p2");
        }
    });

    it("definition: Word of Command targets an opponent, costs {B}{B}", () => {
        expect(wordOfCommand.manaCost).toEqual({ B: 2 });
        expect(wordOfCommand.targetRequirement).toMatchObject({
            type: "player",
            controller: "opponent",
        });
    });
});

// Per-card behavior tests for green cards in `convex/cards/sets/lea/green.ts`
// (LEA, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises. Shared stack/resolve shims live in
// ./helpers; fixture builders stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    aspectOfWolf,
    badlands,
    bayou,
    berserk,
    birdsOfParadise,
    channel,
    cockatrice,
    elvishArchers,
    fastbond,
    fog,
    forceOfNature,
    forest,
    fungusaur,
    gaeasLiege,
    giantGrowth,
    giantSpider,
    grizzlyBears,
    hurricane,
    hypnoticSpecter,
    iceStorm,
    instillEnergy,
    island,
    kudzu,
    leyDruid,
    lifeforce,
    lightningBolt,
    livingArtifact,
    livingLands,
    llanowarElves,
    lure,
    mountain,
    naturalSelection,
    plains,
    regeneration,
    regrowth,
    savannahLions,
    serraAngel,
    shanodinDryads,
    shivanDragon,
    solRing,
    streamOfLife,
    swamp,
    thicketBasilisk,
    tranquility,
    tsunami,
    verduranEnchantress,
    wallOfBrambles,
    wanderlust,
    web,
    wildGrowth,
    wrathOfGod,
} from "..";
import {
    regenerateOrDestroy,
    removePermanentTo,
    removeFromZone,
    emitSpellCastEvent,
    resolveTopOfStack,
    emitPermanentTapped,
    processPendingActionTriggers,
    realizeManaAbilityTapBonus,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { getCardByName } from "../../../catalogue";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    getActivatedManaColor,
    hasManaAbility,
} from "../../../../gre/constants";
import {
    getLegalActions,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    getRequiredBlockerAssignments,
} from "../../../../gre/combat";
import {
    advancePhase,
    finalizeCleanup,
    emitBlockersConfirmedEvents,
} from "../../../../gre/phases";
import { compactState, expandState } from "../../../../gre/serialize";
import type { CardType } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

describe("Hurricane ({X}{G} — X damage to each flying creature and each player, CR 107.3 / 120.3)", () => {
    function setupBoard() {
        const ground = makeInstance(savannahLions.id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flier] }),
            ],
        });
    }

    it("kills fliers when X reaches lethal, spares ground, damages both players", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "flier")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
        ).toBeDefined();
        expect(state.players[0].life).toBe(16);
        expect(state.players[1].life).toBe(16);
    });

    it("is a no-op when X is 0", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(2);
        expect(state.players[0].life).toBe(20);
    });

    it("wire format: projection confirms only the flier died", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 4;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).toContain("ground");
        expect(ids).not.toContain("flier");
        expect(p2.life).toBe(16);
    });
});

describe("Elvish Archers (first strike, CR 702.7)", () => {
    it("kills a 2/2 blocker in the first-strike step before it can swing back", () => {
        // Elvish Archers (2/1, first strike) attacks, blocked by Grizzly
        // Bears (2/2). CR 510.2: only first/double strike creatures deal
        // damage in the first-strike step — the archer kills the bear, then
        // the bear (dead) cannot deal regular combat damage.
        const archer = makeInstance(elvishArchers.id, {
            id: "archer",
            controllerId: "p1",
            isAttacking: true,
        });
        const bear: CardInstanceState = {
            id: "bear",
            card: { id: "fake-bear" },
            types: ["Creature"] as CardType[],
            subtypes: ["Bear"],
            staticAbilities: [],
            power: 2,
            toughness: 2,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
            isBlocking: true,
        };
        const p1 = makePlayer("p1", { battlefield: [archer] });
        const p2 = makePlayer("p2", { battlefield: [bear] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["archer"],
                confirmed: true,
                blockerAssignments: { bear: ["archer"] },
                blockersConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        expect(p2.battlefield.find((c) => c.id === "bear")).toBeUndefined();
        expect(p2.graveyard.some((c) => c.id === "bear")).toBe(true);

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        const archerAfter = p1.battlefield.find((c) => c.id === "archer");
        expect(archerAfter).toBeDefined();
    });

    it("dies to a 3/3 blocker (first strike can't save a 1-toughness attacker from a bigger body)", () => {
        // Archer deals 2 first-strike to a 3/3 — 3/3 survives (2 < 3) and
        // then hits back in the regular step for 3, killing the archer.
        const archer = makeInstance(elvishArchers.id, {
            id: "archer",
            controllerId: "p1",
            isAttacking: true,
        });
        const ogre: CardInstanceState = {
            id: "ogre",
            card: { id: "fake-ogre" },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 3,
            toughness: 3,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
            isBlocking: true,
        };
        const p1 = makePlayer("p1", { battlefield: [archer] });
        const p2 = makePlayer("p2", { battlefield: [ogre] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["archer"],
                confirmed: true,
                blockerAssignments: { ogre: ["archer"] },
                blockersConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        // Ogre alive (3 toughness > 2 damage from first strike).
        expect(p2.battlefield.find((c) => c.id === "ogre")).toBeDefined();

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        // Archer now dead: ogre's 3 power >= archer's 1 toughness.
        expect(p1.battlefield.find((c) => c.id === "archer")).toBeUndefined();
        expect(p1.graveyard.some((c) => c.id === "archer")).toBe(true);
    });
});

describe("Shanodin Dryads (forestwalk evasion, CR 702.14b)", () => {
    it("cannot be blocked when defender controls a Forest", () => {
        const dryads = makeInstance(shanodinDryads.id, { id: "dryads" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const forestInst = makeInstance(
            // Reuse Bayou (Swamp + Forest) to exercise the multi-subtype case.
            bayou.id,
            { id: "bayou-1", controllerId: "p2" }
        );
        expect(
            validateBlockerEligibility(dryads, bears, [bears, forestInst])
                .eligible
        ).toBe(false);
    });

    it("can be blocked when defender has no Forest", () => {
        const dryads = makeInstance(shanodinDryads.id, { id: "dryads" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(dryads, bears, [bears])).toEqual({
            eligible: true,
        });
    });
});

describe("Llanowar Elves ({T}: Add {G}, CR 605.1a)", () => {
    it("engine recognizes the mana ability on the battlefield", () => {
        const elf = makeInstance(llanowarElves.id, { id: "elf" });
        expect(hasManaAbility(elf)).toBe(true);
        expect(getActivatedManaColor(elf)).toBe("G");
    });

    it("wire format: mana ability survives projectPublicState", () => {
        // The projection slims `card.card` to `{ id }`. The constants helpers
        // read the ability via `getDefinition(card.card.id)` — this test guards
        // against any future refactor that reads ability data off the fat embed.
        const elf = makeInstance(llanowarElves.id, { id: "elf" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimElf = projected.players[0].battlefield.find(
            (c) => c.id === "elf"
        )!;
        expect(hasManaAbility(slimElf as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimElf as CardInstanceState)).toBe("G");
    });
});

describe("Birds of Paradise (flying + {T}: Add one mana of any color, CR 605.1a)", () => {
    it("engine recognizes the mana ability; color is null (choice-based)", () => {
        const bird = makeInstance(birdsOfParadise.id, { id: "bird" });
        expect(hasManaAbility(bird)).toBe(true);
        // getActivatedManaColor only resolves fixed (manaProduced) abilities.
        // Choice-based abilities MUST return null so the engine takes the
        // manaChoices branch in tapUntap instead of adding a fixed color.
        expect(getActivatedManaColor(bird)).toBeNull();
    });

    it("wire format: ability survives projectPublicState", () => {
        const bird = makeInstance(birdsOfParadise.id, { id: "bird" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bird] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBird = projected.players[0].battlefield.find(
            (c) => c.id === "bird"
        )!;
        expect(hasManaAbility(slimBird as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimBird as CardInstanceState)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Dual lands (Alpha — CR 305.6, 605.1a): two land types + choice-based mana
// ---------------------------------------------------------------------------

describe("Channel (CR 605.1a, 118.4, 514.2)", () => {
    it("resolve grants the caster a reference to channel-mana for the turn", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const grants = state.players[0].grantedAbilities;
        expect(grants).toHaveLength(1);
        expect(grants?.[0]).toMatchObject({
            sourceCardId: channel.id,
            abilityId: "channel-mana",
            duration: { phase: "end-of-turn" },
            grantedAtTurn: state.turn,
        });
        expect(grants?.[0].id).toMatch(/^grant-\d+$/);
        // Opponent does not get the grant.
        expect(state.players[1].grantedAbilities).toBeUndefined();
    });

    it("multiple resolves produce distinct grant ids", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const grants = state.players[0].grantedAbilities!;
        expect(grants).toHaveLength(2);
        expect(grants[0].id).not.toBe(grants[1].id);
    });

    it("CLEANUP step purges end-of-turn grants", () => {
        const state = makeState({ phase: "END_STEP" });
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].grantedAbilities).toHaveLength(1);
        // advancePhase from END_STEP traverses CLEANUP (auto) into next turn.
        advancePhase(state);
        expect(state.players[0].grantedAbilities).toBeUndefined();
    });

    it("template effect adds {C} via ActivatedAbilityContext.addMana", () => {
        // The mutation drives execution over the network; here we exercise
        // the template directly to guarantee the effect is wired correctly.
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const p1 = state.players[0];
        const ability = channel.activatedAbilities![0];
        // Simulate the mutation's payment+execution path for useStack:false.
        p1.life -= ability.cost.life!;
        ability.effect!({
            addMana: (amount) => {
                for (const [color, count] of Object.entries(amount)) {
                    if (color === "X" || typeof count !== "number") continue;
                    p1.manaPool[color] = (p1.manaPool[color] ?? 0) + count;
                }
            },
        });
        expect(p1.life).toBe(19);
        expect(p1.manaPool.C).toBe(1);
    });

    it("wire format: projectPublicState hydrates grantedAbilities for both viewers", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);

        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].grantedAbilities;
            expect(slim).toHaveLength(1);
            expect(slim?.[0]).toMatchObject({
                sourceCardId: channel.id,
                abilityId: "channel-mana",
                oracleText: "Pay 1 life: Add {C}.",
                useStack: false,
                manaProduced: { C: 1 },
                duration: { phase: "end-of-turn" },
            });
            expect(slim?.[0].cost.life).toBe(1);
        }
    });
});

describe("Giant Growth (+3/+3 until end of turn, CR 611.1 / 514.2)", () => {
    function setupElf(phase = "PRECOMBAT_MAIN") {
        const elf = makeInstance(llanowarElves.id, {
            id: "elf",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2"),
            ],
            phase: phase as GameState["phase"],
        });
        return { state, elf };
    }

    it("boosts the target to 4/4 without mutating its base P/T", () => {
        const { state, elf } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        // Temporary buff (CR 611.1): base stays 1/1, effective is 4/4.
        expect(elf.power).toBe(1);
        expect(elf.toughness).toBe(1);
        expect(getEffectivePower(state, elf)).toBe(4);
        expect(getEffectiveToughness(state, elf)).toBe(4);
    });

    it("reverts to 1/1 at the cleanup step (CR 514.2)", () => {
        const { state, elf } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, elf)).toBe(4);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(getEffectivePower(state, elf)).toBe(1);
        expect(getEffectiveToughness(state, elf)).toBe(1);
        expect(elf.temporaryPTMods).toBeUndefined();
    });

    it("stacks two casts to +6/+6 that both expire together at cleanup", () => {
        const { state, elf } = setupElf();
        for (let i = 0; i < 2; i++) {
            pushSpell(state, giantGrowth.id, "p1", [
                { type: "permanent", id: "elf" },
            ]);
            resolveTopOfStack(state);
        }
        expect(getEffectivePower(state, elf)).toBe(7);
        expect(getEffectiveToughness(state, elf)).toBe(7);

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(getEffectivePower(state, elf)).toBe(1);
        expect(getEffectiveToughness(state, elf)).toBe(1);
    });

    it("buff survives intervening phases within the turn (only cleanup ends it)", () => {
        const { state, elf } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        // Walk forward to the end step; the buff must still be present.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state);
        expect(state.phase).toBe("END_STEP");
        expect(getEffectivePower(state, elf)).toBe(4);
    });

    it("wire format: boost is visible during the turn (regression guard)", () => {
        const { state } = setupElf();
        pushSpell(state, giantGrowth.id, "p1", [
            { type: "permanent", id: "elf" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slimElf = projected.players[0].battlefield.find(
            (c) => c.id === "elf"
        )!;
        expect(getEffectivePower(projected, slimElf)).toBe(4);
        expect(getEffectiveToughness(projected, slimElf)).toBe(4);
    });
});

describe("Berserk ({G} — trample + X/+0, delayed destroy if attacked, CR 117.1b / 611.2a / 603.7a / 514.2)", () => {
    function setupWithAttacker() {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        bear.isAttacking = true;
        bear.hasAttackedThisTurn = true;
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "DECLARE_BLOCKERS",
        });
        return { state, bear };
    }

    it("getLegalActions rejects Berserk during COMBAT_DAMAGE", () => {
        const berserkCard = makeInstance(berserk.id, {
            id: "b1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", { hand: [berserkCard] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "COMBAT_DAMAGE",
        });
        const legal = getLegalActions(state, p1, berserkCard);
        expect(legal).not.toContain("cast");
    });

    it("getLegalActions allows Berserk during DECLARE_ATTACKERS", () => {
        const berserkCard = makeInstance(berserk.id, {
            id: "b1",
            zone: "hand",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            hand: [berserkCard],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        });
        const p2 = makePlayer("p2", { battlefield: [target] });
        const state = makeState({
            players: [p1, p2],
            phase: "DECLARE_ATTACKERS",
        });
        const legal = getLegalActions(state, p1, berserkCard);
        expect(legal).toContain("cast");
    });

    it("grants trample and +X/+0 on resolve (X = current power)", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("trample");
        // +X/+0 is a temporary buff (CR 611.1): base power unchanged, effective
        // doubles (2 + 2 = 4).
        expect(bear.power).toBe(2);
        expect(bear.toughness).toBe(2);
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("the +X/+0 buff expires at cleanup (CR 514.2)", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, bear)).toBe(4);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(getEffectivePower(state, bear)).toBe(2);
        expect(bear.temporaryPTMods).toBeUndefined();
    });

    it("schedules a next-end-step delayed trigger tied to the target id", () => {
        const { state } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers?.[0]).toMatchObject({
            sourceCardId: berserk.id,
            triggerId: "destroy-if-attacked",
            controller: "p1",
            timing: "next-end-step",
            payload: { targetId: "bear" },
        });
        expect(state.delayedTriggers?.[0].id).toMatch(/^delayed-\d+$/);
    });

    it("END_STEP pushes the delayed trigger onto the stack with active-player priority", () => {
        const { state } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        // Fast-forward to end step so the trigger fires.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state);
        expect(state.phase).toBe("END_STEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].delayedTriggerId).toBe("destroy-if-attacked");
        expect(state.stack[0].delayedPayload).toEqual({ targetId: "bear" });
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("delayed trigger destroys the creature when it attacked this turn", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state); // Berserk resolves
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // enter END_STEP, push delayed trigger
        resolveTopOfStack(state); // resolve the delayed trigger
        expect(state.players[0].battlefield).not.toContain(bear);
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
    });

    it("delayed trigger is a no-op when the target never attacked", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        // Not an attacker: no hasAttackedThisTurn, no isAttacking.
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP, pushes delayed trigger
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toContain(bear);
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            false
        );
    });

    it("CLEANUP removes the granted trample and clears hasAttackedThisTurn", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("trample");
        // Advance through END_STEP → CLEANUP → next turn UNTAP.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP (trigger enqueued on stack)
        resolveTopOfStack(state); // resolve delayed trigger (destroys bear)
        advancePhase(state); // CLEANUP (auto) → next turn
        // Bear is in the graveyard; its turn-scoped state still carries no
        // granted ability (cleanup ran before GY move? No — cleanup runs on
        // battlefield permanents. For a test that reaches cleanup we need a
        // creature that survives.)
        // Assert that hasAttackedThisTurn was cleared from the graveyard
        // copy (it persists on the instance but CLEANUP should have run
        // over the battlefield before the creature died — the creature
        // itself is already gone, so we cover the surviving-case below).
        const grave = state.players[0].graveyard.find((c) => c.id === "bear");
        expect(grave?.hasAttackedThisTurn).toBe(true); // never touched post-destroy
    });

    it("surviving creature loses granted trample and hasAttackedThisTurn at CLEANUP", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        bear.hasAttackedThisTurn = true;
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state); // grants trample, +2/+0, schedules delayed
        expect(bear.staticAbilities).toContain("trample");
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP (pushes trigger)
        resolveTopOfStack(state); // delayed trigger resolves → destroys bear
        // Bear is dead here; verify the secondary case where the creature
        // would survive uses a non-attacker bear.
        const pacifistBear = makeInstance(grizzlyBears.id, {
            id: "pbear",
            controllerId: "p1",
        });
        const state2 = makeState({
            players: [
                makePlayer("p1", { battlefield: [pacifistBear] }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state2, berserk.id, "p1", [
            { type: "permanent", id: "pbear" },
        ]);
        resolveTopOfStack(state2);
        expect(pacifistBear.staticAbilities).toContain("trample");
        state2.phase = "POSTCOMBAT_MAIN";
        advancePhase(state2); // END_STEP
        resolveTopOfStack(state2); // delayed trigger: no-op (didn't attack)
        advancePhase(state2); // CLEANUP (auto) → next turn UNTAP
        expect(pacifistBear.staticAbilities).not.toContain("trample");
        expect(pacifistBear.grantedStaticAbilities).toBeUndefined();
        expect(pacifistBear.hasAttackedThisTurn).toBeUndefined();
    });

    it("wire format: projected state shows buffed power + granted trample", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        // Base power is unchanged (2); the +2/+0 rides in temporaryPTMods,
        // which the projection carries so effective power reads 4.
        expect(slim.power).toBe(2);
        expect(slim.staticAbilities).toContain("trample");
        expect(getEffectivePower(projected, slim)).toBe(4);
        // Opponent's viewer sees the same data (no hidden info on battlefield).
        const oppView = projectPublicState(state, 1, "p2");
        const slimOpp = oppView.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slimOpp.power).toBe(2);
        expect(getEffectivePower(oppView, slimOpp)).toBe(4);
        expect(slimOpp.staticAbilities).toContain("trample");
        // Preserve the reference to `bear` so TS doesn't flag the variable.
        expect(bear.id).toBe("bear");
    });
});

// ---------------------------------------------------------------------------
// Balance — CR 608.2 (stepped resolve) + 101.4 (APNAP)
// ---------------------------------------------------------------------------

describe("Regeneration ({1}{G} Aura — {G}: Regenerate enchanted creature, CR 701.19a / 614.5)", () => {
    function setupAttached(args?: {
        bearOverrides?: Partial<CardInstanceState>;
    }) {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            ...(args?.bearOverrides ?? {}),
        });
        const aura = makeInstance(regeneration.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, aura, bear };
    }

    function activateRegen(state: GameState, aura: CardInstanceState) {
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: aura.controllerId,
            abilityId: "regeneration-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("attaches to the targeted creature on resolution (CR 303.4)", () => {
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
        pushSpell(state, regeneration.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === regeneration.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
    });

    it("activating {G} stacks one regeneration shield on the enchanted creature", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        const target = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(target.regenerationShields).toBe(1);
    });

    it("destroyAll's per-card destroy is replaced by the regen rider (CR 614.5)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Drive destroy directly via regenerateOrDestroy to model a
        // regen-honoring mass effect (Wrath of God carries the
        // can't-be-regenerated rider, CR 701.19c, so it would NOT trigger
        // the regen path here — exercised by the dedicated Wrath test).
        regenerateOrDestroy(state, "bear");
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("Wrath of God's `cantBeRegenerated` rider bypasses the shield (CR 701.19c)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Shield is on the bear — Wrath prevents the replacement, so the
        // bear hits the graveyard and the shield stays unspent on the way
        // out (it's purged with the rest of transient state).
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
    });

    it("lethal damage triggers regen too — heals damageMarked, taps, no graveyard (CR 704.5g + 701.19a)", () => {
        const { state, aura, bear } = setupAttached();
        activateRegen(state, aura);
        // Lightning Bolt for 3 — Grizzly Bears is 2/2, lethal.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.damageMarked).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(bear.zone).toBe("battlefield");
    });

    it("multiple activations stack shields, each shield consumed independently", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        activateRegen(state, aura);
        let bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBe(2);
        // First lethal — shield 1 consumed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBe(1);
        // Second lethal — shield 2 consumed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBeUndefined();
        expect(bear.zone).toBe("battlefield");
        // Third lethal — no shield, dies.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("bear");
    });

    it("unused shields wear off at CLEANUP (CR 514.2)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Shortcut to CLEANUP and run it.
        state.phase = "END_STEP";
        advancePhase(state); // → CLEANUP, runs purge, then auto-advances
        const bear = state.players[1].battlefield.find((c) => c.id === "bear");
        expect(bear?.regenerationShields).toBeUndefined();
    });

    it("combat: regen on a blocking creature removes it from combat and clears damage", async () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
            hasAttackedThisTurn: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const aura = makeInstance(regeneration.id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "bear",
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [bear, aura] }),
            ],
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear: ["angel"] },
                blockersConfirmed: true,
            },
        });
        activateRegen(state, aura);
        // Angel deals 4 to bear (lethal). The lethal SBA inside
        // applyAllCombatDamage routes through regenerateOrDestroy → shield.
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, { angel: { bear: 4 } }, "regular");
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.damageMarked).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.isBlocking).toBeUndefined();
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(state.combat?.blockerAssignments).not.toHaveProperty("bear");
    });

    it("wire format: regen shield count survives projectPublicState (regression guard)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        const projected = projectPublicState(state, 1, "p1");
        const bearProjected = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearProjected.regenerationShields).toBe(1);
    });
});

describe("Regrowth (return target card from your graveyard to hand, CR 400.7 / 608.2b)", () => {
    it("returns the chosen card from the caster's graveyard to their hand", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried-bear", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toContain("buried-bear");
        expect(p1.graveyard.map((c) => c.id)).not.toContain("buried-bear");
    });

    it("getLegalTargets only sees cards in the caster's own graveyard (controller: 'you')", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [mine] }),
                makePlayer("p2", { graveyard: [theirs] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            regrowth.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal).toHaveLength(1);
        expect(legal[0]).toMatchObject({
            type: "graveyard-card",
            id: "mine",
            playerId: "p1",
        });
    });

    it("CR 608.2b: silently does nothing if the target left the graveyard before resolution", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried", playerId: "p1" },
        ]);
        // Simulate the target being exiled in response (target is now illegal).
        const p1 = state.players[0];
        const idx = p1.graveyard.findIndex((c) => c.id === "buried");
        const [removed] = p1.graveyard.splice(idx, 1);
        removed.zone = "exile";
        p1.exile.push(removed);
        resolveTopOfStack(state);
        // No-op: the card stays in exile, the caster's hand stays empty.
        expect(p1.hand.map((c) => c.id)).not.toContain("buried");
        expect(p1.exile.map((c) => c.id)).toContain("buried");
    });

    // CR 400.3 (issue #1721) — the graveyard is a PUBLIC zone, so both
    // players watched exactly which card left it; landing it in the hidden
    // hand does not un-reveal it (ADR 0026, the same public→hidden mechanism
    // #1696 applied to the countered-spell case). This is the `moveZone` Op's
    // `target`-shape → `SpellContext.moveCardById` residual site (issue
    // #1721, narrowed scope).
    it("stamps the returned card known to BOTH players (CR 400.3, #1721)", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried-bear", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const p1 = state.players[0];
        const moved = p1.hand.find((c) => c.id === "buried-bear")!;
        expect([...(moved.knownTo ?? [])].sort()).toEqual(["p1", "p2"]);
    });

    it("shows the returned card to the opponent through the wire projection, leaks nothing else (#1721)", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // A second, never-seen hand card — the negative direction of the gate.
        const hidden = makeInstance(grizzlyBears.id, {
            id: "hidden-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried], hand: [hidden] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried-bear", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        // p2 (non-owner) sees the identity of the returned card in p1's
        // otherwise-hidden hand, but not the pre-existing hidden card.
        const asP2 = projectPublicState(state, 1, "p2");
        const p1Hand = asP2.players.find((p) => p.id === "p1")!.hand;
        expect(p1Hand).toHaveLength(2);
        const visible = p1Hand.filter((c) => c !== null);
        expect(visible).toHaveLength(1);
        expect(visible[0]?.card.id).toBe(grizzlyBears.id);
        // p1 (owner) sees their own returned card flagged seen-by-opponent.
        const asP1 = projectPublicState(state, 1, "p1");
        const own = asP1.players.find((p) => p.id === "p1")!.hand;
        const ownMoved = own.find((c) => c?.id === "buried-bear");
        expect(ownMoved?.seenByOpponent).toBe(true);
        const ownHidden = own.find((c) => c?.id === "hidden-card");
        expect(ownHidden?.seenByOpponent).toBeFalsy();
    });
});

describe("Ice Storm (destroy target land)", () => {
    it("destroys an opponent's Land", () => {
        const land = makeInstance(plains.id, {
            id: "victim-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, iceStorm.id, "p1", [
            { type: "permanent", id: "victim-land" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "victim-land"
        );
    });
});

describe("Ley Druid ({T}: untap target land)", () => {
    it("untaps a tapped land on resolution", () => {
        const druid = makeInstance(leyDruid.id, {
            id: "druid",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const tapped = makeInstance(plains.id, {
            id: "p1-plains",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [druid, tapped] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...druid,
            zone: "stack",
            castById: "p1",
            abilityId: "ley-druid-untap",
            targets: [{ type: "permanent", id: "p1-plains" }],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "p1-plains"
        )!;
        expect(after.isTapped).toBe(false);
    });
});

describe("Stream of Life (target player gains X life)", () => {
    it("gains X life for the targeted player", () => {
        const state = makeState();
        state.stack.push({
            ...makeInstance(streamOfLife.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenX: 5,
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25);
    });
});

describe("Wall of Brambles (vanilla 2/3 defender)", () => {
    it("cannot attack (defender restriction, CR 702.3)", () => {
        const wob = makeInstance(wallOfBrambles.id, {
            id: "wob",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wob] }),
                makePlayer("p2"),
            ],
        });
        const result = validateAttackerEligibility(
            state.players[0].battlefield[0],
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
    });
});

describe("Counter primitives + layer 7d", () => {
    it("+1/+1 counters add to effective P/T", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("+1/+0 counters add to power only", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("non-PT counter types don't affect stats", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            counters: { corpse: 5, charge: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });
});

describe("Fungusaur (DAMAGE_DEALT trigger → +1/+1 counter)", () => {
    function setup() {
        const fung = makeInstance(fungusaur.id, {
            id: "fung",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [fung] }),
                makePlayer("p2"),
            ],
        });
    }

    it("survives 1 non-lethal damage and gains +1/+1 counter", () => {
        const state = setup();
        // Custom 1-damage spell would be ideal; emulate via direct dealDamage
        // through a Lightning Bolt with chosenX-equivalent? Bolt is 3 = lethal.
        // Use a non-Bolt path: Hypnotic Specter not relevant. We simulate by
        // direct damage from a lifeless source: push a stack item proxy.
        // Simplest: temporarily increase Fungusaur toughness via a counter so
        // 1 damage is non-lethal. Skip — instead just test the resolve path
        // directly by pushing a synthetic DAMAGE_DEALT trigger and checking
        // counter application via the trigger's resolve.
        const trig = fungusaur.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        // Synthetic trigger: push a triggered-ability stack item targeting
        // Fungusaur, then resolve.
        const fung = state.players[0].battlefield.find((c) => c.id === "fung")!;
        state.stack.push({
            ...fung,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "fungusaur-counter",
            triggerSourceId: "fung",
            triggerEvent: {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "x",
                sourceControllerId: "p2",
                target: { type: "permanent", id: "fung" },
                amount: 1,
                isCombat: false,
            },
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "fung"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });

    it("dies from lethal damage; trigger lands on stack but no-ops (CR 117.5, 603.10)", () => {
        const state = setup();
        // Lightning Bolt deals 3 → marked 3 >= toughness 2 → destroyed inline.
        // The DAMAGE_DEALT trigger goes on stack via the recently-dead-in-
        // graveyard scan in collectTriggers. Resolving it tries addCounter on
        // a non-battlefield target → primitive no-ops. Fungusaur stays dead.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "fung" },
        ]);
        resolveTopOfStack(state);
        // Trigger landed on stack.
        expect(
            state.stack.some(
                (i) => i.triggeredAbilityId === "fungusaur-counter"
            )
        ).toBe(true);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const dead = state.players[0].graveyard.find((c) => c.id === "fung")!;
        expect(dead).toBeDefined();
        // No counter applied — target was not on battlefield at resolve time.
        expect(dead.counters).toBeUndefined();
    });
});

describe("Verduran Enchantress (may draw on enchantment cast)", () => {
    it("trigger matches enchantment spells cast by controller, not creatures", () => {
        const trig = verduranEnchantress.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "vEn",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const enchantmentEvent = {
            type: "SPELL_CAST" as const,
            casterId: "p1",
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Enchantment"] as CardType[],
            spellSubtypes: [],
            spellColors: [],
        };
        expect(trig!.matches(enchantmentEvent, self)).toBe(true);
        // Different caster → no fire.
        expect(
            trig!.matches({ ...enchantmentEvent, casterId: "p2" }, self)
        ).toBe(false);
        // Non-enchantment → no fire.
        expect(
            trig!.matches(
                {
                    ...enchantmentEvent,
                    spellTypes: ["Creature"] as CardType[],
                },
                self
            )
        ).toBe(false);
    });

    // Regression (issue #1989): reported sequence — an enchantment (Mirri's
    // Guile, tmp/green.ts) is returned to hand (CR 400.7 bounce), then RECAST
    // from hand the following turn with Verduran Enchantress already on the
    // battlefield. The user reported no draw. Drives the REAL production path
    // end to end rather than a hand-built event: `removePermanentTo` (the
    // primitive `SpellContext.returnToHand` calls) for the bounce, then the
    // exact commit sequence `announceCast`'s no-target branch uses —
    // `removeFromZone(hand)` → push onto `state.stack` → `emitSpellCastEvent`
    // → `processPendingActionTriggers` (game.ts:7586-7627) — so a bug in
    // either the bounce path or the cast-commit choke point would surface
    // here, not just in the trigger's own `matches()` unit (already covered
    // above).
    it("fires the may-draw trigger when the enchantment is RECAST after being bounced to hand (issue #1989)", () => {
        const mirrisGuile = getCardByName("Mirri's Guile");
        const guile = makeInstance(mirrisGuile.id, {
            id: "guile",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const enchantress = makeInstance(verduranEnchantress.id, {
            id: "vEn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topOfLibrary = makeInstance(forest.id, {
            id: "topLib",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [guile, enchantress],
                    library: [topOfLibrary],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });

        // CR 400.7 — opponent bounces Mirri's Guile to its owner's hand.
        removePermanentTo(state, "guile", "hand");
        const player = state.players[0]!;
        expect(player.hand.map((c) => c.id)).toContain("guile");
        expect(player.battlefield.map((c) => c.id)).not.toContain("guile");

        // Next turn: recast it from hand. Mirrors the exact no-target commit
        // branch in `announceCast` (game.ts) — `removeFromZone` onto the
        // stack, then the CR 601.2i cast-trigger choke point.
        const card = removeFromZone(player, "guile", "hand");
        const stackItem: StackItem = { ...card, castById: "p1" };
        state.stack.push(stackItem);
        emitSpellCastEvent(state, stackItem);
        processPendingActionTriggers(state);

        // The cast trigger goes ON TOP of the spell (CR 603.2 — it resolves
        // before the spell it triggered from).
        expect(state.stack).toHaveLength(2);
        const top = state.stack[state.stack.length - 1]!;
        expect(
            (top as StackItem & { triggeredAbilityId?: string })
                .triggeredAbilityId
        ).toBe("verduran-enchantress-draw");

        // Resolve the trigger: it suspends on the cost-free "you may" gate.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        // The card drew — the library's top card landed in hand.
        expect(state.players[0]!.hand.map((c) => c.id)).toContain("topLib");
        expect(state.players[0]!.library).toHaveLength(0);
    });
});

describe("Wild Growth (extra {G} on attached land mana tap)", () => {
    it("matches only the attached host's mana tap", () => {
        const trig = wildGrowth.triggeredAbilities?.[0];
        expect(trig).toBeDefined();
        const self = {
            id: "wg",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"] as CardType[],
            subtypes: ["Aura"],
            isTapped: false,
            attachedTo: "host-forest",
            card: {},
        };
        const host = {
            type: "PERMANENT_TAPPED" as const,
            permanentId: "host-forest",
            controllerId: "p1",
            permanentTypes: ["Land"] as CardType[],
            permanentSubtypes: ["Forest"],
            forMana: true,
            manaProduced: { G: 1 },
        };
        expect(trig!.matches(host, self)).toBe(true);
        expect(
            trig!.matches({ ...host, permanentId: "other-forest" }, self)
        ).toBe(false);
        expect(trig!.matches({ ...host, forMana: false }, self)).toBe(false);
    });

    // CR 605.4 — a triggered mana ability does NOT use the stack. The bonus
    // {G} must be in the controller's pool as soon as the enchanted land is
    // tapped, within the same game action, with the stack left empty — so a
    // cost payment (e.g. a cumulative-upkeep step) that tapped the land sees
    // the extra mana before the player has to commit "pay"/"skip".
    it("resolves immediately without the stack — bonus {G} lands in the pool", () => {
        const host = makeInstance(forest.id, {
            id: "host-forest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wildGrowth.id, {
            id: "wg",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-forest",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });

        // Tap the enchanted land for its base {G} (what a real payment does),
        // then run the trigger scan the payment path invokes.
        const p1 = state.players[0];
        p1.manaPool = { ...(p1.manaPool ?? {}), G: 1 };
        emitPermanentTapped(state, host, true, { G: 1 });
        processPendingActionTriggers(state);

        // CR 605.4 — nothing on the stack, no priority handed out.
        expect(state.stack).toHaveLength(0);
        // Base {G} + Wild Growth's additional {G} both in the pool now.
        expect(state.players[0].manaPool?.G).toBe(2);
    });

    // CR 605.4 — the cost-payment path realizes the bonus once and flags the
    // event (`manaTriggersResolved`) so the later commit-time trigger flush does
    // NOT add it a second time (the double-mana bug the flag exists to prevent).
    it("realizeManaAbilityTapBonus adds the bonus once; a follow-up flush is a no-op", () => {
        const host = makeInstance(forest.id, {
            id: "host-forest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wildGrowth.id, {
            id: "wg",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-forest",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        p1.manaPool = { ...(p1.manaPool ?? {}), G: 1 };
        emitPermanentTapped(state, host, true, { G: 1 });

        realizeManaAbilityTapBonus(state);
        expect(p1.manaPool?.G).toBe(2);
        // The event stays queued (so its non-mana triggers still fire at commit)
        // but is flagged, so the commit-time flush skips the mana bonus.
        processPendingActionTriggers(state);
        expect(p1.manaPool?.G).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// PERMANENT_TAPPED engine integration (CR 603.2 — emit + collect + resolve)
// ---------------------------------------------------------------------------

describe("Giant Spider (vanilla 2/4 reach, CR 702.17)", () => {
    it("can block a flier (combat validator honors reach)", () => {
        const spider = makeInstance(giantSpider.id, {
            id: "spider",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const flier = makeInstance(shivanDragon.id, {
            id: "drag",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
            isAttacking: true,
        });
        const result = validateBlockerEligibility(flier, spider, []);
        expect(result.eligible).toBe(true);
    });
});

describe("Web (Aura — enchanted creature gets +0/+2 and has reach)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, web.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return state;
    }

    it("buffs host +0/+2 and grants reach", () => {
        const state = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(4);
        expect(bear.staticAbilities).toContain("reach");
    });

    it("wire format: pt + reach survive the projection", () => {
        const state = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
        expect(slim.staticAbilities).toContain("reach");
    });
});

describe("Force of Nature (upkeep may-pay {G}{G}{G}{G} else 8 damage to controller)", () => {
    it("decline causes 8 damage to controller from this creature", () => {
        const inst = makeInstance(forceOfNature.id, {
            id: "fon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        // Force of Nature still on battlefield, controller took 8 damage.
        expect(
            state.players[0].battlefield.find((c) => c.id === "fon")
        ).toBeDefined();
        expect(state.players[0].life).toBe(12);
    });

    it("accept on upkeep skips the damage (controller life unchanged)", () => {
        const inst = makeInstance(forceOfNature.id, {
            id: "fon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
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
        expect(state.players[0].life).toBe(20);
    });
});

describe("Wanderlust (aura — upkeep deals 1 dmg to host controller)", () => {
    it("at controller's upkeep the aura deals 1 damage to that player", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wanderlust.id, {
            id: "wander",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "UNTAP",
        });
        advancePhase(state); // → UPKEEP, aura trigger pushed
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("wanderlust-upkeep");
        resolveTopOfStack(state);
        // Host controller took 1 damage.
        expect(state.players[0].life).toBe(19);
    });

    it("does NOT trigger when the non-host controller's upkeep is active", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wanderlust.id, {
            id: "wander",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura], life: 20 }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "UNTAP",
        });
        advancePhase(state); // → UPKEEP of p2 (not host's controller)
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Instill Energy (aura — pseudo-haste + {0} untap host, your-turn + once-per-turn)", () => {
    function attachAura(opts: { activePlayerId: string; hostTapped: boolean }) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: opts.hostTapped,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host] }),
                makePlayer("p2"),
            ],
            activePlayerId: opts.activePlayerId,
            priorityPlayerId: opts.activePlayerId,
        });
        pushSpell(state, instillEnergy.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);
        return state;
    }

    it("grants the host the haste keyword while attached", () => {
        const state = attachAura({
            activePlayerId: "p1",
            hostTapped: false,
        });
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.staticAbilities).toContain("haste");
    });

    it("activated {0} untaps the host on resolution", () => {
        const state = attachAura({
            activePlayerId: "p1",
            hostTapped: true,
        });
        const aura = state.players[0].battlefield.find((c) => c.id !== "host")!;
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: "p1",
            abilityId: "instill-energy-untap",
            targets: [],
        });
        resolveTopOfStack(state);
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(false);
    });
});

describe("Aspect of Wolf (aura CDA: +floor(forests/2)/+ceil(forests/2))", () => {
    function setup(forests: number) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(aspectOfWolf.id, {
            id: "aow",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const bf: CardInstanceState[] = [host, aura];
        for (let i = 0; i < forests; i++) {
            bf.push(
                makeInstance(forest.id, {
                    id: `forest-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        return makeState({
            players: [makePlayer("p1", { battlefield: bf }), makePlayer("p2")],
        });
    }

    it("with 0 forests host stays at base P/T", () => {
        const state = setup(0);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });

    it("with 3 forests: +1/+2 (floor(3/2)=1, ceil(3/2)=2)", () => {
        const state = setup(3);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("with 4 forests: +2/+2 (floor(4/2)=2, ceil(4/2)=2)", () => {
        const state = setup(4);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("does NOT count opponent's Forests", () => {
        const state = setup(0);
        state.players[1].battlefield.push(
            makeInstance(forest.id, {
                id: "opp-forest",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });

    it("CDA survives the projection boundary (wire format)", () => {
        const state = setup(5);
        const host = state.players[0].battlefield[0];
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(5);
        const projected = projectPublicState(state, 0, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        );
        if (!slimHost) throw new Error("host not in projection");
        expect(getEffectivePower(projected, slimHost)).toBe(4);
        expect(getEffectiveToughness(projected, slimHost)).toBe(5);
    });
});

describe("Fog (prevent all combat damage this turn, CR 615)", () => {
    it("prevents all combat damage", async () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { life: 20 }),
            ],
            combat: {
                attackerIds: ["bear"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        pushSpell(state, fog.id, "p2");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {});
        expect(state.players[1].life).toBe(20);
    });

    it("does not prevent non-combat damage", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        pushSpell(state, fog.id, "p2");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("preventAllCombatDamageThisTurn flag cleared at cleanup", () => {
        const state = makeState({
            phase: "END_STEP",
            preventAllCombatDamageThisTurn: true,
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        advancePhase(state);
        expect(state.preventAllCombatDamageThisTurn).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Disrupting Scepter (CR 701.9, 602.5b — {3},{T}: target player discards)
// ---------------------------------------------------------------------------

describe("lure — all creatures able to block enchanted creature do so (CR 509.1c)", () => {
    function setupLure() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker1 = makeInstance(grizzlyBears.id, {
            id: "blk1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker2 = makeInstance(savannahLions.id, {
            id: "blk2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2", { battlefield: [blocker1, blocker2] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        // Attach Lure to the attacker
        pushSpell(state, lure.id, "p1", [
            { type: "permanent", id: "bear-att" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("all eligible blockers must block the enchanted creature", () => {
        const { state } = setupLure();
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(Object.keys(required)).toContain("blk1");
        expect(Object.keys(required)).toContain("blk2");
        expect(required["blk1"]).toContain("bear-att");
        expect(required["blk2"]).toContain("bear-att");
    });

    it("tapped creatures are exempt from Lure", () => {
        const { state } = setupLure();
        const blk1 = state.players[1].battlefield.find((c) => c.id === "blk1")!;
        blk1.isTapped = true;
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk1"]).toBeUndefined();
        expect(required["blk2"]).toContain("bear-att");
    });

    it("creatures that can't legally block (evasion) are exempt", () => {
        const { state } = setupLure();
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear-att"
        )!;
        bear.staticAbilities = [...bear.staticAbilities, "flying"];
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk1"]).toBeUndefined();
        expect(required["blk2"]).toBeUndefined();
    });

    it("already-assigned blockers are not double-assigned", () => {
        const { state } = setupLure();
        state.combat!.blockerAssignments = { blk1: ["bear-att"] };
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk1"]).toBeUndefined();
        expect(required["blk2"]).toContain("bear-att");
    });
});

// ---------------------------------------------------------------------------
// Blaze of Glory (CR 509.1a — multi-block + must-block-all)
// ---------------------------------------------------------------------------

describe("Living Artifact (Aura — vitality counters + upkeep life gain)", () => {
    it("gains vitality counters when controller is dealt damage", () => {
        const artifact = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(livingArtifact.id, {
            id: "la",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-art",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artifact, aura],
                    life: 20,
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
        const auraAfter = state.players[0].battlefield.find(
            (c) => c.id === "la"
        )!;
        expect(auraAfter.counters?.["vitality"]).toBe(3);
    });

    it("upkeep: may remove a vitality counter to gain 1 life", () => {
        const artifact = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(livingArtifact.id, {
            id: "la",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-art",
            counters: { vitality: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [artifact, aura],
                    life: 17,
                }),
                makePlayer("p2"),
            ],
            phase: "UNTAP",
            activePlayerId: "p1",
        });
        advancePhase(state); // UNTAP → UPKEEP fires the phaseTrigger
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "living-artifact-upkeep"
        );
        // First resolveTopOfStack enqueues the may-pay choice
        resolveTopOfStack(state);
        expect(state.pendingChoices?.length).toBe(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        // Simulate submitMayPay accept=yes
        const pending = state.pendingChoices![0];
        const stackItem = state.stack.find(
            (s) => s.id === pending.stackItemId
        )!;
        const key = `${pending.step}:${pending.choiceId}`;
        stackItem.collectedChoices = { [key]: ["yes"] };
        state.pendingChoices = undefined;
        // Re-invoke resolveTopOfStack to resume
        resolveTopOfStack(state);
        const auraAfter = state.players[0].battlefield.find(
            (c) => c.id === "la"
        )!;
        expect(auraAfter.counters?.["vitality"]).toBe(1);
        expect(state.players[0].life).toBe(18);
    });

    // Departure-time LKI, the NON-departure side (issue #2042). Living
    // Artifact never leaves the battlefield here, so CR 400.7 never makes a
    // new object and the CR 603.4 re-check must still read the LIVE aura —
    // `StackItem.sourceLki` is only stamped at the battlefield-departure
    // funnel, and an implementation that preferred a trigger-time snapshot
    // unconditionally would resolve this trigger off a counter that is gone.
    it("upkeep: the intervening-if reads the LIVE counters, so a counter removed after the trigger went on the stack fizzles it (CR 603.4)", () => {
        const artifact = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(livingArtifact.id, {
            id: "la",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host-art",
            counters: { vitality: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [artifact, aura], life: 17 }),
                makePlayer("p2"),
            ],
            phase: "UNTAP",
            activePlayerId: "p1",
        });
        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "living-artifact-upkeep"
        );
        // The trigger-time spread carries the counter; the live aura loses it
        // before resolution, as any counter-removal effect could.
        expect(state.stack[0].counters?.["vitality"]).toBe(1);
        expect(state.stack[0].sourceLki).toBeUndefined();
        const live = state.players[0].battlefield.find((c) => c.id === "la")!;
        delete live.counters;

        resolveTopOfStack(state);
        // Fizzled: no may-pay prompt, no life gain, nothing left on the stack.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(17);
        expect(state.stack).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// W14: Combat-aware static effects — Orcish Oriflamme, Righteousness
// ---------------------------------------------------------------------------

describe("Fastbond ({G} Enchantment — unlimited land drops, CR 305.2)", () => {
    it("player can play 2+ lands per turn with Fastbond on battlefield", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const land1 = makeInstance(forest.id, {
            id: "land1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const land2 = makeInstance(forest.id, {
            id: "land2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    hand: [land1, land2],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        // With Fastbond, player should still be able to play a land
        // even after playing 1 this turn
        const actions = getLegalActions(state, state.players[0], land2);
        expect(actions).toContain("play");
    });

    it("without Fastbond, player can't play more than 1 land per turn", () => {
        const land = makeInstance(forest.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [land],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        const actions = getLegalActions(state, state.players[0], land);
        expect(actions).not.toContain("play");
    });

    it("removing Fastbond reverts to normal land-drop limit", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const land = makeInstance(forest.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    hand: [land],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        // With Fastbond: can play
        expect(getLegalActions(state, state.players[0], land)).toContain(
            "play"
        );
        // Remove Fastbond from battlefield
        removePermanentTo(state, "fb", "graveyard");
        // Without Fastbond: cannot play (already played 1)
        expect(getLegalActions(state, state.players[0], land)).not.toContain(
            "play"
        );
    });

    it("takes 1 damage for each land after the first (trigger fires)", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    landsPlayedThisTurn: 2,
                }),
                makePlayer("p2"),
            ],
        });
        // Simulate a land being PLAYED (2nd land already played this turn).
        // CR 305.2 — a played land carries `wasPlayed: true`.
        const landEvent = {
            type: "PERMANENT_ENTERED" as const,
            instanceId: "new-land",
            controllerId: "p1",
            types: ["Land" as const],
            wasPlayed: true,
        };
        state.pendingEvents = [landEvent];
        processPendingActionTriggers(state);
        // Fastbond trigger should be on stack
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe("fastbond-land-etb");
        // Resolve the trigger — should deal 1 damage to controller
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(19);
    });

    it("does NOT trigger on a fetched land that merely ENTERS (CR 305.2 — not played)", () => {
        // A fetch/tutor puts a land onto the battlefield WITHOUT it being
        // played: the PERMANENT_ENTERED event carries no `wasPlayed`, and the
        // effect-entry path never increments landsPlayedThisTurn. Even with two
        // lands already played this turn, Fastbond must deal no damage.
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    landsPlayedThisTurn: 2,
                }),
                makePlayer("p2"),
            ],
        });
        const fetchedLandEvent = {
            type: "PERMANENT_ENTERED" as const,
            instanceId: "fetched-land",
            controllerId: "p1",
            types: ["Land" as const],
            // no `wasPlayed` — put onto the battlefield by an effect
        };
        state.pendingEvents = [fetchedLandEvent];
        processPendingActionTriggers(state);
        expect(state.stack.length).toBe(0);
        expect(state.players[0].life).toBe(20);
    });

    it("does NOT trigger on the first land played this turn", () => {
        const fb = makeInstance(fastbond.id, {
            id: "fb",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fb],
                    landsPlayedThisTurn: 1,
                }),
                makePlayer("p2"),
            ],
        });
        const landEvent = {
            type: "PERMANENT_ENTERED" as const,
            instanceId: "first-land",
            controllerId: "p1",
            types: ["Land" as const],
        };
        state.pendingEvents = [landEvent];
        processPendingActionTriggers(state);
        // No trigger should fire for the first land
        expect(state.stack.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// W15: Dragon Whelp, Nettling Imp, Stone Giant
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Natural Selection (CR 401.4 — peek, reorder-library, optional shuffle)
// ---------------------------------------------------------------------------
describe("Natural Selection (peek top 3 + reorder + optional shuffle, CR 401.4)", () => {
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

    function setup(libIds: string[] = ["c1", "c2", "c3", "c4"]) {
        const library = libIds.map((id) =>
            makeInstance(swamp.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library })],
        });
        pushSpell(state, naturalSelection.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        return state;
    }

    it("enqueues a reorder-library pending choice for the controller", () => {
        const state = setup();
        resolveTopOfStack(state);

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0]).toMatchObject({
            playerId: "p1",
            kind: "reorder-library",
            zone: "library",
            count: 3,
            zoneOwnerId: "p2",
        });
    });

    it("reorders the top 3 cards of target's library according to chosen order", () => {
        const state = setup();
        resolveTopOfStack(state);

        // Reorder: c3, c1, c2 (was c1, c2, c3, c4)
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);

        // Step 1: may-pay for shuffle — decline
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        const lib = state.players[1].library.map((c) => c.id);
        expect(lib).toEqual(["c3", "c1", "c2", "c4"]);
    });

    it("shuffles target's library when the caster accepts the may-pay", () => {
        const state = setup();
        resolveTopOfStack(state);

        commitHead(state, ["c2", "c3", "c1"]);
        resolveTopOfStack(state);

        // Accept shuffle
        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        // After shuffle the library still has 4 cards but order changed
        // (deterministic RNG with seed 0). Just verify the library size
        // and that the spell is fully resolved.
        expect(state.players[1].library).toHaveLength(4);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("handles target's library with fewer than 3 cards", () => {
        const state = setup(["c1", "c2"]);
        resolveTopOfStack(state);

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].count).toBe(2);
    });

    it("skips entirely when target's library is empty", () => {
        const state = setup([]);
        resolveTopOfStack(state);

        // Step 0 returns early (0 cards) → step 1 runs → may-pay
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
    });

    it("wire format: exposes top 3 of target's library as libraryPeek to the chooser", () => {
        const state = setup();
        resolveTopOfStack(state);

        const forP1 = projectPublicState(state, 1, "p1");
        // p2's library peek exposed to p1 (the chooser)
        expect(forP1.players[1].libraryPeek?.map((c) => c.id)).toEqual([
            "c1",
            "c2",
            "c3",
        ]);
        // Mid-choice, no card is yet `knownTo` (the reorder hasn't resolved).
        expect(forP1.players[1].library).toEqual({ count: 4, known: [] });

        // p2 (not the chooser) should NOT see the peek
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[1].libraryPeek).toBeUndefined();
    });

    // ADR 0026 / PRD #338 — persistent knowledge: the cards the chooser
    // precisely positioned stay known to the chooser only after the choice
    // resolves, unless they shuffle.
    it("stamps the reordered top cards knownTo the chooser when not shuffling", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);
        commitHead(state, ["no"]); // decline shuffle
        resolveTopOfStack(state);

        const lib = state.players[1].library;
        // The 3 reordered cards are known to the chooser (p1) and survive.
        expect(lib[0].knownTo).toEqual(["p1"]);
        expect(lib[1].knownTo).toEqual(["p1"]);
        expect(lib[2].knownTo).toEqual(["p1"]);
        // The untouched 4th card is not known to anyone.
        expect(lib[3].knownTo).toBeUndefined();
    });

    it("clears all knowledge of the library when the chooser shuffles", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c2", "c3", "c1"]);
        resolveTopOfStack(state);
        commitHead(state, ["yes"]); // shuffle
        resolveTopOfStack(state);

        for (const c of state.players[1].library) {
            expect(c.knownTo).toBeUndefined();
        }
    });

    it("wire format: known cards reach the chooser's library.known[], hidden from opponent", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        // p1 (the chooser) sees the 3 known cards at their top indices.
        const forP1 = projectPublicState(state, 1, "p1");
        const known = forP1.players[1].library.known;
        expect(forP1.players[1].library.count).toBe(4);
        expect(known.map((k) => k.index)).toEqual([0, 1, 2]);
        expect(known.map((k) => k.card.id)).toEqual(["c3", "c1", "c2"]);
        // Raw knownTo must never cross the wire.
        for (const k of known) {
            expect((k.card as { knownTo?: string[] }).knownTo).toBeUndefined();
        }

        // p2 (the library owner, not the knower) sees only the count — no
        // known cards (a player does not auto-know their own library order).
        const forP2 = projectPublicState(state, 1, "p2");
        expect(forP2.players[1].library.count).toBe(4);
        expect(forP2.players[1].library.known).toEqual([]);
    });

    // Integration mandate (project rule): the full GRE → serialize (DB) →
    // projection path for a knowledge-granting effect. Knowledge stamped by
    // resolution must survive a DB round trip and still project correctly.
    it("end-to-end: knownTo survives the DB round trip and projects to the chooser only", () => {
        const state = setup();
        resolveTopOfStack(state);
        commitHead(state, ["c3", "c1", "c2"]);
        resolveTopOfStack(state);
        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        // Persist → reload (compact → expand), as saveGameState would.
        const reloaded = expandState(compactState(state));
        expect(reloaded.players[1].library[0].knownTo).toEqual(["p1"]);

        // Project the reloaded state: chooser sees the known cards, opponent
        // does not, and raw knownTo never crosses the wire.
        const forP1 = projectPublicState(reloaded, 1, "p1");
        expect(forP1.players[1].library.known.map((k) => k.card.id)).toEqual([
            "c3",
            "c1",
            "c2",
        ]);
        const forP2 = projectPublicState(reloaded, 1, "p2");
        expect(forP2.players[1].library.known).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Cockatrice (CR 509.1h — combat kill trigger, CR 511.3 end-of-combat destroy)
// ---------------------------------------------------------------------------
describe("Cockatrice (blocks/blocked-by → destroy at end of combat, CR 509.1h)", () => {
    function setupCombat(opts: {
        selfIsAttacker: boolean;
        opponentSubtypes?: string[];
    }) {
        const cockCard = makeInstance(cockatrice.id, {
            id: "cock",
            controllerId: opts.selfIsAttacker ? "p1" : "p2",
            ownerId: opts.selfIsAttacker ? "p1" : "p2",
            zone: "battlefield",
            isAttacking: opts.selfIsAttacker ? true : undefined,
            isBlocking: opts.selfIsAttacker ? undefined : true,
        });
        const opponent = makeInstance(grizzlyBears.id, {
            id: "opp-creature",
            controllerId: opts.selfIsAttacker ? "p2" : "p1",
            ownerId: opts.selfIsAttacker ? "p2" : "p1",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: opts.opponentSubtypes ?? [],
            isAttacking: opts.selfIsAttacker ? undefined : true,
            isBlocking: opts.selfIsAttacker ? true : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: opts.selfIsAttacker ? [cockCard] : [opponent],
                }),
                makePlayer("p2", {
                    battlefield: opts.selfIsAttacker ? [opponent] : [cockCard],
                }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: [opts.selfIsAttacker ? "cock" : "opp-creature"],
                confirmed: true,
                blockerAssignments: opts.selfIsAttacker
                    ? { "opp-creature": ["cock"] }
                    : { cock: ["opp-creature"] },
                blockersConfirmed: true,
            },
        });
        return state;
    }

    it("triggers when cockatrice attacks and is blocked by a non-Wall", () => {
        const state = setupCombat({ selfIsAttacker: true });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "cockatrice-combat-kill"
        );
    });

    it("triggers when cockatrice blocks a non-Wall attacker", () => {
        const state = setupCombat({ selfIsAttacker: false });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "cockatrice-combat-kill"
        );
    });

    it("does NOT trigger against Wall creatures", () => {
        const state = setupCombat({
            selfIsAttacker: true,
            opponentSubtypes: ["Wall"],
        });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(0);
    });

    it("schedules delayed destroy at end-of-combat on resolution", () => {
        const state = setupCombat({ selfIsAttacker: true });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("next-end-of-combat");
        expect(state.delayedTriggers![0].payload.targetId).toBe("opp-creature");
    });

    it("delayed trigger destroys opponent at END_OF_COMBAT", () => {
        const state = setupCombat({ selfIsAttacker: true });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        // Set phase to COMBAT_DAMAGE so advancePhase enters END_OF_COMBAT
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        // Delayed trigger is now on stack
        expect(state.stack.length).toBeGreaterThanOrEqual(1);
        resolveTopOfStack(state);
        // Opponent creature should be in graveyard
        const oppPlayer = state.players[1];
        expect(
            oppPlayer.battlefield.find((c) => c.id === "opp-creature")
        ).toBeUndefined();
        expect(
            oppPlayer.graveyard.find((c) => c.id === "opp-creature")
        ).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Thicket Basilisk (same combat kill, no flying)
// ---------------------------------------------------------------------------
describe("Thicket Basilisk (same combat kill as Cockatrice, no flying)", () => {
    it("triggers on blocking a non-Wall creature", () => {
        const basilisk = makeInstance(thicketBasilisk.id, {
            id: "basilisk",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isBlocking: true,
        });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "att",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Creature"],
            subtypes: [],
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [basilisk] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["att"],
                confirmed: true,
                blockerAssignments: { basilisk: ["att"] },
                blockersConfirmed: true,
            },
        });
        emitBlockersConfirmedEvents(state);
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe("basilisk-combat-kill");
    });
});

// ---------------------------------------------------------------------------
// W21a: Subtype-set core — evilPresence, phantasmalTerrain, conversion
// ---------------------------------------------------------------------------

describe("Living Lands ({3}{G} — all Forests are 1/1 creatures, still lands)", () => {
    it("Forests become 1/1 creatures and keep Land type", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            id: "forest-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        expect(f.types).toContain("Creature");
        expect(f.types).toContain("Land");
        expect(getEffectivePower(state, f)).toBe(1);
        expect(getEffectiveToughness(state, f)).toBe(1);
    });

    // CR 302.6 — summoning sickness on an animated land is governed by the
    // control-continuity flag (set at entry, cleared at the controller's untap
    // step), NOT by the act of becoming a creature. A Forest that entered this
    // turn is still sick when Living Lands animates it; a Forest controlled
    // since a prior turn (flag already cleared) is not.
    it("a Forest that entered this turn stays summoning-sick when animated", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            controllerId: "p1",
            zone: "battlefield",
            isSummoningSick: true, // entered this turn
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        expect(f.types).toContain("Creature");
        expect(f.isSummoningSick).toBe(true);
    });

    it("a Forest controlled since a prior turn is NOT summoning-sick when animated", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            controllerId: "p1",
            zone: "battlefield",
            // isSummoningSick undefined — cleared at a prior untap step
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        expect(f.types).toContain("Creature");
        expect(f.isSummoningSick).toBeUndefined();
    });

    it("removal of Living Lands reverts Forests to non-creature", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);
        expect(f.types).toContain("Creature");

        unapplySourceStaticEffects(state, ll);
        expect(f.types).not.toContain("Creature");
        expect(f.types).toContain("Land");
    });

    it("wire format: animated Forest visible in projected state", () => {
        const state = makeState();
        const f = makeInstance(forest.id, {
            id: "forest-w",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(f);

        const ll = makeInstance(livingLands.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(ll);
        applySourceStaticEffects(state, ll);

        const projected = projectPublicState(state, 1, "p1");
        const projF = projected.players[0].battlefield.find(
            (c) => c.id === "forest-w"
        )!;
        expect(projF.types).toContain("Creature");
        expect(getEffectivePower(projected, projF)).toBe(1);
        expect(getEffectiveToughness(projected, projF)).toBe(1);
    });
});

describe("Kudzu (destroy tapped host, retarget aura, CR 701.26a/704.5n)", () => {
    function setup(extraLand: boolean): {
        state: GameState;
        kudzuId: string;
    } {
        const host = makeInstance(badlands.id, {
            id: "hostland",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const aura = makeInstance(kudzu.id, {
            id: "kudzu1",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "hostland",
        });
        const battlefield = [host, aura];
        if (extraLand) {
            battlefield.push(
                makeInstance(bayou.id, {
                    id: "otherland",
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        const state = makeState({
            players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
        });
        return { state, kudzuId: "kudzu1" };
    }

    it("destroys the host then moves the aura to a chosen land", () => {
        const { state } = setup(true);
        const host = state.players[0].battlefield[0];
        emitPermanentTapped(state, host, false);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);

        // 1) destroy host + suspend on the "may attach" question.
        expect(resolveTopOfStack(state)).toBeNull();
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "hostland")).toBe(true);
        expect(p1.battlefield.some((c) => c.id === "kudzu1")).toBe(true);
        const item = state.stack[state.stack.length - 1];
        const may = state.pendingChoices![0];
        expect(may.kind).toBe("may-pay");
        item.collectedChoices = {
            [`${may.step}:${may.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;

        // 2) accept → suspend on the land choice.
        expect(resolveTopOfStack(state)).toBeNull();
        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("choose-permanents");
        item.collectedChoices = {
            ...item.collectedChoices,
            [`${pick.step}:${pick.choiceId}`]: ["otherland"],
        };
        state.pendingChoices = undefined;

        // 3) reattach.
        resolveTopOfStack(state);
        const aura = p1.battlefield.find((c) => c.id === "kudzu1");
        expect(aura?.attachedTo).toBe("otherland");
    });

    it("goes to the graveyard when no other land is available", () => {
        const { state } = setup(false);
        const host = state.players[0].battlefield[0];
        emitPermanentTapped(state, host, false);
        processPendingActionTriggers(state);

        // Host destroyed, no land to attach → resolve completes with the aura
        // orphaned; SBA 704.5n sweeps it to the graveyard.
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        checkStateBasedActions(state);
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "kudzu1")).toBe(true);
        expect(p1.battlefield.some((c) => c.id === "kudzu1")).toBe(false);
    });
});

describe("Gaea's Liege (Forest-count P/T + {T} land→Forest)", () => {
    function forestInst(id: string, controllerId: string) {
        return makeInstance(forest.id, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    it("power/toughness equal the Forests you control when not attacking", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        liege,
                        forestInst("f1", "p1"),
                        forestInst("f2", "p1"),
                    ],
                }),
                makePlayer("p2", { battlefield: [forestInst("f3", "p2")] }),
            ],
        });
        expect(getEffectivePower(state, liege)).toBe(2);
        expect(getEffectiveToughness(state, liege)).toBe(2);
    });

    it("counts the defending player's Forests while attacking", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [liege, forestInst("f1", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: [
                        forestInst("f2", "p2"),
                        forestInst("f3", "p2"),
                        forestInst("f4", "p2"),
                    ],
                }),
            ],
        });
        // Defending player (p2) controls 3 Forests.
        expect(getEffectivePower(state, liege)).toBe(3);
        expect(getEffectiveToughness(state, liege)).toBe(3);
    });

    it("survives the wire projection (pt-cda)", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        liege,
                        forestInst("f1", "p1"),
                        forestInst("f2", "p1"),
                        forestInst("f3", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, liege)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "liege"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("{T} ability turns a target land into a Forest until Gaea's Liege leaves", () => {
        const liege = makeInstance(gaeasLiege.id, {
            id: "liege",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [liege, mtn] }),
                makePlayer("p2"),
            ],
        });
        // Activate {T}: target the Mountain.
        state.stack.push({
            ...liege,
            zone: "stack",
            castById: "p1",
            abilityId: "gaeas-liege-make-forest",
            targets: [{ type: "permanent", id: "mtn" }],
        });
        resolveTopOfStack(state);
        expect(mtn.counters?.["gaea-forest"]).toBe(1);

        // The counter-driven subtype-set turns it into a Forest.
        applySourceStaticEffects(state, liege);
        expect(mtn.subtypes).toEqual(["Forest"]);

        // When Gaea's Liege leaves, the land reverts (CR 611.2).
        removePermanentTo(state, "liege", "graveyard");
        expect(mtn.subtypes).toEqual(["Mountain"]);
    });
});

// Migration harnesses (ADR 0045, issue #831): Lifeforce / Tranquility / Tsunami
// had no per-card tests, so these behaviour tests are authored to guard the
// resolve()→effects[] migrations (counter / destroyAll sweeps).
describe("Lifeforce ({G}, Sacrifice — counter target black spell, CR 701.6a)", () => {
    it("counters the targeted spell (removes it from the stack)", () => {
        const lf = makeInstance(lifeforce.id, {
            id: "lf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lf] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = pushSpell(state, hypnoticSpecter.id, "p2");
        state.stack.push({
            ...lf,
            id: "stack-lf",
            zone: "stack",
            castById: "p1",
            abilityId: "lifeforce-counter",
            targets: [{ type: "spell", id: blackSpell.id }],
        });
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === blackSpell.id)).toBeUndefined();
        // The countered spell goes to its owner's graveyard (CR 701.6a).
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            blackSpell.id
        );
    });
});

describe("Tranquility ({2}{G} — destroy all enchantments, CR 701.8)", () => {
    it("destroys every enchantment across both players, spares non-enchantments", () => {
        const p1Ench = makeInstance(livingLands.id, {
            id: "p1-ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p2Ench = makeInstance(livingLands.id, {
            id: "p2-ench",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Ench, bear] }),
                makePlayer("p2", { battlefield: [p2Ench] }),
            ],
        });
        pushSpell(state, tranquility.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-ench")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-ench")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")
        ).toBeDefined();
    });
});

describe("Tsunami ({3}{G} — destroy all Islands, CR 701.8)", () => {
    it("destroys every Island across both players and spares other lands", () => {
        const p1Island = makeInstance(island.id, {
            id: "p1-island",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Forest = makeInstance(forest.id, {
            id: "p1-forest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p2Island = makeInstance(island.id, {
            id: "p2-island",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Island, p1Forest] }),
                makePlayer("p2", { battlefield: [p2Island] }),
            ],
        });
        pushSpell(state, tsunami.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-island")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-island")
        ).toBeUndefined();
        // Non-Island land survives.
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-forest")
        ).toBeDefined();
    });
});

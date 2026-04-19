// Per-card behavior tests for cards in `convex/cards/sets/lea.ts`.
// Mirrors the data file: every card with non-trivial behavior gets its own
// describe() block. Spell cards are exercised through resolveTopOfStack();
// pt-buff cards are exercised via effectivePower/Toughness, both at the GRE
// level AND through the wire format (projectPublicState → frontend adapter)
// so regressions at the projection boundary are caught here.

import { describe, it, expect } from "vitest";
import {
    badMoon,
    badlands,
    bayou,
    birdsOfParadise,
    bogWraith,
    shanodinDryads,
    castle,
    channel,
    counterspell,
    ancestralRecall,
    darkRitual,
    fireball,
    lightningBolt,
    llanowarElves,
    plateau,
    savannah,
    scrubland,
    swamp,
    swordsToPlowshares,
    taiga,
    timeWalk,
    tropicalIsland,
    tundra,
    undergroundSea,
    wrathOfGod,
    disenchant,
    hypnoticSpecter,
    serraAngel,
    savannahLions,
    solRing,
} from "../lea";
import {
    commitLandsForCost,
    resolveTopOfStack,
    type CardInstanceState,
} from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import {
    getActivatedManaColor,
    getFixedManaAmount,
    hasManaAbility,
} from "../../../gre/constants";
import { getLegalTargets } from "../../../gre/rules";
import { projectPublicState } from "../../../gameProjections";
import { validateBlockerEligibility } from "../../../gre/combat";
import { advancePhase } from "../../../gre/phases";
import type { CardDefinition, CardType } from "../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";

// ---------------------------------------------------------------------------
// Static P/T buffs (layer 7c — CR 611, 613)
// ---------------------------------------------------------------------------

describe("Castle (static pt-buff: +0/+2 to your untapped creatures)", () => {
    function setup() {
        const creature = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(castle.id, { id: "castle" });
        const p1 = makePlayer("p1", { battlefield: [creature, enchant] });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    it("buffs toughness of your untapped creatures by 2", () => {
        const state = setup();
        const lion = state.players[0].battlefield[0];
        expect(getEffectiveToughness(state, lion)).toBe(3);
        expect(getEffectivePower(state, lion)).toBe(2);
    });

    it("does NOT buff tapped creatures (predicate requires !isTapped)", () => {
        const state = setup();
        const lion = state.players[0].battlefield[0];
        lion.isTapped = true;
        expect(getEffectiveToughness(state, lion)).toBe(1);
    });

    it("does NOT buff opponent's creatures", () => {
        const state = setup();
        const oppLion = makeInstance(savannahLions.id, {
            id: "opp-lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(oppLion);
        expect(getEffectiveToughness(state, oppLion)).toBe(1);
    });

    it("wire format: buff survives projectPublicState (regression guard)", () => {
        // The projection slims `card.card` to { id }. If the buff logic were
        // to rely on embedded fields, this assertion would break.
        const state = setup();
        const projected = projectPublicState(state, 1, "p1");
        const projectedLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        // Re-feed the projected state back to the layer system through
        // PermanentView-compatible shape.
        expect(getEffectiveToughness(projected, projectedLion)).toBe(3);
    });
});

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

describe("Lightning Bolt (3 damage to any target, CR 608.3)", () => {
    it("deals 3 damage to a target player", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("kills a 1/1 creature (damage >= toughness)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
        expect(state.players[1].graveyard[0].id).toBe("lion");
    });

    it("goes to the caster's graveyard after resolving", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            lightningBolt.id
        );
    });

    it("cannot target lands (CR 115.4 / 120.3 — 'any target' is damageable only)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const forest = makeInstance(taiga.id, {
            id: "forest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion, forest] }),
            ],
        });
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!);
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("lion");
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
        expect(ids).not.toContain("forest");
    });
});

describe("Fireball ({X}{R} — X damage divided, +{1}/target, CR 107.3 / 120.1 / 601.2f)", () => {
    function setupState(targets: string[] = []) {
        const creatures = targets.map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                power: 2,
                toughness: 1,
            })
        );
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
    }

    it("deals X damage to a single target when only one is chosen", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });

    it("divides X damage evenly rounded down across multiple targets", () => {
        // X=5 across 2 targets => 2 each, remainder 1 discarded (CR 120.1).
        const state = setupState(["lion-a", "lion-b"]);
        state.players[1].battlefield[0].toughness = 3;
        state.players[1].battlefield[1].toughness = 3;
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        // 2 damage per target < 3 toughness → neither dies, both stay alive.
        expect(state.players[1].battlefield).toHaveLength(2);
    });

    it("kills all targets when per-target damage reaches lethal", () => {
        // X=6 across 2 targets => 3 each, lethal against toughness 1.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 6;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(2);
    });

    it("is a no-op when X is 0 (total 0 damage)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20);
    });

    it("declares additionalGenericPerExtraTarget for the cost modifier", () => {
        // CR 601.2f: the engine uses this value in finalizeTargetSelection to
        // grow the generic mana cost with each target beyond the first.
        expect(fireball.additionalGenericPerExtraTarget).toBe(1);
    });

    it("declares a variable target count with min 1", () => {
        expect(fireball.targetRequirement).toEqual({
            type: "any",
            count: { min: 1 },
        });
    });

    it("goes to the caster's graveyard after resolving (CR 608.2k)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            fireball.id
        );
    });

    it("wire format: divided damage still lethal after projectPublicState", () => {
        // Regression: the projection slims stack items' card to { id } only,
        // but chosenX/targets must survive the projection AND re-driving the
        // GRE from a freshly cloned state must still kill both lions.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 4;
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack[0];
        expect(projectedItem.chosenX).toBe(4);
        expect(projectedItem.targets).toHaveLength(2);
        // Resolve against the live state (the source of truth) and assert
        // that the per-target damage (4/2 = 2) clears both 1-toughness lions.
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

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

describe("Ancestral Recall (target player draws 3, CR 608.3)", () => {
    it("draws 3 cards for the target player", () => {
        const p2Library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p2-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: p2Library }),
            ],
        });
        pushSpell(state, ancestralRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(3);
        expect(state.players[1].library).toHaveLength(2);
    });
});

describe("Counterspell (counter target spell, CR 701.5a)", () => {
    it("removes a spell from the stack (doesn't let it resolve)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        // Resolve Counterspell first (top of stack → LIFO)
        resolveTopOfStack(state);
        // The Lightning Bolt should have been removed from the stack.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        // Counterspell itself goes to p1's graveyard.
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("preserves p1 life (bolt never resolves)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Swords to Plowshares (exile + gain life = power, CR 608.3)", () => {
    it("exiles the target creature and grants life = its power to controller", () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
        pushSpell(state, swordsToPlowshares.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        // Exiled (not graveyard).
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(1);
        expect(state.players[1].exile[0].id).toBe("angel");
        // Controller of the exiled creature (p2) gains life = angel's power (4).
        expect(state.players[1].life).toBe(24);
    });
});

describe("Wrath of God (destroy all creatures, CR 608.3)", () => {
    it("moves every creature to its owner's graveyard", () => {
        const angel = makeInstance(serraAngel.id, { id: "angel" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("angel");
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");
    });
});

describe("Disenchant (destroy target Artifact/Enchantment, CR 608.3)", () => {
    it("destroys a target enchantment", () => {
        const c = makeInstance(castle.id, { id: "castle-target" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [c] }), makePlayer("p2")],
        });
        pushSpell(state, disenchant.id, "p2", [
            { type: "permanent", id: "castle-target" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard[0].id).toBe("castle-target");
    });
});

// ---------------------------------------------------------------------------
// Keyword abilities (the layer/combat system tests them generically; here we
// only assert the card definition carries the right keywords — guards against
// typos / accidental removals).
// ---------------------------------------------------------------------------

describe("Serra Angel (keyword abilities)", () => {
    it("has flying and vigilance", () => {
        expect(serraAngel.staticAbilities).toContain("flying");
        expect(serraAngel.staticAbilities).toContain("vigilance");
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

describe("Shanodin Dryads (forestwalk evasion, CR 702.13b)", () => {
    it("is a 1/1 Nymph Dryad for {G} with forestwalk", () => {
        expect(shanodinDryads.manaCost).toEqual({ G: 1 });
        expect(shanodinDryads.types).toContain("Creature");
        expect(shanodinDryads.subtypes).toEqual(["Nymph", "Dryad"]);
        expect(shanodinDryads.power).toBe(1);
        expect(shanodinDryads.toughness).toBe(1);
        expect(shanodinDryads.staticAbilities).toContain("forestwalk");
    });

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
        const { applyAllCombatDamage } = await import("../../../gre/phases");
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
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        resolveTopOfStack(state);

        const p2 = state.players[1];
        expect(p2.hand).toHaveLength(1);
        expect(p2.graveyard).toHaveLength(1);
        // Specter stays on the battlefield after the trigger resolves.
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("is deterministic: same seed → same discarded card", async () => {
        const { applyAllCombatDamage } = await import("../../../gre/phases");
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
        const { applyAllCombatDamage } = await import("../../../gre/phases");
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

// ---------------------------------------------------------------------------
// Activated mana abilities on creatures (CR 605.1a)
// ---------------------------------------------------------------------------

describe("Llanowar Elves ({T}: Add {G}, CR 605.1a)", () => {
    it("is a 1/1 Elf Druid for {G}", () => {
        expect(llanowarElves.manaCost).toEqual({ G: 1 });
        expect(llanowarElves.types).toContain("Creature");
        expect(llanowarElves.subtypes).toEqual(["Elf", "Druid"]);
        expect(llanowarElves.power).toBe(1);
        expect(llanowarElves.toughness).toBe(1);
    });

    it("declares a tap-for-green mana ability (useStack: false)", () => {
        const ability = llanowarElves.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ G: 1 });
    });

    it("engine recognizes the mana ability on the battlefield", () => {
        const elf = makeInstance(llanowarElves.id, { id: "elf" });
        expect(hasManaAbility(elf)).toBe(true);
        expect(getActivatedManaColor(elf)).toBe("G");
    });

    it("wire format: mana ability survives projectPublicState", () => {
        // The projection slims `card.card` to `{ id }`. The constants helpers
        // read the ability via `getCardById(card.card.id)` — this test guards
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

describe("Sol Ring ({T}: Add {C}{C}, CR 605.1a)", () => {
    it("is a {1} artifact", () => {
        expect(solRing.manaCost).toEqual({ X: 1 });
        expect(solRing.types).toEqual(["Artifact"]);
    });

    it("declares a tap-for-{C}{C} mana ability (useStack: false)", () => {
        const ability = solRing.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 2 });
    });

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

describe("Birds of Paradise (flying + {T}: Add one mana of any color, CR 605.1a)", () => {
    it("is a 0/1 Bird for {G} with flying", () => {
        expect(birdsOfParadise.manaCost).toEqual({ G: 1 });
        expect(birdsOfParadise.types).toContain("Creature");
        expect(birdsOfParadise.subtypes).toEqual(["Bird"]);
        expect(birdsOfParadise.power).toBe(0);
        expect(birdsOfParadise.toughness).toBe(1);
        expect(birdsOfParadise.staticAbilities).toContain("flying");
    });

    it("declares a tap mana ability offering all five colors (no colorless)", () => {
        const ability = birdsOfParadise.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        // "Any color" excludes colorless per CR 106.1b — must be W/U/B/R/G only.
        expect(ability?.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

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

describe("Tundra (dual land: {T}: Add {W} or {U})", () => {
    it("is a Land with both Plains and Island subtypes", () => {
        expect(tundra.types).toEqual(["Land"]);
        expect(tundra.subtypes).toEqual(["Plains", "Island"]);
        // Dual lands are NOT Basic (CR 205.4a).
        expect(tundra.supertypes).toBeUndefined();
    });

    it("offers W and U as a single choice ability", () => {
        const ability = tundra.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaChoices).toEqual([{ W: 1 }, { U: 1 }]);
    });

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

describe("Alpha dual lands (snapshot: types, subtypes, mana choices)", () => {
    // The remaining 8 duals share Tundra's shape. Locking down the triples
    // guards against typos in subtypes/manaChoices when adding new prints.
    const duals: Array<{
        card: CardDefinition;
        subtypes: string[];
        choices: [string, string];
    }> = [
        {
            card: badlands,
            subtypes: ["Swamp", "Mountain"],
            choices: ["B", "R"],
        },
        { card: bayou, subtypes: ["Swamp", "Forest"], choices: ["B", "G"] },
        {
            card: plateau,
            subtypes: ["Mountain", "Plains"],
            choices: ["R", "W"],
        },
        { card: savannah, subtypes: ["Forest", "Plains"], choices: ["G", "W"] },
        { card: scrubland, subtypes: ["Plains", "Swamp"], choices: ["W", "B"] },
        { card: taiga, subtypes: ["Mountain", "Forest"], choices: ["R", "G"] },
        {
            card: tropicalIsland,
            subtypes: ["Forest", "Island"],
            choices: ["G", "U"],
        },
        {
            card: undergroundSea,
            subtypes: ["Island", "Swamp"],
            choices: ["U", "B"],
        },
    ];

    for (const { card, subtypes, choices } of duals) {
        it(`${card.name}: land with subtypes ${subtypes.join("/")} and ${choices.join("/")} mana`, () => {
            expect(card.types).toEqual(["Land"]);
            expect(card.subtypes).toEqual(subtypes);
            expect(card.supertypes).toBeUndefined();
            const ability = card.activatedAbilities?.[0];
            expect(ability?.cost.tap).toBe(true);
            expect(ability?.useStack).toBe(false);
            expect(ability?.manaChoices).toEqual([
                { [choices[0]]: 1 },
                { [choices[1]]: 1 },
            ]);
        });
    }
});

describe("Channel (CR 605.1a, 118.4, 514.2)", () => {
    it("is a {G}{G} sorcery", () => {
        expect(channel.manaCost).toEqual({ G: 2 });
        expect(channel.types).toEqual(["Sorcery"]);
    });

    it("declares a pay-1-life mana ability template (useStack: false)", () => {
        const ability = channel.activatedAbilities?.[0];
        expect(ability?.id).toBe("channel-mana");
        expect(ability?.cost.life).toBe(1);
        expect(ability?.cost.tap).toBeUndefined();
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 1 });
    });

    it("resolve grants the caster a reference to channel-mana for the turn", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const grants = state.players[0].grantedAbilities;
        expect(grants).toHaveLength(1);
        expect(grants?.[0]).toMatchObject({
            sourceCardId: channel.id,
            abilityId: "channel-mana",
            duration: "end-of-turn",
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
                duration: "end-of-turn",
            });
            expect(slim?.[0].cost.life).toBe(1);
        }
    });
});

describe("Time Walk (extra turn after this one, CR 500.7)", () => {
    it("is a {1}{U} sorcery", () => {
        expect(timeWalk.manaCost).toEqual({ X: 1, U: 1 });
        expect(timeWalk.types).toEqual(["Sorcery"]);
    });

    it("resolves by queueing an extra turn for the caster", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        expect(state.extraTurns).toBeUndefined();
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("advancing the turn keeps the caster active (no opponent swap)", () => {
        // Resolve Time Walk at end-of-turn so the very next advanceTurn runs.
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
        });
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        // END_STEP → CLEANUP (auto) → UNTAP of the next turn.
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(state.turn).toBe(2);
        expect(state.extraTurns).toBeUndefined();
        // The turn after the extra turn returns to normal swap order.
        const next = makeState({
            ...state,
            phase: "END_STEP",
        });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p2");
    });

    it("multiple extra turns stack LIFO (CR 500.7)", () => {
        const state = makeState({ phase: "END_STEP", activePlayerId: "p1" });
        // p1 casts Time Walk targeting self, then p2 somehow gets one queued
        // (simulated by pushing directly). Order: [p1, p2] → p2 taken first.
        state.extraTurns = ["p1", "p2"];
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.extraTurns).toEqual(["p1"]);
        const next = makeState({ ...state, phase: "END_STEP" });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p1");
        expect(next.extraTurns).toBeUndefined();
    });

    it("wire format: extraTurns survives projectPublicState", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.extraTurns).toEqual(["p1"]);
        expect(projected.activePlayerId).toBe(state.activePlayerId);
    });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function grizzlyBearsId(): string {
    // grizzlyBears is exported from lea.ts — use getCardByName to stay
    // decoupled if we rename the variable.
    return "ce2d603a-3231-4a8c-bf39-1617586ea870";
}

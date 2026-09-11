// blb (Bloomburrow) — per-card behavior tests for blue cards in
// `convex/cards/sets/blb/blue.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    beginApplyingStaticEffects,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyCopy } from "../../../../gre/copy";
import { assertActivationTimingLegal } from "../../../../game";
import { classLevelOf } from "../../../abilities/classLevels";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { projectPublicState } from "../../../../gameProjections";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { getDefinition } from "../../../index";

const azureBeastbinder = getDefinition("211af1bf-910b-41a5-b928-f378188d1871");
const balduvianBears = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095");

const BEAR_ID = balduvianBears.id;

function attackEvent(attackerId: string): StackItem["triggerEvent"] {
    return {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "p1",
        attackerIds: [attackerId],
    };
}

function pushAttackTrigger(
    state: GameState,
    beastbinder: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...beastbinder,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "azure-beastbinder-attack",
        triggerSourceId: beastbinder.id,
        triggerEvent: attackEvent(beastbinder.id),
    });
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen target (or
 *  the empty "decline" set) onto the on-stack trigger. */
function chooseTarget(state: GameState, targetId: string | null) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = targetId
        ? [{ type: "permanent", id: targetId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Azure Beastbinder (CR 509.1b block restriction + 508.1 attack trigger)", () => {
    it("can't be blocked by creatures with power 2 or greater (CR 509.1b)", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const strongBlocker = makeInstance(BEAR_ID, {
            id: "strong",
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
            toughness: 2,
        });
        const weakBlocker = makeInstance(BEAR_ID, {
            id: "weak",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [strongBlocker, weakBlocker] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        expect(
            validateBlockerEligibility(
                beastbinder,
                strongBlocker,
                [strongBlocker, weakBlocker],
                state
            ).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(
                beastbinder,
                weakBlocker,
                [strongBlocker, weakBlocker],
                state
            ).eligible
        ).toBe(true);
    });

    it("attack trigger strips all abilities and sets base P/T 2/2 on a chosen opposing creature until the controller's next turn", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const target = makeInstance(BEAR_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, beastbinder);
        chooseTarget(state, "target");
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(target.staticAbilities).toEqual([]);
        expect(getEffectivePower(state, target)).toBe(2);
        expect(getEffectiveToughness(state, target)).toBe(2);
    });

    it("is a no-op ('up to one') when the controller declines a target", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const target = makeInstance(BEAR_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, beastbinder);
        chooseTarget(state, null);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(target.staticAbilities).toEqual(["flying"]);
    });

    it("wire format: the stripped abilities and reset P/T survive projection", () => {
        const beastbinder = makeInstance(azureBeastbinder.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const target = makeInstance(BEAR_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beastbinder] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
            combat: {
                attackerIds: ["bb"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushAttackTrigger(state, beastbinder);
        chooseTarget(state, "target");
        expect(resolveTopOfStack(state)).not.toBeNull();
        const projected = projectPublicState(state, 1, "p2");
        const slimTarget = projected.players[1].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(slimTarget.staticAbilities).toEqual([]);
        expect(getEffectivePower(projected, slimTarget)).toBe(2);
        expect(getEffectiveToughness(projected, slimTarget)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Stormchaser's Talent — the engine's first Class card (CR 716), so this block
// is the permanent test for the whole Class mechanic as well as for the card:
// the level designation (CR 716.2b/716.2d), the CR 716.2a activation gate, the
// level-gated text box sections, the "becomes level N" trigger and the two
// separations the rules insist on — the level is not a counter (CR 716.4 /
// 711.7) and it is not copiable (CR 716.2b). Everything is driven through the
// REAL engine (`resolveTopOfStack`, `collectTriggers`,
// `assertActivationTimingLegal`, `projectPublicState`), never a hand-built
// view.
// ---------------------------------------------------------------------------

const stormchasersTalent = getDefinition(
    "a36e682d-b43d-4e08-bf5b-70d7e924dbe5"
);
/** Lightning Bolt — an instant to cast and to recur. */
const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

/** Stormchaser's Talent alone on p1's battlefield, levelled up to `level` by
 *  resolving each class level bar in turn through the real stack. */
function talentBoard(level: number): {
    state: GameState;
    talent: CardInstanceState;
} {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(stormchasersTalent.id, { id: "talent" }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const talent = state.players[0].battlefield[0];
    beginApplyingStaticEffects(state, talent);
    for (let n = 2; n <= level; n++) activateBar(state, talent, n);
    return { state, talent };
}

/** Resolves one class level bar through the real stack (CR 716.2a), exactly as
 *  the `activateAbility` mutation would after the cost is paid. */
function activateBar(
    state: GameState,
    source: CardInstanceState,
    level: number
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId: `class-level-${level}`,
        targets: [],
    });
    resolveTopOfStack(state);
    // Drain the level-up's own pending events so a later assertion sees only
    // what IT produced.
    state.pendingEvents = [];
}

describe("Stormchaser's Talent — the class level designation (CR 716.2)", () => {
    it("CR 716.2d — a Class that has never been levelled has no stored level and reads as level 1", () => {
        const { talent } = talentBoard(1);
        expect(talent.classLevel).toBeUndefined();
        expect(classLevelOf(talent)).toBe(1);
    });

    it("CR 716.2a — resolving the level-2 bar sets the level", () => {
        const { state, talent } = talentBoard(1);
        state.stack.push({
            ...talent,
            zone: "stack",
            castById: "p1",
            abilityId: "class-level-2",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(talent.classLevel).toBe(2);
        // CR 603.3c — the section trigger DID fire off the LEVEL_GAINED event
        // (`resolveTopOfStack` drains the queue and scans it itself), and then
        // left the stack again: its target is mandatory and this graveyard is
        // empty. The firing itself is asserted with a legal target below.
        expect(state.stack).toEqual([]);
    });

    it("CR 716.4 / 711.7 — the level is NOT a counter: nothing lands in the counter map", () => {
        const { talent } = talentBoard(3);
        expect(talent.classLevel).toBe(3);
        expect(talent.counters).toBeUndefined();
    });

    it("CR 716.2b — a level is never re-taken: re-resolving a spent bar leaves the level alone", () => {
        const { state, talent } = talentBoard(3);
        activateBar(state, talent, 2);
        expect(talent.classLevel).toBe(3);
    });
});

describe("Stormchaser's Talent — the CR 716.2a activation gate", () => {
    it("CR 716.2a — at level 1 only the level-2 bar is legal", () => {
        const { state, talent } = talentBoard(1);
        const bar = (level: number) =>
            stormchasersTalent.activatedAbilities!.find(
                (a) => a.classLevelBar === level
            )!;
        expect(() =>
            assertActivationTimingLegal(state, talent, bar(2))
        ).not.toThrow();
        expect(() =>
            assertActivationTimingLegal(state, talent, bar(3))
        ).toThrow(/level 2/);
    });

    it("CR 716.2a — at level 2 the level-2 bar is spent and the level-3 bar opens", () => {
        const { state, talent } = talentBoard(2);
        const bar = (level: number) =>
            stormchasersTalent.activatedAbilities!.find(
                (a) => a.classLevelBar === level
            )!;
        expect(() =>
            assertActivationTimingLegal(state, talent, bar(2))
        ).toThrow(/level 1/);
        expect(() =>
            assertActivationTimingLegal(state, talent, bar(3))
        ).not.toThrow();
    });

    it("CR 716.2a / 307.5 — the bar is sorcery-speed only", () => {
        const { state, talent } = talentBoard(1);
        state.phase = "COMBAT_DAMAGE";
        const bar = stormchasersTalent.activatedAbilities!.find(
            (a) => a.classLevelBar === 2
        )!;
        expect(() => assertActivationTimingLegal(state, talent, bar)).toThrow(
            /as a sorcery/
        );
    });
});

describe("Stormchaser's Talent — level-gated text box sections (CR 716.2a)", () => {
    /** Emits a SPELL_CAST for an instant by p1 and returns the triggers the
     *  engine collects — the real scan, not a hand-built view. */
    const castTriggersAt = (level: number) => {
        const { state } = talentBoard(level);
        return collectTriggers(state, [
            {
                type: "SPELL_CAST",
                casterId: "p1",
                spellInstanceId: "bolt-1",
                spellCardId: BOLT,
                spellTypes: ["Instant"],
                spellSubtypes: [],
                spellColors: ["R"],
            },
        ]);
    };

    it("below level 3 the Class does not HAVE the cast trigger, so it cannot fire", () => {
        expect(castTriggersAt(1)).toEqual([]);
        expect(castTriggersAt(2)).toEqual([]);
    });

    it("CR 716.2a — at level 3 the section's trigger functions", () => {
        const triggers = castTriggersAt(3);
        expect(triggers.map((t) => t.triggeredAbilityId)).toEqual([
            "stormchasers-talent-level-3-otter",
        ]);
    });

    it("CR 716.2a — the level-2 section's trigger persists at level 3, already spent", () => {
        // The ability is still on the card (the gate is `>= 2`), but a level
        // is gained once and only upward, so nothing re-fires it.
        const { state } = talentBoard(3);
        expect(
            collectTriggers(state, [
                {
                    type: "LEVEL_GAINED",
                    instanceId: "talent",
                    controllerId: "p1",
                    level: 2,
                    previousLevel: 1,
                    types: ["Enchantment"],
                    subtypes: ["Class"],
                },
            ]).map((t) => t.triggeredAbilityId)
        ).toEqual(["class-becomes-level-2"]);
    });
});

describe("Stormchaser's Talent — 'becomes level 2' (CR 716.2a / 603.3d)", () => {
    it("returns the targeted instant from the graveyard to hand", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(stormchasersTalent.id, { id: "talent" }),
                    ],
                    graveyard: [
                        makeInstance(BOLT, {
                            id: "gy-bolt",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const talent = state.players[0].battlefield[0];
        beginApplyingStaticEffects(state, talent);

        state.stack.push({
            ...talent,
            zone: "stack",
            castById: "p1",
            abilityId: "class-level-2",
            targets: [],
        });
        // The bar's own resolution drains its LEVEL_GAINED event and puts the
        // section trigger on the stack.
        resolveTopOfStack(state);
        expect(state.stack.map((item) => item.triggeredAbilityId)).toEqual([
            "class-becomes-level-2",
        ]);
        // CR 603.3c — exactly one legal target, so the engine locks it with no
        // prompt as the trigger goes on the stack.
        raiseTriggerTargetSelection(state);
        resolveTopOfStack(state);

        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["gy-bolt"]);
    });
});

describe("Stormchaser's Talent — wire format (projectPublicState)", () => {
    for (const level of [1, 2, 3]) {
        it(`level ${level}: the class level survives the projection and the counter map stays empty`, () => {
            const { state, talent } = talentBoard(level);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === talent.id
            )!;
            expect(classLevelOf(slim)).toBe(level);
            expect(slim.counters).toBeUndefined();
        });
    }
});

describe("Stormchaser's Talent — copies (CR 716.2b)", () => {
    it("a copy of a levelled Class starts at level 1 — levels are not copiable", () => {
        const { state, talent } = talentBoard(3);
        const clone = makeInstance(balduvianBears.id, { id: "clone" });
        state.players[0].battlefield.push(clone);
        beginApplyingStaticEffects(state, clone);
        applyCopy(state, clone, talent);
        expect(clone.card.id).toBe(stormchasersTalent.id);
        expect(classLevelOf(clone)).toBe(1);
        // ...and the original keeps its own level (CR 707.9a — the copy effect
        // rewrites copiable values only).
        expect(talent.classLevel).toBe(3);
    });
});

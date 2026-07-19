// MH3 white — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { collectTriggers } from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { PERMANENT_TYPES } from "../../../types";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { guideOfSouls, phelia } from "../white";
import { balduvianBears } from "../../ice/green";
import { forest } from "../../lea/colorless";

// Guide of Souls — {W} 1/2 Human Cleric (MH3, issue #1194). "Whenever another
// creature you control enters, you gain 1 life and get {E}. Whenever you
// attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a
// flying counter on target attacking creature. It becomes an Angel in
// addition to its other types." First card exercising: keyword counters
// (CR 122.1c), the `addSubtype` Op (CR 613.1d), and the `mayPay` energy leg.

describe("Guide of Souls — definition", () => {
    it("pins mana cost, stats, and both triggered abilities", () => {
        expect(guideOfSouls.manaCost).toEqual({ W: 1 });
        expect(guideOfSouls.types).toEqual(["Creature"]);
        expect(guideOfSouls.subtypes).toEqual(["Human", "Cleric"]);
        expect(guideOfSouls.power).toBe(1);
        expect(guideOfSouls.toughness).toBe(2);
        const etb = guideOfSouls.triggeredAbilities?.find(
            (a) => a.id === "guide-of-souls-etb"
        );
        expect(etb).toBeDefined();
        const attack = guideOfSouls.triggeredAbilities?.find(
            (a) => a.id === "guide-of-souls-attack"
        );
        expect(attack?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            combatRoleFilter: "attacking",
        });
    });
});

describe("Guide of Souls — ETB (CR 603.6a): another creature entering", () => {
    it("gains 1 life and 1 energy when ANOTHER creature you control enters", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "entering-creature",
                controllerId: "p1",
                cardId: "some-other-creature",
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
        expect(state.players[0].energyCounters).toBe(1);
    });

    it("does NOT trigger on its own ETB (CR 109.2 self-exclusion)", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "guide2",
                controllerId: "p1",
                cardId: guideOfSouls.id,
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("does NOT trigger on an opponent's creature entering", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "their-creature",
                controllerId: "p2",
                cardId: "some-other-creature",
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("does NOT trigger on a non-creature permanent entering", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guide4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "a-land",
                controllerId: "p1",
                cardId: "some-land",
                types: ["Land"],
            },
        ]);
        expect(triggers).toHaveLength(0);
    });
});

/** Put Guide of Souls' attack trigger on the stack, mirroring the collector's
 *  ATTACKERS_DECLARED shape (CR 508.1) — a real combat sequence isn't needed
 *  to exercise the targeted-trigger + mayPay + counters/addSubtype pipeline. */
function attackTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "guide-attack-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "guide-of-souls-attack",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: source.controllerId,
            attackerIds: [source.id],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

describe("Guide of Souls — attack trigger (CR 603.3d target + mayPay {E}{E}{E} + CR 122.1c/613.1d)", () => {
    it("targets the sole attacking creature, and on PAY puts two +1/+1 counters + a flying counter + becomes an Angel", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guideAtk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [guide],
                    energyCounters: 3,
                }),
                makePlayer("p2"),
            ],
        });
        attackTriggerOnStack(state, guide);

        // CR 603.3d — a single legal attacking creature auto-selects (no
        // real choice owed, so `raiseTriggerTargetSelection` returns false —
        // it returns true only when a PendingTarget is raised).
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        const trig = state.stack.find((s) => s.id === "guide-attack-trig")!;
        expect(trig.targets).toEqual([{ type: "permanent", id: "guideAtk" }]);

        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.cost).toEqual({ energy: 3 });
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        expect(state.players[0].energyCounters).toBe(0);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "guideAtk"
        )!;
        expect(after.counters).toEqual({ "+1/+1": 2, flying: 1 });
        // CR 122.1c / 613.4d — the flying counter GRANTS flying.
        expect(after.staticAbilities).toContain("flying");
        // CR 613.1d layer 4 — "becomes an Angel in addition to its other types".
        expect(after.subtypes).toContain("Angel");
        expect(after.subtypes).toContain("Human"); // "in addition to" — printed kept
        expect(after.subtypes).toContain("Cleric");

        // Wire format — every observable field here (counters, staticAbilities,
        // subtypes) is board-visible and must survive the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "guideAtk"
        )!;
        expect(slim.counters).toEqual({ "+1/+1": 2, flying: 1 });
        expect(slim.staticAbilities).toContain("flying");
        expect(slim.subtypes).toContain("Angel");
    });

    it("does nothing on DECLINE — no counters, no Angel, energy unspent", () => {
        const guide = makeInstance(guideOfSouls.id, {
            id: "guideDecline",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [guide],
                    energyCounters: 3,
                }),
                makePlayer("p2"),
            ],
        });
        attackTriggerOnStack(state, guide);
        raiseTriggerTargetSelection(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(state.players[0].energyCounters).toBe(3);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "guideDecline"
        )!;
        expect(after.counters).toBeUndefined();
        expect(after.staticAbilities).not.toContain("flying");
        expect(after.subtypes).not.toContain("Angel");
    });

    it("removes the trigger from the stack when no attacking creature is a legal target (CR 603.3c)", () => {
        // Guide of Souls itself is not attacking and no other creature is
        // either — the "target attacking creature" requirement has no legal
        // candidate, so the mandatory-target trigger is removed (CR 603.3c),
        // never reaching the may-pay decision.
        const guide = makeInstance(guideOfSouls.id, {
            id: "guideNoTarget",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guide] }),
                makePlayer("p2"),
            ],
        });
        attackTriggerOnStack(state, guide);
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(
            state.stack.find((s) => s.id === "guide-attack-trig")
        ).toBeUndefined();
    });
});

// Phelia, Exuberant Shepherd — {1}{W} 2/2 Legendary Dog, Flash (MH3, issue
// #1320, parent #917). "Whenever Phelia attacks, exile up to one other
// target nonland permanent. At the beginning of the next end step, return
// that card to the battlefield under its owner's control. If it entered
// under your control, put a +1/+1 counter on Phelia." First card to exercise
// the delayed-trigger CONTROLLER-vs-OWNER branch (issue #1320): the fired
// delayed trigger reads the returned permanent's post-return controller and
// compares it against the captured caster, adding a +1/+1 counter on Phelia
// only when they match. The attack trigger's "up to one other target nonland
// permanent" is a REAL target chosen at stack placement (CR 603.3d,
// `targetRequirement` + `raiseTriggerTargetSelection`), not a
// resolution-time choice.

/** Puts Phelia's attack trigger on the stack, mirroring Guide of Souls'
 *  `attackTriggerOnStack` helper (ATTACKERS_DECLARED, CR 508.1). The trigger
 *  now carries a `targetRequirement`, so `raiseTriggerTargetSelection` runs
 *  before resolving (see `choosePheliaTarget`). */
function pheliaAttackTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "phelia-attack-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "phelia-attack",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: source.controllerId,
            attackerIds: [source.id],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen target
 *  (or the empty "decline" set) onto the on-stack trigger. */
function choosePheliaTarget(state: GameState, targetId: string | null) {
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

describe("Phelia, Exuberant Shepherd — definition", () => {
    it("pins mana cost, stats, supertype, and Flash", () => {
        expect(phelia.manaCost).toEqual({ X: 1, W: 1 });
        expect(phelia.types).toEqual(["Creature"]);
        expect(phelia.subtypes).toEqual(["Dog"]);
        expect(phelia.supertypes).toEqual(["Legendary"]);
        expect(phelia.power).toBe(2);
        expect(phelia.toughness).toBe(2);
        expect(phelia.staticAbilities).toEqual(["flash"]);
        expect(phelia.triggeredAbilities?.[0]?.id).toBe("phelia-attack");
        expect(phelia.delayedTriggers?.[0]?.id).toBe("phelia-return");
    });

    it("declares the CR 603.3d target requirement: up to one other nonland permanent", () => {
        expect(phelia.triggeredAbilities?.[0]?.targetRequirement).toEqual({
            type: [...PERMANENT_TYPES],
            count: { min: 0, max: 1 },
            excludeTypes: "Land",
            excludeSource: true,
        });
    });
});

describe("Phelia — attack trigger (CR 603.6a exile + CR 603.7a delayed return)", () => {
    it("exiles the chosen OTHER nonland permanent and schedules a next-end-step return", () => {
        const p = makeInstance(phelia.id, {
            id: "phelia1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pheliaAttackTriggerOnStack(state, p);
        choosePheliaTarget(state, "target1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(
            state.players[1].battlefield.find((c) => c.id === "target1")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("target1");
        expect(state.delayedTriggers?.length).toBe(1);
        expect(state.delayedTriggers?.[0]?.payload).toMatchObject({
            cardId: "target1",
            ownerId: "p2",
            casterControllerId: "p1",
            sourceId: "phelia1",
        });
    });

    it("excludes lands and Phelia herself — no legal target, resolves as a no-op (CR 603.3c)", () => {
        const p = makeInstance(phelia.id, {
            id: "phelia2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "land1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, land] }),
                makePlayer("p2"),
            ],
        });
        const trig = pheliaAttackTriggerOnStack(state, p);
        // No legal nonland candidate exists (only Phelia herself — excluded by
        // `excludeSource` — and a land, excluded by `excludeTypes`). CR 603.3d
        // "up to one" with none legal: the engine locks an empty target set,
        // no PendingTarget is raised, and the trigger resolves as a no-op.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingTarget).toBeUndefined();
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("when a real choice IS owed, the raised PendingTarget carries the exclusion filters (CR 109.1 / 601.2c) so the interactive choice can't offer/accept a land or Phelia herself", () => {
        // A legal nonland opponent creature exists alongside Phelia and a land,
        // so `raiseTriggerTargetSelection` raises an interactive PendingTarget
        // (real choice, count 0..1) rather than auto-resolving. The bug: the
        // raised choice dropped `excludeInstanceIds` (self) + `excludeTypes`
        // (nonland), so the client rendered — and `selectTarget` accepted —
        // Phelia/a land. Assert both filters now ride on the PendingTarget
        // (they plumb BOTH the client clickability mirror and the server gate).
        const p = makeInstance(phelia.id, {
            id: "pheliaX",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "landX",
            controllerId: "p1",
            ownerId: "p1",
        });
        const legal = makeInstance(balduvianBears.id, {
            id: "legalX",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, land] }),
                makePlayer("p2", { battlefield: [legal] }),
            ],
        });
        pheliaAttackTriggerOnStack(state, p);
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.excludeInstanceIds).toContain("pheliaX");
        expect(state.pendingTarget!.excludeTypes).toContain("Land");
    });

    it("does nothing when the controller declines (up to one)", () => {
        const p = makeInstance(phelia.id, {
            id: "phelia3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "target3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pheliaAttackTriggerOnStack(state, p);
        choosePheliaTarget(state, null);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "target3")
        ).toBeDefined();
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });
});

describe("Phelia — delayed-trigger controller/owner branch (issue #1320)", () => {
    function exileAndScheduleReturn(
        state: GameState,
        p: CardInstanceState,
        targetId: string
    ) {
        pheliaAttackTriggerOnStack(state, p);
        choosePheliaTarget(state, targetId);
        resolveTopOfStack(state);
    }

    it("puts a +1/+1 counter on Phelia when the returned permanent enters under YOUR control (owner === Phelia's controller)", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaA",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A permanent Phelia's controller (p1) both owns AND controls —
        // returns under p1's control, matching the caster.
        const own = makeInstance(balduvianBears.id, {
            id: "own1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, own] }),
                makePlayer("p2"),
            ],
        });
        exileAndScheduleReturn(state, p, "own1");
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);

        const returned = state.players[0].battlefield.find(
            (c) => c.id === "own1"
        );
        expect(returned).toBeDefined();
        expect(returned?.controllerId).toBe("p1");
        const pheliaAfter = state.players[0].battlefield.find(
            (c) => c.id === "pheliaA"
        )!;
        expect(pheliaAfter.counters).toEqual({ "+1/+1": 1 });

        // Wire format — the counter is board-visible.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "pheliaA"
        )!;
        expect(slim.counters).toEqual({ "+1/+1": 1 });
    });

    it("does NOT put a counter when the returned permanent enters under its OWNER's control, not yours (opponent's permanent)", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaB",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(balduvianBears.id, {
            id: "theirs1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        exileAndScheduleReturn(state, p, "theirs1");
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "theirs1"
        );
        expect(returned).toBeDefined();
        expect(returned?.controllerId).toBe("p2");
        const pheliaAfter = state.players[0].battlefield.find(
            (c) => c.id === "pheliaB"
        )!;
        expect(pheliaAfter.counters).toBeUndefined();
    });

    it("does NOT put a counter when the exiled permanent's controller differs from its owner — it returns under the OWNER, not the previous (Phelia's) controller", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaC",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Owned by p2, but currently CONTROLLED by p1 (Phelia's controller,
        // e.g. a stolen permanent) at the moment it's exiled. CR 800.4a — a
        // returned object enters under its OWNER's control, so it comes
        // back to p2, not p1, even though p1 controlled it going in.
        const stolen = makeInstance(balduvianBears.id, {
            id: "stolen1",
            controllerId: "p1",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, stolen] }),
                makePlayer("p2"),
            ],
        });
        exileAndScheduleReturn(state, p, "stolen1");
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "stolen1"
        );
        expect(returned).toBeDefined();
        expect(returned?.controllerId).toBe("p2"); // back to its OWNER
        const pheliaAfter = state.players[0].battlefield.find(
            (c) => c.id === "pheliaC"
        )!;
        expect(pheliaAfter.counters).toBeUndefined();
    });

    it("skips the counter placement cleanly when Phelia herself has left the battlefield before the trigger fires", () => {
        const p = makeInstance(phelia.id, {
            id: "pheliaD",
            controllerId: "p1",
            ownerId: "p1",
        });
        const own = makeInstance(balduvianBears.id, {
            id: "own2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p, own] }),
                makePlayer("p2"),
            ],
        });
        exileAndScheduleReturn(state, p, "own2");
        // Phelia leaves the battlefield before the delayed trigger fires.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "pheliaD"
        );
        expect(() => {
            fireDelayedTriggers(state, "next-end-step");
            while (state.stack.length > 0) resolveTopOfStack(state);
        }).not.toThrow();
        const returned = state.players[0].battlefield.find(
            (c) => c.id === "own2"
        );
        expect(returned).toBeDefined();
    });
});

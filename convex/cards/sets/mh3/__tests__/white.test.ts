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
import { projectPublicState } from "../../../../gameProjections";
import { guideOfSouls } from "../white";

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

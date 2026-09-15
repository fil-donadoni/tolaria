// Replicate — CR 702.56 (issue #2100).
//
// CR 702.56a: "'Replicate [cost]' means 'As an additional cost to cast this
// spell, you may pay [cost] any number of times' and 'When you cast this
// spell, if a replicate cost was paid for it, copy it for each time its
// replicate cost was paid. If the spell has any targets, you may choose new
// targets for any of the copies.'"
//
// The cost half is an Additional Cost Keyword entry (ADR 0085) that is never a
// kick; the trigger half is the Cast-Copy mechanism Storm introduced (ADR 0052,
// amended), fed a different count. Storm's own suite (`storm.test.ts`) is the
// regression proof for the shared machinery; what this file proves is the
// Replicate count provider and the not-a-kick split, through the REAL commit
// path (`finalizeTargetSelection`, `convex/game.ts`) and the real resolution
// machinery, with Lose Focus (`mh2/blue.ts`) as the card.
import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
    type StackItem,
} from "../state";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { loseFocus } from "../../cards/sets/mh2/blue";
import { lightningBolt } from "../../cards/sets/lea";
import {
    additionalCostPaidCount,
    kickedCountOfPayments,
    resolveKickerPayments,
    totalKickerCount,
} from "../kicker";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";

const LOSE_FOCUS = "lf";

/** p1 holds Lose Focus with exactly enough mana for {1}{U} plus `times`
 *  replicate payments; p2 has `boltCount` Lightning Bolts on the stack. */
function board(
    boltCount: number,
    times: number
): { state: GameState; bolts: StackItem[] } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(loseFocus.id, {
                        id: LOSE_FOCUS,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                // CR 601.2f — replicate is an ADDITIONAL cost: {1}{U} printed
                // plus {U} per payment.
                manaPool: { W: 0, U: 1 + times, B: 0, R: 0, G: 0, C: 1 },
            }),
            makePlayer("p2"),
        ],
    });
    const bolts = Array.from({ length: boltCount }, () =>
        pushSpell(state, lightningBolt.id, "p2", [{ type: "player", id: "p1" }])
    );
    return { state, bolts };
}

/** Casts Lose Focus at `targetId` paying replicate `times` times, through the
 *  real commit path (which also emits the cast event, CR 601.2i). */
function castLoseFocus(state: GameState, targetId: string, times: number) {
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: LOSE_FOCUS,
        targetType: "spell",
        count: 1,
        selected: [{ type: "spell", id: targetId }],
        ...(times > 0 ? { kickerPayments: { replicate: times } } : {}),
    };
    finalizeTargetSelection(state, pt, "p1");
    expect(
        state.stack.find((s) => s.id === LOSE_FOCUS),
        "Lose Focus never reached the stack"
    ).toBeDefined();
}

const replicateTriggers = (state: GameState) =>
    state.stack.filter((s) => s.triggeredAbilityId === "replicate");

const copiesOnStack = (state: GameState) =>
    state.stack.filter((s) => s.isCopy === true && s.card.id === loseFocus.id);

/** Resolves the replicate trigger to completion, KEEPING every copy's
 *  inherited target (each copy suspends for its CR 707.10c offer, because
 *  the original Lose Focus is always an alternative spell target). */
function resolveTriggerKeepingTargets(state: GameState): void {
    let guard = 0;
    while (replicateTriggers(state).length > 0 && guard++ < 16) {
        resolveTopOfStack(state);
        if (state.pendingTarget?.kind === "copy-retarget") {
            state.pendingTarget = undefined;
        }
    }
    expect(guard, "the replicate trigger never finished").toBeLessThan(16);
}

describe("Replicate — the cost half is not a kick (CR 702.56a / 702.33d)", () => {
    it("is payable any number of times", () => {
        expect(resolveKickerPayments(loseFocus, { replicate: 3 })).toEqual({
            replicate: 3,
        });
    });

    it("lands in the unkicked record, so getKickerCount() reads 0", () => {
        const { state, bolts } = board(1, 2);
        castLoseFocus(state, bolts[0].id, 2);
        const spell = state.stack.find((s) => s.id === LOSE_FOCUS)!;
        // CR 702.33d defines "kicked" over KICKER costs alone.
        expect(spell.kickerPayments).toBeUndefined();
        expect(spell.unkickedCostPayments).toEqual({ replicate: 2 });
        // `SpellContext.getKickerCount()` is `totalKickerCount` over this
        // record, and the announcement-time twin asks the same split.
        expect(totalKickerCount(spell.kickerPayments)).toBe(0);
        expect(kickedCountOfPayments(loseFocus, { replicate: 2 })).toBe(0);
        // The per-id question still sees the payments.
        expect(additionalCostPaidCount(spell, "replicate")).toBe(2);
    });
});

describe("Replicate — the cast-copy trigger (CR 702.56a)", () => {
    it("puts no trigger on the stack when the cost was not paid (CR 603.4)", () => {
        const { state, bolts } = board(1, 0);
        castLoseFocus(state, bolts[0].id, 0);
        expect(replicateTriggers(state)).toHaveLength(0);
        expect(state.stack.map((s) => s.id)).toEqual([bolts[0].id, LOSE_FOCUS]);
    });

    it("copies the spell once per payment", () => {
        const { state, bolts } = board(1, 3);
        castLoseFocus(state, bolts[0].id, 3);
        const [trigger] = replicateTriggers(state);
        expect(trigger, "no replicate trigger was collected").toBeDefined();
        // CR 405.2 — the trigger sits above the spell and resolves first.
        expect(state.stack[state.stack.length - 1].id).toBe(trigger.id);
        expect(trigger.castCopiesRemaining).toBe(3);

        resolveTriggerKeepingTargets(state);
        expect(copiesOnStack(state)).toHaveLength(3);
        // CR 707.10 — a copy is not cast, so no copy re-triggers replicate.
        expect(replicateTriggers(state)).toHaveLength(0);
        for (const copy of copiesOnStack(state)) {
            expect(copy.targets).toEqual([{ type: "spell", id: bolts[0].id }]);
        }
    });

    it("still copies the spell when the original was countered first", () => {
        const { state, bolts } = board(1, 2);
        castLoseFocus(state, bolts[0].id, 2);
        // The original leaves the stack before the trigger above it resolves.
        state.stack = state.stack.filter((s) => s.id !== LOSE_FOCUS);

        resolveTriggerKeepingTargets(state);
        expect(copiesOnStack(state)).toHaveLength(2);
    });

    it("lets the caster choose a new target for a copy (CR 707.10c)", () => {
        const { state, bolts } = board(2, 1);
        const [first, second] = bolts;
        castLoseFocus(state, first.id, 1);

        resolveTopOfStack(state); // the trigger creates the copy and offers
        const offer = state.pendingTarget;
        expect(offer?.kind).toBe("copy-retarget");
        expect(offer?.playerId).toBe("p1");
        // Redirect the copy at the second Bolt through the real mutation path.
        finalizeTargetSelection(
            state,
            { ...offer!, selected: [{ type: "spell", id: second.id }] },
            "p1"
        );

        // Drain: every may-pay is p2 declining {2} (CR 701.6a).
        let guard = 0;
        while (state.stack.length > 0 && guard++ < 32) {
            const head = state.pendingChoices?.[0];
            if (head?.kind === "may-pay") {
                applyMayPaySubmit(state, {
                    playerId: head.playerId,
                    accept: false,
                });
                continue;
            }
            resolveTopOfStack(state);
        }
        expect(state.stack).toHaveLength(0);
        // The copy countered the second Bolt, the original the first: p1
        // took no damage, and both Bolts are in their owner's graveyard.
        expect(state.players[0].life).toBe(20);
        const p2Graveyard = state.players[1].graveyard.map((c) => c.id);
        expect(p2Graveyard).toEqual(
            expect.arrayContaining([first.id, second.id])
        );
    });
});

describe("Replicate — the trigger crosses the wire and the save form", () => {
    it("projects the trigger with its count and without its snapshot", () => {
        const { state, bolts } = board(1, 2);
        castLoseFocus(state, bolts[0].id, 2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.stack.find(
            (s) => s.triggeredAbilityId === "replicate"
        );
        expect(slim).toBeDefined();
        expect(slim!.castCopiesRemaining).toBe(2);
        expect(
            (slim as unknown as { castCopySnapshot?: unknown }).castCopySnapshot
        ).toBeUndefined();
    });

    it("survives a save/load with the trigger still on the stack", () => {
        const { state, bolts } = board(1, 2);
        castLoseFocus(state, bolts[0].id, 2);
        const round = expandState(compactState(state));
        const [trigger] = replicateTriggers(round);
        expect(trigger.castCopiesRemaining).toBe(2);
        expect(trigger.castCopySnapshot?.card.id).toBe(loseFocus.id);

        resolveTriggerKeepingTargets(round);
        expect(copiesOnStack(round)).toHaveLength(2);
    });
});

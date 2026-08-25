// Morph (CR 702.37, issue #2705) — the whole mechanic in one file:
//   - GRE unit: face-down characteristics (702.37a/c), the {3} cast option
//     (702.37a), the special action's timing + cost + parenthetical (702.37e),
//     ETB suppression on turn-up (708.8), and the copy/LKI interaction (707.2).
//   - Integration: `applyTurnPermanentFaceUp` and `tryAutoCommitPendingCast` —
//     the functions the `turnPermanentFaceUp` / `announceCast` mutations call.
//   - Wire format: the opponent's projection never carries the real card id,
//     on the STACK or on the battlefield, before OR after the unmorph.
//   - Serialization: a face-down spell and a face-down permanent survive the DB
//     round-trip.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName, FACE_DOWN_CARD_ID } from "../../cards";
import {
    getAlternativeCost,
    affordableAlternativeCosts,
} from "../alternativeCost";
import {
    MORPH_CAST_ALT_COST_ID,
    canTurnFaceUp,
    getMorphCost,
    morphCastAlternativeCost,
    turnableFaceUpPermanents,
} from "../morph";
import { turnFaceDown, turnFaceUp } from "../faceDown";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { collectTriggers } from "../triggers";
import { applyTurnPermanentFaceUp, tryAutoCommitPendingCast } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import { applyCopy } from "../copy";
import type { CardInstanceState, GameState, StackItem } from "../state";

const ANGEL = getCardByName("Exalted Angel").id;
const PLAINS = getCardByName("Plains").id;
const BEARS = getCardByName("Grizzly Bears").id;

/** `n` untapped Plains on p1's battlefield. */
function plains(n: number): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(PLAINS, {
            id: `plains${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
}

/** p1 controls a FACE-DOWN Exalted Angel plus `lands` untapped Plains. */
function faceDownBoard(lands = 4): {
    state: GameState;
    permanent: CardInstanceState;
} {
    const permanent = makeInstance(ANGEL, {
        id: "morphed",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    turnFaceDown(permanent);
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [permanent, ...plains(lands)] }),
            makePlayer("p2"),
        ],
    });
    return { state, permanent: state.players[0].battlefield[0] };
}

describe("morph — face-down characteristics (CR 702.37a/c)", () => {
    it("a face-down morph creature is a 2/2 with no name, subtypes or abilities", () => {
        const { state, permanent } = faceDownBoard();
        expect(permanent.faceDown).toBe(true);
        expect((permanent.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(permanent.faceDownOf).toBe(ANGEL);
        expect(getEffectivePower(state, permanent)).toBe(2);
        expect(getEffectiveToughness(state, permanent)).toBe(2);
        expect(permanent.subtypes).toEqual([]);
        // The printed Angel has flying; the face-down object has no abilities.
        expect(permanent.staticAbilities).toEqual([]);
    });

    it("turning face up restores the real 4/5 flier (CR 702.37e)", () => {
        const { state, permanent } = faceDownBoard();
        turnFaceUp(permanent);
        expect(permanent.faceDown).toBeUndefined();
        expect(permanent.faceDownOf).toBeUndefined();
        expect((permanent.card as { id: string }).id).toBe(ANGEL);
        expect(getEffectivePower(state, permanent)).toBe(4);
        expect(getEffectiveToughness(state, permanent)).toBe(5);
        expect(permanent.staticAbilities).toContain("flying");
    });
});

describe("morph — the {3} face-down cast option (CR 702.37a)", () => {
    it("resolves the synthesized alternative cost by id", () => {
        const def = getCardByName("Exalted Angel");
        const alt = getAlternativeCost(def, MORPH_CAST_ALT_COST_ID);
        expect(alt).toBeDefined();
        // CR 702.37a — "{3} rather than paying its mana cost", NOT the card's
        // {4}{W}{W} and NOT its {2}{W}{W} morph cost.
        expect(alt!.mana).toEqual({ X: 3 });
    });

    it("is offered to a caster holding the card (CR 702.37a)", () => {
        const angel = makeInstance(ANGEL, {
            id: "in-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [angel], battlefield: plains(3) }),
                makePlayer("p2"),
            ],
        });
        const offered = affordableAlternativeCosts(
            state,
            state.players[0],
            angel
        );
        expect(offered.map((a) => a.id)).toContain(MORPH_CAST_ALT_COST_ID);
    });

    it("is NOT offered for a card without morph", () => {
        expect(
            morphCastAlternativeCost(getCardByName("Grizzly Bears"))
        ).toBeUndefined();
        expect(
            getAlternativeCost(
                getCardByName("Grizzly Bears"),
                MORPH_CAST_ALT_COST_ID
            )
        ).toBeUndefined();
    });
});

describe("morph — the turn-face-up special action (CR 702.37e / 116.2b)", () => {
    it("reads the morph cost off the REAL card behind faceDownOf", () => {
        const { permanent } = faceDownBoard();
        expect(getMorphCost(permanent)).toEqual({ X: 2, W: 2 });
    });

    it("is offered when the controller holds priority and can pay", () => {
        const { state, permanent } = faceDownBoard(4);
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(true);
        expect(turnableFaceUpPermanents(state, state.players[0])).toHaveLength(
            1
        );
    });

    it("is NOT offered to the player who does not control it (CR 702.37e)", () => {
        const { state, permanent } = faceDownBoard(4);
        state.priorityPlayerId = "p2";
        // p2 holds priority AND can afford {2}{W}{W} off their own board, so
        // CONTROL is the only thing making this illegal — without giving p2
        // lands the assertion would pass for the wrong reason.
        state.players[1].battlefield = plains(4).map((c) => ({
            ...c,
            id: `opp-${c.id}`,
            controllerId: "p2",
            ownerId: "p2",
        }));
        expect(canTurnFaceUp(state, state.players[1], permanent)).toBe(false);
    });

    it("is NOT offered without priority (CR 116.2b)", () => {
        const { state, permanent } = faceDownBoard(4);
        state.priorityPlayerId = "p2";
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(false);
    });

    it("IS offered at instant speed with a spell on the stack (CR 116.2b — no timing restriction)", () => {
        const { state, permanent } = faceDownBoard(4);
        // A special action is legal "any time you have priority": unlike
        // `summon-companion` there is no sorcery-timing or empty-stack gate.
        state.stack.push({
            ...makeInstance(BEARS, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
        } as StackItem);
        state.phase = "DECLARE_BLOCKERS";
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(true);
    });

    it("is NOT offered when the morph cost is unaffordable (CR 702.37e 'pay that cost')", () => {
        const { state, permanent } = faceDownBoard(3);
        // {2}{W}{W} needs four mana; three Plains cannot cover it.
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(false);
    });

    it("is NOT offered on a face-down permanent with NO morph cost (CR 702.37e parenthetical)", () => {
        // The Illusionary Mask shape (CR 708.2, ADR 0013): face down, but the
        // real card has no morph ability, so it can't be turned up this way.
        const bears = makeInstance(BEARS, {
            id: "masked",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        turnFaceDown(bears);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bears, ...plains(6)] }),
                makePlayer("p2"),
            ],
        });
        expect(getMorphCost(state.players[0].battlefield[0])).toBeUndefined();
        expect(
            canTurnFaceUp(
                state,
                state.players[0],
                state.players[0].battlefield[0]
            )
        ).toBe(false);
    });

    it("pays the morph cost and turns the permanent face up (integration)", () => {
        const { state, permanent } = faceDownBoard(4);
        applyTurnPermanentFaceUp(state, "p1", permanent.id);
        const after = state.players[0].battlefield.find(
            (c) => c.id === permanent.id
        )!;
        expect(after.faceDown).toBeUndefined();
        expect(getEffectivePower(state, after)).toBe(4);
        // CR 702.37e says "pay that cost", and the morph cost here is
        // {2}{W}{W}: all four Plains go down for it, with nothing floating.
        expect(
            state.players[0].battlefield.filter(
                (c) => c.id.startsWith("plains") && c.isTapped
            )
        ).toHaveLength(4);
        expect(
            Object.values(state.players[0].manaPool).reduce((a, b) => a + b, 0)
        ).toBe(0);
        // CR 116 — nothing goes on the stack, and the pass cycle restarts.
        expect(state.stack).toHaveLength(0);
        expect(state.passCount).toBe(0);
        // CR 117.3c — priority stays with the player who took the action.
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("rejects the action when it is not legal (server re-validation)", () => {
        const { state, permanent } = faceDownBoard(3);
        expect(() =>
            applyTurnPermanentFaceUp(state, "p1", permanent.id)
        ).toThrow();
    });
});

describe("morph — turning face up is not entering the battlefield (CR 708.8)", () => {
    it("fires NO enters-the-battlefield trigger, not even another permanent's watcher", () => {
        const { state, permanent } = faceDownBoard(4);
        // Spreading Plague: "Whenever a creature enters, destroy all other
        // creatures that share a color with it" — an ANY-scope ETB watcher, on
        // the OPPONENT's board. If the turn-up emitted an enters-the-
        // battlefield event this would collect a trigger, which is precisely
        // what CR 708.8 forbids. A watcher belonging to another permanent is
        // the strong form of the rule: Exalted Angel has no ETB trigger of its
        // own, so asserting only on the Angel would prove nothing.
        state.players[1].battlefield.push(
            makeInstance(getCardByName("Spreading Plague").id, {
                id: "watcher",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        applyTurnPermanentFaceUp(state, "p1", permanent.id);
        // No trigger reached the stack, and none is waiting off-stack.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTriggerBatch ?? []).toHaveLength(0);
        // …and no PERMANENT_ENTERED event was emitted for the turn-up.
        expect(
            (state.pendingEvents ?? []).filter(
                (e) => e.type === "PERMANENT_ENTERED"
            )
        ).toHaveLength(0);

        // NON-VACUITY CONTROL. The two assertions above are absences, and an
        // absence proves nothing unless the thing could have been present. Feed
        // the SAME state a real PERMANENT_ENTERED for the SAME permanent: the
        // watcher fires. So the watcher is live, the event shape is the one
        // this engine emits, and the only reason nothing triggered above is
        // that the turn-up emitted no such event — which is CR 708.8.
        const after = state.players[0].battlefield.find(
            (c) => c.id === permanent.id
        )!;
        expect(
            collectTriggers(state, [
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: after.id,
                    controllerId: after.controllerId,
                    cardId: (after.card as { id: string }).id,
                    types: [...(after.types ?? [])],
                },
            ]).length
        ).toBeGreaterThan(0);
    });

    it("preserves everything already applied to the face-down permanent (CR 708.8)", () => {
        const { state, permanent } = faceDownBoard(4);
        permanent.isTapped = true;
        permanent.damageMarked = 2;
        permanent.counters = { "+1/+1": 1 };
        permanent.enteredOnTurn = 1;
        applyTurnPermanentFaceUp(state, "p1", permanent.id);
        const after = state.players[0].battlefield.find(
            (c) => c.id === permanent.id
        )!;
        expect(after.id).toBe(permanent.id);
        expect(after.isTapped).toBe(true);
        expect(after.damageMarked).toBe(2);
        expect(after.counters).toEqual({ "+1/+1": 1 });
        expect(after.enteredOnTurn).toBe(1);
        // 4/5 base + the counter, and 2 damage is nowhere near lethal — so the
        // SBA pass the action runs must NOT have binned it.
        expect(getEffectiveToughness(state, after)).toBe(6);
    });
});

describe("morph — copy interaction (CR 707.2)", () => {
    it("a copy of a face-down permanent is a face-down 2/2 that cannot be unmorphed", () => {
        const { state, permanent } = faceDownBoard(6);
        // CR 707.2 — "the copiable values are the values derived from the text
        // printed on the object … as modified by … the values of the
        // characteristics of a face-down permanent". The worked example in the
        // rule is exactly this: a Clone copying a face-down creature becomes a
        // colourless 2/2 with no abilities, and its controller can't pay to
        // turn it face up.
        const clone = makeInstance(BEARS, {
            id: "clone",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(clone);
        applyCopy(clone, permanent);
        const copied = state.players[0].battlefield.find(
            (c) => c.id === "clone"
        )!;
        expect(getEffectivePower(state, copied)).toBe(2);
        expect(getEffectiveToughness(state, copied)).toBe(2);
        // No morph cost is copied — the copy has no way to turn face up.
        expect(canTurnFaceUp(state, state.players[0], copied)).toBe(false);
    });
});

describe("morph — wire redaction (CR 702.37c, issue #2705)", () => {
    /** A face-down Exalted Angel SPELL on the stack, cast by p1. */
    function faceDownSpellState(): GameState {
        const item: StackItem = {
            ...makeInstance(ANGEL, {
                id: "spell",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
        };
        turnFaceDown(item);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(item);
        return state;
    }

    it("the opponent's STACK view never carries the real card id", () => {
        const state = faceDownSpellState();
        const opp = projectPublicState(state, 1, "p2");
        const item = opp.stack[0];
        expect(item.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(item.faceDownOf).toBeUndefined();
        // Belt and braces: the real id must not appear anywhere in the wire
        // payload the opponent receives.
        expect(JSON.stringify(opp)).not.toContain(ANGEL);
    });

    it("the caster's own STACK view restores the real card id", () => {
        const state = faceDownSpellState();
        const own = projectPublicState(state, 1, "p1");
        expect(own.stack[0].card.id).toBe(ANGEL);
    });

    it("the opponent's BATTLEFIELD view never carries the real card id, before or after unmorph", () => {
        const { state, permanent } = faceDownBoard(4);
        const before = projectPublicState(state, 1, "p2");
        const slimBefore = before.players[0].battlefield.find(
            (c) => c.id === permanent.id
        )!;
        expect(slimBefore.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(slimBefore.faceDownOf).toBeUndefined();
        expect(JSON.stringify(before)).not.toContain(ANGEL);

        applyTurnPermanentFaceUp(state, "p1", permanent.id);

        // AFTER the unmorph the identity is public (CR 702.37e — "it regains
        // its normal characteristics"), and BOTH views agree on the 4/5.
        const after = projectPublicState(state, 1, "p2");
        const slimAfter = after.players[0].battlefield.find(
            (c) => c.id === permanent.id
        )!;
        expect(slimAfter.card.id).toBe(ANGEL);
        expect(getEffectivePower(after, slimAfter)).toBe(4);
        expect(getEffectiveToughness(after, slimAfter)).toBe(5);
    });

    it("the turn-face-up affordance crosses the wire to the controller ONLY", () => {
        const { state, permanent } = faceDownBoard(4);
        const own = projectPublicState(state, 1, "p1");
        const opp = projectPublicState(state, 1, "p2");
        expect(
            own.players[0].battlefield.find((c) => c.id === permanent.id)!
                .canTurnFaceUp
        ).toBe(true);
        expect(
            opp.players[0].battlefield.find((c) => c.id === permanent.id)!
                .canTurnFaceUp
        ).toBeUndefined();
    });

    it("the affordance is absent when the action is illegal", () => {
        // Three Plains cannot pay {2}{W}{W}.
        const { state, permanent } = faceDownBoard(3);
        const own = projectPublicState(state, 1, "p1");
        expect(
            own.players[0].battlefield.find((c) => c.id === permanent.id)!
                .canTurnFaceUp
        ).toBeUndefined();
    });
});

describe("morph — serialization (issue #2705)", () => {
    it("a face-down permanent survives the DB round-trip", () => {
        const { state, permanent } = faceDownBoard(4);
        const round = expandState(compactState(state));
        const after = round.players[0].battlefield.find(
            (c) => c.id === permanent.id
        )!;
        expect(after.faceDown).toBe(true);
        expect(after.faceDownOf).toBe(ANGEL);
        expect((after.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(canTurnFaceUp(round, round.players[0], after)).toBe(true);
    });

    it("a face-down SPELL on the stack survives the DB round-trip", () => {
        const item: StackItem = {
            ...makeInstance(ANGEL, {
                id: "spell",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
        };
        turnFaceDown(item);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(item);
        const round = expandState(compactState(state));
        expect(round.stack[0].faceDown).toBe(true);
        expect(round.stack[0].faceDownOf).toBe(ANGEL);
    });

    it("a parked morph cast keeps its `morphed` flag across the round-trip and commits face down", () => {
        const angel = makeInstance(ANGEL, {
            id: "in-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [angel],
                    battlefield: plains(3).map((p) => ({
                        ...p,
                        isTapped: true,
                    })),
                    // The {3} is already floating, so the commit fires on the
                    // first drain rather than waiting for another tap.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
                makePlayer("p2"),
            ],
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "in-hand",
            manaCost: { X: 3 },
            tappedLandIds: [],
            keepPriority: false,
            morphed: true,
        };
        const round = expandState(compactState(state));
        expect(round.pendingCast?.morphed).toBe(true);

        tryAutoCommitPendingCast(round, "p1");
        // CR 702.37c — the object put on the stack is the FACE-DOWN 2/2.
        expect(round.stack).toHaveLength(1);
        expect(round.stack[0].faceDown).toBe(true);
        expect(round.stack[0].faceDownOf).toBe(ANGEL);
        expect((round.stack[0].card as { id: string }).id).toBe(
            FACE_DOWN_CARD_ID
        );
        // …and the opponent still cannot see what it is.
        expect(
            JSON.stringify(projectPublicState(round, 1, "p2"))
        ).not.toContain(ANGEL);
    });
});

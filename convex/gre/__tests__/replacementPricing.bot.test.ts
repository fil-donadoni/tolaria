// Replacement-effect pricing (issue #5362): a damage prevention on a
// non-creature permanent is priced by whom it shields, from its controller's
// seat, on the board it stands on. CR 615.1 (prevention), CR 614.1.
//
// Every assertion goes through `evaluate` / `evaluateBreakdown` /
// `permanentRealisedValue` — the surfaces the search reads.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { replacementStandingWorth } from "../ai/replacementPricing";
import {
    evaluate,
    evaluateBreakdown,
    permanentRealisedValue,
} from "../evaluate";
import { beginLayer7Pass } from "../layers";
import type { CardInstanceState, GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2
const GIANT = getCardByName("Hill Giant").id; // 3/3
const CONFINEMENT = getCardByName("Solitary Confinement").id; // prevent damage to you
const W = DEFAULT_EVAL_WEIGHTS;

function inst(
    cardId: string,
    controllerId: string,
    id: string,
    overrides: Partial<CardInstanceState> = {}
) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        ...overrides,
    });
}

function board(
    p1: CardInstanceState[],
    p2: CardInstanceState[],
    hands: { p1?: CardInstanceState[] } = {}
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: p1, hand: hands.p1 ?? [] }),
            makePlayer("p2", { battlefield: p2 }),
        ],
    });
}

const worthOf = (state: GameState, perm: CardInstanceState) =>
    replacementStandingWorth(state, perm, W, beginLayer7Pass(state));

describe("replacement pricing — damage prevention (issue #5362)", () => {
    it("CR 615.1: a shield around its controller reads positive against attackers and zero against none", () => {
        const sc = inst(CONFINEMENT, "p1", "sc");
        const attacked = board([sc], [inst(GIANT, "p2", "giant")]);
        const quiet = board([sc], []);
        expect(worthOf(attacked, sc)).toBeCloseTo(3 * W.lifeWeight, 6);
        expect(worthOf(quiet, sc)).toBe(0);
    });

    it("direction: the same shield on the OTHER side reads negative for the side it does not protect", () => {
        const mine = inst(CONFINEMENT, "p1", "sc");
        const theirs = inst(CONFINEMENT, "p2", "sc2");
        const giantP2 = inst(GIANT, "p2", "g2");
        const bearsP1 = inst(BEARS, "p1", "b1");
        const withMine = board([mine, bearsP1], [giantP2]);
        const withTheirs = board([bearsP1], [giantP2, theirs]);
        const bare = board([bearsP1], [giantP2]);
        // p1's shield: p1 is better off than with no shield.
        expect(evaluate(withMine, "p1")).toBeGreaterThan(
            evaluate(bare, "p1") + 0
        );
        expect(worthOf(withMine, mine)).toBeGreaterThan(0);
        // p2's shield protects p2 from p1's Bears (2 power): worth to p2.
        expect(worthOf(withTheirs, theirs)).toBeCloseTo(2 * W.lifeWeight, 6);
        // And p1 reads that same board lower than the bare one on that term.
        expect(
            evaluateBreakdown(withTheirs, "p1").opp.permanents
        ).toBeGreaterThan(evaluateBreakdown(bare, "p1").opp.permanents);
    });

    it("board-relative: the same card reads different on a different board", () => {
        const sc = inst(CONFINEMENT, "p1", "sc");
        const big = board(
            [sc],
            [inst(GIANT, "p2", "a"), inst(GIANT, "p2", "b")]
        );
        const small = board([sc], [inst(BEARS, "p2", "a")]);
        expect(worthOf(big, sc)).toBeGreaterThan(worthOf(small, sc));
    });

    it("the removal lens carries the worth once: its removal costs what the reading adds", () => {
        const base = getDefinition(CONFINEMENT);
        // Still a measured shield (the body keeps the same face), but its
        // predicate matches nothing, so the reading is zero.
        const blind = {
            ...base,
            replacementEffects: [
                { ...base.replacementEffects![0], appliesTo: () => false },
            ],
        };
        const sc = inst(CONFINEMENT, "p1", "sc");
        const state = board([sc], [inst(GIANT, "p2", "giant")]);
        const read = permanentRealisedValue(state, sc, W);
        const unread = withTemporaryDefinition(blind as never, () =>
            permanentRealisedValue(state, sc, W)
        );
        expect(read - unread).toBeCloseTo(worthOf(state, sc), 6);
        expect(read - unread).toBeGreaterThan(0);
    });

    it("a symmetric prevention (shields both players) reads zero here — PRD #5160 owns it", () => {
        const base = getDefinition(CONFINEMENT);
        const symmetric = {
            ...base,
            replacementEffects: [
                {
                    ...base.replacementEffects![0],
                    appliesTo: (event: {
                        kind: string;
                        target: { type: string };
                    }) =>
                        event.kind === "damage" &&
                        event.target.type === "player",
                },
            ],
        };
        const sc = inst(CONFINEMENT, "p1", "sc");
        const state = board([sc], [inst(GIANT, "p2", "g")]);
        // The attacker must exist on BOTH sides for both players to be hit.
        const both = board(
            [sc, inst(GIANT, "p1", "g1")],
            [inst(GIANT, "p2", "g")]
        );
        withTemporaryDefinition(symmetric as never, () => {
            expect(worthOf(both, sc)).toBe(0);
            expect(worthOf(state, sc)).not.toBe(0); // one-sided on this board
        });
    });

    it("redirection and `other` read zero (fail neutral)", () => {
        const base = getDefinition(CONFINEMENT);
        for (const kind of ["redirection", "other"] as const) {
            const variant = {
                ...base,
                replacementEffects: [
                    { ...base.replacementEffects![0], damageEffectKind: kind },
                ],
            };
            const sc = inst(CONFINEMENT, "p1", "sc");
            const state = board([sc], [inst(GIANT, "p2", "g")]);
            withTemporaryDefinition(variant as never, () => {
                expect(worthOf(state, sc)).toBe(0);
            });
        }
    });

    it("an unhandled eventKind reads zero", () => {
        const base = getDefinition(CONFINEMENT);
        const variant = {
            ...base,
            replacementEffects: [
                {
                    ...base.replacementEffects![0],
                    eventKind: "lifegain" as const,
                },
            ],
        };
        const sc = inst(CONFINEMENT, "p1", "sc");
        const state = board([sc], [inst(GIANT, "p2", "g")]);
        withTemporaryDefinition(variant as never, () => {
            expect(worthOf(state, sc)).toBe(0);
        });
    });

    it("hand face and board face agree: the card in hand is worth what it adds once entered", () => {
        // Only the replacement is readable on this variant, so the two faces
        // differ by nothing but the board-presence weight.
        const base = getDefinition(CONFINEMENT);
        const only = {
            ...base,
            triggeredAbilities: [],
            staticEffects: [],
            drawStepReplacement: undefined,
        };
        withTemporaryDefinition(only as never, () => {
            const handCard = inst(CONFINEMENT, "p1", "sc", { zone: "hand" });
            const giant = inst(GIANT, "p2", "giant");
            const inHand = board([], [giant], { p1: [handCard] });
            const inPlay = board(
                [{ ...handCard, zone: "battlefield" }],
                [giant]
            );
            const empty = board([], [giant]);
            const handTerm =
                evaluateBreakdown(inHand, "p1").self.hand -
                evaluateBreakdown(empty, "p1").self.hand;
            const boardTerm =
                evaluateBreakdown(inPlay, "p1").self.permanents -
                evaluateBreakdown(empty, "p1").self.permanents;
            const entered = worthOf(inPlay, inPlay.players[0].battlefield[0]);
            expect(entered).toBeCloseTo(3 * W.lifeWeight, 6);
            expect(boardTerm - W.permanentWeight).toBeCloseTo(handTerm, 6);
            expect(handTerm).toBeCloseTo(entered, 6);
        });
    });
});

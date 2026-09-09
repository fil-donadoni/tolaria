// Issue #3081 — an activated ability whose cost declares `{T}` may not fund its
// own MANA leg from its own source: the {T} leg already spends that permanent.
//
// `planManaPayment` (moves.ts) built its source list from every untapped
// permanent the player controlled, the ability's source included, so a land
// carrying both a `{T}: Add {W}` mana ability and a `{3}{W}, {T}` ability paid
// for its own activation: the Move was enumerated one source short of payable.
//
// What that then did on the board is worth naming exactly, because it is
// SILENT. The Bot announces with an empty pool, so the server defers
// (`pendingActivation`, game.ts) and deliberately leaves the source untapped —
// a {T} cost is re-checked untapped at commit (CR 302.1). The executor walks
// the tap plan, whose entry for the source taps it FOR MANA, and the mana leg
// is paid in full; `tryAutoCommitPendingActivation` then finds `pa.tapSource`
// with `card.isTapped` already true, reads it as a benign double-commit race
// and discards the pending activation with no error. Lands tapped, mana spent,
// nothing on the stack — and a fifth land does not help, because the plan is
// minimum-cardinality and still selects the source itself.
//
// This is a CLASS bug: it reaches any permanent carrying both a mana ability
// and a second `{T}`-costed activated ability. Abandoned Air Temple is simply
// the shape it was observed on ({3}{W}, {T} — four mana off a board of lands).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import { enumerateMoves, planManaPayment, type Move } from "../moves";

const TEMPLE = getCardByName("Abandoned Air Temple").id;
const PLAINS = getCardByName("Plains").id;
const COUNTERS_ABILITY = "abandoned-air-temple-counters";

/** The temple plus `plainsCount` untapped Plains, all controlled by p1. */
function boardWith(plainsCount: number): {
    state: GameState;
    temple: CardInstanceState;
} {
    const temple = makeInstance(TEMPLE, {
        id: "temple",
        controllerId: "p1",
        ownerId: "p1",
        isTapped: false,
    });
    const plains = Array.from({ length: plainsCount }, (_, i) =>
        makeInstance(PLAINS, {
            id: `plains-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            isTapped: false,
        })
    );
    const p1 = makePlayer("p1", { battlefield: [temple, ...plains] });
    return {
        state: makeState({ players: [p1, makePlayer("p2")] }),
        temple,
    };
}

function templeActivations(
    moves: Move[]
): Extract<Move, { kind: "activate-ability" }>[] {
    return moves.filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" && m.abilityId === COUNTERS_ABILITY
    );
}

describe("enumerateMoves — an ability's own {T} source never funds its own cost (CR 602.1, issue #3081)", () => {
    // {3}{W} needs four mana. Three OTHER lands is one short — and is exactly
    // the board on which the Bot used to enumerate the activation, tap four
    // permanents and land nothing on the stack.
    it("does not enumerate the activation when the OTHER sources are one short", () => {
        const { state } = boardWith(3);

        expect(templeActivations(enumerateMoves(state, "p1"))).toEqual([]);
    });

    it("enumerates it with enough other sources, and the tap plan names only those", () => {
        const { state } = boardWith(4);

        const moves = templeActivations(enumerateMoves(state, "p1"));

        expect(moves).toHaveLength(1);
        const plan = moves[0].tapPlan;
        expect(plan).toHaveLength(4);
        expect(plan.map((t) => t.cardInstanceId)).not.toContain("temple");
    });

    // The bar is conditional on the cost really tapping the source. Strip the
    // `{T}` from the same ability and its own land funds it again, exactly as
    // before this issue — three Plains plus the temple's own {W} cover {3}{W}.
    it("an ability with NO {T} in its cost may still be funded by its own source", () => {
        const printed = getDefinition(TEMPLE);
        const abilities = printed.activatedAbilities!.map((a) =>
            a.id === COUNTERS_ABILITY
                ? { ...a, cost: { ...a.cost, tap: false } }
                : a
        );
        const variant: CardDefinition = {
            ...printed,
            activatedAbilities: abilities,
        };

        withTemporaryDefinition(variant, () => {
            const { state } = boardWith(3);

            const moves = templeActivations(enumerateMoves(state, "p1"));

            expect(moves).toHaveLength(1);
            expect(moves[0].tapPlan.map((t) => t.cardInstanceId)).toContain(
                "temple"
            );
        });
    });
});

describe("planManaPayment — barredSourceId (issue #3081)", () => {
    it("excludes the barred permanent from the capacity check and the selection", () => {
        const { state, temple } = boardWith(3);
        const player = state.players[0];

        // Unbarred: the temple funds the fourth mana itself.
        const unbarred = planManaPayment(state, player, { X: 3, W: 1 });
        expect(unbarred).not.toBeNull();
        expect(unbarred!.map((t) => t.cardInstanceId)).toContain("temple");

        // Barred: three Plains cannot cover four mana.
        expect(
            planManaPayment(
                state,
                player,
                { X: 3, W: 1 },
                undefined,
                temple,
                temple.id
            )
        ).toBeNull();
    });

    it("leaves the barred permanent available to a DIFFERENT plan", () => {
        const { state, temple } = boardWith(3);
        const player = state.players[0];

        // Same board, no bar — a spell's plan still spends the temple.
        const plan = planManaPayment(state, player, { W: 4 });

        expect(plan).not.toBeNull();
        expect(plan!.map((t) => t.cardInstanceId)).toContain(temple.id);
    });
});

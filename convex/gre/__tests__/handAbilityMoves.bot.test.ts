// The Bot's candidate set for a HAND-source activated ability (issue #2390).
//
// `enumerateMoves` fed `enumerateAbilityMoves` from the battlefield, the
// graveyard (issue #2339) and an opponent's battlefield (CR 113.3c) — never
// from the HAND. So every `activateFromHand` ability the engine shipped was
// invisible to the Brain: Cycling (CR 702.29a) since it was built, and Ninjutsu
// (CR 702.49a) the day it landed.
//
// The omission is silent by construction, which is why it needs its own test.
// Nothing goes red: `getLegalActions` offers the ability, the human client
// renders its hand menu off that call, `applyActivationCostsForSearch` and
// `findActivationSource` both already knew how to handle a hand source — the
// only thing missing was anyone producing the Move. The bot just never cycles
// and never ninjutsus.
//
// Asserted here: the Move is enumerated, it is gated by the ability's own zone
// flag (a battlefield-only ability is never offered off a hand card), and it is
// APPLICABLE in the search sandbox — an enumerated move the executor refuses
// would be worse than no move at all.

import { describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import { applyMoveInSearch } from "../search";
import { cloneGameState } from "../clone";
import type { GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { refreshExpectedInput } from "../expectedInput";
import { island, swamp, grizzlyBears } from "../../cards/sets/lea";

const FALLEN_SHINOBI = "900c9dfd-ece1-4b09-a801-0fa05e1994b9";

/** p1 attacks p2 with one unblocked 2/2, blockers are in, Fallen Shinobi is in
 *  hand and the {2}{U}{B} is on the board untapped. The one position in which
 *  ninjutsu is legal at all (CR 509.1h). */
function ninjutsuBoard(): { state: GameState; shinobiId: string } {
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p1",
        ownerId: "p1",
        isTapped: true,
        isAttacking: true,
    });
    const lands = [
        makeInstance(island.id, { id: "isl-1", controllerId: "p1" }),
        makeInstance(island.id, { id: "isl-2", controllerId: "p1" }),
        makeInstance(swamp.id, { id: "swp-1", controllerId: "p1" }),
        makeInstance(swamp.id, { id: "swp-2", controllerId: "p1" }),
    ];
    const shinobi = makeInstance(FALLEN_SHINOBI, {
        id: "shinobi",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [bear, ...lands],
                hand: [shinobi],
            }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: ["bear"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        },
    });
    refreshExpectedInput(state);
    return { state, shinobiId: shinobi.id };
}

describe("hand-source activated abilities are enumerated (CR 113.6 / 702.49a)", () => {
    it("offers the ninjutsu activation off a card in hand", () => {
        const { state, shinobiId } = ninjutsuBoard();

        const moves = enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === shinobiId &&
                m.abilityId === "ninjutsu"
        );

        expect(moves).toHaveLength(1);
    });

    it("does not offer it while the attacker is blocked (CR 509.1h)", () => {
        const { state, shinobiId } = ninjutsuBoard();
        state.combat!.blockedAttackerIds = ["bear"];

        const moves = enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "activate-ability" && m.cardInstanceId === shinobiId
        );

        // The cost has no legal victim, so the activation the server would
        // refuse is never offered. An enumerated-but-illegal move is the
        // rollback loop this seam exists to avoid.
        expect(moves).toEqual([]);
    });

    it("does not offer a BATTLEFIELD ability off a card sitting in hand", () => {
        const { state } = ninjutsuBoard();
        // Grizzly Bears has no activated ability at all; the point is the
        // negative: nothing on a hand card is enumerated except an ability that
        // opted into the hand with `activateFromHand`.
        const extra = makeInstance(grizzlyBears.id, {
            id: "bear-in-hand",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].hand.push(extra);

        const moves = enumerateMoves(state, "p1").filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "bear-in-hand"
        );

        expect(moves).toEqual([]);
    });

    it("the enumerated move is APPLICABLE in the search sandbox", () => {
        const { state, shinobiId } = ninjutsuBoard();
        const move = enumerateMoves(state, "p1").find(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === shinobiId &&
                m.abilityId === "ninjutsu"
        )!;
        expect(move).toBeDefined();

        const sandbox = cloneGameState(state);
        applyMoveInSearch(sandbox, "p1", move);

        // The search must pay the same price the server does: the attacker is
        // back in hand, and the ability is on the stack. A sandbox that kept
        // the attacker would score a position live play never reaches.
        const p1 = sandbox.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.some((c) => c.id === "bear")).toBe(false);
        expect(p1.hand.some((c) => c.id === "bear")).toBe(true);
        expect(sandbox.stack.some((i) => i.abilityId === "ninjutsu")).toBe(
            true
        );
    });
});

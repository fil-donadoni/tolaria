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
import { getCardByName } from "../../cards";
import { enumerateMoves } from "../moves";
import { isProbeEligibleMove } from "../ai/dominance";
import { applyMoveInSearch } from "../search";
import { resolveTopOfStack } from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
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

// ---------------------------------------------------------------------------
// The OTHER hand-source cost shape: "Discard this card" (CR 702.29a / 113.6b)
// ---------------------------------------------------------------------------
//
// Issue #2390 built the hand scan against Ninjutsu, whose board-changing cost
// leg is `returnUnblockedAttacker`. The seam is generic over the flag, but the
// coverage was not: `cost.discardThis` — the leg EVERY cycling card and the
// shipped Harvester of Misery pay — had no assertion on either arm. Issue
// #2289 closes that, and adds the two cases Ninjutsu structurally cannot
// exercise: a hand-source ability that TARGETS, and the affordability gate on
// a hand source's mana leg.
//
// Deliberately no cycling-specific branch is asserted anywhere: what is
// checked is the FLAG's behaviour, on two unrelated cards that carry it.

const MARAUDING_MAKO = getCardByName("Marauding Mako").id; // Cycling {1}
const HARVESTER = getCardByName("Harvester of Misery").id; // {1}{B}, discard
const MOUNTAIN = getCardByName("Mountain").id;
const SWAMP = getCardByName("Swamp").id;

/** `lands` untapped basics on p1's board, `handCards` in p1's hand, main phase
 *  with p1 holding priority. */
function handSourceBoard(
    landCardId: string,
    lands: number,
    handCards: { cardId: string; id: string }[]
): GameState {
    const state = makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: Array.from({ length: lands }, (_, i) =>
                    makeInstance(landCardId, {
                        id: `land-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
                hand: handCards.map(({ cardId, id }) =>
                    makeInstance(cardId, {
                        id,
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    refreshExpectedInput(state);
    return state;
}

function activationsOf(state: GameState, instanceId: string) {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "activate-ability" && m.cardInstanceId === instanceId
    );
}

describe("hand-source abilities whose cost DISCARDS the card (CR 113.6b)", () => {
    it("offers the cycling activation off a card in hand", () => {
        const state = handSourceBoard(MOUNTAIN, 1, [
            { cardId: MARAUDING_MAKO, id: "mako" },
        ]);

        const moves = activationsOf(state, "mako");

        expect(moves).toHaveLength(1);
        expect(moves[0].kind === "activate-ability" && moves[0].abilityId).toBe(
            "cycling"
        );
    });

    it("offers NO activation when the mana leg cannot be paid", () => {
        // Cycling {1} with an empty board: `planManaPayment` returns null and
        // the enumerator must drop the move rather than hand the search an
        // activation the server refuses.
        const state = handSourceBoard(MOUNTAIN, 0, [
            { cardId: MARAUDING_MAKO, id: "mako" },
        ]);

        expect(activationsOf(state, "mako")).toEqual([]);
    });

    it("executing it pays the discard: card hand → graveyard, ability on the stack", () => {
        const state = handSourceBoard(MOUNTAIN, 1, [
            { cardId: MARAUDING_MAKO, id: "mako" },
        ]);
        const move = activationsOf(state, "mako")[0];
        expect(move).toBeDefined();

        const sandbox = cloneGameState(state);
        applyMoveInSearch(sandbox, "p1", move);

        const p1 = sandbox.players.find((p) => p.id === "p1")!;
        // The cost is REAL in the sandbox — an unpaid `discardThis` would let
        // the search keep the card AND buy the draw, which is the free-value
        // shape `applyActivationCostsForSearch` exists to prevent.
        expect(p1.hand.some((c) => c.id === "mako")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "mako")).toBe(true);
        expect(sandbox.stack.some((i) => i.abilityId === "cycling")).toBe(true);
    });
});

describe("a TARGETED hand-source ability enumerates its targets (CR 602.2b)", () => {
    const HARVESTER_ABILITY = "harvester-of-misery-discard";

    /** Two swamps (the {1}{B}), Harvester in hand, and two creatures on the
     *  board to target. */
    function harvesterBoard(): GameState {
        const state = handSourceBoard(SWAMP, 2, [
            { cardId: HARVESTER, id: "harvester" },
        ]);
        const p1 = state.players.find((p) => p.id === "p1")!;
        const p2 = state.players.find((p) => p.id === "p2")!;
        p1.battlefield.push(
            makeInstance(grizzlyBears.id, {
                id: "mine",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        p2.battlefield.push(
            makeInstance(grizzlyBears.id, {
                id: "theirs",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        refreshExpectedInput(state);
        return state;
    }

    it("emits one move per legal creature, each carrying its own target", () => {
        const state = harvesterBoard();

        const moves = activationsOf(state, "harvester");

        expect(moves).toHaveLength(2);
        expect(
            moves
                .map((m) =>
                    m.kind === "activate-ability"
                        ? m.targets?.[0]?.id
                        : undefined
                )
                .sort()
        ).toEqual(["mine", "theirs"]);
        for (const m of moves) {
            expect(m.kind === "activate-ability" && m.abilityId).toBe(
                HARVESTER_ABILITY
            );
        }
    });

    it("the executed move carries the chosen target onto the stack", () => {
        const state = harvesterBoard();
        const move = activationsOf(state, "harvester").find(
            (m) =>
                m.kind === "activate-ability" && m.targets?.[0]?.id === "theirs"
        )!;
        expect(move).toBeDefined();

        const sandbox = cloneGameState(state);
        applyMoveInSearch(sandbox, "p1", move);

        const p1 = sandbox.players.find((p) => p.id === "p1")!;
        expect(p1.hand.some((c) => c.id === "harvester")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "harvester")).toBe(true);
        const item = sandbox.stack.find(
            (i) => i.abilityId === HARVESTER_ABILITY
        );
        expect(item).toBeDefined();
        expect(item!.targets?.[0]?.id).toBe("theirs");

        // Resolve it. Carrying the target onto the stack item is only
        // propagation — `applyMoveInSearch` spreads `move.targets` verbatim,
        // so the assertion above can fail only if someone deletes that spread.
        // What the search actually prices is the EFFECT landing on the chosen
        // creature and on no other, which is what makes the target enumeration
        // above worth anything.
        resolveTopOfStack(sandbox);
        const theirs = sandbox.players
            .find((p) => p.id === "p2")!
            .battlefield.find((c) => c.id === "theirs")!;
        const mine = p1.battlefield.find((c) => c.id === "mine")!;
        expect(getEffectivePower(sandbox, theirs)).toBe(0);
        expect(getEffectiveToughness(sandbox, theirs)).toBe(0);
        expect(getEffectivePower(sandbox, mine)).toBe(2);
        expect(getEffectiveToughness(sandbox, mine)).toBe(2);
    });
});

describe("dominance pruning never probes a hand-source activation", () => {
    it("refuses a `discardThis` activation as probe-ineligible", () => {
        // `isProbeEligibleMove` looks its source up on the BATTLEFIELD, so a
        // hand source fails the lookup and the move is refused before the cost
        // scan below it is ever consulted. That is the fail-closed answer this
        // seam wants — a probe applies costs only coarsely, and the whole
        // payoff of a `discardThis` ability is bought by spending the card —
        // but it also means the cost scan's own `cost.discardThis` clause is
        // unreachable in this direction and cannot be what keeps the move.
        // Asserted on the OUTCOME so a future change that teaches the lookup
        // about the hand still has to keep the answer `false`.
        const state = handSourceBoard(MOUNTAIN, 1, [
            { cardId: MARAUDING_MAKO, id: "mako" },
        ]);
        const move = activationsOf(state, "mako")[0];
        expect(move).toBeDefined();

        expect(isProbeEligibleMove(state, "p1", move)).toBe(false);

        // The behaviour that matters, asserted through the enumerator that
        // consumes the predicate: ineligible means KEPT (`enumerateMoves`
        // drops only moves the probe proves dominated), so the activation
        // survives a pruning pass. This one holds through any refactor of the
        // gate above it.
        const kept = enumerateMoves(state, "p1", {
            pruneDominatedNoOps: true,
        }).filter(
            (m) => m.kind === "activate-ability" && m.cardInstanceId === "mako"
        );
        expect(kept).toHaveLength(1);
    });
});

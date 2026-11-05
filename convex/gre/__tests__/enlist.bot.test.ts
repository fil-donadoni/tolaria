// Bot reachability for enlist (CR 702.154, issue #4009), per
// `.claude/rules/gre-development.md` § Bot reachability.
//
// Seam 1 (enumerateMoves): the declined and the paid declaration are both offered.
// Seam 2 (the choice surface): enlist raises no PendingChoice, it rides on the
// `declare-attackers` Move, so there is nothing to freeze on.
// Seam 3 (valuation): the payoff is the trigger's pump, which the search sees
// because the move is applied through the real engine. Pinned end to end by the
// `must` blade entry "enlists a defender to swing for lethal".

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { ENLIST_TRIGGER_ID } from "../../cards/abilities/enlist";
import { withTemporaryDefinition } from "../../cards/registry";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { CardDefinition } from "../../cards/types";
import { mapMoveCardRefs, moveCardRefs } from "../ai/interchangeable";
import { applyMoveForSearch } from "../applyMove";
import { describeMove } from "../describeMove";
import { enumerateAttackerMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import type { CardInstanceState, GameState } from "../state";

type Declaration = Extract<Move, { kind: "declare-attackers" }>;

const POWERLESS: CardDefinition = {
    id: "test-only-powerless",
    rarity: "common",
    name: "Test Powerless",
    oracleText: "",
    manaCost: { X: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 4,
};

function creature(
    id: string,
    over: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(grizzlyBears().id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...over,
    });
}

const enlister = (id = "attacker") =>
    creature(id, { staticAbilities: ["enlist"] });

function openState(battlefield: CardInstanceState[]): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield }),
            makePlayer("p2", { battlefield: [] }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function declarations(state: GameState): Declaration[] {
    return enumerateAttackerMoves(state, state.players[0]).filter(
        (m): m is Declaration => m.kind === "declare-attackers"
    );
}

describe("enlist reachability for the Bot (CR 508.1g / 702.154a)", () => {
    it("offers both the declined and the paid declaration", () => {
        const moves = declarations(
            openState([enlister(), creature("partner")])
        );
        const alone = moves.filter(
            (m) => m.attackerIds.length === 1 && m.attackerIds[0] === "attacker"
        );
        expect(alone.map((m) => m.enlists ?? [])).toEqual([
            [],
            [{ attackerId: "attacker", enlistedId: "partner" }],
        ]);
    });

    it("never offers a partner that is attacking", () => {
        for (const m of declarations(
            openState([enlister(), creature("partner")])
        )) {
            for (const pair of m.enlists ?? []) {
                expect(m.attackerIds).not.toContain(pair.enlistedId);
            }
        }
    });

    it("never offers enlist for a creature without it", () => {
        for (const m of declarations(
            openState([creature("plain"), creature("partner")])
        )) {
            expect(m.enlists).toBeUndefined();
        }
    });

    it("never offers a partner with no power: the tap would buy nothing (CR 107.1b)", () => {
        withTemporaryDefinition(POWERLESS, () => {
            const wall = makeInstance(POWERLESS.id, {
                id: "wall",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            });
            expect(
                declarations(openState([enlister(), wall])).some(
                    (m) => (m.enlists ?? []).length > 0
                )
            ).toBe(false);
        });
    });

    it("the paid variants never crowd a plain attack out of a wide board's window", () => {
        const plainBoard = [1, 2, 3, 4, 5, 6, 7].map((n) => creature(`c${n}`));
        const plain = declarations(openState(plainBoard)).length;
        const moves = declarations(
            openState([
                enlister("c0"),
                ...plainBoard.slice(0, plainBoard.length - 1),
            ])
        );
        const unpaid = moves.filter((m) => m.enlists === undefined);
        expect(unpaid.length).toBe(plain);
        expect(moves.length).toBeLessThanOrEqual(plain + 16);
        expect(moves.some((m) => (m.enlists ?? []).length > 0)).toBe(true);
    });

    it("the search applies it through the real engine: partner tapped, trigger on the stack, no choice", () => {
        const state = openState([enlister(), creature("partner")]);
        applyMoveInSearch(state, "p1", {
            kind: "declare-attackers",
            attackerIds: ["attacker"],
            enlists: [{ attackerId: "attacker", enlistedId: "partner" }],
        });

        expect(
            state.players[0].battlefield.find((c) => c.id === "partner")
                ?.isTapped
        ).toBe(true);
        expect(state.stack.map((i) => i.triggeredAbilityId)).toEqual([
            ENLIST_TRIGGER_ID,
        ]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("the greedy sim's leaf sees the pump: the partner's power reaches the defender", () => {
        const state = openState([enlister(), creature("partner")]);
        const lifeBefore = state.players[1].life;
        const next = applyMoveForSearch(state, "p1", {
            kind: "declare-attackers",
            attackerIds: ["attacker"],
            enlists: [{ attackerId: "attacker", enlistedId: "partner" }],
        });

        expect(next.players[1].life).toBe(lifeBefore - 4);
    });

    it("the symmetry keyer sees both creatures of a pair, and rewrites both", () => {
        const move: Move = {
            kind: "declare-attackers",
            attackerIds: ["attacker"],
            enlists: [{ attackerId: "attacker", enlistedId: "partner" }],
        };
        expect(moveCardRefs(move)).toEqual(
            expect.arrayContaining(["attacker", "partner"])
        );
        expect(mapMoveCardRefs(move, (id) => `${id}-mapped`)).toMatchObject({
            enlists: [
                {
                    attackerId: "attacker-mapped",
                    enlistedId: "partner-mapped",
                },
            ],
        });
    });

    it("the trace line tells the paid declaration from the plain one", () => {
        const state = openState([enlister(), creature("partner")]);
        expect(
            describeMove(
                {
                    kind: "declare-attackers",
                    attackerIds: ["attacker"],
                    enlists: [
                        { attackerId: "attacker", enlistedId: "partner" },
                    ],
                },
                state
            )
        ).toContain("enlist:");
    });
});

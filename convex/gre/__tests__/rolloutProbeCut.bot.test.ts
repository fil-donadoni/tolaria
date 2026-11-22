// The rollout probe cut (ADR 0184, issue #10473): on a ply with more than
// `ROLLOUT_PROBE_CAP` candidates the rollout's greedy pick probes the ply's
// decline and the best of the rest, never every candidate. Every list below
// comes from `enumerateMoves` on a hand-built board, so the candidates are the
// ones a rollout actually sees.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../moves";
import {
    ROLLOUT_PROBE_CAP,
    isRolloutDecline,
    rolloutProbeCandidates,
} from "../rolloutProbeCut";
import type { CardInstanceState, GameState } from "../state";

const SWAMP = getCardByName("Swamp").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BOLT = getCardByName("Lightning Bolt").id;
const BEARS = getCardByName("Grizzly Bears").id;
const LEECH = getCardByName("Andradite Leech").id;
const EMPEROR = getCardByName("Emperor of Bones").id;

function card(
    cardId: string,
    id: string,
    zone: "hand" | "battlefield",
    controllerId = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone,
        isSummoningSick: false,
    });
}

function mainPhase(
    hand: CardInstanceState[],
    battlefield: CardInstanceState[]
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { hand, battlefield }),
            makePlayer("p2", {
                battlefield: [card(BEARS, "opp-bears", "battlefield", "p2")],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const swamps = (n: number) =>
    Array.from({ length: n }, (_, i) =>
        card(SWAMP, `swamp-${i}`, "battlefield")
    );

/** The attack declaration window, nothing declared yet (CR 508.1). */
const COMBAT_OPEN = {
    attackerIds: [],
    confirmed: false,
    blockerAssignments: {},
    blockersConfirmed: false,
};

function abilityOf(move: Move): string | undefined {
    return move.kind === "activate-ability" ? move.cardInstanceId : undefined;
}

describe("rolloutProbeCandidates (ADR 0184, issue #10473)", () => {
    it("probes a ply of ROLLOUT_PROBE_CAP candidates or fewer whole", () => {
        const state = mainPhase(
            [card(MOUNTAIN, "land", "hand")],
            [card(MOUNTAIN, "m1", "battlefield")]
        );
        const moves = enumerateMoves(state, "p1");
        expect(moves.length).toBeLessThanOrEqual(ROLLOUT_PROBE_CAP);
        expect(rolloutProbeCandidates(moves)).toEqual(moves);
    });

    // A priority ply: `pass` is the decline, and the kind rank fills the
    // other two probes — a land and a spell before any activation.
    it("keeps pass and the two best kinds of a priority ply", () => {
        const state = mainPhase(
            [card(SWAMP, "swamp-hand", "hand"), card(BOLT, "bolt", "hand")],
            [
                card(MOUNTAIN, "m1", "battlefield"),
                ...swamps(2),
                card(LEECH, "leech-a", "battlefield"),
                card(EMPEROR, "emperor", "battlefield"),
            ]
        );
        // Reversed, so the activations come first: the rank, not the
        // enumerator's own order, is what puts the land and the spell ahead.
        const moves = enumerateMoves(state, "p1").reverse();
        expect(moves[0].kind).toBe("activate-ability");
        const kept = rolloutProbeCandidates(moves);
        expect(kept.map((m) => m.kind).sort()).toEqual([
            "cast-spell",
            "pass",
            "play-land",
        ]);
    });

    // The cut's known blindness, pinned so a change to it is a decision:
    // between candidates of one kind on a priority ply it keeps enumeration
    // order, so two pumps enumerated before Adapt are the two it probes (the
    // blade's stretch entry "rollout probe cut: holds Emperor of Bones'
    // Adapt …" reads what that costs on a wide board).
    it("keeps candidates of one kind in enumeration order on a priority ply", () => {
        const state = mainPhase(
            [],
            [
                ...swamps(6),
                card(LEECH, "leech-a", "battlefield"),
                card(LEECH, "leech-b", "battlefield"),
                card(EMPEROR, "emperor", "battlefield"),
            ]
        );
        const moves = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "pass" || m.kind === "activate-ability"
        );
        expect(moves.map(abilityOf)).toEqual([
            undefined,
            "leech-a",
            "leech-b",
            "emperor",
        ]);
        const kept = rolloutProbeCandidates(moves);
        expect(kept.map(abilityOf)).toEqual([undefined, "leech-a", "leech-b"]);
    });

    // A declaration ply offers no `pass`: the empty declaration is the
    // decline. Every candidate is one kind, and the power set enumerates the
    // single attackers first and the full attack last, so the pick must be
    // handed the ply's two ends: nobody attacking and everybody attacking.
    it("keeps the empty and the widest attack of an attack declaration ply", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        card(BEARS, "bears-a", "battlefield"),
                        card(LEECH, "leech-a", "battlefield"),
                        card(EMPEROR, "emperor", "battlefield"),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
            combat: COMBAT_OPEN,
        });
        const moves = enumerateMoves(state, "p1");
        expect(moves.length).toBeGreaterThan(ROLLOUT_PROBE_CAP);
        expect(moves.some((m) => m.kind === "pass")).toBe(false);
        const kept = rolloutProbeCandidates(moves);
        expect(kept).toHaveLength(ROLLOUT_PROBE_CAP);
        expect(kept.filter(isRolloutDecline)).toEqual([
            { kind: "declare-attackers", attackerIds: [] },
        ]);
        const widths = kept.map((m) =>
            m.kind === "declare-attackers" ? m.attackerIds.length : -1
        );
        expect(Math.max(...widths)).toBe(3);
    });

    // The defender's side of the same ply: no block, and the block that uses
    // every blocker, are both probed.
    it("keeps the empty and the widest block of a block declaration ply", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        {
                            ...card(EMPEROR, "attacker", "battlefield"),
                            isTapped: true,
                        },
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        card(BEARS, "bears-a", "battlefield", "p2"),
                        card(LEECH, "leech-a", "battlefield", "p2"),
                    ],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["attacker"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const moves = enumerateMoves(state, "p2");
        expect(moves.length).toBeGreaterThan(ROLLOUT_PROBE_CAP);
        const kept = rolloutProbeCandidates(moves);
        expect(kept.filter(isRolloutDecline)).toEqual([
            { kind: "declare-blockers", assignments: [] },
        ]);
        const widths = kept.map((m) =>
            m.kind === "declare-blockers" ? m.assignments.length : -1
        );
        expect(Math.max(...widths)).toBe(2);
    });

    it("returns the kept moves in enumeration order, the same every time, and leaves the list alone", () => {
        const state = mainPhase(
            [],
            [
                ...swamps(6),
                card(LEECH, "leech-a", "battlefield"),
                card(LEECH, "leech-b", "battlefield"),
                card(EMPEROR, "emperor", "battlefield"),
            ]
        );
        const moves = enumerateMoves(state, "p1");
        const before = [...moves];
        const once = rolloutProbeCandidates(moves);
        const twice = rolloutProbeCandidates(moves);
        expect(twice).toEqual(once);
        expect(moves).toEqual(before);
        const at = once.map((m) => moves.indexOf(m));
        expect([...at].sort((a, b) => a - b)).toEqual(at);
    });
});

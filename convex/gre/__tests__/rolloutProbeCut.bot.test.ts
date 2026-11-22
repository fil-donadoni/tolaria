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
import { makeRng } from "../rng";
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

/** A stream that never ties: the cut's lot is the only draw it makes. */
const rng = () => makeRng(7);

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
        expect(rolloutProbeCandidates(state, moves, rng())).toEqual(moves);
    });

    // Two identical pump creatures enumerated before the Emperor: by kind
    // alone the two kept activations are both pumps, and the one play that
    // does something else on the ply — Adapt — is never probed (the blade's
    // stretch entry "rollout probe cut: holds Emperor of Bones' Adapt …").
    it("ranks a repeat of a kept play after every play that does something else", () => {
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
        const kept = rolloutProbeCandidates(state, moves, rng());
        expect(kept.map(abilityOf)).toEqual([undefined, "leech-a", "emperor"]);
    });

    it("keeps the second copy of a land behind a spell, whatever the kind rank says", () => {
        const state = mainPhase(
            [
                card(SWAMP, "swamp-hand-a", "hand"),
                card(SWAMP, "swamp-hand-b", "hand"),
                card(BOLT, "bolt", "hand"),
            ],
            [card(MOUNTAIN, "m1", "battlefield")]
        );
        const moves = enumerateMoves(state, "p1");
        const kept = rolloutProbeCandidates(state, moves, rng());
        expect(kept).toHaveLength(ROLLOUT_PROBE_CAP);
        expect(kept[0]).toEqual({ kind: "pass" });
        expect(
            kept.filter((m) => m.kind === "play-land").map((m) => m.kind)
        ).toEqual(["play-land"]);
        expect(kept.some((m) => m.kind === "cast-spell")).toBe(true);
    });

    // A declaration ply offers no `pass`: the empty declaration is the
    // decline, and a cut that dropped it would have every mover attack and
    // every defender block in every rollout.
    it("never drops the empty declaration of a declaration ply", () => {
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
        for (let seed = 0; seed < 20; seed++) {
            const kept = rolloutProbeCandidates(state, moves, makeRng(seed));
            expect(kept.filter(isRolloutDecline)).toEqual([
                { kind: "declare-attackers", attackerIds: [] },
            ]);
        }
    });

    // Candidates of one kind are drawn by lot, not kept in enumeration order:
    // across rollouts every one of them is probed, the last enumerated one
    // included. In enumeration order it never would be.
    it("draws equal kinds by lot, so the last one enumerated is probed in some rollouts", () => {
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
        const last = moves[moves.length - 1];
        let probedLast = 0;
        for (let seed = 0; seed < 40; seed++) {
            const kept = rolloutProbeCandidates(state, moves, makeRng(seed));
            if (kept.includes(last)) probedLast += 1;
        }
        expect(probedLast).toBeGreaterThan(0);
    });

    it("returns the kept moves in enumeration order, the same for the same stream, and leaves the list alone", () => {
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
        const once = rolloutProbeCandidates(state, moves, makeRng(3));
        const twice = rolloutProbeCandidates(state, moves, makeRng(3));
        expect(twice).toEqual(once);
        expect(moves).toEqual(before);
        const at = once.map((m) => moves.indexOf(m));
        expect([...at].sort((a, b) => a - b)).toEqual(at);
    });
});

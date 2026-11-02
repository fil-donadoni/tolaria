// `vote` (CR 701.38, issue #2071) — a NEW Op, so it earns the full per-Op
// regime: the pure tally, the construct it is read through (a `forEach` over
// the picks binding it writes), the suspend-per-voter sequence, and one
// wire-format assertion. Inherited free by every later card that votes for an
// object.
//
// The script under test is Council's Judgment's own shape: "Starting with you,
// each player votes for a nonland permanent you don't control. Exile each
// permanent with the most votes or tied for most votes."

import { describe, expect, it } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import type { GameState } from "../../state";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { projectPublicState } from "../../../gameProjections";
import { tallyVotes } from "../../voteTally";
import { validateEffectScript } from "../validate";

describe("tallyVotes — most votes or tied for most (CR 701.38)", () => {
    it("no votes, no winners", () => {
        expect(tallyVotes([])).toEqual([]);
    });

    it("a 1–1 split in a two-player game is a tie: BOTH win", () => {
        expect(tallyVotes(["a", "b"])).toEqual(["a", "b"]);
    });

    it("two votes for one choice: that choice alone wins", () => {
        expect(tallyVotes(["a", "a"])).toEqual(["a"]);
        expect(tallyVotes(["b", "a", "a"])).toEqual(["a"]);
    });

    it("every choice tied for most wins, once each, in first-vote order", () => {
        expect(tallyVotes(["c", "a", "a", "c", "b"])).toEqual(["c", "a"]);
    });
});

const RELIC_ID = "test-vote-relic";
registerTokenDefinition({
    id: RELIC_ID,
    name: "Vote Relic",
    rarity: "common",
    manaCost: { C: 2 },
    types: ["Artifact"],
});
const WARD_ID = "test-vote-hexproof-bear";
registerTokenDefinition({
    id: WARD_ID,
    name: "Hexproof Bear",
    rarity: "common",
    manaCost: { G: 2 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
    staticAbilities: ["Hexproof"],
});
const LAND_ID = "test-vote-land";
registerTokenDefinition({
    id: LAND_ID,
    name: "Vote Land",
    rarity: "common",
    types: ["Land"],
});

const JUDGMENT: EffectOp[] = [
    {
        op: "vote",
        candidates: {
            set: "permanents",
            zone: "battlefield",
            controller: "opponent",
            filter: { excludeType: "Land" },
        },
        prompt: "Vote for a nonland permanent you don't control.",
        bind: "$winners",
    },
    {
        op: "forEach",
        select: { set: "bound", ref: "$winners" },
        effects: [{ op: "exile", target: { ref: "$each" } }],
    },
];
const JUDGMENT_ID = "test-vote-judgment";
registerTokenDefinition({
    id: JUDGMENT_ID,
    name: "Vote Judgment",
    rarity: "common",
    manaCost: { W: 3 },
    types: ["Sorcery"],
    effects: JUDGMENT,
});

/** p1 casts the vote; p2 controls `p2Board` plus a land, p1 a permanent of
 *  its own. `activePlayerId` is p2, so "starting with you" is visibly NOT
 *  "starting with the active player". */
function cast(p2Board: string[]): GameState {
    const state = makeState({
        activePlayerId: "p2",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(RELIC_ID, { id: "mine", controllerId: "p1" }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    ...p2Board.map((id) =>
                        makeInstance(id === "bear" ? WARD_ID : RELIC_ID, {
                            id,
                            controllerId: "p2",
                        })
                    ),
                    makeInstance(LAND_ID, { id: "land", controllerId: "p2" }),
                ],
            }),
        ],
    });
    pushSpell(state, JUDGMENT_ID, "p1", []);
    resolveTopOfStack(state);
    return state;
}

function vote(state: GameState, permanentId: string) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [permanentId],
    });
}

const exiledIds = (state: GameState) =>
    state.players[1].exile.map((c) => c.id).sort();
const p2BoardIds = (state: GameState) =>
    state.players[1].battlefield.map((c) => c.id).sort();

describe("Op: vote (CR 701.38, issue #2071)", () => {
    it("validates in Council's Judgment's shape", () => {
        expect(
            validateEffectScript({
                id: "vote-probe",
                name: "Vote Probe",
                types: ["Sorcery"],
                effects: JUDGMENT,
            })
        ).toEqual([]);
    });

    it("the candidates must be a permanents set — a players or bound set has no card", () => {
        const errors = validateEffectScript({
            id: "vote-probe-players",
            name: "Vote Probe",
            types: ["Sorcery"],
            effects: [
                {
                    op: "vote",
                    candidates: { set: "players" },
                    prompt: "Vote.",
                    bind: "$w",
                } as unknown as EffectOp,
            ],
        });
        expect(errors.length).toBeGreaterThan(0);
    });

    it("CR 701.38a — the controller votes FIRST, among nonland permanents they don't control", () => {
        const state = cast(["bear", "relic"]);
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-permanents");
        expect(head.count).toBe(1);
        // Never the land, never the voter's own permanent.
        expect([...head.candidateIds!].sort()).toEqual(["bear", "relic"]);
        expect(head.allControllers).toBe(true);
        // The vote moves nothing on its own.
        expect(p2BoardIds(state)).toEqual(["bear", "land", "relic"]);
    });

    it("the next voter in turn order sees the votes already cast", () => {
        const state = cast(["bear", "relic"]);
        vote(state, "relic");
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.prompt).toContain("Votes so far: Vote Relic.");
        expect([...head.candidateIds!].sort()).toEqual(["bear", "relic"]);
    });

    it("1v1: two different votes tie for most — BOTH are exiled", () => {
        const state = cast(["bear", "relic"]);
        vote(state, "relic");
        vote(state, "bear");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exiledIds(state)).toEqual(["bear", "relic"]);
        expect(p2BoardIds(state)).toEqual(["land"]);
        expect(state.stack).toHaveLength(0);
    });

    it("two votes for one permanent exile it alone", () => {
        const state = cast(["bear", "relic"]);
        vote(state, "bear");
        vote(state, "bear");
        expect(exiledIds(state)).toEqual(["bear"]);
        expect(p2BoardIds(state)).toEqual(["land", "relic"]);
    });

    it("the exile does not target: a HEXPROOF permanent is exiled (CR 115.1)", () => {
        const state = cast(["bear", "relic"]);
        vote(state, "bear");
        vote(state, "bear");
        expect(exiledIds(state)).toEqual(["bear"]);
    });

    it("one candidate is no decision: no prompt, it is exiled", () => {
        const state = cast(["bear"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exiledIds(state)).toEqual(["bear"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["mine"]);
    });

    it("no candidates: no vote, nothing exiled, a clean resolution (CR 609.3)", () => {
        const state = cast([]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(exiledIds(state)).toEqual([]);
        expect(p2BoardIds(state)).toEqual(["land"]);
        expect(state.stack).toHaveLength(0);
    });

    it("wire: the vote prompt crosses projectPublicState to the OTHER player too — a vote is public", () => {
        const state = cast(["bear", "relic"]);
        vote(state, "relic");
        // p1 (who already voted) watches p2's prompt: same entry, unredacted.
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.prompt).toContain("Votes so far: Vote Relic.");
        expect([...head.candidateIds!].sort()).toEqual(["bear", "relic"]);
    });
});

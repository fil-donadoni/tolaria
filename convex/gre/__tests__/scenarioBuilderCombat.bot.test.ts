// CR 508.1 / 509.1 (issue #3458, PRD #3397) — the BEHAVIOURAL half of the
// scenario spec's declared combat: what the rebuilt position actually lets the
// seats DO.
//
// The round-trip assertions live beside the builder's other tests
// (`scenarioBuilder.test.ts`); this file reads the legal-move list through
// `enumerateMoves`, which `bot-suite-boundary.test.ts` classifies as a bot-only
// module — the app suite loses the CPU race on those and times out.
//
// The claim it defends is the one the old `dropped[]` note made impossible: a
// position captured DURING the block window rebuilds as the same question. Not
// "a combat object exists" — that a rebuild which rewound to an undeclared
// attack step would offer the attack the seat had already made, and would owe
// the defender nothing at all.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import { buildStateFromScenario, specFromState } from "../scenarioBuilder";
import { buildBladeBaseState } from "../ai/blade/baseState";
import { enumerateMoves } from "../moves";
import { describeMove } from "../describeMove";
import { decidingPlayer } from "../search";
import { lowerDecision } from "../ai/verdicts/lowering";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { shivanDragon } from "../../cards/sets/lea/red";
import type { GameState } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

/** Two creatures, one per seat, at the attack step — the board the blade
 *  `declare-attackers` step walks forward into an open block window. */
const COMBAT_BOARD: ScenarioSpec = {
    cards: [
        { name: grizzlyBears.name, owner: "me" },
        { name: shivanDragon.name, owner: "opp" },
    ],
    phase: "DECLARE_ATTACKERS",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
};

/** The LIVE position: attackers declared through the engine's own move
 *  application, priority walked to the defender's block declaration. */
function blockWindow(): GameState {
    return buildBladeState({
        label: "scenario combat fixture",
        spec: COMBAT_BOARD,
        setup: [{ kind: "declare-attackers" }],
        bot: "opp",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
}

function movesFor(state: GameState, playerId: string): string[] {
    return enumerateMoves(state, playerId)
        .map((move) => describeMove(move, state))
        .sort();
}

describe("a captured block window rebuilds as the same decision (issue #3458)", () => {
    it("owes the DEFENDER the block, and offers the attacker's controller no second attack", () => {
        const live = blockWindow();
        const defenderId = live.players[1].id;
        expect(live.phase).toBe("DECLARE_BLOCKERS");
        expect(decidingPlayer(live)).toBe(defenderId);

        const { spec } = specFromState(live, { mySeatId: defenderId });
        const rebuilt = buildStateFromScenario(buildBladeBaseState(), spec);

        // The judged seat is `"me"` in the spec's own frame, so the DEFENDER
        // is players[0] on the rebuild and the attacker players[1].
        const rebuiltDefenderId = rebuilt.players[0].id;
        expect(rebuilt.phase).toBe("DECLARE_BLOCKERS");
        expect(decidingPlayer(rebuilt)).toBe(rebuiltDefenderId);

        const rebuiltMoves = enumerateMoves(rebuilt, rebuiltDefenderId);
        // CR 509.1a — the block it owed, which a rebuild rewound to the attack
        // step could not offer at all.
        expect(
            rebuiltMoves.some((move) => move.kind === "declare-blockers")
        ).toBe(true);
        // CR 508.1 — and NOT a fresh declaration: the attack already happened.
        expect(
            rebuiltMoves.some((move) => move.kind === "declare-attackers")
        ).toBe(false);
    });

    it("offers the defender exactly the moves the live position did", () => {
        const live = blockWindow();
        const defenderId = live.players[1].id;

        const { spec } = specFromState(live, { mySeatId: defenderId });
        const rebuilt = buildStateFromScenario(buildBladeBaseState(), spec);

        // Compared through the describer, the only vocabulary the two share —
        // the instance ids underneath are allocated by each build separately.
        // This is the check the verdict quiz makes before it files anything
        // (`lowerDecision`'s `different-decision`), run here on the position
        // class that used to fail it.
        expect(movesFor(rebuilt, rebuilt.players[0].id)).toEqual(
            movesFor(live, defenderId)
        );
    });
});

describe("a combat a card name cannot reference is REFUSED (issue #3458)", () => {
    it("refuses when two identically-named permanents differ in their combat role", () => {
        // The failure the widening had to be fail-closed about. Two Grizzly
        // Bears on the same battlefield, told apart only by a counter, and only
        // the SECOND attacking: a presented card name cannot say which, so the
        // rebuild would bind the attack — and every per-instance fact the entry
        // carried — to the other copy. `describeMove` renders both as the same
        // sentence, so the candidate lists would match move for move while the
        // boards differ, which is the one failure nothing downstream can
        // detect. Hence a refusal, not a note.
        const state = buildStateFromScenario(buildBladeBaseState(), {
            cards: [
                { name: grizzlyBears.name, owner: "me" },
                {
                    name: grizzlyBears.name,
                    owner: "me",
                    counters: { "+1/+1": 1 },
                    tapped: true,
                },
                { name: shivanDragon.name, owner: "opp" },
            ],
            phase: "DECLARE_BLOCKERS",
            turn: 5,
            libraryCount: 20,
        });
        const attacker = state.players[0].battlefield[1];
        attacker.isAttacking = true;
        attacker.hasAttackedThisTurn = true;
        state.creatureAttackedThisTurn = true;
        state.combat = {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };

        const outcome = lowerDecision(state, state.players[1].id, "no blocks");

        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("combat-not-captured");
        expect(outcome.dropped.some((note) => note.startsWith("combat:"))).toBe(
            true
        );
    });
});

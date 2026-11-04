// CR 608.2 (issue #5525) — a Bot decision answering a Pending Choice
// raised DURING a resolution lowers into a scenario spec whose rebuild resumes
// the same resolution and re-raises the same choice, so the quiz can judge it.
//
// The live positions are reached through the real engine: a blade-built board,
// the opponent's cast through the setup vocabulary, `resolve-top` through
// `resolveTopOfStack`, an earlier answer through `applyPendingChoiceSubmit`.
// The round trip is proven by what `lowerDecision` already checks — the stack
// fingerprint, the rebuilt deciding seat, the candidate list move for move.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { buildVerdictPosition, candidateMoves } from "../verdicts/candidates";
import { lowerDecision } from "../verdicts/lowering";
import {
    stackFingerprint,
    stackRebuildMismatch,
    type SeatOf,
} from "../verdicts/stackFingerprint";
import { buildStateFromScenario, specFromState } from "../../scenarioBuilder";
import { buildBladeBaseState } from "../blade/baseState";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { describeMove } from "../../describeMove";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import { mindRot } from "../../../cards/sets/por/black.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import type { GameState, StackItem } from "../../state";
import type { CardDefinition } from "../../../cards/types";
import type { BladeSetupStep } from "../blade/types";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

/** Mind Rot's shell with a TWO-step edict body: the target player sacrifices
 *  a creature, then another. Two sequential `choice` Ops is exactly the shape
 *  that puts an answered pick (instance ids) into `collectedChoices` while a
 *  second choice is outstanding — the remap this slice owes a proof for. */
function twoStepEdict(): CardDefinition {
    const printed = mindRot();
    return {
        ...printed,
        oracleText:
            "Target player sacrifices a creature, then sacrifices another creature.",
        effects: [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: { type: "Creature" },
                count: 1,
                prompt: "Choose a creature to sacrifice.",
                bind: "$first",
            },
            { op: "sacrifice", permanents: { ref: "$first" } },
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: { target: 0 },
                zone: "battlefield",
                filter: { type: "Creature" },
                count: 1,
                prompt: "Choose another creature to sacrifice.",
                bind: "$second",
            },
            { op: "sacrifice", permanents: { ref: "$second" } },
        ],
    };
}

/** The Bot's board under the opponent's edict: three creatures with three
 *  different names, so every sacrifice is its own candidate (two same-named
 *  creatures collapse into one, issue #3593). */
const BOARD: ScenarioSpec = {
    cards: [
        { name: "Mind Rot", owner: "opp", zone: "hand" },
        { name: "Swamp", owner: "opp", count: 3 },
        { name: "Grizzly Bears", owner: "me" },
        { name: "Hill Giant", owner: "me" },
        { name: "Prodigal Sorcerer", owner: "me" },
        { name: "Lightning Bolt", owner: "me", zone: "hand" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    activePlayer: "opp",
    landCount: 0,
    libraryCount: 20,
};

function engineBuilt(spec: ScenarioSpec, setup: BladeSetupStep[]): GameState {
    return buildBladeState({
        label: "resolution checkpoint fixture",
        spec,
        setup,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
}

function seatsOf(state: GameState, botId: string): SeatOf {
    return (playerId) =>
        playerId === botId
            ? "me"
            : state.players.some((p) => p.id === playerId)
              ? "opp"
              : null;
}

function lower(state: GameState, botId: string) {
    const [first] = candidateMoves(state, botId);
    return lowerDecision(state, botId, describeMove(first, state));
}

/** The opponent's edict resolving against the Bot: the FIRST sacrifice is
 *  pending, the Bot owes it, nothing has been answered yet. */
function firstChoicePending(): { state: GameState; botId: string } {
    const state = engineBuilt(BOARD, [
        { kind: "cast", card: "Mind Rot", by: "opp", target: "me" },
        { kind: "resolve-top" },
    ]);
    return { state, botId: state.players[0].id };
}

/** The same resolution one answer later: the Bears are sacrificed, the SECOND
 *  sacrifice is pending, and the Bears' instance id sits in the stack item's
 *  `collectedChoices` under `$first`. */
function secondChoicePending(): {
    state: GameState;
    botId: string;
    firstPickId: string;
} {
    const { state, botId } = firstChoicePending();
    const head = state.pendingChoices![0];
    const bears = state.players[0].battlefield.find(
        (c) =>
            (c.card as { id?: string }).id === getCardByName("Grizzly Bears").id
    )!;
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [bears.id],
    });
    return { state, botId, firstPickId: bears.id };
}

function top(state: GameState): StackItem {
    return state.stack[state.stack.length - 1];
}

describe("a decision answering a Pending Choice mid-resolution lowers and rebuilds (issue #5525)", () => {
    it("lowers the first sacrifice pick: the rebuild resumes the edict and offers the same three candidates", () => {
        withTemporaryDefinition(twoStepEdict(), () => {
            const { state, botId } = firstChoicePending();
            expect(state.pendingChoices?.[0].kind).toBe("sacrifice-permanents");
            expect(state.pendingChoices?.[0].playerId).toBe(botId);
            expect(top(state).resolutionStep).toBeDefined();
            expect(candidateMoves(state, botId)).toHaveLength(3);

            const outcome = lower(state, botId);
            if (!outcome.ok) {
                throw new Error(`refused ${outcome.kind}: ${outcome.error}`);
            }
            const entry = outcome.lowered.spec.stack?.[0];
            expect(entry?.resolution?.step).toBe(top(state).resolutionStep);
            expect(outcome.lowered.candidates).toHaveLength(3);

            const rebuilt = buildVerdictPosition(outcome.lowered.spec);
            const rebuiltBot = rebuilt.players[0].id;
            expect(rebuilt.pendingChoices?.[0].kind).toBe(
                "sacrifice-permanents"
            );
            expect(rebuilt.pendingChoices?.[0].playerId).toBe(rebuiltBot);
            expect(rebuilt.priorityPlayerId).toBe(rebuiltBot);
            expect(
                stackRebuildMismatch(
                    state,
                    seatsOf(state, botId),
                    rebuilt,
                    seatsOf(rebuilt, rebuiltBot)
                )
            ).toBeNull();
        });
    });

    it("fingerprints the checkpoint, so a rebuild that lost it is a stack mismatch", () => {
        withTemporaryDefinition(twoStepEdict(), () => {
            const { state, botId } = firstChoicePending();
            const [print] = stackFingerprint(state, seatsOf(state, botId));
            expect(print).toContain(` step=${top(state).resolutionStep}`);

            const { spec } = specFromState(state, { mySeatId: botId });
            const announced: ScenarioSpec = {
                ...spec,
                stack: spec.stack!.map((entry) => {
                    const announcedEntry = { ...entry };
                    delete announcedEntry.resolution;
                    return announcedEntry;
                }),
            };
            const rebuilt = buildStateFromScenario(
                buildBladeBaseState(),
                announced
            );
            expect(
                stackRebuildMismatch(
                    state,
                    seatsOf(state, botId),
                    rebuilt,
                    seatsOf(rebuilt, rebuilt.players[0].id)
                )
            ).toContain("step=");
        });
    });

    it("remaps an answered pick: the sacrificed creature's id is lowered as a graveyard reference and rebuilt to the rebuilt card", () => {
        withTemporaryDefinition(twoStepEdict(), () => {
            const { state, botId, firstPickId } = secondChoicePending();
            expect(candidateMoves(state, botId)).toHaveLength(2);
            const liveKey = Object.keys(top(state).collectedChoices ?? {}).find(
                (key) => key.endsWith(":$first")
            )!;
            expect(top(state).collectedChoices?.[liveKey]).toEqual([
                firstPickId,
            ]);

            const outcome = lower(state, botId);
            if (!outcome.ok) {
                throw new Error(`refused ${outcome.kind}: ${outcome.error}`);
            }
            const collected =
                outcome.lowered.spec.stack?.[0].resolution?.collected;
            expect(collected?.[liveKey]).toEqual([
                {
                    kind: "object",
                    ref: {
                        zone: "graveyard",
                        name: "Grizzly Bears",
                        seat: "me",
                    },
                },
            ]);

            const rebuilt = buildVerdictPosition(outcome.lowered.spec);
            const rebuiltBears = rebuilt.players[0].graveyard.find(
                (c) =>
                    (c.card as { id?: string }).id ===
                    getCardByName("Grizzly Bears").id
            )!;
            const rebuiltAnswer = top(rebuilt).collectedChoices?.[liveKey];
            expect(rebuiltAnswer).toEqual([rebuiltBears.id]);
            // A reassigned id, never the live one copied across.
            expect(rebuiltBears.id).not.toBe(firstPickId);
            expect(outcome.lowered.candidates).toHaveLength(2);
        });
    });

    it("refuses BY FIELD a choice with no checkpoint behind it, and a collected answer whose binding has no declared family", () => {
        withTemporaryDefinition(twoStepEdict(), () => {
            const unchecked = firstChoicePending();
            delete top(unchecked.state).resolutionStep;
            const noCheckpoint = lower(unchecked.state, unchecked.botId);
            expect(noCheckpoint.ok).toBe(false);
            if (noCheckpoint.ok) return;
            expect(noCheckpoint.kind).toBe("stack-not-lowerable");
            expect(noCheckpoint.error).toContain("pendingChoices");

            const unknown = secondChoicePending();
            top(unknown.state).collectedChoices = {
                ...top(unknown.state).collectedChoices,
                "0:$nobodyDeclaredMe": ["7"],
            };
            const unknownFamily = lower(unknown.state, unknown.botId);
            expect(unknownFamily.ok).toBe(false);
            if (unknownFamily.ok) return;
            expect(unknownFamily.kind).toBe("stack-not-lowerable");
            expect(unknownFamily.error).toContain(
                "collectedChoices:0:$nobodyDeclaredMe"
            );
        });
    });

    it("the builder refuses a checkpoint that resolves through instead of re-suspending", () => {
        withTemporaryDefinition(twoStepEdict(), () => {
            const { state, botId } = firstChoicePending();
            const { spec } = specFromState(state, { mySeatId: botId });
            const pastTheEnd: ScenarioSpec = {
                ...spec,
                stack: spec.stack!.map((entry) => ({
                    ...entry,
                    resolution: { step: 99 },
                })),
            };
            expect(() =>
                buildStateFromScenario(buildBladeBaseState(), pastTheEnd)
            ).toThrow(/did not re-suspend/);
        });
    });
});

describe("the residue this slice still refuses, by name (issue #5525)", () => {
    // Palantír of Orthanc's offer to the opponent — the cost-free `may-pay`
    // whose Verdict the quiz was asked for — comes AFTER a scry answered
    // inside the same resolution. The scry's answer is keyed
    // `order-top-<item id>` (an instance id in the KEY) and holds library
    // ids (a zone the spec fills with basics), neither of which this
    // checkpoint vocabulary can carry. It refuses under the collected-answer
    // field rather than silently, which is what this test pins.
    it("names the scry answer that blocks Palantír of Orthanc's may-pay offer", () => {
        const palantir = makeInstance(getCardByName("Palantír of Orthanc").id, {
            id: "palantir1",
            controllerId: "p1",
            ownerId: "p1",
            counters: { influence: 1 },
        });
        const library = (owner: string, count: number) =>
            Array.from({ length: count }, (_, i) =>
                makeInstance(getCardByName("Forest").id, {
                    id: `${owner}-lib-${i}`,
                    controllerId: owner,
                    ownerId: owner,
                    zone: "library",
                })
            );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [palantir],
                    library: library("p1", 10),
                }),
                makePlayer("p2", { library: library("p2", 10) }),
            ],
        });
        state.phase = "END_STEP";
        state.stack.push({
            ...palantir,
            id: "trig-palantir",
            castById: "p1",
            zone: "stack",
            triggeredAbilityId: "palantir-of-orthanc-end-step",
            triggerSourceId: palantir.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "END_STEP",
                activePlayerId: "p1",
            },
            targets: [{ type: "player", id: "p2" }],
        } as StackItem);
        resolveTopOfStack(state);
        const scry = state.pendingChoices![0];
        expect(scry.kind).toBe("order-top");
        applyPendingChoiceSubmit(state, {
            playerId: scry.playerId,
            stackItemId: scry.stackItemId,
            step: scry.step,
            choiceId: scry.choiceId,
            cardInstanceIds: [...(scry.candidateIds ?? [])],
            secondZoneIds: [],
        });
        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("may-pay");
        expect(offer.playerId).toBe("p2");

        const outcome = lower(state, "p2");
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("collectedChoices:");
        expect(outcome.error).toContain("order-top-");
    });
});

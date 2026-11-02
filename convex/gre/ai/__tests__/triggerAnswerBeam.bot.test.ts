/**
 * Trigger-target answers below the root, read by their settled 1-ply value
 * (issue #7812). CR 603.3d — a triggered ability announces its targets as it
 * is put on the stack; CR 701.12b — an exchange of control swaps the
 * controllers of the exchanged permanents, so every answer of Gilded Drake's
 * trigger moves permanents across both sides and the strict dominance prune
 * (`pruneDominatedTriggerTargets`) can order none of them.
 */
import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState } from "../../state";
import { tryGetDefinition } from "../../../cards";
import { enumerateMoves, type Move } from "../../moves";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { applyMoveInSearch, settledAnswerReward } from "../../search";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import {
    TRIGGER_ANSWER_BEAM,
    beamTriggerTargetsByValue,
    pruneDominatedTriggerTargets,
} from "../targetDominance";

const DRAKE_ENTRY =
    "exchange of control: casts Gilded Drake for the opposing Craw Wurm";

function nameOf(card: CardInstanceState): string | undefined {
    return tryGetDefinition(String(card.card.id ?? ""))?.name;
}

/** The blade position with Gilded Drake cast and its enters trigger
 *  announcing its target (the node one ply below the cast). */
function announcing(): { state: GameState; botId: string } {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === DRAKE_ENTRY);
    if (!scenario) throw new Error("blade entry missing");
    const state = buildBladeState({
        ...scenario,
        setup: [
            { kind: "cast", card: "Gilded Drake", by: "me" },
            { kind: "pass", seat: "opp" },
        ],
    });
    return { state, botId: seatPlayerId(state, scenario.bot) };
}

/** The card name a `submit-target` answer names, `"none"` for no target. */
function answerName(state: GameState, move: Move): string {
    if (move.kind !== "submit-target") return move.kind;
    const id = move.targets[0]?.id;
    if (id === undefined) return "none";
    const card = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === id);
    return (card && nameOf(card)) ?? String(id);
}

const apply = (botId: string) => (probe: GameState, move: Move) =>
    applyMoveInSearch(probe, botId, move);

describe("beamTriggerTargetsByValue — an exchange of control (CR 701.12b)", () => {
    it("is a trigger-target node the dominance prune cannot narrow", () => {
        const { state, botId } = announcing();
        expect(state.pendingTarget?.kind).toBe("trigger");
        const moves = enumerateMoves(state, botId);
        const answers = moves.filter((m) => m.kind === "submit-target");
        expect(answers.map((m) => answerName(state, m)).sort()).toEqual([
            "Craw Wurm",
            "Grizzly Bears",
            "Ornithopter",
            "none",
        ]);
        expect(
            pruneDominatedTriggerTargets(state, botId, moves, apply(botId))
        ).toHaveLength(moves.length);
    });

    it("settles every answer to a reward, the Wurm's the best", () => {
        const { state, botId } = announcing();
        const rewards = new Map(
            enumerateMoves(state, botId)
                .filter((m) => m.kind === "submit-target")
                .map((m) => [
                    answerName(state, m),
                    settledAnswerReward(state, botId, m, DEFAULT_EVAL_WEIGHTS),
                ])
        );
        for (const reward of rewards.values()) expect(reward).toBeDefined();
        const wurm = rewards.get("Craw Wurm")!;
        for (const [name, reward] of rewards) {
            if (name !== "Craw Wurm")
                expect(reward!).toBeLessThan(wurm - TRIGGER_ANSWER_BEAM);
        }
    });

    it("keeps only the answer the settled 1-ply value reads best", () => {
        const { state, botId } = announcing();
        const moves = enumerateMoves(state, botId);
        const kept = beamTriggerTargetsByValue(state, botId, moves, (m) =>
            settledAnswerReward(state, botId, m, DEFAULT_EVAL_WEIGHTS)
        );
        expect(
            kept
                .filter((m) => m.kind === "submit-target")
                .map((m) => answerName(state, m))
        ).toEqual(["Craw Wurm"]);
        // Never anything but answers removed.
        expect(kept.filter((m) => m.kind !== "submit-target")).toEqual(
            moves.filter((m) => m.kind !== "submit-target")
        );
    });

    it("keeps an answer within the beam and an answer it could not settle", () => {
        const { state, botId } = announcing();
        const moves = enumerateMoves(state, botId);
        const answers = moves.filter((m) => m.kind === "submit-target");
        const [best, near, far, unsettled] = answers;
        const value = new Map<Move, number | undefined>([
            [best!, 0.7],
            [near!, 0.7 - TRIGGER_ANSWER_BEAM / 2],
            [far!, 0.7 - TRIGGER_ANSWER_BEAM * 2],
            [unsettled!, undefined],
        ]);
        const kept = beamTriggerTargetsByValue(state, botId, moves, (m) =>
            value.get(m)
        );
        expect(kept).toContain(best);
        expect(kept).toContain(near);
        expect(kept).toContain(unsettled);
        expect(kept).not.toContain(far);
    });

    it("leaves a node that is not the mover's trigger announcement alone", () => {
        const scenario = BLADE_SCENARIOS.find((s) => s.label === DRAKE_ENTRY)!;
        const state = buildBladeState(scenario);
        const botId = seatPlayerId(state, scenario.bot);
        const moves = enumerateMoves(state, botId);
        expect(beamTriggerTargetsByValue(state, botId, moves, () => 0)).toEqual(
            moves
        );
        const trigger = announcing();
        const other = trigger.state.players.find(
            (p) => p.id !== trigger.botId
        )!.id;
        const answers = enumerateMoves(trigger.state, trigger.botId);
        expect(
            beamTriggerTargetsByValue(trigger.state, other, answers, (m) =>
                m === answers[0] ? 1 : 0
            )
        ).toEqual(answers);
    });
});

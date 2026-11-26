// Blade LINE entries (ADR 0186 Decision 9, GLOSSARY "Line"): a starting
// position and the moves played from it, decision by decision, the
// opponent's replies included, over as many turns as it takes.
//
// A Line is read twice, and this module is the walk both readings share:
//
//   * As a TEST (`runBladeLine`): each Bot decision is one Brain request
//     (`handleBrainRequest`, the Worker's entry) on the Bot's own projection,
//     with the tree keeper the Worker holds and the consult path named as the
//     live client names it (`sequence.ts`'s `consultBrain` / `stepFor`). The
//     Bot's own move is applied, whatever it was; the Line passes only when
//     every decision matched, and a failure names the first decision where
//     the Bot left the Line and what it played instead.
//   * As a SOURCE (`verdictsFromLines`, `verdicts/registrySource.ts`): the
//     expected moves are played instead of the Bot's, and every decision is
//     lowered to one Verdict whose `setup` replays the walk to it.
//
// Between two Bot decisions the game moves through the search's own
// transition (`applyMoveInSearch`, `advanceToDecision`). At each decision the
// opponent owes, it plays the step's next reply when an enumerated move
// matches it, and passes otherwise (`BladeLineStep.replies`).

import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import type { GameState } from "../../state";
import {
    advanceToDecision,
    applyMoveInSearch,
    decidingPlayer,
} from "../../search";
import type { TreeKeeper } from "../brainRequest";
import type { ConsultPathStep } from "../treeReuse";
import { buildPositionFromSpec } from "./build";
import {
    describeChosenMove,
    describeMatcher,
    matchesMove,
    seatPlayerId,
} from "./matcher";
import { DEFAULT_BLADE_SEED } from "./runner";
import { consultBrain, stepFor } from "./sequence";
import type {
    BladeLine,
    BladeSeat,
    BladeSetupStep,
    MoveMatcher,
} from "./types";

/** The longest run of opponent decisions between two Bot decisions before
 *  the Line is called malformed: an opponent that passes for ever is a
 *  position nobody wrote. */
const MAX_OPPONENT_DECISIONS = 40;

const GAME = "blade-line";

/** A Line whose walk cannot be played as written — an authoring error, never
 *  a property of the Bot. */
export class BladeLineError extends Error {
    constructor(label: string, detail: string) {
        super(`Blade line "${label}": ${detail}`);
        this.name = "BladeLineError";
    }
}

function otherSeat(seat: BladeSeat): BladeSeat {
    return seat === "me" ? "opp" : "me";
}

/** The first enumerated move of `pid` that one of `matchers` accepts, with
 *  the matcher that accepted it. */
export function firstMatchingMove(
    state: GameState,
    pid: string,
    matchers: MoveMatcher[]
): { move: Move; matcher: MoveMatcher } | null {
    const moves = enumerateMoves(state, pid);
    for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        const matcher = matchers.find((m) => matchesMove(state, move, m));
        if (matcher) return { move, matcher };
    }
    return null;
}

/** What a reader does at one Bot decision: the move to play there, or why
 *  the walk stops. */
export type LineDecision =
    | { move: Move; matcher: MoveMatcher }
    | { stop: string };

export type LineWalkHooks = {
    /** Called at each Bot decision with the position, its index, and the
     *  `move` steps that replay the walk to it from the built position. */
    decide: (
        state: GameState,
        index: number,
        trail: BladeSetupStep[]
    ) => LineDecision;
    /** Called before every move is applied (Bot and opponent alike). */
    beforeMove?: (state: GameState, pid: string, move: Move) => void;
};

/** Walk `line` from its built position. Returns `null` when every decision
 *  was played, else the stop the reader gave or the reason the game ended
 *  first. Throws `BladeLineError` on a malformed Line. */
export function walkLine(
    line: BladeLine,
    state: GameState,
    hooks: LineWalkHooks
): { index: number; reason: string } | null {
    const botId = seatPlayerId(state, line.bot);
    const oppSeat = otherSeat(line.bot);
    const oppId = seatPlayerId(state, oppSeat);
    const trail: BladeSetupStep[] = [];
    if (decidingPlayer(state) !== botId) {
        throw new BladeLineError(
            line.label,
            `the built position is not a decision of "${line.bot}"`
        );
    }
    for (let i = 0; i < line.steps.length; i++) {
        const decision = hooks.decide(state, i, [...trail]);
        if ("stop" in decision) return { index: i, reason: decision.stop };
        hooks.beforeMove?.(state, botId, decision.move);
        trail.push({ kind: "move", seat: line.bot, move: decision.matcher });
        applyMoveInSearch(state, botId, decision.move);
        let pid = advanceToDecision(state);

        const replies = [...(line.steps[i].replies ?? [])];
        const last = i === line.steps.length - 1;
        if (last) {
            if (replies.length > 0) {
                throw new BladeLineError(
                    line.label,
                    "the last decision names replies no Bot decision follows"
                );
            }
            return null;
        }
        for (let n = 0; pid !== botId; n++) {
            if (pid === null) {
                return {
                    index: i + 1,
                    reason: state.gameOver
                        ? "the game ended before this decision"
                        : "the game stopped at no decision before this one",
                };
            }
            if (pid !== oppId || n >= MAX_OPPONENT_DECISIONS) {
                throw new BladeLineError(
                    line.label,
                    `no Bot decision ${i + 2} within ${MAX_OPPONENT_DECISIONS} opponent decisions`
                );
            }
            const reply =
                replies.length > 0
                    ? firstMatchingMove(state, pid, [replies[0]])
                    : null;
            if (reply) replies.shift();
            const pass: Move = { kind: "pass" };
            if (
                !reply &&
                !enumerateMoves(state, pid).some((m) => m.kind === "pass")
            ) {
                throw new BladeLineError(
                    line.label,
                    `before decision ${i + 2} the opponent owes a decision it cannot pass; name its reply`
                );
            }
            const move = reply ? reply.move : pass;
            hooks.beforeMove?.(state, pid, move);
            trail.push({
                kind: "move",
                seat: oppSeat,
                move: reply ? reply.matcher : { kind: "pass" },
            });
            applyMoveInSearch(state, pid, move);
            pid = advanceToDecision(state);
        }
        if (replies.length > 0) {
            throw new BladeLineError(
                line.label,
                `reply [${describeMatcher(replies[0])}] before decision ${i + 2} matched no opponent move`
            );
        }
    }
    return null;
}

/** Build a Line's starting position. */
export function buildLineState(line: BladeLine): GameState {
    return buildPositionFromSpec(line.spec, line.setup, line.label);
}

export type BladeLineSeedResult = {
    seed: number;
    ok: boolean;
    /** The first decision (0-based) where the Bot left the Line. */
    failedAt?: number;
    reason: string;
};

function runSeed(line: BladeLine, seed: number): BladeLineSeedResult {
    const state = buildLineState(line);
    const botId = seatPlayerId(state, line.bot);
    const keeper: TreeKeeper = { kept: null, catalogue: () => "blade" };
    let seq = 1;
    let path: ConsultPathStep[] = [];
    const stop = walkLine(line, state, {
        decide: (s, index) => {
            const res = consultBrain(
                s,
                seq,
                line,
                botId,
                seed,
                keeper,
                path,
                GAME
            );
            path = [];
            const expected = line.steps[index].expect;
            if (res.error) {
                return { stop: `the Brain threw: ${res.error.message}` };
            }
            const matcher = expected.find((m) => matchesMove(s, res.move, m));
            if (!res.move || !matcher) {
                return {
                    stop: `expected [${expected.map(describeMatcher).join(" | ")}], chose [${describeChosenMove(s, res.move)}]`,
                };
            }
            return { move: res.move, matcher };
        },
        beforeMove: (s, pid, move) => {
            path.push(stepFor(s, seq, pid, botId, move));
            seq++;
        },
    });
    if (stop === null) return { seed, ok: true, reason: "" };
    return {
        seed,
        ok: false,
        failedAt: stop.index,
        reason: `decision ${stop.index + 1}: ${stop.reason}`,
    };
}

/** Run one Line at every declared seed. Never throws on a decision the Bot
 *  got wrong; throws on a malformed Line. */
export function runBladeLine(line: BladeLine): {
    ok: boolean;
    seeds: BladeLineSeedResult[];
    failureMessage: string;
} {
    const seeds = (line.seeds ?? [DEFAULT_BLADE_SEED]).map((seed) =>
        runSeed(line, seed)
    );
    const failures = seeds.filter((s) => !s.ok);
    return {
        ok: failures.length === 0,
        seeds,
        failureMessage: failures
            .map((f) => `seed ${f.seed}: ${f.reason}`)
            .join("; "),
    };
}

/** What makes a Line entry malformed before it runs: an empty Line, a
 *  `stretch` Line with no cause, a `must` Line carrying one. */
export function lineEntryProblems(line: BladeLine): string[] {
    const out: string[] = [];
    if (line.steps.length === 0) out.push("a Line names no decision");
    if (line.steps.some((s) => s.expect.length === 0)) {
        out.push("a decision names no expected move");
    }
    if (line.tier === "stretch" && !line.cause?.trim()) {
        out.push("a `stretch` Line writes the cause it cannot be followed yet");
    }
    if (line.tier === "must" && line.cause !== undefined) {
        out.push("a `must` Line is followed, so it carries no cause");
    }
    if (
        !Number.isInteger(line.budget.iterations) ||
        line.budget.iterations <= 0
    ) {
        out.push("the budget is a positive iteration count");
    }
    return out;
}

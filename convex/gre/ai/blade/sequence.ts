// Blade SEQUENCE entries (issue #10470, ADR 0185): two consecutive Bot
// decisions, the second searched on the tree the first one kept.
//
// A `must` entry searches a fresh tree at its declared iterations, so the
// blade proves the decision function and tree reuse cannot weaken it — reuse
// only adds visits on top. What a single entry cannot show is the reuse
// itself: that the second decision continues from the subtree the game moved
// into, that it still answers correctly there, and that the tree is DROPPED
// when the path crosses an observation the Bot makes. A sequence entry does.
//
// It runs the LIVE path, not the blade's: each decision is a Brain request
// (`handleBrainRequest`) on the Bot's own projection, with the keeper the
// Worker holds, and the decisions in between are named as the live client
// names them — tree keys read on the deciding seat's own view (`treeKeyOf`).
// The game moves between the two decisions through the search's own
// transition (`applyMoveInSearch`, `advanceToDecision`), the opponent passing
// at every decision it owes, until the Bot decides again.
//
// The second decision is asserted twice: on the kept tree, and on a fresh one
// at the same budget and seed. Both must satisfy the expectation, and the
// kept leg must have kept visits — or must have dropped the tree for the
// reason the entry names.
//
// PONDERING (issue #10472, ADR 0185 Amendment I): an entry that names
// `ponder` grows the kept tree at the opponent's first real choice (more than
// one move) for a fixed number of iterations — never wall-clock — through the
// Worker's own entry (`startPonder`), and the opponent then plays `reply`
// there. The second decision is then asserted three times: on the pondered
// tree, on the kept tree WITHOUT pondering, and on a fresh one; the pondered
// leg must carry visits pondering grew.

import type { ScenarioSpec } from "../../../debugScenarioSpec";
import { projectPublicState } from "../../../gameProjections";
import type { Move } from "../../moves";
import type { GameState } from "../../state";
import { enumerateMoves } from "../../moves";
import { advanceToDecision, applyMoveInSearch, treeKeyOf } from "../../search";
import {
    handleBrainRequest,
    type BrainResponse,
    type TreeKeeper,
} from "../brainRequest";
import { startPonder } from "../ponder";
import { projectedToGameState } from "../stateAdapter";
import {
    continueKeptTree,
    type ConsultPathStep,
    type TreeDrop,
} from "../treeReuse";
import { buildPositionFromSpec } from "./build";
import { describeChosenMove, matchesMove, seatPlayerId } from "./matcher";
import { bladeDeckKnowledge, DEFAULT_BLADE_SEED } from "./runner";
import type { BladeSeat, MoveMatcher } from "./types";

export type BladeSequence = {
    label: string;
    spec: ScenarioSpec;
    bot: BladeSeat;
    deckKnowledge?: { seat: BladeSeat; cards: string[] }[];
    /** Iterations only, as every blade entry. */
    budget: { iterations: number };
    seeds?: number[];
    tier: "must";
    /** The first decision: what the Bot must play, so the path between the
     *  two decisions is the one the entry was written about. */
    first: MoveMatcher[];
    /** The second decision, on the kept tree AND on a fresh one. */
    second: MoveMatcher[];
    /** `kept`: the second decision continues from the kept subtree, with
     *  visits. `pondered`: and some of them grown by pondering (needs
     *  `ponder`). Otherwise the reason the tree must be dropped. */
    reuse: "kept" | "pondered" | { dropped: TreeDrop };
    /** Ponder the opponent's first real choice for this many iterations
     *  (issue #10472). */
    ponder?: { iterations: number };
    /** The opponent's move at its first real choice; every other decision
     *  of its, and this one when omitted, is a pass. */
    reply?: MoveMatcher;
    note: string;
};

export type BladeSequenceSeedResult = {
    seed: number;
    ok: boolean;
    reason: string;
    kept: number;
    /** Root visits of the second decision grown by pondering. */
    pondered: number;
};

/** The longest walk between the two decisions before the entry is called
 *  malformed: an opponent that passes for ever is a position nobody wrote. */
const MAX_STEPS_BETWEEN = 12;

const GAME = "blade-sequence";

function consult(
    state: GameState,
    seq: number,
    entry: BladeSequence,
    botId: string,
    seed: number,
    keeper: TreeKeeper,
    steps: ConsultPathStep[] | null
): BrainResponse {
    return handleBrainRequest(
        {
            id: seq,
            state: projectPublicState(state, seq, botId),
            botId,
            budget: { iterations: entry.budget.iterations },
            deckKnowledge: bladeDeckKnowledge(state, entry),
            seed,
            reuse: { gameId: GAME, steps },
        },
        undefined,
        keeper
    );
}

/** The step `move` is, keyed on `pid`'s own view as the live client keys it
 *  — with the hand card an opponent's move shows (`consult-path.ts`). */
function stepFor(
    state: GameState,
    seq: number,
    pid: string,
    botId: string,
    move: Move
): ConsultPathStep {
    const view = projectedToGameState(
        projectPublicState(state, seq, pid),
        undefined,
        pid
    );
    const key = treeKeyOf(view, pid, botId, move);
    if (key === null) {
        throw new Error(`no tree key for ${JSON.stringify(move)} of ${pid}`);
    }
    const fromHand =
        pid !== botId &&
        (move.kind === "cast-spell" ||
            move.kind === "play-land" ||
            move.kind === "activate-ability") &&
        view.players
            .find((p) => p.id === pid)
            ?.hand.some((c) => c.id === move.cardInstanceId);
    return fromHand && "cardInstanceId" in move
        ? { seat: pid, key, shows: move.cardInstanceId }
        : { seat: pid, key };
}

/** The opponent's move at a decision: `reply` at the pondered one, else a
 *  pass. */
function opponentMove(
    state: GameState,
    pid: string,
    matcher: MoveMatcher | undefined
): Move {
    if (!matcher) return { kind: "pass" };
    const move = enumerateMoves(state, pid).find((m) =>
        matchesMove(state, m, matcher)
    );
    if (!move) {
        throw new Error(`no opponent move matches ${JSON.stringify(matcher)}`);
    }
    return move;
}

function matches(
    state: GameState,
    move: Move | null,
    matchers: MoveMatcher[]
): boolean {
    return matchers.some((m) => matchesMove(state, move, m));
}

function runSeed(entry: BladeSequence, seed: number): BladeSequenceSeedResult {
    const fail = (reason: string, kept = 0, pondered = 0) => ({
        seed,
        ok: false,
        reason,
        kept,
        pondered,
    });
    const state = buildPositionFromSpec(entry.spec, undefined, entry.label);
    const botId = seatPlayerId(state, entry.bot);
    const keeper: TreeKeeper = { kept: null, catalogue: () => "blade" };
    let seq = 1;

    const first = consult(state, seq, entry, botId, seed, keeper, []);
    if (first.error)
        return fail(`first decision threw: ${first.error.message}`);
    if (!matches(state, first.move, entry.first)) {
        return fail(
            `first decision chose [${describeChosenMove(state, first.move)}]`
        );
    }
    if (!keeper.kept) return fail("the first decision kept no tree");
    // The same first decision, kept by a keeper nobody ponders into: the
    // pondered entry's third leg.
    const unpondered: TreeKeeper = { kept: null, catalogue: () => "blade" };
    if (entry.ponder) {
        consult(state, seq, entry, botId, seed, unpondered, []);
    }

    // The game moves on, every decision named as the live client names it.
    const steps: ConsultPathStep[] = [
        stepFor(state, seq, botId, botId, first.move!),
    ];
    applyMoveInSearch(state, botId, first.move!);
    let pondered = false;
    for (let n = 0; ; n++) {
        const pid = advanceToDecision(state);
        if (pid === botId) break;
        if (pid === null || n >= MAX_STEPS_BETWEEN) {
            throw new Error(
                `Blade sequence "${entry.label}": no second Bot decision`
            );
        }
        seq++;
        // Issue #10472 — the opponent's first real choice is pondered, then
        // answered with the entry's reply.
        const choice =
            !pondered && enumerateMoves(state, pid).length > 1
                ? entry.ponder
                : undefined;
        if (choice) {
            pondered = true;
            const session = startPonder(
                {
                    kind: "ponder",
                    state: projectPublicState(state, seq, botId),
                    botId,
                    deckKnowledge: bladeDeckKnowledge(state, entry),
                    reuse: { gameId: GAME, steps: [...steps] },
                    seed,
                },
                keeper
            );
            if (!session) return fail("nothing to ponder at the reply");
            session.slice(choice.iterations);
        }
        const move = opponentMove(state, pid, choice ? entry.reply : undefined);
        steps.push(stepFor(state, seq, pid, botId, move));
        applyMoveInSearch(state, pid, move);
    }
    if (entry.ponder && !pondered) {
        throw new Error(
            `Blade sequence "${entry.label}": the opponent had no real choice to ponder`
        );
    }
    seq++;

    // The verdict the Worker will reach, read without touching its keeper.
    const verdict = continueKeptTree(
        keeper.kept,
        { gameId: GAME, botId, catalogue: "blade" },
        steps,
        projectPublicState(state, seq, botId)
    );
    const kept = consult(state, seq, entry, botId, seed, keeper, steps);
    const fresh = consult(
        state,
        seq,
        entry,
        botId,
        seed,
        { kept: null, catalogue: () => "blade" },
        null
    );
    const keptVisits = kept.trace?.iterationsKept ?? 0;
    const ponderVisits = kept.trace?.ponder?.kept ?? 0;
    if (kept.error || fresh.error) {
        return fail(`second decision threw`, keptVisits, ponderVisits);
    }
    const legs: [string, BrainResponse][] = [
        [entry.ponder ? "pondered" : "kept", kept],
        ["fresh", fresh],
    ];
    if (entry.ponder) {
        legs.push([
            "kept, unpondered",
            consult(state, seq, entry, botId, seed, unpondered, steps),
        ]);
    }
    for (let i = 0; i < legs.length; i++) {
        const [leg, res] = legs[i];
        if (!matches(state, res.move, entry.second)) {
            return fail(
                `second decision (${leg} tree) chose [${describeChosenMove(state, res.move)}]`,
                keptVisits
            );
        }
    }
    if (entry.reuse === "kept" || entry.reuse === "pondered") {
        if (keptVisits <= 0) {
            const why = "dropped" in verdict ? verdict.dropped : "adopt";
            return fail(`the kept tree was dropped (${why})`, keptVisits);
        }
        if (entry.reuse === "pondered" && ponderVisits <= 0) {
            return fail(
                `no visit of the second decision was pondered`,
                keptVisits
            );
        }
    } else {
        if (keptVisits !== 0) {
            return fail(
                `kept ${keptVisits} visits, expected a drop`,
                keptVisits
            );
        }
        const why = "dropped" in verdict ? verdict.dropped : "none";
        if (why !== entry.reuse.dropped) {
            return fail(
                `dropped for [${why}], expected [${entry.reuse.dropped}]`,
                keptVisits
            );
        }
    }
    return {
        seed,
        ok: true,
        reason: "",
        kept: keptVisits,
        pondered: ponderVisits,
    };
}

/** Run one sequence entry at every declared seed. Never throws on a failed
 *  expectation; throws on a malformed entry. */
export function runBladeSequence(entry: BladeSequence): {
    ok: boolean;
    seeds: BladeSequenceSeedResult[];
    failureMessage: string;
} {
    const seeds = (entry.seeds ?? [DEFAULT_BLADE_SEED]).map((seed) =>
        runSeed(entry, seed)
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

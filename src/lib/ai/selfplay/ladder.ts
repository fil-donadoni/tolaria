// Ladder game runner (issue #1924, decision #1895) — plays ONE paired-design
// A/B game headless: control and candidate are two CONFIG VARIANTS of the same
// engine, assigned per seat, in one process.
//
// The variant is installed around each seat's search call (set → search →
// clear in a `finally`), so the whole synchronous search — tree, rollouts,
// tie-breaks — runs under one consistent config and the other seat always
// searches with production defaults. `runHeadlessGame`'s injectable searchFn
// makes this possible with zero engine-signature churn.
//
// Determinism: the initial state derives entirely from (decks, seed) and the
// budget is iterations-only, so a (spec, variant) pair is bit-reproducible.
// The two orientations of a ladder pair pass the SAME spec except
// `candidateSeat` — identical shuffles, agents swapped.

import { search, createInitialGameState, type SearchBudget } from "@convex/gre";
import {
    setSearchVariant,
    type SearchVariant,
} from "@convex/gre/ai/searchVariant";
import { presetToPlayerInput } from "./decks";
import { runHeadlessGame, type GameEndReason } from "./playGame";

export type LadderSeatId = "S0" | "S1";

export type LadderGameSpec = {
    /** Preset deck ids; seat S0 is on the play. */
    deckSeat0: string;
    deckSeat1: string;
    seed: number;
    candidateSeat: LadderSeatId;
    /** Iteration budget for BOTH seats — never timeMs (decision #1895 §2). */
    iterations: number;
};

export type LadderGameOutcome = {
    winnerSeat: LadderSeatId | null;
    /** null = guard stop (non-terminal end) — reported, never a win or loss. */
    candidateWon: boolean | null;
    reason: GameEndReason;
    turns: number;
    plies: number;
};

export function playLadderGame(
    spec: LadderGameSpec,
    candidate: SearchVariant | null
): LadderGameOutcome {
    const players = [
        presetToPlayerInput(spec.deckSeat0, 0, "S0"),
        presetToPlayerInput(spec.deckSeat1, 1, "S1"),
    ];
    const state = createInitialGameState(players, spec.seed);
    const budget: SearchBudget = { iterations: spec.iterations };

    const variantAwareSearch: typeof search = (st, pid, b, sd) => {
        setSearchVariant(pid === spec.candidateSeat ? candidate : null);
        try {
            return search(st, pid, b, sd);
        } finally {
            setSearchVariant(null);
        }
    };

    const result = runHeadlessGame(
        state,
        { id: "S0", budget },
        { id: "S1", budget },
        spec.seed,
        variantAwareSearch
    );

    const winnerSeat =
        result.winnerId === "S0" || result.winnerId === "S1"
            ? (result.winnerId as LadderSeatId)
            : null;
    return {
        winnerSeat,
        candidateWon:
            winnerSeat === null ? null : winnerSeat === spec.candidateSeat,
        reason: result.reason,
        turns: result.turns,
        plies: result.plies,
    };
}

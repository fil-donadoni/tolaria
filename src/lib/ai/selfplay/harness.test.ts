// Self-play harness entry. Two roles:
//
//  1. Always-on SMOKE test — a tiny mirror game must run end to end without
//     throwing and apply real moves. This is the regression gate: it keeps the
//     harness wiring (setup → search → apply → resolution) alive as the engine
//     evolves, so a future refactor can't silently break self-play.
//
//  2. Opt-in RUNNER (gated by the SELFPLAY env var) — runs a full match and
//     prints the comparable report. Not a pass/fail assertion; it's the
//     measurement tool. Invoke via `bun run selfplay` (see package.json) with
//     optional overrides:
//       SELFPLAY_DECK_A, SELFPLAY_DECK_B, SELFPLAY_GAMES, SELFPLAY_ITER,
//       SELFPLAY_SEED.

import { describe, it, expect } from "vitest";
import { runMatch, formatReport, type MatchConfig } from "./runMatch";
import { runHeadlessGame } from "./playGame";
import { createInitialGameState } from "@convex/gre";
import { presetToPlayerInput } from "./decks";

describe("self-play harness (smoke)", () => {
    it("plays a tiny mirror game to a stable end", () => {
        const players = [
            presetToPlayerInput("mono-red-burn", 0, "A"),
            presetToPlayerInput("mono-red-burn", 1, "B"),
        ];
        const state = createInitialGameState(players, 1234);
        const result = runHeadlessGame(
            state,
            { id: "A", budget: { iterations: 4 } },
            { id: "B", budget: { iterations: 4 } },
            1234
        );
        // The loop ran and applied moves.
        expect(result.plies).toBeGreaterThan(0);
        // It reached a REAL game end (life/decked), not a harness guard. This is
        // the regression gate: a guard stop here means self-play wiring broke
        // (e.g. a move kind that no longer advances the state).
        expect(["life", "decked", "concede"]).toContain(result.reason);
        expect(result.winnerId).not.toBeNull();
    }, 60_000);
});

// `process` isn't in the browser-typed src tsconfig; read env off globalThis.
const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};
const RUN = ENV.SELFPLAY === "1";

describe.runIf(RUN)("self-play harness (runner)", () => {
    it("runs a match and prints the report", () => {
        const iterations = Number(ENV.SELFPLAY_ITER ?? "200");
        const config: MatchConfig = {
            deckA: ENV.SELFPLAY_DECK_A ?? "mono-red-burn",
            deckB: ENV.SELFPLAY_DECK_B ?? "channel-fireball",
            games: Number(ENV.SELFPLAY_GAMES ?? "20"),
            seed: Number(ENV.SELFPLAY_SEED ?? "1"),
            budgetA: { iterations },
            budgetB: { iterations },
        };
        const report = runMatch(config, () => Date.now());
        console.log("\n" + formatReport(report) + "\n");
        // A healthy run produces at least one decisive game.
        expect(report.decisive).toBeGreaterThan(0);
    }, 1_800_000);
});

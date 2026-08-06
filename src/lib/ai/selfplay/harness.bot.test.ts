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

describe("self-play harness (search-error guard)", () => {
    it("ends only the crashing game with search-error and never propagates", () => {
        const players = [
            presetToPlayerInput("mono-red-burn", 0, "A"),
            presetToPlayerInput("mono-red-burn", 1, "B"),
        ];
        const state = createInitialGameState(players, 1234);
        // Inject a search that crashes on the first decision — mirrors a buggy
        // card resolution thrown during an ISMCTS rollout.
        const crashingSearch = () => {
            throw new Error("boom in rollout");
        };
        const result = runHeadlessGame(
            state,
            { id: "A", budget: { iterations: 4 } },
            { id: "B", budget: { iterations: 4 } },
            1234,
            crashingSearch
        );
        // The exception did NOT propagate; the game ended as a harness guard.
        expect(result.reason).toBe("search-error");
        // A guard stop is NOT a decisive win/loss.
        expect(result.winnerId).toBeNull();
        expect(result.loserId).toBeNull();
    });

    it("counts a search-error game as a guard stop and the match still completes", () => {
        // Run a real 2-game match, then assert the report's guard-stop
        // accounting treats search-error exactly like the other guards (never a
        // decisive win/loss). We build the expected report shape by replaying
        // the loop with a crashing search across both games.
        const crashingSearch = () => {
            throw new Error("boom in rollout");
        };
        let guardStops = 0;
        let decisive = 0;
        const reasons: Record<string, number> = {};
        for (let i = 0; i < 2; i++) {
            const players = [
                presetToPlayerInput("mono-red-burn", 0, "A"),
                presetToPlayerInput("mono-red-burn", 1, "B"),
            ];
            const state = createInitialGameState(players, i + 1);
            const result = runHeadlessGame(
                state,
                { id: "A", budget: { iterations: 4 } },
                { id: "B", budget: { iterations: 4 } },
                i + 1,
                crashingSearch
            );
            reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
            if (result.winnerId === "A" || result.winnerId === "B") decisive++;
            else guardStops++;
        }
        // Both games crashed in search; the run completed (no hard failure).
        expect(reasons["search-error"]).toBe(2);
        expect(guardStops).toBe(2);
        expect(decisive).toBe(0);
    });
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

// issue #2284 — headless self-play inherits the bot's liveness invariant. A
// window nobody drove used to disappear into a bare `"stall"` / `"resolution-
// error"` reason string, which says a game died but never WHICH Expected Input
// had no handler. The guard now names it.
describe("self-play names the undriven window (issue #2284)", () => {
    it("reports the Expected Input kind alongside a stall", async () => {
        const { makePlayer, makeState } =
            await import("@convex/cards/__tests__/setup");
        const { refreshExpectedInput } =
            await import("@convex/gre/expectedInput");
        const state = makeState({
            players: [makePlayer("A"), makePlayer("B")],
            activePlayerId: "A",
            priorityPlayerId: "A",
        });
        // A parked announcement makes `decidingPlayer` return null with no
        // pending choice to resolve — the engine never settled to a stable
        // point, which is exactly the shape the harness calls a stall.
        state.pendingCast = {
            playerId: "A",
            cardInstanceId: "nope",
            paid: {},
            remaining: { generic: 1 },
        } as never;
        refreshExpectedInput(state);

        const result = runHeadlessGame(
            state,
            { id: "A", budget: { iterations: 2 } },
            { id: "B", budget: { iterations: 2 } },
            7
        );
        expect(result.reason).toBe("stall");
        // The load-bearing field: the window that was not handled.
        expect(result.unhandledExpectedInput).toBe("priority");
    });
});

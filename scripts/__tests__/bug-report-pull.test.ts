// `bug-report:pull` — lowering a `bugReports` row's frozen state to a
// `ScenarioSpec` (issue #9005, PRD issue #8998).
//
// WHAT THESE PIN. Three things fail silently:
//
//  1. THE SEAT. `specFromState` mirrors the whole board when handed the wrong
//     `mySeatId` (issue #3786). A vs-AI row's `players[]` order is not the
//     seat model; the `-p1` suffix is. The fixture puts `-p2` FIRST so a
//     `players[0]` default reads as the Bot's side and reds the test.
//  2. THE LOSS REPORT. `dropped[]` / `stackBlockers[]` are the lowering's
//     confession; a pull that printed the spec without them would hand an
//     agent a position that silently differs from the frozen one.
//  3. THE NO-STATE ROW. A user report filed off-board carries no state; it
//     must refuse with a message, never lower an empty board.

import { describe, expect, it } from "vitest";
import {
    lowerBugReportRow,
    parsePullArgs,
    pullArgv,
    scenarioFile,
    summarizeClientDiagnostics,
    PULL_USAGE,
    type PulledBugReportRow,
} from "../lib/bug-report-pull";
import { specFromState } from "../../convex/gre/scenarioBuilder";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../convex/cards/__tests__/setup.helper";
import { grizzlyBears } from "../../convex/cards/sets/lea/green.cards";
import { hillGiant } from "../../convex/cards/sets/lea/red.cards";
import type { GameState } from "../../convex/gre/state";

const HUMAN = "user123-p1";
const BOT = "user123-p2";

/** A frozen vs-AI position, `players[]` in BOT-first order, JSON-round-tripped
 *  as the row stores it (`v.any()`). A pending choice makes `dropped[]`
 *  non-empty — the lowering has no spec field for it. */
function frozenState(): GameState {
    const state = makeState({
        players: [
            makePlayer(BOT, {
                battlefield: [
                    makeInstance(hillGiant().id, {
                        id: "giant",
                        controllerId: BOT,
                    }),
                ],
            }),
            makePlayer(HUMAN, {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
                        controllerId: HUMAN,
                    }),
                ],
            }),
        ],
        activePlayerId: HUMAN,
        priorityPlayerId: HUMAN,
    });
    return JSON.parse(JSON.stringify(state)) as GameState;
}

function row(overrides: Partial<PulledBugReportRow> = {}): PulledBugReportRow {
    return {
        source: "system",
        gameId: "game-1",
        seq: 7,
        state: frozenState(),
        fault: {
            origin: "client-ladder",
            expectedKind: "choice",
            faultClass: "driver-error",
        },
        clientDiagnostics: {
            build: { commit: "abc123", mode: "production" },
            ai: { decisions: [1, 2, 3], escalations: [] },
            console: [{ level: "error" }],
            viewport: { w: 1 },
        },
        ...overrides,
    };
}

function cardsOf(spec: { cards: { name: string; owner?: string }[] }) {
    return spec.cards.map((c) => `${c.owner ?? "me"}:${c.name}`).sort();
}

describe("lowerBugReportRow — the lowering", () => {
    it("lowers a system row with the human `-p1` seat as `me`, whatever players[] order", () => {
        const result = lowerBugReportRow("report-42", row());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.mySeatId).toBe(HUMAN);
        expect(cardsOf(result.spec)).toEqual(
            [`me:${grizzlyBears().name}`, `opp:${hillGiant().name}`].sort()
        );
        expect(result.source).toBe("system");
        expect(result.seq).toBe(7);
    });

    it("prints specFromState's own loss report, unfiltered", () => {
        const state = frozenState();
        state.pendingChoices = [
            {
                kind: "chooseMode",
                playerId: BOT,
            } as unknown as NonNullable<GameState["pendingChoices"]>[number],
        ];
        const result = lowerBugReportRow("r", row({ state }));
        if (!result.ok) throw new Error(result.message);
        const direct = specFromState(state, { mySeatId: HUMAN });
        expect(result.dropped).toEqual(direct.dropped);
        expect(result.dropped.length).toBeGreaterThan(0);
        expect(result.stackBlockers).toEqual(direct.stackBlockers);
    });

    it("an explicit --seat mirrors the board", () => {
        const result = lowerBugReportRow("r", row(), { seat: BOT });
        if (!result.ok) throw new Error(result.message);
        expect(result.mySeatId).toBe(BOT);
        expect(cardsOf(result.spec)).toEqual(
            [`opp:${grizzlyBears().name}`, `me:${hillGiant().name}`].sort()
        );
    });

    it("lowers a user row (no `source` column) the same way", () => {
        const result = lowerBugReportRow(
            "r",
            row({ source: undefined, fault: undefined })
        );
        if (!result.ok) throw new Error(result.message);
        expect(result.source).toBe("user");
        expect(scenarioFile(result).label).toBe("Bug report r — user report");
    });

    it("refuses a row with no state, a missing row and a seat that is no player", () => {
        const noState = lowerBugReportRow("r", row({ state: undefined }));
        expect(noState).toEqual({
            ok: false,
            message: expect.stringContaining("carries no game state"),
        });
        expect(lowerBugReportRow("gone", null)).toEqual({
            ok: false,
            message: "bug report gone: no such row",
        });
        const badSeat = lowerBugReportRow("r", row(), { seat: "nobody" });
        expect(badSeat.ok).toBe(false);
        if (!badSeat.ok)
            expect(badSeat.message).toContain("specFromState refused");
    });

    it("--out writes the { label, spec } shape a preset scenario takes", () => {
        const result = lowerBugReportRow("report-42", row());
        if (!result.ok) throw new Error(result.message);
        const file = scenarioFile(result);
        expect(file.label).toBe(
            "Bug report report-42 — driver-error at choice"
        );
        expect(file.spec).toBe(result.spec);
    });
});

describe("summarizeClientDiagnostics", () => {
    it("names the build, ring depths and every unnamed key", () => {
        expect(summarizeClientDiagnostics(row().clientDiagnostics)).toEqual([
            "build: commit=abc123 mode=production",
            "ai: decisions[3] escalations[0]",
            "console: 1 entries",
            "also: viewport",
        ]);
    });

    it("says `none` when the row carries none", () => {
        expect(summarizeClientDiagnostics(undefined)).toEqual(["none"]);
    });
});

describe("CLI args", () => {
    it("parses the id and flags; refuses anything else with the usage line", () => {
        expect(
            parsePullArgs(["abc", "--out", "f.json", "--prod", "--seat", "x"])
        ).toEqual({ reportId: "abc", out: "f.json", seat: "x", prod: true });
        expect(() => parsePullArgs([])).toThrow(PULL_USAGE);
        expect(() => parsePullArgs(["a", "--out"])).toThrow(PULL_USAGE);
        expect(() => parsePullArgs(["a", "--bogus"])).toThrow(PULL_USAGE);
    });

    it("calls the internal getReport with no --push, --prod only when asked", () => {
        const local = pullArgv({ reportId: "abc", prod: false });
        expect(local).not.toContain("--push");
        expect(local).not.toContain("--prod");
        expect(local.slice(-2)).toEqual([
            "bugReports:getReport",
            '{"reportId":"abc"}',
        ]);
        expect(pullArgv({ reportId: "abc", prod: true }).slice(0, 3)).toEqual([
            "convex",
            "run",
            "--prod",
        ]);
    });
});

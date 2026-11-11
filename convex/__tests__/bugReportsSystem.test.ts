// The SYSTEM bug-report channel (issue #9000, PRD issue #8998): a Bot fault is
// filed by the server as a `source: "system"` row, then as a P0 GitHub issue
// grouped by fingerprint. Three seams:
//
//   1. the pure issue payload — labels, title, fingerprint, row id, Target
//      files, and the public/private split (the tracker repo is public: no
//      state, no hidden-zone card name, no raw error message);
//   2. the pure dedupe / rate-limit planner — create / comment / skip;
//   3. the entry point, driven through the REGISTERED `fileSystemReport`
//      handler against the shared stub ctx (no convex-test harness here):
//      the row it writes and the filing it schedules; and the admin reads
//      that render it.
import { describe, expect, it } from "vitest";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
    BOT_FAULT_LABELS,
    BOT_FAULT_TARGET_FILES,
    SYSTEM_REPORTS_PER_GAME_CAP,
    SYSTEM_REPORTS_PER_HOUR_CAP,
    botFaultFingerprint,
    buildBotFaultIssueRequest,
    planSystemReportFiling,
    type BotFault,
} from "../botFaultReport";
import {
    buildGameStateSection,
    fileSystemReport,
    getBugReport,
    listBugReports,
} from "../bugReports";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { grizzlyBears, plains } from "../cards/sets/lea/index.cards";
import { compactState } from "../gre/serialize";
import type { GameState } from "../gre/state";
import { gameStateSeed, makeMutationCtx } from "./gameMutationHarness.fixture";

const HIDDEN_HAND = "Secret Hand Spell";
const HIDDEN_LIBRARY = "Buried Library Card";

const FAULT: BotFault = {
    origin: "client-handoff",
    expectedKind: "choice",
    choiceKind: "chooseMode",
    sourceCardName: "Crabomination",
    faultClass: "driver-error",
    errorMessage: `cannot read ${HIDDEN_HAND} of undefined at seq 41`,
    steps: [
        { step: "legalDecline", ok: false, message: HIDDEN_HAND },
        { step: "discardPendingChoice", ok: true, discarded: true },
    ],
};

/** A state whose hidden zones carry recognisable names. */
function stateWithHiddenZones(): GameState {
    const named = (id: string, name: string, zone: "hand" | "library") => ({
        ...makeInstance(plains().id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone,
        }),
        name,
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [named("h1", HIDDEN_HAND, "hand")],
                library: [named("l1", HIDDEN_LIBRARY, "library")],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
    });
}

describe("system bug report — issue payload (issue #9000)", () => {
    const state = stateWithHiddenZones() as unknown as Record<string, unknown>;
    const request = buildBotFaultIssueRequest({
        fault: FAULT,
        fingerprint: botFaultFingerprint(FAULT),
        reportId: "report-42",
        gameSection: buildGameStateSection({ gameId: "g1", seq: 41, state }),
    });

    it("carries the P0 Bot-fault labels and the `[Bot Fault]` title", () => {
        expect(request.labels).toEqual([
            "bug",
            "area:game-bot",
            "bot-fault",
            "ready-for-agent",
        ]);
        expect(request.labels).toBe(BOT_FAULT_LABELS);
        expect(request.title).toBe(
            "[Bot Fault] choice/chooseMode — Crabomination — driver-error"
        );
    });

    it("names the fingerprint, the row id, the recovery and a readable Target files section", () => {
        expect(request.body).toContain(botFaultFingerprint(FAULT));
        expect(request.body).toContain("report-42");
        expect(request.body).toContain(
            `bugReports:getReport '{"reportId":"report-42"}'`
        );
        // issue #9005 — the agent picking the issue starts from the position.
        expect(request.body).toContain(
            "bun run bug-report:pull report-42 --prod --out bug-report-report-42.json"
        );
        expect(request.body).toContain("forced discard");
        const section = request.body.split("## Target files")[1]!;
        for (const path of BOT_FAULT_TARGET_FILES)
            expect(section).toContain(`- \`${path}\``);
    });

    it("never carries the state, a hidden-zone card name or the raw error message", () => {
        expect(request.body).not.toContain(HIDDEN_HAND);
        expect(request.body).not.toContain(HIDDEN_LIBRARY);
        expect(request.body).not.toContain("cannot read");
        expect(request.body).not.toContain('"players"');
        expect(request.title).not.toContain(HIDDEN_HAND);
    });

    it("notes the missing client hand-off on a server-deadline fault only (issue #9004)", () => {
        const note = "no client hand-off — driver dead or tab closed";
        expect(request.body).not.toContain(note);
        const deadline = { ...FAULT, origin: "server-deadline" as const };
        const body = buildBotFaultIssueRequest({
            fault: deadline,
            fingerprint: botFaultFingerprint(deadline),
            reportId: "report-43",
            gameSection: null,
        }).body;
        expect(body).toContain(note);
    });
});

describe("system bug report — fingerprint (issue #9000)", () => {
    it("groups occurrences: origin, steps and the numbers in the message do not split it", () => {
        const again: BotFault = {
            ...FAULT,
            origin: "server-deadline",
            errorMessage: FAULT.errorMessage!.replace("41", "907"),
            steps: [],
        };
        expect(botFaultFingerprint(again)).toBe(botFaultFingerprint(FAULT));
    });

    it("splits on the window, the source card, the fault class and the message", () => {
        const base = botFaultFingerprint(FAULT);
        for (const other of [
            { ...FAULT, expectedKind: "target" },
            { ...FAULT, choiceKind: "chooseNumber" },
            { ...FAULT, sourceCardName: "Cabal Ritual" },
            { ...FAULT, faultClass: "unanswered" },
            { ...FAULT, errorMessage: "stack item vanished" },
        ])
            expect(botFaultFingerprint(other)).not.toBe(base);
    });
});

describe("system bug report — dedupe / rate-limit planner (issue #9000)", () => {
    const under = { priorGameReports: 0, priorHourReports: 0 };

    it("opens a new issue when the fingerprint has none, or only a closed one", () => {
        expect(
            planSystemReportFiling({ ...under, existingIssue: null })
        ).toEqual({ kind: "create" });
        expect(
            planSystemReportFiling({
                ...under,
                existingIssue: { number: 12, open: false },
            })
        ).toEqual({ kind: "create" });
    });

    it("comments on the fingerprint's open issue", () => {
        expect(
            planSystemReportFiling({
                ...under,
                existingIssue: { number: 12, open: true },
            })
        ).toEqual({ kind: "comment", issueNumber: 12 });
    });

    it("skips GitHub over the per-game or the hourly cap, even with an open issue", () => {
        const open = { number: 12, open: true };
        expect(
            planSystemReportFiling({
                priorGameReports: SYSTEM_REPORTS_PER_GAME_CAP - 1,
                priorHourReports: SYSTEM_REPORTS_PER_HOUR_CAP - 1,
                existingIssue: null,
            })
        ).toEqual({ kind: "create" });
        expect(
            planSystemReportFiling({
                priorGameReports: SYSTEM_REPORTS_PER_GAME_CAP,
                priorHourReports: 0,
                existingIssue: open,
            })
        ).toMatchObject({ kind: "skip" });
        expect(
            planSystemReportFiling({
                priorGameReports: 0,
                priorHourReports: SYSTEM_REPORTS_PER_HOUR_CAP,
                existingIssue: open,
            })
        ).toMatchObject({ kind: "skip" });
    });
});

describe("system bug report — entry point and admin reads (issue #9000)", () => {
    const GAME = {
        _id: "game-1",
        __table: "games",
        vsAi: true,
        players: [{ id: "human-1" }, { id: "bot-1" }],
    };
    const ADMIN = { _id: "admin-1", __table: "users", isAdmin: true };

    function fileOne() {
        const stub = makeMutationCtx(null, [
            GAME,
            ADMIN,
            gameStateSeed(
                compactState(stateWithHiddenZones()) as unknown as GameState,
                41
            ),
        ]);
        const scheduled: { fn: unknown; args: unknown }[] = [];
        const ctx = {
            ...stub.ctx,
            scheduler: {
                runAfter: async (_ms: number, fn: unknown, args: unknown) => {
                    scheduled.push({ fn, args });
                },
            },
        } as unknown as MutationCtx;
        const run = (
            fileSystemReport as unknown as {
                _handler: (c: MutationCtx, a: unknown) => Promise<string>;
            }
        )._handler(ctx, {
            gameId: "game-1",
            fault: FAULT,
            clientDiagnostics: { ring: ["decide threw"] },
        });
        return { stub, scheduled, run };
    }

    it('writes a `source: "system"` row — state, seq, fault, no userId — and schedules the filing for it', async () => {
        const { stub, scheduled, run } = fileOne();
        const reportId = await run;
        const row = stub.doc(reportId);
        expect(row.__table).toBe("bugReports");
        expect(row.source).toBe("system");
        expect(row).not.toHaveProperty("userId");
        expect(row.seq).toBe(41);
        expect(row.gameId).toBe("game-1");
        expect(row.fault).toEqual(FAULT);
        expect(row.fingerprint).toBe(botFaultFingerprint(FAULT));
        expect(row.clientDiagnostics).toEqual({ ring: ["decide threw"] });
        // The frozen state is EXPANDED (readable), and it is the evidence the
        // issue withholds.
        const state = row.state as GameState;
        expect(state.players[0]!.hand.map((c) => c.id)).toEqual(["h1"]);
        expect(scheduled).toEqual([
            { fn: expect.anything(), args: { reportId } },
        ]);
    });

    it("the admin list and detail render it as a system row with its fault", async () => {
        const { stub, run } = fileOne();
        const reportId = await run;
        const admin = stub.asUser("admin-1") as unknown as QueryCtx;
        const list = (await (
            listBugReports as unknown as {
                _handler: (c: QueryCtx, a: unknown) => Promise<unknown[]>;
            }
        )._handler(admin, {})) as { isSystem: boolean; name: string }[];
        expect(list).toEqual([
            expect.objectContaining({ isSystem: true, name: "System" }),
        ]);
        const detail = (await (
            getBugReport as unknown as {
                _handler: (c: QueryCtx, a: unknown) => Promise<unknown>;
            }
        )._handler(admin, { reportId })) as Record<string, unknown>;
        expect(detail).toMatchObject({
            source: "system",
            fault: FAULT,
            fingerprint: botFaultFingerprint(FAULT),
        });
    });
});

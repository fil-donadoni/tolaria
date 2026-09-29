// Bot Findings tables (ADR 0141 § 4, issue #4176): the seed rewrites MEASURED
// fields and never touches HUMAN ones, a finding the newer artifact drops is
// deactivated rather than deleted, and every read is admin-gated. Driven
// through the registered handlers over the shared stub ctx — the project has
// no convex-test harness.
import { describe, expect, it } from "vitest";
import {
    makeMutationCtx,
    runMutation,
    type Row,
} from "./gameMutationHarness.fixture";
import {
    latestMeasurement,
    listClasses,
    listFindings,
    seed,
} from "../botFindings";
import type { SeedPayload } from "../botFindingsCore";

const ADMIN: Row = {
    _id: "u-admin",
    __table: "users",
    nickname: "Ada",
    isAdmin: true,
};
const PLAIN: Row = { _id: "u-plain", __table: "users", nickname: "Plain" };

const NEVER = "never-chosen › Creature › (no Ops)";
const OTHER = "never-chosen › Sorcery › draw";

function measurement(sha: string): SeedPayload["measurement"] {
    return {
        sha,
        botHash: `bot-${sha}`,
        measuredAt: `at-${sha}`,
        targets: ["cube"],
        targetCardCount: 3,
        measuredCount: 3,
        unmeasuredHandWrittenCount: 10,
    };
}

const CLASS = {
    key: NEVER,
    cause: "never-chosen",
    blame: "bot" as const,
    causeText: "prose",
    cardCount: 1,
    targetCounts: [{ target: "cube", count: 1 }],
    issue: 4279,
};

/** A stored sweep finding carrying every human field. */
function storedFinding(id: string, oracleId: string, extra: Row = {}): Row {
    return {
        _id: id,
        __table: "botFindings",
        oracleId,
        source: "sweep",
        name: `old ${oracleId}`,
        targets: ["cube"],
        outcome: "ignored",
        cause: "never-chosen",
        form: "Creature",
        gap: NEVER,
        blame: "bot",
        sha: "old",
        botHash: "bot-old",
        measuredAt: "at-old",
        active: true,
        note: "admin note",
        reproducers: ["blade: never-chosen creature"],
        linkedIssue: 4279,
        snoozedAt: 1,
        snoozeReason: "out of scope",
        ...extra,
    };
}

const HUMAN = {
    note: "admin note",
    reproducers: ["blade: never-chosen creature"],
    linkedIssue: 4279,
    snoozedAt: 1,
    snoozeReason: "out of scope",
};

describe("botFindings.seed — measured fields rewritten, human fields untouched", () => {
    it("rewrites every measured field of a stored finding and keeps every human one", async () => {
        const stub = makeMutationCtx(null, [storedFinding("f-1", "o-a")]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [
                    {
                        oracleId: "o-a",
                        name: "Alpha",
                        printId: "p-a",
                        targets: ["cube", "premodern"],
                        outcome: "frozen",
                        cause: "never-chosen",
                        form: "Sorcery",
                        gap: OTHER,
                        blame: "bot",
                        compileSource: "hand-written",
                    },
                ],
                played: [],
                classes: [CLASS],
            },
        });
        const row = stub.doc("f-1");
        expect(row).toMatchObject({
            name: "Alpha",
            printId: "p-a",
            targets: ["cube", "premodern"],
            outcome: "frozen",
            form: "Sorcery",
            gap: OTHER,
            compileSource: "hand-written",
            sha: "new",
            botHash: "bot-new",
            measuredAt: "at-new",
            active: true,
            ...HUMAN,
        });
    });

    it("clears an optional measured field the new measurement lacks", async () => {
        const stub = makeMutationCtx(null, [storedFinding("f-1", "o-a")]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [
                    {
                        oracleId: "o-a",
                        name: "Alpha",
                        targets: ["cube"],
                        outcome: "ignored",
                    },
                ],
                played: [],
                classes: [],
            },
        });
        expect(stub.doc("f-1").form).toBeUndefined();
        expect(stub.doc("f-1").gap).toBeUndefined();
        expect(stub.doc("f-1")).toMatchObject(HUMAN);
    });

    // Issue #4179 — the refusal's decision trace is a MEASURED field: the
    // seed writes it, the page's read returns it, and a newer measurement
    // without one clears it (a card now refused for another reason must not
    // keep the old decision as its evidence).
    it("writes, serves and clears the decision trace as a measured field", async () => {
        const trace = {
            cardMove: "weighed" as const,
            search: {
                mechanism: "mean-reward",
                iterations: 48,
                weighed: 2,
                candidates: [
                    {
                        role: "chosen" as const,
                        label: "Pass",
                        visits: 40,
                        meanReward: 0.5,
                        total: 10,
                        terms: { life: [20, 20] },
                    },
                ],
            },
        };
        const finding = {
            oracleId: "o-a",
            name: "Alpha",
            targets: ["cube"],
            outcome: "ignored" as const,
            cause: "never-chosen",
        };
        const stub = makeMutationCtx("u-admin", [
            ADMIN,
            storedFinding("f-1", "o-a"),
        ]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [{ ...finding, trace }],
                played: [],
                classes: [],
            },
        });
        expect(stub.doc("f-1").trace).toEqual(trace);
        const served = await runMutation<unknown, Row[]>(
            listFindings,
            stub.ctx,
            {}
        );
        expect(served[0]!.trace).toEqual(trace);

        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("newer"),
                findings: [finding],
                played: [],
                classes: [],
            },
        });
        expect(stub.doc("f-1").trace).toBeUndefined();
        expect(stub.doc("f-1")).toMatchObject(HUMAN);
    });

    it("records a stored card the sweep now plays, keeping its class and its human fields", async () => {
        const stub = makeMutationCtx(null, [storedFinding("f-1", "o-a")]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [],
                played: ["o-a", "o-never-a-finding"],
                classes: [],
            },
        });
        expect(stub.doc("f-1")).toMatchObject({
            outcome: "played",
            gap: NEVER,
            sha: "new",
            active: true,
            ...HUMAN,
        });
        // A played card that was never a finding writes no row.
        expect(stub.writes.filter((w) => w.table === "botFindings")).toEqual(
            []
        );
    });

    it("deactivates a finding absent from the newer artifact instead of dropping it", async () => {
        const stub = makeMutationCtx(null, [storedFinding("f-1", "o-gone")]);
        const result = await runMutation<unknown, { deactivated: number }>(
            seed,
            stub.ctx,
            {
                payload: {
                    measurement: measurement("new"),
                    findings: [],
                    played: [],
                    classes: [],
                },
            }
        );
        expect(result.deactivated).toBe(1);
        expect(stub.doc("f-1")).toMatchObject({ active: false, ...HUMAN });
        // Its last measurement stands as the record.
        expect(stub.doc("f-1").sha).toBe("old");
    });

    it("never rewrites a finding of another source", async () => {
        const human = storedFinding("f-h", "o-a", { source: "human" });
        const stub = makeMutationCtx(null, [human]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [
                    {
                        oracleId: "o-a",
                        name: "Alpha",
                        targets: ["cube"],
                        outcome: "ignored",
                    },
                ],
                played: [],
                classes: [],
            },
        });
        expect(stub.doc("f-h")).toMatchObject({
            source: "human",
            sha: "old",
            active: true,
        });
        expect(
            stub.writes.filter((w) => w.table === "botFindings")
        ).toHaveLength(1);
    });

    it("upserts classes by key, deactivates a dropped one, and keeps ONE measurement row", async () => {
        const stub = makeMutationCtx(null, [
            {
                _id: "c-1",
                __table: "botFindingClasses",
                ...CLASS,
                issue: 1,
                active: true,
            },
            {
                _id: "c-2",
                __table: "botFindingClasses",
                ...CLASS,
                key: OTHER,
                active: true,
            },
            {
                _id: "m-1",
                __table: "botFindingMeasurements",
                ...measurement("old"),
            },
        ]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [],
                played: [],
                classes: [{ ...CLASS, issue: undefined, cardCount: 7 }],
            },
        });
        expect(stub.doc("c-1")).toMatchObject({ cardCount: 7, active: true });
        expect(stub.doc("c-1").issue).toBeUndefined();
        expect(stub.doc("c-2").active).toBe(false);
        expect(stub.doc("m-1").sha).toBe("new");
        expect(
            stub.writes.filter((w) => w.table === "botFindingMeasurements")
        ).toEqual([]);
    });

    // Issue #4181 — the per-class delta: cards now vs cards at the measurement
    // this seed replaces.
    describe("the class delta (issue #4181)", () => {
        const stored = (extra: Row = {}): Row => ({
            _id: "c-1",
            __table: "botFindingClasses",
            ...CLASS,
            cardCount: 5,
            active: true,
            ...extra,
        });
        const oldMeasurement: Row = {
            _id: "m-1",
            __table: "botFindingMeasurements",
            ...measurement("old"),
        };
        const seedClasses = (
            rows: Row[],
            sha: string,
            classes: SeedPayload["classes"]
        ) => {
            const stub = makeMutationCtx(null, rows);
            return runMutation(seed, stub.ctx, {
                payload: {
                    measurement: measurement(sha),
                    findings: [],
                    played: [],
                    classes,
                },
            }).then(() => stub);
        };

        it("records the count the class held at the measurement it replaces", async () => {
            const stub = await seedClasses([stored(), oldMeasurement], "new", [
                { ...CLASS, cardCount: 7 },
            ]);
            expect(stub.doc("c-1")).toMatchObject({
                cardCount: 7,
                previousCardCount: 5,
            });
        });

        it("gives a class the previous measurement did not carry a baseline of 0", async () => {
            const stub = await seedClasses([oldMeasurement], "new", [
                { ...CLASS, cardCount: 2 },
            ]);
            const inserted = stub.writes.find(
                (w) => w.table === "botFindingClasses"
            )!;
            expect(stub.doc(inserted.id)).toMatchObject({
                key: NEVER,
                cardCount: 2,
                previousCardCount: 0,
            });
        });

        it("writes no baseline on the very first measurement — nothing to compare against", async () => {
            const stub = await seedClasses([], "first", [CLASS]);
            const inserted = stub.writes.find(
                (w) => w.table === "botFindingClasses"
            )!;
            expect(stub.doc(inserted.id).previousCardCount).toBeUndefined();
        });

        it("leaves the baseline alone when the SAME measurement is seeded again", async () => {
            const stub = await seedClasses(
                [
                    stored({ cardCount: 7, previousCardCount: 5 }),
                    { ...oldMeasurement, ...measurement("same") },
                ],
                "same",
                [{ ...CLASS, cardCount: 7 }]
            );
            expect(stub.doc("c-1")).toMatchObject({
                cardCount: 7,
                previousCardCount: 5,
            });
        });

        it("stamps the current Bot hash on the measurement, and clears it when a seed carries none", async () => {
            const stub = makeMutationCtx(null, [
                { ...oldMeasurement, currentBotHash: "bot-stale" },
            ]);
            await runMutation(seed, stub.ctx, {
                payload: {
                    measurement: {
                        ...measurement("new"),
                        currentBotHash: "bot-now",
                    },
                    findings: [],
                    played: [],
                    classes: [],
                },
            });
            expect(stub.doc("m-1").currentBotHash).toBe("bot-now");
            await runMutation(seed, stub.ctx, {
                payload: {
                    measurement: measurement("newer"),
                    findings: [],
                    played: [],
                    classes: [],
                },
            });
            expect(stub.doc("m-1").currentBotHash).toBeUndefined();
        });
    });

    it("keeps the class a now-played finding names, even when no other card carries it", async () => {
        const stub = makeMutationCtx(null, [
            storedFinding("f-1", "o-a"),
            {
                _id: "c-1",
                __table: "botFindingClasses",
                ...CLASS,
                active: true,
            },
        ]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [],
                played: ["o-a"],
                classes: [],
            },
        });
        expect(stub.doc("f-1")).toMatchObject({
            outcome: "played",
            gap: NEVER,
        });
        expect(stub.doc("c-1").active).toBe(true);
    });

    it("shows a kept class holding 0 cards now, with its old count as the baseline (issue #4181)", async () => {
        const stub = makeMutationCtx(null, [
            storedFinding("f-1", "o-a"),
            {
                _id: "c-1",
                __table: "botFindingClasses",
                ...CLASS,
                cardCount: 4,
                active: true,
            },
            {
                _id: "m-1",
                __table: "botFindingMeasurements",
                ...measurement("old"),
            },
        ]);
        await runMutation(seed, stub.ctx, {
            payload: {
                measurement: measurement("new"),
                findings: [],
                played: ["o-a"],
                classes: [],
            },
        });
        expect(stub.doc("c-1")).toMatchObject({
            active: true,
            cardCount: 0,
            previousCardCount: 4,
            targetCounts: [{ target: "cube", count: 0 }],
        });
    });

    it("writes nothing to a row already deactivated, and does not count it again", async () => {
        const stub = makeMutationCtx(null, [
            storedFinding("f-1", "o-gone", { active: false }),
        ]);
        const result = await runMutation<unknown, { deactivated: number }>(
            seed,
            stub.ctx,
            {
                payload: {
                    measurement: measurement("new"),
                    findings: [],
                    played: [],
                    classes: [],
                },
            }
        );
        expect(result.deactivated).toBe(0);
        expect(stub.writes.filter((w) => w.id === "f-1")).toEqual([]);
    });
});

describe("botFindings reads are admin-gated", () => {
    const seeds = [
        ADMIN,
        PLAIN,
        storedFinding("f-1", "o-a"),
        storedFinding("f-2", "o-b", { active: false }),
        {
            _id: "c-1",
            __table: "botFindingClasses",
            ...CLASS,
            previousCardCount: 4,
            active: true,
        },
        { _id: "m-1", __table: "botFindingMeasurements", ...measurement("m") },
    ];

    it("refuses a non-admin and an anonymous caller on every read", async () => {
        for (const user of ["u-plain", null]) {
            const { ctx } = makeMutationCtx(user, seeds);
            for (const fn of [listFindings, listClasses, latestMeasurement])
                await expect(runMutation(fn, ctx, {})).rejects.toThrow(
                    "Forbidden: admin only"
                );
        }
    });

    it("serves an admin the active rows and the measurement", async () => {
        const { ctx } = makeMutationCtx("u-admin", seeds);
        const findings = await runMutation<unknown, Row[]>(
            listFindings,
            ctx,
            {}
        );
        expect(findings.map((f) => f.oracleId)).toEqual(["o-a"]);
        expect(findings[0]).toMatchObject(HUMAN);
        // The stale flag compares this against the measurement's hash.
        expect(findings[0]!.botHash).toBe("bot-old");
        const classes = await runMutation<unknown, Row[]>(listClasses, ctx, {});
        expect(classes.map((c) => c.key)).toEqual([NEVER]);
        expect(classes[0]!.previousCardCount).toBe(4);
        const m = await runMutation<unknown, Row>(latestMeasurement, ctx, {});
        expect(m).toEqual(measurement("m"));
    });
});

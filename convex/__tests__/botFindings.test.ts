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
    annotateFinding,
    latestMeasurement,
    listClasses,
    listFindings,
    reportFinding,
    seed,
    setFindingReproducers,
    snoozeFinding,
    unsnoozeFinding,
} from "../botFindings";
import bladeCardIndexJson from "../../data/blade-card-index.json";
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

describe("botFindings — derived status and class ranking (ADR 0141 § 3, issue #4177)", () => {
    const BOLT_GAP = "never-chosen › Instant › (no Ops)";

    it("names Lightning Bolt's own must blade entry as the class's proof, and marks the row class-fixed", async () => {
        const { ctx } = makeMutationCtx("u-admin", [
            ADMIN,
            storedFinding("f-bolt", "o-bolt", {
                name: "Lightning Bolt",
                gap: BOLT_GAP,
                outcome: "ignored",
            }),
            {
                _id: "c-bolt",
                __table: "botFindingClasses",
                ...CLASS,
                key: BOLT_GAP,
                active: true,
            },
        ]);
        const findings = await runMutation<unknown, Row[]>(
            listFindings,
            ctx,
            {}
        );
        expect(findings[0]!.status).toBe("class-fixed");
        const classes = await runMutation<unknown, Row[]>(listClasses, ctx, {});
        expect(typeof classes[0]!.provingEntry).toBe("string");
        expect((classes[0]!.provingEntry as string).length).toBeGreaterThan(0);
    });

    it("reads resolved once the same card plays, and open for a card no must entry names", async () => {
        const { ctx } = makeMutationCtx("u-admin", [
            ADMIN,
            storedFinding("f-bolt", "o-bolt", {
                name: "Lightning Bolt",
                gap: BOLT_GAP,
                outcome: "played",
            }),
            storedFinding("f-plain", "o-plain", {
                name: "Some Unindexed Test Card",
                gap: "other-gap",
                outcome: "ignored",
            }),
        ]);
        const findings = await runMutation<unknown, Row[]>(
            listFindings,
            ctx,
            {}
        );
        const byId = new Map(findings.map((f) => [f.oracleId, f]));
        expect(byId.get("o-bolt")!.status).toBe("resolved");
        expect(byId.get("o-plain")!.status).toBe("open");
    });

    it("marks harness-bound over a class proof, since the sweep's own harness owes the fix", async () => {
        const { ctx } = makeMutationCtx("u-admin", [
            ADMIN,
            storedFinding("f-bolt", "o-bolt", {
                name: "Lightning Bolt",
                gap: BOLT_GAP,
                outcome: "ignored",
                cause: "no-progress",
            }),
        ]);
        const findings = await runMutation<unknown, Row[]>(
            listFindings,
            ctx,
            {}
        );
        expect(findings[0]!.status).toBe("harness-bound");
    });

    it("ranks by PRIORITY order, not by key or cardCount — premodern-metagame (priority 1) beats format-premodern (priority 3) despite a higher key and a higher cardCount", async () => {
        const { ctx } = makeMutationCtx("u-admin", [
            ADMIN,
            {
                _id: "c-format",
                __table: "botFindingClasses",
                ...CLASS,
                key: "aaa-format-only",
                cardCount: 9,
                targetCounts: [
                    { target: "premodern-metagame", count: 0 },
                    { target: "format-premodern", count: 9 },
                ],
                active: true,
            },
            {
                _id: "c-premodern",
                __table: "botFindingClasses",
                ...CLASS,
                key: "zzz-premodern-only",
                cardCount: 1,
                targetCounts: [
                    { target: "premodern-metagame", count: 1 },
                    { target: "format-premodern", count: 0 },
                ],
                active: true,
            },
        ]);
        const classes = await runMutation<unknown, Row[]>(listClasses, ctx, {});
        // Sorting by key ASCENDING or by cardCount DESCENDING would both put
        // "aaa-format-only" first — it wins neither way here. Only comparing
        // premodern-metagame's count before format-premodern's (priority 1
        // before priority 3) puts "zzz-premodern-only" first, despite its
        // higher key and its lower cardCount.
        expect(classes.map((c) => c.key)).toEqual([
            "zzz-premodern-only",
            "aaa-format-only",
        ]);
    });
});

// ── Human findings: report, reproducer gate, annotate, snooze (issue #4182) ──

/** A real blade entry label — a Reproducer must resolve to one (or a saved
 *  scenario), so the test reads it from the committed index, never invents it. */
const BLADE_LABEL = Object.values(
    bladeCardIndexJson as Record<string, { label: string }[]>
)[0]![0]!.label;

const SCENARIO: Row = {
    _id: "s-1",
    __table: "debugScenarios",
    label: "saved: stuck Grist board",
    spec: {},
};

const EMPTY_SEED: SeedPayload = {
    measurement: measurement("new"),
    findings: [],
    played: [],
    classes: [],
};

describe("botFindings.reportFinding — human source beside the measured row", () => {
    it("inserts under its own source and leaves the measured row on the card untouched", async () => {
        const stub = makeMutationCtx("u-admin", [
            ADMIN,
            storedFinding("f-1", "o-a"),
        ]);
        const id = await runMutation<unknown, string>(reportFinding, stub.ctx, {
            oracleId: "o-a",
            name: "Alpha",
            note: "  plays it wrong  ",
        });
        expect(stub.doc(id)).toMatchObject({
            oracleId: "o-a",
            source: "human",
            name: "Alpha",
            note: "plays it wrong",
            active: true,
        });
        expect(stub.doc(id).reproducers).toBeUndefined();
        expect(stub.doc("f-1")).toMatchObject({
            source: "sweep",
            name: "old o-a",
            ...HUMAN,
        });
    });

    it("refuses a second human report on the same card", async () => {
        const stub = makeMutationCtx("u-admin", [ADMIN]);
        const args = { oracleId: "o-a", name: "Alpha" };
        await runMutation(reportFinding, stub.ctx, args);
        await expect(
            runMutation(reportFinding, stub.ctx, args)
        ).rejects.toThrow("already has a human report");
    });

    it("refuses a reproducer label that names no blade entry and no saved scenario", async () => {
        const stub = makeMutationCtx("u-admin", [ADMIN]);
        await expect(
            runMutation(reportFinding, stub.ctx, {
                oracleId: "o-a",
                name: "Alpha",
                reproducers: ["a made-up label"],
            })
        ).rejects.toThrow("Unknown reproducer label: a made-up label");
    });

    it("accepts a blade entry label and a saved scenario label", async () => {
        const stub = makeMutationCtx("u-admin", [ADMIN, SCENARIO]);
        const id = await runMutation<unknown, string>(reportFinding, stub.ctx, {
            oracleId: "o-a",
            name: "Alpha",
            reproducers: [BLADE_LABEL, ` ${SCENARIO.label as string} `],
        });
        expect(stub.doc(id).reproducers).toEqual([BLADE_LABEL, SCENARIO.label]);
    });

    it("survives a re-seed of the SAME card's sweep row, and the seed never writes it", async () => {
        const stub = makeMutationCtx("u-admin", [
            ADMIN,
            SCENARIO,
            storedFinding("f-1", "o-a"),
        ]);
        const id = await runMutation<unknown, string>(reportFinding, stub.ctx, {
            oracleId: "o-a",
            name: "Alpha",
            reproducers: [SCENARIO.label as string],
        });
        // A newer artifact that no longer carries the card deactivates the
        // SWEEP row; the human row is a different key and is not in the plan.
        await runMutation(seed, stub.ctx, { payload: EMPTY_SEED });
        expect(stub.doc("f-1").active).toBe(false);
        expect(stub.doc(id)).toMatchObject({
            source: "human",
            active: true,
            reproducers: [SCENARIO.label],
        });
        expect(stub.writes.filter((w) => w.id === id).length).toBe(1);
    });
});

describe("botFindings human fields — note, issue, reproducers, snooze", () => {
    const seeds = [
        ADMIN,
        SCENARIO,
        storedFinding("f-1", "o-a", { note: "old" }),
    ];

    it("annotate replaces the note and issue, and clears them when emptied", async () => {
        const stub = makeMutationCtx("u-admin", seeds);
        await runMutation(annotateFinding, stub.ctx, {
            id: "f-1",
            note: " new note ",
            linkedIssue: 4300,
        });
        expect(stub.doc("f-1")).toMatchObject({
            note: "new note",
            linkedIssue: 4300,
        });
        await runMutation(annotateFinding, stub.ctx, {
            id: "f-1",
            note: "  ",
            linkedIssue: null,
        });
        expect(stub.doc("f-1").note).toBeUndefined();
        expect(stub.doc("f-1").linkedIssue).toBeUndefined();
    });

    it("annotate and report refuse a note past the cap and write nothing", async () => {
        const stub = makeMutationCtx("u-admin", seeds);
        const long = "x".repeat(2001);
        await expect(
            runMutation(annotateFinding, stub.ctx, {
                id: "f-1",
                note: long,
                linkedIssue: null,
            })
        ).rejects.toThrow("at most 2000 characters");
        await expect(
            runMutation(reportFinding, stub.ctx, {
                oracleId: "o-n",
                name: "N",
                note: long,
            })
        ).rejects.toThrow("at most 2000 characters");
        expect(stub.writes).toEqual([]);
    });

    it("annotate refuses a linked issue that is not a positive integer", async () => {
        const stub = makeMutationCtx("u-admin", seeds);
        for (const linkedIssue of [0, -3, 1.5])
            await expect(
                runMutation(annotateFinding, stub.ctx, {
                    id: "f-1",
                    note: "",
                    linkedIssue,
                })
            ).rejects.toThrow("positive issue number");
    });

    it("setFindingReproducers admits a label and clears the list when emptied", async () => {
        const stub = makeMutationCtx("u-admin", seeds);
        await runMutation(setFindingReproducers, stub.ctx, {
            id: "f-1",
            reproducers: [` ${SCENARIO.label as string}`, ""],
        });
        expect(stub.doc("f-1").reproducers).toEqual([SCENARIO.label]);
        await runMutation(setFindingReproducers, stub.ctx, {
            id: "f-1",
            reproducers: [],
        });
        expect(stub.doc("f-1").reproducers).toBeUndefined();
    });

    it("snooze stores the trimmed reason and a time; a blank reason is refused and writes nothing", async () => {
        const stub = makeMutationCtx("u-admin", [
            ADMIN,
            storedFinding("f-1", "o-a", {
                snoozedAt: undefined,
                snoozeReason: undefined,
            }),
        ]);
        for (const reason of ["", "   "])
            await expect(
                runMutation(snoozeFinding, stub.ctx, { id: "f-1", reason })
            ).rejects.toThrow("A snooze needs a reason");
        expect(stub.writes).toEqual([]);
        await runMutation(snoozeFinding, stub.ctx, {
            id: "f-1",
            reason: "  out of scope: Un-card  ",
        });
        expect(stub.doc("f-1")).toMatchObject({
            snoozeReason: "out of scope: Un-card",
        });
        expect(typeof stub.doc("f-1").snoozedAt).toBe("number");
    });

    it("unsnooze clears both snooze fields", async () => {
        const stub = makeMutationCtx("u-admin", seeds);
        await runMutation(unsnoozeFinding, stub.ctx, { id: "f-1" });
        expect(stub.doc("f-1").snoozedAt).toBeUndefined();
        expect(stub.doc("f-1").snoozeReason).toBeUndefined();
    });

    it("human fields persist across a re-seed of the same row", async () => {
        const stub = makeMutationCtx("u-admin", [
            ADMIN,
            storedFinding("f-1", "o-a", {
                snoozedAt: undefined,
                snoozeReason: undefined,
                note: undefined,
                linkedIssue: undefined,
                reproducers: undefined,
            }),
        ]);
        await runMutation(snoozeFinding, stub.ctx, {
            id: "f-1",
            reason: "deliberately out of scope",
        });
        await runMutation(annotateFinding, stub.ctx, {
            id: "f-1",
            note: "kept",
            linkedIssue: 4300,
        });
        await runMutation(seed, stub.ctx, {
            payload: {
                ...EMPTY_SEED,
                findings: [
                    {
                        oracleId: "o-a",
                        name: "Alpha",
                        targets: ["cube"],
                        outcome: "ignored",
                    },
                ],
            },
        });
        expect(stub.doc("f-1")).toMatchObject({
            name: "Alpha",
            note: "kept",
            linkedIssue: 4300,
            snoozeReason: "deliberately out of scope",
        });
    });

    it("every human write is admin-only", async () => {
        for (const user of ["u-plain", null]) {
            const { ctx } = makeMutationCtx(user, [
                ADMIN,
                PLAIN,
                storedFinding("f-1", "o-a"),
            ]);
            const calls: [unknown, Row][] = [
                [reportFinding, { oracleId: "o", name: "n" }],
                [annotateFinding, { id: "f-1", note: "", linkedIssue: null }],
                [setFindingReproducers, { id: "f-1", reproducers: [] }],
                [snoozeFinding, { id: "f-1", reason: "r" }],
                [unsnoozeFinding, { id: "f-1" }],
            ];
            for (const [fn, args] of calls)
                await expect(runMutation(fn, ctx, args)).rejects.toThrow(
                    "Forbidden: admin only"
                );
        }
    });

    it("listFindings serves a human row with its source and human fields", async () => {
        const stub = makeMutationCtx("u-admin", [ADMIN, SCENARIO]);
        await runMutation(reportFinding, stub.ctx, {
            oracleId: "o-h",
            name: "Human",
            reproducers: [SCENARIO.label as string],
        });
        const rows = await runMutation<unknown, Row[]>(
            listFindings,
            stub.ctx,
            {}
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            source: "human",
            name: "Human",
            reproducers: [SCENARIO.label],
            status: "open",
        });
    });
});

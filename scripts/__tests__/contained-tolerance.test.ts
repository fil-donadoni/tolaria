/**
 * A lane tolerates a Contained RED's failing test NAMES, never its files (ADR
 * 0163 §4, issue #8076). The vitest output below is the shape a real run
 * printed: both FAIL line forms, and the `file [ file ]` of a suite that
 * cannot load.
 */
import { describe, expect, it, vi } from "vitest";
import {
    containedTestNames,
    containedTolerance,
    laneStepFailedTests,
    toleratedTests,
    type ContainedDeps,
} from "../lib/contained-tolerance";
import { buildEvidence, evidenceTestNames } from "../lib/health-evidence";
import { lineageOf, type Verdict } from "../lib/health-verdict-store";

const FILE = "convex/gre/ai/__tests__/calibration.bot.test.ts";
const VITEST = `bunx vitest run --project bot-node ${FILE}`;
const PHANTASMAL = `${FILE} > calibration > values Phantasmal Image`;
const SERRA = `${FILE} > calibration > values Serra Angel`;

function vitestRed(...names: string[]): string {
    return [
        "⎯⎯⎯⎯⎯⎯⎯ Failed Tests ⎯⎯⎯⎯⎯⎯⎯",
        "",
        ...names.flatMap((n) => [
            ` FAIL  |bot-node| ${n}`,
            "AssertionError: expected 1 to be 2",
            "",
        ]),
        ` Test Files  1 failed (1)`,
        `      Tests  ${names.length} failed | 3 passed (${names.length + 3})`,
    ].join("\n");
}

const LOAD_FAILURE = [
    "⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯",
    "",
    ` FAIL  |bot-node| ${FILE} [ ${FILE} ]`,
    "Error: Cannot find module",
    "",
    " Test Files  1 failed (1)",
    "      Tests  no tests",
].join("\n");

const SHA = "a".repeat(40);
const evidenceOf = (...names: string[]): string =>
    buildEvidence({
        sha: SHA,
        step: "test",
        machine: "m",
        logPath: "/l",
        output: vitestRed(...names),
        status: 1,
        signal: null,
        at: "2026-11-04T00:00:00Z",
    }).body;

const red = (redClass?: "contained"): Verdict => ({
    sha: SHA,
    status: "red",
    step: "test",
    failure: "assertion",
    ...(redClass ? { redClass } : {}),
});

function deps(over: Partial<ContainedDeps> = {}): ContainedDeps {
    return {
        lineage: () => lineageOf([red("contained")]),
        evidence: () => evidenceOf(PHANTASMAL),
        log: () => undefined,
        ...over,
    };
}

describe("laneStepFailedTests — names only when they account for the failure", () => {
    it("names each failing test beside its file", () => {
        expect(
            laneStepFailedTests(VITEST, vitestRed(PHANTASMAL, SERRA))
        ).toEqual([PHANTASMAL, SERRA]);
    });

    it("reads the coloured FAIL line a CI environment prints", () => {
        const coloured = vitestRed(PHANTASMAL).replace(
            "|bot-node|",
            "\u001b[43m bot-node \u001b[49m"
        );
        expect(laneStepFailedTests(VITEST, coloured)).toEqual([PHANTASMAL]);
    });

    it("an env-prefixed vitest run is a plain vitest run (the bot fast lane)", () => {
        expect(
            laneStepFailedTests(
                `TOLARIA_BOT_FAST=1 ${VITEST}`,
                vitestRed(PHANTASMAL)
            )
        ).toEqual([PHANTASMAL]);
    });

    it("a chain that stops at its first red names nothing: its later steps never ran", () => {
        expect(
            laneStepFailedTests("bun run check:pr", vitestRed(PHANTASMAL))
        ).toBeUndefined();
    });

    it("a file that cannot load names nothing", () => {
        expect(laneStepFailedTests(VITEST, LOAD_FAILURE)).toBeUndefined();
    });

    it("a load failure beside a named failure names nothing", () => {
        const both = vitestRed(PHANTASMAL).replace(
            " Test Files",
            ` FAIL  |bot-node| ${FILE} [ ${FILE} ]\n Test Files`
        );
        expect(laneStepFailedTests(VITEST, both)).toBeUndefined();
    });

    it("an untagged or unreadable FAIL line names nothing", () => {
        const odd = vitestRed(PHANTASMAL).replace(
            " Test Files",
            " FAIL  something vitest did not print before\n Test Files"
        );
        expect(laneStepFailedTests(VITEST, odd)).toBeUndefined();
    });

    it("a failure the summary counts and no FAIL line names, names nothing", () => {
        const short = vitestRed(PHANTASMAL).replace(
            "Tests  1 failed",
            "Tests  2 failed"
        );
        expect(laneStepFailedTests(VITEST, short)).toBeUndefined();
    });

    it("a run with no summary names nothing: it did not finish", () => {
        const cut = vitestRed(PHANTASMAL).split(" Test Files")[0];
        expect(laneStepFailedTests(VITEST, cut)).toBeUndefined();
    });

    it("vitest's Unhandled Errors report names nothing", () => {
        const output = `${vitestRed(PHANTASMAL)}\n⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\nVitest caught 1 unhandled error during the test run.`;
        expect(laneStepFailedTests(VITEST, output)).toBeUndefined();
    });

    it("an unhandled rejection's report names nothing", () => {
        const output = `${vitestRed(PHANTASMAL)}\n⎯⎯⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯⎯`;
        expect(laneStepFailedTests(VITEST, output)).toBeUndefined();
    });

    it("the bare phrase in a test's name is not vitest's report (issue #8073)", () => {
        const output = `stdout | a.test.ts > captures an unhandled rejection\n${vitestRed(PHANTASMAL)}`;
        expect(laneStepFailedTests(VITEST, output)).toEqual([PHANTASMAL]);
    });
});

describe("toleratedTests — every failure is a known name", () => {
    const known = new Set([PHANTASMAL]);

    it("all failures known: forgiven, each name returned", () => {
        expect(toleratedTests(known, [PHANTASMAL])).toEqual([PHANTASMAL]);
    });

    it("one unknown name in the same file: red", () => {
        expect(toleratedTests(known, [PHANTASMAL, SERRA])).toBeNull();
    });

    it("no names at all: red, never a vacuous pass", () => {
        expect(toleratedTests(known, [])).toBeNull();
        expect(toleratedTests(known, undefined)).toBeNull();
    });

    it("the same name in another file is another test", () => {
        expect(
            toleratedTests(known, [
                "other.test.ts > calibration > values Phantasmal Image",
            ])
        ).toBeNull();
    });
});

describe("containedTestNames — what the standing RED's evidence lists", () => {
    it("reads the names off the published evidence of the standing RED's sha", () => {
        const evidence = vi.fn(() => evidenceOf(PHANTASMAL));
        expect([...containedTestNames(deps({ evidence }))]).toEqual([
            PHANTASMAL,
        ]);
        expect(evidence).toHaveBeenCalledWith(SHA);
    });

    it("a whole-file row vouches for no test", () => {
        const body = evidenceOf(PHANTASMAL).replaceAll(
            `FAIL  |bot-node| ${PHANTASMAL}`,
            "(cut)"
        );
        expect(evidenceTestNames(body)).toEqual([]);
        expect(
            [...containedTestNames(deps({ evidence: () => body }))].length
        ).toBe(0);
    });

    it.each([
        ["a blocking RED", lineageOf([red()])],
        [
            "a RED mixed with a blocking one",
            lineageOf([red("contained"), red()]),
        ],
        ["no verdict", lineageOf([])],
        ["a GREEN", lineageOf([{ sha: SHA, status: "green" }])],
    ])("%s tolerates nothing and reads no evidence", (_what, lineage) => {
        const evidence = vi.fn(() => evidenceOf(PHANTASMAL));
        const names = containedTestNames(
            deps({ lineage: () => lineage, evidence })
        );
        expect(names.size).toBe(0);
        expect(evidence).not.toHaveBeenCalled();
    });

    it("a second-red tolerates nothing, whatever the classes", () => {
        const lineage = lineageOf([
            red("contained"),
            { sha: "b".repeat(40), status: "amber" },
        ]);
        expect(lineage.kind).toBe("second-red");
        expect(containedTestNames(deps({ lineage: () => lineage })).size).toBe(
            0
        );
    });

    it("an unreadable lineage tolerates nothing, and says so", () => {
        const log = vi.fn();
        const names = containedTestNames(
            deps({
                lineage: () => ({
                    kind: "none",
                    verdict: null,
                    error: "HTTP 502",
                }),
                log,
            })
        );
        expect(names.size).toBe(0);
        expect(log.mock.calls[0][0]).toMatch(/lineage is unreadable.*HTTP 502/);
    });

    it("an unreadable evidence tolerates nothing, and says so", () => {
        const log = vi.fn();
        const names = containedTestNames(
            deps({
                evidence: () => {
                    throw new Error("HTTP 502");
                },
                log,
            })
        );
        expect(names.size).toBe(0);
        expect(log.mock.calls[0][0]).toMatch(/unreadable.*HTTP 502/);
    });

    it("no published evidence tolerates nothing, and says so", () => {
        const log = vi.fn();
        const names = containedTestNames(deps({ evidence: () => null, log }));
        expect(names.size).toBe(0);
        expect(log.mock.calls[0][0]).toMatch(/no evidence published/);
    });
});

describe("containedTolerance — one reading per run, only when a failure asks", () => {
    it("forgives across steps off one reading of the pivot", () => {
        const lineage = vi.fn(() => lineageOf([red("contained")]));
        const tolerate = containedTolerance(deps({ lineage }));
        expect(tolerate([PHANTASMAL])).toEqual([PHANTASMAL]);
        expect(tolerate([SERRA])).toBeNull();
        expect(lineage).toHaveBeenCalledTimes(1);
    });

    it("a nameless failure reads nothing: no call for what cannot be forgiven", () => {
        const lineage = vi.fn(() => lineageOf([red("contained")]));
        const tolerate = containedTolerance(deps({ lineage }));
        expect(tolerate(undefined)).toBeNull();
        expect(tolerate([])).toBeNull();
        expect(lineage).not.toHaveBeenCalled();
    });
});

import { describe, expect, it } from "vitest";
import {
    buildEvidence,
    classifyFailure,
    EVIDENCE_MAX,
    evidenceMarker,
    evidenceSummary,
    failingFiles,
    failingProjects,
} from "../lib/health-evidence";
import { failedVitestProjects, planRetry } from "../lib/health-retry";
import {
    decodeStatus,
    encodeDescription,
    failedTestFiles,
    githubEvidenceStore,
    type GhRunner,
} from "../lib/health-verdict-store";

/**
 * The RED evidence (issue #5589). Base tips `bb54e006f` / `00aebfc40` went
 * RED at `test` on the Huawei with an EMPTY `tests:` field: vitest prints its
 * project label ` node-tooling ` on a coloured background when colour is on,
 * `|node-tooling|` only when it is off, and the parser knew one form.
 */

const SHA = "00aebfc400a339c202c8bf0ee03121d4a0379f1f";
const FILE = "scripts/__tests__/health-walk-off-mutex.test.ts";

/** A FAIL line exactly as vitest 4 prints it with colour on
 *  (`formatProjectName`: black on a background, then a space). */
const colouredFail = (project: string, file: string, name: string) =>
    `\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m \u001b[30m\u001b[46m ${project} \u001b[49m\u001b[39m ${file}\u001b[2m > \u001b[22m${name}`;

const COLOURED_RUN = [
    "$ bun scripts/gate.ts heavy 'vitest run --project node-engine --project node-tooling --project dom'",
    "\u001b[31m⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯\u001b[39m",
    "",
    colouredFail("node-tooling", FILE, "health-main --ui-all > the walk gates"),
    "\u001b[31mAssertionError: expected 'advisory' to be 'green'\u001b[39m",
    " ❯ scripts/__tests__/health-walk-off-mutex.test.ts:88:31",
    "",
    colouredFail(
        "node-tooling",
        FILE,
        "health-main --ui-all > a red walk is RED"
    ),
    "\u001b[31mAssertionError: expected 'green' to be 'red'\u001b[39m",
    "",
    "\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m | 1796 passed",
    "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[31m2 failed\u001b[39m\u001b[22m | 20000 passed",
].join("\n");

describe("the FAIL line, both label forms (the incident)", () => {
    it("names the file and project of a COLOURED run", () => {
        expect(failingFiles(COLOURED_RUN)).toEqual([FILE]);
        expect(failingProjects(COLOURED_RUN)).toEqual(["node-tooling"]);
        // The verdict's `tests:` reader is the same parser.
        expect(failedTestFiles(COLOURED_RUN)).toEqual([FILE]);
    });

    it("lets the retry cover a coloured run — it read nothing before", () => {
        expect(failedVitestProjects(COLOURED_RUN)).toEqual(["node-tooling"]);
        expect(planRetry("test", COLOURED_RUN)?.projects).toEqual([
            "node-tooling",
        ]);
    });

    it("still reads the plain `|project|` form and an untagged line", () => {
        const out = [
            " FAIL  |dom| src/a.test.tsx > x",
            " FAIL  convex/b.test.ts > y",
        ].join("\n");
        expect(failingFiles(out)).toEqual([
            "convex/b.test.ts",
            "src/a.test.tsx",
        ]);
        expect(failingProjects(out)).toEqual(["dom"]);
    });
});

describe("classifyFailure — a RED is never silently empty", () => {
    const base = { step: "test", status: 1, signal: null };

    it("assertion: failing tests named", () => {
        expect(classifyFailure({ ...base, output: COLOURED_RUN }).kind).toBe(
            "assertion"
        );
    });

    it("timeout: every failing test timed out", () => {
        const out = [
            " FAIL  |bot-node| x.bot.test.ts > slow",
            "Error: Test timed out in 5000ms.",
            "      Tests  1 failed | 9 passed",
        ].join("\n");
        expect(classifyFailure({ ...base, output: out }).kind).toBe("timeout");
    });

    it("crash: a signal, an unhandled error, a worker death — named as such", () => {
        expect(
            classifyFailure({
                ...base,
                output: "",
                status: null,
                signal: "SIGKILL",
            })
        ).toMatchObject({
            kind: "crash",
            detail: expect.stringMatching(/SIGKILL.*OOM/),
        });
        const unhandled = `${COLOURED_RUN}\n⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯\nError: Worker exited unexpectedly`;
        expect(classifyFailure({ ...base, output: unhandled }).kind).toBe(
            "crash"
        );
        expect(
            classifyFailure({
                ...base,
                output: "<--- JS stacktrace --->\nFATAL ERROR: JavaScript heap out of memory",
            }).kind
        ).toBe("crash");
    });

    it("a test NAME or console line about unhandled errors is not a crash", () => {
        const out = [
            " FAIL  |node-tooling| scripts/__tests__/x.test.ts > reports Unhandled Errors and Error: Channel closed",
            "stdout | a passing test: Aborted (core dumped) is what the shell prints",
            "AssertionError: expected 1 to be 2",
        ].join("\n");
        expect(classifyFailure({ ...base, output: out }).kind).toBe(
            "assertion"
        );
    });

    it("gate: a non-test step with no failing test", () => {
        expect(
            classifyFailure({
                ...base,
                step: "check:all",
                output: "error TS2322",
            })
        ).toMatchObject({ kind: "gate", detail: "check:all exited 1" });
    });

    it("unparsed: a test step whose output names nothing — says so", () => {
        expect(
            classifyFailure({ ...base, output: "something went wrong" }).kind
        ).toBe("unparsed");
    });
});

describe("buildEvidence", () => {
    const input = {
        sha: SHA,
        step: "test",
        machine: "omarchy",
        logPath:
            "/home/fil/code/mtg/tolaria/.claude/telemetry/health/00aebfc400a3.log",
        output: COLOURED_RUN,
        status: 1,
        signal: null,
        at: "2026-10-14T04:31:09Z",
    };

    it("carries kind, projects, files, the assertion and the local log, behind the sha's marker", () => {
        const ev = buildEvidence(input);
        expect(ev).toMatchObject({
            kind: "assertion",
            projects: ["node-tooling"],
            files: [FILE],
        });
        expect(ev.body.startsWith(evidenceMarker(SHA))).toBe(true);
        expect(ev.body).toContain("expected 'advisory' to be 'green'");
        expect(ev.body).toContain(input.logPath);
        expect(ev.body).not.toContain("\u001b[");
        expect(evidenceSummary(ev.body)).toMatch(/failure:\*\* assertion/);
    });

    it("stays under the pivot's cap whatever the output", () => {
        const huge = `${COLOURED_RUN}\n${"x".repeat(200)}\n`.repeat(2000);
        const ev = buildEvidence({ ...input, output: huge });
        expect(ev.body.length).toBeLessThanOrEqual(EVIDENCE_MAX);
        expect(ev.body).toContain("more characters");
    });
});

describe("the verdict's `failure:` field", () => {
    it("round-trips through the commit-status description", () => {
        const desc = encodeDescription({
            sha: SHA,
            status: "red",
            step: "test",
            machine: "omarchy",
            failure: "crash",
            tests: [FILE],
        });
        expect(desc).toBe(
            `RED · test · omarchy · failure: crash · tests: ${FILE}`
        );
        expect(
            decodeStatus({
                sha: SHA,
                state: "failure",
                description: desc,
                targetUrl: "https://github.com/o/r/commit/x#commitcomment-1",
                createdAt: null,
            })
        ).toMatchObject({ failure: "crash", tests: [FILE] });
    });
});

describe("the evidence store — the pivot", () => {
    it("github: publishes a commit comment on the sha and reads the newest back", () => {
        const calls: string[][] = [];
        const comments: { body: string }[] = [
            { body: "an unrelated comment" },
            { body: `${evidenceMarker(SHA)}\nold` },
            { body: `${evidenceMarker("ffff")}\nanother sha` },
            { body: `${evidenceMarker(SHA)}\nnew` },
        ];
        const run: GhRunner = (args) => {
            calls.push(args);
            if (args.includes("POST"))
                return {
                    status: 0,
                    stdout: "https://github.com/o/r/commit/abc#commitcomment-9\n",
                    stderr: "",
                };
            return { status: 0, stdout: JSON.stringify(comments), stderr: "" };
        };
        const store = githubEvidenceStore({ repo: "o/r", run });
        expect(store.publish(SHA, "body")).toBe(
            "https://github.com/o/r/commit/abc#commitcomment-9"
        );
        expect(calls[0]).toContain(`repos/o/r/commits/${SHA}/comments`);
        expect(store.read(SHA)).toBe(`${evidenceMarker(SHA)}\nnew`);
        // An abbreviated sha (the other machine has not fetched the tip).
        expect(store.read(SHA.slice(0, 12))).toBe(
            `${evidenceMarker(SHA)}\nnew`
        );
        expect(store.read("0000")).toBeNull();
    });

    it("github: a publish GitHub refuses throws (health-main reports it)", () => {
        const store = githubEvidenceStore({
            repo: "o/r",
            run: () => ({ status: 1, stdout: "", stderr: "HTTP 403" }),
        });
        expect(() => store.publish(SHA, "b")).toThrow(/403/);
    });
});

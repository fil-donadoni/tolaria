// The behavioural gold DRIVER's verdict logic (issue #2703).
//
// `convex/oracle/__tests__/behavioural.test.ts` covers the swap primitives.
// This file covers the half that turns a vitest subprocess into a report row,
// which had no coverage at all in the first cut — and that is exactly why the
// case below shipped wrong: a run whose SETUP threw was classified by its test
// tally (zero) before its exit status (non-zero), so the harness's own alarm
// was filed as the mildest verdict in the report.
//
// Recorded logs rather than real subprocesses, deliberately: the question here
// is "given what vitest printed and returned, what did we prove?", and that is
// a pure function. Spawning a real run to ask it would make the test slow, and
// would not cover the failure shapes that are hard to provoke on demand.

import { describe, expect, it } from "vitest";
import { classifyRun } from "../oracle-behavioural";

/** Exit 0, the filter matched only skipped tests. */
const NO_MATCH_LOG = `
 Test Files  1 passed (1)
      Tests  161 skipped (161)
   Duration  5.94s
`;

/** Exit 1, the setup file threw before any test was collected. This is the
 *  real shape — `Tests  no tests` — taken from a run with a bogus swap id. */
const SWAP_ERROR_LOG = `
Error: BehaviouralSwapError: [TOLARIA_ORACLE_SWAP] "not-a-real-id" is not a card in the hand-written catalogue
 Test Files  1 failed (1)
      Tests  no tests
`;

const GREEN_LOG = `
 Test Files  1 passed (1)
      Tests  3 passed | 158 skipped (161)
`;

const RED_LOG = `
AssertionError: expected 20 to be 19 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed | 158 skipped (161)
`;

describe("classifyRun — a run that measured nothing is never a card verdict", () => {
    it("calls a setup failure a HARNESS error, not a missing test", () => {
        // The regression this file exists for. Both this and NO_MATCH_LOG have
        // a zero test count; only the exit status tells them apart, so the
        // status must be consulted first. Classifying by count alone reported
        // "the file names the card but no test title matched it" — a quiet row
        // in the untested bucket — for a run where the swap never happened.
        const outcome = classifyRun(1, SWAP_ERROR_LOG);
        expect(outcome.kind).toBe("harness-error");
        if (outcome.kind !== "harness-error") return;
        expect(outcome.detail).toContain("BehaviouralSwapError");
        expect(outcome.detail).toContain("not-a-real-id");
    });

    it("calls an empty -t filter no-match", () => {
        expect(classifyRun(0, NO_MATCH_LOG)).toEqual({ kind: "no-match" });
    });

    it("never reports either zero-test shape as green", () => {
        // The property that matters more than the labels: a run that executed
        // no assertion cannot be evidence for retiring a card.
        for (const [status, log] of [
            [0, NO_MATCH_LOG],
            [1, SWAP_ERROR_LOG],
        ] as const) {
            expect(classifyRun(status, log).kind).not.toBe("green");
        }
    });

    it("counts a passing run and reports how much it proved", () => {
        expect(classifyRun(0, GREEN_LOG)).toEqual({ kind: "green", count: 3 });
    });

    it("counts a failing run and quotes the first assertion", () => {
        const outcome = classifyRun(1, RED_LOG);
        expect(outcome.kind).toBe("red");
        if (outcome.kind !== "red") return;
        // 1 failed + 2 passed — tests DID run, so this is the card disagreeing.
        expect(outcome.count).toBe(3);
        expect(outcome.detail).toContain("expected 20 to be 19");
    });

    it("treats a killed subprocess (null status) as a harness error", () => {
        // `spawnSync` reports `status: null` when the child died to a signal.
        // Nothing ran, so nothing was proved.
        expect(classifyRun(null, "").kind).toBe("harness-error");
    });
});

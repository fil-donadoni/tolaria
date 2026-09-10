// `scenario:ls` / `scenario:rm` — the CLI half of the debug-scenario table
// (issue #3331).
//
// WHY THESE ARE TESTS AND NOT COMMENTS. Two things here fail silently:
//
//  1. THE FLAGS. Both commands go through `convexRunArgv`, which carries
//     `--push`. For the seed that flag is about server-side card-name
//     resolution (issue #3253); here it is about the FUNCTION existing at all —
//     `listScenariosDirect` is not on the deployment until something pushes it.
//     Drop the flag and the commands work on any machine whose `convex dev`
//     happens to be running, and fail on every other, which is exactly the
//     failure #3253 measured over 80 PRs.
//  2. THE `0 deleted` VERDICT. A typo'd label deletes nothing. If that printed
//     like a success, the caller's next move is to believe a row is gone that
//     is still on the deployment.

import { describe, expect, it } from "vitest";
import { convexRunArgv, seedScenarioArgv } from "../lib/seed-scenario-run";
import { formatDeleteOutcome, formatScenarioRow } from "../scenario-admin";

describe("convexRunArgv (issue #3331)", () => {
    it("pushes the checkout's code before running any scenario function", () => {
        expect(
            convexRunArgv("debugScenarios:listScenariosDirect", "{}")
        ).toContain("--push");
    });

    it("puts the function name and its payload last, in that order", () => {
        const argv = convexRunArgv(
            "debugScenarios:deleteScenariosDirect",
            '{"label":"x"}'
        );
        expect(argv.slice(0, 2)).toEqual(["convex", "run"]);
        expect(argv.at(-2)).toBe("debugScenarios:deleteScenariosDirect");
        expect(argv.at(-1)).toBe('{"label":"x"}');
    });

    it("is the ONE place the flags live — the seed argv is built from it", () => {
        // The seed keeps its own named export (its test asserts the flags
        // through it), but it must not carry a second copy of them: a
        // divergence would mean the CLI commands and the post-merge seed
        // reach the deployment differently.
        const seed = seedScenarioArgv("{}");
        const direct = convexRunArgv("debugScenarios:seedScenarioDirect", "{}");
        expect(seed).toEqual(direct);
    });
});

describe("formatScenarioRow (issue #3331)", () => {
    it("stars a golden scenario and leaves an ephemeral one unmarked", () => {
        expect(formatScenarioRow({ label: "kept", golden: true })).toBe(
            "★ kept"
        );
        expect(formatScenarioRow({ label: "temp", golden: false })).toBe(
            "  temp"
        );
    });

    it("keeps the label column aligned across both states", () => {
        const golden = formatScenarioRow({ label: "a", golden: true });
        const ephemeral = formatScenarioRow({ label: "a", golden: false });
        expect(golden.indexOf("a")).toBe(ephemeral.indexOf("a"));
    });
});

describe("formatDeleteOutcome (issue #3331)", () => {
    it("says NOTHING was deleted when the label matched no row", () => {
        const line = formatDeleteOutcome("typo", 0);
        expect(line).toContain("nothing deleted");
        expect(line).toContain("typo");
        // The failure mode this guards: a verdict a human skims as success.
        expect(line).not.toMatch(/^scenario:rm: deleted/);
    });

    it("reports the count when rows were removed", () => {
        expect(formatDeleteOutcome("dupe", 2)).toContain("deleted 2");
        expect(formatDeleteOutcome("one", 1)).toContain("deleted 1");
    });
});

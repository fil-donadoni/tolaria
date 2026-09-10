// `scenario:ls` / `scenario:rm` — the CLI over the debug-scenario table
// (issue #3331, reshaped by issue #3333).
//
// WHY THESE ARE TESTS AND NOT COMMENTS. Four things here fail silently or
// mislead:
//
//  1. THE IDENTITY FLAG. A plain `convex run` carries no caller identity, so
//     every `assertIsAdmin` function throws `Forbidden: admin only`. Drop
//     `--identity` from the argv and both commands break with an error that
//     reads like a broken CLI — which is exactly how issue #3331 came to add
//     two ungated internal functions the deployment did not need.
//  2. THE ABSENT `--push`. These commands call functions that have existed for
//     many releases; a push buys nothing and costs ~15s. The SEED still needs
//     it (issue #3253), so one builder serves both and the split must hold.
//  3. THE NO-ADMIN BRANCH. `assertIsAdmin` gates every function called here,
//     so a deployment with no admin cannot be served at all. That must surface
//     as a named condition, not as a `Forbidden` the next reader misdiagnoses.
//  4. THE `0 deleted` VERDICT. A typo'd label deletes nothing; printed like a
//     success, the caller believes a row is gone that is still there.

import { describe, expect, it } from "vitest";
import { convexRunArgv, seedScenarioArgv } from "../lib/seed-scenario-run";
import {
    formatDeleteOutcome,
    formatScenarioRow,
    identityPayload,
    projectScenarioListing,
    selectAdminIdentity,
    selectScenariosByLabel,
} from "../lib/scenario-cli";

const IDENTITY = identityPayload("u1");

describe("convexRunArgv options (issue #3333)", () => {
    it("passes --identity through, so the call runs AS a user", () => {
        const argv = convexRunArgv("debugScenarios:listDebugScenarios", "{}", {
            push: false,
            identity: IDENTITY,
        });
        expect(argv).toContain("--identity");
        expect(argv[argv.indexOf("--identity") + 1]).toBe(IDENTITY);
    });

    it("omits --push when the caller opts out", () => {
        const argv = convexRunArgv("debugScenarios:listDebugScenarios", "{}", {
            push: false,
            identity: IDENTITY,
        });
        expect(argv).not.toContain("--push");
    });

    it("still pushes by default — the seed's argv is unchanged", () => {
        // The default is opt-OUT so a new caller has to think about it, and
        // the seed keeps the flag issue #3253 measured the need for.
        expect(convexRunArgv("x", "{}")).toContain("--push");
        expect(seedScenarioArgv("{}")).toContain("--push");
        expect(seedScenarioArgv("{}")).not.toContain("--identity");
    });

    it("keeps the function name and payload last whatever the options", () => {
        const argv = convexRunArgv("mod:fn", '{"a":1}', {
            push: false,
            identity: IDENTITY,
        });
        expect(argv.slice(0, 2)).toEqual(["convex", "run"]);
        expect(argv.at(-2)).toBe("mod:fn");
        expect(argv.at(-1)).toBe('{"a":1}');
    });
});

describe("identityPayload (issue #3333)", () => {
    it("puts the user id in `subject` before the bar convex-auth splits on", () => {
        const parsed = JSON.parse(identityPayload("u1")) as {
            subject: string;
            tokenIdentifier: string;
        };
        expect(parsed.subject.split("|")[0]).toBe("u1");
        expect(parsed.tokenIdentifier).toContain("u1");
    });
});

describe("selectAdminIdentity (issue #3333)", () => {
    it("picks an admin, never a plain user", () => {
        expect(
            selectAdminIdentity([
                { _id: "plain" },
                { _id: "admin", isAdmin: true },
            ])
        ).toBe("admin");
    });

    it("returns null when the deployment has no admin at all", () => {
        // The one case `--identity` genuinely cannot serve. Null lets the
        // caller name it instead of letting `assertIsAdmin` report
        // `Forbidden: admin only`, which reads like a broken CLI.
        expect(selectAdminIdentity([{ _id: "a" }, { _id: "b" }])).toBeNull();
        expect(selectAdminIdentity([])).toBeNull();
    });

    it("does not treat a falsy isAdmin as admin", () => {
        expect(selectAdminIdentity([{ _id: "a", isAdmin: false }])).toBeNull();
    });
});

describe("projectScenarioListing (issue #3331)", () => {
    const rows = [
        { _id: "3", label: "zulu", golden: true },
        { _id: "1", label: "alpha" },
        { _id: "2", label: "mike", golden: false },
    ];

    it("sorts by label so two runs of an unchanged deployment print the same", () => {
        expect(projectScenarioListing(rows).map((r) => r.label)).toEqual([
            "alpha",
            "mike",
            "zulu",
        ]);
    });

    it("normalises a missing `golden` to false rather than leaking undefined", () => {
        const listed = projectScenarioListing(rows);
        expect(listed.find((r) => r.label === "alpha")?.golden).toBe(false);
        expect(listed.find((r) => r.label === "zulu")?.golden).toBe(true);
    });

    it("keeps the id — `rm` needs it, because deleteDebugScenario takes one", () => {
        expect(projectScenarioListing(rows).map((r) => r._id)).toEqual([
            "1",
            "2",
            "3",
        ]);
    });
});

describe("selectScenariosByLabel (issue #3331)", () => {
    const rows = [
        { _id: "a", label: "keep me" },
        { _id: "b", label: "kill me" },
        { _id: "c", label: "kill me" },
    ];

    it("returns EVERY row carrying the label, not just the first", () => {
        // Labels are not unique by schema — `selectScenarioUpsert` only picks
        // one row to patch, so a row inserted before that path existed can
        // still share a label. Deleting one of two is a silent half-success.
        expect(selectScenariosByLabel(rows, "kill me")).toEqual(["b", "c"]);
    });

    it("returns nothing for an unknown label — a typo removes nothing", () => {
        expect(selectScenariosByLabel(rows, "kil me")).toEqual([]);
    });

    it("refuses an empty or whitespace label instead of matching everything", () => {
        expect(selectScenariosByLabel(rows, "")).toEqual([]);
        expect(selectScenariosByLabel(rows, "   ")).toEqual([]);
    });

    it("trims both sides, so a padded spelling still finds the seeded row", () => {
        expect(selectScenariosByLabel(rows, "  kill me  ")).toEqual(["b", "c"]);
        expect(
            selectScenariosByLabel([{ _id: "d", label: " padded " }], "padded")
        ).toEqual(["d"]);
    });
});

describe("formatScenarioRow (issue #3331)", () => {
    it("stars a golden scenario and leaves an ephemeral one unmarked", () => {
        expect(
            formatScenarioRow({ _id: "1", label: "kept", golden: true })
        ).toBe("★ kept");
        expect(
            formatScenarioRow({ _id: "2", label: "temp", golden: false })
        ).toBe("  temp");
    });

    it("keeps the label column aligned across both states", () => {
        const golden = formatScenarioRow({
            _id: "1",
            label: "a",
            golden: true,
        });
        const plain = formatScenarioRow({
            _id: "2",
            label: "a",
            golden: false,
        });
        expect(golden.indexOf("a")).toBe(plain.indexOf("a"));
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

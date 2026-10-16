import { describe, it, expect } from "vitest";
import {
    FIXES,
    FIXUP_COMMIT_SUBJECT,
    classifyLane,
    fixupRefusal,
    flakeSummary,
    parseFixes,
    type PrFacts,
} from "../pr-fixup";
import { REGENERATED_ARTIFACTS } from "../lib/generated-artifacts";

// Issue #5640: a red lane whose only failing step is a regenerable artefact is
// fixed by regeneration; any other red is left alone.

const BLADE = "scripts/__tests__/blade-card-index-drift.bot.test.ts";

function lane(outcomes: object[], ok = false) {
    return { ok, outcomes };
}

describe("classifyLane", () => {
    it("a stale oracle lockfile is the `oracle` fix", () => {
        expect(
            classifyLane(
                lane([
                    { id: "tsc[convex]", status: "pass" },
                    { id: "check:oracle", status: "fail" },
                    { id: "cr:lint", status: "not-run" },
                ])
            )
        ).toEqual(["oracle"]);
    });

    it("the blade card index drift test is the `blade-index` fix", () => {
        expect(
            classifyLane(
                lane([
                    {
                        id: "vitest(related)",
                        status: "fail",
                        failedFiles: [BLADE],
                    },
                ])
            )
        ).toEqual(["blade-index"]);
    });

    it("a vitest red naming any other file, or none, is untouched", () => {
        expect(
            classifyLane(
                lane([
                    {
                        id: "vitest(related)",
                        status: "fail",
                        failedFiles: [
                            BLADE,
                            "convex/gre/__tests__/stack.test.ts",
                        ],
                    },
                ])
            )
        ).toBeNull();
        expect(
            classifyLane(lane([{ id: "vitest(related)", status: "fail" }]))
        ).toBeNull();
    });

    it("any other failing step is untouched", () => {
        for (const id of ["tsc[all]", "lint(diff)", "cr:lint", "check:index"]) {
            expect(classifyLane(lane([{ id, status: "fail" }]))).toBeNull();
        }
    });

    it("a green lane, or a lane with no JSON outcomes, has no fix", () => {
        expect(
            classifyLane(lane([{ id: "check:oracle", status: "pass" }], true))
        ).toBeNull();
        expect(classifyLane({ ok: false })).toBeNull();
    });
});

describe("FIXES", () => {
    it("the oracle row runs the same generator `land`'s resolver runs", () => {
        const row = REGENERATED_ARTIFACTS.find(
            (a) => a.path === "data/oracle-compiled.json"
        );
        expect(FIXES.oracle.script).toBe(row?.script);
        expect([...FIXES.oracle.args]).toEqual([...(row?.args ?? [])]);
    });

    it("every row's script exists in package.json", async () => {
        const pkg = (await import("../../package.json")).default as {
            scripts: Record<string, string>;
        };
        for (const row of Object.values(FIXES)) {
            expect(pkg.scripts[row.script]).toBeDefined();
        }
    });
});

describe("parseFixes", () => {
    it("selects table rows, sorted and unique", () => {
        expect(parseFixes("format, oracle,format")).toEqual([
            "format",
            "oracle",
        ]);
    });
    it("refuses anything outside the table — an input never carries a command", () => {
        expect(parseFixes("oracle;rm -rf /")).toBeNull();
        expect(parseFixes("")).toBeNull();
    });
});

describe("fixupRefusal", () => {
    const ok: PrFacts = {
        state: "OPEN",
        author: "owner",
        headRefName: "feat/issue-1",
        isCrossRepository: false,
        files: ["convex/x.ts"],
        subjects: ["Add x"],
    };
    it("lets a trusted same-repo PR through", () => {
        expect(fixupRefusal(ok, ["owner"])).toBeNull();
    });
    it("refuses a closed PR, a fork, an untrusted or an unconfigured author", () => {
        expect(fixupRefusal({ ...ok, state: "MERGED" }, ["owner"])).toMatch(
            /MERGED/
        );
        expect(
            fixupRefusal({ ...ok, isCrossRepository: true }, ["owner"])
        ).toMatch(/fork/);
        expect(fixupRefusal(ok, ["someone"])).toMatch(/TRUSTED_AUTHORS/);
        expect(fixupRefusal(ok, [])).toMatch(/TRUSTED_AUTHORS/);
    });
    it("refuses a PR that touches what gates it (ADR 0156 §8.4)", () => {
        expect(
            fixupRefusal({ ...ok, files: [".github/workflows/x.yml"] }, [
                "owner",
            ])
        ).toMatch(/\.github/);
        expect(
            fixupRefusal({ ...ok, files: [".mergify.yml"] }, ["owner"])
        ).toMatch(/mergify/);
    });
    it("stops after two fixup commits in a row", () => {
        const two = [FIXUP_COMMIT_SUBJECT, FIXUP_COMMIT_SUBJECT];
        expect(
            fixupRefusal({ ...ok, subjects: ["Add x", ...two] }, ["owner"])
        ).toMatch(/two fixup/);
        expect(
            fixupRefusal(
                {
                    ...ok,
                    subjects: [
                        FIXUP_COMMIT_SUBJECT,
                        "Add x",
                        FIXUP_COMMIT_SUBJECT,
                    ],
                },
                ["owner"]
            )
        ).toBeNull();
    });
});

describe("flakeSummary", () => {
    it("names each flake's step, cause and files; empty when none", () => {
        expect(
            flakeSummary({ outcomes: [{ id: "dom", flake: undefined }] })
        ).toBe("");
        const text = flakeSummary({
            outcomes: [
                {
                    id: "vitest(related)",
                    flake: {
                        projects: ["dom"],
                        files: ["a.test.tsx"],
                        cause: "timeout",
                    },
                },
            ],
        });
        expect(text).toContain("`vitest(related)` (timeout): a.test.tsx");
    });
});

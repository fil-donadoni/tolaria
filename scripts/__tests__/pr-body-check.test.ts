import { describe, expect, it } from "vitest";
import { bodyCheck, type BodyCheckInput } from "../pr-body-check";

// Issue #10394: the PR body's owed lines, decided before the PR exists by the
// code `land:ready` asks them with.

const HEAD = "c60da68ac6a1b2c3d4e5f60718293a4b5c6d7e8f";

function input(over: Partial<BodyCheckInput>): BodyCheckInput {
    return {
        lane: "engine",
        prBody: "proof: none owed (a budget change)\n\nDocs: none (no doc names it)\n",
        head: HEAD,
        prChecks: {},
        uiInvalid: false,
        uiOwed: () => false,
        ...over,
    };
}

describe("pr:body-check — the owed lines of a PR body (issue #10394)", () => {
    it("passes a complete engine-lane body", () => {
        expect(bodyCheck(input({}))).toEqual({ refusals: [], notes: [] });
    });

    it("names the proof line a code-lane body without a receipt owes — PR #10392's miss", () => {
        const { refusals } = bodyCheck(input({ prBody: "Docs: none (x)\n" }));
        expect(refusals).toHaveLength(1);
        expect(refusals[0]).toMatch(/^proof — /);
        expect(refusals[0]).toContain("proof: none owed (<reason>)");
    });

    it("owes no proof line on a docs or cards lane", () => {
        for (const lane of ["docs", "cards"] as const)
            expect(
                bodyCheck(input({ lane, prBody: "Docs: none (x)\n" })).refusals
            ).toEqual([]);
    });

    it("names the Docs line on every lane", () => {
        const { refusals } = bodyCheck(
            input({ lane: "docs", prBody: "no docs line here\n" })
        );
        expect(refusals).toEqual([
            expect.stringMatching(/^docs — .*Docs: none \(<why>\)/),
        ]);
    });

    it("names every missing line at once, pr-checks refusals included", () => {
        const { refusals } = bodyCheck(
            input({
                prBody: "",
                prChecks: {
                    scenario: "no `## Preset scenario` heading",
                    "retired-rows": null,
                },
            })
        );
        expect(refusals.map((r) => r.split(" — ")[0])).toEqual([
            "proof",
            "docs",
            "scenario",
        ]);
    });

    it("refuses a DOM diff that owes no walk and states no line", () => {
        const { refusals } = bodyCheck(
            input({ uiInvalid: true, uiOwed: () => false })
        );
        expect(refusals).toEqual([
            expect.stringMatching(
                /^ui — .*check:ui: no walk owed \(<reason>\)/
            ),
        ]);
    });

    it("lets an owed walk through with a note: the batch walks it after the PR", () => {
        const r = bodyCheck(input({ uiInvalid: true, uiOwed: () => true }));
        expect(r.refusals).toEqual([]);
        expect(r.notes).toEqual([expect.stringMatching(/ui-owed/)]);
    });

    it("never reads the walk verdict when the ui receipt check passed", () => {
        const owed = () => {
            throw new Error("read");
        };
        expect(bodyCheck(input({ uiOwed: owed })).refusals).toEqual([]);
    });
});

import { describe, it, expect } from "vitest";
import {
    ASSERTION_DEBT,
    assertLabelsBySurface,
    assertionTableProblems,
    locatorProblem,
    type AssertingSurface,
    type NamedAssertion,
} from "../ui-gate/assertions.ts";
import { evaluateRun, zeroReadings } from "../ui-gate/receipt.ts";
import { SURFACES } from "../ui-gate/surfaces.ts";

/**
 * NAMED ASSERTIONS AND THEIR OFFLINE GUARD (ADR 0132 §3, issue #3649).
 *
 * Two things are proven here, both without a browser:
 *
 *   1. the SURFACE TABLE keeps its side of the contract — every surface either
 *      declares at least one promise or carries a debt row with the issue that
 *      gives it one, and every locator is a role+name or a `data-*` seam;
 *   2. the EVALUATION treats a failed or unevaluated promise as a red, which
 *      is the half a green receipt would otherwise hide.
 */

const VIEWPORTS = ["1440x900x2", "390x844x3"];

function surface(
    id: string,
    asserts?: readonly NamedAssertion[]
): AssertingSurface {
    return { id, asserts };
}

const OK_ASSERT: NamedAssertion = {
    label: "primary action",
    locator: { selector: "[data-lobby-primary]" },
    check: "visible",
};

describe("check:ui surface table — Named Assertions", () => {
    it("every surface declares an assertion or carries a debt row with its issue", () => {
        expect(assertionTableProblems(SURFACES)).toEqual([]);
    });

    it("the debt list only names surfaces that exist and still declare nothing", () => {
        const ids = new Set(SURFACES.map((s) => s.id));
        for (const entry of ASSERTION_DEBT) {
            expect(ids.has(entry.surface), entry.surface).toBe(true);
            const declared = SURFACES.find((s) => s.id === entry.surface);
            expect(declared?.asserts ?? [], entry.surface).toEqual([]);
            expect(entry.issue).toBeGreaterThan(0);
        }
    });

    it("the auth and lobby surfaces declare theirs", () => {
        for (const id of [
            "auth-sign-in",
            "auth-forgot-password",
            "lobby",
            "lobby-vs-ai",
        ]) {
            const declared = SURFACES.find((s) => s.id === id);
            expect(declared, id).toBeDefined();
            expect((declared?.asserts ?? []).length, id).toBeGreaterThan(0);
            expect(ASSERTION_DEBT.some((d) => d.surface === id)).toBe(false);
        }
    });

    /**
     * The coverage hole of `docs/findings/2726-ui-gate-lobby-walk-asserts-almost-nothing.md`,
     * closed and kept closed: the lobby walk asserts a `<main>` region, so
     * every entry point its runbook names has to be a declared promise or the
     * surface can lose it and still measure green.
     */
    it("the lobby promises every entry point its runbook names", () => {
        const lobby = SURFACES.find((s) => s.id === "lobby");
        const locators = (lobby?.asserts ?? []).map((a) =>
            "selector" in a.locator
                ? a.locator.selector
                : `role=${a.locator.role} name=${a.locator.name}`
        );
        for (const entryPoint of [
            '[data-mode-tile="bot"]',
            '[data-mode-tile="solo"]',
            '[data-mode-tile="table"]',
            '[data-mode-tile="limited"]',
            "[data-lobby-primary]",
            "[data-deck-tile] [data-deck-select]:not([disabled])",
            "role=button name=Browse / Create Events",
            "[data-profile-entry]",
        ]) {
            expect(locators, entryPoint).toContain(entryPoint);
        }
    });

    it("refuses a surface that declares nothing and is not in the debt list", () => {
        const problems = assertionTableProblems([surface("lobby")], []);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("lobby declares no assertion");
    });

    it("refuses a debt row that has gone stale, or names no surface", () => {
        expect(
            assertionTableProblems(
                [surface("lobby", [OK_ASSERT])],
                [{ surface: "lobby", issue: 3650 }]
            ).join("\n")
        ).toContain("delete the row");
        expect(
            assertionTableProblems(
                [surface("lobby", [OK_ASSERT])],
                [{ surface: "ghost", issue: 3650 }]
            ).join("\n")
        ).toContain("which is not a surface");
        expect(
            assertionTableProblems(
                [surface("lobby")],
                [{ surface: "lobby", issue: 0 }]
            ).join("\n")
        ).toContain("no open issue");
    });

    it("refuses a duplicate label, an unprintable one, and a nameless role", () => {
        expect(
            assertionTableProblems(
                [surface("lobby", [OK_ASSERT, OK_ASSERT])],
                []
            ).join("\n")
        ).toContain("two assertions are labelled");
        expect(
            assertionTableProblems(
                [surface("lobby", [{ ...OK_ASSERT, label: "  " }])],
                []
            ).join("\n")
        ).toContain("not a printable label");
        expect(
            assertionTableProblems(
                [
                    surface("lobby", [
                        {
                            label: "nameless",
                            locator: { role: "button", name: "" },
                            check: "reachable",
                        },
                    ]),
                ],
                []
            ).join("\n")
        ).toContain("carries no accessible name");
    });
});

describe("check:ui assertion locators", () => {
    it("takes a role+name and a data-* seam, including a qualified one", () => {
        expect(locatorProblem({ role: "button", name: "Sign In" })).toBeNull();
        expect(locatorProblem({ selector: "[data-lobby-primary]" })).toBeNull();
        expect(
            locatorProblem({ selector: '[data-mode-tile="solo"]' })
        ).toBeNull();
        expect(
            locatorProblem({
                selector: "[data-deck-tile] [data-deck-select]:not([disabled])",
            })
        ).toBeNull();
    });

    /** The locator the lobby walk used to assert, and the class of locator
     *  that keeps passing while the screen loses its content. */
    it("refuses a bare CSS locator, an alternative, and a tag-qualified seam", () => {
        expect(locatorProblem({ selector: "main, [role=main]" })).toContain(
            "names alternatives"
        );
        expect(locatorProblem({ selector: "main" })).toContain(
            "bare CSS locator"
        );
        expect(locatorProblem({ selector: ".panel .btn-primary" })).toContain(
            "bare CSS locator"
        );
        expect(locatorProblem({ selector: "button[data-foo]" })).toContain(
            "bare CSS locator"
        );
        expect(locatorProblem({ selector: "  " })).toContain("empty");
    });

    it("reads the labels off the table in declaration order", () => {
        expect(
            assertLabelsBySurface([
                surface("lobby", [
                    { ...OK_ASSERT, label: "first" },
                    { ...OK_ASSERT, label: "second" },
                ]),
                surface("deck-builder"),
            ])
        ).toEqual({ lobby: ["first", "second"], "deck-builder": [] });
    });
});

/** The evaluation half: what a broken or unevaluated promise does to a run. */
describe("check:ui evaluation — assertion lines", () => {
    function run(asserts: { label: string; ok: boolean; detail: string }[]) {
        return evaluateRun({
            knownSurfaceIds: ["lobby"],
            definedSurfaceIds: ["lobby"],
            viewportIds: VIEWPORTS,
            unwalked: [],
            assertsBySurface: { lobby: ["mode tile: Solo game"] },
            walks: [
                {
                    surface: "lobby",
                    status: "measured",
                    measurements: VIEWPORTS.map((viewport) => ({
                        viewport,
                        readings: zeroReadings(),
                        asserts,
                    })),
                },
            ],
        });
    }

    it("prints one PASS line per promise per viewport, and stays green", () => {
        const ev = run([
            { label: "mode tile: Solo game", ok: true, detail: "" },
        ]);
        expect(ev.failures).toEqual([]);
        expect(ev.assertRows).toEqual(
            VIEWPORTS.map((viewport) => ({
                surface: "lobby",
                viewport,
                label: "mode tile: Solo game",
                verdict: "PASS",
            }))
        );
        expect(ev.measuredSurfaces).toBe(1);
    });

    it("reds the run on a failed promise, with the reason kept out of the verdict line", () => {
        const ev = run([
            {
                label: "mode tile: Solo game",
                ok: false,
                detail: 'reachable `[data-mode-tile="solo"]` — no element matches it',
            },
        ]);
        expect(ev.assertRows.every((r) => r.verdict === "FAIL")).toBe(true);
        expect(ev.failures).toHaveLength(VIEWPORTS.length);
        expect(ev.failures[0]).toContain('assertion "mode tile: Solo game"');
        // The floors held, so the cell's own row is still PASS — the promise
        // is the half that failed, and it is the half that reds the run.
        expect(ev.rows.every((r) => r.verdict === "PASS")).toBe(true);
        expect(ev.measuredSurfaces).toBe(0);
        expect(ev.assertFailures[0].detail).toContain("no element matches it");
    });

    it("counts a promise the walk never evaluated as a FAIL", () => {
        const ev = run([]);
        expect(ev.assertRows.every((r) => r.verdict === "FAIL")).toBe(true);
        expect(ev.failures[0]).toContain("reported no result");
    });
});

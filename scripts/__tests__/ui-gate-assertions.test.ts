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

/** The accessible names a surface's role+name promises address. */
function promisedNames(id: string): string[] {
    return (SURFACES.find((s) => s.id === id)?.asserts ?? []).flatMap((a) =>
        "name" in a.locator ? [a.locator.name] : []
    );
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

    /**
     * Issue #3651's half of the same contract: the game, debug and admin
     * surfaces, each held to the entry points its runbook names
     * (`docs/guides/ui-runbooks.md`) — the controller's primary action, the
     * debug sheet's toggle and scenario list, the AI trace's Judge action,
     * the yield rows and their remove action, the admin pages' primary
     * controls — plus the zone pile whose CTA carries `contrast`
     * (`docs/findings/2900-zone-cta-not-in-check-ui-dom.md`).
     */
    it("the game, debug and admin surfaces promise their entry points", () => {
        const promised = (id: string): string[] =>
            (SURFACES.find((s) => s.id === id)?.asserts ?? []).map(
                (a) =>
                    `${a.check} ${
                        "selector" in a.locator
                            ? a.locator.selector
                            : `role=${a.locator.role} name=${a.locator.name}`
                    }`
            );
        const owed: Record<string, readonly string[]> = {
            "game-board": [
                'reachable [data-controller-primary="action"]',
                "reachable role=button name=Pass Turn",
            ],
            "game-stress": [
                'reachable [data-controller-primary="action"]',
                "reachable role=button name=Pass Turn",
            ],
            "game-card-preview": [
                "visible [data-card-preview-anchored]",
                "visible [data-engine-view-tree]",
            ],
            "game-zone-pile": [
                "reachable role=button name=Flashback",
                "contrast role=button name=Flashback",
            ],
            "game-debug-sheet": [
                "reachable [data-debug-sheet-toggle]",
                "reachable role=textbox name=search scenarios",
                "reachable role=button name=UI stress — full board, full hand, deep piles",
            ],
            "game-debug-sheet-ai": [
                "visible [data-ai-trace-body]",
                "reachable role=button name=Judge this move",
            ],
            "game-manage-yields": [
                "visible [data-manage-yields-row]",
                "reachable [data-manage-yields-remove]",
            ],
            "admin-card-profiles": [
                "visible role=radiogroup name=Profile Scope",
                "reachable role=button name=Mark reviewed & next",
            ],
            "admin-verdicts": [
                "visible role=form name=Resolve this position",
                "reachable role=button name=← All positions",
            ],
            "design-system": [
                "visible role=heading name=Design system census",
                "reachable role=button name=Open live demo",
            ],
            "design-system-dialog": [
                "visible role=dialog name=GameDialog",
                "reachable role=button name=Done",
            ],
        };
        for (const [id, entryPoints] of Object.entries(owed)) {
            for (const entryPoint of entryPoints) {
                expect(promised(id), `${id}: ${entryPoint}`).toContain(
                    entryPoint
                );
            }
        }
    });

    /** The stress row the debug-sheet promise names is the lane's own
     *  payload's label — a renamed payload must move the promise with it. */
    it("the debug sheet's scenario-row promise names the stress payload's label", async () => {
        const { laneScenarioSeeds } =
            await import("../ui-gate/lane-account.ts");
        const stress = laneScenarioSeeds().find((seed) =>
            seed.label.startsWith("UI stress")
        );
        expect(promisedNames("game-debug-sheet")).toContain(stress?.label);
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

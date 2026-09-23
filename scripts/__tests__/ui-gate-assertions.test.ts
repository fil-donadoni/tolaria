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

/** One surface's promises as `<check> <locator>`, the form the per-surface
 *  entry-point lists below are written in. */
function promised(id: string): string[] {
    return (SURFACES.find((s) => s.id === id)?.asserts ?? []).map(
        (a) =>
            `${a.check} ${
                "selector" in a.locator
                    ? a.locator.selector
                    : `role=${a.locator.role} name=${a.locator.name}`
            }`
    );
}

/** Asserts every entry point in `owed` is a declared promise of its surface. */
function expectPromised(owed: Record<string, readonly string[]>): void {
    for (const [id, entryPoints] of Object.entries(owed)) {
        for (const entryPoint of entryPoints) {
            expect(promised(id), `${id}: ${entryPoint}`).toContain(entryPoint);
        }
    }
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
                "visible [data-debug-sheet-toggle]",
                "visible [data-debug-sheet]",
                "reachable role=textbox name=search scenarios",
                "reachable role=button name=UI stress — full board, full hand, deep piles",
            ],
            "game-debug-sheet-ai": [
                "visible [data-debug-sheet]",
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
        expectPromised(owed);
    });

    /**
     * Issue #3650's half: the deck, Limited and draft surfaces, each held to
     * the entry points its runbook names (`docs/guides/ui-runbooks.md`
     * § Lobby, deck builder and the Limited list, § Reach the Limited
     * antechamber / deck builder / Draft Room).
     *
     * Three of these lists encode a decision worth stating, because each is a
     * place where the obvious locator would have been WRONG:
     *
     *  - the two deck builders promise `role=textbox name="Deck name"` and a
     *    `Done` plate, which is what BOTH of their mutually exclusive bottom
     *    bars render (`SaveDeckBar` off a phone, `DeckBottomBar` in portrait);
     *  - `deck-detail` promises its primary plate by seam and `visible`, since
     *    the control reads "Play" or "Selected" — and is disabled in the
     *    second state — depending on what an earlier surface selected;
     *  - the draft surfaces promise the pack TILE rather than
     *    `[data-editing-action="Pick"]`, which issue #2861 left on the phone
     *    viewports only, and address the bar's `uppercase` controls by seam.
     */
    it("the deck, Limited and draft surfaces promise their entry points", () => {
        expectPromised({
            "deck-builder": [
                "reachable role=button name=Import",
                "reachable role=textbox name=Deck name",
                "reachable role=button name=Done",
                'visible [data-deck-pane="maindeck"]',
                'visible [data-deck-pane="sideboard"]',
                'visible [data-deck-pane="source"]',
                "contrast role=button name=Done",
            ],
            "deck-detail": [
                "reachable role=button name=← Back",
                "visible [data-deck-detail-play]",
                "contrast role=button name=← Back",
            ],
            "limited-list": [
                "visible role=group name=Filter by status",
                "reachable role=button name=Mine",
                "reachable role=button name=+ Create Event",
                "visible [data-limited-event-label]",
                "reachable role=button name=View",
                "contrast role=button name=View",
            ],
            "limited-your-events": [
                "visible [data-limited-event-label]",
                "reachable role=button name=View",
                "reachable role=button name=Mine",
            ],
            "limited-antechamber": [
                "reachable role=button name=← Back to Limited Events",
                "reachable role=button name=View Table",
                "reachable role=button name=Leave Seat",
                "reachable role=button name=Start Event",
                "reachable role=button name=Cancel Event",
                "contrast role=button name=View Table",
            ],
            "limited-build": [
                'visible [data-deck-pane="maindeck"]',
                'visible [data-deck-pane="sideboard"]',
                "visible [data-card-tile]",
                "reachable role=textbox name=Deck name",
                "reachable role=button name=Done",
                "contrast role=button name=Done",
            ],
            "draft-pick": [
                "visible [data-slot=draft-room-bar]",
                "reachable [data-draft-pick-tile]",
                "reachable [data-draft-table-entry]",
                "reachable [data-draft-pool-toggle]",
                "reachable role=button name=More",
                "contrast [data-slot=pack-counter]",
            ],
            "draft-pool-stop": [
                "visible [data-slot=draft-room-bar]",
                "visible [data-slot=draft-pool]",
                "visible [data-slot=draft-pool] [data-card-tile]",
                "reachable [data-draft-table-entry]",
                "reachable [data-draft-pool-toggle]",
                "contrast [data-slot=draft-pool]",
            ],
            // The one surface whose measured state is viewport-split by
            // design (issue #2861), so its bar controls are promised
            // `visible`: this walk ends with the desktop pool menu OPEN, and
            // an open menu can take the pointer for what is behind it.
            "draft-pool-peek": [
                "visible [data-slot=draft-room-bar]",
                "visible [data-slot=draft-pool]",
                "visible [data-slot=draft-pool] [data-card-tile]",
                "visible [data-draft-table-entry]",
                "visible [data-draft-pool-toggle]",
                "contrast [data-slot=draft-pool]",
            ],
        });
    });

    /**
     * Issue #4418's half: the rest of the `/admin` section and `/settings`,
     * the eight screens the coverage census (issue #3420) recorded as
     * measured at no viewport. Each is held to the entry points its runbook
     * names (`docs/guides/ui-runbooks.md` § The rest of /admin, and
     * /settings).
     *
     * Three of these encode a decision the obvious locator would have got
     * wrong, and each is stated on the surface itself:
     *
     *  - `admin-index` promises its cards by the ROUTE each leads to, because
     *    a card's accessible name is its title AND its description line;
     *  - `admin-testers` promises the account list by seam, because the row's
     *    control reads `Grant tester` or `Revoke tester` depending on the flag
     *    the lane's own account carries;
     *  - `settings` promises `<fieldset>` GROUPS rather than options, for the
     *    same accessible-name reason as the index's cards.
     */
    it("the rest of the admin section and /settings promise their entry points", () => {
        expectPromised({
            "admin-index": [
                "visible role=heading name=Admin",
                'reachable [data-admin-nav="/admin/scenarios"]',
                'reachable [data-admin-nav="/admin/verdicts"]',
            ],
            "admin-scenarios": [
                "visible role=heading name=Saved scenarios",
                "reachable role=textbox name=Search scenarios\u2026",
                "reachable role=button name=New scenario",
            ],
            "admin-banlists": [
                "visible role=heading name=Banlist Sync",
                "reachable role=button name=Sync from Scryfall",
                "visible role=button name=View cards",
            ],
            "admin-pick-ratings": [
                "visible role=radiogroup name=Rating Scope",
                "reachable role=textbox name=Search cards",
            ],
            "admin-testers": [
                "visible role=heading name=Accounts",
                "visible [data-tester-row]",
            ],
            "admin-bug-reports": [
                "visible role=heading name=Reports",
                "reachable role=link name=\u2190 Admin",
            ],
            "draft-lab": [
                "reachable role=button name=Synthetic",
                "reachable role=combobox name=Pack source",
                "reachable role=button name=Start draft",
            ],
            settings: [
                "visible role=heading name=Settings",
                "visible role=group name=Density",
                "visible role=group name=Card preview default",
                "reachable role=button name=Reset to defaults",
            ],
        });
    });

    /** The debt list is empty, and every surface carries its own promises —
     *  the end state ADR 0132 §3 describes. A new surface declares them in the
     *  change that adds it rather than re-opening this list. */
    it("leaves no surface without assertions", () => {
        expect(ASSERTION_DEBT).toEqual([]);
        for (const surface of SURFACES) {
            expect((surface.asserts ?? []).length, surface.id).toBeGreaterThan(
                0
            );
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

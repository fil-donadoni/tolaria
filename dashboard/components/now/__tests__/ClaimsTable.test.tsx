// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClaimsTable } from "../ClaimsTable";
import { MIN_AGE_HOURS } from "../../../lib/nowClaims";
import { resetPendingAction } from "../../../lib/confirm";
import { resetOverlays } from "../../../lib/overlays";
import { resetWatch } from "../../../lib/watch";
import type {
    ClaimRow,
    ClaimStage,
    ClaimVerdictState,
    NowPayload,
} from "../../../lib/nowPayload";

/**
 * The claims table's WORDING (#2632), migrated with its subject in PRD #3148
 * S4 from `scripts/__tests__/loop-status-dashboard.test.ts`.
 *
 * Every case here is one that file made against `nowBodyHtml`'s string output;
 * what changed is that they are made against the rendered table, so an
 * assertion is about what an operator READS rather than about which class
 * names a template emitted. Two got stronger for it: "the priority header
 * reads Priority, not pri" was matching a literal `<th class="" data-term=…>`
 * — a template edit away from vacuous — and the release-button cases were
 * counting `data-action` attributes rather than finding buttons.
 *
 * The one case that did NOT move is the age-threshold parity check
 * (`MIN_AGE_HOURS` against `loop-doctor.ts`'s own constant): it needs a
 * Node-typed module, and it lives in
 * `scripts/__tests__/dashboard-now-port.test.ts` beside the two other mirrored
 * server numbers.
 */

const NOW_MS = Date.parse("2026-08-20T08:00:00Z");

const claim = (
    state: ClaimVerdictState,
    over: Partial<ClaimRow> = {}
): ClaimRow => ({
    issue: 2582,
    title: "a claimed issue",
    stage: "claimed",
    verdict: { state, reason: "" },
    priority: "P1",
    ageHours: 12,
    dependents: 0,
    ...over,
});

const payload = (claims: ClaimRow[] | null, over: Partial<NowPayload> = {}) =>
    ({
        claims,
        claimsError: null,
        dependentsError: null,
        live: {
            asOf: NOW_MS,
            liveMinutes: 30,
            activeMinutes: 3,
            sessions: [],
            byIssue: {},
        },
        ...over,
    }) as unknown as NowPayload;

const renderTable = (data: NowPayload) =>
    render(
        <TooltipProvider>
            <ClaimsTable data={data} nowMs={NOW_MS} />
        </TooltipProvider>
    );

beforeEach(() => {
    resetPendingAction();
    resetOverlays();
    resetWatch();
});
afterEach(() => {
    resetPendingAction();
    resetOverlays();
    resetWatch();
    vi.unstubAllGlobals();
});

describe("claims table — a verdict is a WORD, and the row says why", () => {
    it("renders verdict marks as words, with the specific reason in a title, not the `×`/`?`/`·` symbols", () => {
        renderTable(
            payload([
                claim("orphan", {
                    verdict: {
                        state: "orphan",
                        reason: "no branch, no PR, untouched for 24h",
                    },
                }),
            ])
        );
        const mark = screen.getByText("orphaned");
        expect(mark.closest("[title]")?.getAttribute("title")).toBe(
            "no branch, no PR, untouched for 24h"
        );
        // The symbol this replaced must be gone from the table, not merely
        // coexisting with the word.
        expect(screen.queryByText("×")).toBeNull();
    });

    it("suspect and live verdicts render as 'unsure' / 'working'", () => {
        renderTable(payload([claim("suspect")]));
        expect(screen.getByText("unsure")).not.toBeNull();
        renderTable(payload([claim("live")]));
        expect(screen.getByText("working")).not.toBeNull();
    });

    it("the priority column header reads 'Priority', not 'pri'", () => {
        renderTable(payload([claim("live")]));
        const head = screen.getByRole("table").querySelector("thead")!;
        expect(head.textContent).toContain("Priority");
        expect(head.textContent).not.toContain("pri ");
    });

    it("a stage renders as a sentence naming what is done AND what is missing", () => {
        renderTable(payload([claim("live", { stage: "branch pushed" })]));
        expect(screen.getByText("Branch pushed, no PR yet")).not.toBeNull();
    });

    it("every claim stage has its own sentence — none silently falls back to the raw key", () => {
        const STAGES: ClaimStage[] = [
            "claimed",
            "worktree",
            "branch pushed",
            "PR open",
            "merging",
        ];
        for (const stage of STAGES) {
            const { unmount } = renderTable(
                payload([claim("live", { stage })])
            );
            // A sentence is prose: it is never JUST the internal stage key.
            expect(screen.queryByText(stage), stage).toBeNull();
            unmount();
        }
    });

    it("the issue column is a real GitHub link — one of two `issueLink()` producer sites that shipped with no test", () => {
        renderTable(payload([claim("live", { issue: 2582 })]));
        const link = screen.getByRole("link", { name: "#2582" });
        expect(link.getAttribute("href")).toBe(
            "https://github.com/fil-donadoni/tolaria/issues/2582"
        );
        expect(link.getAttribute("target")).toBe("_blank");
    });
});

describe("claims table — age is elapsed time, floored", () => {
    it("reads '23h ago', never a rounded-up '24h ago' and never a raw '23.8h'", () => {
        renderTable(payload([claim("live", { ageHours: 23.8 })]));
        // FLOORED, not rounded (#2632 review finding 8): 23.8h has not yet
        // completed 24 whole hours, so "24h ago" overstates the claim's age.
        expect(screen.getByText("23h ago")).not.toBeNull();
        expect(screen.queryByText("24h ago")).toBeNull();
        expect(screen.queryByText(/23\.8/)).toBeNull();
    });

    it("under an hour it floors to minutes — 0.99h reads '59m ago', never '60m ago'", () => {
        renderTable(payload([claim("live", { ageHours: 0.99 })]));
        expect(screen.getByText("59m ago")).not.toBeNull();
        expect(screen.queryByText("60m ago")).toBeNull();
    });

    it("goes amber AT the classifier's own threshold, not below it", () => {
        const { unmount } = renderTable(
            payload([claim("live", { ageHours: MIN_AGE_HOURS - 0.5 })])
        );
        const below = screen.getByText(/ago$/);
        expect(below.className).not.toContain("state-warn");
        unmount();

        renderTable(payload([claim("live", { ageHours: MIN_AGE_HOURS })]));
        expect(screen.getByText(/ago$/).className).toContain("state-warn");
    });
});

describe("claims table — blast radius, and the difference between 0 and unknown", () => {
    it("a claim with dependents carries a 'blocks N others' badge", () => {
        renderTable(payload([claim("orphan", { dependents: 9 })]));
        expect(screen.getByText(/blocks 9 others/)).not.toBeNull();
    });

    it("singular phrasing for exactly one dependent — 'blocks 1 other', not 'others'", () => {
        renderTable(payload([claim("orphan", { dependents: 1 })]));
        expect(screen.getByText(/blocks 1 other$/)).not.toBeNull();
    });

    it("a bare claim (0 dependents) carries no badge at all", () => {
        renderTable(payload([claim("live", { dependents: 0 })]));
        expect(screen.queryByText(/blocks/)).toBeNull();
    });

    it("a failed blocked-by read renders an explicit unavailable note and NO badge — distinct from 'blocks nothing'", () => {
        renderTable(
            payload([claim("orphan", { dependents: null })], {
                dependentsError: "gh: rate limit exceeded",
            })
        );
        const banner = screen.getByRole("status");
        expect(banner.textContent).toContain("blocked-by counts unavailable");
        expect(banner.textContent).toContain("gh: rate limit exceeded");
        expect(screen.queryByText(/blocks \d/)).toBeNull();
    });

    it("PROOF-OF-FAILURE SHAPE: a claim whose dependents were never checked shows no badge, and never 'blocks undefined'", () => {
        const bare = claim("live");
        delete (bare as Partial<ClaimRow>).dependents;
        renderTable(payload([bare]));
        expect(screen.queryByText(/blocks undefined/)).toBeNull();
        expect(screen.queryByText(/blocks/)).toBeNull();
    });
});

describe("claims table — the Release action is offered only where it is sensible (#2636)", () => {
    it("an orphaned claim's row offers a Release button naming its own issue", () => {
        renderTable(payload([claim("orphan", { issue: 2582 })]));
        // The accessible NAME carries the issue, not a data attribute: the
        // button says which claim it releases to a screen reader too, which is
        // what the vanilla `data-issue` never did.
        expect(
            screen.getByRole("button", {
                name: "Release the claim on #2582",
            })
        ).not.toBeNull();
    });

    it("a button whose action is not currently sensible is not shown — live and suspect claims get none", () => {
        for (const state of ["live", "suspect"] as ClaimVerdictState[]) {
            const { unmount } = renderTable(payload([claim(state)]));
            expect(
                screen.queryByRole("button", { name: /Release/ }),
                `state=${state}`
            ).toBeNull();
            unmount();
        }
    });

    it("two orphaned rows each get their OWN button, keyed on their own issue", () => {
        renderTable(
            payload([
                claim("orphan", { issue: 2582 }),
                claim("orphan", { issue: 2583 }),
            ])
        );
        const buttons = screen.getAllByRole("button", {
            name: /^Release the claim/,
        });
        expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
            "Release the claim on #2582",
            "Release the claim on #2583",
        ]);
    });
});

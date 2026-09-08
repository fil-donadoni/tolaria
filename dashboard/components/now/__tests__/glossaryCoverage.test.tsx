// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * EVERY term the rendered page composes at runtime must resolve (#2629),
 * migrated in PRD #3148 S4.
 *
 * `scripts/__tests__/dashboard-glossary.test.ts` had two cases of this shape —
 * "the REAL Now body / the real Now timeline, run through the real engine,
 * declares no term the glossary cannot resolve" — and they were the only
 * end-to-end completeness guard the page had. They worked by scanning the
 * rendered HTML for `data-term` attributes, which the React port does not
 * emit: a term is a PROP now, and `<Term>`'s is typed, so a typo there is a
 * compile error.
 *
 * `<DynamicTerm>`'s is NOT typed, by design — a receipt's `role`, a claim's
 * `stage`, a finding's `code`, a dataset's metric are composed from values the
 * server supplies. Those are exactly what the deleted cases covered, and an
 * unresolved one is INVISIBLE: `DynamicTerm` renders the text with no
 * affordance rather than an empty tooltip. Nothing on screen would say so.
 *
 * So the sweep instruments the door itself. Every `lookupTerm` call the render
 * makes is recorded, and the page is rendered rich enough to reach each
 * composed family; a key that resolved to nothing is the failure this file
 * exists to catch. The completeness suite in
 * `scripts/__tests__/dashboard-glossary.test.ts` guards the other direction —
 * that the SERVER's vocabularies are all present in the table.
 */

const asked = vi.hoisted(() => [] as string[]);

vi.mock("../../../glossary", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../glossary")>();
    return {
        ...actual,
        lookupTerm: (term: string) => {
            asked.push(term);
            return actual.lookupTerm(term);
        },
    };
});

const { NowView } = await import("../NowView");
const { lookupTerm } = await import("../../../glossary");
const { goldenPayload, NOW_MS, stubNowFetch } = await import("./fixture");
const { resetLoopStatus } = await import("../../../lib/loopStatus");
const { resetOverlays } = await import("../../../lib/overlays");
const { resetWatch } = await import("../../../lib/watch");
const { resetPendingAction } = await import("../../../lib/confirm");
const { resetSectionFlash } = await import("../../../lib/sections");

beforeEach(() => {
    asked.length = 0;
    resetLoopStatus();
    resetOverlays();
    resetWatch();
    resetPendingAction();
    resetSectionFlash();
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
});

afterEach(() => {
    resetLoopStatus();
    resetOverlays();
    resetWatch();
    resetPendingAction();
    resetSectionFlash();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the whole Now view declares no term the glossary cannot resolve", () => {
    it("resolves every runtime-composed key a rich payload reaches", async () => {
        const payload = goldenPayload();
        // Rich on purpose: every family whose key is COMPOSED — a finding's
        // code, a receipt's role, a claim's stage and verdict, a pass's
        // outcome, a session's liveness and origin.
        payload.verdict = {
            ...payload.verdict!,
            findings: [
                { code: "claims-held", detail: "d" },
                { code: "orphaned-claims", detail: "d" },
                { code: "failed-reads", detail: "d" },
            ],
        };
        payload.receiptsSummary = {
            total: 9,
            counts: [
                { role: "implement", outcome: "pr-open", count: 4 },
                { role: "review", outcome: "approve", count: 2 },
                { role: "fixup", outcome: "failed", count: 1 },
                { role: "missing", outcome: "missing", count: 2 },
            ],
            interesting: [
                { issue: 3096, role: "implement", outcome: "failed", pr: 1 },
                {
                    role: "missing",
                    outcome: "missing",
                    session: "dd8ad5bf-8093-4f8f-bc83-b9a19cac924f",
                },
            ],
        };
        const first = payload.claims![0];
        payload.claims = (
            [
                "claimed",
                "worktree",
                "branch pushed",
                "PR open",
                "merging",
            ] as const
        ).map((stage, i) => ({
            ...first,
            issue: 4000 + i,
            stage,
            verdict: {
                state: (["orphan", "suspect", "live"] as const)[i % 3],
                reason: "r",
            },
        }));

        const { fetchStub } = stubNowFetch(payload);
        vi.stubGlobal("fetch", vi.fn(fetchStub));
        render(
            <TooltipProvider>
                <NowView />
            </TooltipProvider>
        );
        await screen.findByText("Claimed issues");

        // Vacuity guard: the render really did go through the runtime door.
        const unique = [...new Set(asked)];
        expect(unique.length).toBeGreaterThanOrEqual(10);
        // And it reached each family that is genuinely COMPOSED, not ten keys
        // of one shape. `stage.*`, `pass.*` and `live.*` are deliberately NOT
        // in this list: those keys are looked up in typed tables
        // (`STAGE_TERM`, `PASS_TERM`, `LIVENESS`) and rendered through
        // `<Term>`, so a missing one is a compile error and never reaches
        // `lookupTerm` at all.
        for (const prefix of ["finding.", "role.", "claim.", "receipts."]) {
            expect(
                unique.some((t) => t.startsWith(prefix)),
                `no ${prefix}* key was composed — the payload does not reach that surface`
            ).toBe(true);
        }

        expect(unique.filter((term) => !lookupTerm(term))).toEqual([]);
    });
});

describe("the whole History view declares no term the glossary cannot resolve", () => {
    it("resolves every dataset-qualified key the filter bar, tiles and metric table compose", async () => {
        const HistoryView = (await import("../../history/HistoryView")).default;
        const { stubHistoryFetch } =
            await import("../../history/__tests__/fixture");
        const { resetHistoryData } = await import("../../../lib/historyData");
        const { resetHistoryState } = await import("../../../lib/historyState");
        const { resetHistoryColors } =
            await import("../../../lib/historyColors");
        resetHistoryData();
        resetHistoryState();
        resetHistoryColors();
        asked.length = 0;

        vi.stubGlobal("fetch", vi.fn(stubHistoryFetch().fetchStub));
        render(
            <TooltipProvider>
                <HistoryView />
            </TooltipProvider>
        );
        await screen.findByText("Issues");

        // This is the page's LARGEST runtime surface: every picker option,
        // every tile caption and every metric column composes
        // `"<dataset>.<name>"`, and the set of names is the store's, not this
        // page's. A metric added server-side with no label lands here.
        const unique = [...new Set(asked)];
        expect(unique.length).toBeGreaterThanOrEqual(10);
        expect(unique.some((t) => t.startsWith("agent_runs."))).toBe(true);
        expect(unique.filter((term) => !lookupTerm(term))).toEqual([]);
    });
});

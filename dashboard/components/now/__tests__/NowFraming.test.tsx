// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NowView } from "../NowView";
import { refreshLoopStatus, resetLoopStatus } from "../../../lib/loopStatus";
import { resetOverlays } from "../../../lib/overlays";
import { resetWatch } from "../../../lib/watch";
import { resetPendingAction } from "../../../lib/confirm";
import { resetSectionFlash } from "../../../lib/sections";
import { nowLights, SECTION_IDS } from "../../../lib/nowLights";
import { lookupTerm } from "../../../glossary";
import { goldenPayload, NOW_MS, stubNowFetch } from "./fixture";
import type { NowPayload } from "../../../lib/nowPayload";

/**
 * The Now view's FRAMING (issue #3135, #2630, #2632), migrated with its
 * subject in PRD #3148 S4 from
 * `scripts/__tests__/loop-status-dashboard.test.ts`.
 *
 * `NowView.test.tsx` asserts the FIGURES against a golden payload. What is
 * here is the other half of that file: that every section says what it is,
 * that a light and the section it points at give ONE explanation rather than
 * two, that the batch heading reads as a number and a time rather than a UUID,
 * and — the one that took a browser to find — that a ten-second poll does not
 * take the operator's keyboard focus with it.
 *
 * Three of the vanilla focus cases did not come across, and their absence is
 * the port rather than a gap: "does not touch the DOM at all when the payload
 * is unchanged", "leaves focus alone when the operator has moved it OUTSIDE
 * the panel", and the manual `nowControlKey` restore they existed to guard.
 * All three were about `writeBodyPreservingFocus`, a function written because
 * the transport rewrote `innerHTML` wholesale six times a minute. React
 * reconciles: a poll that changes a number patches the text node and leaves
 * the element — and therefore the focus — untouched, so what replaced that
 * machinery is the stable KEY on every list. The cases that survive are the
 * ones that would still fail if a key were dropped.
 */

const renderNow = () =>
    render(
        <TooltipProvider>
            <NowView />
        </TooltipProvider>
    );

async function mountWith(payload: NowPayload) {
    const { fetchStub, calls } = stubNowFetch(payload);
    vi.stubGlobal("fetch", vi.fn(fetchStub));
    const view = renderNow();
    await screen.findByText("Claimed issues");
    return { view, calls };
}

beforeEach(() => {
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

describe("Now sections are framed and EXPLAINED (issue #3135)", () => {
    it("every section renders a heading with an info mark whose term resolves in the glossary", async () => {
        await mountWith(goldenPayload());
        const marks = screen.getAllByRole("img", { name: /^What .* shows$/ });
        // One per framed section — a floor, not a count, so the guard does not
        // go vacuous if a section is added.
        expect(marks.length).toBeGreaterThanOrEqual(6);
        for (const mark of marks) {
            // The mark keeps its own glyph rather than being overwritten by
            // the glossary label — the merge-tick rule, one control over.
            expect(mark.textContent).toBe("ⓘ");
        }
    });

    it("the four lights carry the SAME section term as the section they point at — one explanation per subsystem", async () => {
        await mountWith(goldenPayload());
        for (const light of nowLights(goldenPayload())) {
            const id = light.target;
            expect(document.getElementById(id), id).not.toBeNull();
            // The section's own term is `section.<light id>`, and it resolves.
            const key = Object.entries(SECTION_IDS).find(
                ([, value]) => value === id
            )![0];
            expect(lookupTerm(`section.${key}`), key).toBeDefined();
        }
    });

    it("a verdict FINDING renders as a badge with its own term plus the engine's detail sentence — the glossary says what the code means, only the payload says what happened", async () => {
        const payload = goldenPayload();
        payload.verdict = {
            ...payload.verdict!,
            findings: [
                { code: "claims-held", detail: "3 claims held for over 6h" },
            ],
        };
        await mountWith(payload);
        expect(screen.getByText(/3 claims held for over 6h/)).not.toBeNull();
        expect(lookupTerm("finding.claims-held")).toBeDefined();
    });
});

describe("Now batch heading — a number and a time, with the UUID behind an affordance (#2632)", () => {
    it("reads 'Batch #N · started HH:MM' rather than a UUID", async () => {
        const payload = goldenPayload();
        payload.batch = "cfa2cdaf-591a-4b8f-9926-613d3e8543d6";
        payload.batchStartedAt = Math.floor(
            new Date("2026-09-07T22:24:00").getTime() / 1000
        );
        payload.receiptsSummary = { total: 389, counts: [], interesting: [] };
        await mountWith(payload);
        expect(screen.getByText(/Batch #389/)).not.toBeNull();
        expect(screen.getByText(/started 22:24/)).not.toBeNull();
        // The UUID is not the heading; it is what the copy button carries.
        expect(
            screen.getByRole("button", {
                name: "Copy batch id cfa2cdaf-591a-4b8f-9926-613d3e8543d6",
            })
        ).not.toBeNull();
    });

    it("renders 'No batch has recorded receipts yet' — not 'Batch #0' — when nothing has run", async () => {
        const payload = goldenPayload();
        payload.batch = null;
        await mountWith(payload);
        expect(
            screen.getByText(/No batch has recorded receipts yet/)
        ).not.toBeNull();
        expect(screen.queryByText(/Batch #0/)).toBeNull();
    });

    it("a `missing` receipt row names its SESSION and carries no issue link — the sibling branch of the same ternary, and a link there would point at nothing", async () => {
        const payload = goldenPayload();
        payload.receiptsSummary = {
            total: 3,
            counts: [],
            interesting: [
                {
                    role: "missing",
                    outcome: "missing",
                    session: "dd8ad5bf-8093-4f8f-bc83-b9a19cac924f",
                },
            ],
        };
        await mountWith(payload);
        const batch = document.getElementById("ls-section-batch")!;
        expect(
            within(batch).getByText(/missing · session dd8ad5bf/)
        ).not.toBeNull();
        // The row has no issue to link to — a `#undefined` anchor is the
        // failure this branch exists to prevent. Scoped to the batch section,
        // because the claims table above legitimately links every row.
        expect(within(batch).queryByRole("link")).toBeNull();
    });

    it("an interesting (non-`missing`) receipt row's issue number is a real GitHub link — one of two `issueLink()` producer sites that shipped with no test", async () => {
        const payload = goldenPayload();
        payload.receiptsSummary = {
            total: 3,
            counts: [],
            interesting: [
                { issue: 3096, role: "implement", outcome: "failed", pr: 1 },
            ],
        };
        await mountWith(payload);
        const link = screen.getByRole("link", { name: "#3096" });
        expect(link.getAttribute("href")).toBe(
            "https://github.com/fil-donadoni/tolaria/issues/3096"
        );
    });
});

describe("Now activity chart — one hit target per hour, each carrying its own numbers (issue #3135)", () => {
    it("a QUIET window is a sentence, not twenty-four flat zero bars — a chart of nothing reads as a broken read", async () => {
        const payload = goldenPayload();
        payload.activity = {
            windowHours: 24,
            asOf: NOW_MS,
            buckets: [],
        };
        payload.recentMerges = [];
        await mountWith(payload);
        expect(
            screen.getByText(
                /No tokens generated and nothing merged in the last 24 hours/
            )
        ).not.toBeNull();
        // And no axis at all: a flat row of zeros is what this replaced, and
        // it is indistinguishable from the failed-read case one branch over.
        expect(
            screen.queryByRole("group", { name: /Output tokens and merged/ })
        ).toBeNull();
    });

    it("draws a keyboard-reachable target for every hour in the window", async () => {
        await mountWith(goldenPayload());
        const hours = screen
            .getByRole("group", { name: /Output tokens and merged/ })
            .querySelectorAll('[role="img"][tabindex="0"]');
        expect(hours.length).toBe(24);
        // Each one announces its OWN figures — a chart whose only reading is
        // visual is a chart a screen reader cannot use.
        for (const hour of hours) {
            const label = hour.getAttribute("aria-label") ?? "";
            expect(label).toMatch(/output tokens:/);
            expect(label).toMatch(/PRs merged:/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A ten-second poll must not destroy keyboard focus (PR #2837 review,
// finding 1). #2630 first put focusable controls inside the container the
// transport rewrote, so the pre-existing unconditional `innerHTML =` became a
// real defect: focusing a light and waiting one poll left `document.
// activeElement` at `<body>`, six times a minute.
//
// What replaced the manual restore is the KEY. Every list below renders with a
// stable identity, so a re-ordered or re-sized list matches elements to
// elements rather than remounting them — and these are the cases that would
// fail if one were dropped.
// ─────────────────────────────────────────────────────────────────────────────
describe("keyboard focus survives a poll", () => {
    const bump = async (payload: NowPayload) => {
        const { fetchStub } = stubNowFetch(payload);
        vi.stubGlobal("fetch", vi.fn(fetchStub));
        await act(async () => {
            await refreshLoopStatus();
        });
    };

    it("keeps focus on the same timeline pass block across a poll — every poll recomputes its position, so this is the common case, not the exception (#2631)", async () => {
        const payload = goldenPayload();
        await mountWith(payload);
        const block = document.querySelector<HTMLElement>("[data-pass]")!;
        const passId = block.getAttribute("data-pass");
        block.focus();
        expect(document.activeElement).toBe(block);

        const next = goldenPayload();
        next.queueDepth = { ...next.queueDepth!, total: 999, P0: 99 };
        await bump(next);

        await waitFor(() =>
            expect(screen.getAllByText("999").length).toBeGreaterThan(0)
        );
        expect(
            document.activeElement?.getAttribute("data-pass"),
            "the SAME pass block, not a remounted one"
        ).toBe(passId);
    });

    it("keeps focus on the same claim's row across a poll — a claim's stage is a tooltip trigger, and every one of them is a chance to drop focus once per row (#2632 review finding 4)", async () => {
        const payload = goldenPayload();
        await mountWith(payload);
        const stage = screen.getAllByText(/^Claimed, no worktree yet$/)[0];
        stage.focus();
        expect(document.activeElement).toBe(stage);

        const next = goldenPayload();
        next.queueDepth = { ...next.queueDepth!, total: 777, P0: 77 };
        await bump(next);

        await waitFor(() =>
            expect(screen.getAllByText("777").length).toBeGreaterThan(0)
        );
        expect(document.activeElement).toBe(stage);
    });

    it("does not jump focus to a DIFFERENT control when the focused one disappears", async () => {
        const payload = goldenPayload();
        await mountWith(payload);
        const releases = screen.getAllByRole("button", {
            name: /^Release the claim on/,
        });
        const target = releases[0];
        target.focus();

        // The claim it belonged to is gone on the next poll.
        const next = goldenPayload();
        next.claims = [];
        await bump(next);

        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: /^Release the claim on/ })
            ).toBeNull()
        );
        // Focus falls back to the document, never onto whatever control
        // happens to sit where the old one did.
        expect(document.activeElement).not.toBe(target);
        expect(
            document.activeElement?.getAttribute("aria-label") ?? ""
        ).not.toMatch(/^Release the claim on/);
    });
});

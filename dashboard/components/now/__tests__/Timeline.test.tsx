// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Timeline } from "../Timeline";
import { WINDOW_HOURS } from "../../../lib/nowTimeline";
import { GLOSSARY } from "../../../glossary";
import type { NowPayload } from "../../../lib/nowPayload";

/**
 * The Now timeline's COMPOSITION (#2631/#2842), migrated with its subject in
 * PRD #3148 S4 from `now-timeline.test.ts`'s `timelineSectionHtml` suite.
 *
 * The geometry is asserted in `dashboard/lib/__tests__/nowTimeline.test.ts`;
 * what is here is the half that was string concatenation and is now a
 * component: which NOTE the section renders, and — the one that matters —
 * that "I could not tell" never collapses into "nothing happened". That is the
 * same confusion `Unavailable` exists to prevent everywhere else on this page
 * (#2519 round 3, finding 5), extended to this view.
 *
 * The escaping case came across as a RENDERING case rather than an
 * escaping one. React escapes text nodes, so `<img src=x onerror=…>` in an
 * issue title cannot become markup; what a test can still say is that the
 * title renders as the literal characters a person typed.
 */

const WS = Date.parse("2026-08-19T08:00:00Z");
const NOW = Date.parse("2026-08-20T08:00:00Z");
const HOUR_MS = 3600_000;

const payload = (over: Partial<NowPayload>): NowPayload =>
    over as unknown as NowPayload;

const renderTimeline = (over: Partial<NowPayload>) =>
    render(
        <TooltipProvider>
            <Timeline data={payload(over)} nowMs={NOW} />
        </TooltipProvider>
    );

const hover = (el: HTMLElement) => {
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    fireEvent.mouseEnter(el);
};

describe("Timeline — the note it renders is the state it is in", () => {
    it("renders a SENTENCE, not a blank box, when nothing is known to have happened", () => {
        renderTimeline({
            timelinePasses: [],
            claims: [],
            recentMerges: [],
        });
        expect(
            screen.getByText(
                `Nothing ran, was claimed or merged in the last ${WINDOW_HOURS} hours.`
            )
        ).not.toBeNull();
    });

    it("does NOT render the empty sentence when claims are UNAVAILABLE, even with nothing else to show", () => {
        renderTimeline({
            timelinePasses: [],
            claims: null,
            claimsError: "GraphQL: rate limit exceeded",
            recentMerges: [],
        });
        expect(
            screen.queryByText(/Nothing ran, was claimed or merged/)
        ).toBeNull();
        const banner = screen.getByRole("status");
        expect(banner.textContent).toContain("rate limit exceeded");
        expect(banner.textContent).toContain("claim pins may be incomplete");
    });

    it("surfaces a failed merge read as UNAVAILABLE prose, never a silent empty ticks track", () => {
        renderTimeline({
            timelinePasses: [],
            claims: [],
            recentMerges: null,
            recentMergesError: "gh pr list failed: rate limit exceeded",
        });
        const banner = screen.getByRole("status");
        expect(banner.textContent).toContain("gh pr list failed");
        expect(banner.textContent).toContain("merge ticks may be incomplete");
    });

    it("surfaces a TRUNCATED (but successful) merge page as an incomplete note, distinct from a failed read (#2842 review finding)", () => {
        renderTimeline({
            timelinePasses: [],
            claims: [],
            recentMerges: [
                {
                    number: 1,
                    title: "a",
                    mergedAt: new Date(WS + HOUR_MS).toISOString(),
                },
            ],
            recentMergesError: null,
            recentMergesTruncated: true,
        });
        const banner = screen.getByRole("status");
        expect(banner.textContent).toContain("merge ticks may be incomplete");
        // The page SUCCEEDED, it just hit its own size limit — a third state,
        // and it must not read as a read that failed.
        expect(banner.textContent).not.toContain("could not");
        expect(banner.textContent).not.toContain("unavailable");
    });

    it("renders NO truncation note on an ordinary, un-truncated page", () => {
        renderTimeline({
            timelinePasses: [],
            claims: [],
            recentMerges: [],
            recentMergesError: null,
            recentMergesTruncated: false,
        });
        expect(screen.queryByText(/merge ticks may be incomplete/)).toBeNull();
    });
});

describe("Timeline — every item explains itself from the SAME glossary the verdict band reads", () => {
    const rich: Partial<NowPayload> = {
        timelinePasses: [
            {
                pass: 1,
                claudeExit: 137,
                pct: "n/a",
                queueBefore: 5,
                queueAfter: 3,
                reason: "claims-held",
                epoch: (WS + HOUR_MS) / 1000,
            },
        ],
        claims: [
            {
                issue: 2582,
                title: "an orphaned claim",
                stage: "claimed",
                priority: "P1",
                ageHours: 12,
                dependents: 0,
                verdict: { state: "orphan", reason: "nothing to show" },
            },
        ],
        recentMerges: [
            {
                number: 2837,
                title: "a merged PR",
                mergedAt: new Date(WS + 2 * HOUR_MS).toISOString(),
            },
        ],
    };

    it("a pass block explains its outcome with `pass.died`'s own sentence — no prose invented per instance", async () => {
        renderTimeline(rich);
        const block = document.querySelector<HTMLElement>("[data-pass='1']")!;
        hover(block);
        await waitFor(() =>
            expect(
                screen.getByText(
                    new RegExp(GLOSSARY["pass.died"].tip.slice(0, 40))
                )
            ).not.toBeNull()
        );
    });

    it("a claim pin explains its verdict with `claim.orphan`'s, and names the issue it is", async () => {
        renderTimeline(rich);
        const pin = document.querySelector<HTMLElement>("[data-issue='2582']")!;
        expect(pin.getAttribute("aria-label")).toContain("#2582");
        hover(pin);
        await waitFor(() =>
            expect(screen.getByText(/#2582 an orphaned claim/)).not.toBeNull()
        );
    });

    it("a merge tick explains itself with `pr.merged`'s and names its PR", async () => {
        renderTimeline(rich);
        const tick = document.querySelector<HTMLElement>("[data-pr='2837']")!;
        expect(tick.getAttribute("aria-label")).toContain("PR #2837 merged");
        hover(tick);
        await waitFor(() =>
            expect(
                screen.getByText(
                    new RegExp(GLOSSARY["pr.merged"].tip.slice(0, 30))
                )
            ).not.toBeNull()
        );
    });

    it("renders a claim title that LOOKS like markup as the literal characters it is", async () => {
        renderTimeline({
            ...rich,
            claims: [
                {
                    ...rich.claims![0],
                    title: "<img src=x onerror=alert(1)>",
                },
            ],
        });
        const pin = document.querySelector<HTMLElement>("[data-issue='2582']")!;
        // React escapes text nodes, so the vanilla `esc()` at every
        // interpolation has no call site — the property holds by construction
        // and this is the assertion that says so.
        expect(pin.getAttribute("aria-label")).toContain(
            "<img src=x onerror=alert(1)>"
        );
        expect(document.querySelectorAll("img").length).toBe(0);
    });
});

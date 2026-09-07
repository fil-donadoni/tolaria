// Assertions read the DOM directly rather than through jest-dom's matchers —
// the `types` array in this project's tsconfig doesn't pick up jest-dom's type
// augmentation, so those matchers type-check as missing under `tsc -b` even
// though they run fine (same workaround as `Term.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NowView } from "../NowView";
import { refreshLoopStatus, resetLoopStatus } from "../../../lib/loopStatus";
import { resetOverlays } from "../../../lib/overlays";
import { resetWatch } from "../../../lib/watch";
import { resetPendingAction } from "../../../lib/confirm";
import { resetSectionFlash } from "../../../lib/sections";
import { SECTION_IDS, nowLights } from "../../../lib/nowLights";
import { goldenPayload, NOW_MS, stubNowFetch } from "./fixture";
import type { NowPayload } from "../../../lib/nowPayload";

/**
 * The Now view against a GOLDEN PAYLOAD (PRD #3148 S2).
 *
 * The AC is "every section renders with the same numbers as the vanilla view
 * for the same payload", so the figures below are asserted as the STRINGS an
 * operator reads — `28%`, `23h ago`, `221 → 218`, `Batch #12` — not as the raw
 * fields. A port that changed a rounding rule, a floor, or a plural would pass
 * a field-level check and fail a person.
 *
 * The clock is pinned, because half of those strings are relative.
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("NowView — the golden payload renders the operator's own numbers", () => {
    it("states the verdict, its evidence and its remedy literals", async () => {
        await mountWith(goldenPayload());
        expect(screen.getByText("NEEDS ATTENTION")).not.toBeNull();
        expect(
            screen.getByText(
                "Two claims are orphaned and no driver is running."
            )
        ).not.toBeNull();
        expect(screen.getByText("orphaned-claims")).not.toBeNull();
        // The remedy's backticked spans are code with their own copy
        // affordance; the prose between them stays prose.
        expect(
            screen.getByText("bun run loop:doctor --release")
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Copy in-progress" })
        ).not.toBeNull();
        // `remedyAction` names the button — never the remedy's prose.
        expect(
            screen.getByRole("button", { name: "Resume driver" })
        ).not.toBeNull();
    });

    it("lights the four subsystems with their word, figure and unit", async () => {
        await mountWith(goldenPayload());
        const driver = screen.getByRole("button", { name: /Driver/ });
        expect(within(driver).getByText("DEAD")).not.toBeNull();
        expect(within(driver).getByText("2")).not.toBeNull();
        expect(within(driver).getByText("recent passes")).not.toBeNull();
        expect(
            within(driver).getByText(
                "Stale pid file — pid 4242 is not running."
            )
        ).not.toBeNull();

        const queue = screen.getByRole("button", { name: /Queue/ });
        expect(within(queue).getByText("WAITING")).not.toBeNull();
        expect(within(queue).getByText("7")).not.toBeNull();
        expect(within(queue).getByText("issues waiting")).not.toBeNull();

        const claims = screen.getByRole("button", { name: /Claims/ });
        expect(within(claims).getByText("ORPHANED")).not.toBeNull();
        expect(within(claims).getByText("3")).not.toBeNull();

        const batch = screen.getByRole("button", { name: /Batch/ });
        expect(within(batch).getByText("ATTENTION")).not.toBeNull();
        expect(within(batch).getByText("12")).not.toBeNull();
    });

    it("rounds the driver's figures the way a person reads them", async () => {
        await mountWith(goldenPayload());
        const driverSection = document.getElementById("ls-section-driver")!;
        // `pct` is `28.03027192142857` in the payload.
        expect(within(driverSection).getByText("28%")).not.toBeNull();
        expect(within(driverSection).getByText("221 → 218")).not.toBeNull();
        expect(within(driverSection).getByText("landed")).not.toBeNull();
        // `claims-held` is a DIED pass — the loud bucket, not "ran nothing".
        expect(
            within(driverSection).queryByText("ran, nothing landed")
        ).toBeNull();
        expect(within(driverSection).getByText("died")).not.toBeNull();
        expect(within(driverSection).getByText("pid 4242 dead")).not.toBeNull();
    });

    it("counts the queue by priority", async () => {
        await mountWith(goldenPayload());
        const queue = document.getElementById("ls-section-queue")!;
        expect(within(queue).getByText("total waiting")).not.toBeNull();
        expect(within(queue).getByText("7")).not.toBeNull();
        expect(within(queue).getByText("no priority")).not.toBeNull();
    });

    it("names the batch by its receipt total and prints its role figures", async () => {
        await mountWith(goldenPayload());
        expect(screen.getByText("Batch #12")).not.toBeNull();
        const batch = document.getElementById("ls-section-batch")!;
        // Twice, and meaning two different things: the aggregate stat box
        // ("8 implement receipts") and the failed row's own role badge.
        expect(within(batch).getAllByText("implement")).toHaveLength(2);
        // `missing` is spelled out — "missing missing: 1" is the wording this
        // replaced (#2632).
        expect(
            within(batch).getByText("missing session marker")
        ).not.toBeNull();
        expect(within(batch).getByText("needing attention")).not.toBeNull();
        expect(
            within(batch).getByRole("button", { name: /Copy 9f8e7d6c/ })
        ).not.toBeNull();
    });

    it("prints each claim's age FLOORED, its stage as a sentence, and its blast radius", async () => {
        await mountWith(goldenPayload());
        const claims = document.getElementById("ls-section-claims")!;
        // 23.8h floors to 23 — "at least 23 whole hours", never rounded UP to
        // an age the claim has not reached (#2632 review finding 8).
        expect(within(claims).getByText("23h ago")).not.toBeNull();
        expect(within(claims).getByText("30m ago")).not.toBeNull();
        expect(
            within(claims).getByText("PR open, waiting for review")
        ).not.toBeNull();
        expect(within(claims).getByText("blocks 2 others")).not.toBeNull();
        expect(within(claims).getByText("orphaned")).not.toBeNull();
        expect(within(claims).getByText("unsure")).not.toBeNull();
        expect(within(claims).getByText("working")).not.toBeNull();
        // Release is offered on the orphan and on nothing else.
        expect(
            within(claims).getAllByRole("button", {
                name: /^Release the claim/,
            })
        ).toHaveLength(1);
    });

    it("lists the live sessions and the session working each claim", async () => {
        await mountWith(goldenPayload());
        const live = document.getElementById("ls-section-live")!;
        expect(within(live).getByText("feat/issue-3151")).not.toBeNull();
        expect(within(live).getByText("98.8k")).not.toBeNull();
        expect(within(live).getByText("2 in the last 30 min")).not.toBeNull();
        const claims = document.getElementById("ls-section-claims")!;
        expect(
            within(claims).getByRole("button", {
                name: "Watch porting the Now view",
            })
        ).not.toBeNull();
    });

    it("totals the activity window and names its busiest hour", async () => {
        await mountWith(goldenPayload());
        const activity = document.getElementById("ls-section-activity")!;
        expect(within(activity).getByText("54.3k")).not.toBeNull();
        expect(within(activity).getByText("$12.50")).not.toBeNull();
        expect(within(activity).getByText("busiest hour")).not.toBeNull();
    });

    it("asks the live route about exactly the issues that are claimed", async () => {
        const { calls } = await mountWith(goldenPayload());
        expect(calls).toContain("/api/live?issues=3151,3152,3153");
    });
});

describe("NowView — UNAVAILABLE is never an empty state (#2519 round 3, finding 5)", () => {
    it("a failed claims read says so, in the light and in the table, and never prints a zero", async () => {
        const payload = goldenPayload();
        payload.claims = null;
        payload.claimsError = "gh: GraphQL rate limit exceeded";
        await mountWith(payload);

        const light = screen.getByRole("button", { name: /Claims/ });
        expect(within(light).getByText("UNAVAILABLE")).not.toBeNull();
        expect(within(light).queryByText("0")).toBeNull();

        const claims = document.getElementById("ls-section-claims")!;
        expect(
            within(claims).getByText(/GraphQL rate limit exceeded/)
        ).not.toBeNull();
        expect(within(claims).queryByText("No claimed issues.")).toBeNull();
    });

    it("a failed queue read renders a banner, not a row of zeros", async () => {
        const payload = goldenPayload();
        payload.queueDepth = null;
        payload.queueDepthError = "gh: connection refused";
        await mountWith(payload);
        const queue = document.getElementById("ls-section-queue")!;
        expect(within(queue).getByText(/connection refused/)).not.toBeNull();
        expect(within(queue).queryByText("total waiting")).toBeNull();
    });

    it("a failed blocked-by read degrades ONE fact, not the whole table", async () => {
        const payload = goldenPayload();
        payload.dependentsError = "issue bodies unreadable";
        await mountWith(payload);
        const claims = document.getElementById("ls-section-claims")!;
        expect(
            within(claims).getByText(/blocked-by counts unavailable/)
        ).not.toBeNull();
        // The claims themselves are still known and still render.
        expect(within(claims).getByText("23h ago")).not.toBeNull();
    });

    it("a failed live read declares itself and blanks the session column rather than claiming none", async () => {
        const payload = goldenPayload();
        delete payload.live;
        payload.liveError = "transcripts unreadable";
        await mountWith(payload);
        const claims = document.getElementById("ls-section-claims")!;
        expect(
            within(claims).getByText(/session lookup unavailable/)
        ).not.toBeNull();
        expect(within(claims).queryByText("no session found")).toBeNull();
        const live = document.getElementById("ls-section-live")!;
        expect(
            within(live).getByText(
                /cannot tell which sessions are running — not the same as none/
            )
        ).not.toBeNull();
    });

    it("a failed activity read draws NO chart — a flat line of zeros would read as a quiet day", async () => {
        const payload = goldenPayload();
        delete payload.activity;
        payload.activityError = "no transcripts directory";
        await mountWith(payload);
        const activity = document.getElementById("ls-section-activity")!;
        expect(
            within(activity).getByText(/not the same as a quiet day/)
        ).not.toBeNull();
        expect(within(activity).queryByRole("group")).toBeNull();
    });

    it("a failed merges read notes both places it degrades; a TRUNCATED page is a third state, not a failure", async () => {
        const failed = goldenPayload();
        failed.recentMerges = null;
        failed.recentMergesError = "gh pr list failed";
        const first = await mountWith(failed);
        expect(first).not.toBeNull();
        expect(
            within(document.getElementById("ls-section-timeline")!).getByText(
                /merge ticks may be incomplete/
            )
        ).not.toBeNull();
        expect(
            within(document.getElementById("ls-section-activity")!).getByText(
                /merged-PR line may be incomplete/
            )
        ).not.toBeNull();
    });

    it("a truncated merge page says so without calling the read unavailable", async () => {
        const payload = goldenPayload();
        payload.recentMergesTruncated = true;
        await mountWith(payload);
        const timeline = document.getElementById("ls-section-timeline")!;
        expect(
            within(timeline).getByText(/merge history hit its fetch limit/)
        ).not.toBeNull();
    });

    it("an empty window is a sentence, not a blank box", async () => {
        const payload = goldenPayload();
        payload.timelinePasses = [];
        payload.claims = [];
        payload.recentMerges = [];
        await mountWith(payload);
        expect(
            screen.getByText(
                "Nothing ran, was claimed or merged in the last 24 hours."
            )
        ).not.toBeNull();
    });

    it("a failed loop-status read says so in the subtitle and draws no sections at all", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    json: () => Promise.resolve({ error: "boom" }),
                } as Response)
            )
        );
        renderNow();
        await screen.findByText("error: boom");
        expect(screen.queryByText("Claimed issues")).toBeNull();
    });
});

describe("NowView — a poll must not cost the focus ring (PR #2837 review, finding 1)", () => {
    it("keeps keyboard focus on the control the operator is standing on across a refresh that changes the payload", async () => {
        const payload = goldenPayload();
        const { fetchStub } = stubNowFetch(payload);
        const stub = vi.fn(fetchStub);
        vi.stubGlobal("fetch", stub);
        renderNow();
        await screen.findByText("Claimed issues");

        const light = screen.getByRole("button", { name: /Queue/ });
        light.focus();
        expect(document.activeElement).toBe(light);

        // The next poll reports a DIFFERENT queue — a light flipping its
        // figure is exactly when an operator is looking at it.
        const moved = goldenPayload();
        moved.queueDepth = {
            P0: 1,
            P1: 2,
            P2: 3,
            unprioritized: 2,
            total: 8,
        };
        const next = stubNowFetch(moved);
        stub.mockImplementation(next.fetchStub);
        await act(async () => {
            await refreshLoopStatus();
        });

        await waitFor(() => {
            expect(
                within(screen.getByRole("button", { name: /Queue/ })).getByText(
                    "8"
                )
            ).not.toBeNull();
        });
        // The SAME element, still focused: React patched the text node rather
        // than replacing the button, which is what `nowControlKey` and
        // `writeBodyPreservingFocus` existed to fake.
        expect(document.activeElement).toBe(light);
    });
});

describe("NowView — a light jumps to the section it points at (#2630)", () => {
    it("renders a section for every id a light targets — a light can never point at an id nothing renders", async () => {
        await mountWith(goldenPayload());
        for (const id of Object.values(SECTION_IDS)) {
            expect(document.getElementById(id), id).not.toBeNull();
        }
        for (const light of nowLights(goldenPayload())) {
            expect(
                document.getElementById(light.target),
                light.target
            ).not.toBeNull();
        }
    });

    it("marks the landing section, so the jump has a visible destination", async () => {
        await mountWith(goldenPayload());
        const batch = document.getElementById(SECTION_IDS.batch)!;
        expect(batch.className).not.toContain("ring-2");
        fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
        await waitFor(() => {
            expect(
                document.getElementById(SECTION_IDS.batch)!.className
            ).toContain("ring-2");
        });
        // …and only that one.
        expect(
            document.getElementById(SECTION_IDS.queue)!.className
        ).not.toContain("ring-2");
    });
});

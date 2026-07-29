// Issue #1819 — mobile compaction for the error toast (illegal-action
// feedback): smaller text + less lateral padding on narrow screens, a
// max-width that always leaves margin from the viewport edges (never
// edge-to-edge on a 390px phone), and the same never-overlap-the-controller-
// bar guarantee as before. These assertions run through the REAL rendered
// component (not a hand-built view), so a regression that quietly drops the
// compact classes fails here.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

vi.mock("convex/react", () => ({
    useMutation: () => async () => {},
    // ErrorToast lazily queries the full state for its copy-to-clipboard
    // payload; an inert stub is enough for these DOM-shape assertions.
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => ({
    api: { game: { getFullState: { _name: "getFullState" } } },
}));

const { default: ErrorToast } = await import("../error-toast");

afterEach(cleanup);

function renderToast() {
    return render(
        <ErrorToast
            error={{ title: "Not enough mana.", detail: "full detail" }}
            gameId={"g1" as Id<"games">}
            onDismiss={() => {}}
        />
    );
}

describe("ErrorToast mobile compaction (issue #1819)", () => {
    it("caps width with lateral margin from both edges (never edge-to-edge on a 390px viewport)", () => {
        const { container } = renderToast();
        const outer = container.firstElementChild as HTMLElement;
        expect(outer).not.toBeNull();
        // `w-[calc(100vw-2rem)]` always reserves 1rem clear on EACH side,
        // whatever the viewport width — the guarantee a plain fixed
        // `max-w-*` alone can't make on a very narrow phone. `max-w-sm`
        // stops it from growing arbitrarily wide on larger screens.
        expect(outer.className).toContain("w-[calc(100vw-2rem)]");
        expect(outer.className).toContain("max-w-sm");
    });

    it("still centers horizontally via the fixed/translate anchor", () => {
        const { container } = renderToast();
        const outer = container.firstElementChild as HTMLElement;
        expect(outer.className).toContain("fixed");
        expect(outer.className).toContain("left-1/2");
        expect(outer.className).toContain("-translate-x-1/2");
    });

    it("clears the controller bar via the measured seam, preserving the prior desktop inset", () => {
        const { container } = renderToast();
        const outer = container.firstElementChild as HTMLElement;
        // Same spelling `ABOVE_CONTROLLER_BAR` publishes
        // (controller-bar-metrics.ts) — pins the mobile anchor to the
        // bar's MEASURED height instead of a hardcoded inset that a
        // wrapped, two-line bar could grow past.
        expect(outer.className).toContain(
            "bottom-[calc(var(--controller-bar-h,8rem)+0.5rem)]"
        );
        // Desktop/landscape (no bar mounted) keeps the EXACT prior inset.
        expect(outer.className).toContain("md:bottom-24");
    });

    it("the error title uses a smaller mobile font and less horizontal padding than the desktop size", () => {
        const { getByText } = renderToast();
        const title = getByText("Not enough mana.");
        // Mobile-first: the un-prefixed (mobile) classes must be the SMALLER
        // pair; `sm:` bumps them up for larger screens. Asserting both the
        // presence of the compact pair AND the absence of an un-prefixed
        // `text-sm`/`px-2` regresses loudly if someone reverts to the old
        // flat desktop-only sizing.
        expect(title.className).toContain("text-xs");
        expect(title.className).toContain("px-1");
        expect(title.className).toContain("sm:text-sm");
        expect(title.className).toContain("sm:px-2");
        expect(title.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
        expect(title.className).not.toMatch(/(^|\s)px-2(\s|$)/);
    });

    it("the banner shell itself uses reduced mobile padding, restored at sm:", () => {
        const { container } = renderToast();
        const banner = container.querySelector(
            '[data-slot="banner"]'
        ) as HTMLElement;
        expect(banner).not.toBeNull();
        expect(banner.className).toContain("px-2");
        expect(banner.className).toContain("py-1.5");
        expect(banner.className).toContain("sm:px-3");
        expect(banner.className).toContain("sm:py-2");
        // twMerge must have actually dropped the base recipe's flat
        // `px-3 py-2` — if it didn't, the un-prefixed px-3/py-2 would still
        // be present alongside the compact override, defeating the point.
        expect(banner.className).not.toMatch(/(^|\s)px-3(\s|$)/);
        expect(banner.className).not.toMatch(/(^|\s)py-2(\s|$)/);
    });

    it("renders the title text and stays dismissible/copyable", () => {
        const { getByText, getByLabelText } = renderToast();
        expect(getByText("Not enough mana.")).toBeTruthy();
        expect(getByText("Copy")).toBeTruthy();
        expect(getByLabelText("Dismiss error")).toBeTruthy();
    });

    it("renders nothing when there is no error", async () => {
        const { container } = render(
            <ErrorToast
                error={null}
                gameId={"g1" as Id<"games">}
                onDismiss={() => {}}
            />
        );
        expect(container.firstChild).toBeNull();
    });
});

// The cross-cutting overlay specimens actually MOUNT (issue #4423).
//
// The census reads a specimen from the design-system page's IMPORTS
// (`scripts/lib/ui-census.ts`), so an import that renders nothing would report
// the four overlays censused while the lane photographed an empty page. The
// lane's `dlg-*` surfaces are the real proof, but they need a deployment and a
// browser; this is the offline half, and it reds when an overlay's props drift
// out from under its fixture. Same shape as `sections-board-dialogs.test.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn().mockResolvedValue(undefined),
    useAction: () => vi.fn().mockResolvedValue(undefined),
    useQuery: () => undefined,
    useConvex: () => ({ connectionState: () => ({}) }),
}));

const { OverlaysSection } = await import("../sections-overlays");

function openers(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>("[data-overlay-specimen]")];
}

const LAYER = '[role="dialog"]';

beforeEach(cleanup);
afterEach(cleanup);

describe("the /admin/design-system cross-cutting overlay specimens", () => {
    it("renders one opener per overlay and no layer until one is pressed", () => {
        const { container } = render(<OverlaysSection />);
        expect(
            openers(container).map((b) => b.dataset.overlaySpecimen)
        ).toEqual([
            "disclaimer",
            "bug-report",
            "inspect-overlay",
            "scenario-active-game",
        ]);
        expect(document.body.querySelector(LAYER)).toBeNull();
    });

    it("every opener mounts a real dialog layer", () => {
        const { container } = render(<OverlaysSection />);
        const slugs = openers(container).map(
            (b) => b.dataset.overlaySpecimen as string
        );
        const dead: string[] = [];
        for (const slug of slugs) {
            cleanup();
            const view = render(<OverlaysSection />);
            const opener = view.container.querySelector<HTMLElement>(
                `[data-overlay-specimen="${slug}"]`
            );
            fireEvent.click(opener as HTMLElement);
            if (!document.body.querySelector(LAYER)) dead.push(slug);
        }
        expect(
            dead,
            `specimens that mounted nothing: ${dead.join(", ")}`
        ).toEqual([]);
    });
});

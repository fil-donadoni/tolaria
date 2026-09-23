// The board-dialog specimens actually MOUNT (issue #4419).
//
// The `check:ui` census reads a specimen from the design-system page's
// IMPORTS (`scripts/lib/ui-census.ts`), so an import that renders nothing
// would report the whole board censused while the lane photographed an empty
// page — the exact fail-open the census exists to remove. The lane's own
// `dlg-*` surfaces are the real proof (a probe at five viewports), but they
// need a deployment and a browser; this is the offline half, and it is what
// reds when a dialog's props drift out from under its fixture.
//
// It asserts the LAYER, never the text: every specimen paints a `role="dialog"`
// (GameDialog, the phase list), an `[data-action-sheet]` (the two ActionSheet
// menus) or an `[data-slot="dialog-content"]` (AnchoredPicker).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn().mockResolvedValue(undefined),
    useQuery: () => undefined,
    useConvex: () => ({}),
}));

const { BoardDialogsSection } = await import("../sections-board-dialogs");

/** Every opener the section renders, read off the DOM rather than re-listed:
 *  a specimen added to the table without a working mount must red here. */
function openers(root: HTMLElement): HTMLElement[] {
    return [
        ...root.querySelectorAll<HTMLElement>("[data-board-dialog-specimen]"),
    ];
}

const LAYER =
    '[role="dialog"], [data-action-sheet], [data-slot="dialog-content"]';

beforeEach(cleanup);
afterEach(cleanup);

describe("the /admin/design-system board-dialog specimens", () => {
    it("renders one opener per specimen and no layer until one is pressed", () => {
        const { container } = render(<BoardDialogsSection />);
        expect(openers(container).length).toBeGreaterThan(0);
        expect(document.body.querySelector(LAYER)).toBeNull();
    });

    it("every opener mounts a real overlay layer", () => {
        const { container } = render(<BoardDialogsSection />);
        const slugs = openers(container).map(
            (b) => b.dataset.boardDialogSpecimen as string
        );
        const dead: string[] = [];
        for (const slug of slugs) {
            cleanup();
            const view = render(<BoardDialogsSection />);
            const opener = view.container.querySelector<HTMLElement>(
                `[data-board-dialog-specimen="${slug}"]`
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

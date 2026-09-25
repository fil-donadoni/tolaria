// The cast-picker specimens actually MOUNT (issue #4420).
//
// The offline half of the lane's `pick-*` surfaces, for the same reason as
// `sections-board-dialogs.test.tsx`: the census reads a specimen from the
// design-system page's IMPORTS, so an import that renders nothing would read
// as covered while the lane photographed an empty page. This reds when a
// picker's props drift out from under its fixture.
//
// It asserts the LAYER, never the text: the anchored pickers paint a
// `[data-slot="dialog-content"]`, the two GameDialogs a `role="dialog"`, and
// the inline card its `[data-selectable-card-specimen]` seam.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn().mockResolvedValue(undefined),
    useQuery: () => undefined,
    useConvex: () => ({}),
}));

const { CastPickersSection } = await import("../sections-cast-pickers");

/** Every opener the section renders, read off the DOM rather than re-listed:
 *  a specimen added to the table without a working mount must red here. */
function openers(root: HTMLElement): HTMLElement[] {
    return [
        ...root.querySelectorAll<HTMLElement>("[data-cast-picker-specimen]"),
    ];
}

const LAYER =
    '[role="dialog"], [data-slot="dialog-content"], [data-selectable-card-specimen]';

beforeEach(cleanup);
afterEach(cleanup);

describe("the /admin/design-system cast-picker specimens", () => {
    it("renders one opener per specimen and no layer until one is pressed", () => {
        const { container } = render(<CastPickersSection />);
        expect(openers(container)).toHaveLength(8);
        expect(document.body.querySelector(LAYER)).toBeNull();
    });

    it("every opener mounts its layer", () => {
        const { container } = render(<CastPickersSection />);
        const slugs = openers(container).map(
            (b) => b.dataset.castPickerSpecimen as string
        );
        const dead: string[] = [];
        for (const slug of slugs) {
            cleanup();
            const view = render(<CastPickersSection />);
            const opener = view.container.querySelector<HTMLElement>(
                `[data-cast-picker-specimen="${slug}"]`
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

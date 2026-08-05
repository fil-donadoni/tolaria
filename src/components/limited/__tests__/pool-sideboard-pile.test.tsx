// Issue #2056: `Pool (Sideboard) N` wrapped to 3 lines / 72px in an 82px
// pane at the 852x303 baseline — the pane's own header alone consumed 88%
// of the available height. The title must truncate to one line instead.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import PoolSideboardPile from "../pool-sideboard-pile";

afterEach(() => cleanup());

describe("PoolSideboardPile", () => {
    it("renders the title with the live count and the empty message when there are no groups", () => {
        const { getByText } = render(
            <PoolSideboardPile
                title="Pool (Sideboard)"
                count={0}
                groups={[]}
                emptyMessage="Nothing here yet."
            />
        );
        expect(getByText(/^Pool \(Sideboard\) 0/)).toBeTruthy();
        expect(getByText("Nothing here yet.")).toBeTruthy();
    });
});

describe("PoolSideboardPile — title truncation (issue #2056)", () => {
    it("the title span truncates to one line instead of wrapping", () => {
        const { getByText, container } = render(
            <PoolSideboardPile
                title="Pool (Sideboard)"
                count={90}
                groups={[]}
                emptyMessage="Nothing here yet."
            />
        );
        const titleSpan = getByText(/^Pool \(Sideboard\) 90/);
        expect(titleSpan.className.split(/\s+/)).toContain("truncate");
        // `truncate` only takes effect on a shrinkable flex item — the
        // header row itself must allow the title to shrink below its
        // content width (min-w-0), or the truncate class is a no-op.
        const headerRow = titleSpan.parentElement as HTMLElement;
        expect(headerRow.className.split(/\s+/)).toContain("min-w-0");
        void container;
    });
});

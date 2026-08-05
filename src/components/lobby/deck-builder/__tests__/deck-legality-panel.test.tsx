// Issue #2056 defect 2: the reasons list must be CAPPED with the overflow
// reachable behind a disclosure, not left to grow the panel unbounded — at
// the 852x303 baseline the panel was already pushing the Save bar below the
// fold with just ONE reason showing; an unbounded list only makes it worse.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Reason } from "@convex/formats";
import DeckLegalityPanel from "../deck-legality-panel";

afterEach(() => cleanup());

function reason(code: string): Reason {
    return { code, message: `Reason ${code}` };
}

describe("DeckLegalityPanel", () => {
    it("shows the Legal badge and no reasons list when the deck is legal", () => {
        const { getByText, queryByRole } = render(
            <DeckLegalityPanel
                formatLabel="Limited"
                isLegal={true}
                reasons={[]}
            />
        );
        expect(getByText("Legal")).toBeTruthy();
        expect(queryByRole("list")).toBeNull();
    });

    it("shows every reason when the count is at or below the cap (2)", () => {
        const { getByText, queryByText } = render(
            <DeckLegalityPanel
                formatLabel="Limited"
                isLegal={false}
                reasons={[reason("size"), reason("colors")]}
            />
        );
        expect(getByText("Reason size")).toBeTruthy();
        expect(getByText("Reason colors")).toBeTruthy();
        expect(queryByText(/more/)).toBeNull();
    });
});

describe("DeckLegalityPanel — capped reasons list (issue #2056 defect 2)", () => {
    it("caps the visible list and shows a '+N more' disclosure past the cap", () => {
        const { getByText, queryByText } = render(
            <DeckLegalityPanel
                formatLabel="Limited"
                isLegal={false}
                reasons={[
                    reason("size"),
                    reason("colors"),
                    reason("banned"),
                    reason("sideboard"),
                ]}
            />
        );
        expect(getByText("Reason size")).toBeTruthy();
        expect(getByText("Reason colors")).toBeTruthy();
        // The remaining two are behind the disclosure, not clipped silently.
        expect(queryByText("Reason banned")).toBeNull();
        expect(queryByText("Reason sideboard")).toBeNull();
        expect(getByText("+2 more")).toBeTruthy();
    });

    it("the overflow is REACHABLE — clicking the disclosure reveals every reason", () => {
        const { getByText, queryByText } = render(
            <DeckLegalityPanel
                formatLabel="Limited"
                isLegal={false}
                reasons={[
                    reason("size"),
                    reason("colors"),
                    reason("banned"),
                    reason("sideboard"),
                ]}
            />
        );
        fireEvent.click(getByText("+2 more"));
        expect(getByText("Reason banned")).toBeTruthy();
        expect(getByText("Reason sideboard")).toBeTruthy();
        expect(queryByText("+2 more")).toBeNull();
        expect(getByText("Show fewer")).toBeTruthy();
    });
});

// Issue #4817 — the Rulings entry on the Inspect overlay: `Oracle | Printed |
// Rulings`, kept across ‹ › stepping, zero network until selected.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { getCardByName } from "@convex/cards";
import InspectOverlay from "../inspect-overlay";
import { resetRulingsCacheForTests } from "~/lib/scryfallRulings";

const BOLT = getCardByName("Lightning Bolt").id;
const CS = getCardByName("Counterspell").id;
const BODY = {
    data: [{ source: "wotc", published_at: "2019-01-01", comment: "Pay." }],
};

function stubFetch() {
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => ({
        ok: true,
        status: 200,
        json: async () => BODY,
    }));
    vi.stubGlobal("fetch", f);
    return f;
}

const rulingsTab = () =>
    document.querySelector('[data-preview-mode="rulings"]') as HTMLElement;

beforeEach(() => {
    resetRulingsCacheForTests();
    localStorage.clear();
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("orientation: portrait"),
        addEventListener() {},
        removeEventListener() {},
    }));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("InspectOverlay Rulings entry (issue #4817)", () => {
    it("offers Oracle | Printed | Rulings and fetches only once Rulings is selected", async () => {
        const f = stubFetch();
        const { findByText } = render(
            <InspectOverlay cardId={BOLT} onClose={() => {}} />
        );
        expect(
            [...document.querySelectorAll("[data-preview-mode]")].map(
                (b) => (b as HTMLElement).dataset.previewMode
            )
        ).toEqual(["computed", "printed", "rulings"]);
        expect(f).not.toHaveBeenCalled();
        fireEvent.click(rulingsTab());
        await findByText("Wizards");
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("keeps Rulings selected when stepping and loads the next card's rulings", async () => {
        const f = stubFetch();
        const { rerender, findByText } = render(
            <InspectOverlay cardId={BOLT} onClose={() => {}} />
        );
        fireEvent.click(rulingsTab());
        await findByText("Wizards");
        rerender(<InspectOverlay cardId={CS} onClose={() => {}} />);
        await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
        expect(f.mock.calls[0][0]).not.toBe(f.mock.calls[1][0]);
        expect(
            document.querySelector('[data-testid="card-preview-rulings"]')
        ).not.toBeNull();
    });
});

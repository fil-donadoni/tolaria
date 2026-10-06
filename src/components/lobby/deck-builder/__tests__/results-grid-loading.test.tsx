import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ResultsGrid from "../results-grid";

// Issue #4861 — the search index is a fetched asset now, so an empty result
// can mean "not yet" as well as "no match". The grid must never tell a user
// that nothing matches while the index is still on its way.
const props = {
    entries: [],
    idle: false,
    activeSets: [],
    allowedSets: null,
    enforceAvailability: true,
    onAdd: () => {},
};

describe("ResultsGrid while the search index loads (issue #4861)", () => {
    it("says the cards are loading, not that nothing matches", () => {
        render(<ResultsGrid {...props} loading />);
        expect(screen.getByText("Loading cards...")).toBeTruthy();
        expect(screen.queryByText("No cards match these filters.")).toBeNull();
    });

    it("names a failed load instead of an empty match", () => {
        render(<ResultsGrid {...props} error="HTTP 503" />);
        expect(
            screen.getByText("Could not load the card search.")
        ).toBeTruthy();
        expect(screen.getByText("HTTP 503")).toBeTruthy();
    });

    it("still says nothing matches once the index has loaded", () => {
        render(<ResultsGrid {...props} />);
        expect(screen.getByText("No cards match these filters.")).toBeTruthy();
    });
});

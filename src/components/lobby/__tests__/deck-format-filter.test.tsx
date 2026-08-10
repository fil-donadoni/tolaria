// @vitest-environment happy-dom
// Deck-list Format filter (PRD #509, ADR 0036, issue #513): an "All" + three
// Formats select that narrows a browsed deck list. Navigation only — never
// gates play, never sets a deck's Format. Distinct from the creation
// FormatSelect (#510), which has no "All" option.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { FORMAT_IDS, FORMAT_RULES } from "@convex/formats";
import DeckFormatFilter from "../deck-format-filter";

describe("DeckFormatFilter (issue #513)", () => {
    it("offers 'All' plus one option per registered Format", () => {
        const { getByRole, getAllByRole, getByText } = render(
            <DeckFormatFilter value="all" onChange={() => {}} />
        );
        expect(
            getByRole("combobox", { name: "Filter decks by format" })
        ).toBeDefined();
        // "All" + every FormatId (Freeform, Alpha 40, Old School).
        expect(getAllByRole("option")).toHaveLength(FORMAT_IDS.length + 1);
        expect(getByText("All")).toBeDefined();
        for (const id of FORMAT_IDS) {
            expect(getByText(FORMAT_RULES[id].label)).toBeDefined();
        }
    });

    it("shows the current filter as the selected value", () => {
        const { getByRole } = render(
            <DeckFormatFilter value="old-school" onChange={() => {}} />
        );
        const select = getByRole("combobox", {
            name: "Filter decks by format",
        }) as HTMLSelectElement;
        expect(select.value).toBe("old-school");
    });

    it("reports the chosen filter on change", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <DeckFormatFilter value="all" onChange={onChange} />
        );
        fireEvent.change(
            getByRole("combobox", { name: "Filter decks by format" }),
            { target: { value: "alpha-40" } }
        );
        expect(onChange).toHaveBeenCalledWith("alpha-40");
    });

    it("reports 'all' when the filter is cleared back to All", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <DeckFormatFilter value="alpha-40" onChange={onChange} />
        );
        fireEvent.change(
            getByRole("combobox", { name: "Filter decks by format" }),
            { target: { value: "all" } }
        );
        expect(onChange).toHaveBeenCalledWith("all");
    });
});

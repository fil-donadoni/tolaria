// Deck Format picker (PRD #509, ADR 0036, issue #510): a required select on
// create, a read-only label on edit (Format is immutable once chosen).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DECK_CREATION_FORMATS, FORMAT_RULES } from "@convex/formats";
import FormatSelect from "../format-select";

describe("FormatSelect (ADR 0036)", () => {
    it("renders a select with an option per registered Format in create mode", () => {
        const { getByRole, getAllByRole } = render(
            <FormatSelect
                value="freeform"
                readOnly={false}
                onChange={() => {}}
            />
        );
        const select = getByRole("combobox", { name: "Deck format" });
        expect(select).toBeDefined();
        expect(getAllByRole("option")).toHaveLength(
            DECK_CREATION_FORMATS.length
        );
    });

    it("never offers Limited, whose deck only its Event can create", () => {
        const { getAllByRole } = render(
            <FormatSelect
                value="freeform"
                readOnly={false}
                onChange={() => {}}
            />
        );
        const values = getAllByRole("option").map(
            (option) => (option as HTMLOptionElement).value
        );
        expect(values).toContain("freeform");
        expect(values).not.toContain("limited");
    });

    it("still labels an existing Limited deck read-only", () => {
        const { getByText } = render(
            <FormatSelect value="limited" readOnly={true} onChange={() => {}} />
        );
        expect(getByText(FORMAT_RULES.limited.label)).toBeDefined();
    });

    it("shows the current Format as the selected value", () => {
        const { getByRole } = render(
            <FormatSelect
                value="old-school"
                readOnly={false}
                onChange={() => {}}
            />
        );
        const select = getByRole("combobox", {
            name: "Deck format",
        }) as HTMLSelectElement;
        expect(select.value).toBe("old-school");
    });

    it("reports the chosen FormatId on change", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <FormatSelect
                value="freeform"
                readOnly={false}
                onChange={onChange}
            />
        );
        fireEvent.change(getByRole("combobox", { name: "Deck format" }), {
            target: { value: "alpha-40" },
        });
        expect(onChange).toHaveBeenCalledWith("alpha-40");
    });

    it("renders a read-only label (no control) in edit mode", () => {
        const { queryByRole, getByText } = render(
            <FormatSelect
                value="alpha-40"
                readOnly={true}
                onChange={() => {}}
            />
        );
        // No interactive select — the Format is immutable after creation.
        expect(queryByRole("combobox")).toBeNull();
        // The human-readable label from the registry is shown.
        expect(getByText(FORMAT_RULES["alpha-40"].label)).toBeDefined();
    });
});

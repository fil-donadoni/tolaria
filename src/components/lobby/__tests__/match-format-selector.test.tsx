// Match format selector (PRD #387): renders Bo1/Bo3, marks the active one, and
// reports changes. See `../match-format-selector`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import MatchFormatSelector from "../match-format-selector";

describe("MatchFormatSelector (PRD #387)", () => {
    it("renders a radio for Bo1 and Bo3", () => {
        const { getAllByRole } = render(
            <MatchFormatSelector value={1} onChange={() => {}} />
        );
        expect(getAllByRole("radio")).toHaveLength(2);
    });

    it("marks the selected format as checked", () => {
        const { getByRole } = render(
            <MatchFormatSelector value={3} onChange={() => {}} />
        );
        expect(
            getByRole("radio", { name: "Bo3" }).getAttribute("aria-checked")
        ).toBe("true");
        expect(
            getByRole("radio", { name: "Bo1" }).getAttribute("aria-checked")
        ).toBe("false");
    });

    it("reports the chosen format on click", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <MatchFormatSelector value={1} onChange={onChange} />
        );
        fireEvent.click(getByRole("radio", { name: "Bo3" }));
        expect(onChange).toHaveBeenCalledWith(3);
    });

    it("does not fire while disabled", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <MatchFormatSelector value={1} onChange={onChange} disabled />
        );
        fireEvent.click(getByRole("radio", { name: "Bo3" }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

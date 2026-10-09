// Games format selector (PRD #387): renders Bo1/Bo3, marks the active one, and
// reports changes. See `../games-format-selector`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import GamesFormatSelector from "../games-format-selector";

describe("GamesFormatSelector (PRD #387)", () => {
    it("renders a radio for Bo1 and Bo3", () => {
        const { getAllByRole } = render(
            <GamesFormatSelector value={1} onChange={() => {}} />
        );
        expect(getAllByRole("radio")).toHaveLength(2);
    });

    it("marks the selected format as checked", () => {
        const { getByRole } = render(
            <GamesFormatSelector value={3} onChange={() => {}} />
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
            <GamesFormatSelector value={1} onChange={onChange} />
        );
        fireEvent.click(getByRole("radio", { name: "Bo3" }));
        expect(onChange).toHaveBeenCalledWith(3);
    });

    it("does not fire while disabled", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <GamesFormatSelector value={1} onChange={onChange} disabled />
        );
        fireEvent.click(getByRole("radio", { name: "Bo3" }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

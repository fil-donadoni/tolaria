// Difficulty selector (issue #114): renders the presets, marks the active one,
// and reports changes. See `../difficulty-selector`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DIFFICULTIES } from "@convex/gre";
import DifficultySelector from "../difficulty-selector";

describe("DifficultySelector (issue #114)", () => {
    it("renders a radio for every difficulty", () => {
        const { getAllByRole } = render(
            <DifficultySelector value="medium" onChange={() => {}} />
        );
        expect(getAllByRole("radio")).toHaveLength(DIFFICULTIES.length);
    });

    it("marks the selected difficulty as checked", () => {
        const { getByRole } = render(
            <DifficultySelector value="hard" onChange={() => {}} />
        );
        expect(
            getByRole("radio", { name: "Hard" }).getAttribute("aria-checked")
        ).toBe("true");
        expect(
            getByRole("radio", { name: "Easy" }).getAttribute("aria-checked")
        ).toBe("false");
    });

    it("reports the chosen difficulty on click", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <DifficultySelector value="medium" onChange={onChange} />
        );
        fireEvent.click(getByRole("radio", { name: "Easy" }));
        expect(onChange).toHaveBeenCalledWith("easy");
    });

    it("does not fire while disabled", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <DifficultySelector value="medium" onChange={onChange} disabled />
        );
        fireEvent.click(getByRole("radio", { name: "Hard" }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

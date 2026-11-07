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

    it.each(DIFFICULTIES)(
        "shows the decklist-knowledge subtitle with %s selected",
        (difficulty) => {
            const { getByText } = render(
                <DifficultySelector value={difficulty} onChange={() => {}} />
            );
            expect(
                getByText("Knows your decklist and plays around it.")
            ).toBeTruthy();
        }
    );

    it("offers no Easy preset", () => {
        const { queryByRole } = render(
            <DifficultySelector value="expert" onChange={() => {}} />
        );
        expect(queryByRole("radio", { name: "Easy" })).toBeNull();
    });

    it("marks the selected difficulty as checked", () => {
        const { getByRole } = render(
            <DifficultySelector value="hard" onChange={() => {}} />
        );
        expect(
            getByRole("radio", { name: "Hard" }).getAttribute("aria-checked")
        ).toBe("true");
        expect(
            getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")
        ).toBe("false");
    });

    it("reports the chosen difficulty on click", () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <DifficultySelector value="medium" onChange={onChange} />
        );
        fireEvent.click(getByRole("radio", { name: "Expert" }));
        expect(onChange).toHaveBeenCalledWith("expert");
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

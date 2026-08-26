// Assertions read the native attribute directly (`.getAttribute`) rather than
// jest-dom's `toHaveAttribute`/`toBeDisabled` — `tsconfig.app.json`'s
// restricted `types` array doesn't pick up jest-dom's type augmentation (see
// `draft-lab-term-breakdown.test.tsx`), so those matchers type-check as
// missing under `tsc -b` even though they run fine.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SegmentedControl from "../segmented-control";

const OPTIONS = [
    { value: "all", label: "All" },
    { value: "creature", label: "Creatures" },
    { value: "land", label: "Lands" },
] as const;

describe("SegmentedControl (issue #2729, WAI-ARIA radiogroup pattern)", () => {
    it("renders one role=radio per option inside a role=radiogroup", () => {
        render(
            <SegmentedControl
                options={OPTIONS}
                value="all"
                onChange={vi.fn()}
                ariaLabel="Filter by card type"
            />
        );
        expect(
            screen.getByRole("radiogroup", { name: "Filter by card type" })
        ).toBeTruthy();
        expect(screen.getAllByRole("radio")).toHaveLength(3);
    });

    it("marks only the selected value's segment aria-checked", () => {
        render(
            <SegmentedControl
                options={OPTIONS}
                value="creature"
                onChange={vi.fn()}
                ariaLabel="Filter by card type"
            />
        );
        expect(
            screen
                .getByRole("radio", { name: "Creatures" })
                .getAttribute("aria-checked")
        ).toBe("true");
        expect(
            screen
                .getByRole("radio", { name: "All" })
                .getAttribute("aria-checked")
        ).toBe("false");
        expect(
            screen
                .getByRole("radio", { name: "Lands" })
                .getAttribute("aria-checked")
        ).toBe("false");
    });

    it("only the selected segment is in the tab order (roving tabindex)", () => {
        render(
            <SegmentedControl
                options={OPTIONS}
                value="creature"
                onChange={vi.fn()}
                ariaLabel="Filter by card type"
            />
        );
        expect(
            screen
                .getByRole("radio", { name: "Creatures" })
                .getAttribute("tabindex")
        ).toBe("0");
        expect(
            screen.getByRole("radio", { name: "All" }).getAttribute("tabindex")
        ).toBe("-1");
        expect(
            screen
                .getByRole("radio", { name: "Lands" })
                .getAttribute("tabindex")
        ).toBe("-1");
    });

    it("clicking an unselected segment calls onChange with its value", () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl
                options={OPTIONS}
                value="all"
                onChange={onChange}
                ariaLabel="Filter by card type"
            />
        );
        fireEvent.click(screen.getByRole("radio", { name: "Lands" }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith("land");
    });

    it("ArrowRight from the selected segment selects the next one", () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl
                options={OPTIONS}
                value="all"
                onChange={onChange}
                ariaLabel="Filter by card type"
            />
        );
        fireEvent.keyDown(screen.getByRole("radio", { name: "All" }), {
            key: "ArrowRight",
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith("creature");
    });

    it("ArrowLeft from the first segment wraps to the last one", () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl
                options={OPTIONS}
                value="all"
                onChange={onChange}
                ariaLabel="Filter by card type"
            />
        );
        fireEvent.keyDown(screen.getByRole("radio", { name: "All" }), {
            key: "ArrowLeft",
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith("land");
    });

    it("disabled: neither click nor arrow keys call onChange", () => {
        const onChange = vi.fn();
        render(
            <SegmentedControl
                options={OPTIONS}
                value="all"
                onChange={onChange}
                ariaLabel="Filter by card type"
                disabled
            />
        );
        const lands = screen.getByRole("radio", {
            name: "Lands",
        }) as HTMLButtonElement;
        expect(lands.disabled).toBe(true);
        fireEvent.click(lands);
        fireEvent.keyDown(screen.getByRole("radio", { name: "All" }), {
            key: "ArrowRight",
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("ArrowRight moves focus to the next segment", () => {
        render(
            <SegmentedControl
                options={OPTIONS}
                value="all"
                onChange={vi.fn()}
                ariaLabel="Filter by card type"
            />
        );
        const all = screen.getByRole("radio", { name: "All" });
        const creatures = screen.getByRole("radio", { name: "Creatures" });
        all.focus();
        fireEvent.keyDown(all, { key: "ArrowRight" });
        expect(document.activeElement).toBe(creatures);
    });
});

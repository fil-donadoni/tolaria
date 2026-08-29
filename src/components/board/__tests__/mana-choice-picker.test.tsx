// Relic of Sauron ({T}: Add two mana in any combination of {U},{B},{R}) surfaces
// multi-colour choices like {U:1,B:1}. The picker keyed buttons by the first
// non-X colour, so choices sharing a leading colour ({U:2},{U:1,B:1},{U:1,R:1})
// collided → React "two children with the same key `B`" warning, and combo
// choices rendered only their first pip. These assert unique keys (no warning)
// and that every coloured pip is rendered.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import type { ManaCost } from "~/types/cards";
import ManaChoicePicker from "../mana-choice-picker";

const RELIC_CHOICES: ManaCost[] = [
    { U: 2 },
    { U: 1, B: 1 },
    { U: 1, R: 1 },
    { B: 2 },
    { B: 1, R: 1 },
    { R: 2 },
];

function renderPicker(position?: { x: number; y: number }) {
    return render(
        <ManaChoicePicker
            choices={RELIC_CHOICES}
            position={position}
            onSelect={() => {}}
            onCancel={() => {}}
        />
    );
}

describe("ManaChoicePicker (multi-colour combos, CR 106.1)", () => {
    afterEach(cleanup);

    it("renders one button per choice with no duplicate-key warning", () => {
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        // The picker's popover portals into `document.body` (`AnchoredPicker`,
        // issue #2920), so its buttons live outside the render's own
        // `container` — query the document instead.
        renderPicker();
        expect(document.querySelectorAll("button")).toHaveLength(
            RELIC_CHOICES.length
        );
        expect(errorSpy).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it("renders every coloured pip of a combination choice", () => {
        renderPicker();
        // {U:1,B:1} button — both symbols must render, not just the first.
        const combo = document
            .querySelectorAll("button")
            .item(1) as HTMLButtonElement;
        const imgs = within(combo).getAllByRole("img");
        expect(imgs.map((i) => i.getAttribute("alt")).sort()).toEqual([
            "B",
            "U",
        ]);
        // {U:2} button — two identical pips.
        const doubleU = document
            .querySelectorAll("button")
            .item(0) as HTMLButtonElement;
        expect(within(doubleU).getAllByRole("img")).toHaveLength(2);
    });

    it("centres on screen when opened without pointer coords (ability menu)", () => {
        // Menu-triggered activation passes no position — the panel must centre,
        // not pin to the top-left corner (fixed left:0/top:0).
        renderPicker(undefined);
        const panel = document
            .querySelectorAll("div.fixed")
            .item(1) as HTMLElement;
        expect(panel.style.left).toBe("50%");
        expect(panel.style.top).toBe("50%");
        expect(panel.style.transform).toBe("translate(-50%, -50%)");
    });

    it("anchors to pointer coords when provided", () => {
        renderPicker({ x: 120, y: 340 });
        const panel = document
            .querySelectorAll("div.fixed")
            .item(1) as HTMLElement;
        expect(panel.style.left).toBe("120px");
        expect(panel.style.top).toBe("340px");
    });
});

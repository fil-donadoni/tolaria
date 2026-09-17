// The multi-select mode picker (ADR 0094, issue #2264): the picker opens BEFORE
// the announcement mutation and the server rejects an out-of-bounds mode list,
// so a picker that commits early or deadlocks makes the card uncastable.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ModePicker from "../mode-picker";
import type { SpellMode } from "@convex/cards/types";
import type { ModePickerConstraint } from "~/lib/mode-picker-constraint";

const modes: SpellMode[] = [
    { id: "a", label: "Mode A", oracleText: "do A" },
    { id: "b", label: "Mode B", oracleText: "do B" },
    { id: "c", label: "Mode C", oracleText: "do C" },
];

function constraint(over: Partial<ModePickerConstraint>): ModePickerConstraint {
    return {
        min: 3,
        max: 3,
        repeats: true,
        legalModeIds: ["a", "b", "c"],
        requiredCount: 3,
        shortfall: false,
        ...over,
    };
}

function renderPicker(c: ModePickerConstraint) {
    const onConfirm = vi.fn();
    const onSelect = vi.fn();
    render(
        <ModePicker
            modes={modes}
            cardName="Probe"
            onSelect={onSelect}
            onCancel={vi.fn()}
            multiSelect={{ constraint: c, onConfirm }}
        />
    );
    return { onConfirm, onSelect };
}

const confirm = () => screen.getByRole("button", { name: "Confirm" });

afterEach(cleanup);

describe("ModePicker multi-select (issue #2264)", () => {
    it("states the declared count and counts repeats per mode, confirming only once met", () => {
        const { onConfirm, onSelect } = renderPicker(constraint({}));
        expect(screen.getAllByText(/Choose three/).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole("button", { name: "Add Mode C" }));
        fireEvent.click(screen.getByRole("button", { name: "Add Mode A" }));
        expect(confirm() as HTMLButtonElement).toHaveProperty("disabled", true);
        fireEvent.click(screen.getByRole("button", { name: "Add Mode C" }));
        expect(
            document
                .querySelector('[data-mode-id="c"]')
                ?.getAttribute("data-mode-count")
        ).toBe("2");
        // The count is full — no mode takes a fourth pick.
        expect(
            screen.getByRole("button", {
                name: "Add Mode B",
            }) as HTMLButtonElement
        ).toHaveProperty("disabled", true);
        expect(onSelect).not.toHaveBeenCalled();

        fireEvent.click(confirm());
        // Printed order, repeats consecutive — not click order.
        expect(onConfirm).toHaveBeenCalledWith(["a", "c", "c"]);
    });

    it("toggles distinct modes and refuses a pick past the maximum", () => {
        const { onConfirm } = renderPicker(
            constraint({ min: 1, max: 2, repeats: false, requiredCount: 1 })
        );
        expect(screen.getAllByText("Choose 1–2").length).toBeGreaterThan(0);
        const rowA = screen.getByRole("button", { name: /Mode A/ });
        const rowB = screen.getByRole("button", { name: /Mode B/ });
        const rowC = screen.getByRole("button", { name: /Mode C/ });
        fireEvent.click(rowB);
        fireEvent.click(rowA);
        expect(rowC as HTMLButtonElement).toHaveProperty("disabled", true);
        fireEvent.click(rowA);
        expect(rowA?.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith(["b"]);
    });

    it("CR 609.3 — confirms with as many modes as are legal, and says so", () => {
        const { onConfirm } = renderPicker(
            constraint({
                repeats: false,
                legalModeIds: ["b", "c"],
                requiredCount: 2,
                shortfall: true,
            })
        );
        expect(
            document.querySelector("[data-mode-shortfall]")?.textContent
        ).toMatch(/Only 2 modes/);
        expect(
            screen.getByRole("button", { name: /Mode A/ }) as HTMLButtonElement
        ).toHaveProperty("disabled", true);
        fireEvent.click(screen.getByRole("button", { name: /Mode B/ }));
        fireEvent.click(screen.getByRole("button", { name: /Mode C/ }));
        expect(confirm() as HTMLButtonElement).toHaveProperty(
            "disabled",
            false
        );
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith(["b", "c"]);
    });
});

describe("ModePicker single-mode path is unchanged", () => {
    it("with no ModeSelection one click commits the mode", () => {
        const onSelect = vi.fn();
        render(
            <ModePicker
                modes={modes}
                cardName="Probe"
                onSelect={onSelect}
                onCancel={vi.fn()}
            />
        );
        expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /Mode B/ }));
        expect(onSelect).toHaveBeenCalledWith("b");
    });
});

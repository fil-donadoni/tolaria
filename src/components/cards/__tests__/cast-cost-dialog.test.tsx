// CastCostDialog (issue: replace native window.prompt/confirm for {X} — CR
// 601.2b — and Kicker — CR 702.33 — with an in-game dialog). These tests drive
// the dialog exactly as the cast pipeline does: enter values, confirm, and
// assert the returned choices; and that invalid input / cancel / ESC never
// confirm a cast.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CastCostDialog from "../cast-cost-dialog";

function renderDialog(
    props: Partial<React.ComponentProps<typeof CastCostDialog>> = {}
) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
        <CastCostDialog
            open
            cardName="Fireball"
            askX={false}
            onConfirm={onConfirm}
            onCancel={onCancel}
            {...props}
        />
    );
    return { onConfirm, onCancel };
}

const castButton = () => screen.getByRole("button", { name: "Cast" });

describe("CastCostDialog (CR 601.2b {X} + CR 702.33 Kicker)", () => {
    it("renders an X stepper only when askX is set", () => {
        renderDialog({ askX: true });
        expect(screen.getByLabelText("Choose X")).toBeTruthy();
    });

    it("omits the X stepper when askX is false", () => {
        renderDialog({ askX: false, kicker: { multi: false } });
        expect(screen.queryByLabelText("Choose X")).toBeNull();
    });

    it("returns the entered X value on confirm", () => {
        const { onConfirm } = renderDialog({ askX: true });
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "3" },
        });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 3,
            kickerCount: undefined,
        });
    });

    it("steps the X value with the +/- buttons", () => {
        const { onConfirm } = renderDialog({ askX: true });
        fireEvent.click(screen.getByRole("button", { name: "Increase" }));
        fireEvent.click(screen.getByRole("button", { name: "Increase" }));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 2,
            kickerCount: undefined,
        });
    });

    it("renders a yes/no checkbox for a single kicker and returns 1 when checked", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kicker: { multi: false },
        });
        const checkbox = screen.getByRole("checkbox");
        fireEvent.click(checkbox);
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerCount: 1,
        });
    });

    it("returns kickerCount 0 for an unchecked single kicker", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kicker: { multi: false },
        });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerCount: 0,
        });
    });

    it("renders a count stepper for a Multikicker and returns the count", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kicker: { multi: true },
        });
        const field = screen.getByLabelText("Times to pay kicker");
        fireEvent.change(field, { target: { value: "2" } });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerCount: 2,
        });
    });

    it("collects X and Multikicker together", () => {
        const { onConfirm } = renderDialog({
            askX: true,
            kicker: { multi: true },
        });
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "4" },
        });
        fireEvent.change(screen.getByLabelText("Times to pay kicker"), {
            target: { value: "1" },
        });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({ chosenX: 4, kickerCount: 1 });
    });

    it("disables Cast on invalid (empty / negative) X and does not confirm", () => {
        const { onConfirm } = renderDialog({ askX: true });
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "" },
        });
        expect((castButton() as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(castButton());
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("submits on Enter in the X field", () => {
        const { onConfirm } = renderDialog({ askX: true });
        const field = screen.getByLabelText("Choose X");
        fireEvent.change(field, { target: { value: "5" } });
        fireEvent.submit(field.closest("form")!);
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 5,
            kickerCount: undefined,
        });
    });

    it("Cancel dismisses without confirming", () => {
        const { onConfirm, onCancel } = renderDialog({ askX: true });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("ESC dismisses without confirming", () => {
        const { onConfirm, onCancel } = renderDialog({ askX: true });
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

describe("CastCostDialog (CR 702.27 Buyback)", () => {
    it("omits the buyback checkbox when buyback is unset", () => {
        renderDialog({ askX: false });
        expect(screen.queryByLabelText("Pay buyback cost")).toBeNull();
    });

    it("renders a yes/no checkbox for buyback and returns true when checked", () => {
        const { onConfirm } = renderDialog({ askX: false, buyback: true });
        fireEvent.click(screen.getByLabelText("Pay buyback cost"));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerCount: undefined,
            buyback: true,
        });
    });

    it("returns buyback false when the checkbox stays unchecked", () => {
        const { onConfirm } = renderDialog({ askX: false, buyback: true });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerCount: undefined,
            buyback: false,
        });
    });

    it("collects X, kicker, and buyback together", () => {
        const { onConfirm } = renderDialog({
            askX: true,
            kicker: { multi: false },
            buyback: true,
        });
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "2" },
        });
        fireEvent.click(screen.getByLabelText("Pay kicker cost"));
        fireEvent.click(screen.getByLabelText("Pay buyback cost"));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 2,
            kickerCount: 1,
            buyback: true,
        });
    });
});

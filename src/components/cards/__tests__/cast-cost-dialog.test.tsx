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
        renderDialog({
            askX: false,
            kickers: [
                { id: "kicker", description: "Kicker {2}", multi: false },
            ],
        });
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
            kickerPayments: undefined,
        });
    });

    it("steps the X value with the +/- buttons", () => {
        const { onConfirm } = renderDialog({ askX: true });
        fireEvent.click(screen.getByRole("button", { name: "Increase" }));
        fireEvent.click(screen.getByRole("button", { name: "Increase" }));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 2,
            kickerPayments: undefined,
        });
    });

    it("renders a yes/no checkbox for a single kicker and returns 1 when checked", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: [
                { id: "kicker", description: "Kicker {2}", multi: false },
            ],
        });
        const checkbox = screen.getByRole("checkbox");
        fireEvent.click(checkbox);
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: { kicker: 1 },
        });
    });

    it("returns no payments for an unchecked single kicker (declining after seeing the cost)", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: [
                { id: "kicker", description: "Kicker {2}", multi: false },
            ],
        });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: undefined,
        });
    });

    it("renders a count stepper for a Multikicker and returns the count", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: [{ id: "kicker", description: "Kicker {2}", multi: true }],
        });
        const field = screen.getByLabelText("Times to pay Kicker {2}");
        fireEvent.change(field, { target: { value: "2" } });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: { kicker: 2 },
        });
    });

    it("collects X and Multikicker together", () => {
        const { onConfirm } = renderDialog({
            askX: true,
            kickers: [{ id: "kicker", description: "Kicker {2}", multi: true }],
        });
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "4" },
        });
        fireEvent.change(screen.getByLabelText("Times to pay Kicker {2}"), {
            target: { value: "1" },
        });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 4,
            kickerPayments: { kicker: 1 },
        });
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
            kickerPayments: undefined,
        });
    });

    it("caps the X stepper at maxX and disables Increase there (CR 702.34a flashback)", () => {
        const { onConfirm } = renderDialog({ askX: true, maxX: 2 });
        const increase = screen.getByRole("button", { name: "Increase" });
        fireEvent.click(increase); // 1
        fireEvent.click(increase); // 2 (cap)
        expect((increase as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(increase); // no-op past the cap
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 2,
            kickerPayments: undefined,
        });
    });

    it("disables Cast when a hand-typed X exceeds maxX and does not confirm", () => {
        const { onConfirm } = renderDialog({ askX: true, maxX: 2 });
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "5" },
        });
        expect((castButton() as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(castButton());
        expect(onConfirm).not.toHaveBeenCalled();
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
            kickerPayments: undefined,
            buyback: true,
        });
    });

    it("returns buyback false when the checkbox stays unchecked", () => {
        const { onConfirm } = renderDialog({ askX: false, buyback: true });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: undefined,
            buyback: false,
        });
    });

    it("collects X, kicker, and buyback together", () => {
        const { onConfirm } = renderDialog({
            askX: true,
            kickers: [
                { id: "kicker", description: "Kicker {2}", multi: false },
            ],
            buyback: true,
        });
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "2" },
        });
        fireEvent.click(screen.getByLabelText("Pay Kicker {2}"));
        fireEvent.click(screen.getByLabelText("Pay buyback cost"));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: 2,
            kickerPayments: { kicker: 1 },
            buyback: true,
        });
    });
});

// --- Two independently payable Kickers (CR 702.33, ADR 0079) ------------------
//
// "Kicker {A} and/or {B}" (the Planeshift Battlemage cycle) is TWO Kickers on one
// spell, each toggled on its own and each driving its own intervening-if trigger.
// The dialog must therefore offer N independent controls, each with ITS cost text
// legible BEFORE commit — a single "pay the kicker" toggle cannot express it.

describe("CastCostDialog — plural kickers (CR 702.33, ADR 0079)", () => {
    const twoKickers = [
        { id: "kicker-u", description: "Kicker {2}{U}", multi: false },
        { id: "kicker-r", description: "Kicker {2}{R}", multi: false },
    ];

    it("renders one control per kicker with its own cost text", () => {
        renderDialog({ askX: false, kickers: twoKickers });
        expect(screen.getByLabelText("Pay Kicker {2}{U}")).toBeTruthy();
        expect(screen.getByLabelText("Pay Kicker {2}{R}")).toBeTruthy();
        expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });

    it("returns ONLY the kickers the caster toggled on", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: twoKickers,
        });
        fireEvent.click(screen.getByLabelText("Pay Kicker {2}{R}"));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: { "kicker-r": 1 },
        });
    });

    it("returns both when both are toggled on", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: twoKickers,
        });
        fireEvent.click(screen.getByLabelText("Pay Kicker {2}{U}"));
        fireEvent.click(screen.getByLabelText("Pay Kicker {2}{R}"));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: { "kicker-u": 1, "kicker-r": 1 },
        });
    });

    it("declining both casts unkicked (CR 702.33 — the kicker is optional)", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: twoKickers,
        });
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: undefined,
        });
    });

    it("renders a NON-MANA kicker's cost text verbatim, legible before commit", () => {
        renderDialog({
            askX: false,
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker — Sacrifice two lands",
                    multi: false,
                },
            ],
        });
        expect(
            screen.getByLabelText("Pay Kicker — Sacrifice two lands")
        ).toBeTruthy();
    });

    it("mixes a Multikicker and a single kicker on one card (CR 702.33e is per-kicker)", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: [
                { id: "kicker-multi", description: "Kicker {2}", multi: true },
                { id: "kicker-one", description: "Kicker {B}", multi: false },
            ],
        });
        fireEvent.change(screen.getByLabelText("Times to pay Kicker {2}"), {
            target: { value: "3" },
        });
        fireEvent.click(screen.getByLabelText("Pay Kicker {B}"));
        fireEvent.click(castButton());
        expect(onConfirm).toHaveBeenCalledWith({
            chosenX: undefined,
            kickerPayments: { "kicker-multi": 3, "kicker-one": 1 },
        });
    });

    it("disables Cast on a malformed Multikicker count and does not confirm", () => {
        const { onConfirm } = renderDialog({
            askX: false,
            kickers: [{ id: "kicker", description: "Kicker {2}", multi: true }],
        });
        fireEvent.change(screen.getByLabelText("Times to pay Kicker {2}"), {
            target: { value: "" },
        });
        expect((castButton() as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(castButton());
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

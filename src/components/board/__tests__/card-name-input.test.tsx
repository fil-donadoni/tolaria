// Name-a-card choice UI (#489 — Petra Sphinx). `CardNameInput` is an
// autocomplete over the implemented card registry: the chooser types a name,
// gets suggestions, and the submit is gated to a name that resolves to a
// registered card. The server re-validates against the registry. Together with
// `pendingChoiceLabel("name-card")` this is the frontend half of the
// GRE→game.ts→UI name-card path.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import CardNameInput from "~/components/board/card-name-input";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";

afterEach(cleanup);

describe("CardNameInput (name-card UI, #489)", () => {
    it("disables submit until the typed name is a registered card", () => {
        const { getByLabelText, getByText } = render(
            <CardNameInput disabled={false} onSubmit={() => {}} />
        );
        const submit = getByText("Name it") as HTMLButtonElement;
        expect(submit.disabled).toBe(true);

        const input = getByLabelText("Card name");
        fireEvent.change(input, { target: { value: "Not A Real Card 123" } });
        expect(submit.disabled).toBe(true);

        fireEvent.change(input, { target: { value: "Tundra Wolves" } });
        expect(submit.disabled).toBe(false);
    });

    it("submits the canonical name (case-insensitive match)", () => {
        const onSubmit = vi.fn();
        const { getByLabelText, getByText } = render(
            <CardNameInput disabled={false} onSubmit={onSubmit} />
        );
        const input = getByLabelText("Card name");
        fireEvent.change(input, { target: { value: "tundra wolves" } });
        fireEvent.click(getByText("Name it"));
        expect(onSubmit).toHaveBeenCalledWith("Tundra Wolves");
    });

    it("surfaces autocomplete suggestions and fills the field on click", () => {
        const { getByLabelText, getByText } = render(
            <CardNameInput disabled={false} onSubmit={() => {}} />
        );
        const input = getByLabelText("Card name") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Petra" } });
        // The registry has "Petra Sphinx" — it should appear as a suggestion.
        const suggestion = getByText("Petra Sphinx");
        fireEvent.click(suggestion);
        expect(input.value).toBe("Petra Sphinx");
    });

    it("does not submit while disabled (in-flight gate)", () => {
        const onSubmit = vi.fn();
        const { getByLabelText, getByText } = render(
            <CardNameInput disabled onSubmit={onSubmit} />
        );
        fireEvent.change(getByLabelText("Card name"), {
            target: { value: "Tundra Wolves" },
        });
        fireEvent.click(getByText("Name it"));
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits on Enter when the name is valid", () => {
        const onSubmit = vi.fn();
        const { getByLabelText } = render(
            <CardNameInput disabled={false} onSubmit={onSubmit} />
        );
        const input = getByLabelText("Card name");
        fireEvent.change(input, { target: { value: "Tundra Wolves" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onSubmit).toHaveBeenCalledWith("Tundra Wolves");
    });
});

describe("pendingChoiceLabel for name-card (#489)", () => {
    it("returns a non-empty source tag", () => {
        expect(pendingChoiceLabel("name-card")).toBe("Name a card");
    });
});

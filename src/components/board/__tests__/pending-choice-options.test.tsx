// Option-pick choice UI (#289 — Primal Clay / Shapeshifter choose-body-on-
// entry). The `PendingChoiceOptions` button row renders one button per
// author-supplied option and fires `onPick` with the chosen option id;
// `pendingChoiceLabel("option-pick")` gives the prompt's source tag. Together
// these are the frontend half of the GRE→game.ts→UI option-pick path.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import PendingChoiceOptions from "~/components/board/pending-choice-options";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";

afterEach(cleanup);

const PRIMAL_CLAY_OPTIONS = [
    { id: "3-3", label: "3/3" },
    { id: "2-2-flying", label: "2/2 flying" },
    { id: "1-6-wall", label: "1/6 Wall (defender)" },
];

describe("PendingChoiceOptions (option-pick UI, #289)", () => {
    it("renders one button per option with its label", () => {
        const { getByText } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled={false}
                onPick={() => {}}
            />
        );
        expect(getByText("3/3")).toBeTruthy();
        expect(getByText("2/2 flying")).toBeTruthy();
        expect(getByText("1/6 Wall (defender)")).toBeTruthy();
    });

    it("fires onPick with the chosen option id", () => {
        const onPick = vi.fn();
        const { getByText } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled={false}
                onPick={onPick}
            />
        );
        fireEvent.click(getByText("2/2 flying"));
        expect(onPick).toHaveBeenCalledWith("2-2-flying");
    });

    it("does not fire onPick while disabled", () => {
        const onPick = vi.fn();
        const { getByText } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled
                onPick={onPick}
            />
        );
        fireEvent.click(getByText("3/3"));
        expect(onPick).not.toHaveBeenCalled();
    });

    // QA: "Choose a color" pickers (Protection, Kavu Chameleon-style "becomes
    // the color of your choice") used to render as plain text buttons
    // ("Protection from white"), indistinguishable from a non-color modal
    // choice. `color` (colorChoiceModes / protectionColorModes) draws the
    // matching mana symbol; an option with no `color` (Primal Clay's body
    // modes) renders no symbol at all.
    it("draws the matching mana symbol for a color-tagged option", () => {
        const { getByAltText, queryByAltText } = render(
            <PendingChoiceOptions
                options={[
                    {
                        id: "protection-white",
                        label: "Protection from white",
                        color: "W",
                    },
                    {
                        id: "protection-blue",
                        label: "Protection from blue",
                        color: "U",
                    },
                ]}
                disabled={false}
                onPick={() => {}}
            />
        );
        expect(getByAltText("{W}")).toBeTruthy();
        expect(getByAltText("{U}")).toBeTruthy();
        expect(queryByAltText("{B}")).toBeNull();
    });

    it("draws no mana symbol for a non-color option", () => {
        const { container } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled={false}
                onPick={() => {}}
            />
        );
        expect(container.querySelector("img")).toBeNull();
    });
});

// Issue #3323 — an as-enters `{ kind: "subtypes" }` choice (Conspiracy's
// creature type, CR 205.3m) offers ~280 options; the engine tags each with
// `subtype`. That list renders a searchable combobox, not the button grid.
describe("PendingChoiceOptions — subtype choice combobox (issue #3323)", () => {
    const SUBTYPE_OPTIONS = ["Elf", "Goblin", "Orc", "Sorcerer", "Zombie"].map(
        (s) => ({ id: s, label: s, subtype: s })
    );

    function visibleOptions(container: HTMLElement): string[] {
        return [...container.querySelectorAll('[role="option"]')].map(
            (el) => el.textContent ?? ""
        );
    }

    function renderSubtypes(onPick = vi.fn(), disabled = false) {
        const utils = render(
            <PendingChoiceOptions
                options={SUBTYPE_OPTIONS}
                disabled={disabled}
                onPick={onPick}
            />
        );
        const input = utils.getByRole("combobox") as HTMLInputElement;
        return { ...utils, input, onPick };
    }

    it("renders a search input and no button grid", () => {
        const { container, input } = renderSubtypes();
        expect(input.tagName).toBe("INPUT");
        expect(container.querySelector("button")).toBeNull();
        expect(visibleOptions(container)).toEqual(
            SUBTYPE_OPTIONS.map((o) => o.label)
        );
    });

    it("filters by case-insensitive substring of the label", () => {
        const { container, input } = renderSubtypes();
        fireEvent.change(input, { target: { value: "ORC" } });
        // "Sorcerer" contains "orc" — substring, not prefix.
        expect(visibleOptions(container)).toEqual(["Orc", "Sorcerer"]);
    });

    it("does not fuzzy-match a subsequence", () => {
        const { container, input } = renderSubtypes();
        // cmdk's default scorer matches "gb" against G-o-B-lin.
        fireEvent.change(input, { target: { value: "gb" } });
        expect(visibleOptions(container)).toEqual([]);
    });

    it("fires onPick with the option id on click", () => {
        const { getByText, onPick } = renderSubtypes();
        fireEvent.click(getByText("Goblin"));
        expect(onPick).toHaveBeenCalledWith("Goblin");
    });

    it("confirms the highlighted option with Enter, moved by arrow keys", () => {
        const { input, onPick } = renderSubtypes();
        fireEvent.change(input, { target: { value: "orc" } });
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith("Sorcerer");
    });

    it("does not fire onPick while disabled", () => {
        const { input, getByText, onPick } = renderSubtypes(vi.fn(), true);
        fireEvent.click(getByText("Goblin"));
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onPick).not.toHaveBeenCalled();
    });

    it("keeps the button grid for an option list without subtypes", () => {
        const { queryByRole, getByText } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled={false}
                onPick={() => {}}
            />
        );
        expect(queryByRole("combobox")).toBeNull();
        expect(getByText("3/3").closest("button")).toBeTruthy();
    });
});

describe("pendingChoiceLabel for option-pick (#289)", () => {
    it("returns a non-empty source tag", () => {
        expect(pendingChoiceLabel("option-pick")).toBe("Choose");
    });
});

describe("pendingChoiceLabel for land-entry-tapped (ADR 0051)", () => {
    it("tags the shock-land pay-choice", () => {
        expect(pendingChoiceLabel("land-entry-tapped")).toBe("Pay 2 life");
    });
});

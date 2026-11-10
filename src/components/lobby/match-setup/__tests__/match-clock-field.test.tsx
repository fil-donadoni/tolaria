// Step 3's Match Clock field (issue #2308): shown where the setup offers a
// clock, on by default against a player and off against the Bot, minutes
// editable only while on. The rules are `~/lib/matchSetup`'s; this proves the
// step renders and reports them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EMPTY_SETUP, type MatchSetup } from "~/lib/matchSetup";
import MatchFormatStep from "../match-format-step";

const base: MatchSetup = {
    ...EMPTY_SETUP,
    mode: "arena",
    opponent: "host",
    matchFormat: "premodern",
    gamesFormat: 3,
};

function renderStep(setup: MatchSetup) {
    const onChange = vi.fn();
    render(<MatchFormatStep setup={setup} decks={[]} onChange={onChange} />);
    return onChange;
}

describe("Match Clock field (issue #2308)", () => {
    afterEach(cleanup);

    it("against a player: on, 25 minutes for a Bo3, editable", () => {
        const onChange = renderStep(base);
        const toggle = screen.getByRole("switch", { name: "Match Clock" });
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        const minutes = screen.getByLabelText(
            "Minutes per player"
        ) as HTMLInputElement;
        expect(minutes.value).toBe("25");
        expect(minutes.disabled).toBe(false);
        fireEvent.change(minutes, { target: { value: "40" } });
        expect(onChange).toHaveBeenLastCalledWith({ clockMinutes: 40 });
        fireEvent.click(toggle);
        expect(onChange).toHaveBeenLastCalledWith({ clockOn: false });
    });

    it("against the Bot: off, minutes locked until switched on", () => {
        const onChange = renderStep({
            ...base,
            opponent: "bot",
            gamesFormat: 1,
        });
        const toggle = screen.getByRole("switch", { name: "Match Clock" });
        expect(toggle.getAttribute("aria-checked")).toBe("false");
        const minutes = screen.getByLabelText(
            "Minutes per player"
        ) as HTMLInputElement;
        expect(minutes.value).toBe("15");
        expect(minutes.disabled).toBe(true);
        fireEvent.click(toggle);
        expect(onChange).toHaveBeenLastCalledWith({ clockOn: true });
    });

    it("solo shows no clock field", () => {
        renderStep({ ...base, opponent: "solo" });
        expect(
            screen.queryByRole("switch", { name: "Match Clock" })
        ).toBeNull();
    });
});

// The hotkeys legend is DERIVED from the declarations in `~/lib/hotkeys`
// (issue #9833) — it used to be a second, hand-written list that could miss a
// new binding or advertise a dead one.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HOTKEYS, type HotkeyScope } from "~/lib/hotkeys";
import HotkeysLegend from "../hotkeys-legend";

afterEach(cleanup);

function openLegend(scope?: HotkeyScope): HTMLElement[] {
    render(<HotkeysLegend scope={scope} />);
    fireEvent.click(screen.getByRole("button", { name: "Show hotkeys" }));
    return [...document.querySelectorAll<HTMLElement>("[data-hotkey-row]")];
}

function declared(scope: HotkeyScope): string[] {
    return Object.values(HOTKEYS)
        .filter((h) => (h.scopes as readonly string[]).includes(scope))
        .map((h) => h.label);
}

describe("HotkeysLegend", () => {
    it.each(["board", "manual"] as const)(
        "lists exactly the bindings declared for the %s, each with its keycap",
        (scope) => {
            const rows = openLegend(scope);
            expect(rows.map((r) => r.dataset.hotkeyRow)).toEqual(
                declared(scope)
            );
            for (const row of rows) {
                expect(row.querySelector('[data-slot="kbd"]')).not.toBeNull();
            }
        }
    );

    it("defaults to the GRE board's bindings", () => {
        const rows = openLegend();
        expect(rows.map((r) => r.dataset.hotkeyRow)).toEqual(declared("board"));
        expect(
            rows
                .find((r) => r.dataset.hotkeyRow === HOTKEYS.passTurn.label)
                ?.querySelector('[data-slot="kbd"]')?.textContent
        ).toBe("P");
    });
});

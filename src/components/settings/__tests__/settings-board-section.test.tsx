// Board Settings section (issue #7429): the per-device Stacked / Separate
// battlefield grouping, bound to localStorage — no Convex round-trip.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import SettingsBoardSection from "../settings-board-section";
import { loadBattlefieldGrouping } from "~/lib/boardViewPrefs";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("SettingsBoardSection", () => {
    it("shows Stacked checked for a device that never chose", () => {
        const { getByRole } = render(<SettingsBoardSection />);
        expect(
            (getByRole("radio", { name: /stacked/i }) as HTMLInputElement)
                .checked
        ).toBe(true);
    });

    it("picking Separate stores it on this device", () => {
        const { getByRole } = render(<SettingsBoardSection />);
        fireEvent.click(getByRole("radio", { name: /separate/i }));
        expect(loadBattlefieldGrouping()).toBe("separate");
        expect(
            (getByRole("radio", { name: /separate/i }) as HTMLInputElement)
                .checked
        ).toBe(true);
    });
});

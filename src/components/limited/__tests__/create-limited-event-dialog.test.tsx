// Create Limited Event dialog — Pick Timer On/Off control (ADR 0060, issue
// #1243). Replaces the old checkbox + seconds-field pair with a clear On/Off
// radiogroup, Draft only (never shown for Sealed), and no seconds input at
// all — the per-pick length always follows the server-side descending
// schedule. Drives the SURFACE assertion through the real component render
// (not a hand-built view), per the project's frontend wiring discipline.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";
import CreateLimitedEventDialog from "../create-limited-event-dialog";

const DRAFTABLE_SETS: DraftableSetInfo[] = [
    { setCode: "lea", draftable: true, missingCardCount: 0 },
];

function renderDialog(
    overrides: Partial<Parameters<typeof CreateLimitedEventDialog>[0]> = {}
) {
    const props = {
        open: true,
        onOpenChange: vi.fn(),
        draftableSets: DRAFTABLE_SETS,
        onCreate: vi.fn(),
        pending: false,
        ...overrides,
    };
    return { props, ...render(<CreateLimitedEventDialog {...props} />) };
}

describe("CreateLimitedEventDialog — Pick Timer (ADR 0060, issue #1243)", () => {
    it("never shows the Pick Timer control for a Sealed event (default type)", () => {
        renderDialog();
        expect(screen.queryByRole("radiogroup", { name: "Pick Timer" })).toBe(
            null
        );
    });

    it("shows an On/Off Pick Timer control, defaulting to Off, once Draft is selected — no seconds field", () => {
        renderDialog();
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));

        const timerGroup = screen.getByRole("radiogroup", {
            name: "Pick Timer",
        });
        expect(timerGroup).toBeTruthy();
        const off = screen.getByRole("radio", { name: "Off" });
        const on = screen.getByRole("radio", { name: "On" });
        expect(off.getAttribute("aria-checked")).toBe("true");
        expect(on.getAttribute("aria-checked")).toBe("false");

        // No seconds input anywhere — the control is on/off only.
        expect(screen.queryByText(/seconds per pick/i)).toBe(null);
        expect(screen.queryByRole("spinbutton", { name: /seconds/i })).toBe(
            null
        );
    });

    it("toggles to On and submits timerEnabled: true", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: "On" }));

        expect(screen.getByRole("radio", { name: "On" }).getAttribute(
            "aria-checked"
        )).toBe("true");

        fireEvent.click(screen.getByText("Create Event"));
        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "draft", timerEnabled: true })
        );
    });

    it("submits timerEnabled: false when the timer is left Off for a Draft", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));

        fireEvent.click(screen.getByText("Create Event"));
        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "draft", timerEnabled: false })
        );
    });

    it("submits timerEnabled: false for a Sealed event regardless of any prior Draft timer choice", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        // Switch to Draft, turn the timer on, then switch back to Sealed.
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: "On" }));
        fireEvent.click(screen.getByRole("radio", { name: "Sealed" }));

        fireEvent.click(screen.getByText("Create Event"));
        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "sealed", timerEnabled: false })
        );
    });
});
